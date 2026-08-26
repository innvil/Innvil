import type { MarkupKind } from "@/src/types/db";

/** 4-dp rounding to match the DB numeric(12,4) columns. */
export function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

/** Innvil's default platform commission on completed-order revenue (5%, no monthly rent). */
export const INNVIL_COMMISSION_RATE = 0.05;
/** Lowest commission rate a high-volume panel can be discounted to (1%). */
export const INNVIL_MIN_COMMISSION_RATE = 0.01;
/** Hard cap on commission Innvil takes from ONE panel in a single day. Mirror of the SQL (0020). */
export const INNVIL_COMMISSION_CAP_PER_DAY = 100;

/** Monthly price (USD, from the panel's Innvil balance) of the optional CUSTOMER AI
 *  SUPPORT add-on — the owner pays to give their storefront customers AI support.
 *  The owner's own assistant (contacting Innvil) is free. Panel core stays 0% rent. */
export const AI_ADDON_PRICE = 2.99;
/** Billing period length for the paid AI add-on. */
export const AI_ADDON_PERIOD_DAYS = 30;

/** Campaign Automation subscription tiers (monthly, USD, from the panel's Innvil
 *  balance). Business bundles the AI support add-on. Panel core stays 0% rent. */
export const INNVIL_PRO_PRICE = 9.99;
export const INNVIL_BUSINESS_PRICE = 19.99;
export const INNVIL_BUSINESS_PLUS_PRICE = 49.99;
export const PLAN_PERIOD_DAYS = 30;
export function planPrice(tier: "pro" | "business" | "business_plus"): number {
  if (tier === "business_plus") return INNVIL_BUSINESS_PLUS_PRICE;
  if (tier === "business") return INNVIL_BUSINESS_PRICE;
  return INNVIL_PRO_PRICE;
}

/** Innvil Virtual Moderator — CUSTOMER-facing subscription prices (monthly, USD).
 *  This is a storefront product: the panel's CUSTOMER pays this from their own
 *  panel wallet (customer_accounts.balance), not the owner's Innvil balance —
 *  see src/lib/moderator/customer-entitlement.ts and actions/customer-moderator.ts.
 *  Slot counts mirror the existing ModeratorCapacity table in moderator/plan.ts
 *  (CAPACITY) exactly — same tier names, same numbers, reused rather than
 *  duplicated. Repriced 2026-08-22 (Basic/Bronze $49.99->$29.99, Standard/Silver
 *  $129.99->$59.99, Premium/Gold $219.99->$99.99, Pro/Platinum $379.99->$199.00)
 *  as part of the same repricing that introduced the fixed Enterprise packages
 *  above -- Enterprise's fixed $399/$299/$499 packages are flat constants and
 *  are NOT derived from MODERATOR_PRO_PRICE, so this change doesn't move them.
 *  Repriced AGAIN 2026-08-25 (Pro/Platinum $199.00->$149.99 -- the Gold->Platinum
 *  jump was too large) alongside the new BYO 20 tier below -- a CUSTOM Managed
 *  quote above 50 slots (moderatorEnterpriseSlotPrice) still derives its base
 *  from MODERATOR_PRO_PRICE and moves with it (see its own updated worked
 *  examples further down); the fixed Enterprise packages remain unaffected. */
export const MODERATOR_BASIC_PRICE = 29.99;
export const MODERATOR_STANDARD_PRICE = 59.99;
export const MODERATOR_PREMIUM_PRICE = 99.99;
export const MODERATOR_PRO_PRICE = 149.99;
/** BYO 20 (2026-08-25) -- a 5th self-serve, checkout-purchasable tier where
 *  the customer supplies their OWN AI provider credential from day one
 *  (never Innvil's) -- 20 Watcher slots, 10 Communities FIXED (never
 *  expandable, unlike Gold/Platinum), and 3,000 Media Moderation units
 *  BUNDLED into the base price (never a separate purchase, unlike the other
 *  4 tiers' optional Media Moderation + add-on). Priced above Platinum,
 *  deliberately: since BYO shifts AI compute cost off Innvil's books,
 *  Innvil can bundle strictly more included capacity for a similar-or-
 *  higher headline price without it reading as "why would anyone pick
 *  Platinum" -- marketed as the best-value flagship tier. */
