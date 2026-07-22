"use server";

import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";
import { getAdapter, catalogEntry } from "@/src/lib/payments/adapters";
import { getPlatformGatewayContext } from "@/src/lib/payments/platform";

/* =========================================================
   PLATFORM PAYMENTS (super-admin only)
   Configure how PANEL OWNERS pay Innvil. Mirrors the per-panel gateway config
   but at the platform level (one row per gateway). Cryptomus + NOWPayments for
   now; Binance Pay later. Secrets stored pgcrypto-encrypted, decrypted only
   server-side. Every action is gated on the super_admin role.
   ========================================================= */

type Result = { ok: true } | { ok: false; error: string };

/** The gateways a super admin may configure at the platform level (crypto only for now). */
const PLATFORM_GATEWAY_IDS = ["cryptomus", "nowpayments"] as const;
const OWNER_TOPUP_MIN = 5;
const OWNER_FIRST_TOPUP_MIN = 10;

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

export interface OwnerTopupMethod {
  id: string;
  label: string;
  note: string;
  category: PaymentDiscountCategory;
  discountRules: TopupDiscountRule[];
}

export interface OwnerTopupPolicy {
  minTopup: number;
  firstTopupMin: number;
  methods: OwnerTopupMethod[];
}

export type PaymentDiscountCategory = "card" | "ewallet" | "crypto" | "bank";

export interface TopupDiscountRule {
  minAmount: number;
  discountPct: number;
}

export interface TopupDiscountDefaults {
  card: TopupDiscountRule[];
  ewallet: TopupDiscountRule[];
  crypto: TopupDiscountRule[];
  bank: TopupDiscountRule[];
}

const DISCOUNT_CATEGORIES: PaymentDiscountCategory[] = ["card", "ewallet", "crypto", "bank"];

function parseDiscount(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return Number.NaN;
  return Math.round(n * 1000) / 1000;
}

function parseAmount(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return Number.NaN;
  return Math.round(n * 10000) / 10000;
}

function normalizeRules(rules: TopupDiscountRule[]): TopupDiscountRule[] {
  const out = rules
    .filter((r) => Number.isFinite(r.minAmount) && r.minAmount >= 0 && Number.isFinite(r.discountPct) && r.discountPct >= 0 && r.discountPct <= 100)
    .map((r) => ({
      minAmount: Math.round(r.minAmount * 10000) / 10000,
      discountPct: Math.round(r.discountPct * 1000) / 1000,
    }))
    .sort((a, b) => a.minAmount - b.minAmount);

  const dedup: TopupDiscountRule[] = [];
  for (const r of out) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.minAmount === r.minAmount) {
      dedup[dedup.length - 1] = r;
      continue;
    }
    dedup.push(r);
  }
  return dedup;
}

function parseRules(raw: unknown): TopupDiscountRule[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const parsed: TopupDiscountRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const minAmount = parseAmount((item as Record<string, unknown>).minAmount);
    const discountPct = parseDiscount((item as Record<string, unknown>).discountPct);
    if (minAmount == null || discountPct == null) continue;
    if (Number.isNaN(minAmount) || Number.isNaN(discountPct)) continue;
    parsed.push({ minAmount, discountPct });
  }
  return normalizeRules(parsed);
}

