import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityAction, CommunityEvent } from "./event-types";
import type { ModeratorPersona } from "./domain";
import type { AccountAiRouting } from "@/src/lib/products/watch-runtime";
import { generatePersonaSolicitationWarning } from "./link-classify";
import { renderHumanModerationMention } from "./link-moderation";
import { sendModerationReport } from "./escalation-runtime";
import { quietNoticeNeedsMention, quietWarningFallback, validQuietClaim, type QuietSpamFamily } from "./quiet-moderation";

interface QuietRuntimeInput {
  admin: SupabaseClient; panelId: string | null; communityId: string; projectId: string | null;
  event: CommunityEvent; family: QuietSpamFamily; legacyCount: number;
  deployment: { deploymentId: string; moderatorId: string; moderatorName: string; persona: ModeratorPersona };
  currentTopicName: string; promotionTopicName: string | null; targetIsClear: boolean; aiRouting?: AccountAiRouting;
  execute: (action: CommunityAction) => Promise<{ ok: boolean; sentMessageId: string | null; error?: string }>;
  purge: () => Promise<{ attempted: number; purged: number; failed: boolean }>;
}

/** Deletion already succeeded; never runs for allowed content or severe threats. */
export async function runQuietModeration(input: QuietRuntimeInput): Promise<void> {
  const { admin, communityId, panelId, event, deployment, family } = input;
  const log = async (decision: string, reason: string, meta: Record<string, unknown> = {}) => {
    await admin.from("moderator_activity_log").insert({ panel_id: panelId, community_id: communityId, deployment_id: deployment.deploymentId,
      event_type: "link_moderation", decision, reason_code: reason, meta: { platformMessageId: event.messageId, family, ...meta } });
  };
  const mention = renderHumanModerationMention(event.sender.platformUserId, event.sender.username ?? null, event.sender.displayName);
  const { data: claim, error } = await admin.rpc("claim_quiet_moderation", {
    p_community_id: communityId, p_user_id: event.sender.platformUserId, p_message_id: event.messageId,
    p_topic_id: event.messageThreadId, p_family: family, p_message_at: event.timestamp, p_legacy_count: input.legacyCount,
  });
  if (!validQuietClaim(claim) || error) {
    const unavailable = !!error || claim?.claimed !== false;
    await log(unavailable ? "QUIET_POLICY_UNAVAILABLE" : "DELETE_SILENT", unavailable ? "quiet_policy_unavailable" : claim.reason);
    if (unavailable && input.projectId) await sendModerationReport({ admin, projectId: input.projectId, sourceCommunityId: communityId,
      watcherId: deployment.moderatorId, platformUserId: event.sender.platformUserId, username: event.sender.username ?? null, displayName: event.sender.displayName,
      event: { userMention: mention, violationCategory: "spam", warningNumber: null, warningLimit: null, muteMinutes: null,
        actionsTaken: ["moderation_failure"], reasonText: "Confirmed spam deleted. Quiet moderation state unavailable; escalation held for admin review.", previousEnforcementSummary: [],
        purgedCount: null, purgeFailed: false, purgeFailureReason: null, telegramActionFailed: false, telegramFailureReason: null } });
    return;
  }
  let restriction: { ok: boolean; sentMessageId: string | null; error?: string } = { ok: true, sentMessageId: null };
  if (claim.action === "kick") restriction = await input.execute({ kind: "RESTRICT_USER", targetDeploymentId: deployment.deploymentId, targetPlatformUserId: event.sender.platformUserId, mode: "KICK" });
  if (claim.action === "mute") restriction = await input.execute({ kind: "RESTRICT_USER", targetDeploymentId: deployment.deploymentId, targetPlatformUserId: event.sender.platformUserId, mode: "MUTE", muteMinutes: claim.muteMinutes! });
  const muteOk = claim.action === "mute" && restriction.ok;
  const kickOk = claim.action === "kick" && restriction.ok;
  const recorded = await admin.rpc("record_quiet_moderation_restriction", { p_community_id: communityId, p_message_id: event.messageId, p_mute_ok: muteOk, p_kick_ok: kickOk });
  let historyFailed = !!recorded.error || recorded.data !== true;
  const purged = kickOk ? await input.purge() : null;
  let sentMessageId: string | null = null;
  let warningFailed = false;
  let suppression = claim.suppressionReason;
  if (claim.notice) {
    const recent = await admin.from("community_messages").select("text").eq("community_id", communityId).eq("origin", "MODERATION_WARNING").order("created_at", { ascending: false }).limit(4);
    const fallback = quietWarningFallback(claim.stage, family, input.promotionTopicName, !!claim.priorMuteAt);
    const generation = generatePersonaSolicitationWarning(deployment.moderatorName, deployment.persona, {
      quietStage: claim.stage, quietFamily: family, priorSuccessfulMute: !!claim.priorMuteAt,
      audience: claim.notice === "reminder" ? "room" : "individual", messageText: event.text,
      priorPublicWarning: !!claim.priorPublicWarningAt, currentTopicName: input.currentTopicName,
      warningNumber: Math.min(claim.stage,4), muteMinutes: muteOk ? claim.muteMinutes! : undefined,
      promotionTopicName: input.promotionTopicName, promotionTopicLink: null, contactHandle: null,
      isTokenContractMismatch: family === "token_contract_mismatch", isCompetingProjectPromotion: family === "competing_project",
      isDmSpam: family === "dm_spam", searchSpamPattern: family === "search_spam" ? "isolated" : undefined,
    }, input.aiRouting, (recent.data ?? []).map(row => row.text).filter((s): s is string => typeof s === "string"));
    // A slow wording model cannot turn a required final warning into no warning.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = await Promise.race([generation.catch(() => null), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 5000); })]);
    if (timer) clearTimeout(timer);
    const valid = await admin.rpc("quiet_moderation_notice_valid", { p_community_id: communityId, p_message_id: event.messageId });
    if (!valid.error && valid.data === true) {
      const safeBody = (body ?? fallback).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const text = quietNoticeNeedsMention(claim.stage, input.targetIsClear) ? `${mention}, ${safeBody}` : safeBody;
      const sent = await input.execute({ kind: "SEND_TEXT", targetDeploymentId: deployment.deploymentId, text, parseMode: "HTML",
        replyToMessageId: null, messageThreadId: event.messageThreadId, origin: "HUMAN", interactionDepth: 0, causationMessageId: event.messageId });
      sentMessageId = sent.ok ? sent.sentMessageId : null;
      warningFailed = !sentMessageId;
      if (sentMessageId) await admin.from("community_messages").insert({ panel_id: panelId, community_id: communityId, platform_message_id: sentMessageId,
        sender_type: "INNVIL_MODERATOR", sender_platform_id: null, sender_display_name: deployment.moderatorName, deployment_id: deployment.deploymentId,
        text, origin: "MODERATION_WARNING", message_thread_id: event.messageThreadId });
    } else { suppression = "notice_reservation_expired_or_unavailable"; warningFailed = true; }
  }
  const finished = await admin.rpc("finish_quiet_moderation_notice", { p_community_id: communityId, p_message_id: event.messageId, p_public_message_id: sentMessageId });
  historyFailed ||= !!finished.error || finished.data !== true;
  await log(sentMessageId ? "QUIET_POLICY_WARNING_SENT" : "QUIET_POLICY_SILENT", family, {
    violationCount: claim.violationCount, stage: claim.stage, action: claim.action, muteMinutes: muteOk ? claim.muteMinutes : null,
    muteSucceeded: muteOk, kickSucceeded: kickOk, publicWarningSent: !!sentMessageId, suppressionReason: suppression,
    heldForFinalWarning: claim.heldForFinalWarning, historyFailed, warningFailed, restrictionFailed: !restriction.ok,
  });
  // All deletions have a database audit; meaningful consequences/failures also
  // go to private Watcher Ops. Silent first-offense batches don't flood Ops.
  if (input.projectId && (claim.action !== "delete" || sentMessageId || warningFailed || historyFailed)) {
    await sendModerationReport({ admin, projectId: input.projectId, sourceCommunityId: communityId, watcherId: deployment.moderatorId,
      platformUserId: event.sender.platformUserId, username: event.sender.username ?? null, displayName: event.sender.displayName,
      event: { userMention: mention, violationCategory: family === "competing_project" || family === "token_contract_mismatch" ? "competing_project" : family === "promotion" ? "spam" : "off_topic_spam",
        warningNumber: sentMessageId ? claim.priorPublicWarningCount + 1 : null, warningLimit: null, muteMinutes: muteOk ? claim.muteMinutes : null,
        actionsTaken: [...(claim.action === "mute" ? ["temporary_mute" as const] : claim.action === "kick" ? ["kick" as const] : []), ...(sentMessageId ? ["warning" as const] : []), ...(purged ? ["message_purge" as const] : [])],
        reasonText: `Confirmed ${family.replace(/_/g," ")} deleted. Violation ${claim.violationCount}. ${sentMessageId ? "Public reminder delivered." : "No public warning delivered."}${claim.heldForFinalWarning ? " Removal held: no prior final warning delivery confirmed. Extended mute; admin review requested." : ""}${warningFailed ? " Public warning delivery failed." : ""}${historyFailed ? " Enforcement history receipt could not be saved; admin review requested." : ""}`,
        previousEnforcementSummary: [...(claim.priorMuteAt ? ["Prior successful temporary mute recorded."] : []), ...(claim.priorPublicWarningAt ? ["Prior public reminder delivery recorded."] : [])],
        purgedCount: purged?.purged ?? null, purgeFailed: purged?.failed ?? false, purgeFailureReason: purged?.failed ? "Some messages could not be removed." : null,
        telegramActionFailed: !restriction.ok, telegramFailureReason: !restriction.ok ? [restriction.error ?? "Restriction failed.", warningFailed ? "Public warning delivery failed." : null, historyFailed ? "Enforcement history receipt could not be saved." : null].filter(Boolean).join(" ") : null } });
  }
}
