import { test } from "node:test";
import assert from "node:assert/strict";
import { watchPlanDisplayName, watchTierFromDisplayName, watchPlanOptions, watchAccessLabel } from "./watch-plans";
import { moderatorPlanPrice, MODERATOR_COMMUNITY_CAPACITY } from "@/src/lib/money";
import { CAPACITY } from "@/src/lib/moderator/plan";
import { TRIAL_CAPACITY } from "./watch-trial";

/**
 * Customer-facing Watch plan rename: Basic->Bronze, Standard->Silver,
 * Premium->Gold, Pro->Platinum. Display-name layer only -- the stable
 * internal ModeratorPlanTier ("basic"/"standard"/"premium"/"pro") and every
 * price/entitlement constant in money.ts are untouched by this file.
 */

test("REQUIRED: Basic maps to Bronze", () => {
  assert.equal(watchPlanDisplayName("basic"), "Bronze");
});
test("REQUIRED: Standard maps to Silver", () => {
  assert.equal(watchPlanDisplayName("standard"), "Silver");
});
test("REQUIRED: Premium maps to Gold", () => {
  assert.equal(watchPlanDisplayName("premium"), "Gold");
});
test("REQUIRED: Pro maps to Platinum", () => {
  assert.equal(watchPlanDisplayName("pro"), "Platinum");
});

test("REQUIRED: display name -> internal tier round-trips exactly", () => {
  for (const [display, tier] of [["Bronze", "basic"], ["Silver", "standard"], ["Gold", "premium"], ["Platinum", "pro"]] as const) {
    assert.equal(watchTierFromDisplayName(display), tier);
    assert.equal(watchPlanDisplayName(tier), display);
  }
});

test("watchPlanOptions reads live prices straight from money.ts, never a hardcoded duplicate", () => {
  const options = watchPlanOptions();
  for (const opt of options) {
    assert.equal(opt.price, moderatorPlanPrice(opt.tier));
  }
});

test("watchPlanOptions returns exactly the 4 self-serve tiers, in ascending order, Enterprise excluded", () => {
  const options = watchPlanOptions();
  assert.deepEqual(options.map((o) => o.displayName), ["Bronze", "Silver", "Gold", "Platinum"]);
  for (let i = 1; i < options.length; i++) assert.ok(options[i].price > options[i - 1].price, "prices should ascend Bronze -> Platinum");
});

test("REQUIRED: each plan option's Watcher slot allowance and Community allowance read from the SAME canonical CAPACITY table enforcement itself checks", () => {
  const options = watchPlanOptions();
  for (const opt of options) {
    assert.equal(opt.slots, CAPACITY[opt.tier].maxActiveSlots, `${opt.displayName} slots must match CAPACITY, never a duplicated number`);
    assert.equal(opt.communitiesIncluded, CAPACITY[opt.tier].maxCommunities, `${opt.displayName} communities must match CAPACITY, never a duplicated number`);
  }
});

test("REQUIRED: real plan entitlements -- Bronze 2/1, Silver 5/2, Gold 10/3, Platinum 20/5 (slots/communities included)", () => {
  const bySlot = Object.fromEntries(watchPlanOptions().map((o) => [o.displayName, { slots: o.slots, communities: o.communitiesIncluded }]));
  assert.deepEqual(bySlot.Bronze, { slots: 2, communities: 1 });
  assert.deepEqual(bySlot.Silver, { slots: 5, communities: 2 });
  assert.deepEqual(bySlot.Gold, { slots: 10, communities: 3 });
  assert.deepEqual(bySlot.Platinum, { slots: 20, communities: 5 });
});

test("REQUIRED: Gold and Platinum expose real Community expansion ceilings -- Gold up to 5, Platinum up to 10", () => {
  const byName = Object.fromEntries(watchPlanOptions().map((o) => [o.displayName, o]));
  assert.equal(byName.Gold.communitiesIncluded, 3);
  assert.equal(byName.Gold.communitiesMax, 5);
  assert.equal(byName.Platinum.communitiesIncluded, 5);
  assert.equal(byName.Platinum.communitiesMax, 10);
});

test("REQUIRED: Bronze and Silver are hard-capped -- max never exceeds included, so no expansion is ever claimed for them", () => {
  const byName = Object.fromEntries(watchPlanOptions().map((o) => [o.displayName, o]));
  assert.equal(byName.Bronze.communitiesMax, byName.Bronze.communitiesIncluded);
  assert.equal(byName.Silver.communitiesMax, byName.Silver.communitiesIncluded);
});

test("communitiesMax always reads from the same canonical MODERATOR_COMMUNITY_CAPACITY table moderatorCommunityExpansionCeiling() reads", () => {
  const options = watchPlanOptions();
  for (const opt of options) {
    assert.equal(opt.communitiesMax, MODERATOR_COMMUNITY_CAPACITY[opt.tier].maxWithAddons);
  }
});

test("REQUIRED: watchAccessLabel shows 'Free Trial' for the trial pseudo-tier, real plan names otherwise", () => {
  assert.equal(watchAccessLabel("trial"), "Free Trial");
  assert.equal(watchAccessLabel("basic"), "Bronze");
  assert.equal(watchAccessLabel("pro"), "Platinum");
});

/* ------------------------------- plan-card capacity consistency (Plans page) ---- */
// The Plans page's plan cards must show BOTH Watcher slots and Community
// allowance, using the exact same canonical config Usage/Billing read --
// these tests pin that agreement so the three surfaces can never silently
// drift apart from each other.

test("REQUIRED: watchPlanOptions() carries no billing-interval field at all -- capacity is structurally interval-independent, so Monthly and Annual Plans views can never show different slot/Community numbers for the same plan", () => {
  const options = watchPlanOptions();
  for (const o of options) {
    assert.ok(!("billingInterval" in o), `${o.displayName} option must not carry a billing-interval-specific capacity value`);
  }
});

test("REQUIRED: every plan option's slots/communitiesIncluded/communitiesMax are IDENTICAL to what Usage/Billing's own AccountCapacity resolver reads (CAPACITY + MODERATOR_COMMUNITY_CAPACITY) -- same source, not a second copy", () => {
  for (const o of watchPlanOptions()) {
    assert.equal(o.slots, CAPACITY[o.tier].maxActiveSlots, `${o.displayName}: Plans and Usage/Billing must agree on Watcher slots`);
    assert.equal(o.communitiesIncluded, CAPACITY[o.tier].maxCommunities, `${o.displayName}: Plans and Usage/Billing must agree on included Communities`);
    assert.equal(o.communitiesMax, MODERATOR_COMMUNITY_CAPACITY[o.tier].maxWithAddons, `${o.displayName}: Plans and Usage/Billing must agree on max Communities`);
  }
});

test("REQUIRED: the Free Trial's real capacity (1 Watcher slot, 1 Community) is a canonical constant, the same one the runtime entitlement resolver enforces -- never a value hand-typed into the Plans UI", () => {
  assert.equal(TRIAL_CAPACITY.maxActiveSlots, 1);
  assert.equal(TRIAL_CAPACITY.maxCommunities, 1);
});