function emptyDiscountDefaults(): TopupDiscountDefaults {
  return { card: [], ewallet: [], crypto: [], bank: [] };
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

/** Super-admin: read global top-up discount defaults by payment category. */
export async function getPlatformTopupDiscountDefaults(): Promise<TopupDiscountDefaults> {
  if (!(await requireSuperAdmin())) return emptyDiscountDefaults();
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_topup_discount_defaults")
    .select("category, discount_pct, discount_rules")
    .in("category", DISCOUNT_CATEGORIES as unknown as string[]);

  const out = emptyDiscountDefaults();
  for (const row of data ?? []) {
    const k = row.category as PaymentDiscountCategory;
    if (!DISCOUNT_CATEGORIES.includes(k)) continue;
    const rules = parseRules(row.discount_rules);
    if (rules.length > 0) {
      out[k] = rules;
      continue;
    }
    const legacy = parseDiscount(row.discount_pct);
    out[k] = legacy == null || Number.isNaN(legacy) ? [] : [{ minAmount: 0, discountPct: legacy }];
  }
  return out;
}

/**
 * PUBLIC: the owner top-up bonus tiers to advertise on the marketing landing.
 * Owner→Innvil top-ups go through crypto gateways, so we surface the crypto tiers;
 * if crypto has none, fall back to whichever category has the most tiers. Returns
 * a positive, ascending list — or [] when nothing is configured (section hidden).
 */
export async function getPublicTopupTiers(): Promise<TopupDiscountRule[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("platform_topup_discount_defaults")
    .select("category, discount_rules")
    .in("category", DISCOUNT_CATEGORIES as unknown as string[]);

  const byCat = new Map<string, TopupDiscountRule[]>();
  for (const row of data ?? []) byCat.set(row.category as string, parseRules(row.discount_rules));

  let tiers = byCat.get("crypto") ?? [];
  if (tiers.length === 0) {
    for (const rules of byCat.values()) if (rules.length > tiers.length) tiers = rules;
  }
  return tiers.filter((t) => t.discountPct > 0).sort((a, b) => a.minAmount - b.minAmount);
}

/** Super-admin: set global top-up discount defaults by payment category. */
export async function setPlatformTopupDiscountDefaults(
  values: Record<PaymentDiscountCategory, Array<{ minAmount: string; discountPct: string }>>
): Promise<Result> {
  if (!(await requireSuperAdmin())) return { ok: false, error: "Super admin only." };
  const admin = createAdminClient();

  const rows = DISCOUNT_CATEGORIES.map((category) => ({
    category,
    discount_rules: normalizeRules(
      (values[category] ?? []).flatMap((r) => {
        const minAmount = parseAmount(r.minAmount);
        const discountPct = parseDiscount(r.discountPct);
        if (minAmount == null || discountPct == null) return [];
        if (Number.isNaN(minAmount) || Number.isNaN(discountPct)) return [];
        return [{ minAmount, discountPct }];
      })
    ),
  }));

  const hasInvalid = DISCOUNT_CATEGORIES.some((category) => {
    const arr = values[category] ?? [];
    return arr.some((r) => {
      const minAmount = parseAmount(r.minAmount);
      const discountPct = parseDiscount(r.discountPct);
      if (String(r.minAmount ?? "").trim() === "" && String(r.discountPct ?? "").trim() === "") return false;
      return minAmount == null || discountPct == null || Number.isNaN(minAmount) || Number.isNaN(discountPct);
    });
  });
  if (hasInvalid) {
    return { ok: false, error: "Each rule needs a min amount >= 0 and a discount between 0 and 100." };
  }

  const rowsWithLegacy = rows.map((r) => {
    const zeroRule = r.discount_rules.find((x) => x.minAmount === 0);
    return {
      category: r.category,
      discount_pct: zeroRule ? zeroRule.discountPct : null,
      discount_rules: r.discount_rules,
    };
  });

  const { error } = await admin
    .from("platform_topup_discount_defaults")
    .upsert(rowsWithLegacy, { onConflict: "category" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Owner-facing top-up policy and currently active platform methods. */
export async function getOwnerTopupPolicy(): Promise<OwnerTopupPolicy> {
  const { user } = await getAuthedAdmin();
  if (!user) return { minTopup: OWNER_TOPUP_MIN, firstTopupMin: OWNER_FIRST_TOPUP_MIN, methods: [] };

  const admin = createAdminClient();
  const [{ data }, { data: defaults }] = await Promise.all([
    admin
      .from("platform_payment_gateways")
      .select("gateway, status")
      .in("gateway", PLATFORM_GATEWAY_IDS as unknown as string[])
      .eq("status", "active"),
    admin
      .from("platform_topup_discount_defaults")
      .select("category, discount_pct, discount_rules")
      .in("category", DISCOUNT_CATEGORIES as unknown as string[]),
  ]);

  const defaultByCategory = new Map<PaymentDiscountCategory, TopupDiscountRule[]>(
    (defaults ?? []).flatMap((row) => {
      const category = row.category as PaymentDiscountCategory;
      if (!DISCOUNT_CATEGORIES.includes(category)) return [];
      const parsed = parseRules(row.discount_rules);
      if (parsed.length > 0) return [[category, parsed] as const];
      const legacy = parseDiscount(row.discount_pct);
      return [[
        category,
        legacy == null || Number.isNaN(legacy) ? [] : [{ minAmount: 0, discountPct: legacy }],
      ] as const];
    })
  );

  const methods = (data ?? []).flatMap((r) => {
    const id = r.gateway as string;
    const cat = catalogEntry(id);
    if (!cat) return [];
    const category = cat.category as PaymentDiscountCategory;
    const discountRules = defaultByCategory.get(category) ?? [];
    return [{ id, label: cat.label, note: cat.note, category, discountRules } satisfies OwnerTopupMethod];
  });

  return {
    minTopup: OWNER_TOPUP_MIN,
    firstTopupMin: OWNER_FIRST_TOPUP_MIN,
    methods,
  };
}

/** Highest applicable promo tier for an amount (highest minAmount the amount qualifies for). */
function applicableDiscountPct(amount: number, rules: TopupDiscountRule[]): number {
  const qualifying = rules.filter((r) => amount >= r.minAmount).sort((a, b) => a.minAmount - b.minAmount);
  return qualifying.length ? qualifying[qualifying.length - 1].discountPct : 0;
}

/**
 * Owner starts an Innvil top-up for a specific panel: creates a pending
 * platform_deposit, opens the super-admin's gateway checkout, and returns the URL.
 * The webhook credits panels.settings.innvil_balance (credit = paid + promo bonus).
 */
export async function createPlatformDeposit(
  panelId: string,
  amount: number,
  gateway: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return { ok: false, error: "Panel not found." };

  const policy = await getOwnerTopupPolicy();
  const method = policy.methods.find((m) => m.id === gateway);
  if (!method) return { ok: false, error: "That payment method isn't available right now." };

  const settings = (panel.settings && typeof panel.settings === "object") ? (panel.settings as Record<string, unknown>) : {};
  const balance = Number(settings.innvil_balance ?? 0);
  const minTopup = (Number.isFinite(balance) ? balance : 0) <= 0 ? policy.firstTopupMin : policy.minTopup;

  const paid = Math.round(Number(amount) * 10000) / 10000;
  if (!Number.isFinite(paid) || paid <= 0) return { ok: false, error: "Enter a valid amount." };
  if (paid < minTopup) return { ok: false, error: `Minimum top-up is $${minTopup.toFixed(2)}.` };

  const bonusPct = applicableDiscountPct(paid, method.discountRules);
  const credit = Math.round((paid + (paid * bonusPct) / 100) * 10000) / 10000;

  const adapter = getAdapter(gateway);
  if (!adapter) return { ok: false, error: "That gateway isn't implemented." };
  const ctx = await getPlatformGatewayContext(gateway);
  if (!ctx || Object.keys(ctx.secrets).length === 0) {
    return { ok: false, error: "This method isn't fully configured yet. Please contact support." };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!appUrl) return { ok: false, error: "Payments aren't configured (NEXT_PUBLIC_APP_URL)." };

  const { data: deposit, error } = await admin
    .from("platform_deposits")
    .insert({ panel_id: panelId, owner_id: user.id, gateway, paid_amount: paid, credit_amount: credit, currency: "USD", status: "pending" })
    .select("id")
    .single();
  if (error || !deposit) return { ok: false, error: error?.message ?? "Could not start the deposit." };

  try {
    const { url, ref } = await adapter.createCheckout({
      amount: paid,
      currency: "USD",
      orderId: deposit.id as string,
      callbackUrl: `${appUrl}/api/webhooks/platform/${gateway}`,
      returnUrl: `${appUrl}/`,
      config: ctx.config,
      secrets: ctx.secrets,
      customerEmail: user.email ?? null,
    });
    await admin.from("platform_deposits").update({ gateway_ref: ref }).eq("id", deposit.id);
    return { ok: true, url };
  } catch (e) {
    await admin.from("platform_deposits").delete().eq("id", deposit.id);
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the payment gateway." };
  }
}
