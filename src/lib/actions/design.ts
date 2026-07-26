"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { hasDesignTools } from "@/src/lib/plans";
import {
  readDashboardHome, normalizeDashboardHome, DEFAULT_DASHBOARD_HOME, type DashboardWidget,
} from "@/src/lib/dashboard-layout";
import { readDesignLibrary } from "@/src/lib/design/library";
import { readEditorState, starterDesign, type EditorDesign, type EditorState } from "@/src/lib/design/editor";
import { getDesignPricing } from "@/src/lib/actions/platform-settings";
import { effectivePrice } from "@/src/lib/design/pricing";
import { getDesignPackage } from "@/src/data/designs";
import { round4 } from "@/src/lib/money";

/* =========================================================
   Design Tools (Business plan) — owner-facing. Phase A: the customer-dashboard
   layout builder (rearrange/show-hide home widgets with built-in controls; the
   backend/order/wallet logic is never touched). Phase B (custom landing HTML +
   premium templates) will extend this file.
   ========================================================= */

type Settings = Record<string, unknown>;
function toBalance(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
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

/* ------------------------------------------------------------ visual editor ---- */

export interface CustomDesignInfo {
  hasDesignTools: boolean;
  draft: EditorDesign;
  hasPublished: boolean;
}

/** Load the panel's visual-editor draft (+ whether a published version exists). */
export async function getCustomDesign(panelId: string): Promise<CustomDesignInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  const state = readEditorState(settings);
  return { hasDesignTools: hasDesignTools(settings), draft: state.draft, hasPublished: state.published !== null };
}

function writeEditorState(settings: Settings, next: EditorState): Settings {
  const design = (settings.design && typeof settings.design === "object" ? settings.design : {}) as Record<string, unknown>;
  return { ...settings, design: { ...design, editor: next } };
}

/** Save the working draft. Requires Design Tools (Business). */
export async function saveCustomDesignDraft(panelId: string, draft: EditorDesign): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  if (!hasDesignTools(settings)) {
    return { ok: false, error: "The visual editor is included with the Business plan." };
  }
  if (!draft || typeof draft !== "object" || !draft.page) return { ok: false, error: "Invalid design." };
  const state = readEditorState(settings);
  const updated = writeEditorState(settings, { draft, published: state.published });
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Publish the current draft to the storefront (snapshot draft → published). */
export async function publishCustomDesign(panelId: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  if (!hasDesignTools(settings)) return { ok: false, error: "The visual editor is included with the Business plan." };
  const state = readEditorState(settings);
  const updated = writeEditorState(settings, { draft: state.draft, published: state.draft });
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  await ctx.admin.from("audit_logs").insert({ panel_id: panelId, actor_id: ctx.user.id, action: "design.editor_published", meta: {} });
  return { ok: true, data: null };
}

/** Take the custom design off the storefront (keeps the draft to edit later). */
export async function unpublishCustomDesign(panelId: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  const state = readEditorState(settings);
  const updated = writeEditorState(settings, { draft: state.draft, published: null });
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Reset the draft to a fresh starter composition. */
export async function resetCustomDesign(panelId: string): Promise<Result<EditorDesign>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const settings = toSettings(ctx.panel.settings);
  if (!hasDesignTools(settings)) return { ok: false, error: "The visual editor is included with the Business plan." };
  const state = readEditorState(settings);
  const fresh = starterDesign();
  const updated = writeEditorState(settings, { draft: fresh, published: state.published });
  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: fresh };
}

/* ---------------------------------------------------------------- library ---- */

export interface DesignLibraryInfo {
  owned: string[];
  active: string | null;
  /** This panel's own Innvil balance. */
  innvilBalance: number;
  /** Total across ALL the owner's panels — what a purchase can draw from. */
  ownerBalance: number;
}

/** Every panel this user owns, with its Innvil balance (funds are effectively a pool). */
async function ownerPanelBalances(admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"], userId: string) {
  const { data } = await admin.from("panels").select("id, settings").eq("owner_id", userId);
  return ((data as Array<{ id: string; settings: unknown }> | null) ?? []).map((p) => ({
    id: p.id,
    settings: toSettings(p.settings),
    balance: toBalance(toSettings(p.settings).innvil_balance),
  }));
}

export async function getDesignLibrary(panelId: string): Promise<DesignLibraryInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  const lib = readDesignLibrary(settings);
  const all = await ownerPanelBalances(ctx.admin, ctx.user.id);
  return {
    owned: lib.owned,
    active: lib.active,
    innvilBalance: toBalance(settings.innvil_balance),
    ownerBalance: round4(all.reduce((sum, p) => sum + p.balance, 0)),
  };
}

/**
 * One-time purchase of a marketplace design, charged from the panel's Innvil balance.
 * The design is then owned FOREVER — deactivating or switching never revokes it.
 */
