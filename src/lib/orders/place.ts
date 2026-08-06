import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getProviderCredentials, addOrder, ProviderError } from "@/src/lib/providers";
import { round4 } from "@/src/lib/money";
import { validateOrderLink } from "@/src/lib/order-link";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   Order-placement CORE (no auth / no session).
   The money path: price → duplicate guard → charge wallet (ledger) → forward to
   provider → track/refund. Shared by the customer action (actions/orders.ts, which
   resolves the signed-in customer first) and the watched-accounts cron (which acts on
   behalf of a resolved customer account). All provider calls are server-side.
   ========================================================= */

export interface PlaceOrderInput {
  panelId: string;
  serviceId: string; // real service UUID
  link: string;
  quantity: number;
  runs?: number;
  interval?: number;
  comments?: string;
}

export type PlaceOrderResult =
  | { ok: true; orderId: string; charge: number; balance: number; status: OrderStatus }
  | { ok: false; error: string };

export function normalizeDupLink(link: string): string {
  const raw = (link || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const path = (u.pathname || "").replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return raw
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

async function addHistory(admin: SupabaseClient, orderId: string, status: OrderStatus, note?: string) {
  await admin.from("order_status_history").insert({ order_id: orderId, status, note: note ?? null });
}

function isInsufficientBalance(msg?: string | null): boolean {
  if (!msg) return false;
  return /insufficient|not enough (funds|balance|money)|no (funds|balance)|low balance|top ?up|add funds/i.test(msg);
}

async function refundAndFail(admin: SupabaseClient, orderId: string, customerId: string, charge: number, reason: string) {
  await admin.rpc("apply_balance_change", { p_customer: customerId, p_amount: charge, p_type: "refund", p_reason: reason, p_ref_order: orderId });
  await admin.from("orders").update({ status: "refunded" }).eq("id", orderId);
  await addHistory(admin, orderId, "refunded", reason);
}

/** Place an order for an already-resolved panel + customer account. */
export async function placeOrderForAccount(
  admin: SupabaseClient,
  panel: { id: string; status: string },
  acct: { id: string; status: string; balance: number | string },
  input: PlaceOrderInput
): Promise<PlaceOrderResult> {
  if (panel.status !== "live") return { ok: false, error: "Ordering is currently unavailable on this panel." };
  if (acct.status !== "active") return { ok: false, error: "Your account can't place orders right now." };

  const { data: svc } = await admin
    .from("services")
    .select("id, panel_id, provider_id, provider_service_id, sell_rate, provider_rate, min, max, status, name, category_id")
    .eq("id", input.serviceId)
    .maybeSingle();
  if (!svc || svc.panel_id !== input.panelId) return { ok: false, error: "Service not found." };
  if (svc.status !== "active") return { ok: false, error: "This service is currently unavailable." };

  const linkCheck = validateOrderLink(input.link);
  if (!linkCheck.ok) return { ok: false, error: linkCheck.error };
  const link = linkCheck.url;
  const commentList = (input.comments ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const hasComments = commentList.length > 0;
  const qty = hasComments ? commentList.length : Math.floor(Number(input.quantity));
  if (!Number.isFinite(qty) || qty < svc.min || qty > svc.max) {
    return hasComments
      ? { ok: false, error: `Enter between ${svc.min.toLocaleString()} and ${svc.max.toLocaleString()} comments (one per line).` }
      : { ok: false, error: `Quantity must be between ${svc.min.toLocaleString()} and ${svc.max.toLocaleString()}.` };
  }

  const charge = round4((qty / 1000) * Number(svc.sell_rate));
  const providerCost = round4((qty / 1000) * Number(svc.provider_rate));
  const profit = round4(charge - providerCost);
  if (charge <= 0) return { ok: false, error: "This order amount is invalid." };
  if (Number(acct.balance) < charge) return { ok: false, error: "Insufficient balance. Please add funds and try again." };

  // Duplicate guard BEFORE wallet charge/provider send.
  const normalizedLink = normalizeDupLink(link);
  const { data: relatedOrders } = await admin
    .from("orders")
    .select("id, service_id, link, status")
    .eq("panel_id", input.panelId)
    .eq("customer_id", acct.id)
    .in("status", ["pending", "processing", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(200);

  const relatedRows = (relatedOrders as Array<{ id: string; service_id: string; link: string; status: OrderStatus }> | null) ?? [];
  if (relatedRows.length) {
    const matchesDuplicate = (row: { service_id: string; link: string }): boolean => {
      if (normalizeDupLink(row.link) !== normalizedLink) return false;
      return row.service_id === svc.id;
    };

    const dupe = relatedRows.find((row) => matchesDuplicate(row));
    if (dupe) {
      const dripDup = input.runs != null && input.interval != null;
      const { data: duplicateOrder, error: duplicateErr } = await admin
        .from("orders")
        .insert({
          panel_id: input.panelId, customer_id: acct.id, service_id: svc.id, service_category_id: svc.category_id,
          provider_id: svc.provider_id, link, quantity: qty, charge, provider_cost: providerCost, profit, status: "duplicate",
          provider_payload: { service: svc.provider_service_id, quantity: qty, ...(dripDup ? { runs: input.runs, interval: input.interval } : {}), ...(hasComments ? { comments: commentList } : {}) },
          provider_response: { duplicate: true, reason: "Matched existing active order with same link + service.", duplicate_of: dupe.id },
        })
        .select("id")
        .single();
      if (duplicateErr || !duplicateOrder) return { ok: false, error: duplicateErr?.message ?? "Could not create duplicate-marked order." };
      await addHistory(admin, duplicateOrder.id, "duplicate", "Duplicate of an existing order — not sent to the provider.");
      return { ok: true, orderId: duplicateOrder.id, charge, balance: Number(acct.balance), status: "duplicate" };
    }
  }

  const drip = input.runs != null && input.interval != null;
  const { data: order, error: oErr } = await admin
    .from("orders")
    .insert({
      panel_id: input.panelId, customer_id: acct.id, service_id: svc.id, service_category_id: svc.category_id,
      provider_id: svc.provider_id, link, quantity: qty, charge, provider_cost: providerCost, profit, status: "pending",
      provider_payload: { service: svc.provider_service_id, quantity: qty, ...(drip ? { runs: input.runs, interval: input.interval } : {}), ...(hasComments ? { comments: commentList } : {}) },
    })
    .select("id")
    .single();
  if (oErr || !order) return { ok: false, error: oErr?.message ?? "Could not create the order." };
  const orderId = order.id;
  await addHistory(admin, orderId, "pending");

  const { data: tx, error: bErr } = await admin.rpc("apply_balance_change", {
    p_customer: acct.id, p_amount: -charge, p_type: "order", p_reason: `Order ${orderId}`, p_ref_order: orderId,
  });
  if (bErr || !tx) {
    await admin.from("orders").delete().eq("id", orderId);
    const msg = /insufficient/i.test(bErr?.message ?? "") ? "Insufficient balance. Please add funds and try again." : bErr?.message ?? "Could not charge your wallet.";
    return { ok: false, error: msg };
  }
  const balanceAfter = Number((tx as { balance_after: number }).balance_after);

  if (svc.provider_id && svc.provider_service_id) {
    const { data: prov } = await admin.from("providers").select("api_url").eq("id", svc.provider_id).maybeSingle();
    if (!prov) {
      await refundAndFail(admin, orderId, acct.id, charge, "Provider not found");
      return { ok: false, error: "The provider for this service is unavailable. You were refunded." };
    }
    try {
      const creds = await getProviderCredentials(svc.provider_id, prov.api_url);
      const resp = await addOrder(creds, {
        service: svc.provider_service_id, link, quantity: qty,
        ...(drip ? { runs: input.runs, interval: input.interval } : {}), ...(hasComments ? { comments: commentList.join("\n") } : {}),
      });
      if ("order" in resp) {
        await admin.from("orders").update({ provider_order_id: String(resp.order), status: "processing", provider_response: resp as Record<string, unknown> }).eq("id", orderId);
        await addHistory(admin, orderId, "processing", "Submitted to provider");
        return { ok: true, orderId, charge, balance: balanceAfter, status: "processing" };
      }
      if (isInsufficientBalance(resp.error)) {
        await admin.from("orders").update({ status: "pending", provider_response: { ...(resp as Record<string, unknown>), held: true, reason: "provider_balance" } }).eq("id", orderId);
        await addHistory(admin, orderId, "pending", `On hold — provider balance insufficient; auto-cancels in 24h. (${resp.error ?? ""})`);
        return { ok: true, orderId, charge, balance: balanceAfter, status: "pending" };
      }
      await admin.from("orders").update({ provider_response: resp as Record<string, unknown> }).eq("id", orderId);
      await refundAndFail(admin, orderId, acct.id, charge, resp.error || "Provider rejected the order");
      return { ok: false, error: resp.error || "The provider rejected this order. You were refunded." };
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error";
      await refundAndFail(admin, orderId, acct.id, charge, msg);
      return { ok: false, error: `Could not reach the provider (${msg}). You were refunded.` };
    }
  }

  return { ok: true, orderId, charge, balance: balanceAfter, status: "pending" };
}
