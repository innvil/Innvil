"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { round4, CURRENCIES } from "@/src/lib/money";
import { panelStorefrontPath } from "@/src/lib/config";
import {
  getAdapter,
  getGatewayContext,
  GATEWAY_CATALOG,
  type CatalogEntry,
  type GatewayField,
} from "@/src/lib/payments";

/** Read a panel's operating currency from its settings (default USD). */
function readPanelCurrency(settings: unknown): string {
  if (settings && typeof settings === "object") {
    const c = (settings as Record<string, unknown>).currency;
    if (typeof c === "string" && c) return c.toUpperCase();
  }
  return "USD";
}

/* =========================================================
   §7 PAYMENTS — multi-gateway (bring-your-own, per panel).
   Public config in `panel_payment_gateways.config`; secrets as an encrypted JSON
   blob in `api_key_enc`. Deposits route through the matching adapter; the shared
   webhook auto-credits the wallet on confirmation.
   ========================================================= */

type Result<T = void> =
  | ({ ok: true } & (T extends void ? object : { data: T }))
  | { ok: false; error: string };

async function ownsPanel(userId: string, panelId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("panels")
    .select("id")
    .eq("id", panelId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

/* ---------------- Owner: catalog + connect/disconnect ---------------- */

export interface ConnectedGateway {
  gateway: string;
  status: string;
  config: Record<string, string>;
}

export interface PaymentsMeta {
  catalog: CatalogEntry[];
  fields: Record<string, GatewayField[]>; // per available gateway id
  connected: ConnectedGateway[];
  currency: string; // the panel's operating currency
  currencies: { code: string; label: string }[]; // options for the selector
}

const DEFAULT_GATEWAY_MIN_TOPUP = 1;

function normalizeMinTopup(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GATEWAY_MIN_TOPUP;
  return round4(n);
}

/** Everything the owner Payments tab needs: the full catalog, connect fields,
    which gateways this panel has connected, and its currency. */
export async function getPaymentsMeta(panelId: string): Promise<PaymentsMeta> {
  const fields: Record<string, GatewayField[]> = {};
  for (const c of GATEWAY_CATALOG) {
    if (!c.available) continue;
    fields[c.id] = [
      ...(getAdapter(c.id)?.fields ?? []),
      {
        key: "minTopup",
        label: "Minimum top-up",
        secret: false,
        placeholder: "1.00",
        help: "Customer deposits via this method must be at least this amount.",
        optional: true,
      },
    ];
  }
  const currencies = CURRENCIES.map((c) => ({ code: c.code, label: `${c.code} — ${c.label}` }));

  const { user, admin } = await getAuthedAdmin();
  let connected: ConnectedGateway[] = [];
  let currency = "USD";
  if (user && (await ownsPanel(user.id, panelId))) {
    const [{ data }, { data: panel }] = await Promise.all([
      admin.from("panel_payment_gateways").select("gateway, status, config, merchant_id").eq("panel_id", panelId),
      admin.from("panels").select("settings").eq("id", panelId).maybeSingle(),
    ]);
    currency = readPanelCurrency(panel?.settings);
    connected = (data ?? []).map((r) => {
      const config: Record<string, string> = { ...((r.config as Record<string, string>) ?? {}) };
      if (!config.minTopup) config.minTopup = String(DEFAULT_GATEWAY_MIN_TOPUP);
      if (r.gateway === "cryptomus" && r.merchant_id && !config.merchantId) {
        config.merchantId = r.merchant_id as string;
      }
      return { gateway: r.gateway as string, status: r.status as string, config };
    });
  }
  return { catalog: GATEWAY_CATALOG, fields, connected, currency, currencies };
}

/** Set the panel's operating currency (owner). Stored in panels.settings.currency. */
export async function setPanelCurrency(panelId: string, code: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(user.id, panelId))) return { ok: false, error: "Not authorized for this panel" };
  const cc = (code || "").toUpperCase();
  if (!CURRENCIES.some((c) => c.code === cc)) return { ok: false, error: "Unsupported currency." };

  const { data: panel } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  const settings: Record<string, unknown> =
    panel?.settings && typeof panel.settings === "object" ? { ...(panel.settings as Record<string, unknown>) } : {};
  settings.currency = cc;
  const { error } = await admin.from("panels").update({ settings }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Connect (or update) a gateway. Blank secret fields keep the existing value. */
export async function connectGateway(
  panelId: string,
  gateway: string,
  values: Record<string, string>
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(user.id, panelId))) return { ok: false, error: "Not authorized for this panel" };

  const adapter = getAdapter(gateway);
  if (!adapter) return { ok: false, error: "That gateway isn't available yet." };

  const config: Record<string, string> = {};
  const providedSecrets: Record<string, string> = {};
  for (const f of adapter.fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.secret) {
      if (v) providedSecrets[f.key] = v;
    } else {
      config[f.key] = v;
    }
  }
  for (const f of adapter.fields) {
    if (!f.secret && !f.optional && !config[f.key]) return { ok: false, error: `Enter ${f.label}.` };
  }

  const rawMinTopup = (values.minTopup ?? "").trim();
  if (rawMinTopup) {
    const parsed = Number(rawMinTopup);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: "Minimum top-up must be a number greater than 0." };
    }
    config.minTopup = String(round4(parsed));
  }

  const { data: existing } = await admin
    .from("panel_payment_gateways")
    .select("id, config")
    .eq("panel_id", panelId)
    .eq("gateway", gateway)
    .maybeSingle();

  if (!config.minTopup) {
    const prevCfg = (existing?.config as Record<string, unknown> | null) ?? null;
    config.minTopup = String(normalizeMinTopup(prevCfg?.minTopup));
  }

  // Merge secrets so an unchanged (blank) secret field keeps its stored value.
  let secrets = { ...providedSecrets };
  if (existing) {
    const ctx = await getGatewayContext(panelId, gateway);
    secrets = { ...(ctx?.secrets ?? {}), ...providedSecrets };
  }
  for (const f of adapter.fields) {
    if (f.secret && !f.optional && !secrets[f.key]) return { ok: false, error: `Enter ${f.label}.` };
  }

  let rowId: string;
  if (existing) {
    rowId = existing.id as string;
    const { error } = await admin
      .from("panel_payment_gateways")
      .update({ config, status: "active" })
      .eq("id", rowId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin
      .from("panel_payment_gateways")
      .insert({ panel_id: panelId, gateway, config, status: "active" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save gateway." };
    rowId = data.id as string;
  }

  const { error: keyErr } = await admin.rpc("set_gateway_key", {
    p_row: rowId,
    p_key: JSON.stringify(secrets),
    p_secret: providerKeySecret(),
  });
  if (keyErr) return { ok: false, error: `Could not store credentials: ${keyErr.message}` };
  return { ok: true };
}

export async function disconnectGateway(panelId: string, gateway: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };
  if (!(await ownsPanel(user.id, panelId))) return { ok: false, error: "Not authorized for this panel" };
  const { error } = await admin
    .from("panel_payment_gateways")
    .delete()
    .eq("panel_id", panelId)
    .eq("gateway", gateway);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ---------------- Customer: create a deposit + list history ---------------- */

export async function createDeposit(
  panelId: string,
  amount: number,
  gateway?: string
): Promise<Result<{ url: string }>> {
  const supa = await createStorefrontClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { ok: false, error: "Please log in to add funds." };

  const admin = createAdminClient();
  const { data: panel } = await admin
    .from("panels")
    .select("id, status, subdomain, custom_domain, settings")
    .eq("id", panelId)
    .maybeSingle();
  if (!panel) return { ok: false, error: "Panel not found." };
  if (panel.status !== "live" && panel.status !== "inactive")
    return { ok: false, error: "Deposits are unavailable on this panel right now." };

  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, status")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return { ok: false, error: "No account found on this panel." };
  if (acct.status === "banned") return { ok: false, error: "Your account can't add funds right now." };

  const amt = round4(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "Enter a valid amount." };

  const gw = (gateway ?? "").trim();
  if (!gw) return { ok: false, error: "Choose a payment method." };

  const { data: gwRow } = await admin
    .from("panel_payment_gateways")
    .select("config")
    .eq("panel_id", panelId)
    .eq("gateway", gw)
    .eq("status", "active")
    .maybeSingle();
  const gwConfig = (gwRow?.config as Record<string, unknown> | null) ?? null;
  const gatewayMinTopup = normalizeMinTopup(gwConfig?.minTopup);

  const adapter = getAdapter(gw);
  if (!adapter) return { ok: false, error: "That payment method isn't available." };
  if (amt < gatewayMinTopup) {
    return { ok: false, error: `Minimum top-up for ${adapter.label} is ${gatewayMinTopup.toFixed(2)}.` };
  }
  const ctx = await getGatewayContext(panelId, gw);
  if (!ctx) return { ok: false, error: "This payment method isn't fully configured." };

  const currency = readPanelCurrency(panel.settings);
  const { data: pay, error } = await admin
    .from("payments")
    .insert({
      panel_id: panelId,
      customer_id: acct.id,
      method: adapter.label,
      amount: amt,
      currency,
      status: "pending",
      gateway: gw,
    })
    .select("id")
    .single();
  if (error || !pay) return { ok: false, error: error?.message ?? "Could not start the deposit." };

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  try {
    const { url, ref } = await adapter.createCheckout({
      amount: amt,
      currency,
      orderId: pay.id as string,
      callbackUrl: `${appUrl}/api/webhooks/${gw}`,
      returnUrl: panelStorefrontPath(panel.subdomain as string, (panel.custom_domain as string | null) ?? null),
      config: ctx.config,
      secrets: ctx.secrets,
      customerEmail: user.email ?? null,
    });
    await admin.from("payments").update({ gateway_ref: ref }).eq("id", pay.id);
    return { ok: true, data: { url } };
  } catch (e) {
    await admin.from("payments").update({ status: "rejected" }).eq("id", pay.id);
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the checkout." };
  }
}

export interface DepositVM {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  createdAt: string;
}

export interface CustomerWalletSnapshot {
  balance: number;
  deposits: DepositVM[];
}

export interface OwnerDepositVM extends DepositVM {
  customerId: string;
  customerUsername: string | null;
  customerEmail: string | null;
}

export async function listDeposits(panelId: string): Promise<DepositVM[]> {
  const supa = await createStorefrontClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return [];

  const { data } = await admin
    .from("payments")
    .select("id, amount, currency, status, method, created_at")
    .eq("customer_id", acct.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((p) => ({
    id: p.id as string,
    amount: Number(p.amount),
    currency: p.currency as string,
    status: p.status as string,
    method: p.method as string,
    createdAt: p.created_at as string,
  }));
}

/** Lightweight signed-in wallet snapshot so the storefront can refresh after payment confirmation. */
export async function getCustomerWalletSnapshot(panelId: string): Promise<CustomerWalletSnapshot | null> {
  const supa = await createStorefrontClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return null;

  const admin = createAdminClient();
  const { data: acct } = await admin
    .from("customer_accounts")
    .select("id, balance")
    .eq("panel_id", panelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!acct) return null;

  const deposits = await listDeposits(panelId);
  return {
    balance: Number(acct.balance),
    deposits,
  };
}

async function customerAccountForOwner(userId: string, customerAccountId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("customer_accounts")
    .select("id, panel_id, user_id")
    .eq("id", customerAccountId)
    .maybeSingle();
  if (!data) return null;
  if (!(await ownsPanel(userId, data.panel_id as string))) return null;
  return {
    id: data.id as string,
    panelId: data.panel_id as string,
    userId: data.user_id as string,
  };
}

/** Owner-side deposit history for one customer account. */
export async function listCustomerDeposits(customerAccountId: string): Promise<OwnerDepositVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];

  const acct = await customerAccountForOwner(user.id, customerAccountId);
  if (!acct) return [];

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", acct.userId)
    .maybeSingle();

  let email: string | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(acct.userId);
    email = data.user?.email ?? null;
  } catch {
    // best-effort
  }

  const { data } = await admin
    .from("payments")
    .select("id, customer_id, amount, currency, status, method, created_at")
    .eq("customer_id", customerAccountId)
    .order("created_at", { ascending: false })
    .limit(25);

  return (data ?? []).map((p) => ({
    id: p.id as string,
    customerId: p.customer_id as string,
    customerUsername: (profile?.display_name as string | null) ?? null,
    customerEmail: email,
    amount: Number(p.amount),
    currency: p.currency as string,
    status: p.status as string,
    method: p.method as string,
    createdAt: p.created_at as string,
  }));
}

