import test from "node:test";
import assert from "node:assert/strict";
import {
  PENDING_REPLY_DELAY_MS, PENDING_REPLY_STALE_AFTER_MS, pendingReplyScheduledFor,
  isPendingReplyDue, isPendingReplyStale, isWithinPendingReplyWindow, revalidatePendingReply,
} from "./pending-reply";

test("PENDING_REPLY_DELAY_MS is exactly 120 seconds", () => {
  assert.equal(PENDING_REPLY_DELAY_MS, 120_000);
});

test("pendingReplyScheduledFor returns now + 120s", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  assert.equal(pendingReplyScheduledFor(now), "2026-09-02T12:02:00.000Z");
});

test("REQUIRED (scenario 1/4): a row is NOT due before its scheduled time, IS due once reached", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const scheduledFor = pendingReplyScheduledFor(now);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:01:59.999Z")), false);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:02:00.000Z")), true);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:05:00.000Z")), true);
});

test("isPendingReplyStale is false right at the scheduled fire time and stays false within the 15-minute grace window", () => {
  const scheduledFor = "2026-09-02T12:02:00.000Z";
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(scheduledFor)), false);
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(new Date(scheduledFor).getTime() + PENDING_REPLY_STALE_AFTER_MS)), false);
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(new Date(scheduledFor).getTime() + PENDING_REPLY_STALE_AFTER_MS + 1)), true);
});

test("REQUIRED (scenario 2/3): isWithinPendingReplyWindow -- a message 30s or 119s in the past (relative to now) is still within the 120s window, exactly 120s ago it is not", () => {
  const now = new Date("2026-09-02T12:05:00.000Z");
  const messageAt30sAgo = new Date(now.getTime() - 30_000).toISOString();
  const messageAt119sAgo = new Date(now.getTime() - 119_000).toISOString();
  const messageAt120sAgo = new Date(now.getTime() - 120_000).toISOString();
  assert.equal(isWithinPendingReplyWindow(messageAt30sAgo, now), true);
  assert.equal(isWithinPendingReplyWindow(messageAt119sAgo, now), true);
  assert.equal(isWithinPendingReplyWindow(messageAt120sAgo, now), false);
});

test("isWithinPendingReplyWindow is false for null/undefined -- never treats 'no message at all' as recent", () => {
  const now = new Date();
  assert.equal(isWithinPendingReplyWindow(null, now), false);
  assert.equal(isWithinPendingReplyWindow(undefined, now), false);
});

/* ------------------------------------------------ revalidatePendingReply ---- */

const baseRevalidateInput = {
  now: new Date("2026-09-02T12:03:00.000Z"),
  row: { scheduledFor: "2026-09-02T12:02:00.000Z" },
  alreadyAnsweredByModerator: false,
  adminRespondedSinceScheduling: false,
  senderStillPresent: true,
};

test("REQUIRED (scenario 4): a due, unresolved reply revalidates OK -- the Watcher may respond", () => {
  assert.deepEqual(revalidatePendingReply(baseRevalidateInput), { ok: true });
});

test("REQUIRED (scenario 2/3, fire-time re-check): an admin responded since scheduling -> cancelled, reason admin_replied", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput, adminRespondedSinceScheduling: true });
  assert.deepEqual(result, { ok: false, reason: "admin_replied" });
});

test("already answered by a moderator -> cancelled, reason already_answered", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput, alreadyAnsweredByModerator: true });
  assert.deepEqual(result, { ok: false, reason: "already_answered" });
});

test("the original asker is no longer present -> cancelled, reason user_left", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput, senderStillPresent: false });
  assert.deepEqual(result, { ok: false, reason: "user_left" });
});

test("a stale (very late) row -> cancelled, reason expired, checked BEFORE every other condition", () => {
  const staleNow = new Date(new Date(baseRevalidateInput.row.scheduledFor).getTime() + PENDING_REPLY_STALE_AFTER_MS + 1);
  // Even with everything else looking fine, staleness wins first.
  const result = revalidatePendingReply({ ...baseRevalidateInput, now: staleNow });
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("admin_replied is checked before already_answered when both are somehow true -- admin activity is the stronger signal", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput, adminRespondedSinceScheduling: true, alreadyAnsweredByModerator: true });
  assert.deepEqual(result, { ok: false, reason: "admin_replied" });
});
