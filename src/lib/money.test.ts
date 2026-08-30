import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODERATOR_BASIC_PRICE, MODERATOR_STANDARD_PRICE, MODERATOR_PREMIUM_PRICE, MODERATOR_PRO_PRICE, MODERATOR_BYO20_PRICE,
  MODERATOR_ENTERPRISE_MIN_SLOTS, MODERATOR_COMMISSION_SHARE, MODERATOR_RENTAL_DISCOUNT,
  MODERATOR_COMMUNITY_CAPACITY, MODERATOR_ADDITIONAL_COMMUNITY_PRICE, MODERATOR_ADDITIONAL_COMMUNITY_WITH_AUTOPOST_PRICE,
  MODERATOR_AUTOPOST_INCLUDED_PER_DAY, MODERATOR_AUTOPOST_MAX_PER_DAY, MODERATOR_AUTOPOST_EXTRA_DAILY_POST_PRICE,
  MODERATOR_AI_GENERATION_POOL, MODERATOR_MEDIA_ADDON, ENTERPRISE_MEDIA_ADDON,
  MEDIA_MODERATION_BASE_ALLOWANCE, ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE,
  MEDIA_MODERATION_EXPANSION_PACKS, mediaModerationExpansionPackByUnits,
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

test("REQUIRED: canonical AI Moderator prices match the current repriced table (Platinum cut, BYO 20 added then repriced 2026-08-26)", () => {
  assert.equal(MODERATOR_BASIC_PRICE, 29.99);
  assert.equal(MODERATOR_STANDARD_PRICE, 59.99);
  assert.equal(MODERATOR_PREMIUM_PRICE, 99.99);
  assert.equal(MODERATOR_PRO_PRICE, 149.99);
  assert.equal(MODERATOR_BYO20_PRICE, 169.99);
});

test("moderatorPlanPrice resolves each tier to its canonical price", () => {
  const cases: Array<[ModeratorPlanTier, number]> = [
    ["basic", 29.99],
    ["standard", 59.99],
    ["premium", 99.99],
    ["pro", 149.99],
    ["byo20", 169.99],
  ];
  for (const [tier, price] of cases) assert.equal(moderatorPlanPrice(tier), price);
});