export const MODERATOR_BYO20_PRICE = 199.99;
export const MODERATOR_PLAN_PERIOD_DAYS = 30;

/** Direct/resell mode ONLY (see ModeratorCommercialMode in moderator/plan.ts):
 *  the customer pays Innvil directly; the panel owner is credited this share
 *  to their own Innvil wallet (never cash, stays inside the Innvil ecosystem).
 *  Rental/wholesale mode uses MODERATOR_RENTAL_DISCOUNT instead, never this —
 *  the two commercial modes are mutually exclusive per transaction. */
export const MODERATOR_COMMISSION_SHARE = 0.05;
/** Rental/wholesale mode ONLY: the panel owner buys Moderator capacity from
 *  Innvil at this discount below standard list price, then resells to their
 *  OWN customer at whatever price they choose, keeping 100% of that resale —
 *  no MODERATOR_COMMISSION_SHARE on top in this mode. */
export const MODERATOR_RENTAL_DISCOUNT = 0.10;

/** More than this many Active Moderator Slots is Enterprise -- contact-only, no
 *  self-serve price or tier constant; see moderator/customer-entitlement.ts. */
export const MODERATOR_ENTERPRISE_MIN_SLOTS = 21;
/** Enterprise slot pricing starts from the Pro base (this many slots included
 *  in MODERATOR_PRO_PRICE) and adds per-slot bands above it. */
const MODERATOR_ENTERPRISE_BASE_SLOTS = 20;
/** Slots 21-50 above the Pro base. */
export const MODERATOR_ENTERPRISE_BAND_1_MAX_SLOTS = 50;
export const MODERATOR_ENTERPRISE_BAND_1_PRICE_PER_SLOT = 15;
/** Slots 51+. */
export const MODERATOR_ENTERPRISE_BAND_2_PRICE_PER_SLOT = 13;

/** "byo20" is a 5th self-serve tier (2026-08-25) -- a genuine checkout tier
 *  like the other 4, not a variant of Enterprise (which has no self-serve
 *  checkout at all). Making it a real ModeratorPlanTier member means every
 *  Record<ModeratorPlanTier, X> map below is compile-time-forced to have an
 *  explicit entry for it -- deliberate, so nothing gets silently missed. */
export type ModeratorPlanTier = "basic" | "standard" | "premium" | "pro" | "byo20";
export function moderatorPlanPrice(tier: ModeratorPlanTier): number {
  if (tier === "byo20") return MODERATOR_BYO20_PRICE;
  if (tier === "pro") return MODERATOR_PRO_PRICE;
  if (tier === "premium") return MODERATOR_PREMIUM_PRICE;
  if (tier === "standard") return MODERATOR_STANDARD_PRICE;
  return MODERATOR_BASIC_PRICE;
}

/** Enterprise (21+ Active Moderator Slots) CUSTOM-quote monthly price --
 *  since the 2026-08-22 repricing, used ONLY for a Managed quote above the
 *  fixed 50-slot Managed Enterprise 50 package (see ENTERPRISE_MANAGED_50_*
 *  above / watch-enterprise.ts's MANAGED_ENTERPRISE_50, a flat $399/mo
 *  constant NOT derived from this formula). Direct-contact/direct-Innvil
 *  sale only -- Enterprise revenue is 100% Innvil's, no panel-owner
 *  commission/rental split ever applies to it.
 *  Worked examples (at the current MODERATOR_PRO_PRICE = $149.99): 50 slots
 *  -> 149.99 + 30*15 = 599.99; 75 slots -> 149.99 + 30*15 + 25*13 = 924.99. */
export function moderatorEnterpriseSlotPrice(totalSlots: number): number {
  const slots = Math.max(MODERATOR_ENTERPRISE_MIN_SLOTS, Math.round(totalSlots));
  const extra = slots - MODERATOR_ENTERPRISE_BASE_SLOTS;
  const band1 = Math.min(extra, MODERATOR_ENTERPRISE_BAND_1_MAX_SLOTS - MODERATOR_ENTERPRISE_BASE_SLOTS);
  const band2 = Math.max(0, extra - band1);
  return round4(
    MODERATOR_PRO_PRICE + band1 * MODERATOR_ENTERPRISE_BAND_1_PRICE_PER_SLOT + band2 * MODERATOR_ENTERPRISE_BAND_2_PRICE_PER_SLOT
  );
}

