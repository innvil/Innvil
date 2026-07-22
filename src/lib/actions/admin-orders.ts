"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getProviderCredentials, addOrder, refillOrder, cancelOrders, getBalance, ProviderError,
} from "@/src/lib/providers";
import { round4, INNVIL_COMMISSION_RATE } from "@/src/lib/money";
import { syncPanelOrders } from "@/src/lib/orders/sync";
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

async function submitPendingOrderToProvider(
  admin: SupabaseClient,
  order: {
    id: string;
    service_id: string | null;
    provider_id: string | null;
    provider_order_id: string | null;
    link: string | null;
    quantity: number | null;
    provider_payload: unknown;
  },
  historyNote: string
): Promise<Result> {
  if (!order.provider_id || order.provider_order_id) {
    return { ok: false, error: "This order has no provider mapping to resend to." };
  }

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
  if (!svc?.provider_service_id || !prov) {
    return { ok: false, error: "Provider or service mapping is missing." };
  }

  const payload = (order.provider_payload as { runs?: number; interval?: number; comments?: string[] } | null) ?? {};
  const comments = Array.isArray(payload.comments) ? payload.comments : null;
  try {
    const creds = await getProviderCredentials(order.provider_id as string, prov.api_url as string);
    const resp = await addOrder(creds, {
      service: svc.provider_service_id,
      link: order.link as string,
      quantity: order.quantity as number,
      ...(payload.runs != null ? { runs: payload.runs } : {}),
      ...(payload.interval != null ? { interval: payload.interval } : {}),
      ...(comments && comments.length ? { comments: comments.join("\n") } : {}),
    });
    if (!("order" in resp)) {
      return { ok: false, error: resp.error || "Provider rejected the order." };
    }
    await admin.from("orders").update({
      provider_order_id: String(resp.order),
      status: "processing",
      provider_response: resp as Record<string, unknown>,
    }).eq("id", order.id);
    await addHistory(admin, order.id, "processing", historyNote);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ProviderError ? e.message : e instanceof Error ? e.message : "Provider error" };
  }
}

export interface AdminOrderVM {
  id: string;
  shortId: string;
  orderNo: number | null; // per-panel sequential order number (local_id)
  serviceName: string;
  serviceNo: number | null; // the service's own number (services.local_id)
  customerAccountId: string;
  customerUserId: string | null;
  providerName: string | null;
  providerLink: string | null;
  customerUsername: string | null;
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
  /** True when the order is pending because the PROVIDER's balance was insufficient. */
  held: boolean;
  /** Provider failure reason (from the provider API response), if any. */
  failReason: string | null;
  /** Custom Comments, if this was a comments order. */
  comments: string[] | null;
}

export interface AdminOrderPage {
  rows: AdminOrderVM[];
  hasNext: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  allCount: number;
}

interface OrderRow {
  id: string;
  panel_id?: string;
  local_id: number | null;
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
  provider_response: { held?: boolean; error?: string } | null;
  provider_payload: { comments?: string[] } | null;
  providers: { name?: string; api_url?: string } | { name?: string; api_url?: string }[] | null;
  services: { name?: string; local_id?: number } | { name?: string; local_id?: number }[] | null;
  customer_accounts: { user_id?: string } | { user_id?: string }[] | null;
}

function one<T>(v: T | T[] | null): T | undefined {
  return Array.isArray(v) ? v[0] : v ?? undefined;
}

const FAILED_STATES: OrderStatus[] = ["failed", "canceled", "refunded"];

function providerBaseUrl(apiUrl: string | null | undefined): string | null {
  if (!apiUrl) return null;
  const trimmed = apiUrl.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/api\/v2\/?$/i, "");
}

