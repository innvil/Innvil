import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidWarningPresentation, warningAudience } from "./warning-presentation";

test("placeholder and identity corrections are rejected, room mentions are forbidden", () => {
  for (const text of ["[user], really?", "[name], stop", "I'm not Rhyleky", "<b>stop</b>"]) assert.equal(invalidWarningPresentation(text, "individual"), true);
  assert.equal(invalidWarningPresentation("@SofiaAds2, enough", "room"), true);
  assert.equal(invalidWarningPresentation("c'mon guys, enough with the spam", "room"), false);
  assert.equal(invalidWarningPresentation("we've been over this", "room", false), true);
});

test("multi-sender same-topic repetition changes audience, not the offender's counter", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const row = { text: "check dm Rhyleky", senderType: "HUMAN", senderPlatformId: "1", createdAt: "2026-09-08T11:59:30Z" };
  assert.equal(warningAudience(row.text, "2", [row], now), "room");
  assert.equal(warningAudience(row.text, "1", [row], now), "individual");
  assert.equal(warningAudience("different pitch", "2", [row], now), "individual");
  assert.equal(warningAudience(row.text, "2", [{ ...row, createdAt: "2026-09-08T11:50:00Z" }], now), "individual");
});
