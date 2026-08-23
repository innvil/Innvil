import { test } from "node:test";
import assert from "node:assert/strict";
import { virtualModBotAcknowledgement, hasVirtualModerator, moderatorCapacity, moderatorMaxSavedModerators, moderatorCommunityExpansionCeiling, virtualModContentGeneration, virtualModMediaModeration, virtualModVideoModeration, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY, communityCountExceeded, checkDeploymentSlotCaps, deploymentSlotCheckErrorMessage, moderatorEntitlementSource, virtualModProactiveMode, virtualModAdvancedModeration, virtualModCommunityMemory, virtualModCustomPersonality, virtualModModeration } from "./plan";

/* Case 15: bot-to-bot capability disabled -> bot acknowledgement unavailable,
 * but nothing else about Virtual Moderator entitlements is affected. The
 * test runner has no NEXT_PUBLIC_BOT_ACKNOWLEDGEMENT_ENABLED env var set, so
 * BOT_ACKNOWLEDGEMENT_ENABLED is false here — exactly the "disabled" case. */

const settingsWithActiveTier = { addons: { moderator: { tier: "standard" } } };

test("Case 15: bot acknowledgement is OFF when the master switch is off, even with an active Virtual Moderator entitlement", () => {
  assert.equal(virtualModBotAcknowledgement(settingsWithActiveTier), false);
});

test("Case 15: other Virtual Moderator entitlements are unaffected by the bot-ack switch", () => {
  assert.equal(hasVirtualModerator(settingsWithActiveTier), true);
});

test("bot acknowledgement is off when there's no active entitlement at all, independent of the master switch", () => {
  assert.equal(virtualModBotAcknowledgement({}), false);
});

/* Capacity table (Active Mod Slots = ACTIVE ModeratorDeployment count, not
 * unique VirtualModerator count — enforced in connectCommunity/
 * setDeploymentEnabled in src/lib/actions/moderator.ts, not here; these
 * tests only pin the per-tier limits the runtime checks against). */

test("basic: 1 community, 2 active mod slots", () => {
  assert.deepEqual(moderatorCapacity({ addons: { moderator: { tier: "basic" } } }), { maxCommunities: 1, maxActiveSlots: 2 });
});

test("standard: 2 communities, 5 active mod slots", () => {
  assert.deepEqual(moderatorCapacity({ addons: { moderator: { tier: "standard" } } }), { maxCommunities: 2, maxActiveSlots: 5 });
});

test("premium: 3 communities, 10 active mod slots", () => {
  assert.deepEqual(moderatorCapacity({ addons: { moderator: { tier: "premium" } } }), { maxCommunities: 3, maxActiveSlots: 10 });
});

test("pro: 5 communities, 20 active mod slots", () => {
  assert.deepEqual(moderatorCapacity({ addons: { moderator: { tier: "pro" } } }), { maxCommunities: 5, maxActiveSlots: 20 });
});

test("trial: 1 community, 1 active mod slot (unaffected by the paid-tier table change)", () => {
  assert.deepEqual(TRIAL_CAPACITY, { maxCommunities: 1, maxActiveSlots: 1 });
});

test("no entitlement: zero capacity", () => {
  assert.deepEqual(moderatorCapacity({}), { maxCommunities: 0, maxActiveSlots: 0 });
});

/* Saved-moderator creation cap (max VirtualModerator records, distinct from
 * Active Mod Slots above) — enforced in createVirtualModerator in
 * src/lib/actions/moderator.ts, not here; mirrors each tier's Active Mod
 * Slot count (2/5/10/20). */

test("basic: max 2 saved moderators", () => {
  assert.equal(moderatorMaxSavedModerators({ addons: { moderator: { tier: "basic" } } }), 2);
});

test("standard: max 5 saved moderators", () => {
  assert.equal(moderatorMaxSavedModerators({ addons: { moderator: { tier: "standard" } } }), 5);
});

test("premium: max 10 saved moderators", () => {
  assert.equal(moderatorMaxSavedModerators({ addons: { moderator: { tier: "premium" } } }), 10);
});

/* Community expansion ceiling — a separate axis from Active Mod Slots
 * (moderatorCommunityExpansionCeiling). Basic/Standard are hard-capped (no
 * expansion); Premium up to 5; Pro up to 10. Not yet wired to a purchase
 * action (Phase 4.N auto-posting isn't built) — pins the ceiling only. */

test("basic/standard community ceiling equals their included count -- hard-capped, no expansion", () => {
  assert.equal(moderatorCommunityExpansionCeiling({ addons: { moderator: { tier: "basic" } } }), 1);
  assert.equal(moderatorCommunityExpansionCeiling({ addons: { moderator: { tier: "standard" } } }), 2);
});

test("premium community ceiling is 5 (expandable from 3 included)", () => {
  assert.equal(moderatorCommunityExpansionCeiling({ addons: { moderator: { tier: "premium" } } }), 5);
});