/** Map a joined order row + resolved customer identity to the admin view-model. */
function mapOrderRow(
  r: OrderRow,
  profiles: Map<string, { displayName: string | null; email: string | null }>
): AdminOrderVM {
  const prov = one(r.providers);
  const svc = one(r.services);
  const err = typeof r.provider_response?.error === "string" ? r.provider_response.error : null;
  const who = profiles.get(one(r.customer_accounts)?.user_id ?? "");
  return {
    id: r.id,
    shortId: String(r.id).slice(0, 8),
    orderNo: r.local_id,
    serviceName: svc?.name ?? "Service",
    serviceNo: svc?.local_id ?? null,
    customerAccountId: r.customer_id,
    customerUserId: one(r.customer_accounts)?.user_id ?? null,
    providerName: prov?.name ?? null,
    providerLink: providerBaseUrl(prov?.api_url),
    customerUsername: who?.displayName ?? null,
    customerEmail: who?.email ?? null,
    link: r.link,
    quantity: r.quantity,
    charge: Number(r.charge),
    providerCost: Number(r.provider_cost ?? 0),
    profit: Number(r.profit ?? 0),
    status: r.status,
    providerOrderId: r.provider_order_id,
    remains: r.remains,
    createdAt: r.created_at,
    held: r.provider_response?.held === true && r.status === "pending",
    failReason: (FAILED_STATES.includes(r.status) || (r.provider_response?.held === true && r.status === "pending")) ? err : null,
    comments: Array.isArray(r.provider_payload?.comments) ? r.provider_payload!.comments : null,
  };
}

/** Resolve profile display names (and best-effort emails) for customer user IDs. */
async function resolveCustomerIdentity(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, { displayName: string | null; email: string | null }>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, { displayName: string | null; email: string | null }>();
  if (ids.length === 0) return map;

  const { data: prof } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", ids);
  for (const p of prof ?? []) {
    map.set(p.id as string, { displayName: (p.display_name as string | null) ?? null, email: null });
  }

  for (const uid of ids) {
    if (!map.has(uid)) map.set(uid, { displayName: null, email: null });
  }
  return map;
}

/** All orders on a panel the owner controls (newest first). Owner-only fields incl. */
export async function listPanelOrders(
  panelId: string,
  opts?: { status?: OrderStatus | "all"; limit?: number; sync?: boolean }
): Promise<AdminOrderVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(admin, user.id, panelId))) return [];

  // Optional sync only: never block normal table loads on provider/network latency.
  if (opts?.sync) {
    try { await syncPanelOrders(admin, panelId); } catch { /* best-effort */ }
  }

  const base = admin
    .from("orders")
    .select("id, local_id, service_id, customer_id, link, quantity, charge, provider_cost, profit, status, provider_order_id, remains, created_at, provider_response, provider_payload, providers(name, api_url), services(name, local_id), customer_accounts(user_id)")
    .eq("panel_id", panelId);
  const filtered = opts?.status && opts.status !== "all" ? base.eq("status", opts.status) : base;

  const { data } = await filtered
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 200);
  const rows = (data as OrderRow[] | null) ?? [];
  const profiles = await resolveCustomerIdentity(admin, rows.map((r) => one(r.customer_accounts)?.user_id ?? "").filter(Boolean));
  return rows.map((r) => mapOrderRow(r, profiles));
}

/** Paged orders on a panel the owner controls. Fetches one extra row to derive hasNext cheaply. */
export async function listPanelOrdersPage(
  panelId: string,
  opts?: { status?: OrderStatus | "all"; page?: number; pageSize?: number; sync?: boolean }
): Promise<AdminOrderPage> {
  const empty: AdminOrderPage = {
    rows: [],
    hasNext: false,
    page: Math.max(0, opts?.page ?? 0),
    pageSize: Math.max(1, opts?.pageSize ?? 20),
    totalCount: 0,
    allCount: 0,
  };
  const { user, admin } = await getAuthedAdmin();
  if (!user) return empty;
  if (!(await ownsPanel(admin, user.id, panelId))) return empty;

  if (opts?.sync) {
    try { await syncPanelOrders(admin, panelId); } catch { /* best-effort */ }
  }

  const page = Math.max(0, opts?.page ?? 0);
  const pageSize = Math.max(1, opts?.pageSize ?? 20);
  const from = page * pageSize;
  const to = from + pageSize;

  const base = admin
    .from("orders")
    .select("id, local_id, service_id, customer_id, link, quantity, charge, provider_cost, profit, status, provider_order_id, remains, created_at, provider_response, provider_payload, providers(name, api_url), services(name, local_id), customer_accounts(user_id)")
    .eq("panel_id", panelId);
  const filtered = opts?.status && opts.status !== "all" ? base.eq("status", opts.status) : base;

  const [pageRes, filteredCountRes, allCountRes] = await Promise.all([
    filtered.order("created_at", { ascending: false }).range(from, to),
    (opts?.status && opts.status !== "all"
      ? admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId).eq("status", opts.status)
      : admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId)),
    admin.from("orders").select("id", { count: "exact", head: true }).eq("panel_id", panelId),
  ]);

  const data = pageRes.data;
  const fetched = (data as OrderRow[] | null) ?? [];
  const hasNext = fetched.length > pageSize;
  const rows = hasNext ? fetched.slice(0, pageSize) : fetched;
  const profiles = await resolveCustomerIdentity(admin, rows.map((r) => one(r.customer_accounts)?.user_id ?? "").filter(Boolean));

  return {
    rows: rows.map((r) => mapOrderRow(r, profiles)),
    hasNext,
    page,
    pageSize,
    totalCount: filteredCountRes.count ?? 0,
    allCount: allCountRes.count ?? 0,
  };
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
    .select("id, panel_id, local_id, service_id, customer_id, link, quantity, charge, provider_cost, profit, status, provider_order_id, remains, created_at, provider_response, provider_payload, providers(name, api_url), services(name, local_id), customer_accounts(user_id)")
    .in("panel_id", list.map((p) => p.id))
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (data as OrderRow[] | null) ?? [];
  const profiles = await resolveCustomerIdentity(admin, rows.map((r) => one(r.customer_accounts)?.user_id ?? "").filter(Boolean));
  return rows.map((r) => ({
    ...mapOrderRow(r, profiles),
    panelId: r.panel_id ?? "",
    panelName: nameById.get(r.panel_id ?? "") ?? "Panel",
  }));
}

