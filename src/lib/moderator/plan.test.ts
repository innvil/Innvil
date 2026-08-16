import { test } from "node:test";
import assert from "node:assert/strict";
import { virtualModBotAcknowledgement, hasVirtualModerator, moderatorCapacity, moderatorMaxSavedModerators, moderatorCommunityExpansionCeiling, virtualModContentGeneration, virtualModMediaModeration, virtualModVideoModeration, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "./plan";

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
