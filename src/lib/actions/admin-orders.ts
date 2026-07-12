"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getProviderCredentials, addOrder, refillOrder, cancelOrders, ProviderError,
} from "@/src/lib/providers";
import { round4 } from "@/src/lib/money";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   §5 ADMIN ORDERS (owner-facing)
   Real order list, per-order actions (resend / refill / cancel / mark completed /
   refund), and the Overview stats. Owner-auth + ownership enforced in code via the
   service-role client. Provider cost/profit ARE shown here (owner-only), never to
   customers.
   ========================================================= */

type Result = { ok: true } | { ok: false; error: string };
type AuthorizedOrderResult =
  | { error: string }
  | {
      admin: SupabaseClient;
      order: {
        id: string;
        panel_id: string | null;
        customer_id: string | null;
        service_id: string | null;
        provider_id: string | null;
        provider_order_id: string | null;
        link: string | null;
        quantity: number | null;
        charge: number | null;
        remains: number | null;
        status: OrderStatus;
        provider_payload: unknown;
      };
    };

async function ownsPanel(admin: SupabaseClient, userId: string, panelId: string): Promise<boolean> {
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

/** Load an order and confirm the signed-in user owns its panel. */
async function authorizeOrder(orderId: string): Promise<AuthorizedOrderResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { error: "Not signed in" };
  const { data: order } = await admin
    .from("orders")
    .select("id, panel_id, customer_id, service_id, provider_id, provider_order_id, link, quantity, charge, remains, status, provider_payload")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { error: "Order not found" };
  if (!(await ownsPanel(admin, user.id, order.panel_id as string))) return { error: "Not authorized" };
  return { admin, order };
}

async function addHistory(admin: SupabaseClient, orderId: string, status: OrderStatus, note?: string) {
  await admin.from("order_status_history").insert({ order_id: orderId, status, note: note ?? null });
}

export interface AdminOrderVM {
  id: string;
  shortId: string;
  serviceName: string;
  customerEmail: string | null;
  link: string;
  quantity: number;
  charge: number;
  providerCost: number;
  profit: number;
  status: OrderStatus;
  providerOrderId: string | null;
  remains: number | null;
  createdAt: string;
}

interface OrderRow {
  id: string;
  panel_id?: string;
  service_id: string | null;
  customer_id: string;
  link: string;
  quantity: number;
  charge: number;
  provider_cost: number | null;
  profit: number | null;
  status: OrderStatus;
  provider_order_id: string | null;
  remains: number | null;
  created_at: string;
  services: { name?: string } | { name?: string }[] | null;
  customer_accounts: { user_id?: string } | { user_id?: string }[] | null;
}

function one<T>(v: T | T[] | null): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined;
}

/** Map a joined order row + resolved emails to the admin view-model. */
function mapOrderRow(r: OrderRow, emails: Map<string, string | null>): AdminOrderVM {
  return {
    id: r.id,
    shortId: String(r.id).slice(0, 8),
    serviceName: one(r.services)?.name ?? "Service",
    customerEmail: emails.get(one(r.customer_accounts)?.user_id ?? "") ?? null,
    link: r.link,
    quantity: r.quantity,
    charge: Number(r.charge),
    providerCost: Number(r.provider_cost ?? 0),
    profit: Number(r.profit ?? 0),
    status: r.status,
    providerOrderId: r.provider_order_id,
    remains: r.remains,
    createdAt: r.created_at,
  };
}

/** Resolve emails for a set of customer_accounts user_ids (best-effort, batched). */
async function resolveEmails(admin: SupabaseClient, userIds: string[]): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (const uid of [...new Set(userIds)]) {
    try {
      const { data } = await admin.auth.admin.getUserById(uid);
      map.set(uid, data.user?.email ?? null);
    } catch {
      map.set(uid, null);
    }
  }
  return map;
}

/** All orders on a panel the owner controls (newest first). Owner-only fields incl. */
export async function listPanelOrders(
  panelId: string,
  opts?: { status?: OrderStatus | "all"; limit?: number }
): Promise<AdminOrderVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];

  const base = admin
    .from("orders")
    .select("id, service_id, customer_id, link, quantity, charge, provider_cost, profit, status, provider_order_id, remains, created_at, services(name), customer_accounts(user_id)")
    .eq("panel_id", panelId);
  const filtered = opts?.status && opts.status !== "all" ? base.eq("status", opts.status) : base;

  const { data } = await filtered
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  const rows = (data as OrderRow[] | null) ?? [];
  const emails = await resolveEmails(admin, rows.map((r) => one(r.customer_accounts)?.user_id ?? "").filter(Boolean));
  return rows.map((r) => mapOrderRow(r, emails));
}

