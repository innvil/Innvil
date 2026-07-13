import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getProviderCredentials, getMultiStatus } from "@/src/lib/providers";
import { round4 } from "@/src/lib/money";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   §4 ORDER-STATUS SYNC
   Polls each provider for the live status of open orders and moves them
   Processing → Completed / Partial / Canceled / Refunded. On partial/canceled/
   refunded it refunds the unfilled portion (once, via an atomic status claim).
   Server-only; runs under the service role (cron or owner-triggered).
   ========================================================= */

// Orders we still poll. Terminal states (completed/partial/canceled/refunded/
// failed) are left alone.
const OPEN_STATUSES: OrderStatus[] = ["pending", "processing", "in_progress"];

/** Map a provider's free-text status to our enum (null = unknown, leave as-is). */
export function mapProviderStatus(raw: string): OrderStatus | null {
  const s = (raw || "").toLowerCase();
  if (s.includes("progress")) return "in_progress";
  if (s.includes("complete")) return "completed";
  if (s.includes("partial")) return "partial";
  if (s.includes("cancel")) return "canceled";
  if (s.includes("refund")) return "refunded";
  if (s.includes("fail") || s.includes("error")) return "failed";
  if (s === "pending") return "pending";
  if (s === "processing" || s === "in process") return "processing";
  return null;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface OpenOrder {
  id: string;
  provider_id: string;
  provider_order_id: string;
  status: OrderStatus;
  quantity: number;
  charge: number;
  customer_id: string;
  remains: number | null;
}

// Orders held because the provider's own balance was too low auto-cancel + refund
// after this window if still unfunded.
const HELD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Auto-cancel + refund orders that have been ON HOLD (provider balance insufficient)
 * for over 24h. Returns how many were canceled. Runs as part of each sync pass.
 */
export async function expireHeldOrders(admin: SupabaseClient, panelId: string): Promise<number> {
  const cutoff = new Date(Date.now() - HELD_TTL_MS).toISOString();
  const { data } = await admin
    .from("orders")
    .select("id, customer_id, charge, provider_response, created_at")
    .eq("panel_id", panelId)
    .eq("status", "pending")
    .lt("created_at", cutoff);

  let canceled = 0;
  for (const o of data ?? []) {
    const pr = o.provider_response as { held?: boolean } | null;
    if (!pr || pr.held !== true) continue;
    // Atomically claim pending → canceled so only one run refunds.
    const { data: claimed } = await admin
      .from("orders").update({ status: "canceled" })
      .eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;
    await admin.rpc("apply_balance_change", {
      p_customer: o.customer_id,
      p_amount: Number(o.charge),
      p_type: "refund",
      p_reason: `Order ${o.id} auto-canceled — provider balance not funded within 24h`,
    });
    await admin.from("order_status_history").insert({
      order_id: o.id, status: "canceled", note: "Auto-canceled after 24h on hold (provider balance).",
    });
    canceled++;
  }
  return canceled;
}

/** Sync all open orders for one panel. Returns how many were checked/updated. */
export async function syncPanelOrders(
  admin: SupabaseClient,
  panelId: string
): Promise<{ checked: number; updated: number }> {
  // First, expire any orders held too long on insufficient provider balance.
  const expired = await expireHeldOrders(admin, panelId);

  const { data: orders } = await admin
    .from("orders")
    .select("id, provider_id, provider_order_id, status, quantity, charge, customer_id, remains")
    .eq("panel_id", panelId)
    .in("status", OPEN_STATUSES)
    .not("provider_order_id", "is", null)
    .not("provider_id", "is", null);

  const list = (orders as OpenOrder[] | null) ?? [];
  if (!list.length) return { checked: 0, updated: expired };

  // Group by provider (each has its own credentials).
  const byProvider = new Map<string, OpenOrder[]>();
  for (const o of list) {
    (byProvider.get(o.provider_id) ?? byProvider.set(o.provider_id, []).get(o.provider_id)!).push(o);
  }

  let updated = 0;
  for (const [providerId, group] of byProvider) {
    const { data: prov } = await admin
      .from("providers")
      .select("api_url")
      .eq("id", providerId)
      .maybeSingle();
    if (!prov) continue;

    let creds;
    try {
      creds = await getProviderCredentials(providerId, prov.api_url as string);
    } catch {
      continue; // key missing/unreadable — skip this provider this run
    }

    const byProviderOrderId = new Map(group.map((o) => [String(o.provider_order_id), o]));
    for (const ids of chunk([...byProviderOrderId.keys()], 100)) {
      let resp;
      try {
        resp = await getMultiStatus(creds, ids);
      } catch {
        continue; // provider unreachable — try again next run
      }

      for (const [pid, st] of Object.entries(resp)) {
        const o = byProviderOrderId.get(pid);
        if (!o || !st || "error" in st) continue;

        const next = mapProviderStatus(st.status);
        if (!next || next === o.status) continue;

        const remains = Number(st.remains);
        const startCount = Number(st.start_count);

        // Atomically claim the transition so overlapping runs can't double-refund.
        const { data: claimed } = await admin
          .from("orders")
          .update({
            status: next,
            remains: Number.isFinite(remains) ? remains : o.remains,
            start_count: Number.isFinite(startCount) ? startCount : null,
          })
          .eq("id", o.id)
          .in("status", OPEN_STATUSES)
          .select("id")
          .maybeSingle();
        if (!claimed) continue; // another run handled it

        // Refund the unfilled portion once, on the way into a terminal state.
        if (next === "partial" || next === "canceled" || next === "refunded") {
          let refund = 0;
          if (next === "refunded") {
            refund = Number(o.charge);
          } else if (Number.isFinite(remains) && remains > 0 && o.quantity > 0) {
            refund = round4(Number(o.charge) * Math.min(remains / o.quantity, 1));
          }
          if (refund > 0) {
            await admin.rpc("apply_balance_change", {
              p_customer: o.customer_id,
              p_amount: refund,
              p_type: "refund",
              p_reason: `Order ${o.id} ${next}`,
            });
          }
        }

        await admin
          .from("order_status_history")
          .insert({ order_id: o.id, status: next, note: "Synced from provider" });
        updated++;
      }
    }
  }

  return { checked: list.length, updated: updated + expired };
}

/** Sync open orders across every panel that has any. Used by the cron. */
export async function syncAllOpenOrders(): Promise<{ panels: number; checked: number; updated: number }> {
  const admin = createAdminClient();
  // Any panel with an open order (mapped OR held-pending) needs a pass — held
  // orders have no provider_order_id but still must be expired after 24h.
  const { data } = await admin
    .from("orders")
    .select("panel_id")
    .in("status", OPEN_STATUSES);

  const panelIds = [...new Set((data ?? []).map((o) => o.panel_id as string))];
  let checked = 0;
  let updated = 0;
  for (const pid of panelIds) {
    const r = await syncPanelOrders(admin, pid);
    checked += r.checked;
    updated += r.updated;
  }
  return { panels: panelIds.length, checked, updated };
}