/** Enterprise included-community bonus -- starts from Pro's 5 included
 *  communities, plus a bump based on how many slots were purchased ABOVE the
 *  Pro base (not the Enterprise minimum). +10..+29 extra slots -> 7 total;
 *  +30 or more -> 8 total. */
export function moderatorEnterpriseIncludedCommunities(totalSlots: number): number {
  const extra = Math.max(0, Math.round(totalSlots) - MODERATOR_ENTERPRISE_BASE_SLOTS);
  if (extra >= 30) return 8;
  if (extra >= 10) return 7;
  return 5;
}

/**
 * Fixed Enterprise packages (2026-08-22 repricing) -- Enterprise is now
 * substantially more accessible via three flat, non-formula packages,
 * rather than requiring the per-slot custom calculation above for the
 * common case. "Unlimited" (BYO) means unlimited LICENSED Watcher
 * deployments only -- never unlimited compute/storage/bandwidth/queues/
 * concurrency/media processing/provider spend; existing fair-use/
 * infrastructure safeguards are unaffected by this pricing change.
 */
export const ENTERPRISE_MANAGED_50_PRICE = 399;
export const ENTERPRISE_MANAGED_50_SLOTS = 50;
/** Innvil-funded, account-pooled (never per-Watcher) monthly AI Generation
 *  allowance for the fixed Managed Enterprise 50 package. There is no
 *  approved rule for scaling this allowance above 50 slots -- additional
 *  Watcher capacity above 50 (see ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE below)
 *  does NOT proportionally increase it; the pool stays 50,000 regardless of
 *  extra slots purchased, since no canonical scaling rule has been approved. */
export const ENTERPRISE_MANAGED_50_AI_GENERATIONS = 50000;
export const ENTERPRISE_BYO_50_PRICE = 299;
export const ENTERPRISE_BYO_50_SLOTS = 50;
export const ENTERPRISE_BYO_UNLIMITED_PRICE = 499;

/**
 * Managed Enterprise pricing ABOVE the fixed 50-slot package (2026-08-22
 * correction) -- supersedes the OLD dynamic Platinum-based per-slot formula
 * (`moderatorEnterpriseSlotPrice`, below), which was still being called for
 * >50 slots and produced a real, reported pricing bug (51 slots priced at
 * ~$662/mo instead of the intended $407/mo). The canonical rule is now a
 * flat, simple continuation of the $399 base: +$8/month for every Watcher
 * slot above 50. Deterministic and integer-cents-exact (both operands are
 * already whole-cent amounts, so no rounding step is needed).
 * Worked examples: 50 slots = $399; 51 = $407; 60 = $479; 75 = $599;
 * 100 = $799; 150 = $1,199.
 *
 * `moderatorEnterpriseSlotPrice`/`moderatorEnterpriseIncludedCommunities`
 * (below) are NOT used by this formula and are no longer called anywhere in
 * the Managed Enterprise pricing path -- they remain only for
 * `resolveAccountEnterpriseEntitlement`'s COMMUNITY count on an existing,
 * manually-provisioned Enterprise entitlement (a separate, narrower
 * capacity concern, not a price), pending the queued Enterprise Community
 * Expansion work.
 *
 * Additional Watcher slots above 50 do NOT change Community capacity or
 * the AI Generation pool -- both stay separate, unaffected axes.
 */
export const ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE = 8;
export function managedEnterprisePriceAtSlots(slots: number): number {
  const wholeSlots = Math.max(ENTERPRISE_MANAGED_50_SLOTS, Math.round(slots));
  if (wholeSlots <= ENTERPRISE_MANAGED_50_SLOTS) return ENTERPRISE_MANAGED_50_PRICE;
  const extraSlots = wholeSlots - ENTERPRISE_MANAGED_50_SLOTS;
  // Integer-cents arithmetic -- both the base and the per-slot rate are
  // already whole dollars, so this is exact with no floating-point drift.
  const totalCents = ENTERPRISE_MANAGED_50_PRICE * 100 + extraSlots * ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE * 100;
  return totalCents / 100;
}

