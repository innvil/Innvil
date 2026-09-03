/* =========================================================
   Watcher Ops moderation reports — pure deterministic formatting, no I/O,
   no AI/LLM call of any kind.

   Expands the private Escalation Group (Phase 1, escalation-runtime.ts)
   from a knowledge-only channel into the project's real "Watcher Ops"
   operational record: alongside unresolved-question escalations, Watchers
   now also report the moderation actions they take (warnings, temporary
   mutes, kicks, message purges, scam/NSFW removals, and permission
   failures) as a structured, human-readable audit trail.

   AI-USAGE RULE: a report built from this module is ENTIRELY template-based
   -- every fact (username, warning number, mute duration, purge count,
   Telegram success/failure) is already known to the backend before this
   function ever runs. This file has zero import of ai/client.ts,
   chatter-generate.ts, or any other generation module, so a report built
   here structurally cannot consume AI Generation pool / BYO usage
   accounting -- there is nothing to charge, by construction, not merely by
   convention. (The separate, PUBLIC-facing warning message shown in the
   community itself may still be AI-phrased for ordinary spam/promotion
   warnings, per Natural Moderation's existing, unrelated behavior -- that
   is a different message from the one this module formats.)
   ========================================================= */

export type ModerationViolationCategory = "spam" | "competing_project" | "off_topic_spam" | "scam_link" | "nsfw" | "explicit_link";

export type ModerationActionKind = "warning" | "temporary_mute" | "kick" | "ban" | "message_purge" | "moderation_failure";

/** The structured event is the source of truth (spec: "do not depend on
 *  generated prose as the source of truth") -- formatModerationReportText
 *  below is purely a deterministic RENDERING of this shape, never the other
 *  way around. Every field here mirrors the watch_moderation_reports
 *  table's own columns 1:1. */
export interface ModerationReportEvent {
  communityLabel: string;
  /** Rendered mention (via link-moderation.ts's renderHumanModerationMention)
   *  or a plain fallback -- this module doesn't render mentions itself, it
   *  only places the already-rendered string. */
  userMention: string;
  violationCategory: ModerationViolationCategory;
  /** "Warning N of M" -- both null when this event never involved a
   *  warning at all (e.g. an immediate zero-tolerance NSFW kick). */
  warningNumber: number | null;
  warningLimit: number | null;
  /** Set when THIS event includes a fresh mute (never a mute already in
   *  effect from a prior event). */
  muteMinutes: number | null;
  /** Ordered — the actions this SPECIFIC event actually took, in the order
   *  they happened. Drives which template lines render. */
  actionsTaken: ModerationActionKind[];
  /** Short, human-facing explanation of why enforcement fired (e.g.
   *  "Repeated spam after two temporary restrictions."). Always deterministic
   *  text, composed by the caller from real facts -- never AI-generated. */
  reasonText: string;
  /** Prior enforcement history for THIS user, as plain lines (e.g.
   *  "Warning 1 -> muted for 10 minutes") -- empty when this is the first
   *  recorded violation. */
  previousEnforcementSummary: string[];
  /** null = purge never attempted; a number (incl. 0) = purge was
   *  attempted and Telegram confirmed this many deletions. Never claim a
   *  purge succeeded unless Telegram actually confirmed it (spec §12) --
   *  the caller must only set a non-null value after real attempts. */
  purgedCount: number | null;
  purgeFailed: boolean;
  purgeFailureReason: string | null;
  /** True when the PRIMARY moderation action itself (mute/kick/ban) failed
   *  at Telegram -- distinct from a purge failure, which can happen
   *  independently of whether the main action succeeded. */
  telegramActionFailed: boolean;
  telegramFailureReason: string | null;
}

function violationLabel(category: ModerationViolationCategory): string {
  switch (category) {
    case "spam": return "Spam";
    case "competing_project": return "Competing Project Promotion";
    case "off_topic_spam": return "Off-Topic Spam";
    case "scam_link": return "Scam Link";
    case "nsfw": return "Prohibited NSFW Content";
    case "explicit_link": return "Explicit Link";
  }
}

/** Deterministically picks the report heading -- never left to an LLM to
 *  choose wording (spec §18: "keep the format predictable"). */
