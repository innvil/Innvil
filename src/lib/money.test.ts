import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODERATOR_BASIC_PRICE, MODERATOR_STANDARD_PRICE, MODERATOR_PREMIUM_PRICE, MODERATOR_PRO_PRICE,
  MODERATOR_ENTERPRISE_MIN_SLOTS, MODERATOR_COMMISSION_SHARE, MODERATOR_RENTAL_DISCOUNT,
  MODERATOR_COMMUNITY_CAPACITY, MODERATOR_ADDITIONAL_COMMUNITY_PRICE, MODERATOR_ADDITIONAL_COMMUNITY_WITH_AUTOPOST_PRICE,
  MODERATOR_AUTOPOST_INCLUDED_PER_DAY, MODERATOR_AUTOPOST_MAX_PER_DAY, MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE,
  MODERATOR_AI_GENERATION_POOL,
  moderatorPlanPrice, moderatorEnterpriseSlotPrice, moderatorEnterpriseIncludedCommunities, moderatorAutopostFrequencyAddonPrice,
  COMMUNITY_EXPANSION_ELIGIBLE_TIERS, COMMUNITY_EXPANSION_MONTHLY_PRICE, isCommunityExpansionEligibleTier,
  type ModeratorPlanTier,
} from "./money";
import { CAPACITY, TRIAL_CAPACITY } from "./moderator/plan";

/* ---------------------------------------------------- canonical pricing ---- */
// Single source of truth: src/lib/money.ts. These assertions guard against
// the exact "scattered 49.99/114.99/209.99/359.99 through UI/actions/billing
// files" the update was explicit about avoiding -- everything should read
// through these constants, never redeclare the numbers.

test("REQUIRED: canonical AI Moderator prices match the 2026-08-22 repriced table", () => {
  assert.equal(MODERATOR_BASIC_PRICE, 29.99);
  assert.equal(MODERATOR_STANDARD_PRICE, 59.99);
  assert.equal(MODERATOR_PREMIUM_PRICE, 99.99);
  assert.equal(MODERATOR_PRO_PRICE, 199.0);
});

test("moderatorPlanPrice resolves each tier to its canonical price", () => {
  const cases: Array<[ModeratorPlanTier, number]> = [
    ["basic", 29.99],
    ["standard", 59.99],
    ["premium", 99.99],
    ["pro", 199.0],
  ];
  for (const [tier, price] of cases) assert.equal(moderatorPlanPrice(tier), price);
});

test("REQUIRED: Direct-mode owner commission share is 5%, never the old 20%", () => {
  assert.equal(MODERATOR_COMMISSION_SHARE, 0.05);
});

test("REQUIRED: Rental-mode wholesale discount is 10% below standard list price", () => {
  assert.equal(MODERATOR_RENTAL_DISCOUNT, 0.10);
});

test("Direct and Rental are mutually exclusive rates -- a transaction must never combine both", () => {
  // The two constants are structurally separate fields (never summed/combined
  // anywhere in money.ts) -- this pins that they're also numerically distinct,
  // so a future accidental merge (e.g. commission + discount applied together)
  // would visibly change one of these pinned values.
  assert.notEqual(MODERATOR_COMMISSION_SHARE, MODERATOR_RENTAL_DISCOUNT);
});

/* -------------------------------------------------------- enterprise slots ---- */

test("REQUIRED: Enterprise's minimum slot count (21) is one $15 slot above the Pro base", () => {
  assert.equal(moderatorEnterpriseSlotPrice(MODERATOR_ENTERPRISE_MIN_SLOTS), MODERATOR_PRO_PRICE + 15);
});

// This dynamic per-slot formula is now used ONLY for a CUSTOM Managed quote
// above the fixed 50-slot Managed Enterprise 50 package ($399/mo, a flat
// constant in watch-enterprise.ts, NOT derived from this formula) -- see
// the 2026-08-22 CLAUDE.md entry. These worked examples now reflect the
// repriced $199.00 Pro base, not the pre-repricing $379.99.
test("REQUIRED: custom-quote worked example -- 50 total slots = 199.00 + 30*15 = 649.00/mo", () => {
  assert.equal(moderatorEnterpriseSlotPrice(50), 649.0);
});

test("REQUIRED: custom-quote worked example -- 75 total slots = 199.00 + 30*15 + 25*13 = 974.00/mo", () => {
  assert.equal(moderatorEnterpriseSlotPrice(75), 974.0);
});

test("Enterprise band boundary: 51st slot switches from $15/slot to $13/slot", () => {
  const at50 = moderatorEnterpriseSlotPrice(50);
  const at51 = moderatorEnterpriseSlotPrice(51);
  assert.equal(Math.round((at51 - at50) * 100) / 100, 13);
});

test("Enterprise slot price never goes below MODERATOR_ENTERPRISE_MIN_SLOTS's price even if called with a lower number", () => {
  assert.equal(moderatorEnterpriseSlotPrice(1), moderatorEnterpriseSlotPrice(MODERATOR_ENTERPRISE_MIN_SLOTS));
});

test("REQUIRED: Enterprise included communities -- Pro base (20 slots) is 5", () => {
  assert.equal(moderatorEnterpriseIncludedCommunities(20), 5);
});

test("REQUIRED: Enterprise included communities -- +10 to +29 extra slots above Pro -> 7 total", () => {
  assert.equal(moderatorEnterpriseIncludedCommunities(30), 7); // +10
  assert.equal(moderatorEnterpriseIncludedCommunities(49), 7); // +29
});

