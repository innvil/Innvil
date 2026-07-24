"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { getProviderCredentials, addOrder, ProviderError } from "@/src/lib/providers";
import { round4 } from "@/src/lib/money";
import { syncPanelOrders } from "@/src/lib/orders/sync";
import { validateOrderLink } from "@/src/lib/order-link";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   §4 ORDER PIPELINE (customer-facing)
   place → charge wallet (ledger) → forward to provider → track.
   Runs on the storefront session. All provider calls are server-side;
   api keys are never exposed. Never returns provider cost / profit.
   ========================================================= */

export interface PlaceOrderInput {
  panelId: string;
  serviceId: string; // real service UUID
  link: string;
  quantity: number;
  /** Drip feed (only for services that support it). */
  runs?: number;
  interval?: number;
  /** Custom Comments services: the list of comments (one per line). When present,
   *  the quantity is the number of comments. */
  comments?: string;
}

export type PlaceOrderResult =
  | { ok: true; orderId: string; charge: number; balance: number; status: OrderStatus }
  | { ok: false; error: string };

type DuplicateServiceMeta = {
  id: string;
  category_id: string | null;
};

function normalizeDupLink(link: string): string {
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

/** Whether a provider error message means the PROVIDER's own balance is too low. */
function isInsufficientBalance(msg?: string | null): boolean {
  if (!msg) return false;
  return /insufficient|not enough (funds|balance|money)|no (funds|balance)|low balance|top ?up|add funds/i.test(msg);
}

/** Refund a charge and mark the order refunded (used when the provider rejects it). */
async function refundAndFail(
  admin: SupabaseClient,
  orderId: string,
  customerId: string,
  charge: number,
  reason: string
) {
  await admin.rpc("apply_balance_change", {
    p_customer: customerId,
    p_amount: charge, // positive → credit back
    p_type: "refund",
    p_reason: reason,
    p_ref_order: orderId,
  });
  await admin
    .from("orders")
    .update({ status: "refunded" })
    .eq("id", orderId);
  await addHistory(admin, orderId, "refunded", reason);
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  // 1. Auth — the signed-in storefront (customer) user.
  const supa = await createStorefrontClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to place an order." };

  const admin = createAdminClient();

  // 2. Panel must be live to accept new orders.
  const { data: panel } = await admin
    .from("panels")
    .select("id, status")
    .eq("id", input.panelId)
    .maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (panel.status !== "live") return { ok: false, error: "Ordering is currently unavailable on this panel." };

  // 3. The customer's account on this panel.
  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, status, balance")
    .eq("panel_id", input.panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return { ok: false, error: "No account found on this panel." };
  if (acct.status !== "active") return { ok: false, error: "Your account can't place orders right now." };

  // 4. Service must belong to this panel and be active.
  const { data: svc } = await admin
    .from("services")
    .select("id, panel_id, provider_id, provider_service_id, sell_rate, provider_rate, min, max, status, name, category_id")
    .eq("id", input.serviceId)
    .maybeSingle();
  if (!svc || svc.panel_id !== input.panelId) return { ok: false, error: "Service not found." };
  if (svc.status !== "active") return { ok: false, error: "This service is currently unavailable." };

  // 5. Validate link + quantity. For Custom Comments services the quantity is the
  //    number of comments supplied (one per line).
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

  // 6. Price it (rates are per 1000).
  const charge = round4((qty / 1000) * Number(svc.sell_rate));
  const providerCost = round4((qty / 1000) * Number(svc.provider_rate));
  const profit = round4(charge - providerCost);
  if (charge <= 0) return { ok: false, error: "This order amount is invalid." };
  if (Number(acct.balance) < charge) {
    return { ok: false, error: "Insufficient balance. Please add funds and try again." };
  }

  // 7. Duplicate guard BEFORE wallet charge/provider send.
  //    Same-link alone is not enough: it must also match service ID OR category.
  const normalizedLink = normalizeDupLink(link);
  const { data: relatedOrders } = await admin
    .from("orders")
    .select("id, service_id, service_category_id, link, status")
    .eq("panel_id", input.panelId)
    .eq("customer_id", acct.id)
    .in("status", ["pending", "processing", "in_progress", "partial", "completed"])
    .order("created_at", { ascending: false })
    .limit(200);

  const relatedRows = (relatedOrders as Array<{ id: string; service_id: string; service_category_id: string | null; link: string; status: OrderStatus }> | null) ?? [];
  if (relatedRows.length) {
    const serviceIds = [...new Set(relatedRows.map((r) => r.service_id).filter(Boolean))];
    const { data: serviceMetaRows } = await admin.from("services").select("id, category_id").in("id", serviceIds);
    const serviceMeta = new Map(((serviceMetaRows as DuplicateServiceMeta[] | null) ?? []).map((row) => [row.id, row]));

    const matchesDuplicate = (row: { service_id: string; service_category_id: string | null; link: string }): boolean => {
      if (normalizeDupLink(row.link) !== normalizedLink) return false;
      if (row.service_id === svc.id) return true;
      const rowCategory = row.service_category_id ?? serviceMeta.get(row.service_id)?.category_id ?? null;
      return !!(svc.category_id && rowCategory && rowCategory === svc.category_id);
    };

    const dupe = relatedRows.find((row) => matchesDuplicate(row));
    if (dupe) {
      const drip = input.runs != null && input.interval != null;
      const { data: duplicateOrder, error: duplicateErr } = await admin
        .from("orders")
        .insert({
          panel_id: input.panelId,
          customer_id: acct.id,
          service_id: svc.id,
          service_category_id: svc.category_id,
          provider_id: svc.provider_id,
          link,
          quantity: qty,
          charge,
          provider_cost: providerCost,
          profit,
          status: "duplicate",
          provider_payload: {
            service: svc.provider_service_id,
            quantity: qty,
            ...(drip ? { runs: input.runs, interval: input.interval } : {}),
            ...(hasComments ? { comments: commentList } : {}),
          },
          provider_response: {
            duplicate: true,
            reason: "Matched existing order with same link + service/category.",
            duplicate_of: dupe.id,
          },
        })
        .select("id")
        .single();
      if (duplicateErr || !duplicateOrder) {
        return { ok: false, error: duplicateErr?.message ?? "Could not create duplicate-marked order." };
      }
      await addHistory(admin, duplicateOrder.id, "duplicate", "Duplicate of an existing order — not sent to the provider.");
      return { ok: true, orderId: duplicateOrder.id, charge, balance: Number(acct.balance), status: "duplicate" };
    }
  }

  // 8. Create the order row first (pending) so the ledger can reference it.
  const drip = input.runs != null && input.interval != null;
  const { data: order, error: oErr } = await admin
    .from("orders")
    .insert({
      panel_id: input.panelId,
      customer_id: acct.id,
      service_id: svc.id,
      service_category_id: svc.category_id,
      provider_id: svc.provider_id,
      link,
      quantity: qty,
      charge,
      provider_cost: providerCost,
      profit,
      status: "pending",
      provider_payload: {
        service: svc.provider_service_id,
        quantity: qty,
        ...(drip ? { runs: input.runs, interval: input.interval } : {}),
        ...(hasComments ? { comments: commentList } : {}),
      },
    })
    .select("id")
    .single();
  if (oErr || !order) return { ok: false, error: oErr?.message ?? "Could not create the order." };
  const orderId = order.id;
  await addHistory(admin, orderId, "pending");

  // 9. Debit the wallet atomically (raises 'insufficient balance' under lock).
  const { data: tx, error: bErr } = await admin.rpc("apply_balance_change", {
    p_customer: acct.id,
    p_amount: -charge,
    p_type: "order",
    p_reason: `Order ${orderId}`,
    p_ref_order: orderId,
  });
  if (bErr || !tx) {
    await admin.from("orders").delete().eq("id", orderId);
    const msg = /insufficient/i.test(bErr?.message ?? "")
      ? "Insufficient balance. Please add funds and try again."
      : bErr?.message ?? "Could not charge your wallet.";
    return { ok: false, error: msg };
  }
  const balanceAfter = Number((tx as { balance_after: number }).balance_after);

  // 10. Forward to the provider (server-side). If unmapped, leave pending for the
  //    owner to route manually. If the provider rejects it, refund and fail.
  if (svc.provider_id && svc.provider_service_id) {
    const { data: prov } = await admin
      .from("providers")
      .select("api_url")
      .eq("id", svc.provider_id)
      .maybeSingle();
    if (!prov) {
      await refundAndFail(admin, orderId, acct.id, charge, "Provider not found");
      return { ok: false, error: "The provider for this service is unavailable. You were refunded." };
    }
    try {
      const creds = await getProviderCredentials(svc.provider_id, prov.api_url);
      const resp = await addOrder(creds, {
        service: svc.provider_service_id,
        link,
        quantity: qty,
        ...(drip ? { runs: input.runs, interval: input.interval } : {}),
        ...(hasComments ? { comments: commentList.join("\n") } : {}),
      });
      if ("order" in resp) {
        await admin
          .from("orders")
          .update({
            provider_order_id: String(resp.order),
            status: "processing",
            provider_response: resp as Record<string, unknown>,
          })
          .eq("id", orderId)
        await addHistory(admin, order.id, "processing", "Submitted to provider");
        return { ok: true, orderId: order.id, charge, balance: balanceAfter, status: "processing" };
      }
      // Provider returned an error payload.
      // If it's an INSUFFICIENT PROVIDER BALANCE, don't refund/fail immediately —
      // hold the order so the owner can top up their provider. It auto-cancels +
      // refunds after 24h (see expireHeldOrders) if still unfunded.
      if (isInsufficientBalance(resp.error)) {
        await admin.from("orders").update({
          status: "pending",
          provider_response: { ...(resp as Record<string, unknown>), held: true, reason: "provider_balance" },
        }).eq("id", order.id);
        await addHistory(admin, order.id, "pending", `On hold — provider balance insufficient; auto-cancels in 24h. (${resp.error ?? ""})`);
        return { ok: true, orderId: order.id, charge, balance: balanceAfter, status: "pending" };
      }
      await admin
        .from("orders")
        .update({ provider_response: resp as Record<string, unknown> })
        .eq("id", order.id);
      await refundAndFail(admin, order.id, acct.id, charge, resp.error || "Provider rejected the order");
      return { ok: false, error: resp.error || "The provider rejected this order. You were refunded." };
    } catch (e) {
      const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error";
      await refundAndFail(admin, order.id, acct.id, charge, msg);
      return { ok: false, error: `Could not reach the provider (${msg}). You were refunded.` };
    }
  }

  // No provider mapped — order stays pending for manual handling by the owner.
  return { ok: true, orderId: order.id, charge, balance: balanceAfter, status: "pending" };
}

export interface CustomerOrderVM {
  id: string;
  localId: string; // display order number (per-panel sequential), falls back to uuid slice
  serviceId: string | null;
  serviceNo: number | null; // the service's own number
  serviceName: string;
  link: string;
  quantity: number;
  charge: number;
  status: OrderStatus;
  createdAt: string;
  failReason: string | null; // provider failure reason for failed/canceled orders
  comments: string[] | null; // custom comments, if any
  held: boolean; // provider-balance hold: show as processing customer-side until auto-refund
}

const CUSTOMER_FAILED: OrderStatus[] = ["failed", "canceled", "refunded"];

export interface CustomerOrderPage {
  rows: CustomerOrderVM[];
  hasNext: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  allCount: number;
}

type CustomerOrderRow = {
  id: string;
  local_id: number | null;
  service_id: string | null;
  link: string;
  quantity: number;
  charge: number;
  status: OrderStatus;
  created_at: string;
  provider_response: { error?: string; held?: boolean } | null;
  provider_payload: { comments?: string[] } | null;
  services: { name?: string; local_id?: number } | { name?: string; local_id?: number }[] | null;
};

function mapCustomerOrderRow(o: CustomerOrderRow): CustomerOrderVM {
  const svcRaw = o.services;
  const svc = Array.isArray(svcRaw) ? svcRaw[0] : svcRaw;
  const pr = o.provider_response;
  const pp = o.provider_payload;
  const rawStatus = o.status;
  const held = pr?.held === true && rawStatus === "pending";
  const status = held ? "processing" : rawStatus;
  return {
    id: o.id,
    localId: o.local_id != null ? String(o.local_id) : String(o.id).slice(0, 8),
    serviceId: o.service_id ?? null,
    serviceNo: svc?.local_id ?? null,
    serviceName: svc?.name ?? "Service",
    link: o.link,
    quantity: o.quantity,
    charge: Number(o.charge),
    status,
    createdAt: o.created_at,
    failReason: CUSTOMER_FAILED.includes(status) && typeof pr?.error === "string" ? pr.error : null,
    comments: Array.isArray(pp?.comments) ? pp.comments : null,
    held,
  };
}

/**
 * Paged orders for the signed-in storefront customer on a panel.
 * Fetches one extra row to derive hasNext cheaply.
 */
export async function listCustomerOrdersPage(
  panelId: string,
  opts?: { status?: OrderStatus | "all"; page?: number; pageSize?: number; sync?: boolean }
): Promise<CustomerOrderPage> {
  const page = Math.max(0, opts?.page ?? 0);
  const pageSize = Math.max(1, opts?.pageSize ?? 50);
  const empty: CustomerOrderPage = {
    rows: [],
    hasNext: false,
    page,
    pageSize,
    totalCount: 0,
    allCount: 0,
  };

  const supa = await createStorefrontClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return empty;

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return empty;

  // Optional sync: keep normal page loads fast unless explicitly requested.
  if (opts?.sync) {
    try { await syncPanelOrders(admin, panelId); } catch { /* ignore sync failures */ }
  }

  const from = page * pageSize;
  const to = from + pageSize;
  const base = admin
    .from("orders")
    .select("id, local_id, service_id, link, quantity, charge, status, created_at, provider_response, provider_payload, services(name, local_id)")
    .eq("customer_id", acct.id);
  const filtered = opts?.status && opts.status !== "all" ? base.eq("status", opts.status) : base;

  const [pageRes, filteredCountRes, allCountRes] = await Promise.all([
    filtered.order("created_at", { ascending: false }).range(from, to),
    (opts?.status && opts.status !== "all"
      ? admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", acct.id).eq("status", opts.status)
      : admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", acct.id)),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", acct.id),
  ]);

  const fetched = (pageRes.data as CustomerOrderRow[] | null) ?? [];
  const hasNext = fetched.length > pageSize;
  const rows = hasNext ? fetched.slice(0, pageSize) : fetched;

  return {
    rows: rows.map(mapCustomerOrderRow),
    hasNext,
    page,
    pageSize,
    totalCount: filteredCountRes.count ?? 0,
    allCount: allCountRes.count ?? 0,
  };
}

/** The signed-in customer's orders on a panel (newest first). No cost/profit. */
export async function listCustomerOrders(panelId: string): Promise<CustomerOrderVM[]> {
  const page = await listCustomerOrdersPage(panelId, { status: "all", page: 0, pageSize: 200, sync: true });
  return page.rows;
}

/**
 * Owner-triggered status sync for one panel (same engine the cron uses). Lets the
 * owner refresh statuses on demand without waiting for the schedule.
 */
export async function syncOrdersNow(
  panelId: string
): Promise<{ ok: true; checked: number; updated: number } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  const { data: owns } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!owns) return { ok: false, error: "Not authorized for this panel" };
  const r = await syncPanelOrders(admin, panelId);
  return { ok: true, ...r };
}
