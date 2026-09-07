import { test } from "node:test";
import assert from "node:assert/strict";
import { formatModerationReportText, moderationReportHeading, formatPriorWarningLine, type ModerationReportEvent } from "./watcher-ops-report";

/**
 * Watcher Ops moderation-reporting expansion -- pure, deterministic,
 * template-based formatting, no AI/LLM call anywhere in this file (see the
 * file's own header comment on why this structurally can never consume AI
 * usage). Every scenario mirrors one of the spec's own worked examples.
 */

function baseEvent(over: Partial<ModerationReportEvent> = {}): ModerationReportEvent {
  return {
    communityLabel: "Example Community",
    userMention: "@username",
    violationCategory: "spam",
    warningNumber: null,
    warningLimit: null,
    muteMinutes: null,
    actionsTaken: [],
    reasonText: "",
    previousEnforcementSummary: [],
    purgedCount: null,
    purgeFailed: false,
    purgeFailureReason: null,
    telegramActionFailed: false,
    telegramFailureReason: null,
    ...over,
  };
}

test("REQUIRED: first spam violation renders 'Spam Warning' with the exact warning-of-limit and mute-duration facts", () => {
  const event = baseEvent({
    warningNumber: 1, warningLimit: 2, muteMinutes: 10,
    actionsTaken: ["warning", "temporary_mute"],
    reasonText: "First confirmed spam/unsolicited-promotion violation.",
  });
  assert.equal(moderationReportHeading(event), "Spam Warning");
  const text = formatModerationReportText(event);
  assert.match(text, /Warning 1 of 2/);
  assert.match(text, /muted for 10 minutes/);
  assert.match(text, /Example Community/);
  assert.match(text, /@username/);
});

test("REQUIRED: second spam violation renders 'Repeated Spam' with the 30-minute mute and prior history line", () => {
  const event = baseEvent({
    warningNumber: 2, warningLimit: 2, muteMinutes: 30,
    actionsTaken: ["warning", "temporary_mute"],
    previousEnforcementSummary: [formatPriorWarningLine(1, 10)],
    reasonText: "Repeated spam/unsolicited-promotion after a prior warning.",
  });
  assert.equal(moderationReportHeading(event), "Repeated Spam");
  const text = formatModerationReportText(event);
  assert.match(text, /Warning 2 of 2/);
  assert.match(text, /muted for 30 minutes/);
  assert.match(text, /Warning 1 -> muted for 10 minutes/);
});

test("REQUIRED: third spam violation kicks + purges -> 'User Removed — Repeated Spam', real purge count included", () => {
  const event = baseEvent({
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 21,
    reasonText: "Repeated spam after prior warnings and temporary restrictions.",
  });
  assert.equal(moderationReportHeading(event), "User Removed — Repeated Spam");
  const text = formatModerationReportText(event);
  assert.match(text, /User kicked/);
  assert.match(text, /Cleanup: 21 messages purged\./);
});

/* -------------------------- COMPETING_PROJECT_PROMOTION ("global no-go") ---- */
// Live feedback (2026-09-02): promoting a different, specifically named
// project/token gets its OWN distinct report category -- never silently
// lumped in with generic "Spam", which would misdescribe the actual
// violation in the internal Watcher Ops audit trail.

test("REQUIRED: first competing-project-promotion violation renders its own distinct 'Competing Project Promotion Warning' heading, never generic Spam", () => {
  const event = baseEvent({
    violationCategory: "competing_project",
    warningNumber: 1, warningLimit: 4,
    actionsTaken: ["warning"],
    reasonText: "First confirmed rally/request to promote a different, unrelated project or token.",
  });
  assert.equal(moderationReportHeading(event), "Competing Project Promotion Warning");
  assert.notEqual(moderationReportHeading(event), "Spam Warning");
});

test("REQUIRED: a repeated competing-project-promotion violation renders 'Repeated Competing Project Promotion'", () => {
  const event = baseEvent({
    violationCategory: "competing_project",
    warningNumber: 2, warningLimit: 4,
    actionsTaken: ["warning"],
    reasonText: "Repeated rallying to promote a different, unrelated project or token after a prior warning.",
  });
  assert.equal(moderationReportHeading(event), "Repeated Competing Project Promotion");
});

test("REQUIRED: a kicked competing-project-promotion offender renders 'User Removed — Repeated Competing Project Promotion', with the real purge count", () => {
  const event = baseEvent({
    violationCategory: "competing_project",
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 5,
    reasonText: "Repeated rallying to promote a different, unrelated project or token after prior warnings.",
  });
  assert.equal(moderationReportHeading(event), "User Removed — Repeated Competing Project Promotion");
  const text = formatModerationReportText(event);
  assert.match(text, /User kicked/);
  assert.match(text, /Cleanup: 5 messages purged\./);
});

/* -------------------------------------------- SEARCH_SPAM (off_topic_spam) ---- */
// Live feedback (2026-09-03): an off-topic "search X" spam instruction gets
// its own distinct report category too -- never generic "Spam" (which
// already means ordinary unsolicited-promotion spam) and never confused
// with COMPETING_PROJECT_PROMOTION.

test("REQUIRED: first off-topic-spam violation renders its own distinct 'Off-Topic Spam Warning' heading, never generic Spam or Competing Project Promotion", () => {
  const event = baseEvent({
    violationCategory: "off_topic_spam",
    warningNumber: 1, warningLimit: 4,
    actionsTaken: ["warning"],
    reasonText: "First confirmed off-topic spam instruction, unrelated to this project.",
  });
  assert.equal(moderationReportHeading(event), "Off-Topic Spam Warning");
  assert.notEqual(moderationReportHeading(event), "Spam Warning");
  assert.notEqual(moderationReportHeading(event), "Competing Project Promotion Warning");
});

