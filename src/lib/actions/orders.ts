"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { syncPanelOrders } from "@/src/lib/orders/sync";
import { placeOrderForAccount } from "@/src/lib/orders/place";
import type { PlaceOrderInput, PlaceOrderResult } from "@/src/lib/orders/place";
import type { OrderStatus } from "@/src/types/db";

/* =========================================================
   §4 ORDER PIPELINE (customer-facing)
   place → charge wallet (ledger) → forward to provider → track.
   Runs on the storefront session. The money path lives in orders/place.ts
   (placeOrderForAccount) so the watched-accounts cron can reuse it session-lessly.
   ========================================================= */

export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to place an order." };

  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status").eq("id", input.panelId).maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, status, balance")
    .eq("panel_id", input.panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return { ok: false, error: "No account found on this panel." };

  return placeOrderForAccount(admin, { id: panel.id as string, status: panel.status as string }, { id: acct.id as string, status: acct.status as string, balance: acct.balance as number }, input);
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
