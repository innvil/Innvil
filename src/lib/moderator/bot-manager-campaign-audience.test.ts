import { test } from "node:test";
import assert from "node:assert/strict";
import { chatTypesForAudience } from "./bot-manager-campaign-audience";

/**
 * innvil_bot_manager proactive marketing campaigns (Phase 4.Q, second half).
 * chatTypesForAudience is the one pure, client-safe piece of the sweep --
 * `sweepBotManagerCampaigns` (bot-manager-campaign-runtime.ts) is a full
 * DB/Telegram-mocked orchestrator, verified via typecheck + build + code
 * review only, consistent with this codebase's own established convention
 * for comparably complex orchestrators (sweepPresenceSchedules,
 * runAutoPostSweep, handleCommunityUpdate -- none of which has a full-mock
 * test either).
 */

test("REQUIRED: 'private_users' maps to exactly the 'private' chat type", () => {
  assert.deepEqual(chatTypesForAudience("private_users"), ["private"]);
});

test("REQUIRED: 'groups' maps to both 'group' and 'supergroup'", () => {
  assert.deepEqual(chatTypesForAudience("groups"), ["group", "supergroup"]);
});

test("REQUIRED: 'channels' maps to exactly the 'channel' chat type", () => {
  assert.deepEqual(chatTypesForAudience("channels"), ["channel"]);
});

test("REQUIRED: 'all' returns null (no chat_type filter), never an enumerated list", () => {
  assert.equal(chatTypesForAudience("all"), null);
});

test("every non-'all' audience returns a real, non-empty list of Telegram's own chat_type values", () => {
  for (const audience of ["private_users", "groups", "channels"] as const) {
    const types = chatTypesForAudience(audience);
    assert.ok(Array.isArray(types) && types.length > 0);
    for (const t of types!) assert.ok(["private", "group", "supergroup", "channel"].includes(t));
  }
});