export interface OwnerBillingSummary {
  innvilBalance: number;
  revenueToday: number;
  profitToday: number;
  commissionToday: number; // 5% of today's panel-price revenue (estimate)
  commissionCharged: number; // lifetime commission actually settled off innvil_balance (sum of orders.commission_amount)
  ordersToday: number;
  panels: number;
  perPanel: Array<{ panelId: string; panelName: string; revenueToday: number; commissionToday: number; commissionCharged: number; innvilBalance: number }>;
}

const COMMISSION_RATE = INNVIL_COMMISSION_RATE;

/** Real cross-panel revenue + a 5% commission estimate for the Billing page. */
export async function getOwnerBillingSummary(): Promise<OwnerBillingSummary> {
  const empty: OwnerBillingSummary = { innvilBalance: 0, revenueToday: 0, profitToday: 0, commissionToday: 0, commissionCharged: 0, ordersToday: 0, panels: 0, perPanel: [] };
  const { user, admin } = await getAuthedAdmin();
  if (!user) return empty;
  const { data: panels } = await admin.from("panels").select("id, name, settings").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string; settings: Record<string, unknown> | null }> | null) ?? [];
  if (!list.length) return empty;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const panelIds = list.map((p) => p.id);
  const [{ data: orders }, { data: refundTx }, { data: settledRows }] = await Promise.all([
    admin.from("orders").select("panel_id, charge, profit, status").in("panel_id", panelIds).gte("created_at", startOfToday.toISOString()),
    admin.from("balance_transactions").select("panel_id, amount").in("panel_id", panelIds).eq("type", "refund").gte("created_at", startOfToday.toISOString()),
    // Lifetime commission actually settled off innvil_balance (0017). Degrades to 0 if the column isn't there yet.
    admin.from("orders").select("panel_id, commission_amount").in("panel_id", panelIds).not("commission_amount", "is", null),
  ]);

  // Sum settled commission per panel + overall.
  const commissionByPanel = new Map<string, number>();
  let commissionCharged = 0;
  for (const r of (settledRows as Array<{ panel_id: string; commission_amount: number }> | null) ?? []) {
    const amt = Number(r.commission_amount) || 0;
    commissionByPanel.set(r.panel_id, (commissionByPanel.get(r.panel_id) ?? 0) + amt);
    commissionCharged += amt;
  }

  // Refunds today per panel (credits back to customers) — subtracted from revenue.
  const refundByPanel = new Map<string, number>();
  for (const t of (refundTx as Array<{ panel_id: string; amount: number }> | null) ?? []) {
    refundByPanel.set(t.panel_id, (refundByPanel.get(t.panel_id) ?? 0) + Number(t.amount));
  }

  // Gross charges per panel (all orders); net revenue = gross − refunds.
  const perPanel = new Map<string, { revenueToday: number }>();
  let profitToday = 0, ordersToday = 0;
  const NON_EARNING: OrderStatus[] = ["refunded", "canceled", "duplicate", "failed"];
  for (const o of (orders as Array<{ panel_id: string; charge: number; profit: number | null; status: OrderStatus }> | null) ?? []) {
    ordersToday++;
    const p = perPanel.get(o.panel_id) ?? { revenueToday: 0 };
    p.revenueToday += Number(o.charge); // gross; refunds subtracted below
    perPanel.set(o.panel_id, p);
    if (!NON_EARNING.includes(o.status)) profitToday += Number(o.profit ?? 0);
  }
  // Net out refunds per panel (revenue minus refund).
  let revenueToday = 0;
  for (const [pid, agg] of perPanel) {
    agg.revenueToday = round4(agg.revenueToday - (refundByPanel.get(pid) ?? 0));
    revenueToday += agg.revenueToday;
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
    commissionCharged: round4(commissionCharged),
    ordersToday,
    panels: list.length,
    perPanel: list.map((p) => ({
      panelId: p.id,
      panelName: p.name,
      revenueToday: round4(perPanel.get(p.id)?.revenueToday ?? 0),
      commissionToday: round4((perPanel.get(p.id)?.revenueToday ?? 0) * COMMISSION_RATE),
      commissionCharged: round4(commissionByPanel.get(p.id) ?? 0),
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
  topUpRows: Array<{ createdAt: string; amount: number; panelName: string }>;
}

/**
 * A period earnings receipt for the owner: total customer top-ups minus the API
 * (provider) cost of orders placed in the window = profit. `fromISO`/`toISO` are
 * the inclusive day boundaries (start-of-day → end-of-day) chosen by the owner.
 */
export async function getOwnerReceipt(fromISO: string, toISO: string): Promise<OwnerReceipt> {
  const empty: OwnerReceipt = {
    from: fromISO,
    to: toISO,
    topUps: 0,
    apiCost: 0,
    profit: 0,
    depositCount: 0,
    orderCount: 0,
    perPanel: [],
    topUpRows: [],
  };
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
  const topUpRows: Array<{ createdAt: string; amount: number; panelName: string }> = [];

  let topUps = 0, apiCost = 0, depositCount = 0, orderCount = 0;
  for (const d of (deposits as Array<{ panel_id: string; amount: number; created_at: string }> | null) ?? []) {
    depositCount++;
    topUps += Number(d.amount);
    get(d.panel_id).topUps += Number(d.amount);
    topUpRows.push({
      createdAt: d.created_at,
      amount: Number(d.amount),
      panelName: nameById.get(d.panel_id) ?? "Panel",
    });
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
    topUpRows: topUpRows
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((r) => ({ ...r, amount: round4(r.amount) })),
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
  return submitPendingOrderToProvider(admin, order, "Resent to provider by owner");
}

export async function refreshProviderBalancesAndRetryHeldOrders(
  panelId: string
): Promise<
  | {
      ok: true;
      heldFound: number;
      providersChecked: number;
      providersFunded: number;
      retried: number;
      resent: number;
      failed: number;
    }
  | { ok: false; error: string }
> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(admin, user.id, panelId))) return { ok: false, error: "Not authorized for this panel" };

  const { data } = await admin
    .from("orders")
    .select("id, service_id, provider_id, provider_order_id, link, quantity, provider_cost, status, created_at, provider_payload, provider_response")
    .eq("panel_id", panelId)
    .eq("status", "pending");

  const heldOrders = ((data as Array<{
    id: string;
    service_id: string | null;
    provider_id: string | null;
    provider_order_id: string | null;
    link: string | null;
    quantity: number | null;
    provider_cost: number | null;
    status: OrderStatus;
    created_at: string;
    provider_payload: unknown;
    provider_response: { held?: boolean; reason?: string | null; error?: string | null } | null;
  }> | null) ?? []).filter((order) => (
    order.provider_id &&
    !order.provider_order_id &&
    order.status === "pending" &&
    order.provider_response?.held === true &&
    order.provider_response?.reason === "provider_balance"
  ));

  if (heldOrders.length === 0) {
    return { ok: true, heldFound: 0, providersChecked: 0, providersFunded: 0, retried: 0, resent: 0, failed: 0 };
  }

  const providerIds = [...new Set(heldOrders.map((order) => order.provider_id as string))];
  const { data: providers } = await admin
    .from("providers")
    .select("id, api_url, balance")
    .in("id", providerIds);

  const providerRows = (providers as Array<{ id: string; api_url: string; balance: number | null }> | null) ?? [];
  const refreshedBalances = new Map<string, number>();
  let providersChecked = 0;

  for (const provider of providerRows) {
    providersChecked++;
    try {
      const creds = await getProviderCredentials(provider.id, provider.api_url);
      const balance = await getBalance(creds);
      if ("error" in balance) continue;

      const latest = Number(balance.balance);
      if (!Number.isFinite(latest)) continue;

      await admin
        .from("providers")
        .update({
          balance: latest,
          currency: balance.currency,
          last_balance_sync: new Date().toISOString(),
        })
        .eq("id", provider.id);
      refreshedBalances.set(provider.id, latest);
    } catch {
      continue;
    }
  }

  const retryableOrders: typeof heldOrders = [];
  const fundedProviderIds = new Set<string>();
  const remainingByProvider = new Map<string, number>();

  for (const order of [...heldOrders].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const providerId = order.provider_id as string;
    const currentBalance = refreshedBalances.get(providerId);
    const providerCost = Number(order.provider_cost ?? 0);
    if (!Number.isFinite(currentBalance as number)) continue;
    if (!Number.isFinite(providerCost) || providerCost <= 0) continue;

    const remaining = remainingByProvider.get(providerId) ?? (currentBalance as number);
    if (remaining + 0.000001 < providerCost) continue;

    remainingByProvider.set(providerId, remaining - providerCost);
    fundedProviderIds.add(providerId);
    retryableOrders.push(order);
  }

  let resent = 0;
  let failed = 0;

  for (const order of retryableOrders) {
    const result = await submitPendingOrderToProvider(admin, order, "Resent to provider after balance refresh");
    if (result.ok) resent++;
    else failed++;
  }

  return {
    ok: true,
    heldFound: heldOrders.length,
    providersChecked,
    providersFunded: fundedProviderIds.size,
    retried: retryableOrders.length,
    resent,
    failed,
  };
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
  // Give back Innvil's commission proportional to the refund (no-ops if none was settled).
  await admin.rpc("reverse_order_commission", { p_order: order.id, p_fraction: full > 0 ? refund / full : 1 });
  await addHistory(admin, order.id as string, "refunded", `Refunded ${refund} by owner`);
  return { ok: true };
}

/**
 * Owner cancels an order and AUTO-REFUNDS the customer the full charge. Idempotent
 * (claims non-terminal → canceled so concurrent/bulk cancels can't double-refund).
 * Best-effort tells the provider to stop if the order was already submitted.
 */
export async function cancelAndRefundOrder(orderId: string): Promise<Result> {
  const r = await authorizeOrder(orderId);
  if ("error" in r) return { ok: false, error: r.error };
  const { admin, order } = r;

  const { data: claimed } = await admin
    .from("orders")
    .update({ status: "canceled" })
    .eq("id", order.id)
    .not("status", "in", "(canceled,refunded)")
    .select("id, charge, customer_id")
    .maybeSingle();
  if (!claimed) return { ok: true }; // already canceled/refunded — no double refund

  await admin.rpc("apply_balance_change", {
    p_customer: claimed.customer_id,
    p_amount: Number(claimed.charge),
    p_type: "refund",
    p_reason: `Order ${order.id} canceled + refunded by owner`,
    p_ref_order: order.id,
  });

  if (order.provider_id && order.provider_order_id) {
    try {
      const { data: prov } = await admin.from("providers").select("api_url").eq("id", order.provider_id as string).maybeSingle();
      if (prov) {
        const creds = await getProviderCredentials(order.provider_id as string, prov.api_url as string);
        await cancelOrders(creds, [order.provider_order_id as string]);
      }
    } catch { /* best-effort — the refund already happened */ }
  }
  await addHistory(admin, order.id as string, "canceled", "Canceled + refunded by owner");
  return { ok: true };
}

/** Cancel + refund many orders at once (owner). Returns how many were processed. */
export async function bulkCancelAndRefund(
  orderIds: string[]
): Promise<{ ok: true; canceled: number } | { ok: false; error: string }> {
  if (!orderIds.length) return { ok: false, error: "No orders selected." };
  let canceled = 0;
  for (const id of orderIds) {
    const res = await cancelAndRefundOrder(id);
    if (res.ok) canceled++;
  }
  return { ok: true, canceled };
}