export interface OwnerOrderVM extends AdminOrderVM {
  panelId: string;
  panelName: string;
}

/** Orders across ALL panels the owner controls (for the app-level Orders page). */
export async function listAllOwnerOrders(limit = 200): Promise<OwnerOrderVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data: panels } = await admin.from("panels").select("id, name").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string }> | null) ?? [];
  if (!list.length) return [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));

  const { data } = await admin
    .from("orders")
    .select("id, panel_id, service_id, customer_id, link, quantity, charge, provider_cost, profit, status, provider_order_id, remains, created_at, services(name), customer_accounts(user_id)")
    .in("panel_id", list.map((p) => p.id))
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data as OrderRow[] | null) ?? [];
  const emails = await resolveEmails(admin, rows.map((r) => one(r.customer_accounts)?.user_id ?? "").filter(Boolean));
  return rows.map((r) => ({
    ...mapOrderRow(r, emails),
    panelId: r.panel_id ?? "",
    panelName: nameById.get(r.panel_id ?? "") ?? "Panel",
  }));
}

export interface OwnerBillingSummary {
  innvilBalance: number;
  revenueToday: number;
  profitToday: number;
  commissionToday: number; // 5% of today's panel-price revenue (estimate)
  ordersToday: number;
  panels: number;
  perPanel: Array<{ panelId: string; panelName: string; revenueToday: number; commissionToday: number; innvilBalance: number }>;
}

const COMMISSION_RATE = 0.05;

/** Real cross-panel revenue + a 5% commission estimate for the Billing page. */
export async function getOwnerBillingSummary(): Promise<OwnerBillingSummary> {
  const empty: OwnerBillingSummary = { innvilBalance: 0, revenueToday: 0, profitToday: 0, commissionToday: 0, ordersToday: 0, panels: 0, perPanel: [] };
  const { user, admin } = await getAuthedAdmin();
  if (!user) return empty;
  const { data: panels } = await admin.from("panels").select("id, name, settings").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string; settings: Record<string, unknown> | null }> | null) ?? [];
  if (!list.length) return empty;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const { data: orders } = await admin
    .from("orders")
    .select("panel_id, charge, profit, status")
    .in("panel_id", list.map((p) => p.id))
    .gte("created_at", startOfToday.toISOString());

  const perPanel = new Map<string, { revenueToday: number }>();
  let revenueToday = 0, profitToday = 0, ordersToday = 0;
  for (const o of (orders as Array<{ panel_id: string; charge: number; profit: number | null; status: OrderStatus }> | null) ?? []) {
    ordersToday++;
    if (o.status === "refunded") continue;
    revenueToday += Number(o.charge);
    profitToday += Number(o.profit ?? 0);
    const p = perPanel.get(o.panel_id) ?? { revenueToday: 0 };
    p.revenueToday += Number(o.charge);
    perPanel.set(o.panel_id, p);
  }

  const panelBalances = new Map<string, number>();
  let innvilBalance = 0;
  for (const p of list) {
    const settings = (p.settings && typeof p.settings === "object") ? p.settings : {};
    const balance = Number((settings as Record<string, unknown>).innvil_balance ?? 0);
    const safe = Number.isFinite(balance) ? round4(balance) : 0;
    panelBalances.set(p.id, safe);
    innvilBalance += safe;
  }

  return {
    innvilBalance: round4(innvilBalance),
    revenueToday: round4(revenueToday),
    profitToday: round4(profitToday),
    commissionToday: round4(revenueToday * COMMISSION_RATE),
    ordersToday,
    panels: list.length,
    perPanel: list.map((p) => ({
      panelId: p.id,
      panelName: p.name,
      revenueToday: round4(perPanel.get(p.id)?.revenueToday ?? 0),
      commissionToday: round4((perPanel.get(p.id)?.revenueToday ?? 0) * COMMISSION_RATE),
      innvilBalance: panelBalances.get(p.id) ?? 0,
    })),
  };
}

export interface OwnerReceipt {
  from: string; // ISO
  to: string;   // ISO
  topUps: number;   // total customer top-ups (completed deposits) in the period
  apiCost: number;  // total provider/API cost of orders in the period
  profit: number;   // topUps - apiCost
  depositCount: number;
  orderCount: number;
  perPanel: Array<{ panelName: string; topUps: number; apiCost: number; profit: number }>;
}

/**
 * A period earnings receipt for the owner: total customer top-ups minus the API
 * (provider) cost of orders placed in the window = profit. `fromISO`/`toISO` are
 * the inclusive day boundaries (start-of-day → end-of-day) chosen by the owner.
 */
