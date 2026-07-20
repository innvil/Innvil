import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getProviderCredentials, getMultiStatus } from "@/src/lib/providers";
import { round4, INNVIL_COMMISSION_RATE } from "@/src/lib/money";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   §4 ORDER-STATUS SYNC
   Polls each provider for the live status of open orders and moves them
   Processing → Completed / Partial / Canceled / Refunded. On partial/canceled/
   refunded it refunds the unfilled portion (once, via an atomic status claim).
   Server-only; runs under the service role (cron or owner-triggered).
   ========================================================= */

// Provider-bound orders we still poll. We now reconcile every order with a
// provider order id so provider status changes can flow both ways.
const SYNCABLE_STATUSES: OrderStatus[] = [
  "pending",
  "processing",
  "in_progress",
  "partial",
  "completed",
  "canceled",
  "failed",
  "refunded",
  "duplicate",
];

const ACTIVE_STATUSES: OrderStatus[] = ["pending", "processing", "in_progress", "partial", "completed"];
const TERMINAL_STATUSES: OrderStatus[] = ["canceled", "failed", "refunded"];

function isInsufficientProviderBalance(msg?: string | null): boolean {
  if (!msg) return false;
  return /insufficient|not enough (funds|balance|money)|no (funds|balance)|low balance|top ?up|add funds/i.test(msg);
}

