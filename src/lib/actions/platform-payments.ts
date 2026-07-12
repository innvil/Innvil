"use server";

import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { getAdapter, catalogEntry } from "@/src/lib/payments/adapters";

/* =========================================================
   PLATFORM PAYMENTS (super-admin only)
   Configure how PANEL OWNERS pay Innvil. Mirrors the per-panel gateway config
   but at the platform level (one row per gateway). Cryptomus + NOWPayments for
   now; Binance Pay later. Secrets stored pgcrypto-encrypted, decrypted only
   server-side. Every action is gated on the super_admin role.
   ========================================================= */

type Result = { ok: true } | { ok: false; error: string };

/** The gateways a super admin may configure at the platform level (crypto only for now). */
export const PLATFORM_GATEWAY_IDS = ["cryptomus", "nowpayments"] as const;

export interface PlatformGatewayField {
  key: string; label: string; secret: boolean; placeholder?: string; help?: string; optional?: boolean;
}
export interface PlatformGatewayMeta {
  id: string;
  label: string;
  note: string;
  fields: PlatformGatewayField[];
  connected: boolean;
  status: string | null;
  config: Record<string, string>; // non-secret public values (safe to show)
}

async function requireSuperAdmin(): Promise<boolean> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return false;
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  return data?.role === "super_admin";
}

/** Catalog + connection state for the super-admin payments screen. */
export async function getPlatformPaymentsMeta(): Promise<PlatformGatewayMeta[]> {
  if (!(await requireSuperAdmin())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_payment_gateways")
    .select("gateway, status, config")
    .in("gateway", PLATFORM_GATEWAY_IDS as unknown as string[]);
  const byId = new Map((data ?? []).map((r) => [r.gateway as string, r]));

  return PLATFORM_GATEWAY_IDS.map((id) => {
    const adapter = getAdapter(id);
    const cat = catalogEntry(id);
    const row = byId.get(id);
    return {
      id,
      label: cat?.label ?? adapter?.label ?? id,
      note: cat?.note ?? adapter?.note ?? "",
      fields: (adapter?.fields ?? []).map((f) => ({
        key: f.key, label: f.label, secret: f.secret, placeholder: f.placeholder, help: f.help, optional: f.optional,
      })),
      connected: !!row,
      status: (row?.status as string) ?? null,
      config: (row?.config as Record<string, string>) ?? {},
    };
  });
}

function parseSecrets(raw: unknown): Record<string, string> {
  if (typeof raw !== "string" || !raw) return {};
  try {
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Connect / update a platform gateway. Blank secret fields keep the existing value. */
export async function connectPlatformGateway(
  gateway: string,
  values: Record<string, string>
): Promise<Result> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  if (!(PLATFORM_GATEWAY_IDS as unknown as string[]).includes(gateway)) {
    return { ok: false, error: "That gateway isn't available at the platform level." };
  }
  const adapter = getAdapter(gateway);
  if (!adapter) return { ok: false, error: "That gateway isn't implemented." };

  const admin = createAdminClient();
  const config: Record<string, string> = {};
  const providedSecrets: Record<string, string> = {};
  for (const f of adapter.fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.secret) { if (v) providedSecrets[f.key] = v; }
    else config[f.key] = v;
  }
  for (const f of adapter.fields) {
    if (!f.secret && !f.optional && !config[f.key]) return { ok: false, error: `Enter ${f.label}.` };
  }

  const { data: existing } = await admin
    .from("platform_payment_gateways")
    .select("id")
    .eq("gateway", gateway)
    .maybeSingle();

  // Merge secrets so an unchanged (blank) secret field keeps its stored value.
  let secrets = { ...providedSecrets };
  if (existing) {
    const { data: key } = await admin.rpc("get_platform_gateway_key", { p_row: existing.id, p_secret: providerKeySecret() });
    secrets = { ...parseSecrets(key), ...providedSecrets };
  }
  for (const f of adapter.fields) {
    if (f.secret && !f.optional && !secrets[f.key]) return { ok: false, error: `Enter ${f.label}.` };
  }

  let rowId: string;
  if (existing) {
    rowId = existing.id as string;
    const { error } = await admin.from("platform_payment_gateways").update({ config, status: "active" }).eq("id", rowId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin
      .from("platform_payment_gateways")
      .insert({ gateway, config, status: "active" })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save gateway." };
    rowId = data.id as string;
  }

  const { error: keyErr } = await admin.rpc("set_platform_gateway_key", {
    p_row: rowId,
    p_key: JSON.stringify(secrets),
    p_secret: providerKeySecret(),
  });
  if (keyErr) return { ok: false, error: `Could not store credentials: ${keyErr.message}` };
  return { ok: true };
}

export async function disconnectPlatformGateway(gateway: string): Promise<Result> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();
  const { error } = await admin.from("platform_payment_gateways").delete().eq("gateway", gateway);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