test("REQUIRED: BYO 20 is genuinely cheaper than assembling the equivalent capacity out of Platinum + Community Expansion + Media Moderation + -- the whole point of bringing your own AI credential", () => {
  const fullyLoadedPlatinum = MODERATOR_PRO_PRICE + COMMUNITY_EXPANSION_MONTHLY_PRICE.pro + MODERATOR_MEDIA_ADDON.pro.price;
  assert.ok(MODERATOR_BYO20_PRICE < fullyLoadedPlatinum, `BYO 20 ($${MODERATOR_BYO20_PRICE}) must be cheaper than fully-loaded Platinum ($${fullyLoadedPlatinum})`);
  // Never revert to a price that's more than fully-loaded Platinum, or even
  // just bare Platinum -- both would contradict BYO's entire value
  // proposition (Innvil funds zero AI Generation pool for this tier).
  assert.ok(MODERATOR_BYO20_PRICE > MODERATOR_PRO_PRICE, "BYO 20 should still cost more than bare Platinum -- it includes double the Communities and a bundled media allowance");
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
test("REQUIRED: custom-quote worked example -- 50 total slots = 149.99 + 30*15 = 599.99/mo (Platinum repriced 2026-08-25)", () => {
  assert.equal(moderatorEnterpriseSlotPrice(50), 599.99);
});

test("REQUIRED: custom-quote worked example -- 75 total slots = 149.99 + 30*15 + 25*13 = 924.99/mo (Platinum repriced 2026-08-25)", () => {
  assert.equal(moderatorEnterpriseSlotPrice(75), 924.99);
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

test("REQUIRED: Gold Community Expansion is $9.99/month, Platinum is $14.99/month -- the exact fixed-package prices (self-serve only, never the separate Enterprise Community expansion model)", () => {
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, 9.99);
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro, 14.99);
});

test("REQUIRED: self-serve Gold/Platinum Community Expansion never uses the separate Enterprise BYO Community pricing ($12.99/$19.99 belongs to a different, later-queued model)", () => {
  assert.notEqual(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, 12.99);
  assert.notEqual(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro, 19.99);
});

test("REQUIRED: self-serve Media Moderation + pricing/units per tier (Bronze +$9.99/1,000 .. Platinum +$24.99/4,000)", () => {
  assert.deepEqual(MODERATOR_MEDIA_ADDON.basic, { price: 9.99, units: 1000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.standard, { price: 14.99, units: 2000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.premium, { price: 19.99, units: 3000 });
  assert.deepEqual(MODERATOR_MEDIA_ADDON.pro, { price: 24.99, units: 4000 });
});

test("REQUIRED: canonical AI Generations allowances match the plan cards (Bronze 2K .. Platinum 20K)", () => {
  assert.equal(MODERATOR_AI_GENERATION_POOL.basic, 2000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.standard, 5000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.premium, 10000);
  assert.equal(MODERATOR_AI_GENERATION_POOL.pro, 20000);
});

/* --------------------------------------------------------------- BYO 20 ---- */
// The 5th self-serve tier -- $169.99/mo, 20 slots, 10 Communities (fixed, no
// expansion ever), 3,000 Media Moderation units BUNDLED into the base price
// (never a separate purchase), always requires the customer's own AI
// provider credential -- reuses the self-serve checkout/renewal/plan-switch
// machinery as a 5th ModeratorPlanTier literal, never a parallel system.

test("REQUIRED: BYO 20 has a fixed 10-Community cap -- included equals the expansion ceiling, exactly like Bronze/Silver (no expansion possible)", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.byo20.included, 10);
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.byo20.maxWithAddons, 10);
});

test("REQUIRED: BYO 20 is never Community-Expansion-eligible -- it already includes the maximum fixed cap", () => {
  assert.equal(isCommunityExpansionEligibleTier("byo20"), false);
  assert.ok(!(COMMUNITY_EXPANSION_ELIGIBLE_TIERS as readonly string[]).includes("byo20"));
});

test("REQUIRED: BYO 20's 3,000 Media Moderation units are bundled at zero incremental price -- never a separate paid add-on", () => {
  assert.deepEqual(MODERATOR_MEDIA_ADDON.byo20, { price: 0, units: 3000 });
});

test("REQUIRED: BYO 20's AI Generations pool is N/A (0) by design -- it always routes through the customer's own credential, never Innvil's pool", () => {
  assert.equal(MODERATOR_AI_GENERATION_POOL.byo20, 0);
});

test("REQUIRED: Community Expansion capacity ceilings are the SAME MODERATOR_COMMUNITY_CAPACITY.maxWithAddons already shown on Plans -- never a duplicated number", () => {
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.premium.maxWithAddons, 5, "Gold expands to 5");
  assert.equal(MODERATOR_COMMUNITY_CAPACITY.pro.maxWithAddons, 10, "Platinum expands to 10");
});

/* --------------------------------------------- Media Moderation Units, REVISED model ---- */
// (2026-08-27) Every plan now gets a real, unconditionally-included base
// allowance automatically. Revised again (same day) to the final canonical
// table -- items 1-8 of the required test list.

test("REQUIRED (1): Bronze resolves to 300 Media Moderation Units", () => {
  assert.equal(MEDIA_MODERATION_BASE_ALLOWANCE.basic, 300);
});

test("REQUIRED (2): Silver resolves to 500 Media Moderation Units", () => {
  assert.equal(MEDIA_MODERATION_BASE_ALLOWANCE.standard, 500);
});

test("REQUIRED (3): Gold resolves to 700 Media Moderation Units", () => {
  assert.equal(MEDIA_MODERATION_BASE_ALLOWANCE.premium, 700);
});

test("REQUIRED (4): Platinum resolves to 1,000 Media Moderation Units", () => {
  assert.equal(MEDIA_MODERATION_BASE_ALLOWANCE.pro, 1000);
});

test("REQUIRED (6, 7, 8): BYO 20, BYO 50, and BYO Unlimited all resolve to the SAME 2,000 Media Moderation Units", () => {
  assert.equal(MEDIA_MODERATION_BASE_ALLOWANCE.byo20, 2000);
  assert.equal(ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.byo50, 2000);
  assert.equal(ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.byoUnlimited, 2000);
});

test("REQUIRED (5): Managed Enterprise resolves to 1,500 Media Moderation Units", () => {
  assert.equal(ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.managed50, 1500);
});

