import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import type { TelegramMessage } from "./community-runtime";
import { formatModerationReportText, type ModerationReportEvent, type ModerationViolationCategory, type ModerationActionKind } from "./watcher-ops-report";

/**
 * Shared Escalation Group (Phase 1) -- a confidence-gated human-in-the-loop
 * system. When a Watcher's ANSWER generation has zero relevant Project
 * Knowledge for a question that genuinely needs project-specific facts
 * (chatter-generate.ts's ESCALATE_REQUIRED sentinel), it forwards the
 * question to a private Telegram group the project configures instead of
 * guessing. A real Telegram admin/creator of that group replies, and the
 * approved answer is relayed back to the original community.
 *
 * Deliberately does NOT import anything from community-runtime.ts's
 * internals (matching this codebase's own established sibling-runtime
 * convention -- presence-runtime.ts/autopost.ts each resolve their own
 * Telegram bot token independently rather than reaching into
 * community-runtime.ts's private helpers). Only the exported TelegramMessage
 * type is reused.
 */

const FORWARDED_TO_TEAM_TEXT =
  "We don't currently have a confirmed answer for that in our available information. I've forwarded this question to the team so they can provide a verified answer -- I'll follow up here once they respond.";

/** Same token-resolution shape as community-runtime.ts's own
 *  getBotTokenForDeployment/executeAction -- deliberately duplicated per
 *  this codebase's established convention of not cross-importing sibling
 *  runtime modules' private helpers. */
async function tokenForDeployment(admin: SupabaseClient, deploymentId: string): Promise<string | null> {
  const { data: deployment } = await admin.from("moderator_deployments").select("moderator_id").eq("id", deploymentId).maybeSingle();
  if (!deployment) return null;
  const { data: integration } = await admin.from("telegram_bot_integrations").select("id").eq("virtual_moderator_id", deployment.moderator_id).maybeSingle();
  if (!integration) return null;
  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  return (tokenData as string | null) ?? null;
}

/** Real Telegram admin/creator status -- the ONLY authorization check Phase
 *  1 uses for "is this reply an official, approved answer". A regular
 *  member/viewer replying must never resolve or publish anything (the
 *  spec's own explicit security requirement). Fails closed on any lookup
 *  error, matching community-runtime.ts's identical isSenderAdminOrTrusted
 *  convention. */
async function isAdminOrCreator(token: string, chatId: string, platformUserId: string): Promise<boolean> {
  const res = await telegramApiCall<{ status: string }>(token, "getChatMember", { chat_id: chatId, user_id: platformUserId });
  if (!res.ok) return false;
  return res.result.status === "administrator" || res.result.status === "creator";
}

export interface EscalationTarget {
  escalationCommunityId: string;
  chatId: string;
  deploymentId: string;
}

/** Resolves whether a project has a real, connected escalation group with
 *  at least one enabled Watcher deployment into it -- the ONLY thing that
 *  makes ESCALATE_REQUIRED reachable at all (see chatter-generate.ts's
 *  escalationConfigured). Never creates anything. A project with no
 *  escalation group connected, or one with no Watcher deployed into it
 *  yet, resolves to null -- callers must fall back to the existing plain
 *  "I don't have that information" behavior, never silently drop the
 *  question. */
export async function resolveProjectEscalationTarget(admin: SupabaseClient, projectId: string): Promise<EscalationTarget | null> {
  const { data: community } = await admin
    .from("communities")
    .select("id, chat_id")
    .eq("project_id", projectId)
    .eq("connection_type", "escalation_group")
    .maybeSingle();
  if (!community) return null;
  const { data: deployment } = await admin
    .from("moderator_deployments")
    .select("id")
    .eq("community_id", community.id)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  if (!deployment) return null;
  return { escalationCommunityId: community.id, chatId: community.chat_id as string, deploymentId: deployment.id };
}

function formatEscalationCard(input: {
  sourceCommunityLabel: string;
  watcherName: string;
  askerLabel: string;
  questionText: string;
}): string {
  return [
    "New Watcher Escalation",
    "",
    `Community: ${input.sourceCommunityLabel}`,
    `Watcher: ${input.watcherName}`,
    `User: ${input.askerLabel}`,
    "",
    "Question:",
    `"${input.questionText}"`,
    "",
    "Knowledge check: no confirmed answer found in Project Knowledge.",
    "",
    "Reply directly to this message with the approved response.",
  ].join("\n");
}

export interface CreateEscalationInput {
  admin: SupabaseClient;
  projectId: string;
  sourceCommunityId: string;
  /** The virtual_moderators.id of the Watcher that attempted the answer --
   *  stored so the resolve-back send (handleEscalationGroupMessage) can
   *  find its OWN deployment into the source community later. */
  escalatingModeratorId: string;
  watcherName: string;
  askerPlatformUserId: string;
  askerDisplayName: string | null;
  sourceMessageId: string;
  questionText: string;
}