export async function getOwnerReceipt(fromISO: string, toISO: string): Promise<OwnerReceipt> {
  const empty: OwnerReceipt = { from: fromISO, to: toISO, topUps: 0, apiCost: 0, profit: 0, depositCount: 0, orderCount: 0, perPanel: [] };
  const { user, admin } = await getAuthedAdmin();
  if (!user) return empty;
  const { data: panels } = await admin.from("panels").select("id, name").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string }> | null) ?? [];
  if (!list.length) return empty;
  const nameById = new Map(list.map((p) => [p.id, p.name]));
  const ids = list.map((p) => p.id);

  const [{ data: deposits }, { data: orders }] = await Promise.all([
    admin.from("payments").select("panel_id, amount, status, created_at")
      .in("panel_id", ids).eq("status", "completed").gte("created_at", fromISO).lte("created_at", toISO),
    admin.from("orders").select("panel_id, provider_cost, status, created_at")
      .in("panel_id", ids).gte("created_at", fromISO).lte("created_at", toISO),
  ]);

  const per = new Map<string, { topUps: number; apiCost: number }>();
  const get = (pid: string) => per.get(pid) ?? per.set(pid, { topUps: 0, apiCost: 0 }).get(pid)!;

  let topUps = 0, apiCost = 0, depositCount = 0, orderCount = 0;
  for (const d of (deposits as Array<{ panel_id: string; amount: number }> | null) ?? []) {
    depositCount++;
    topUps += Number(d.amount);
    get(d.panel_id).topUps += Number(d.amount);
  }
  for (const o of (orders as Array<{ panel_id: string; provider_cost: number | null; status: OrderStatus }> | null) ?? []) {
    if (o.status === "refunded" || o.status === "failed") continue; // not fulfilled → no API cost counted
    orderCount++;
    apiCost += Number(o.provider_cost ?? 0);
    get(o.panel_id).apiCost += Number(o.provider_cost ?? 0);
  }

  return {
    from: fromISO, to: toISO,
    topUps: round4(topUps), apiCost: round4(apiCost), profit: round4(topUps - apiCost),
    depositCount, orderCount,
    perPanel: list.map((p) => {
      const v = per.get(p.id) ?? { topUps: 0, apiCost: 0 };
      return { panelName: nameById.get(p.id) ?? "Panel", topUps: round4(v.topUps), apiCost: round4(v.apiCost), profit: round4(v.topUps - v.apiCost) };
    }).filter((p) => p.topUps > 0 || p.apiCost > 0),
  };
}

export interface PanelOverview {
  currency: string;
  revenueToday: number;
  profitToday: number;
  ordersToday: number;
  pendingOrders: number;
  customers: number;
  activeServices: number;
  recent: AdminOrderVM[];
}

const OPEN: OrderStatus[] = ["pending", "processing", "in_progress"];

/** Dashboard stats for the Overview tab. */
export async function getPanelOverview(panelId: string): Promise<PanelOverview | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  if (!(await ownsPanel(admin, user.id, panelId))) return null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayIso = startOfToday.toISOString();

  const [{ data: panel }, { data: todays }, { count: pendingOrders }, { count: customers }, { count: activeServices }, recent] = await Promise.all([
    admin.from("panels").select("settings").eq("id", panelId).maybeSingle(),
    admin.from("orders").select("charge, profit, status").eq("panel_id", panelId).gte("created_at", todayIso),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId).in("status", OPEN),
    admin.from("customer_accounts").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
    admin.from("services").select("id", { count: "exact", head: true }).eq("panel_id", panelId).eq("status", "active"),
    listPanelOrders(panelId, { limit: 6 }),
  ]);

  let revenueToday = 0;
  let profitToday = 0;
  let ordersToday = 0;
  for (const o of (todays as Array<{ charge: number; profit: number | null; status: OrderStatus }> | null) ?? []) {
    ordersToday++;
    if (o.status !== "refunded") {
      revenueToday += Number(o.charge);
      profitToday += Number(o.profit ?? 0);
    }
  }

  const settings = panel?.settings as { currency?: string } | null;
  return {
    currency: (settings?.currency ?? "USD").toString().toUpperCase(),
    revenueToday: round4(revenueToday),
    profitToday: round4(profitToday),
    ordersToday,
    pendingOrders: pendingOrders ?? 0,
    customers: customers ?? 0,
    activeServices: activeServices ?? 0,
    recent,
  };
}

/** The panel's operating currency (owner-auth). */
export async function getPanelCurrency(panelId: string): Promise<string> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return "USD";
  const { data } = await admin.from("panels").select("settings, owner_id").eq("id", panelId).maybeSingle();
  if (!data || data.owner_id !== user.id) return "USD";
  const s = data.settings as { currency?: string } | null;
  return (s?.currency ?? "USD").toString().toUpperCase();
}

/* ---------------- Per-order owner actions ---------------- */

