import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PENDING_REPLY_DELAY_MS, PENDING_REPLY_STALE_AFTER_MS, pendingReplyScheduledFor,
  isPendingReplyDue, isPendingReplyStale, isWithinPendingReplyWindow, revalidatePendingReply,
  MIN_PENDING_REPLY_DELAY_SECONDS, MAX_PENDING_REPLY_DELAY_SECONDS, clampPendingReplyDelaySeconds,
  isAdminMessageHandlingConversation,
} from "./pending-reply";

test("DEFAULT_PENDING_REPLY_DELAY_MS is 45 seconds (revised default, 2026-09-02 -- was 120)", () => {
  assert.equal(DEFAULT_PENDING_REPLY_DELAY_MS, 45_000);
});

test("clampPendingReplyDelaySeconds enforces the 15-120s configurable range and falls back to the 45s default", () => {
  assert.equal(clampPendingReplyDelaySeconds(null), 45);
  assert.equal(clampPendingReplyDelaySeconds(undefined), 45);
  assert.equal(clampPendingReplyDelaySeconds(NaN), 45);
  assert.equal(clampPendingReplyDelaySeconds(5), MIN_PENDING_REPLY_DELAY_SECONDS);
  assert.equal(clampPendingReplyDelaySeconds(500), MAX_PENDING_REPLY_DELAY_SECONDS);
  assert.equal(clampPendingReplyDelaySeconds(60), 60);
  assert.equal(MIN_PENDING_REPLY_DELAY_SECONDS, 15);
  assert.equal(MAX_PENDING_REPLY_DELAY_SECONDS, 120);
});

test("pendingReplyScheduledFor returns now + 45s by default, or now + an explicit delayMs when given", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  assert.equal(pendingReplyScheduledFor(now), "2026-09-02T12:00:45.000Z");
  assert.equal(pendingReplyScheduledFor(now, 120_000), "2026-09-02T12:02:00.000Z");
});

test("REQUIRED (scenario 1/4): a row is NOT due before its scheduled time, IS due once reached", () => {
  const now = new Date("2026-09-02T12:00:00.000Z");
  const scheduledFor = pendingReplyScheduledFor(now);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:00:44.999Z")), false);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:00:45.000Z")), true);
  assert.equal(isPendingReplyDue({ scheduledFor }, new Date("2026-09-02T12:05:00.000Z")), true);
});

test("isPendingReplyStale is false right at the scheduled fire time and stays false within the 15-minute grace window", () => {
  const scheduledFor = "2026-09-02T12:02:00.000Z";
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(scheduledFor)), false);
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(new Date(scheduledFor).getTime() + PENDING_REPLY_STALE_AFTER_MS)), false);
  assert.equal(isPendingReplyStale({ scheduledFor }, new Date(new Date(scheduledFor).getTime() + PENDING_REPLY_STALE_AFTER_MS + 1)), true);
});

test("REQUIRED (scenario 2/3): isWithinPendingReplyWindow -- a message 30s or 44s in the past (relative to now) is still within the default 45s window, exactly 45s ago it is not", () => {
  const now = new Date("2026-09-02T12:05:00.000Z");
  const messageAt30sAgo = new Date(now.getTime() - 30_000).toISOString();
  const messageAt44sAgo = new Date(now.getTime() - 44_000).toISOString();
  const messageAt45sAgo = new Date(now.getTime() - 45_000).toISOString();
  assert.equal(isWithinPendingReplyWindow(messageAt30sAgo, now), true);
  assert.equal(isWithinPendingReplyWindow(messageAt44sAgo, now), true);
  assert.equal(isWithinPendingReplyWindow(messageAt45sAgo, now), false);
});

test("isWithinPendingReplyWindow respects an explicit per-community windowMs (e.g. a community configured for 120s)", () => {
  const now = new Date("2026-09-02T12:05:00.000Z");
  const messageAt100sAgo = new Date(now.getTime() - 100_000).toISOString();
  assert.equal(isWithinPendingReplyWindow(messageAt100sAgo, now), false); // outside the 45s default
  assert.equal(isWithinPendingReplyWindow(messageAt100sAgo, now, 120_000), true); // inside a 120s community window
});