/** Owner-side panel-wide deposit history for the Payments tab / billing records. */
export async function listPanelDeposits(panelId: string): Promise<OwnerDepositVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  if (!(await ownsPanel(user.id, panelId))) return [];

  const { data } = await admin
    .from("payments")
    .select("id, customer_id, amount, currency, status, method, created_at")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!data?.length) return [];

  const { data: accts } = await admin
    .from("customer_accounts")
    .select("id, user_id")
    .eq("panel_id", panelId)
    .in("id", (data ?? []).map((p) => p.customer_id as string));
  const userIdByCustomerId = new Map((accts ?? []).map((a) => [a.id as string, a.user_id as string]));

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", [...new Set(Array.from(userIdByCustomerId.values()))]);
  const usernameByUserId = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]));

  const emails = new Map<string, string | null>();
  for (const uid of new Set(Array.from(userIdByCustomerId.values()))) {
    try {
      const { data: authData } = await admin.auth.admin.getUserById(uid);
      emails.set(uid, authData.user?.email ?? null);
    } catch {
      emails.set(uid, null);
    }
  }

  return data.map((p) => ({
    id: p.id as string,
    customerId: p.customer_id as string,
    customerUsername: usernameByUserId.get(userIdByCustomerId.get(p.customer_id as string) ?? "") ?? null,
    customerEmail: emails.get(userIdByCustomerId.get(p.customer_id as string) ?? "") ?? null,
    amount: Number(p.amount),
    currency: p.currency as string,
    status: p.status as string,
    method: p.method as string,
    createdAt: p.created_at as string,
  }));
}

