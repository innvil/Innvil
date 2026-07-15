"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import type { PanelStatus, ServiceRow } from "@/src/types/db";

/**
 * PUBLIC storefront data. These are unauthenticated reads for a panel's own
 * customer-facing site, so they run via the service-role client but return ONLY
 * customer-safe fields — never provider cost, markup, profit, or api keys.
 */

export interface PublicLandingSection {
  id: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface PublicPanel {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: PanelStatus;
  theme: string | null;
  currency: string;
  logoUrl: string;
  accent: string;
  headline: string;
  description: string;
  favicon: string;
  sections: PublicLandingSection[];
}

/** The panel's operating currency (from settings; default USD). */
function panelCurrency(settings: unknown): string {
  if (settings && typeof settings === "object") {
    const c = (settings as Record<string, unknown>).currency;
    if (typeof c === "string" && c) return c.toUpperCase();
  }
  return "USD";
}

/** Owner-authored landing blocks (from settings.branding.sections). */
function landingSections(raw: unknown): PublicLandingSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).flatMap((s, i) => {
    if (!s || typeof s !== "object") return [];
    const o = s as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : "";
    const body = typeof o.body === "string" ? o.body : "";
    if (!title && !body) return [];
    return [{
      id: typeof o.id === "string" && o.id ? o.id : `s${i}`,
      title,
      body,
      ctaLabel: typeof o.ctaLabel === "string" ? o.ctaLabel : "",
      ctaHref: typeof o.ctaHref === "string" ? o.ctaHref : "",
    }];
  });
}

/** Customer-facing branding (logo, accent, hero copy) from settings.branding. */
function panelBranding(settings: unknown): { logoUrl: string; accent: string; headline: string; description: string; favicon: string; sections: PublicLandingSection[] } {
  const empty = { logoUrl: "", accent: "", headline: "", description: "", favicon: "", sections: [] as PublicLandingSection[] };
  if (settings && typeof settings === "object") {
    const b = (settings as Record<string, unknown>).branding;
    if (b && typeof b === "object") {
      const o = b as Record<string, unknown>;
      return {
        logoUrl: typeof o.logoUrl === "string" ? o.logoUrl : "",
        accent: typeof o.accent === "string" ? o.accent : "",
        headline: typeof o.headline === "string" ? o.headline : "",
        description: typeof o.description === "string" ? o.description : "",
        favicon: typeof o.favicon === "string" ? o.favicon : "",
        sections: landingSections(o.sections),
      };
    }
  }
  return empty;
}

/**
 * Resolve a panel by its subdomain OR its connected custom domain (case-insensitive).
 * The proxy rewrites both `<sub>.innvil.cloud` and a custom host to `/p/<identifier>`,
 * so `identifier` may be either a subdomain label or a full hostname.
 */
export async function getPublicPanel(identifier: string): Promise<PublicPanel | null> {
  const admin = createAdminClient();
  // Only letters/digits/dot/hyphen are valid in a hostname/subdomain — sanitize so the
  // value can't break the PostgREST `.or()` filter.
  const id = identifier.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!id) return null;
  const { data } = await admin
    .from("panels")
    .select("id, name, subdomain, custom_domain, status, theme, settings")
    .or(`subdomain.ilike.${id},custom_domain.ilike.${id}`)
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const branding = panelBranding(data.settings);
  return {
    id: data.id,
    name: data.name,
    subdomain: data.subdomain,
    customDomain: data.custom_domain,
    status: data.status,
    theme: data.theme,
    currency: panelCurrency(data.settings),
    logoUrl: branding.logoUrl,
    accent: branding.accent,
    headline: branding.headline,
    description: branding.description,
    favicon: branding.favicon || branding.logoUrl,
    sections: branding.sections,
  };
}

/** Payment methods a panel has connected (public — id/label/category only). */
export interface TopupDiscountRule {
  minAmount: number;
  discountPct: number;
}

export interface PublicPaymentMethod {
  id: string; // gateway id
  label: string;
  category: string; // "crypto" | "card" | "ewallet" | "bank"
  minTopup: number;
  discountPct: number | null;
  discountRules: TopupDiscountRule[];
}

function normalizeMinTopup(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n * 10000) / 10000;
}

function normalizeDiscountPct(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10000) / 10000;
}

function normalizeAmount(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10000) / 10000;
}