/** Optional Media Moderation + add-on for Enterprise -- layered on top of
 *  any of the three fixed packages above (never bundled into the base
 *  price, never a separate duplicated plan). Provider-neutral "Media
 *  Moderation Units" (see the media-moderation runtime's own unit
 *  semantics -- 1 classified photo or 1 sampled video frame = 1 unit),
 *  never Sightengine-specific terminology/economics exposed here. */
export interface EnterpriseMediaAddonPricing { price: number; units: number; }
export const ENTERPRISE_MEDIA_ADDON: Record<"managed50" | "byo50" | "byoUnlimited", EnterpriseMediaAddonPricing> = {
  managed50: { price: 39.99, units: 8000 },
  byo50: { price: 39.99, units: 8000 },
  byoUnlimited: { price: 49.99, units: 10000 },
};

/** Community entitlement is a SEPARATE axis from Active Moderator Slots (a
 *  purchased community never grants extra slots; deploying into it still
 *  needs an available slot). `included` is what the tier ships with;
 *  `maxWithAddons` is the ceiling paid additional-community purchases may
 *  reach -- Basic/Standard are hard-capped (included === maxWithAddons). */
export interface ModeratorCommunityCapacity {
  included: number;
  maxWithAddons: number;
}
export const MODERATOR_COMMUNITY_CAPACITY: Record<ModeratorPlanTier, ModeratorCommunityCapacity> = {
  basic: { included: 1, maxWithAddons: 1 },
  standard: { included: 2, maxWithAddons: 2 },
  premium: { included: 3, maxWithAddons: 5 },
  pro: { included: 5, maxWithAddons: 10 },
  // byo20's 10 Communities are FIXED forever, by explicit product decision
  // -- included === maxWithAddons is the same hard-cap convention Basic/
  // Standard already use, which is also what correctly keeps it OUT of
  // Community Expansion eligibility (isCommunityExpansionEligibleTier only
  // reads COMMUNITY_EXPANSION_ELIGIBLE_TIERS below, never this table).
  byo20: { included: 10, maxWithAddons: 10 },
};

/** Additional-community pricing (non-Enterprise tiers, within maxWithAddons
 *  above). Buying the plain $9.99 community does NOT enable auto-posting
 *  there -- that's the separate $14.99 option (access + 1 auto-post/day).
 *  NEVER WIRED TO A PURCHASE ACTION -- an old, still-unused Phase 4.N-era
 *  per-Community pricing concept, deliberately superseded (not reused) by
 *  the fixed-package Community Expansion add-on below, which is the real,
 *  live, purchasable model. Kept only because other display copy still
 *  references it; do not build a new purchase flow on top of this constant. */
export const MODERATOR_ADDITIONAL_COMMUNITY_PRICE = 9.99;
export const MODERATOR_ADDITIONAL_COMMUNITY_WITH_AUTOPOST_PRICE = 14.99;

/**
 * Community Expansion -- a real, purchasable, FIXED-package Watch
 * subscription add-on (not per-Community pricing). Gold (premium) and
 * Platinum (pro) only -- Bronze/Standard/Basic are hard-capped
 * (MODERATOR_COMMUNITY_CAPACITY[tier].included === maxWithAddons already
 * enforces this structurally, since there's nothing to expand INTO).
 * Purchasing it raises effective Community capacity from `included` to
 * the SAME canonical `maxWithAddons` ceiling already displayed on Plans --
 * never a separate/duplicated number.
 */
export const COMMUNITY_EXPANSION_ELIGIBLE_TIERS = ["premium", "pro"] as const;
export type CommunityExpansionEligibleTier = (typeof COMMUNITY_EXPANSION_ELIGIBLE_TIERS)[number];

export const COMMUNITY_EXPANSION_MONTHLY_PRICE: Record<CommunityExpansionEligibleTier, number> = {
  premium: 9.99,  // Gold -- 3 included -> 5 total (a fixed capacity package, never per-Community)
  pro: 14.99,     // Platinum -- 5 included -> 10 total
};

export function isCommunityExpansionEligibleTier(tier: ModeratorPlanTier): tier is CommunityExpansionEligibleTier {
  return (COMMUNITY_EXPANSION_ELIGIBLE_TIERS as readonly string[]).includes(tier);
}

