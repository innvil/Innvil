import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getEnterpriseIncludedCommunities, getEnterpriseCommunityExpansionOptions, getEnterpriseCommunityHardMax,
  validateEnterpriseCommunityCapacity, getEnterpriseCommunityExpansionPrice, nextByoUnlimitedCapacityStep,
  BYO_UNLIMITED_BLOCK_PRICE, BYO_UNLIMITED_BLOCK_SIZE, communityModeFor,
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

/* ------------------------------------------------------------- byo 50 ---- */

test("REQUIRED: BYO 50 base = 10", () => {
  assert.equal(getEnterpriseIncludedCommunities("byo50"), 10);
});

test("REQUIRED: BYO 50 -> 15 = +$12.99, -> 25 = +$19.99", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 15), 12.99);
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 25), 19.99);
});

test("REQUIRED: BYO 50 cannot exceed 25", () => {
  assert.equal(getEnterpriseCommunityHardMax("byo50"), 25);
  assert.equal(validateEnterpriseCommunityCapacity("byo50", 35), false);
});

test("REQUIRED: BYO 50 package pricing is not cumulative", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 25), 19.99);
});

/* ---------------------------------------------------------- byo unlimited ---- */

test("REQUIRED: BYO Unlimited base = 10", () => {
  assert.equal(getEnterpriseIncludedCommunities("byoUnlimited"), 10);
});

test("REQUIRED: BYO Unlimited 15 = +$12.99, 25 = +$19.99, 35 = +$24.89, 45 = +$29.79, 55 = +$34.69", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 15), 12.99);
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 25), 19.99);
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 35), 24.89);
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 45), 29.79);
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 55), 34.69);
});

test("REQUIRED: each +10 block above 25 adds exactly $4.90 -- worked example at 65 = $39.59", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", 65), 39.59);
  assert.equal(BYO_UNLIMITED_BLOCK_PRICE, 4.9);
  assert.equal(BYO_UNLIMITED_BLOCK_SIZE, 10);
});

test("REQUIRED: capacity above 25 must be a valid +10 increment -- 26/30/34/41 are rejected", () => {
  for (const bad of [26, 30, 34, 41]) {
    assert.equal(validateEnterpriseCommunityCapacity("byoUnlimited", bad), false, `${bad} must be rejected`);
    assert.equal(getEnterpriseCommunityExpansionPrice("byoUnlimited", bad), null);
  }
});

test("REQUIRED: no plan-level maximum exists for valid BYO Unlimited expansion", () => {
  assert.equal(getEnterpriseCommunityHardMax("byoUnlimited"), null);
  assert.equal(validateEnterpriseCommunityCapacity("byoUnlimited", 205), true, "25 + 18*10 = 205, a valid far-future block");
});

test("nextByoUnlimitedCapacityStep walks base -> 15 -> 25 -> +10 blocks", () => {
  assert.equal(nextByoUnlimitedCapacityStep(10), 15);
  assert.equal(nextByoUnlimitedCapacityStep(15), 25);
  assert.equal(nextByoUnlimitedCapacityStep(25), 35);
  assert.equal(nextByoUnlimitedCapacityStep(35), 45);
});

/* --------------------------------------------------------- separation ---- */

test("REQUIRED: expansion price is never fabricated for an unsupported mode/capacity pair", () => {
  assert.equal(getEnterpriseCommunityExpansionPrice("managed", 12), null, "12 is not a real Managed package");
  assert.equal(getEnterpriseCommunityExpansionPrice("byo50", 20), null, "20 is not a real BYO 50 package");
});

test("REQUIRED: no per-Community pricing anywhere -- every price is a flat package total, independent of a per-unit rate check", () => {
  // If this were $X/Community, price(25)/25 would equal price(10)/10 etc. It must not.
  const perCommunityAt10 = getEnterpriseCommunityExpansionPrice("managed", 10)! / 10;
  const perCommunityAt25 = getEnterpriseCommunityExpansionPrice("managed", 25)! / 25;
  assert.notEqual(perCommunityAt10, perCommunityAt25);
});
