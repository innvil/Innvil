"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { readPlan, type PlanTier } from "@/src/lib/plans";
import { readSupportSub } from "@/src/lib/ai/addon";
import { INNVIL_PRO_PRICE, INNVIL_BUSINESS_PRICE, PLAN_PERIOD_DAYS, planPrice, round4 } from "@/src/lib/money";

/* =========================================================
   Campaign Automation subscription (per-panel, owner-facing).
   The owner subscribes to Pro / Business (monthly, from the panel's Innvil balance)
   to unlock the customer-facing Campaign Automation surface. Business also bundles
   the AI Support add-on. Reuses the add-on charge/settle pattern; the recurring
   charge is swept by the bill-addons cron.
   ========================================================= */

type Settings = Record<string, unknown>;
function toSettings(v: unknown): Settings {
  return v && typeof v === "object" ? (v as Settings) : {};
}
function toBalance(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, name, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface PlanInfo {
  tier: PlanTier | null;
  lapsed: boolean;
  nextChargeAt: string | null;
  since: string | null;
  innvilBalance: number;
  proPrice: number;
  businessPrice: number;
  bundlesSupport: boolean; // true on Business
}

export async function getPlan(panelId: string): Promise<PlanInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const settings = toSettings(ctx.panel.settings);
  const p = readPlan(settings);
  return {
    tier: p.tier,
    lapsed: p.lapsed,
    nextChargeAt: p.nextChargeAt,
    since: p.since,
    innvilBalance: toBalance(settings.innvil_balance),
    proPrice: INNVIL_PRO_PRICE,
    businessPrice: INNVIL_BUSINESS_PRICE,
    bundlesSupport: p.tier === "business",
  };
}

/** Subscribe/switch to a tier (charges that tier's price now) or cancel (tier=null). */
export async function setPlan(panelId: string, tier: PlanTier | null): Promise<Result<PlanInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { admin, user, panel } = ctx;
  const settings = toSettings(panel.settings);
  const cur = readPlan(settings);
  const addons = (settings.addons && typeof settings.addons === "object" ? settings.addons : {}) as Record<string, unknown>;

  if (tier === null) {
    const updated = { ...settings, addons: { ...addons, plan: { ...cur, tier: null, nextChargeAt: null, lapsed: false } } };
    const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
    if (error) return { ok: false, error: error.message };
    await admin.from("audit_logs").insert({ panel_id: panelId, actor_id: user.id, action: "plan.canceled", meta: { from: cur.tier } });
    const info = await getPlan(panelId);
    return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
  }

  if (cur.tier === tier) return { ok: false, error: `Already on ${tier === "business" ? "Business" : "Pro"}.` };

  const price = planPrice(tier);
  const balance = toBalance(settings.innvil_balance);
  if (balance < price) {
    return { ok: false, error: `You need at least $${price.toFixed(2)} in this panel's Innvil balance. Top up in Billing → Add funds, then subscribe.` };
  }
  const now = new Date();
  const next = new Date(now.getTime() + PLAN_PERIOD_DAYS * 86400000);
  const nextAddons: Record<string, unknown> = {
    ...addons,
    plan: { tier, since: cur.since ?? now.toISOString(), lastChargeAt: now.toISOString(), nextChargeAt: next.toISOString(), lapsed: false },
  };
  // Business bundles AI support → turn off any separately-paid ai_support sub so the
  // owner isn't double-charged (customerSupportActive stays true via the plan).
  if (tier === "business") {
    const sup = readSupportSub(settings);
    if (sup.enabled) nextAddons.ai_support = { ...sup, enabled: false, nextChargeAt: null, lapsed: false };
  }
  const updated = { ...settings, innvil_balance: round4(balance - price), addons: nextAddons };
  const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: user.id,
    action: "plan.charged",
    meta: { tier, amount: price, balance_after: round4(balance - price), reason: cur.tier ? "switch" : "subscribe" },
  });
  const info = await getPlan(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Could not read state." };
}
