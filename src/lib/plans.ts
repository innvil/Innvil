/**
 * Campaign Automation subscription plans (per-panel). The panel OWNER subscribes to
 * Pro or Business (monthly, from the panel's Innvil balance); this unlocks the
 * customer-facing Campaign Automation surface on the storefront. Business also
 * bundles the AI Support add-on and unlocks file imports + unlimited links.
 *
 * State lives in panels.settings.addons.plan. Pure/serializable — safe to import
 * anywhere; gating booleans are passed to the client via props.
 */

export type PlanTier = "pro" | "business";

export interface PlanSub {
  tier: PlanTier | null;
  since: string | null;
  lastChargeAt: string | null;
  nextChargeAt: string | null;
  /** true when a scheduled charge failed for lack of balance (paused until funded). */
  lapsed: boolean;
}

export function readPlan(settings: unknown): PlanSub {
  const off: PlanSub = { tier: null, since: null, lastChargeAt: null, nextChargeAt: null, lapsed: false };
  if (settings && typeof settings === "object") {
    const addons = (settings as Record<string, unknown>).addons;
    if (addons && typeof addons === "object") {
      const p = (addons as Record<string, unknown>).plan;
      if (p && typeof p === "object") {
        const o = p as Record<string, unknown>;
        const tier = o.tier === "pro" || o.tier === "business" ? (o.tier as PlanTier) : null;
        return {
          tier,
          since: typeof o.since === "string" ? o.since : null,
          lastChargeAt: typeof o.lastChargeAt === "string" ? o.lastChargeAt : null,
          nextChargeAt: typeof o.nextChargeAt === "string" ? o.nextChargeAt : null,
          lapsed: o.lapsed === true,
        };
      }
    }
  }
  return off;
}

export function planTier(settings: unknown): PlanTier | null {
  return readPlan(settings).tier;
}

/** Campaign Automation is available on any active plan (Pro or Business). */
export function hasCampaignAutomation(settings: unknown): boolean {
  return planTier(settings) !== null;
}

/** File import (CSV/TXT/PDF/DOCX) is a Business-tier feature. */
export function hasFileImport(settings: unknown): boolean {
  return planTier(settings) === "business";
}

/** Max links per campaign: Pro 250, Business unlimited, none = 0. */
export function campaignLinkLimit(settings: unknown): number {
  const t = planTier(settings);
  if (t === "business") return Number.POSITIVE_INFINITY;
  if (t === "pro") return 250;
  return 0;
}

/** Business bundles the AI support add-on (customer chat) at no extra charge. */
export function planBundlesSupport(settings: unknown): boolean {
  return planTier(settings) === "business";
}

/** Design Tools (dashboard layout builder + custom landing HTML editor) are bundled
 *  into Business. Premium landing templates are bought à la carte (own forever),
 *  separate from this. */
export function hasDesignTools(settings: unknown): boolean {
  return planTier(settings) === "business";
}