test("REQUIRED: the full canonical lineup sums to exactly 10,000 units (Bronze 300 + Silver 500 + Gold 700 + Platinum 1,000 + Managed Enterprise 1,500 + BYO 20/50/Unlimited 2,000 each)", () => {
  const total =
    MEDIA_MODERATION_BASE_ALLOWANCE.basic + MEDIA_MODERATION_BASE_ALLOWANCE.standard
    + MEDIA_MODERATION_BASE_ALLOWANCE.premium + MEDIA_MODERATION_BASE_ALLOWANCE.pro
    + MEDIA_MODERATION_BASE_ALLOWANCE.byo20
    + ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.managed50 + ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.byo50
    + ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE.byoUnlimited;
  assert.equal(total, 10000);
});

test("REQUIRED (12): revising Media Moderation Unit allowances leaves Watcher-slot entitlement (CAPACITY.maxActiveSlots) completely unchanged -- a structurally separate table, never derived from or coupled to media allowances", () => {
  assert.deepEqual(
    { basic: CAPACITY.basic.maxActiveSlots, standard: CAPACITY.standard.maxActiveSlots, premium: CAPACITY.premium.maxActiveSlots, pro: CAPACITY.pro.maxActiveSlots, byo20: CAPACITY.byo20.maxActiveSlots },
    { basic: 2, standard: 5, premium: 10, pro: 20, byo20: 20 }
  );
});

test("REQUIRED (13): revising Media Moderation Unit allowances leaves Community entitlement (MODERATOR_COMMUNITY_CAPACITY) completely unchanged", () => {
  assert.deepEqual(
    {
      basic: MODERATOR_COMMUNITY_CAPACITY.basic, standard: MODERATOR_COMMUNITY_CAPACITY.standard,
      premium: MODERATOR_COMMUNITY_CAPACITY.premium, pro: MODERATOR_COMMUNITY_CAPACITY.pro, byo20: MODERATOR_COMMUNITY_CAPACITY.byo20,
    },
    {
      basic: { included: 1, maxWithAddons: 1 }, standard: { included: 2, maxWithAddons: 2 },
      premium: { included: 3, maxWithAddons: 5 }, pro: { included: 5, maxWithAddons: 10 }, byo20: { included: 10, maxWithAddons: 10 },
    }
  );
});

test("REQUIRED (14): revising Media Moderation Unit allowances leaves conversational AI usage entitlement (MODERATOR_AI_GENERATION_POOL) completely unchanged", () => {
  assert.deepEqual(
    { basic: MODERATOR_AI_GENERATION_POOL.basic, standard: MODERATOR_AI_GENERATION_POOL.standard, premium: MODERATOR_AI_GENERATION_POOL.premium, pro: MODERATOR_AI_GENERATION_POOL.pro },
    { basic: 2000, standard: 5000, premium: 10000, pro: 20000 }
  );
});

test("every self-serve tier (incl. byo20) and every Enterprise variant has a real, non-zero base allowance -- no tier silently gets zero", () => {
  for (const tier of Object.keys(MEDIA_MODERATION_BASE_ALLOWANCE) as ModeratorPlanTier[]) {
    assert.ok(MEDIA_MODERATION_BASE_ALLOWANCE[tier] > 0, `${tier} must have a real base allowance`);
  }
  for (const key of Object.keys(ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE) as Array<keyof typeof ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE>) {
    assert.ok(ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE[key] > 0, `${key} must have a real base allowance`);
  }
});

test("REQUIRED: the six real expansion packs, exact units and prices, available to every plan", () => {
  assert.deepEqual(
    MEDIA_MODERATION_EXPANSION_PACKS.map((p) => [p.units, p.price]),
    [[1000, 9.99], [2000, 14.99], [3000, 19.99], [5000, 24.99], [10000, 39.99], [20000, 59.99]],
  );
});

test("mediaModerationExpansionPackByUnits resolves a real pack by its exact unit size, null for anything else -- never guesses a price for an arbitrary count", () => {
  assert.deepEqual(mediaModerationExpansionPackByUnits(5000), { units: 5000, price: 24.99 });
  assert.equal(mediaModerationExpansionPackByUnits(5001), null);
  assert.equal(mediaModerationExpansionPackByUnits(0), null);
  assert.equal(mediaModerationExpansionPackByUnits(-1000), null);
});

test("the OLD per-tier add-on model (MODERATOR_MEDIA_ADDON / ENTERPRISE_MEDIA_ADDON) is untouched, for the pre-existing backward-compatible purchase/removal functions that still reference it", () => {
  assert.deepEqual(MODERATOR_MEDIA_ADDON.basic, { price: 9.99, units: 1000 });
  assert.deepEqual(ENTERPRISE_MEDIA_ADDON.managed50, { price: 39.99, units: 8000 });
});
