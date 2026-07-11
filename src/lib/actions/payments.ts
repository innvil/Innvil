"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { round4, CURRENCIES } from "@/src/lib/money";
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

/** Everything the owner Payments tab needs: the full catalog, connect fields,
    which gateways this panel has connected, and its currency. */
export async function getPaymentsMeta(panelId: string): Promise<PaymentsMeta> {
  const fields: Record<string, GatewayField[]> = {};
  for (const c of GATEWAY_CATALOG) if (c.available) fields[c.id] = getAdapter(c.id)?.fields ?? [];
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

  const { data: existing } = await admin
    .from("panel_payment_gateways")
    .select("id")
    .eq("panel_id", panelId)
    .eq("gateway", gateway)
    .maybeSingle();

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
    .select("id, status, subdomain, settings")
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
  if (amt < 1) return { ok: false, error: "Minimum deposit is 1.00." };

  // Pick the gateway: the one requested, else the panel's first active one.
  let gw = gateway;
  if (!gw) {
    const { data } = await admin
      .from("panel_payment_gateways")
      .select("gateway")
      .eq("panel_id", panelId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1);
    gw = (data?.[0]?.gateway as string) ?? undefined;
  }
  if (!gw) return { ok: false, error: "This panel hasn't enabled deposits yet." };

  const adapter = getAdapter(gw);
  if (!adapter) return { ok: false, error: "That payment method isn't available." };
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
      returnUrl: `${appUrl}/p/${panel.subdomain}`,
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
