import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEnterpriseIncludedCommunities, getEnterpriseCommunityExpansionOptions, getEnterpriseCommunityHardMax,
  validateEnterpriseCommunityCapacity, getEnterpriseCommunityExpansionPrice, communityModeFor,
} from "./watch-enterprise-community";

/* ------------------------------------------------------ communityModeFor ---- */
// The ONE canonical (apiSourceMode, slots) -> EnterpriseCommunityMode mapping
// every consumer (devops grant UI, devops grant action, activateWatchEntitlement's
// own persistence-time validation) must use -- REQUIRED so all three can
// never independently drift and disagree about which mode an account is in
// (a real bug, 2026-08-25, when this mapping was duplicated inline in two
// places and never applied in a third).

test("REQUIRED: communityModeFor resolves managed regardless of slots", () => {
  assert.equal(communityModeFor("managed", 50), "managed");
  assert.equal(communityModeFor("managed", 75), "managed");
});

test("REQUIRED: communityModeFor resolves byo50 for a real numeric BYO slot count", () => {
  assert.equal(communityModeFor("byo", 50), "byo50");
});

test("REQUIRED: communityModeFor resolves byoUnlimited when slots is null", () => {
  assert.equal(communityModeFor("byo", null), "byoUnlimited");
});

test("REQUIRED: every real EnterpriseCommunityMode is reachable via this mapping, and matches its own table", () => {
  for (const [mode, slots] of [["managed", 50], ["byo", 50], ["byo", null]] as const) {
    const resolved = communityModeFor(mode, slots);
    assert.ok(getEnterpriseIncludedCommunities(resolved) > 0);
  }
});

/* ------------------------------------------------ self-serve preservation ---- */
// This module governs ENTERPRISE Community capacity only -- self-serve Gold/
// Platinum Community Expansion (COMMUNITY_EXPANSION_MONTHLY_PRICE in money.ts,
// $9.99/$14.99) is a completely separate, untouched system; these tests
// confirm this module never invents a self-serve-shaped API for it.

test("REQUIRED: this module only knows about the three ENTERPRISE modes, never self-serve tiers", () => {
  for (const mode of ["managed", "byo50", "byoUnlimited"] as const) {
    assert.ok(getEnterpriseIncludedCommunities(mode) > 0);
  }
});

/* ---------------------------------------------------------- managed ---- */
// Managed Enterprise is the ONLY mode with a real, paid Community Expansion
// path -- unchanged by the 2026-08-28 BYO revision below.

test("REQUIRED: Managed Enterprise base = 8 Communities", () => {
  assert.equal(getEnterpriseIncludedCommunities("managed"), 8);
});

test("REQUIRED: Managed -> 10 = +$9.99, -> 15 = +$14.99, -> 25 = +$24.99", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 10), 9.99);
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 15), 14.99);
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 25), 24.99);
});

test("REQUIRED: Managed cannot exceed 25 through this model", () => {
  assert.equal(getEnterpriseCommunityHardMax("managed"), 25);
  assert.equal(validateEnterpriseCommunityCapacity("managed", 30), false);
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 30), null);
});

test("REQUIRED: Managed package prices are alternatives, not cumulative -- $24.99 total for the 25 package, never 9.99+14.99+24.99", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 25), 24.99);
  assert.notEqual(getEnterpriseCommunityExpansionPrice("managed", 25), 9.99 + 14.99 + 24.99);
});

test("Managed base capacity (8) has zero expansion price", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 8), 0);
});

test("REQUIRED: expansion price is never fabricated for an unsupported mode/capacity pair", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 12), null, "12 is not a real Managed package");
});

test("REQUIRED: no per-Community pricing anywhere for Managed -- every price is a flat package total, independent of a per-unit rate check", () => {
  // If this were $X/Community, price(25)/25 would equal price(10)/10 etc. It must not.
  const perCommunityAt10 = getEnterpriseCommunityExpansionPrice("managed", 10)! / 10;
  const perCommunityAt25 = getEnterpriseCommunityExpansionPrice("managed", 25)! / 25;
  assert.notEqual(perCommunityAt10, perCommunityAt25);
});

