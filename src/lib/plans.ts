/**
 * Campaign Automation subscription plans (per-panel, owner-subscribed). The panel
 * OWNER subscribes to a monthly tier from the panel's Innvil balance; the tier
 * decides which platforms customers may automate and unlocks the top-tier extras.
 * Separately, each CUSTOMER subscribes to the automator itself for a fixed $6.99/mo
 * (see automator-sub.ts) — that's the owner's revenue, not gated here.
 *
 * State lives in panels.settings.addons.plan. Pure/serializable — safe anywhere.
 *
 * Tiers (v2, user-confirmed 2026-07-25):
 *   pro          $9.99  — X, Instagram, TikTok only.
 *   business     $19.99 — + Facebook, YouTube, LinkedIn, Threads, Telegram; bundles AI support + design tools.
 *   business_plus $49.99 — ALL owner platforms + file upload + watched accounts / full-auto.
 */

import type { CampaignPlatform } from "@/src/lib/automation/links";

export type PlanTier = "pro" | "business" | "business_plus";
const TIERS: PlanTier[] = ["pro", "business", "business_plus"];

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
        const tier = TIERS.includes(o.tier as PlanTier) ? (o.tier as PlanTier) : null;
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

/* -------------------------------------------------------------- platforms ---- */

/** Platforms Pro unlocks. */
const PRO_PLATFORMS: CampaignPlatform[] = ["x", "instagram", "tiktok"];
/** Platforms Business ADDS on top of Pro. */
const BUSINESS_EXTRA: CampaignPlatform[] = ["facebook", "youtube", "linkedin", "threads", "telegram"];

/** The campaign platforms a tier allows. `null` = ALL of the owner's services (Business+). */
export function tierPlatforms(tier: PlanTier | null): CampaignPlatform[] | null {
  if (tier === "business_plus") return null; // no limit
  if (tier === "business") return [...PRO_PLATFORMS, ...BUSINESS_EXTRA];
  if (tier === "pro") return [...PRO_PLATFORMS];
  return [];
}

/** Whether the panel's current tier allows automating this platform. */
export function automatorPlatformAllowed(settings: unknown, platform: string): boolean {
  const allowed = tierPlatforms(planTier(settings));
  if (allowed === null) return true;               // Business+ = all
  return allowed.includes(platform as CampaignPlatform);
}

/* ---------------------------------------------------------------- gating ---- */

/** Campaign Automation is OFFERED on the storefront when the owner has any active tier. */
export function hasCampaignAutomation(settings: unknown): boolean {
  return planTier(settings) !== null;
}

/** File upload (csv/xlsx/docx) — Business+ only. */
export function hasFileUpload(settings: unknown): boolean {
  return planTier(settings) === "business_plus";
}
/** @deprecated use hasFileUpload — kept so older imports don't break. */
export const hasFileImport = hasFileUpload;

/** Watched accounts / full-auto ordering — Business+ only. */
export function hasWatchedAccounts(settings: unknown): boolean {
  return planTier(settings) === "business_plus";
}

/** Max links per campaign: Pro 250, Business/Business+ unlimited, none = 0. */
export function campaignLinkLimit(settings: unknown): number {
  const t = planTier(settings);
  if (t === "business" || t === "business_plus") return Number.POSITIVE_INFINITY;
  if (t === "pro") return 250;
  return 0;
}

/** Business and Business+ bundle the AI support add-on (customer chat). */
export function planBundlesSupport(settings: unknown): boolean {
  const t = planTier(settings);
  return t === "business" || t === "business_plus";
}

/** Master switch for the Design Tools (dashboard layout builder + visual editor).
 *  OFF for now — the editor only reorders today; it needs nav/section placement,
 *  hamburger/dropdown layout, etc. before launch. Flip to true to re-enable the
 *  Business/Business+ entitlement everywhere it's gated. */
export const DESIGN_TOOLS_ENABLED = false;

/** Design Tools (dashboard layout builder + visual editor) — Business and above,
 *  once launched. Gated off entirely while DESIGN_TOOLS_ENABLED is false. */
export function hasDesignTools(settings: unknown): boolean {
  if (!DESIGN_TOOLS_ENABLED) return false;
  const t = planTier(settings);
  return t === "business" || t === "business_plus";
}