function normalizeRules(rules: TopupDiscountRule[]): TopupDiscountRule[] {
  const out = rules
    .filter((r) => Number.isFinite(r.minAmount) && r.minAmount >= 0 && Number.isFinite(r.discountPct) && r.discountPct >= 0 && r.discountPct <= 100)
    .map((r) => ({ minAmount: Math.round(r.minAmount * 10000) / 10000, discountPct: Math.round(r.discountPct * 10000) / 10000 }))
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
  const rules: TopupDiscountRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const minAmount = normalizeAmount(obj.minAmount);
    const discountPct = normalizeDiscountPct(obj.discountPct);
    if (minAmount == null || discountPct == null) continue;
    rules.push({ minAmount, discountPct });
  }
  return normalizeRules(rules);
}

export async function getPanelPaymentMethods(panelId: string): Promise<PublicPaymentMethod[]> {
  const admin = createAdminClient();
  const [{ data }, { data: defaults }] = await Promise.all([
    admin
      .from("panel_payment_gateways")
      .select("gateway, status, config")
      .eq("panel_id", panelId)
      .eq("status", "active"),
    admin
      .from("platform_topup_discount_defaults")
      .select("category, discount_pct, discount_rules"),
  ]);
  const { GATEWAY_CATALOG } = await import("@/src/lib/payments/adapters");
  const byId = new Map(GATEWAY_CATALOG.map((c) => [c.id, c]));
  const defaultByCategory = new Map<string, TopupDiscountRule[]>(
    (defaults ?? []).map((r) => {
      const parsed = parseRules(r.discount_rules);
      if (parsed.length > 0) return [String(r.category), parsed];
      const legacy = normalizeDiscountPct(r.discount_pct);
      return [String(r.category), legacy == null ? [] : [{ minAmount: 0, discountPct: legacy }]];
    })
  );
  return (data ?? [])
    .flatMap((r) => {
      const cat = byId.get(r.gateway as string);
      if (!cat) return [];
      const cfg = (r.config as Record<string, unknown> | null) ?? null;
      const panelRules = parseRules(cfg?.discountRules);
      const panelLegacy = normalizeDiscountPct(cfg?.discountPct);
      const effectiveRules = panelRules.length > 0
        ? panelRules
        : panelLegacy != null
          ? [{ minAmount: 0, discountPct: panelLegacy }]
          : (defaultByCategory.get(cat.category) ?? []);
      const baseRule = effectiveRules.find((x) => x.minAmount === 0);
      return [{
        id: cat.id,
        label: cat.label,
        category: cat.category,
        minTopup: normalizeMinTopup(cfg?.minTopup),
        discountPct: baseRule?.discountPct ?? null,
        discountRules: effectiveRules,
      } satisfies PublicPaymentMethod];
    });
}

export interface StorefrontService {
  id: string;
  localId: number | null;
  name: string;
  platform: string | null;
  category: string | null;
  price: number; // sell rate per 1000 — the only price a customer ever sees
  min: number;
  max: number;
  description: string | null;
}

type ServiceJoin = Pick<
  ServiceRow,
  "id" | "local_id" | "name" | "platform" | "sell_rate" | "min" | "max" | "description" | "category_id"
>;

/** Active services for a panel's storefront (customer-safe fields only). */
export async function getStorefrontServices(panelId: string): Promise<StorefrontService[]> {
  const admin = createAdminClient();
  const [{ data: services }, { data: categories }] = await Promise.all([
    admin
      .from("services")
      .select("id, local_id, name, platform, sell_rate, min, max, description, category_id")
      .eq("panel_id", panelId)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("provider_categories")
      .select("id, name, parent_id")
      .eq("panel_id", panelId),
  ]);

  const categoryById = new Map(
    ((categories as Array<{ id: string; name: string | null; parent_id: string | null }> | null) ?? [])
      .map((c) => [c.id, c])
  );

  return ((services as ServiceJoin[] | null) ?? []).map((r) => ({
    id: r.id,
    localId: r.local_id,
    name: r.name,
    platform: r.platform,
    category: (r.category_id ? categoryById.get(r.category_id)?.name : null) ?? null,
    price: Number(r.sell_rate),
    min: r.min,
    max: r.max,
    description: r.description,
  }));
}

/** Per-platform display overrides (label + custom monochrome logo path). */
export type StorefrontPlatformMeta = Record<string, { label?: string; icon?: string | null }>;

/** The panel owner's custom platform labels/logos (from panels.settings.platforms). */
export async function getStorefrontPlatforms(panelId: string): Promise<StorefrontPlatformMeta> {
  const admin = createAdminClient();
  const { data } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  const settings = data?.settings;
  if (settings && typeof settings === "object") {
    const p = (settings as Record<string, unknown>).platforms;
    if (p && typeof p === "object") return p as StorefrontPlatformMeta;
  }
  return {};
}