test("REQUIRED: a repeated off-topic-spam violation renders 'Repeated Off-Topic Spam'", () => {
  const event = baseEvent({
    violationCategory: "off_topic_spam",
    warningNumber: 2, warningLimit: 4,
    actionsTaken: ["warning"],
    reasonText: "Repeated off-topic spam instruction after a prior warning.",
  });
  assert.equal(moderationReportHeading(event), "Repeated Off-Topic Spam");
});

test("REQUIRED: a kicked off-topic-spam offender renders 'User Removed — Repeated Off-Topic Spam', with the real purge count", () => {
  const event = baseEvent({
    violationCategory: "off_topic_spam",
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 3,
    reasonText: "Repeated off-topic spam after prior warnings and temporary restrictions.",
  });
  assert.equal(moderationReportHeading(event), "User Removed — Repeated Off-Topic Spam");
  const text = formatModerationReportText(event);
  assert.match(text, /User kicked/);
  assert.match(text, /Cleanup: 3 messages purged\./);
});

test("REQUIRED: first scam-link violation -> 'Scam Link Removed', mute duration stated, never includes a URL", () => {
  const event = baseEvent({
    violationCategory: "scam_link", warningNumber: 1, warningLimit: 1, muteMinutes: 30,
    actionsTaken: ["warning", "temporary_mute"],
    reasonText: "First confirmed scam/phishing link from this member.",
  });
  assert.equal(moderationReportHeading(event), "Scam Link Removed");
  const text = formatModerationReportText(event);
  assert.match(text, /muted for 30 minutes/);
  assert.ok(!/https?:\/\//i.test(text));
});

test("REQUIRED: second scam-link violation kicks + purges -> 'User Removed — Repeated Scam Links'", () => {
  const event = baseEvent({
    violationCategory: "scam_link",
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 4,
    previousEnforcementSummary: [formatPriorWarningLine(1, 30)],
    reasonText: "Repeated confirmed scam/phishing link after a prior warning.",
  });
  assert.equal(moderationReportHeading(event), "User Removed — Repeated Scam Links");
  const text = formatModerationReportText(event);
  assert.match(text, /Warning 1 -> muted for 30 minutes/);
  assert.match(text, /Cleanup: 4 messages purged\./);
});

test("REQUIRED: confirmed NSFW content -> 'User Removed — Prohibited NSFW Content', no warning line at all, never embeds media", () => {
  const event = baseEvent({
    violationCategory: "nsfw",
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 3,
    reasonText: "User posted prohibited pornographic/NSFW content.",
  });
  assert.equal(moderationReportHeading(event), "User Removed — Prohibited NSFW Content");
  const text = formatModerationReportText(event);
  assert.ok(!text.includes("Warning"));
  assert.match(text, /User kicked/);
  assert.match(text, /pornographic\/NSFW content/);
});

test("REQUIRED (spec §12): a failed removal renders 'Moderation Action Partially Failed' with the real failure reason, never a false success claim", () => {
  const event = baseEvent({
    violationCategory: "scam_link",
    actionsTaken: ["kick"],
    telegramActionFailed: true,
    telegramFailureReason: "The Watcher does not currently have permission to ban users.",
  });
  assert.equal(moderationReportHeading(event), "Moderation Action Partially Failed");
  const text = formatModerationReportText(event);
  assert.match(text, /does not currently have permission to ban users/);
  assert.match(text, /User removal failed/, "the specific action that failed must state so per-item, not a generic 'kicked' success line");
  assert.ok(!text.includes("User kicked"), "a claimed action must not read as a plain success line when it actually failed");
});

test("REQUIRED (spec §12): a purge failure is reported honestly, distinct from the primary action's own success/failure", () => {
  const event = baseEvent({
    actionsTaken: ["kick", "message_purge"],
    purgedCount: 0,
    purgeFailed: true,
    purgeFailureReason: "The Watcher does not currently have permission to remove older messages.",
    reasonText: "Repeated spam after prior warnings and temporary restrictions.",
  });
  const text = formatModerationReportText(event);
  assert.match(text, /Cleanup failed: The Watcher does not currently have permission to remove older messages\./);
  assert.match(text, /User kicked/, "the primary action itself still succeeded and should read as such");
});

test("purgedCount: null (never attempted) omits the cleanup line entirely -- never claims 0 messages were purged when purge was never even tried", () => {
  const event = baseEvent({ actionsTaken: ["warning", "temporary_mute"], warningNumber: 1, warningLimit: 2, muteMinutes: 10 });
  const text = formatModerationReportText(event);
  assert.ok(!text.includes("Cleanup"));
});

test("the structured event is the source of truth -- rendering the same event twice produces byte-identical text (fully deterministic, no randomness)", () => {
  const event = baseEvent({ warningNumber: 1, warningLimit: 2, muteMinutes: 10, actionsTaken: ["warning", "temporary_mute"], reasonText: "First confirmed spam/unsolicited-promotion violation." });
  assert.equal(formatModerationReportText(event), formatModerationReportText(event));
});

test("formatPriorWarningLine renders the exact 'Warning N -> muted for X minutes' shape from the spec's own worked examples", () => {
  assert.equal(formatPriorWarningLine(1, 10), "Warning 1 -> muted for 10 minutes");
  assert.equal(formatPriorWarningLine(2, 30), "Warning 2 -> muted for 30 minutes");
});

test("formatPriorWarningLine handles a warning with no mute (e.g. a borderline media warning) without fabricating a duration", () => {
  assert.equal(formatPriorWarningLine(1, null), "Warning 1 issued");
});