/** Auto-posting: every community with it enabled gets this many AI-generated
 *  posts/day included; extra daily frequency is priced per additional
 *  post/day, up to the normal-plan cap. Customer-facing copy must always be
 *  DAILY frequency per community, never a monthly quota. */
export const MODERATOR_AUTOPOST_INCLUDED_PER_DAY = 1;
export const MODERATOR_AUTOPOST_MAX_PER_DAY = 3;
export const MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE = 9.99;

/** Monthly add-on price for N auto-posts/day in ONE community (beyond the
 *  included 1/day) -- e.g. 2/day = +$9.99, 3/day = +$19.98. Extra frequency
 *  never adds a community and never consumes an Active Moderator Slot. */
export function moderatorAutopostFrequencyAddonPrice(postsPerDay: number): number {
  const capped = Math.max(0, Math.min(Math.round(postsPerDay), MODERATOR_AUTOPOST_MAX_PER_DAY));
  const extra = Math.max(0, capped - MODERATOR_AUTOPOST_INCLUDED_PER_DAY);
  return round4(extra * MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE);
}

/** Pooled monthly "AI Generations" allowance -- the customer-facing unit for
 *  CASUAL_CHAT/ANSWER conversational generations only. SILENCE, REACT,
 *  deterministic SHORT_ACK, GM/GN template sends, and no-generation
 *  moderation actions never consume it (no model call happens for any of
 *  them). Pooled per ACCOUNT, never divided/multiplied per Watcher. Enforced
 *  via watch-ai-usage.ts, incremented on a successful PROVIDER generation
 *  (see community-runtime.ts's respondAsDeployment -- counted even if the
 *  subsequent Telegram delivery fails; never counted on a timeout, auth/
 *  provider failure, or a declined/failed generation, and a retried call
 *  that eventually succeeds still counts only once). Repriced 2026-08-22
 *  alongside the base plan price cut (basic 1200->2000, standard 2400->5000,
 *  premium 4200->10000, pro 7200->20000). Enterprise has its own SEPARATE,
 *  much larger fixed pool (ENTERPRISE_MANAGED_50_AI_GENERATIONS above),
 *  never this Record. */
export const MODERATOR_AI_GENERATION_POOL: Record<ModeratorPlanTier, number> = {
  basic: 2000,
  standard: 5000,
  premium: 10000,
  pro: 20000,
  // N/A by design, never actually read in practice: byo20 always routes
  // through the customer's own AI provider credential (never Innvil's), so
  // it never draws from this pool at all -- watch-runtime.ts's paidTier
  // derivation excludes "byo20" from this gate the same way it already
  // excludes "enterprise". 0 exists here only because Record<ModeratorPlanTier,
  // number> requires every tier to have a value.
  byo20: 0,
};

/** Self-serve "Media Moderation +" add-on (2026-08-22) -- an OPTIONAL layer
 *  on top of any of the 4 self-serve tiers (never bundled into the base
 *  price, available to all four, unlike Community Expansion's Gold/Platinum-
 *  only restriction). Real, provisioned via the SAME `watch_subscription_
 *  addons` table Community Expansion already uses (migration 0087,
 *  addon_type='media_moderation') -- never a duplicated add-on architecture
 *  or a separate "Bronze+/Silver+/Gold+/Platinum+" plan identity. Units are
 *  the same provider-neutral "Media Moderation Unit" concept used by
 *  Enterprise's own media add-on (ENTERPRISE_MEDIA_ADDON) -- 1 classified
 *  photo or 1 sampled video frame = 1 unit; never Sightengine-specific
 *  terminology/economics exposed to the customer. Worked totals (base +
 *  add-on): Bronze+ $29.99+$9.99=$39.98, Silver+ $59.99+$14.99=$74.98,
 *  Gold+ $99.99+$19.99=$119.98, Platinum+ $149.99+$24.99=$174.98.
 *  byo20 is the one EXCEPTION to "optional add-on, never bundled" -- its
 *  3,000 units are baked into the $199.99 base price by explicit product
 *  decision (the flagship "everything included" tier), never a separate
 *  purchase; `price: 0` documents that (never actually charged -- the
 *  purchase UI for this addon is hidden entirely for byo20, see
 *  MediaModerationAddonCard.tsx). */