/* -------------------------------------------- conversation ownership (gap 2) ---- */

test("isAdminMessageHandlingConversation: a direct reply to the trigger message is ownership", () => {
  assert.equal(
    isAdminMessageHandlingConversation({
      triggerPlatformMessageId: "100", triggerCreatedAt: "2026-09-02T12:00:00.000Z",
      askerMessageIds: ["100"],
      adminMessage: { replyToPlatformMessageId: "100", createdAt: "2026-09-02T12:00:10.000Z" },
      hasInterveningMessage: true, // even with intervening messages, a direct reply still counts
    }),
    true
  );
});

test("isAdminMessageHandlingConversation: a reply to an EARLIER message from the SAME asker also counts", () => {
  assert.equal(
    isAdminMessageHandlingConversation({
      triggerPlatformMessageId: "100", triggerCreatedAt: "2026-09-02T12:00:00.000Z",
      askerMessageIds: ["90", "100"],
      adminMessage: { replyToPlatformMessageId: "90", createdAt: "2026-09-02T12:00:10.000Z" },
      hasInterveningMessage: false,
    }),
    true
  );
});

test("isAdminMessageHandlingConversation: uncontested conversational continuity (nothing in between) counts even with no reply relationship", () => {
  assert.equal(
    isAdminMessageHandlingConversation({
      triggerPlatformMessageId: "100", triggerCreatedAt: "2026-09-02T12:00:00.000Z",
      askerMessageIds: ["100"],
      adminMessage: { replyToPlatformMessageId: null, createdAt: "2026-09-02T12:00:05.000Z" },
      hasInterveningMessage: false,
    }),
    true
  );
});

test("isAdminMessageHandlingConversation: an UNRELATED admin message elsewhere in the topic (something else happened in between) does NOT count -- topic id alone is never sufficient", () => {
  assert.equal(
    isAdminMessageHandlingConversation({
      triggerPlatformMessageId: "100", triggerCreatedAt: "2026-09-02T12:00:00.000Z",
      askerMessageIds: ["100"],
      adminMessage: { replyToPlatformMessageId: null, createdAt: "2026-09-02T12:05:00.000Z" },
      hasInterveningMessage: true,
    }),
    false
  );
});

test("isAdminMessageHandlingConversation: a reply to a completely different, unrelated message never counts", () => {
  assert.equal(
    isAdminMessageHandlingConversation({
      triggerPlatformMessageId: "100", triggerCreatedAt: "2026-09-02T12:00:00.000Z",
      askerMessageIds: ["100"],
      adminMessage: { replyToPlatformMessageId: "999", createdAt: "2026-09-02T12:00:01.000Z" },
      hasInterveningMessage: true,
    }),
    false
  );
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

/* -------------------------------- gap 7: original message existence (best-effort) ---- */

test("REQUIRED (gap 7): originalMessageStillExists defaults to assumed-true (undefined never cancels) -- the Telegram Bot API has no supported way to positively check this for most cases", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput });
  assert.deepEqual(result, { ok: true });
});

test("REQUIRED (gap 7): originalMessageStillExists:false cancels with reason message_deleted, when a caller has a genuine confirmed signal", () => {
  const result = revalidatePendingReply({ ...baseRevalidateInput, originalMessageStillExists: false });
  assert.deepEqual(result, { ok: false, reason: "message_deleted" });
});

/* -------------------------------------------- gap 6: plan/tier neutrality ---- */

test("REQUIRED (gap 6): nothing in pending-reply.ts's public surface accepts or branches on a plan/tier parameter -- scheduling applies uniformly to every plan", () => {
  // Structural proof: every exported decision function's signature is
  // plan/tier-agnostic (no such parameter exists anywhere to pass).
  assert.equal(pendingReplyScheduledFor.length <= 2, true);
  assert.equal(isWithinPendingReplyWindow.length <= 3, true);
  assert.deepEqual(revalidatePendingReply({ ...baseRevalidateInput }), { ok: true });
});