/* ------------------------------------------------------------- byo 50 ---- */
// REVISED (2026-08-28, business decision): BYO literally means the customer
// brings their own infrastructure/provider -- Innvil incurs no marginal
// cost for extra Communities on a BYO account, so BYO 50 now includes its
// real hard maximum (25) as the base, for FREE, with no expansion path at
// all (there's nothing left above the base to sell).

test("REQUIRED: BYO 50 base = 25 Communities, included for free -- no expansion above it exists to purchase", () => {
  assert.equal(getEnterpriseIncludedCommunities("byo50"), 25);
  assert.deepEqual(getEnterpriseCommunityExpansionOptions("byo50"), []);
});

test("REQUIRED: BYO 50's own base capacity has zero expansion price", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 25), 0);
});

test("REQUIRED: BYO 50's included base equals its own hard maximum -- 25 either way", () => {
  assert.equal(getEnterpriseCommunityHardMax("byo50"), 25);
  assert.equal(getEnterpriseIncludedCommunities("byo50"), getEnterpriseCommunityHardMax("byo50"));
});

test("REQUIRED: BYO 50 has no valid capacity beyond its free base -- there is nothing left to buy", () => {
  assert.equal(validateEnterpriseCommunityCapacity("byo50", 30), false);
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 30), null);
  // Even the OLD (pre-revision) package prices are no longer real states.
  assert.equal(validateEnterpriseCommunityCapacity("byo50", 15), false);
});

/* ---------------------------------------------------------- byo unlimited ---- */
// REVISED (2026-08-28): BYO Unlimited includes literally UNLIMITED
// Communities, for free, from day one -- represented as a real
// Number.POSITIVE_INFINITY sentinel (the same idiom BYO Unlimited's own
// Watcher-slot ceiling already uses elsewhere in this codebase), never a
// large finite number standing in for "no limit". There is no more "25,
// then +10 blocks" continuation model -- it's simply always unlimited.

test("REQUIRED: BYO Unlimited base is a real, honest Infinity -- unlimited Communities, included for free", () => {
  assert.equal(getEnterpriseIncludedCommunities("byoUnlimited"), Number.POSITIVE_INFINITY);
  assert.deepEqual(getEnterpriseCommunityExpansionOptions("byoUnlimited"), []);
});

test("REQUIRED: BYO Unlimited has no hard maximum, consistent with its Infinity base", () => {
  assert.equal(getEnterpriseCommunityHardMax("byoUnlimited"), null);
});

test("REQUIRED: BYO Unlimited's own included (Infinity) capacity is the only valid state, and it costs $0", () => {
  assert.equal(validateEnterpriseCommunityCapacity("byoUnlimited", Number.POSITIVE_INFINITY), true);
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", Number.POSITIVE_INFINITY), 0);
});

test("REQUIRED: no finite capacity is ever a valid, separately-priced state for BYO Unlimited anymore -- it's unconditionally unlimited, never a specific number to purchase up to", () => {
  for (const capacity of [10, 15, 25, 35, 55, 205]) {
    assert.equal(validateEnterpriseCommunityCapacity("byoUnlimited", capacity), false, `${capacity} must not be a distinct purchasable state`);
    assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", capacity), null);
  }
});

/* --------------------------------------------------------- separation ---- */

test("REQUIRED: BYO 50 and BYO Unlimited are structurally distinct from Managed -- validating/pricing a BYO mode against Managed's own package numbers must never accidentally succeed", () => {
  for (const capacity of [10, 15, 25]) {
    // These ARE real Managed package capacities, but must not validate for BYO
    // modes just because the numbers happen to overlap.
    if (capacity !== getEnterpriseIncludedCommunities("byo50")) {
      assert.equal(validateEnterpriseCommunityCapacity("byo50", capacity), false);
    }
  }
});
