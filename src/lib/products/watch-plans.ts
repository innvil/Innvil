/**
 * Customer-facing Innvil Watch plan display names — Bronze/Silver/Gold/
 * Platinum/BYO 20, Enterprise unchanged. This is a DISPLAY-NAME layer only:
 * the stable internal plan identity (`ModeratorPlanTier` — "basic"/
 * "standard"/"premium"/"pro"/"byo20") and every entitlement/pricing constant
 * in `money.ts` are completely UNCHANGED. Ownership must never key off a
 * display name — this file has no bearing on entitlement resolution, it
 * only maps an internal tier to what a customer sees.
 *
 * PRICING: prices are read directly from `money.ts` (the authoritative
 * source), never duplicated here — as of the 2026-08-26 repricing:
 * Basic/Bronze $29.99, Standard/Silver $59.99, Premium/Gold $99.99,
 * Pro/Platinum $149.99, BYO 20 $169.99. An explicit, separate billing
 * decision — see the dated changelog entry for when this was approved.
 */

import {
  moderatorPlanPrice, moderatorEnterpriseSlotPrice, moderatorEnterpriseIncludedCommunities,
  MODERATOR_ENTERPRISE_MIN_SLOTS, MODERATOR_COMMUNITY_CAPACITY, type ModeratorPlanTier,
} from "@/src/lib/money";
import { CAPACITY, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";

export type WatchPlanDisplayName = "Bronze" | "Silver" | "Gold" | "Platinum" | "BYO 20" | "Enterprise";

const TIER_TO_DISPLAY: Record<ModeratorPlanTier, WatchPlanDisplayName> = {
  basic: "Bronze",
  standard: "Silver",
  premium: "Gold",
  pro: "Platinum",
  byo20: "BYO 20",
};

const DISPLAY_TO_TIER: Record<Exclude<WatchPlanDisplayName, "Enterprise">, ModeratorPlanTier> = {
  Bronze: "basic",
  Silver: "standard",
  Gold: "premium",
  Platinum: "pro",
  "BYO 20": "byo20",
};

/** Stable internal tier -> the name a Watch customer actually sees. */
export function watchPlanDisplayName(tier: ModeratorPlanTier): WatchPlanDisplayName {
  return TIER_TO_DISPLAY[tier];
}

/** Same as watchPlanDisplayName, but also accepts "trial"/"enterprise" --
 *  the ONE display helper every surface that renders `AccountCapacity.tier`
 *  should call (WatchShell sidebar, Overview, Usage), so neither "trial"
 *  nor "enterprise" ever gets passed into watchPlanDisplayName (which has
 *  no entry for either) or shown as the raw internal string.
 *
 *  `enterpriseDetail` (optional) distinguishes the real Enterprise
 *  packages -- Managed vs. BYO 50 vs. BYO Unlimited -- rather than always
 *  showing the generic "Managed Enterprise" regardless of a BYO account's
 *  actual mode (a real customer-facing bug, fixed 2026-08-25: a BYO
 *  account was shown "Managed Enterprise" everywhere). Omitted (or
 *  `apiSourceMode: "managed"`) keeps the original "Managed Enterprise"
 *  behavior unchanged. `slots` should be `AccountCapacity.enterpriseSlots`
 *  (50, or `null` for BYO Unlimited) -- an off-menu slot count under BYO
 *  falls back to a generic "BYO Enterprise" label rather than guessing
 *  which real package it corresponds to. */
export function watchAccessLabel(
  tier: ModeratorPlanTier | "trial" | "enterprise",
  enterpriseDetail?: { apiSourceMode: "managed" | "byo"; slots: number | null }
): string {
  if (tier === "trial") return "Free Trial";
  if (tier === "enterprise") {
    if (!enterpriseDetail || enterpriseDetail.apiSourceMode === "managed") return "Managed Enterprise";
    if (enterpriseDetail.slots === 50) return "BYO 50";
    if (enterpriseDetail.slots === null) return "BYO Unlimited";
    return "BYO Enterprise";
  }
  return watchPlanDisplayName(tier);
}

/** Formats a capacity number for display -- `Infinity` (BYO Unlimited's
 *  real sentinel for "no ceiling", see AccountCapacity.slotsTotal) renders
 *  as "Unlimited" rather than the literal string "Infinity" or a broken
 *  "∞/∞" ratio. Every other finite value renders as its plain number. */
export function formatSlotLimit(n: number): string {
  return Number.isFinite(n) ? String(n) : "Unlimited";
}

/** Display name -> stable internal tier, for form input / checkout. Never
 *  accepts "Enterprise" (contact-only, not a self-serve tier — see
 *  MODERATOR_ENTERPRISE_MIN_SLOTS). */
export function watchTierFromDisplayName(name: Exclude<WatchPlanDisplayName, "Enterprise">): ModeratorPlanTier {
  return DISPLAY_TO_TIER[name];
}

export interface WatchPlanOption {
  tier: ModeratorPlanTier;
  displayName: WatchPlanDisplayName;
  price: number;
  /** Watcher slot allowance -- one slot = one active Watcher-to-Community
   *  deployment (see CAPACITY in moderator/plan.ts, the same table
   *  deployAccountWatcher/checkDeploymentSlotCaps enforce against). */
  slots: number;
  /** Telegram Community allowance included with the base subscription. */
  communitiesIncluded: number;
  /** How far this plan's Community allowance can be expanded before
   *  needing another tier/Enterprise (money.ts's MODERATOR_COMMUNITY_
   *  CAPACITY[tier].maxWithAddons -- the SAME ceiling
   *  moderatorCommunityExpansionCeiling() in moderator/plan.ts reads).
   *  Equal to `communitiesIncluded` for Bronze/Silver (hard-capped, no
   *  expansion) and strictly greater for Gold/Platinum. */
  communitiesMax: number;
}

/** The 4 self-serve plan options, in ascending order, for a plan picker —
 *  reads live prices/slot/community allowances from money.ts and
 *  moderator/plan.ts (the SAME canonical tables enforcement itself reads),
 *  never a duplicated number. There is no real "Media Moderation Units"
 *  allowance anywhere in this codebase yet (no media-usage metering system
 *  exists -- see Phase 4.S in CLAUDE.md, explicitly documented as a future
 *  plan, not implemented) -- deliberately not included here rather than
 *  showing a fabricated number. */
export function watchPlanOptions(): WatchPlanOption[] {
  const tiers: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro", "byo20"];
  return tiers.map((tier) => ({
    tier,
    displayName: watchPlanDisplayName(tier),
    price: moderatorPlanPrice(tier),
    slots: CAPACITY[tier].maxActiveSlots,
    communitiesIncluded: CAPACITY[tier].maxCommunities,
    communitiesMax: MODERATOR_COMMUNITY_CAPACITY[tier].maxWithAddons,
  }));
}

export { moderatorEnterpriseSlotPrice, moderatorEnterpriseIncludedCommunities, MODERATOR_ENTERPRISE_MIN_SLOTS, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY };

/** Watcher Presence Scheduling (Phase 4.U) eligibility -- Silver/Gold/
 *  Platinum + Enterprise, per the feature's own spec table. Bronze and the
 *  Free Trial are excluded. A SINGLE pure function, reused for BOTH the UI
 *  gate (show the tab / show an upsell note) and the cron sweep's own
 *  server-side re-check -- the two can never disagree about eligibility. */
export function presenceSchedulingEligible(tier: ModeratorPlanTier | "trial" | "enterprise" | null): boolean {
  return tier === "standard" || tier === "premium" || tier === "pro" || tier === "byo20" || tier === "enterprise";
}

/** Auto-Posting (Phase 4.N part B, extended to standalone accounts in
 *  4.N.1) -- any active PAID tier (Basic/Bronze and up) or Enterprise; the
 *  trial explicitly stays excluded, mirroring moderator/plan.ts's
 *  virtualModContentGeneration exactly (the SAME entitlement rule, just
 *  read from the account-scoped AccountCapacity.tier instead of a
 *  panels.settings-shaped object -- the runtime sweep itself still calls
 *  virtualModContentGeneration directly via resolveStandaloneModeratorSettings,
 *  never this function, so the two can never drift apart in practice; this
 *  is purely for UI/action-layer gating that only has a tier in hand). */
export function autoPostingEligible(tier: ModeratorPlanTier | "trial" | "enterprise" | null): boolean {
  return tier === "basic" || tier === "standard" || tier === "premium" || tier === "pro" || tier === "byo20" || tier === "enterprise";
}