export interface OwnerAllDepositVM extends OwnerDepositVM {
  panelName: string;
}

/** Recent customer top-ups across ALL of the owner's panels (for Earnings & receipts). */
export async function listAllOwnerDeposits(limit = 100): Promise<OwnerAllDepositVM[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data: panels } = await admin.from("panels").select("id, name").eq("owner_id", user.id);
  const list = (panels as Array<{ id: string; name: string }> | null) ?? [];
  if (!list.length) return [];
  const nameById = new Map(list.map((p) => [p.id, p.name]));

  const { data } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, currency, status, method, created_at")
    .in("panel_id", list.map((p) => p.id))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data?.length) return [];

  const { data: accts } = await admin
    .from("customer_accounts")
    .select("id, user_id")
    .in("id", data.map((p) => p.customer_id as string));
  const userIdByCustomerId = new Map((accts ?? []).map((a) => [a.id as string, a.user_id as string]));

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", [...new Set(Array.from(userIdByCustomerId.values()))]);
  const usernameByUserId = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string | null) ?? null]));

  const emails = new Map<string, string | null>();
  for (const uid of new Set(Array.from(userIdByCustomerId.values()))) {
    try {
      const { data: authData } = await admin.auth.admin.getUserById(uid);
      emails.set(uid, authData.user?.email ?? null);
    } catch {
      emails.set(uid, null);
    }
  }

  return data.map((p) => ({
    id: p.id as string,
    panelName: nameById.get(p.panel_id as string) ?? "Panel",
    customerId: p.customer_id as string,
    customerUsername: usernameByUserId.get(userIdByCustomerId.get(p.customer_id as string) ?? "") ?? null,
    customerEmail: emails.get(userIdByCustomerId.get(p.customer_id as string) ?? "") ?? null,
    amount: Number(p.amount),
    currency: p.currency as string,
    status: p.status as string,
    method: p.method as string,
    createdAt: p.created_at as string,
  }));
}