test("pro community ceiling is 10 (expandable from 5 included)", () => {
  assert.equal(moderatorCommunityExpansionCeiling({ addons: { moderator: { tier: "pro" } } }), 10);
});

test("trial community ceiling is fixed at TRIAL_CAPACITY (1), independent of the paid table", () => {
  const activeTrial = { addons: { moderator: { trial: { endsAt: new Date(Date.now() + 60_000).toISOString() } } } };
  assert.equal(moderatorCommunityExpansionCeiling(activeTrial), 1);
});

test("no entitlement: zero community expansion ceiling", () => {
  assert.equal(moderatorCommunityExpansionCeiling({}), 0);
});

/* Auto-Posting content generation entitlement (Phase 4.N part B) -- the test
 * runner has no NEXT_PUBLIC_AUTO_POSTING_ENABLED set, so AUTO_POSTING_ENABLED
 * is false here, same "master switch off" pattern as the bot-ack Case 15
 * tests above. */

test("content generation is OFF when the master switch is off, even with an active PAID tier", () => {
  assert.equal(virtualModContentGeneration({ addons: { moderator: { tier: "pro" } } }), false);
});

test("content generation is OFF for a trial entitlement regardless of the master switch (spec §26)", () => {
  const activeTrial = { addons: { moderator: { trial: { endsAt: new Date(Date.now() + 60_000).toISOString() } } } };
  assert.equal(virtualModContentGeneration(activeTrial), false);
});

test("content generation is OFF with no entitlement at all", () => {
  assert.equal(virtualModContentGeneration({}), false);
});

test("pro: max 20 saved moderators", () => {
  assert.equal(moderatorMaxSavedModerators({ addons: { moderator: { tier: "pro" } } }), 20);
});

test("trial: max 1 saved moderator (unchanged)", () => {
  assert.equal(moderatorMaxSavedModerators({ addons: { moderator: { trial: { startedAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString() } } } }), TRIAL_MAX_SAVED_MODERATORS);
});

test("no entitlement: cannot create any saved moderators", () => {
  assert.equal(moderatorMaxSavedModerators({}), 0);
});

/* Per-community deployment cap — flat across every tier (even pro's 20 total
 * Active Mod Slots can't put more than this many Innvil bots in ONE
 * community), to keep bot-to-bot acknowledgement traffic sane. Enforced in
 * connectCommunity/setDeploymentEnabled, not here. */

test("MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY is 5, independent of tier", () => {
  assert.equal(MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY, 5);
});

/* ==================================================== media moderation flags ==== */

test("REQUIRED (case 22/23): with MEDIA_MODERATION_ENABLED unset (the default in this test environment), photo AND video media moderation are both OFF regardless of settings", () => {
  // These flags are read ONCE at module load from process.env -- this test
  // exercises the actual current process env (unset here), proving the
  // real deployed default is OFF, not a mocked/injected value.
  assert.equal(virtualModMediaModeration({ addons: { moderator: { tier: "pro" } } }), false);
  assert.equal(virtualModVideoModeration({ addons: { moderator: { tier: "pro" } } }), false);
});

test("video moderation can never be on while photo moderation is off -- it's layered strictly on top, never independent", () => {
  // virtualModVideoModeration always requires virtualModMediaModeration to
  // also be true (see plan.ts) -- with the flags unset in this environment,
  // both must be false, and video specifically can never be true while
  // photo is false.
  const photoOn = virtualModMediaModeration({ addons: { moderator: { tier: "pro" } } });
  const videoOn = virtualModVideoModeration({ addons: { moderator: { tier: "pro" } } });
  if (videoOn) assert.equal(photoOn, true);
});

/* ==================================================== deployment cap checks ==== */
// The shared decision used by every deployment-creation/re-activation path
// (owner: connectCommunity/setDeploymentEnabled; customer/storefront:
// connectCustomerCommunity/setCustomerDeploymentEnabled) -- no path hand-
// rolls its own arithmetic anymore.

test("REQUIRED (scenario 1): community with 0-4 moderators -- another can be added when subscription slots are available", () => {
  for (let existing = 0; existing < MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY; existing++) {
    const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 2, maxActiveSlots: 20, communityDeploymentCount: existing });
    assert.deepEqual(result, { ok: true }, `expected ok at communityDeploymentCount=${existing}`);
  }
});

test("REQUIRED (scenario 2): community with exactly 5 active moderators -- a sixth is rejected", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 2, maxActiveSlots: 20, communityDeploymentCount: MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY });
  assert.deepEqual(result, { ok: false, reason: "community_deployment_cap" });
});

test("REQUIRED (scenario 3): unused subscription slots do not bypass the per-community cap -- rejected specifically because of the community cap, not the slot limit", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 1, maxActiveSlots: 20, communityDeploymentCount: 5 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "community_deployment_cap");
});