export interface MediaModerationAddonPricing { price: number; units: number; }
export const MODERATOR_MEDIA_ADDON: Record<ModeratorPlanTier, MediaModerationAddonPricing> = {
  basic: { price: 9.99, units: 1000 },
  standard: { price: 14.99, units: 2000 },
  premium: { price: 19.99, units: 3000 },
  pro: { price: 24.99, units: 4000 },
  byo20: { price: 0, units: 3000 },
};

/** Total monthly price for a tier with Media Moderation + enabled -- plain
 *  addition, rounded to 2dp to avoid float display drift, matching the
 *  exact same pattern as `enterprisePackageTotalWithMedia` in
 *  watch-enterprise.ts. */
export function moderatorPlanTotalWithMediaAddon(tier: ModeratorPlanTier): number {
  return Math.round((moderatorPlanPrice(tier) + MODERATOR_MEDIA_ADDON[tier].price) * 100) / 100;
}

/** Suggested default for the customer-facing automator subscription. Owners can override
 *  the price + run a promo (see automation/pricing.ts — the Business+ default is $9.99).
 *  The full amount is the OWNER's revenue; Innvil earns only via the owner's tier fee. */
export const CUSTOMER_AUTOMATOR_PRICE = 6.99;
export const AUTOMATOR_PERIOD_DAYS = 30;

/**
 * Internal volume-discount brackets by completed orders/day — the guideline support
 * (and future AI support) uses to grant a panel a lower commission rate. Public
 * messaging says "down to 2%"; internally we can go to 1% for the biggest panels.
 */
export function commissionBracketRate(ordersPerDay: number): number {
  if (ordersPerDay >= 10000) return 0.01;
  if (ordersPerDay >= 5000) return 0.02;
  if (ordersPerDay >= 2500) return 0.03;
  if (ordersPerDay >= 1000) return 0.04;
  return INNVIL_COMMISSION_RATE;
}

/* ---------------------------------------------------------------------------
   Currency — each panel operates in one well-known currency (default USD).
   --------------------------------------------------------------------------- */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  label: string;
}

/** Well-known currencies owners can operate in. */
export const CURRENCIES: CurrencyInfo[] = [
  { code: "USD", symbol: "$", label: "US Dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "British Pound" },
  { code: "INR", symbol: "₹", label: "Indian Rupee" },
  { code: "PHP", symbol: "₱", label: "Philippine Peso" },
  { code: "IDR", symbol: "Rp", label: "Indonesian Rupiah" },
  { code: "BRL", symbol: "R$", label: "Brazilian Real" },
  { code: "NGN", symbol: "₦", label: "Nigerian Naira" },
  { code: "AED", symbol: "د.إ", label: "UAE Dirham" },
  { code: "PKR", symbol: "₨", label: "Pakistani Rupee" },
  { code: "AUD", symbol: "A$", label: "Australian Dollar" },
  { code: "CAD", symbol: "C$", label: "Canadian Dollar" },
  { code: "SGD", symbol: "S$", label: "Singapore Dollar" },
  { code: "MYR", symbol: "RM", label: "Malaysian Ringgit" },
];

const SYMBOLS: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.symbol])
);

export function currencySymbol(code?: string | null): string {
  return SYMBOLS[(code || "USD").toUpperCase()] ?? "";
}

/** Format an amount in a panel's currency (symbol + 2dp; falls back to code). */
export function formatMoney(amount: number, code?: string | null): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const cc = (code || "USD").toUpperCase();
  const sym = SYMBOLS[cc];
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${cc}`;
}

/**
 * Selling rate (per 1000) from the provider cost and a markup rule:
 *  - percent:     cost * (1 + value/100)   e.g. value 20 → +20%
 *  - multiplier:  cost * value             e.g. value 1.5 → ×1.5
 *  - fixed:       cost + value             e.g. value 0.10 → +$0.10
 */
export function computeSellRate(
  providerRate: number,
  kind: MarkupKind,
  value: number
): number {
  const cost = Number.isFinite(providerRate) ? providerRate : 0;
  const v = Number.isFinite(value) ? value : 0;
  let rate: number;
  if (kind === "percent") rate = cost * (1 + v / 100);
  else if (kind === "multiplier") rate = cost * v;
  else rate = cost + v; // fixed
  return round4(Math.max(rate, 0));
}