/** Owner-committed top-up: records a completed payment and credits the wallet as a real deposit. */
export async function commitCustomerTopup(
  customerAccountId: string,
  amount: number,
  reason: string
): Promise<Result<{ balance: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const acct = await customerAccountForOwner(user.id, customerAccountId);
  if (!acct) return { ok: false, error: "Customer not found" };

  const amt = round4(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: "Enter an amount greater than 0." };

  const { data: panel } = await admin
    .from("panels")
    .select("settings")
    .eq("id", acct.panelId)
    .maybeSingle();
  const currency = readPanelCurrency(panel?.settings);

  const { data: payment, error: payErr } = await admin
    .from("payments")
    .insert({
      panel_id: acct.panelId,
      customer_id: acct.id,
      method: "Manual top-up",
      amount: amt,
      currency,
      status: "pending",
      gateway: "manual",
      approved_by: user.id,
    })
    .select("id")
    .single();
  if (payErr || !payment) return { ok: false, error: payErr?.message ?? "Could not record the top-up." };

  const { data: tx, error } = await admin.rpc("apply_balance_change", {
    p_customer: acct.id,
    p_amount: amt,
    p_type: "deposit",
    p_reason: reason.trim() || `Manual top-up ${payment.id}`,
    p_admin: user.id,
  });
  if (error) {
    await admin.from("payments").update({ status: "rejected" }).eq("id", payment.id);
    return { ok: false, error: error.message };
  }

  await admin.from("payments").update({ status: "completed" }).eq("id", payment.id);
  return { ok: true, data: { balance: Number((tx as { balance_after: number }).balance_after) } };
}

