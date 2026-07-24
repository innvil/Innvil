"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { hasDesignTools } from "@/src/lib/plans";
import {
  readDashboardHome, normalizeDashboardHome, DEFAULT_DASHBOARD_HOME, type DashboardWidget,
} from "@/src/lib/dashboard-layout";

/* =========================================================
   Design Tools (Business plan) — owner-facing. Phase A: the customer-dashboard
   layout builder (rearrange/show-hide home widgets with built-in controls; the
   backend/order/wallet logic is never touched). Phase B (custom landing HTML +
   premium templates) will extend this file.
   ========================================================= */

type Settings = Record<string, unknown>;
function toSettings(v: unknown): Settings {
  return v && typeof v === "object" ? (v as Settings) : {};
}

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DashboardDesignInfo {
  hasDesignTools: boolean;
  home: DashboardWidget[];
}

export async function getDashboardDesign(panelId: string): Promise<DashboardDesignInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  return {
    hasDesignTools: hasDesignTools(settings),
    home: readDashboardHome(settings) ?? DEFAULT_DASHBOARD_HOME,
  };
}

/** Save the customer-dashboard home layout. Requires Design Tools (Business). */
export async function setDashboardHome(panelId: string, layout: DashboardWidget[]): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  if (!hasDesignTools(settings)) {
    return { ok: false, error: "Design Tools are included with the Business plan — upgrade to customize your dashboard." };
  }
  const dashboard = (settings.dashboard && typeof settings.dashboard === "object" ? settings.dashboard : {}) as Record<string, unknown>;
  const updated = { ...settings, dashboard: { ...dashboard, home: normalizeDashboardHome(layout) } };
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Reset the dashboard back to the default layout. */
export async function resetDashboardHome(panelId: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  if (!hasDesignTools(settings)) return { ok: false, error: "Design Tools are included with the Business plan." };
  const dashboard = (settings.dashboard && typeof settings.dashboard === "object" ? settings.dashboard : {}) as Record<string, unknown>;
  const nextDashboard = { ...dashboard };
  delete nextDashboard.home;
  const updated = { ...settings, dashboard: nextDashboard };
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
