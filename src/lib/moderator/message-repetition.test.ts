import { test } from "node:test";
import assert from "node:assert/strict";
import { isRepeatedDmNudge, isRapidMessageFlood } from "./message-repetition";
const now = new Date("2026-09-09T00:00:00Z");
const prior = (text: string, seconds = 10, id = "7") => ({ text, senderType: "HUMAN", senderPlatformId: id, createdAt: new Date(now.getTime() - seconds * 1000).toISOString() });
test("one DM nudge is silent; three same-sender unsolicited nudges are a repeat", () => {
  const text = "Rhyleky check dm";
  assert.equal(isRepeatedDmNudge(text, "7", [], now), false);
  assert.equal(isRepeatedDmNudge(text, "7", [prior(text)], now), false);
  assert.equal(isRepeatedDmNudge(text, "7", [prior(text), prior(text, 20)], now), true);
  assert.equal(isRepeatedDmNudge(text, "7", [prior(text), prior(text, 20)], now, true), false);
  assert.equal(isRepeatedDmNudge(text, "7", [prior(text, 310), prior(text, 320)], now), false);
  assert.equal(isRepeatedDmNudge(text, "7", [prior(text, 10, "8"), prior(text, 20, "9")], now), false);
});
test("same official link shared in different replies or over minutes is not a rapid flood", () => {
  const text = "https://project.test/docs";
  assert.equal(isRapidMessageFlood(text, "7", [prior(text, 60), prior(text, 120), prior(text, 180)], now), false);
  assert.equal(isRapidMessageFlood(text, "7", [prior(text), prior(text, 15), prior(text, 20)], now, true), false);
  assert.equal(isRapidMessageFlood(text, "7", [prior(text), prior(text, 15), prior(text, 20)], now), true);
  assert.equal(isRapidMessageFlood("Rhyleky check dm", "7", Array.from({ length: 3 }, () => prior("Rhyleky check dm")), now), false);
});
