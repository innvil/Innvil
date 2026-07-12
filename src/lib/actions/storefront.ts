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

/** Resolve a panel by its subdomain (case-insensitive). */
export async function getPublicPanel(subdomain: string): Promise<PublicPanel | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("panels")
    .select("id, name, subdomain, custom_domain, status, theme, settings")
    .ilike("subdomain", subdomain)
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
export interface PublicPaymentMethod {
  id: string; // gateway id
  label: string;
  category: string; // "crypto" | "card" | "ewallet" | "bank"
  minTopup: number;
}

function normalizeMinTopup(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.round(n * 10000) / 10000;
}

export async function getPanelPaymentMethods(panelId: string): Promise<PublicPaymentMethod[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("panel_payment_gateways")
    .select("gateway, status, config")
    .eq("panel_id", panelId)
    .eq("status", "active");
  const { GATEWAY_CATALOG } = await import("@/src/lib/payments/adapters");
  const byId = new Map(GATEWAY_CATALOG.map((c) => [c.id, c]));
  return (data ?? [])
    .flatMap((r) => {
      const cat = byId.get(r.gateway as string);
      if (!cat) return [];
      const cfg = (r.config as Record<string, unknown> | null) ?? null;
      return [{
        id: cat.id,
        label: cat.label,
        category: cat.category,
        minTopup: normalizeMinTopup(cfg?.minTopup),
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
  "id" | "local_id" | "name" | "platform" | "sell_rate" | "min" | "max" | "description"
> & { provider_categories: Array<{ name: string | null }> | null };

/** Active services for a panel's storefront (customer-safe fields only). */
export async function getStorefrontServices(panelId: string): Promise<StorefrontService[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("services")
    .select("id, local_id, name, platform, sell_rate, min, max, description, provider_categories(name)")
    .eq("panel_id", panelId)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  return ((data as ServiceJoin[] | null) ?? []).map((r) => ({
    id: r.id,
    localId: r.local_id,
    name: r.name,
    platform: r.platform,
    category: r.provider_categories?.[0]?.name ?? null,
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