/** Map a provider's free-text status to our enum (null = unknown, leave as-is). */
export function mapProviderStatus(raw: string): OrderStatus | null {
  const s = (raw || "").toLowerCase();
  if (s.includes("progress")) return "in_progress";
  if (s.includes("submit")) return "processing";
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

type DupCandidate = {
  id: string;
  service_id: string;
  link: string;
  status: OrderStatus;
};

const DUP_SOURCE: OrderStatus[] = ["in_progress"];
const DUP_MUTABLE: OrderStatus[] = ["pending", "processing"];

type ServiceMeta = {
  id: string;
  name: string | null;
  platform: string | null;
  category_id: string | null;
};

type DupFingerprint = {
  link: string;
  serviceId: string;
  serviceName: string;
  category: string;
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

function normText(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

/**
 * Reconcile duplicates with a strict rule:
 * - Keep all `in_progress` orders untouched (already transferred to provider).
 * - Mark only `pending` / `processing` orders as `duplicate` when they match an
 *   existing `in_progress` order on the same link plus service ID, service name,
 *   or category.
 */
async function reconcileDuplicateOrders(admin: SupabaseClient, panelId: string): Promise<number> {
  const { data } = await admin
    .from("orders")
    .select("id, service_id, link, status")
    .eq("panel_id", panelId)
    .in("status", [...DUP_SOURCE, ...DUP_MUTABLE])
    .not("service_id", "is", null)
    .not("link", "is", null)
    .order("created_at", { ascending: true });

  const rows = (data as DupCandidate[] | null) ?? [];
  if (!rows.length) return 0;

  const serviceIds = [...new Set(rows.map((r) => r.service_id).filter(Boolean))];
  const { data: svcRows } = await admin
    .from("services")
    .select("id, name, platform, category_id")
    .in("id", serviceIds);
  const services = (svcRows as ServiceMeta[] | null) ?? [];
  const serviceById = new Map(services.map((s) => [s.id, s]));

  const categoryIds = [...new Set(services.map((s) => s.category_id).filter((v): v is string => !!v))];
  let categoryNameById = new Map<string, string>();
  if (categoryIds.length) {
    const { data: cats } = await admin.from("provider_categories").select("id, name").in("id", categoryIds);
    categoryNameById = new Map(((cats as Array<{ id: string; name: string }> | null) ?? []).map((c) => [c.id, c.name]));
  }

  const inProgress: DupFingerprint[] = [];
  const pendingOrProcessing: Array<{ id: string; fp: DupFingerprint }> = [];

  for (const r of rows) {
    const link = normalizeDupLink(r.link);
    if (!link) continue;
    const svc = serviceById.get(r.service_id);
    const categoryName = svc?.category_id ? (categoryNameById.get(svc.category_id) ?? "") : "";
    const fp: DupFingerprint = {
      link,
      serviceId: r.service_id,
      serviceName: normText(svc?.name),
      category: normText(categoryName),
    };

    if (DUP_SOURCE.includes(r.status)) {
      inProgress.push(fp);
      continue;
    }
    if (DUP_MUTABLE.includes(r.status)) {
      pendingOrProcessing.push({ id: r.id, fp });
    }
  }

  if (!inProgress.length || !pendingOrProcessing.length) return 0;

  const matchesInProgress = (cand: DupFingerprint): boolean =>
    inProgress.some((src) => {
      if (src.link !== cand.link) return false;
      if (src.serviceId === cand.serviceId) return true;
      if (src.serviceName && cand.serviceName && src.serviceName === cand.serviceName) return true;
      if (src.category && cand.category && src.category === cand.category) return true;
      return false;
    });

  const toDuplicate: string[] = [];
  for (const r of pendingOrProcessing) if (matchesInProgress(r.fp)) toDuplicate.push(r.id);

  if (!toDuplicate.length) return 0;

  let updated = 0;
  for (const id of toDuplicate) {
    const { data: claimed } = await admin
      .from("orders")
      .update({
        status: "duplicate",
        provider_response: { error: "Duplicated order", duplicate: true, synced: true },
      })
      .eq("id", id)
      .in("status", DUP_MUTABLE)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await admin.from("order_status_history").insert({
      order_id: id,
      status: "duplicate",
      note: "Duplicated order — not sent to the provider.",
    });
    updated++;
  }

  return updated;
}

/**
 * Older runs could leave orders in `failed` without refunding. Sweep them during
 * sync: refund normal failures, but move provider-balance failures into the held
 * pending state so they follow the 24h delayed refund rule.
 */
async function reconcileFailedOrders(admin: SupabaseClient, panelId: string): Promise<number> {
  const { data } = await admin
    .from("orders")
    .select("id, customer_id, charge, provider_response")
    .eq("panel_id", panelId)
    .eq("status", "failed");

  let updated = 0;
  for (const o of data ?? []) {
    const pr = (o.provider_response as { error?: string; held?: boolean; reason?: string } | null) ?? null;
    const reason = typeof pr?.error === "string" ? pr.error : "Provider marked the order failed";

    if (isInsufficientProviderBalance(reason)) {
      const nextResponse: Record<string, unknown> = {
        ...(pr as Record<string, unknown> | null ?? {}),
        held: true,
        reason: "provider_balance",
      };
      const { data: claimed } = await admin
        .from("orders")
        .update({ status: "pending", provider_response: nextResponse })
        .eq("id", o.id)
        .eq("status", "failed")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      await admin.from("order_status_history").insert({
        order_id: o.id,
        status: "pending",
        note: `Converted failed order to provider-balance hold. (${reason})`,
      });
      updated++;
      continue;
    }

    const { data: claimed } = await admin
      .from("orders")
      .update({ status: "refunded" })
      .eq("id", o.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    await admin.rpc("apply_balance_change", {
      p_customer: o.customer_id,
      p_amount: Number(o.charge),
      p_type: "refund",
      p_reason: `Order ${o.id} provider failed`,
    });
    await admin.from("order_status_history").insert({
      order_id: o.id,
      status: "refunded",
      note: `Auto-refunded failed order during sync. (${reason})`,
    });
    updated++;
  }

  return updated;
}

/**
 * Best-effort storefront snapshot refresh for every customer in a panel.
 * This bridges owner-triggered "Sync statuses" to customer storefront cache
 * so panel-side sync updates are immediately visible storefront-side.
 */
async function refreshPanelStorefrontSnapshots(admin: SupabaseClient, panelId: string): Promise<void> {
  const { data: panel } = await admin
    .from("panels")
    .select("id, status, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel) return;

  const apiEnabled = (() => {
    const settings = panel.settings;
    if (settings && typeof settings === "object") {
      const api = (settings as Record<string, unknown>).customerApi;
      if (api && typeof api === "object") {
        const enabled = (api as Record<string, unknown>).enabled;
        if (enabled === false) return false;
      }
    }
    return true;
  })();

  const { data: accounts } = await admin
    .from("customer_accounts")
    .select("id, user_id, status, balance, api_key_hash")
    .eq("panel_id", panelId);

  const list = (accounts as Array<{
    id: string;
    user_id: string;
    status: string;
    balance: number;
    api_key_hash: string | null;
  }> | null) ?? [];

  for (const acct of list) {
    try {
      const [{ data: depositsRaw }, { data: ordersRaw }] = await Promise.all([
        admin
          .from("payments")
          .select("id, amount, currency, status, method, created_at")
          .eq("panel_id", panelId)
          .eq("customer_id", acct.id)
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("orders")
          .select("id, local_id, service_id, link, quantity, charge, status, created_at, provider_response, provider_payload, services(name, local_id)")
          .eq("panel_id", panelId)
          .eq("customer_id", acct.id)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);

      const deposits = ((depositsRaw as Array<{
        id: string;
        amount: number;
        currency: string;
        status: string;
        method: string;
        created_at: string;
      }> | null) ?? []).map((d) => ({
        id: d.id,
        amount: Number(d.amount),
        currency: d.currency,
        status: d.status,
        method: d.method,
        createdAt: d.created_at,
      }));

      const orders = ((ordersRaw as Array<{
        id: string;
        local_id: number | null;
        service_id: string | null;
        link: string;
        quantity: number;
        charge: number;
        status: OrderStatus;
        created_at: string;
        provider_response: { held?: boolean; error?: string } | null;
        provider_payload: { comments?: string[] } | null;
        services: { name?: string; local_id?: number } | { name?: string; local_id?: number }[] | null;
      }> | null) ?? []).map((o) => {
        const svc = Array.isArray(o.services) ? o.services[0] : o.services;
        const held = o.provider_response?.held === true && o.status === "pending";
        const effectiveStatus = held ? "processing" : o.status;
        return {
          id: o.id,
          localId: o.local_id != null ? String(o.local_id) : String(o.id).slice(0, 8),
          serviceId: o.service_id,
          serviceNo: svc?.local_id ?? null,
          serviceName: svc?.name ?? "Service",
          link: o.link,
          quantity: o.quantity,
          charge: Number(o.charge),
          status: effectiveStatus,
          createdAt: o.created_at,
          failReason: ["failed", "canceled", "refunded"].includes(effectiveStatus)
            ? (o.provider_response?.error ?? null)
            : null,
          comments: Array.isArray(o.provider_payload?.comments) ? o.provider_payload!.comments : null,
          held,
        };
      });

      await admin
        .from("storefront_customer_snapshots")
        .upsert({
          customer_id: acct.id,
          panel_id: panelId,
          user_id: acct.user_id,
          balance: Number(acct.balance ?? 0),
          deposits,
          orders,
          api_enabled: apiEnabled,
          api_has_key: !!acct.api_key_hash,
          account_status: acct.status,
          panel_status: panel.status,
          updated_at: new Date().toISOString(),
        }, { onConflict: "customer_id" });
    } catch {
      // Keep order sync non-blocking even if snapshot materialization fails.
    }
  }
}

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
    const pr = o.provider_response as { held?: boolean; error?: string } | null;
    if (!pr || pr.held !== true) continue;
    // Atomically claim pending → refunded so only one run refunds.
    const { data: claimed } = await admin
      .from("orders").update({ status: "refunded" })
      .eq("id", o.id).eq("status", "pending").select("id").maybeSingle();
    if (!claimed) continue;
    await admin.rpc("apply_balance_change", {
      p_customer: o.customer_id,
      p_amount: Number(o.charge),
      p_type: "refund",
      p_reason: `Order ${o.id} auto-canceled — provider balance not funded within 24h`,
    });
    await admin.from("order_status_history").insert({
      order_id: o.id, status: "refunded", note: `Auto-refunded after 24h on hold (provider balance).${pr.error ? ` (${pr.error})` : ""}`,
    });
    canceled++;
  }
  return canceled;
}

/**
 * Settle Innvil's 5% platform commission for a panel. For every `completed`
 * order that hasn't been charged yet, deduct 5% of its charge from the panel's
 * Innvil balance (atomic + idempotent via orders.commission_amount). This is the
 * draw-down half of the billing loop that owner→Innvil top-ups (0016) fund.
 *
 * If the balance runs dry, a `live` panel is auto-moved to `inactive` (still
 * browsable, no new orders) and flagged `innvil_suspended` so a later top-up can
 * reactivate it. Returns how many orders were settled this pass.
 */
async function settlePanelCommission(admin: SupabaseClient, panelId: string): Promise<number> {
  const { data } = await admin
    .from("orders")
    .select("id")
    .eq("panel_id", panelId)
    .eq("status", "completed")
    .is("commission_amount", null)
    .limit(1000);

  let settled = 0;
  for (const r of (data as Array<{ id: string }> | null) ?? []) {
    const { error } = await admin.rpc("settle_order_commission", {
      p_order: r.id,
      p_rate: INNVIL_COMMISSION_RATE,
    });
    if (!error) settled++;
  }

  // Enforce the "out of Innvil credit" rule once the balance is up to date.
  const { data: panel } = await admin
    .from("panels")
    .select("status, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (panel && panel.status === "live") {
    const settings = (panel.settings && typeof panel.settings === "object")
      ? (panel.settings as Record<string, unknown>)
      : {};
    const balance = Number(settings.innvil_balance ?? 0);
    if (!(balance > 0)) {
      const { data: flipped } = await admin
        .from("panels")
        .update({ status: "inactive", settings: { ...settings, innvil_suspended: true } })
        .eq("id", panelId)
        .eq("status", "live")
        .select("id")
        .maybeSingle();
      if (flipped) {
        await admin.from("audit_logs").insert({
          panel_id: panelId,
          action: "panel.status_changed",
          meta: { from: "live", to: "inactive", by: "system", reason: "innvil_out_of_credit" },
        });
      }
    }
  }

  return settled;
}

/** Sync all open orders for one panel. Returns how many were checked/updated. */
export async function syncPanelOrders(
  admin: SupabaseClient,
  panelId: string
): Promise<{ checked: number; updated: number }> {
  // First, expire any orders held too long on insufficient provider balance.
  const expired = await expireHeldOrders(admin, panelId);
  const reconciledFailed = await reconcileFailedOrders(admin, panelId);
  const reconciledDupes = await reconcileDuplicateOrders(admin, panelId);

  const { data: orders } = await admin
    .from("orders")
    .select("id, provider_id, provider_order_id, status, quantity, charge, customer_id, remains")
    .eq("panel_id", panelId)
    .not("provider_order_id", "is", null)
    .not("provider_id", "is", null)
    .in("status", SYNCABLE_STATUSES);

  const list = (orders as OpenOrder[] | null) ?? [];
  if (!list.length) {
    await settlePanelCommission(admin, panelId);
    await refreshPanelStorefrontSnapshots(admin, panelId);
    return { checked: 0, updated: expired + reconciledFailed + reconciledDupes };
  }

  // Group by provider (each has its own credentials).
  const byProvider = new Map<string, OpenOrder[]>();
  for (const o of list) {
    (byProvider.get(o.provider_id) ?? byProvider.set(o.provider_id, []).get(o.provider_id)!).push(o);
  }

  const providerResults = await Promise.all([...byProvider.entries()].map(async ([providerId, group]) => {
    const { data: prov } = await admin
      .from("providers")
      .select("api_url")
      .eq("id", providerId)
      .maybeSingle();
    if (!prov) return 0;

    let creds;
    try {
      creds = await getProviderCredentials(providerId, prov.api_url as string);
    } catch {
      return 0; // key missing/unreadable — skip this provider this run
    }

    const byProviderOrderId = new Map(group.map((o) => [String(o.provider_order_id), o]));
    let providerUpdated = 0;
    for (const ids of chunk([...byProviderOrderId.keys()], 100)) {
      let resp;
      try {
        resp = await getMultiStatus(creds, ids);
      } catch {
        continue; // provider unreachable — try again next run
      }

      for (const [pid, st] of Object.entries(resp)) {
        const o = byProviderOrderId.get(pid);
        if (!o || !st) continue;

        if ("error" in st) {
          const reason = String(st.error || "Provider returned a status error");
          if (isInsufficientProviderBalance(reason)) continue;
          const { data: claimed } = await admin
            .from("orders")
            .update({
              status: "refunded",
              provider_response: { error: reason, synced: true },
            })
            .eq("id", o.id)
            .eq("status", o.status)
            .select("id")
            .maybeSingle();
          if (!claimed) continue;
          await admin.rpc("apply_balance_change", {
            p_customer: o.customer_id,
            p_amount: Number(o.charge),
            p_type: "refund",
            p_reason: `Order ${o.id} provider status error`,
          });
          await admin
            .from("order_status_history")
            .insert({ order_id: o.id, status: "refunded", note: `Provider status error — auto-refunded. (${reason})` });
          providerUpdated++;
          continue;
        }

        const next = mapProviderStatus(st.status);
        if (!next || next === o.status) continue;

        const finalStatus: OrderStatus = next === "failed" ? "refunded" : next;
  const fromTerminal = TERMINAL_STATUSES.includes(o.status);
  const toActive = ACTIVE_STATUSES.includes(finalStatus);
        const toTerminal = TERMINAL_STATUSES.includes(finalStatus);

        const remains = Number(st.remains);
        const startCount = Number(st.start_count);

        // Atomically claim the transition so overlapping runs can't double-refund.
        const { data: claimed } = await admin
          .from("orders")
          .update({
            status: finalStatus,
            remains: Number.isFinite(remains) ? remains : o.remains,
            start_count: Number.isFinite(startCount) ? startCount : null,
            provider_response: st as unknown as Record<string, unknown>,
          })
          .eq("id", o.id)
          .eq("status", o.status)
          .select("id")
          .maybeSingle();
        if (!claimed) continue; // another run handled it

        // If the provider reopened a previously canceled/refunded order, put the
        // charge back onto the customer balance before applying any terminal refund.
        if (fromTerminal && toActive) {
          await admin.rpc("apply_balance_change", {
            p_customer: o.customer_id,
            p_amount: -Number(o.charge),
            p_type: "order",
            p_reason: `Order ${o.id} reopened by provider status sync`,
          });
        }

        // Refund the unfilled portion once when moving from an active state into a
        // terminal state. If the provider flips between terminal states, keep the
        // balance unchanged.
        if (!fromTerminal && toTerminal) {
          let refund = 0;
          if (finalStatus === "refunded") {
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

        if (fromTerminal && finalStatus === "partial") {
          // A reopened order can come back as partial. Net effect should be the
          // fulfilled portion, so we restore the charge and then refund the unfilled
          // remainder using the provider's latest remains value.
          let refund = 0;
          if (Number.isFinite(remains) && remains > 0 && o.quantity > 0) {
            refund = round4(Number(o.charge) * Math.min(remains / o.quantity, 1));
          }
          if (refund > 0) {
            await admin.rpc("apply_balance_change", {
              p_customer: o.customer_id,
              p_amount: refund,
              p_type: "refund",
              p_reason: `Order ${o.id} partial after reopen`,
            });
          }
        }

        await admin
          .from("order_status_history")
          .insert({
            order_id: o.id,
            status: finalStatus,
            note: fromTerminal && toActive
              ? "Provider reopened the order — customer balance re-deducted and status synced."
              : next === "failed"
                ? "Provider marked the order failed — auto-refunded."
                : "Synced from provider",
          });
        providerUpdated++;
      }
    }
    return providerUpdated;
  }));

  const updated = providerResults.reduce((sum, value) => sum + value, 0);

  // Settle commission after this pass's completions land, then materialize snapshots
  // (so any auto-inactive from a drained balance is reflected storefront-side).
  await settlePanelCommission(admin, panelId);
  await refreshPanelStorefrontSnapshots(admin, panelId);

  return { checked: list.length, updated: updated + expired + reconciledFailed + reconciledDupes };
}

/** Sync open orders across every panel that has any. Used by the cron. */
export async function syncAllOpenOrders(): Promise<{ panels: number; checked: number; updated: number }> {
  const admin = createAdminClient();
  // Any panel with a provider-bound order needs a pass so both active and
  // terminal statuses can be reconciled against the provider.
  const { data } = await admin
    .from("orders")
    .select("panel_id")
    .not("provider_order_id", "is", null)
    .not("provider_id", "is", null);

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
