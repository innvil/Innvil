import { test } from "node:test";
import assert from "node:assert/strict";
import { virtualModBotAcknowledgement, hasVirtualModerator, moderatorCapacity, TRIAL_CAPACITY } from "./plan";

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