/** Owner-side fallback: manually commit a pending/approved payment and credit the wallet. */
export async function commitPendingPayment(
  paymentId: string
): Promise<Result<{ balance: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, customer_id, amount, status, method")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!(await ownsPanel(user.id, payment.panel_id as string))) return { ok: false, error: "Not authorized for this panel" };
  if (payment.status === "completed") return { ok: false, error: "This payment is already completed." };
  if (payment.status !== "pending" && payment.status !== "approved") {
    return { ok: false, error: "Only pending payments can be committed." };
  }

  const { data: claimed } = await admin
    .from("payments")
    .update({ status: "completed", approved_by: user.id })
    .eq("id", paymentId)
    .in("status", ["pending", "approved"])
    .select("customer_id, amount, method")
    .maybeSingle();
  if (!claimed) return { ok: false, error: "Could not claim this payment for completion." };

  const { data: tx, error } = await admin.rpc("apply_balance_change", {
    p_customer: claimed.customer_id,
    p_amount: Number(claimed.amount),
    p_type: "deposit",
    p_reason: `${claimed.method} manual commit ${paymentId}`,
    p_admin: user.id,
  });
  if (error) {
    await admin.from("payments").update({ status: payment.status }).eq("id", paymentId);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: { balance: Number((tx as { balance_after: number }).balance_after) } };
}

/** Owner-side safeguard: cancel a pending/approved payment without crediting the wallet. */
export async function cancelPendingPayment(paymentId: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: payment } = await admin
    .from("payments")
    .select("id, panel_id, status")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "Payment not found." };
  if (!(await ownsPanel(user.id, payment.panel_id as string))) return { ok: false, error: "Not authorized for this panel" };
  if (payment.status === "completed") return { ok: false, error: "Completed payments cannot be canceled." };
  if (payment.status !== "pending" && payment.status !== "approved") {
    return { ok: false, error: "Only pending payments can be canceled." };
  }

  const { error } = await admin
    .from("payments")
    .update({ status: "rejected", approved_by: user.id })
    .eq("id", paymentId)
    .in("status", ["pending", "approved"]);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