export async function buyDesign(panelId: string, designId: string): Promise<Result<DesignLibraryInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };

  const pkg = getDesignPackage(designId);
  if (!pkg) return { ok: false, error: "That design isn't available for purchase yet." };
  if (pkg.meta.status !== "published") return { ok: false, error: "That design is still in the studio." };

  const settings = toSettings(ctx.panel.settings);
  const lib = readDesignLibrary(settings);
  if (lib.owned.includes(designId)) return { ok: false, error: "You already own this design." };

  // Effective price = super-admin override + first-purchase promo (first design on this panel).
  const pricing = await getDesignPricing();
  const eff = effectivePrice(pkg.meta.price, pricing[designId], { firstPurchase: lib.owned.length === 0 });
  const price = eff.price;

  /* Innvil funds live per-panel but behave as ONE POOL for the owner (that's the
     balance shown in the topbar). So a purchase draws from this panel first, then the
     owner's other panels (largest first) until it's covered. */
  const all = await ownerPanelBalances(ctx.admin, ctx.user.id);
  const total = round4(all.reduce((sum, p) => sum + p.balance, 0));
  if (total < price) {
    return { ok: false, error: `This design costs $${price.toFixed(2)} — your Innvil balance is $${total.toFixed(2)}. Top up in Billing → Add funds.` };
  }

  const targetBalance = all.find((p) => p.id === panelId)?.balance ?? 0;
  const fromTarget = Math.min(price, targetBalance);
  let remaining = round4(price - fromTarget);

  const externals: Array<{ id: string; settings: Settings; before: number; take: number }> = [];
  for (const p of all.filter((x) => x.id !== panelId).sort((a, b) => b.balance - a.balance)) {
    if (remaining <= 0) break;
    const take = round4(Math.min(remaining, p.balance));
    if (take <= 0) continue;
    externals.push({ id: p.id, settings: p.settings, before: p.balance, take });
    remaining = round4(remaining - take);
  }
  if (remaining > 0) return { ok: false, error: "Couldn't cover the price from your panel balances." };

  /* Charge the other panels FIRST and roll them back on failure, so a design is never
     granted without payment. */
  const charged: typeof externals = [];
  for (const c of externals) {
    const { error } = await ctx.admin
      .from("panels")
      .update({ settings: { ...c.settings, innvil_balance: round4(c.before - c.take) } })
      .eq("id", c.id);
    if (error) {
      for (const done of charged) {
        await ctx.admin.from("panels").update({ settings: { ...done.settings, innvil_balance: done.before } }).eq("id", done.id);
      }
      return { ok: false, error: "Payment failed — nothing was charged." };
    }
    charged.push(c);
  }

  const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;
  const design = (addons.design && typeof addons.design === "object" ? addons.design : {}) as Record<string, unknown>;
  const owned = [...lib.owned, designId];
  const updated = {
    ...settings,
    innvil_balance: round4(targetBalance - fromTarget),
    addons: { ...addons, design: { ...design, owned, active: lib.active } },
  };

  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) {
    for (const done of charged) {
      await ctx.admin.from("panels").update({ settings: { ...done.settings, innvil_balance: done.before } }).eq("id", done.id);
    }
    return { ok: false, error: error.message };
  }

  await ctx.admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: ctx.user.id,
    action: "design.purchased",
    meta: {
      designId,
      price,
      from_panel: fromTarget,
      from_other_panels: externals.map((c) => ({ panel_id: c.id, amount: c.take })),
      owner_balance_after: round4(total - price),
    },
  });

  return {
    ok: true,
    data: {
      owned,
      active: lib.active,
      innvilBalance: round4(targetBalance - fromTarget),
      ownerBalance: round4(total - price),
    },
  };
}

/** Apply an owned design to the storefront landing, or pass null to go back to the default. */
export async function activateDesign(panelId: string, designId: string | null): Promise<Result<DesignLibraryInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };

  const settings = toSettings(ctx.panel.settings);
  const lib = readDesignLibrary(settings);
  if (designId && !lib.owned.includes(designId)) {
    return { ok: false, error: "You don't own that design yet." };
  }

  const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;
  const design = (addons.design && typeof addons.design === "object" ? addons.design : {}) as Record<string, unknown>;
  const updated = { ...settings, addons: { ...addons, design: { ...design, owned: lib.owned, active: designId } } };

  const { error } = await ctx.admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  await ctx.admin.from("audit_logs").insert({
    panel_id: panelId, actor_id: ctx.user.id, action: "design.activated", meta: { designId },
  });

  const all = await ownerPanelBalances(ctx.admin, ctx.user.id);
  return {
    ok: true,
    data: {
      owned: lib.owned,
      active: designId,
      innvilBalance: toBalance(settings.innvil_balance),
      ownerBalance: round4(all.reduce((sum, p) => sum + p.balance, 0)),
    },
  };
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