/** Resend a still-pending order to its mapped provider (e.g. after fixing mapping). */
export async function resendOrder(orderId: string): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;
  if (order.status !== "pending") return { ok: false, error: "Only pending orders can be resent." };
  if (!order.provider_id || order.provider_order_id) return { ok: false, error: "This order has no provider mapping to resend to." };

  const { data: svc } = await admin
    .from("services")
    .select("provider_service_id")
    .eq("id", order.service_id as string)
    .maybeSingle();
  const { data: prov } = await admin
    .from("providers")
    .select("api_url")
    .eq("id", order.provider_id as string)
    .maybeSingle();
  if (!svc?.provider_service_id || !prov) return { ok: false, error: "Provider or service mapping is missing." };

  const payload = (order.provider_payload as { runs?: number; interval?: number } | null) ?? {};
  try {
    const creds = await getProviderCredentials(order.provider_id as string, prov.api_url as string);
    const resp = await addOrder(creds, {
      service: svc.provider_service_id,
      link: order.link as string,
      quantity: order.quantity as number,
      ...(payload.runs != null ? { runs: payload.runs } : {}),
      ...(payload.interval != null ? { interval: payload.interval } : {}),
    });
    if ("order" in resp) {
      await admin.from("orders").update({
        provider_order_id: String(resp.order),
        status: "processing",
        provider_response: resp as Record<string, unknown>,
      }).eq("id", order.id);
      await addHistory(admin, order.id as string, "processing", "Resent to provider by owner");
      return { ok: true };
    }
    return { ok: false, error: resp.error || "Provider rejected the order." };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error" };
  }
}

/** Ask the provider to refill a completed/partial order. */
export async function requestRefill(orderId: string): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;
  if (!order.provider_id || !order.provider_order_id) return { ok: false, error: "No provider order to refill." };
  const { data: prov } = await admin.from("providers").select("api_url").eq("id", order.provider_id as string).maybeSingle();
  if (!prov) return { ok: false, error: "Provider unavailable." };
  try {
    const creds = await getProviderCredentials(order.provider_id as string, prov.api_url as string);
    const resp = (await refillOrder(creds, order.provider_order_id as string)) as Record<string, unknown>;
    if (resp && "error" in resp && resp.error) return { ok: false, error: String(resp.error) };
    await addHistory(admin, order.id as string, order.status as OrderStatus, "Refill requested by owner");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error" };
  }
}

/** Ask the provider to cancel an open order. Status settles via the sync engine. */
export async function requestCancel(orderId: string): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;
  if (!order.provider_id || !order.provider_order_id) return { ok: false, error: "No provider order to cancel." };
  const { data: prov } = await admin.from("providers").select("api_url").eq("id", order.provider_id as string).maybeSingle();
  if (!prov) return { ok: false, error: "Provider unavailable." };
  try {
    const creds = await getProviderCredentials(order.provider_id as string, prov.api_url as string);
    const resp = (await cancelOrders(creds, [order.provider_order_id as string])) as unknown;
    const first = Array.isArray(resp) ? (resp[0] as Record<string, unknown>) : (resp as Record<string, unknown>);
    if (first && "error" in first && first.error) return { ok: false, error: String(first.error) };
    await addHistory(admin, order.id as string, order.status as OrderStatus, "Cancel requested by owner");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error" };
  }
}

/** Manually mark an order completed (e.g. fulfilled off-platform). */
export async function markOrderCompleted(orderId: string): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;
  const { error } = await admin.from("orders").update({ status: "completed" }).eq("id", order.id);
  if (error) return { ok: false, error: error.message };
  await addHistory(admin, order.id as string, "completed", "Marked completed by owner");
  return { ok: true };
}

/**
 * Manually refund an order (full charge if amount omitted, else a partial amount).
 * Credits the customer's wallet and marks the order refunded.
 */
export async function refundOrder(orderId: string, amount?: number): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;
  if (order.status === "refunded") return { ok: false, error: "This order was already refunded." };

  const full = Number(order.charge);
  const refund = amount != null ? round4(Math.min(Math.max(amount, 0), full)) : full;
  if (refund <= 0) return { ok: false, error: "Refund amount must be greater than zero." };

  const { error: balErr } = await admin.rpc("apply_balance_change", {
    p_customer: order.customer_id,
    p_amount: refund,
    p_type: "refund",
    p_reason: `Order ${order.id} refunded by owner`,
    p_ref_order: order.id,
  });
  if (balErr) return { ok: false, error: balErr.message };

  await admin.from("orders").update({ status: "refunded" }).eq("id", order.id);
  await addHistory(admin, order.id as string, "refunded", `Refunded ${refund} by owner`);
  return { ok: true };
}