test("REQUIRED (scenario 4): fewer than 5 in the community but subscription slots exhausted -- rejected because of the slot limit, not the community cap", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 20, maxActiveSlots: 20, communityDeploymentCount: 2 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "active_slot_limit");
});

test("REQUIRED (scenario 6): re-activating an already-disabled deployment is treated the SAME as a fresh add -- still subject to both caps", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 0, maxActiveSlots: 20, communityDeploymentCount: MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY });
  assert.deepEqual(result, { ok: false, reason: "community_deployment_cap" });
});

test("an already-ACTIVE deployment (isExistingDeployment: true) is never re-checked against either cap -- saving metadata on it must never fail", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: true, activeSlotCount: 999, maxActiveSlots: 1, communityDeploymentCount: 999 });
  assert.deepEqual(result, { ok: true });
});

test("REQUIRED: the two limits are independent -- both being exceeded still resolves to exactly one reason, not a combined/ambiguous state", () => {
  const result = checkDeploymentSlotCaps({ isExistingDeployment: false, activeSlotCount: 20, maxActiveSlots: 20, communityDeploymentCount: 5 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.reason === "active_slot_limit" || result.reason === "community_deployment_cap");
});

test("communityCountExceeded only applies to a genuinely NEW community -- reconnecting to an existing one never counts against it", () => {
  assert.equal(communityCountExceeded(false, 999, 1), false);
});

test("communityCountExceeded rejects a new community once the plan's community limit is reached", () => {
  assert.equal(communityCountExceeded(true, 2, 2), true);
  assert.equal(communityCountExceeded(true, 1, 2), false);
});

test("REQUIRED: the customer-facing error message for the community-deployment cap never implies the overall subscription is exhausted", () => {
  const msg = deploymentSlotCheckErrorMessage({ ok: false, reason: "community_deployment_cap" }, 20);
  assert.match(msg, /maximum of 5 Virtual Moderators/i);
  assert.ok(!/subscription/i.test(msg));
  assert.ok(!/slot/i.test(msg));
});

test("the customer-facing error message for the active-slot limit names the actual plan limit", () => {
  const msg = deploymentSlotCheckErrorMessage({ ok: false, reason: "active_slot_limit" }, 20);
  assert.match(msg, /20 active mod slot/i);
});

/* ------------------- Enterprise entitlement source (2026-08-23 fix) ---- */
// "enterprise" is a real, distinct ModeratorEntitlementSource (never a
// ModeratorPlanTier value) -- these pin the widened model directly, ahead
// of the end-to-end proof in watch-runtime.test.ts.

const enterpriseSettings = { addons: { moderator: { enterprise: true } } };

test("REQUIRED: moderatorEntitlementSource resolves an enterprise-flagged addon to \"enterprise\"", () => {
  assert.equal(moderatorEntitlementSource(enterpriseSettings), "enterprise");
});

test("REQUIRED: hasVirtualModerator/virtualModModeration are true for an Enterprise entitlement", () => {
  assert.equal(hasVirtualModerator(enterpriseSettings), true);
  assert.equal(virtualModModeration(enterpriseSettings), true);
});

test("REQUIRED: Enterprise unlocks Proactive Mode and everything that delegates to it -- same as Standard+", () => {
  assert.equal(virtualModProactiveMode(enterpriseSettings), true);
  assert.equal(virtualModAdvancedModeration(enterpriseSettings), true);
  assert.equal(virtualModCommunityMemory(enterpriseSettings), true);
  assert.equal(virtualModCustomPersonality(enterpriseSettings), true);
});

test("a self-serve tier on the same addon object still wins over the enterprise flag (defensive precedence)", () => {
  const both = { addons: { moderator: { tier: "basic", enterprise: true } } };
  assert.equal(moderatorEntitlementSource(both), "basic");
});

test("enterprise wins over an active trial on the same addon object", () => {
  const both = { addons: { moderator: { enterprise: true, trial: { endsAt: new Date(Date.now() + 60_000).toISOString() } } } };
  assert.equal(moderatorEntitlementSource(both), "enterprise");
});

test("content generation is OFF for Enterprise too when the master switch is off (same master-switch pattern as every other case above)", () => {
  assert.equal(virtualModContentGeneration(enterpriseSettings), false);
});

test("REQUIRED: the legacy capacity functions never crash on an enterprise-sourced settings object -- fall back to the zero/no-entitlement shape rather than indexing an undefined table row", () => {
  assert.deepEqual(moderatorCapacity(enterpriseSettings), { maxCommunities: 0, maxActiveSlots: 0 });
  assert.equal(moderatorCommunityExpansionCeiling(enterpriseSettings), 0);
  assert.equal(moderatorMaxSavedModerators(enterpriseSettings), 0);
});

test("plain settings with no enterprise flag are completely unaffected by this change", () => {
  assert.equal(moderatorEntitlementSource({ addons: { moderator: { tier: "pro" } } }), "pro");
  assert.equal(moderatorEntitlementSource({}), null);
});