/** Creates a real escalation: inserts the tracking row, posts the
 *  escalation card into the project's configured escalation group, and
 *  returns the user-facing "forwarded to the team" text for the caller to
 *  send back to the original asker. `ok: false` means no usable escalation
 *  target exists (or the send failed) -- the caller MUST fall back to the
 *  existing plain "I don't have that information" behavior rather than
 *  silently dropping the question. A row that fails to actually post is
 *  deleted rather than left as a phantom, permanently-open escalation no
 *  reply could ever match. */
export async function createEscalation(input: CreateEscalationInput): Promise<{ ok: boolean; forwardedText: string }> {
  const target = await resolveProjectEscalationTarget(input.admin, input.projectId);
  if (!target) return { ok: false, forwardedText: "" };

  const { data: sourceCommunity } = await input.admin.from("communities").select("title, chat_id").eq("id", input.sourceCommunityId).maybeSingle();
  const sourceCommunityLabel = (sourceCommunity?.title as string | null) ?? (sourceCommunity?.chat_id as string | undefined) ?? "this community";
  const askerLabel = input.askerDisplayName ?? `user ${input.askerPlatformUserId}`;

  const { data: row, error: insertError } = await input.admin
    .from("watch_escalations")
    .insert({
      project_id: input.projectId,
      escalation_community_id: target.escalationCommunityId,
      source_community_id: input.sourceCommunityId,
      watcher_id: input.escalatingModeratorId,
      asker_platform_user_id: input.askerPlatformUserId,
      asker_display_name: input.askerDisplayName,
      source_message_id: input.sourceMessageId,
      question_text: input.questionText,
    })
    .select("id")
    .single();
  if (insertError || !row) {
    console.error("[escalation] failed to create escalation row", insertError?.message);
    return { ok: false, forwardedText: "" };
  }

  const token = await tokenForDeployment(input.admin, target.deploymentId);
  if (!token) {
    await input.admin.from("watch_escalations").delete().eq("id", row.id);
    return { ok: false, forwardedText: "" };
  }

  const card = formatEscalationCard({ sourceCommunityLabel, watcherName: input.watcherName, askerLabel, questionText: input.questionText });
  const sendRes = await telegramApiCall<{ message_id: number }>(token, "sendMessage", { chat_id: target.chatId, text: card });
  if (!sendRes.ok) {
    console.error("[escalation] failed to post escalation card", sendRes.error);
    await input.admin.from("watch_escalations").delete().eq("id", row.id);
    return { ok: false, forwardedText: "" };
  }

  await input.admin.from("watch_escalations").update({ escalation_message_id: String(sendRes.result.message_id) }).eq("id", row.id);
  return { ok: true, forwardedText: FORWARDED_TO_TEAM_TEXT };
}

/** Handles every message sent INSIDE an escalation-group community --
 *  completely separate from ordinary moderation/chatter (branched before
 *  sender classification in community-runtime.ts's handleCommunityUpdate,
 *  since none of that is meaningful in an ops-only group). Only reacts to
 *  a REPLY to a tracked, still-OPEN escalation's own posted card, from a
 *  real Telegram admin/creator of the group -- everything else (non-
 *  replies, replies to unrelated messages, a non-admin's reply) is a
 *  silent no-op, never treated as an approved answer. */
export async function handleEscalationGroupMessage(
  admin: SupabaseClient,
  community: { id: string; chatId: string },
  message: TelegramMessage
): Promise<void> {
  if (!message.reply_to_message || !message.from) return;
  const replyToId = String(message.reply_to_message.message_id);

  const { data: escalation } = await admin
    .from("watch_escalations")
    .select("id, source_community_id, source_message_id, watcher_id")
    .eq("escalation_community_id", community.id)
    .eq("escalation_message_id", replyToId)
    .eq("status", "open")
    .maybeSingle();
  if (!escalation) return;

  const { data: anyDeployment } = await admin.from("moderator_deployments").select("id").eq("community_id", community.id).eq("enabled", true).limit(1).maybeSingle();
  if (!anyDeployment) return;
  const groupToken = await tokenForDeployment(admin, anyDeployment.id);
  if (!groupToken) return;

  const authorized = await isAdminOrCreator(groupToken, community.chatId, String(message.from.id));
  if (!authorized) return; // a viewer's reply must never resolve/publish anything

  const answerText = (message.text ?? "").trim();
  if (!answerText) return;

  // Conditional on status='open' so a genuine race between two near-
  // simultaneous replies can't both resolve the same escalation -- the
  // initial SELECT above already excludes an already-answered escalation
  // in the common case; this is defense in depth for the narrow race.
  const { error: updateError } = await admin
    .from("watch_escalations")
    .update({ status: "answered", answer_text: answerText, answered_by_platform_user_id: String(message.from.id), answered_at: new Date().toISOString() })
    .eq("id", escalation.id)
    .eq("status", "open");
  if (updateError) return;

  // Resolve-back -- the ORIGINAL escalating Watcher's own deployment into
  // the source community, resolved fresh (it's guaranteed to have existed
  // when the question was asked, but re-checked in case it was disabled
  // since).
  const { data: sourceDeployment } = await admin
    .from("moderator_deployments")
    .select("id")
    .eq("moderator_id", escalation.watcher_id)
    .eq("community_id", escalation.source_community_id)
    .maybeSingle();
  if (!sourceDeployment) {
    console.error("[escalation] resolve-back deployment not found", escalation.id);
    return;
  }
  const sourceToken = await tokenForDeployment(admin, sourceDeployment.id);
  if (!sourceToken) return;
  const { data: sourceCommunity } = await admin.from("communities").select("chat_id").eq("id", escalation.source_community_id).maybeSingle();
  if (!sourceCommunity) return;

  await telegramApiCall(sourceToken, "sendMessage", {
    chat_id: sourceCommunity.chat_id,
    text: `Update from the team: ${answerText}`,
    reply_to_message_id: Number(escalation.source_message_id),
  });
}

