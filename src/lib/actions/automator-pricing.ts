"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  readAutomatorPricing,
  normalizeAutomatorPricing,
  suggestedAutomatorPrice,
  baseAutomatorPrice,
  effectiveAutomatorPrice,
  type AutomatorPricing,
} from "@/src/lib/automation/pricing";
import { hasFileUpload, hasWatchedAccounts, planTier } from "@/src/lib/plans";

/* =========================================================
   Owner-facing pricing for the CUSTOMER Automator subscription.
   The owner sets what their customers pay (default $6.99, or $9.99 on Business+ which
   also unlocks file upload + watched accounts), and can run a promo/discount. This is
   pure config on panels.settings.automator — the full customer charge is owner revenue.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

export interface AutomatorPricingInfo extends AutomatorPricing {
  /** The tier's suggested default (what an empty override falls back to). */
  suggested: number;
  /** The non-promo price the customer would pay (override or suggested). */
  base: number;
  /** What the customer pays now (promo applied). */
  effective: number;
  /** Business+ perks the customer subscription unlocks (follow the owner tier). */
  fileUpload: boolean;
  watchedAccounts: boolean;
  /** true once the owner has any active tier (otherwise the automator isn't offered). */
  offered: boolean;
}

export async function getAutomatorPricing(panelId: string): Promise<AutomatorPricingInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const s = ctx.panel.settings;
  return {
    ...readAutomatorPricing(s),
    suggested: suggestedAutomatorPrice(s),
    base: baseAutomatorPrice(s),
    effective: effectiveAutomatorPrice(s),
    fileUpload: hasFileUpload(s),
    watchedAccounts: hasWatchedAccounts(s),
    offered: planTier(s) !== null,
  };
}

export async function setAutomatorPricing(
  panelId: string,
  input: Partial<AutomatorPricing>
): Promise<Result<AutomatorPricingInfo>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { admin, user, panel } = ctx;

  const clean = normalizeAutomatorPricing(input);
  const settings = (panel.settings && typeof panel.settings === "object" ? panel.settings : {}) as Record<string, unknown>;

  if (clean.promoActive && clean.promoPrice == null) {
    return { ok: false, error: "Set a promo price to run a promo, or turn the promo off." };
  }
  if (clean.promoActive && clean.promoPrice != null && clean.promoPrice >= baseAutomatorPrice({ ...settings, automator: clean })) {
    return { ok: false, error: "The promo price must be below the regular price." };
  }

  const updated = { ...settings, automator: clean };
  const { error } = await admin.from("panels").update({ settings: updated }).eq("id", panelId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    panel_id: panelId,
    actor_id: user.id,
    action: "automator.pricing_updated",
    meta: { price: clean.price, promoActive: clean.promoActive, promoPrice: clean.promoPrice },
  });

  const info = await getAutomatorPricing(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Saved, but couldn't read state." };
}
