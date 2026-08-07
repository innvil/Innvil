import { test } from "node:test";
import assert from "node:assert/strict";
import { virtualModBotAcknowledgement, hasVirtualModerator } from "./plan";

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
