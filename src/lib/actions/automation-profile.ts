"use server";

import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { loadAllDatabasePages } from "@/src/lib/supabase/paginate";
import { hasCampaignAutomation, planTier, tierPlatforms } from "@/src/lib/plans";
import {
  readAutomationProfile, normalizeAutomationProfile, type AutomationProfile,
} from "@/src/lib/automation/profile";

/* =========================================================
   Customer automation profile — get/save the keyword→service→qty slots the customer
   configures for their campaigns. Only services on platforms the owner's tier allows
   are offered/kept. Storefront-auth'd.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface ConfigService {
  id: string;
  name: string;
  platform: string;
  price: number;
  min: number;
}

export interface AutomationProfileInfo {
  offered: boolean;
  /** Platforms the owner's tier allows (null = all owner platforms). */
  allowedPlatforms: string[] | null;
  profile: AutomationProfile;
  /** Customer-orderable services grouped by platform (allowed platforms only). */
  servicesByPlatform: Record<string, ConfigService[]>;
}

async function ctx(panelId: string) {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, settings").eq("id", panelId).maybeSingle();
  if (!panel) return null;
  const { data: account } = await admin
    .from("customer_accounts").select("id").eq("user_id", user.id).eq("panel_id", panelId).maybeSingle();
  if (!account) return null;
  return { admin, panel, account };
}

export async function getAutomationProfile(panelId: string): Promise<AutomationProfileInfo | null> {
  const c = await ctx(panelId);
  if (!c) return null;
  const allowed = tierPlatforms(planTier(c.panel.settings)); // null = all

  const services = await loadAllDatabasePages<{
    id: string;
    name: string;
    platform: string | null;
    sell_rate: number;
    min: number;
  }>((from, to) =>
    c.admin
      .from("services")
      .select("id, name, platform, sell_rate, min")
      .eq("panel_id", panelId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const servicesByPlatform: Record<string, ConfigService[]> = {};
  for (const s of services) {
    const platform = s.platform || "other";
    if (allowed !== null && !(allowed as string[]).includes(platform)) continue;
    (servicesByPlatform[platform] ??= []).push({
      id: s.id, name: s.name, platform, price: Number(s.sell_rate) || 0, min: Number(s.min) || 0,
    });
  }

  const { data: row } = await c.admin
    .from("automation_profiles").select("config").eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();

  return {
    offered: hasCampaignAutomation(c.panel.settings),
    allowedPlatforms: allowed,
    profile: readAutomationProfile(row?.config),
    servicesByPlatform,
  };
}

export async function saveAutomationProfile(panelId: string, profile: AutomationProfile): Promise<Result<null>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  if (!hasCampaignAutomation(c.panel.settings)) return { ok: false, error: "The automator isn't available on this panel." };

  const allowed = tierPlatforms(planTier(c.panel.settings));
  const services = await loadAllDatabasePages<{ id: string }>((from, to) =>
    c.admin
      .from("services")
      .select("id")
      .eq("panel_id", panelId)
      .eq("status", "active")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const validIds = new Set(services.map((s) => s.id));

  const clean = normalizeAutomationProfile(profile, allowed, validIds);
  const { error } = await c.admin
    .from("automation_profiles")
    .upsert({ panel_id: panelId, customer_id: c.account.id, config: clean }, { onConflict: "panel_id,customer_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
