/**
 * Customer-facing Innvil Watch plan display names — Bronze/Silver/Gold/
 * Platinum, Enterprise unchanged. This is a DISPLAY-NAME layer only: the
 * stable internal plan identity (`ModeratorPlanTier` — "basic"/"standard"/
 * "premium"/"pro") and every entitlement/pricing constant in `money.ts` are
 * completely UNCHANGED. Ownership must never key off a display name — this
 * file has no bearing on entitlement resolution, it only maps an internal
 * tier to what a customer sees.
 *
 * PRICING NOTE (reported, not silently changed): the live prices below are
 * read directly from `money.ts` (the authoritative source) — currently
 * Basic/Bronze $49.99, Standard/Silver $114.99, Premium/Gold $209.99,
 * Pro/Platinum $359.99. CLAUDE.md's own "Phase 4.S — future plan" note
 * already documents an INTENDED (not yet applied) future price of $129.99
 * for Silver — this file deliberately does NOT apply that bump; changing a
 * live price is a separate, explicit billing decision, not a side effect of
 * a display-name rename.
 */

import { moderatorPlanPrice, moderatorEnterpriseSlotPrice, MODERATOR_ENTERPRISE_MIN_SLOTS, type ModeratorPlanTier } from "@/src/lib/money";

export type WatchPlanDisplayName = "Bronze" | "Silver" | "Gold" | "Platinum" | "Enterprise";

const TIER_TO_DISPLAY: Record<ModeratorPlanTier, WatchPlanDisplayName> = {
  basic: "Bronze",
  standard: "Silver",
  premium: "Gold",
  pro: "Platinum",
};

const DISPLAY_TO_TIER: Record<Exclude<WatchPlanDisplayName, "Enterprise">, ModeratorPlanTier> = {
  Bronze: "basic",
  Silver: "standard",
  Gold: "premium",
  Platinum: "pro",
};

/** Stable internal tier -> the name a Watch customer actually sees. */
export function watchPlanDisplayName(tier: ModeratorPlanTier): WatchPlanDisplayName {
  return TIER_TO_DISPLAY[tier];
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
}

/** The 4 self-serve plan options, in ascending order, for a plan picker —
 *  reads live prices from money.ts, never hardcodes a number here. */
export function watchPlanOptions(): WatchPlanOption[] {
  const tiers: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro"];
  return tiers.map((tier) => ({ tier, displayName: watchPlanDisplayName(tier), price: moderatorPlanPrice(tier) }));
}

export { moderatorEnterpriseSlotPrice, MODERATOR_ENTERPRISE_MIN_SLOTS };
