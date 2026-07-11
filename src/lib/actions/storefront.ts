"use server";

import { createAdminClient } from "@/src/lib/supabase/admin";
import type { PanelStatus, ServiceRow } from "@/src/types/db";

/**
 * PUBLIC storefront data. These are unauthenticated reads for a panel's own
 * customer-facing site, so they run via the service-role client but return ONLY
 * customer-safe fields — never provider cost, markup, profit, or api keys.
 */

export interface PublicPanel {
  id: string;
  name: string;
  subdomain: string;
  customDomain: string | null;
  status: PanelStatus;
  theme: string | null;
}

/** Resolve a panel by its subdomain (case-insensitive). */
export async function getPublicPanel(subdomain: string): Promise<PublicPanel | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("panels")
    .select("id, name, subdomain, custom_domain, status, theme")
    .ilike("subdomain", subdomain)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    subdomain: data.subdomain,
    customDomain: data.custom_domain,
    status: data.status,
    theme: data.theme,
  };
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
> & { provider_categories: { name: string } | null };

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

  return ((data as ServiceJoin[]) ?? []).map((r) => ({
    id: r.id,
    localId: r.local_id,
    name: r.name,
    platform: r.platform,
    category: r.provider_categories?.name ?? null,
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