/* ================================================ moderation reporting ==== */
// Watcher Ops moderation-reporting expansion (2026-08-27) -- the SAME
// private Escalation Group is now also the project's real operations/audit
// channel for the moderation actions Watchers take (warnings, temporary
// mutes, kicks, message purges, and permission failures), alongside the
// existing knowledge-escalation workflow above. Reuses
// resolveProjectEscalationTarget/tokenForDeployment verbatim -- never a
// second "which group do I post to" resolution.

export interface SendModerationReportInput {
  admin: SupabaseClient;
  projectId: string;
  sourceCommunityId: string;
  /** virtual_moderators.id of the Watcher that took the enforcement action
   *  -- purely attribution for the stored report row; the report is always
   *  POSTED via whichever Watcher is actually deployed into the ops group
   *  (resolveProjectEscalationTarget), never the enforcing Watcher's own
   *  bot, since it may not be deployed there at all. */
  watcherId: string;
  platformUserId: string;
  username: string | null;
  displayName: string | null;
  /** Everything the report needs to render, minus the community label
   *  (resolved here, same pattern as createEscalation above) and the
   *  already-rendered mention (the caller renders it via
   *  link-moderation.ts's renderHumanModerationMention and passes it in). */
  event: Omit<ModerationReportEvent, "communityLabel">;
}

/** Sends (and persists) a structured moderation report. A project with NO
 *  configured Escalation Group is a silent, expected no-op -- Watcher Ops
 *  is strongly recommended, never required; a moderation action itself
 *  (mute/kick/warn/purge) has ALREADY happened by the time this is called,
 *  and must never be blocked or reversed by the absence of a reporting
 *  channel. Zero AI/LLM calls anywhere in this path (see
 *  watcher-ops-report.ts's own doc comment on why this can never consume
 *  AI usage). */
export async function sendModerationReport(input: SendModerationReportInput): Promise<{ sent: boolean }> {
  const target = await resolveProjectEscalationTarget(input.admin, input.projectId);
  if (!target) return { sent: false };

  const { data: sourceCommunity } = await input.admin.from("communities").select("title, chat_id").eq("id", input.sourceCommunityId).maybeSingle();
  const communityLabel = (sourceCommunity?.title as string | null) ?? (sourceCommunity?.chat_id as string | undefined) ?? "this community";

  const event: ModerationReportEvent = { ...input.event, communityLabel };
  const text = formatModerationReportText(event);

  const token = await tokenForDeployment(input.admin, target.deploymentId);
  let escalationMessageId: string | null = null;
  let sent = false;
  if (token) {
    const res = await telegramApiCall<{ message_id: number }>(token, "sendMessage", { chat_id: target.chatId, text });
    if (res.ok) {
      escalationMessageId = String(res.result.message_id);
      sent = true;
    } else {
      console.error("[watcher-ops] failed to post moderation report", res.error);
    }
  }

  // Persisted regardless of whether the send itself succeeded -- a report
  // that couldn't be delivered is still real audit history (structured
  // event = source of truth, per spec §22), not something to silently drop.
  await input.admin.from("watch_moderation_reports").insert({
    project_id: input.projectId,
    source_community_id: input.sourceCommunityId,
    escalation_community_id: target.escalationCommunityId,
    watcher_id: input.watcherId,
    platform_user_id: input.platformUserId,
    username: input.username,
    display_name: input.displayName,
    violation_category: event.violationCategory,
    warning_number: event.warningNumber,
    warning_limit: event.warningLimit,
    mute_minutes: event.muteMinutes,
    action_types: event.actionsTaken as ModerationActionKind[],
    purged_count: event.purgedCount,
    purge_failed: event.purgeFailed,
    telegram_action_failed: event.telegramActionFailed,
    telegram_failure_reason: event.telegramFailureReason,
    previous_enforcement_summary: event.previousEnforcementSummary,
    report_text: text,
    escalation_message_id: escalationMessageId,
    sent,
  });

  return { sent };
}

export type { ModerationReportEvent, ModerationViolationCategory, ModerationActionKind };