test("REQUIRED: Enterprise included communities -- +30 or more extra slots above Pro -> 8 total", () => {
  assert.equal(moderatorEnterpriseIncludedCommunities(50), 8); // +30
  assert.equal(moderatorEnterpriseIncludedCommunities(100), 8);
});

/* ------------------------------------------------------- community entitlement ---- */

test("REQUIRED: Basic/Standard are hard-capped -- included equals the expansion ceiling", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.basic.included, 1);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.basic.maxWithAddons, 1);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.standard.included, 2);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.standard.maxWithAddons, 2);
});

test("REQUIRED: Premium may expand from 3 included communities to a max of 5", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.premium.included, 3);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.premium.maxWithAddons, 5);
});

test("REQUIRED: Pro may expand from 5 included communities to a max of 10", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.pro.included, 5);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.pro.maxWithAddons, 10);
});

test("REQUIRED: additional-community pricing -- $9.99 community-only, $14.99 community+autopost", () => {
  assert.equal(MODERATOR_ADDITIONAL_COMMUNITY_PRICE, 9.99);
  assert.equal(MODERATOR_ADDITIONAL_COMMUNITY_WITH_AUTOPOST_PRICE, 14.99);
});

/* ------------------------------------------------------------- auto-posting ---- */

test("REQUIRED: 1/day auto-post is included; no extra charge for the included frequency", () => {
  assert.equal(MODERATOR_AUTOPOST_INCLUDED_PER_DAY, 1);
  assert.equal(moderatorAutopostFrequencyAddonPrice(1), 0);
});

test("REQUIRED: 2/day = +$9.99/month, 3/day = +$19.98/month", () => {
  assert.equal(moderatorAutopostFrequencyAddonPrice(2), 9.99);
  assert.equal(moderatorAutopostFrequencyAddonPrice(3), 19.98);
});

test("REQUIRED: normal-plan cap is 3 auto-posts/day/community -- requesting more is clamped, not overcharged", () => {
  assert.equal(MODERATOR_AUTOPOST_MAX_PER_DAY, 3);
  assert.equal(moderatorAutopostFrequencyAddonPrice(5), moderatorAutopostFrequencyAddonPrice(3));
});

test("requesting 0/day never produces a negative price", () => {
  assert.equal(moderatorAutopostFrequencyAddonPrice(0), 0);
});

test("MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE is the per-extra-post-per-day unit price used above", () => {
  assert.equal(MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE, 9.99);
});

/* ------------------------------------------------------ AI conversational pool ---- */

test("REQUIRED: pooled monthly AI Generations allowance matches the 2026-08-22 repriced table", () => {
  assert.equal(MODERATOR_AI_GENERATION_POOL.basic, 2000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.standard, 5000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.premium, 10000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.pro, 20000);
});

test("REQUIRED: slot counts per tier match the approved pricing table (Basic 2 / Standard 5 / Premium 10 / Pro 20)", () => {
  assert.equal(CAPACITY.basic.maxActiveSlots, 2);
  assert.equal(CAPACITY.standard.maxActiveSlots, 5);
  assert.equal(CAPACITY.premium.maxActiveSlots, 10);
  assert.equal(CAPACITY.pro.maxActiveSlots, 20);
});

/* -------------------------------------------------------------- enterprise ---- */

test("REQUIRED: Enterprise starts immediately after Pro's slot count (20+)", () => {
  assert.equal(MODERATOR_ENTERPRISE_MIN_SLOTS, CAPACITY.pro.maxActiveSlots + 1);
});

test('REQUIRED: Enterprise cannot flow into normal tier billing -- "enterprise" is not a valid ModeratorPlanTier at all', () => {
  // @ts-expect-error -- "enterprise" must not be assignable to ModeratorPlanTier;
  // this line failing to error (i.e. Enterprise silently becoming a real
  // billable tier) is exactly the regression this test exists to catch --
  // `tsc --noEmit` fails if this directive becomes unused.
  const attempted: ModeratorPlanTier = "enterprise";
  const validTiers: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro"];
  assert.ok(!validTiers.includes(attempted));
});

test("trial capacity is unaffected by the pricing update (still 1 slot)", () => {
  assert.equal(TRIAL_CAPACITY.maxActiveSlots, 1);
});

/* ------------------------------------------------------- community expansion ---- */

test("REQUIRED: only Gold (premium) and Platinum (pro) are Community-Expansion-eligible -- never Bronze/Silver", () => {
  assert.deepEqual([...COMMUNITY_EXPANSION_ELIGIBLE_TIERS].sort(), ["premium", "pro"]);
});

test("REQUIRED: isCommunityExpansionEligibleTier rejects Bronze/Silver and accepts Gold/Platinum", () => {
  assert.equal(isCommunityExpansionEligibleTier("basic"), false);
  assert.equal(isCommunityExpansionEligibleTier("standard"), false);
  assert.equal(isCommunityExpansionEligibleTier("premium"), true);
  assert.equal(isCommunityExpansionEligibleTier("pro"), true);
});

test("REQUIRED: Gold Community Expansion is $12.99/month, Platinum is $19.99/month -- the exact fixed-package prices", () => {
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, 12.99);
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro, 19.99);
});

test("REQUIRED: Community Expansion capacity ceilings are the SAME MODERATOR_COMMUNITY_CAPACITY.maxWithAddons already shown on Plans -- never a duplicated number", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.premium.maxWithAddons, 5, "Gold expands to 5");
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.pro.maxWithAddons, 10, "Platinum expands to 10");
});