export function moderationReportHeading(event: ModerationReportEvent): string {
  if (event.telegramActionFailed) return "Moderation Action Partially Failed";
  const kicked = event.actionsTaken.includes("kick") || event.actionsTaken.includes("ban");
  if (event.violationCategory === "nsfw" || event.violationCategory === "explicit_link") {
    return "User Removed — Prohibited NSFW Content";
  }
  if (event.violationCategory === "scam_link") {
    return kicked ? "User Removed — Repeated Scam Links" : "Scam Link Removed";
  }
  if (event.violationCategory === "competing_project") {
    if (kicked) return "User Removed — Repeated Competing Project Promotion";
    return event.warningNumber === 1 ? "Competing Project Promotion Warning" : "Repeated Competing Project Promotion";
  }
  if (event.violationCategory === "off_topic_spam") {
    if (kicked) return "User Removed — Repeated Off-Topic Spam";
    return event.warningNumber === 1 ? "Off-Topic Spam Warning" : "Repeated Off-Topic Spam";
  }
  // spam
  if (kicked) return "User Removed — Repeated Spam";
  if (event.warningNumber === 1) return "Spam Warning";
  return "Repeated Spam";
}

/** Renders one action line -- when `event.telegramActionFailed` is set, the
 *  PRIMARY action (mute/kick/ban -- the one that actually failed, per this
 *  event's own definition) reads as a real failure, per-item, rather than a
 *  generic "Attempted:" header slapped over otherwise-unchanged success
 *  text (spec §12's own worked example: "Scam message removed successfully
 *  / User removal failed" -- each line states its OWN real outcome). A
 *  message_purge line always reflects purgeFailed independently -- a
 *  purge can fail even when the primary action succeeded, and vice versa. */
function actionLine(kind: ModerationActionKind, event: ModerationReportEvent): string | null {
  switch (kind) {
    case "warning":
      return event.warningNumber != null && event.warningLimit != null
        ? `Warning ${event.warningNumber} of ${event.warningLimit}`
        : "Warning issued";
    case "temporary_mute":
      if (event.telegramActionFailed) return "Mute attempt failed";
      return event.muteMinutes != null ? `User muted for ${event.muteMinutes} minutes` : "User muted";
    case "kick":
      return event.telegramActionFailed ? "User removal failed" : "User kicked";
    case "ban":
      return event.telegramActionFailed ? "User removal failed" : "User banned";
    case "message_purge":
      if (event.purgedCount == null) return null;
      if (event.purgeFailed) return `Cleanup failed: ${event.purgeFailureReason ?? "the Watcher could not remove the user's messages."}`;
      return `Cleanup: ${event.purgedCount} message${event.purgedCount === 1 ? "" : "s"} purged.`;
    case "moderation_failure":
      return null; // rendered via the telegramActionFailed branch below instead
  }
}

/** Deterministic, template-based rendering (spec §3: "generate the report
 *  from structured templates... not by asking an LLM to write a summary").
 *  Every fact rendered here is already present on `event` -- this function
 *  never infers, guesses, or embellishes. */
export function formatModerationReportText(event: ModerationReportEvent): string {
  const lines: string[] = [moderationReportHeading(event), ""];
  lines.push(`Community: ${event.communityLabel}`);
  lines.push(`User: ${event.userMention}`);

  if (event.previousEnforcementSummary.length > 0) {
    lines.push("", "History:");
    for (const h of event.previousEnforcementSummary) lines.push(`- ${h}`);
  }

  const actionLines = event.actionsTaken.map((k) => actionLine(k, event)).filter((l): l is string => l != null);
  if (actionLines.length > 0) {
    lines.push("", "Action:");
    for (const l of actionLines) lines.push(`- ${l}`);
  }

  if (event.telegramActionFailed) {
    lines.push("", "Reason:", event.telegramFailureReason ?? "The Watcher does not currently have the required Telegram permission for this action.");
  } else if (event.reasonText) {
    lines.push("", "Reason:", event.reasonText);
  }

  return lines.join("\n");
}

/** Builds the real prior-enforcement summary line for a mute-based warning
 *  event, in the exact "Warning N -> muted for X minutes" shape the spec's
 *  own worked examples use -- a small, reusable formatter so callers never
 *  hand-compose this string differently in two places. */
export function formatPriorWarningLine(warningNumber: number, muteMinutes: number | null): string {
  return muteMinutes != null ? `Warning ${warningNumber} -> muted for ${muteMinutes} minutes` : `Warning ${warningNumber} issued`;
}
