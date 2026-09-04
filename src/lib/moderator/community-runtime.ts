import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall, getTelegramFile, downloadTelegramFileBuffer, TELEGRAM_MAX_DOWNLOADABLE_BYTES } from "./telegram-client";
import {
  virtualModBotAcknowledgement, virtualModNaturalChatterActive, virtualModMediaModeration, virtualModVideoModeration,
  moderatorEntitlementSource, TRIAL_REACTIVE_DAILY_LIMIT, readModeratorAddon, type ModeratorTrialState,
  hasVirtualModerator, moderatorCapacity, TRIAL_DURATION_DAYS,
  communityCountExceeded, checkDeploymentSlotCaps, deploymentSlotCheckErrorMessage,
} from "./plan";
import { decideBotAcknowledgement, type BotAckMode, type EligibleTarget } from "./coordinator";
import {
  selectChatterAction, resolveDirectedModerator, resolveMultiTargetAddress, requiresIndividualContribution,
  isRoomWideAddress, roomWideResponderCount, classifyMessageKind,
  isAmbientOpenerFallbackCandidate, resolveAmbientOpenerFallback, resolveAdditionalReactors,
  MAX_ADDITIONAL_RESPONDERS, type ChatterCandidate, type ChatterPacingState,
} from "./chatter-coordinator";
import { generateChatterReply, shortAckText, classifyAmbientGreeting, classifyPitchLikelihood, personaReactionEmoji, type ChatterContextMessage, type ChatterGenerationUsage } from "./chatter-generate";
import { normalizeModeratorPersona, type ModeratorPersona } from "./domain";
import { retrieveRelevantKnowledge, combineKnowledgeRetrieval, type KnowledgeSource, type KnowledgeContextEntry } from "./knowledge";
import { resolveContactIntent, findCommunityContactOverride, CONTACT_LABELS, type ProjectContacts } from "./project-profile";
import { classifySender as classifySenderPure, type CommunityEvent, type CommunityAction } from "./event-types";
import {
  detectSequenceTaskIntent, classifyTaskInstruction, pauseTask, resumeTask, cancelTask, resetSequenceTask,
  applyReorderInstruction, advanceSequenceTask, isTaskExpired, expectedParticipant, expectedNumericValue,
  type ConversationTask, type TaskModeratorIdentity,
} from "./task-state";
import {
  extractLinks, linkHash, recordLinkObservation, isFloodRepeat, decideLinkEnforcement, EMPTY_WARNING_STATE,
  COLLAB_ROUTABLE_CATEGORIES, SPAM_WARNING_LIMIT, SOLICITATION_WARNING_LIMIT, type LinkWarningState,
  effectiveScamStrikeCount, renderHumanModerationMention, scamFirstOffenseWarningHtml, scamRepeatOffenseWarningHtml,
  filterOutOwnBotMentions, looksLikeUnsolicitedPitch, looksLikeSearchInstructionSpam, isBackToBackSpamPattern,
  looksLikeAdminInformationRequest, findRecentAdminInformationRequest,
  effectiveWarningCount,
} from "./link-moderation";
import { classifyLinkIntent, generatePersonaSolicitationWarning } from "./link-classify";
import {
  DEFAULT_PENDING_REPLY_DELAY_MS, clampPendingReplyDelaySeconds, pendingReplyScheduledFor, isPendingReplyDue, isPendingReplyStale,
  isWithinPendingReplyWindow, revalidatePendingReply, isAdminMessageHandlingConversation, type DeferredActionKind, type PendingReplyRow,
} from "./pending-reply";
import {
  topicAllowsSolicitation, findCommunityTopic, findPromotionTopic, buildTopicLink, topicDisplayName, hasKnownTopicName,
  type CommunityTopicRow, type CommunityTopicPolicy,
} from "./community-topics";
import {
  classifyResourceKind, buildCommunityKnowledgeGrounding, type CommunityKnowledgeItem, type CommunityKnowledgeGrounding,
} from "./community-message-knowledge";
import {
  decideMediaEnforcement, computeSamplePositions, classifySampledFrames,
  type MediaKind, type MediaClassificationResult,
} from "./media-moderation";
import { classifyImageBytes } from "./media-safety-provider";
import { extractVideoFrames } from "./media-frame-extractor";
import { generateMediaModerationWarning } from "./media-warning";
import { checkChatMembership, type ChatMembershipResult } from "./manager";
import {
  resolveStandaloneModeratorSettings, resolveWatcherAccountId, resolveAccountAiRouting, resolveAccountEnterpriseEntitlement,
  applyDeploymentUsagePolicy, MANAGED_AI_ROUTING, type AccountAiRouting,
} from "@/src/lib/products/watch-runtime";
import { recordByoUsageEvent } from "@/src/lib/products/watch-byo-usage";
import { recordByoPolicyUsage } from "@/src/lib/products/watch-byo-usage-policy";
import {
  assignWatcherRoles, resolveModerationEnforcer, reconcileAmbientPick,
  type WatcherRoleAssignment,
} from "./watcher-roles";

/** Fire-and-forget BYO usage telemetry + usage-POLICY accounting -- only
 *  ever called when `aiRouting.required` is true (a Managed account has
 *  nothing BYO-specific to record). Never awaited by callers, and neither
 *  recordByoUsageEvent nor recordByoPolicyUsage ever throws (best-effort)
 *  -- a telemetry/policy write must never add latency to, or break, the
 *  30s-bounded webhook handler it's called from.
 *
 *  Scoped to respondAsDeployment's own generateChatterReply outcome ONLY --
 *  the ONE call site with a genuine, unambiguous ok/error signal to record
 *  (matches the scope of Innvil's own MODERATOR_AI_GENERATION_POOL metering
 *  for Managed accounts). classifyLinkIntent/classifyAmbientGreeting/the
 *  warning-generation functions all degrade gracefully to a safe fallback
 *  on ANY failure by design (never throw, never expose a clean success/
 *  failure distinction in their return shape) -- recording them as "ok"
 *  regardless of whether the underlying call actually succeeded would be
 *  fabricated telemetry, so they are deliberately NOT instrumented here.
 *  Same reasoning for the usage-policy counter (Phase 4.V) -- only a real
 *  successful generation ever counts toward a customer's configured spend
 *  ceiling, never an attempted-but-failed one. Always recorded as
 *  kind:"reactive" (Phase 4.V.1) -- this whole file's chatter-generation
 *  path is exclusively human-message-triggered; the proactive counterpart
 *  lives in presence-runtime.ts, its own genuinely scheduler-driven caller.
 *  `deploymentId` (Phase 4.V.1, item 2) threads the actual responding
 *  Watcher into `recordByoPolicyUsage`'s 3rd (deployment) scope, alongside
 *  the account/Community scopes -- a per-Watcher ceiling only ever
 *  increments from a genuinely successful call by THAT Watcher. It's also
 *  recorded on the telemetry event itself (Phase 4.V.1, deployment-level
 *  attribution), so the Usage page's BYO summary can report "which Watcher
 *  actually made these calls," not just which automation/Community.
 *  `usage` (2026-08-25, closing item 1/3 off the honest deferred list) --
 *  the real input+output token counts and wall-clock duration from
 *  generateChatterReply's own aiCompleteWithMeta() call, present on every
 *  `ok:true` outcome (a real call happened, whether or not it produced a
 *  visible reply). Absent on a failed/timed-out call, since no usage was
 *  ever observed for those. Recorded on BOTH the telemetry event (real
 *  cost/latency observability) AND fed into recordByoPolicyUsage as the
 *  token count a customer's own configured token ceiling is measured
 *  against -- input+output combined, the real total spend driver. */
function recordByoCall(
  admin: SupabaseClient, aiRouting: AccountAiRouting, accountId: string | null, communityId: string, deploymentId: string, automation: string, ok: boolean, error?: string, usage?: ChatterGenerationUsage
): void {
  if (!aiRouting.required || !accountId) return;
  void recordByoUsageEvent(admin, {
    accountId, communityId, deploymentId, automation,
    provider: aiRouting.credential?.provider ?? "unconfigured",
    model: aiRouting.credential?.model ?? "unconfigured",
    ok, error,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    durationMs: usage?.durationMs ?? null,
  });
  const totalTokens = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  if (ok) void recordByoPolicyUsage(admin, accountId, communityId, deploymentId, "reactive", totalTokens);
}
import { resolveAccountBillingPeriod, getWatchAiGenerationUsage, incrementWatchAiGenerationUsage, hasAiGenerationPoolRemaining } from "@/src/lib/products/watch-ai-usage";
import { getMediaModerationExpansionUnits, isMediaModerationLimitReached } from "@/src/lib/products/watch-media-moderation-expansion";
import { getWatchMediaModerationUsage, incrementWatchMediaModerationUsage } from "@/src/lib/products/watch-media-moderation-usage";
import { MEDIA_MODERATION_BASE_ALLOWANCE, ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE, TRIAL_MEDIA_MODERATION_ALLOWANCE, type ModeratorPlanTier } from "@/src/lib/money";
import { resolveEnterpriseMediaAddonKey } from "@/src/lib/products/watch-enterprise";
import { resolveProjectEscalationTarget, createEscalation, handleEscalationGroupMessage, sendModerationReport, type EscalationTarget } from "./escalation-runtime";
import type { ModerationViolationCategory } from "./watcher-ops-report";

/**
 * Community-runtime orchestration for a single incoming Telegram update on a
 * subscriber bot's webhook (app/api/webhooks/telegram/bots/[integrationId]).
 *
 * Branches by classified sender type, each gated by its OWN capability:
 *   - INNVIL_MODERATOR -> Innvil Moderator Acknowledgement (bot-ack)
 *   - HUMAN             -> Reactive Natural Chatter
 *   - EXTERNAL_BOT      -> always ignored (spec §10)
 * Every message is recorded into community_messages regardless of which
 * capability is active (or whether either is) — it's the bounded recent-
 * context window both features need, and recording it is cheap.
 */

/* ------------------------------------------------------- timing/budget ---- */
// Live incident: a webhook invocation was killed at Vercel's 30s maxDuration
// with ZERO trace -- the message was recorded (community_messages) but no
// moderator_activity_log row existed anywhere, because the function died
// mid-generation before reaching any logActivity call. Root cause (fixed
// separately in src/lib/ai/client.ts's postJson) was a stalled DeepSeek
// response BODY after fast headers, outside the old abort scope. This
// section adds the observability/budget layer so a repeat of "died with no
// trace" becomes structurally impossible even if some future call escapes
// its own internal timeout: (1) structured elapsed-time checkpoints so a
// Vercel log line makes it obvious which stage consumed time, (2) a
// GENERATION_STARTED activity row written BEFORE the slow call so the DB
// alone is diagnostic even without pulling function logs, (3) an outer
// total-budget race around the generation call as defense in depth.

/** model timeout (12s, see client.ts AI_REQUEST_TIMEOUT_MS) < this total
 *  chatter budget < platform maxDuration (30s) -- leaves ~10s headroom for
 *  DB reads/writes, activity logging, and the Telegram send around the
 *  model call itself. */
const CHATTER_TOTAL_BUDGET_MS = 20_000;
/** classifyAmbientGreeting is a tiny classification call (5 output tokens),
 *  not a full reply -- same model-timeout floor, smaller budget than a full
 *  generation since there's much less work to do around it. */
const AMBIENT_CLASSIFY_BUDGET_MS = 15_000;
/** classifyPitchLikelihood's own budget -- same tiny-classification-call
 *  shape as AMBIENT_CLASSIFY_BUDGET_MS. */
const PITCH_CLASSIFY_BUDGET_MS = 15_000;
/** A genuine unsolicited-promotion pitch is always at least a real sentence
 *  -- never worth an AI call for something this short regardless of
 *  language (an ordinary short chat message, "gm", "lol", a name, etc.). */
const PITCH_CLASSIFY_MIN_LENGTH = 20;

/** One elapsed-time tracker per webhook invocation, threaded from
 *  handleCommunityUpdate down into handleHumanMessage so "total request
 *  duration" is a single real number, not two disjoint per-function timers.
 *  Each mark() logs both the delta since the PREVIOUS checkpoint (which
 *  stage was slow) and the total elapsed since the request began (are we
 *  approaching budget) -- structured JSON so it's grep-able in Vercel logs
 *  without needing a new dashboard. Never logs prompts/secrets/message
 *  content -- label + integrationId + timings only. */
export function createRequestTimer(integrationId: string) {
  const start = Date.now();
  let last = start;
  return {
    mark(label: string, extra: Record<string, unknown> = {}) {
      const now = Date.now();
      console.log("[chatter-timing]", JSON.stringify({ integrationId, label, deltaMs: now - last, totalMs: now - start, ...extra }));
      last = now;
    },
    totalMs(): number {
      return Date.now() - start;
    },
  };
}
export type RequestTimer = ReturnType<typeof createRequestTimer>;

/** Races `promise` against a plain timer (NOT true cancellation -- JS can't
 *  force an in-flight promise to stop -- but it guarantees the CALLER never
 *  waits past `ms`, which is what actually matters for staying under the
 *  platform's hard kill: the underlying call's OWN internal timeout, fixed
 *  separately in client.ts, is what actually tears down the network
 *  request. This is the safety net for "what if that somehow doesn't fire." */
export async function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<{ ok: false }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  const result = await Promise.race([promise.then((value): { ok: true; value: T } => ({ ok: true, value })), timeout]);
  clearTimeout(timer!);
  return result;
}

type TelegramChat = { id: number; type?: string; title?: string; username?: string };
type TelegramUser = { id: number; is_bot?: boolean; username?: string; first_name?: string };
type TelegramPhotoSize = { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number };
type TelegramVideo = { file_id: string; file_unique_id: string; duration?: number; file_size?: number; mime_type?: string };
type TelegramAnimation = { file_id: string; file_unique_id: string; duration?: number; file_size?: number; mime_type?: string };
type TelegramDocument = { file_id: string; file_unique_id: string; file_size?: number; mime_type?: string; file_name?: string };
export type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
  /** Telegram Forum (topic-enabled supergroup) support -- identifies which
   *  topic/sub-channel this message was posted in (e.g. a "General" vs
   *  "Announcements" vs "Promotion" topic within ONE chat). Absent for an
   *  ordinary (non-forum) chat or the forum's own default "General" topic. */
  message_thread_id?: number;
  /** Telegram sends an ARRAY of the same photo at multiple resolutions
   *  (smallest first) — the LAST entry is the highest resolution without
   *  needing to fetch/compare every variant. */
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  animation?: TelegramAnimation;
  document?: TelegramDocument;
  /** Present on the special service message Telegram sends the instant
   *  something is pinned -- references the ORIGINAL message that was
   *  pinned (self-contained: carries its own from/text/chat/message_id),
   *  even one the bot never saw live (e.g. pinned before the bot joined).
   *  Telegram sends no equivalent event for an UNPIN -- see
   *  syncCurrentPinnedMessage below for how that's handled instead. */
  pinned_message?: TelegramMessage;
  /** Sent once, on the message that created a Forum topic -- the only
   *  reliable way this codebase can learn a topic's real display name
   *  (there is no general "get topic name by id" Bot API call). */
  forum_topic_created?: { name: string };
  /** Sent when a topic is renamed/re-iconed -- `name` is present on a
   *  rename, absent on an icon-only edit. Used to keep the stored display
   *  name current so a warning always names the topic correctly even after
   *  a rename, per the explicit "renaming must not break policy, but the
   *  displayed name must update" requirement. */
  forum_topic_edited?: { name?: string };
};
export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

/** Atomic insert-or-detect-duplicate dedup (spec §18) — safe under Telegram retries/concurrent delivery. */
export async function isDuplicateUpdate(admin: SupabaseClient, integrationId: string, updateId: number | undefined): Promise<boolean> {
  if (updateId == null) return false; // can't dedup without an id; let it through rather than silently dropping
  const { error } = await admin.from("telegram_processed_updates").insert({ integration_id: integrationId, update_id: updateId });
  if (!error) return false;
  return error.code === "23505";
}

async function resolveIntegration(admin: SupabaseClient, integrationId: string) {
  const { data } = await admin
    .from("telegram_bot_integrations")
    .select("id, panel_id, virtual_moderator_id, telegram_bot_id")
    .eq("id", integrationId)
    .maybeSingle();
  // panel_id is nullable as of migration 0069 -- a standalone (direct-Watch,
  // Panel-less) integration has panel_id: null; ownership then resolves via
  // virtual_moderator_id -> virtual_moderators.account_id instead.
  return data as { id: string; panel_id: string | null; virtual_moderator_id: string; telegram_bot_id: number | null } | null;
}

/** Resolves the community row for an inbound Telegram message. SELECT-then-
 *  UPDATE, never upsert -- `communities.project_id` is NOT NULL (migration
 *  0057) and this code path has no project to assign a genuinely new
 *  community, so it must never attempt to INSERT one. (Postgres itself
 *  validates NOT NULL constraints on the proposed row of an `INSERT ...
 *  ON CONFLICT DO UPDATE` BEFORE checking whether a conflict even exists --
 *  a live incident on 2026-08-17 traced every existing community's message
 *  handling silently failing back to exactly this: the old upsert always
 *  hit the project_id NOT NULL violation first, regardless of whether the
 *  row already existed.) A message from a chat with no matching row is
 *  simply not from a connected community -- communities are created only
 *  through the explicit connectCommunity flow (actions/moderator.ts), which
 *  supplies a real project_id, never implicitly on first message here.
 *
 *  `panelId: null` is the standalone (direct-Watch, Panel-less) case --
 *  looks up among communities with NO panel at all (`idx_communities_
 *  standalone_chat`, migration 0069's partial unique index on
 *  `(platform, chat_id) where panel_id is null`), never among Panel-scoped
 *  ones. A Panel-scoped community with the same chat_id (a different
 *  tenant's) can never be mistaken for a standalone one, or vice versa --
 *  the two pools are disjoint by construction, not merely by convention. */
export async function resolveCommunity(admin: SupabaseClient, panelId: string | null, chat: TelegramChat) {
  const chatId = String(chat.id);
  const base = admin
    .from("communities")
    .select("id, bot_ack_mode, collab_contact, project_id, connection_type, allow_solicitation, acknowledge_admin_mod, pending_reply_delay_seconds, promotion_channel_link, promotion_channel_name")
    .eq("platform", "telegram")
    .eq("chat_id", chatId);
  const { data, error } = await (panelId ? base.eq("panel_id", panelId) : base.is("panel_id", null)).maybeSingle();
  if (error) {
    console.error("[telegram/community] resolveCommunity select failed", panelId, chatId, error.message, error.code);
    return null;
  }
  if (!data) return null;

  // Best-effort metadata refresh (title/handle/chat_type may have changed
  // in Telegram since the community was connected) -- an UPDATE on an
  // already-existing row, never touching project_id, so it can't re-trigger
  // the NOT NULL issue above. Failure here is non-fatal; the community
  // still resolves correctly from the SELECT above.
  const { error: updateError } = await admin
    .from("communities")
    .update({ handle: chat.username ?? null, title: chat.title ?? null, chat_type: chat.type ?? null })
    .eq("id", data.id);
  if (updateError) console.error("[telegram/community] resolveCommunity metadata update failed", data.id, updateError.message);

  return data as {
    id: string; bot_ack_mode: BotAckMode; collab_contact: string | null; project_id: string | null;
    connection_type: "community" | "escalation_group"; allow_solicitation: boolean | null;
    acknowledge_admin_mod: boolean | null; pending_reply_delay_seconds: number | null;
    promotion_channel_link: string | null; promotion_channel_name: string | null;
  };
}

/* ------------------------------------------------------- topic discovery ---- */
// Auto-discovered Telegram Forum topics + owner-assignable policy (see
// community-topics.ts for the pure vocabulary/lookup helpers). Every
// message processed in a forum topic records/refreshes a row here so the
// owner can pick from KNOWN topics instead of hunting for a raw numeric
// message_thread_id -- the id is still the real lookup key underneath
// (findCommunityTopic), this is purely discovery + a friendly last-seen
// display name.

const TOPIC_NAME_POLICY_HINTS: Array<{ policy: CommunityTopicPolicy; re: RegExp }> = [
  { policy: "promotion", re: /promo(tion)?/i },
  { policy: "announcement", re: /announce/i },
  { policy: "general", re: /general/i },
];

/** A sensible STARTING policy guess from the topic's own Telegram-reported
 *  name, purely a default -- never authoritative, always owner-overridable
 *  after the fact (policy stays keyed to the thread id regardless of what
 *  this guessed). A topic with no name, or a name matching nothing here,
 *  defaults to 'normal' (restricted, same as General/Announcements for
 *  solicitation purposes). */
function suggestTopicPolicy(topicName: string | null): CommunityTopicPolicy {
  if (!topicName) return "normal";
  for (const { policy, re } of TOPIC_NAME_POLICY_HINTS) if (re.test(topicName)) return policy;
  return "normal";
}

export async function loadCommunityTopics(admin: SupabaseClient, communityId: string): Promise<CommunityTopicRow[]> {
  const { data } = await admin
    .from("watch_community_topics")
    .select("message_thread_id, topic_name, custom_name, policy")
    .eq("community_id", communityId);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    messageThreadId: r.message_thread_id as number,
    topicName: (r.topic_name as string | null) ?? null,
    customName: (r.custom_name as string | null) ?? null,
    policy: r.policy as CommunityTopicPolicy,
  }));
}

/** Best-effort auto-discovery -- upserts the topic's last-seen name/time,
 *  never touching `policy` once the row already exists (an owner's explicit
 *  assignment must never be silently reset by a later message). A brand-new
 *  topic gets a suggested starting policy from its own name; failure here
 *  is non-fatal to message processing (never blocks moderation/chatter). */
async function recordTopicSighting(admin: SupabaseClient, communityId: string, messageThreadId: number, topicName: string | null): Promise<void> {
  const { data: existing } = await admin
    .from("watch_community_topics")
    .select("id")
    .eq("community_id", communityId)
    .eq("message_thread_id", messageThreadId)
    .maybeSingle();
  const now = new Date().toISOString();
  if (existing) {
    // An ordinary (non-creation/rename) message carries no topic name at
    // all -- only update the stored name when we actually HAVE a fresh one
    // (a forum_topic_created/forum_topic_edited event), never clobber an
    // already-known name with null on a plain sighting.
    const update: Record<string, unknown> = { last_seen_at: now };
    if (topicName != null) update.topic_name = topicName;
    await admin.from("watch_community_topics").update(update).eq("id", existing.id);
    return;
  }
  await admin.from("watch_community_topics").insert({
    community_id: communityId, message_thread_id: messageThreadId, topic_name: topicName,
    policy: suggestTopicPolicy(topicName), first_seen_at: now, last_seen_at: now,
  });
}

/* ------------------------------------------------- community knowledge index ---- */
// Real message/resource metadata index (community-message-knowledge.ts's
// pure classification/ranking layer + this DB-facing populate/read side).
// Populated going forward only -- existing message history predating this
// feature is never retroactively indexed.

/** Select-then-branch, never upsert -- the underlying unique constraint
 *  (community_id, platform_message_id, coalesce(url,'')) is an EXPRESSION
 *  index, which PostgREST's upsert(onConflict:...) can't target by naming
 *  raw columns (the exact "no unique or exclusion constraint matching the
 *  ON CONFLICT specification" bug class already hit once in this codebase
 *  for a structurally identical nullable-column uniqueness case -- see
 *  watch-runtime.ts's createAccountCommunity fix). A rare concurrent-
 *  duplicate-insert race here is acceptable: this is best-effort knowledge
 *  indexing, never a money-critical path. */
async function upsertCommunityResource(admin: SupabaseClient, row: {
  community_id: string; message_thread_id: number | null; platform_message_id: string;
  sender_platform_id: string | null; is_admin_author: boolean; is_pinned: boolean;
  is_announcement_topic: boolean; kind: string; url: string | null; text: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const base = admin.from("watch_community_resources").select("id")
    .eq("community_id", row.community_id).eq("platform_message_id", row.platform_message_id);
  const { data: existing } = row.url == null ? await base.is("url", null).maybeSingle() : await base.eq("url", row.url).maybeSingle();
  if (existing) {
    await admin.from("watch_community_resources").update({ ...row, updated_at: now }).eq("id", existing.id);
    return;
  }
  await admin.from("watch_community_resources").insert({ ...row, updated_at: now });
}

/** Indexes ONE message's text/links as community knowledge. `isAdminAuthor`
 *  is forced true for a pinned message regardless of who originally posted
 *  it -- an admin/mod choosing to PIN content is itself the endorsement
 *  that makes it authoritative (spec: pinned posts are authoritative
 *  community context), never gated on the original poster's own role. A
 *  message with real https:// links gets one resource row PER link
 *  (independently classified); a link-less message is stored as a single
 *  plain text fact (kind OTHER, url null) so it's still retrievable as a
 *  direct textual answer (e.g. "the project is currently in presale").
 *  Empty/whitespace-only text is never indexed. */
async function indexCommunityKnowledgeMessage(
  admin: SupabaseClient, communityId: string, message: TelegramMessage,
  opts: { isAdminAuthor: boolean; isAnnouncementTopic: boolean; forcePinned?: boolean }
): Promise<void> {
  const text = (message.text ?? message.caption ?? "").trim();
  if (!text) return;
  const platformMessageId = String(message.message_id);
  const senderPlatformId = message.from ? String(message.from.id) : null;
  const isPinned = opts.forcePinned === true;
  const isAdminAuthor = isPinned ? true : opts.isAdminAuthor;
  const links = extractLinks(text).filter((l) => l.startsWith("http"));
  if (!links.length) {
    await upsertCommunityResource(admin, {
      community_id: communityId, message_thread_id: message.message_thread_id ?? null,
      platform_message_id: platformMessageId, sender_platform_id: senderPlatformId,
      is_admin_author: isAdminAuthor, is_pinned: isPinned, is_announcement_topic: opts.isAnnouncementTopic,
      kind: "OTHER", url: null, text,
    });
    return;
  }
  for (const url of links) {
    await upsertCommunityResource(admin, {
      community_id: communityId, message_thread_id: message.message_thread_id ?? null,
      platform_message_id: platformMessageId, sender_platform_id: senderPlatformId,
      is_admin_author: isAdminAuthor, is_pinned: isPinned, is_announcement_topic: opts.isAnnouncementTopic,
      kind: classifyResourceKind(text, url), url, text,
    });
  }
}

/** Best-effort reconciliation for the ONE case Telegram gives no direct
 *  event for -- an unpin. Telegram's own getChat reports at most a single
 *  CURRENT `pinned_message` for a chat; any resource this codebase has
 *  marked `is_pinned=true` that no longer matches it is corrected back to
 *  false. Never sets a NEW pin from here (that only ever happens from a
 *  real pinned_message service-message event, indexCommunityKnowledgeMessage
 *  above) -- this function only ever clears a stale one. Failure is
 *  non-fatal (never blocks reply generation). */
async function syncCurrentPinnedMessage(admin: SupabaseClient, token: string, communityId: string, chatId: string): Promise<void> {
  const res = await telegramApiCall<{ pinned_message?: { message_id: number } }>(token, "getChat", { chat_id: chatId });
  if (!res.ok) return;
  const currentPinnedId = res.result.pinned_message ? String(res.result.pinned_message.message_id) : null;
  const { data: pinnedRows } = await admin.from("watch_community_resources").select("id, platform_message_id").eq("community_id", communityId).eq("is_pinned", true);
  for (const row of (pinnedRows ?? []) as Array<{ id: string; platform_message_id: string }>) {
    if (row.platform_message_id !== currentPinnedId) {
      await admin.from("watch_community_resources").update({ is_pinned: false }).eq("id", row.id);
    }
  }
}

/* ------------------------------------------------------- pending replies ---- */
// Real, persisted "wait 120 seconds" Watcher-reply scheduling -- see
// pending-reply.ts for the pure decision logic; this is the DB-facing half
// (schedule / cancel-on-arrival / the cron sweep's own revalidate-then-send,
// in pending-reply-runtime.ts).

async function schedulePendingReply(admin: SupabaseClient, input: {
  communityId: string; panelId: string | null; deploymentId: string; chatId: string;
  messageThreadId: number | null; triggerPlatformMessageId: string; senderPlatformId: string;
  senderDisplayName: string | null; senderUsername: string | null; messageText: string;
  actionKind: DeferredActionKind; now: Date;
  /** This community's own resolved, clamped delay in ms -- see
   *  clampPendingReplyDelaySeconds. Defaults to the platform default when
   *  omitted (kept optional so any pre-existing/test call site without a
   *  resolved community delay handy is unaffected). */
  delayMs?: number;
}): Promise<void> {
  const { error } = await admin.from("watch_pending_replies").insert({
    community_id: input.communityId, panel_id: input.panelId, deployment_id: input.deploymentId,
    chat_id: input.chatId, message_thread_id: input.messageThreadId,
    trigger_platform_message_id: input.triggerPlatformMessageId, sender_platform_id: input.senderPlatformId,
    sender_display_name: input.senderDisplayName, sender_username: input.senderUsername,
    message_text: input.messageText, action_kind: input.actionKind, status: "pending",
    scheduled_for: pendingReplyScheduledFor(input.now, input.delayMs),
  });
  // A 23505 conflict means this EXACT (trigger message, deployment) pair
  // already has a pending reply scheduled (a duplicate webhook delivery
  // racing past the primary community_messages claim, or a genuine retry)
  // -- a safe no-op, never a second competing row for the same real
  // message/deployment pair (the unique index now also includes
  // deployment_id, migration 0121, so a genuine multi-target address can
  // schedule more than one row for the SAME trigger message without
  // colliding).
  if (error && error.code !== "23505") console.error("[telegram/community] schedulePendingReply failed", error.message);
}

/** Cancels only the still-PENDING replies whose SPECIFIC conversation this
 *  admin/mod message actually takes over (gap 2, 2026-09-02 correction) --
 *  called the instant an admin/mod's own message arrives (rule 8),
 *  synchronously, never waiting for the next cron sweep. A topic may hold
 *  several unrelated pending replies (two different users each asked
 *  something) at once; this NEVER treats "topic id matches" alone as
 *  sufficient ownership -- see isAdminMessageHandlingConversation
 *  (pending-reply.ts) for the exact two signals (direct Telegram reply
 *  relationship, or uncontested conversational continuity) that decide it
 *  per-row. A row already claimed by the sweep (status='sending') or
 *  already resolved is left alone -- only a genuinely still-waiting row is
 *  ever a candidate. Bounded to a small, constant number of queries
 *  regardless of how many pending rows the topic holds. */
async function cancelPendingRepliesForTopic(
  admin: SupabaseClient, communityId: string, messageThreadId: number | null,
  adminMessage: { replyToPlatformMessageId: string | null; createdAt: string }
): Promise<void> {
  const pendingBase = admin
    .from("watch_pending_replies")
    .select("id, trigger_platform_message_id, sender_platform_id, created_at")
    .eq("community_id", communityId)
    .eq("status", "pending");
  const { data: pendingRows } = await (messageThreadId == null ? pendingBase.is("message_thread_id", null) : pendingBase.eq("message_thread_id", messageThreadId));
  if (!pendingRows || !pendingRows.length) return;

  const earliestCreatedAt = pendingRows.reduce((min, r) => (r.created_at < min ? r.created_at : min), pendingRows[0].created_at);
  const betweenBase = admin
    .from("community_messages")
    .select("created_at")
    .eq("community_id", communityId)
    .gt("created_at", earliestCreatedAt)
    .lt("created_at", adminMessage.createdAt);
  const { data: between } = await (messageThreadId == null ? betweenBase.is("message_thread_id", null) : betweenBase.eq("message_thread_id", messageThreadId));
  const betweenMessages = (between ?? []) as { created_at: string }[];

  const askerIds = [...new Set(pendingRows.map((r) => r.sender_platform_id))];
  const { data: askerMsgs } = await admin
    .from("community_messages")
    .select("platform_message_id, sender_platform_id")
    .eq("community_id", communityId)
    .in("sender_platform_id", askerIds)
    .order("created_at", { ascending: false })
    .limit(50);
  const askerMessageIdsByUser = new Map<string, string[]>();
  for (const m of (askerMsgs ?? []) as { platform_message_id: string; sender_platform_id: string }[]) {
    const list = askerMessageIdsByUser.get(m.sender_platform_id) ?? [];
    list.push(m.platform_message_id);
    askerMessageIdsByUser.set(m.sender_platform_id, list);
  }

  const toCancel: string[] = [];
  for (const row of pendingRows) {
    const hasInterveningMessage = betweenMessages.some((m) => new Date(m.created_at).getTime() > new Date(row.created_at).getTime());
    const owns = isAdminMessageHandlingConversation({
      triggerPlatformMessageId: row.trigger_platform_message_id,
      triggerCreatedAt: row.created_at,
      askerMessageIds: askerMessageIdsByUser.get(row.sender_platform_id) ?? [row.trigger_platform_message_id],
      adminMessage,
      hasInterveningMessage,
    });
    if (owns) toCancel.push(row.id);
  }
  if (!toCancel.length) return;
  await admin
    .from("watch_pending_replies")
    .update({ status: "cancelled", cancel_reason: "admin_replied", resolved_at: new Date().toISOString() })
    .in("id", toCancel);
}

/** Loads this community's indexed knowledge for ranking -- deliberately
 *  bounded (most-recent 200) rather than the full unbounded history, same
 *  "retrieval, not full-history prompt-stuffing" discipline as
 *  knowledge.ts's owner-authored Project Knowledge. */
async function loadCommunityKnowledgeItems(admin: SupabaseClient, communityId: string): Promise<CommunityKnowledgeItem[]> {
  const { data } = await admin
    .from("watch_community_resources")
    .select("id, message_thread_id, platform_message_id, is_admin_author, is_pinned, is_announcement_topic, kind, url, text, created_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    messageThreadId: (r.message_thread_id as number | null) ?? null,
    platformMessageId: r.platform_message_id as string,
    isAdminAuthor: r.is_admin_author === true,
    isPinned: r.is_pinned === true,
    isAnnouncementTopic: r.is_announcement_topic === true,
    kind: r.kind as CommunityKnowledgeItem["kind"],
    url: (r.url as string | null) ?? null,
    text: r.text as string,
    createdAt: r.created_at as string,
  }));
}

/** DB-facing half of community-message-knowledge's pure
 *  buildCommunityKnowledgeGrounding -- loads this community's indexed
 *  knowledge, resolves a real deep link to the chosen pinned reference when
 *  one can be built (needs the chat's own username, which the caller
 *  already has from the Telegram message), and returns null when nothing
 *  relevant exists at all (the caller then omits the grounding block from
 *  the prompt entirely). Called ONLY after the Watcher has already been
 *  cleared to respond -- see this function's callers in respondAsDeployment
 *  and the pending-reply sweep, both of which resolve it strictly AFTER
 *  every engagement/deference/scheduling decision, never before. */
async function loadCommunityKnowledgeGrounding(
  admin: SupabaseClient, communityId: string, messageThreadId: number | null, chatId: string, chatUsername: string | null, query: string,
  token: string | null = null
): Promise<CommunityKnowledgeGrounding | null> {
  // Gap 4 (2026-09-02): reconcile any stale unpin BEFORE ranking, so a
  // message that's been unpinned since it was indexed is never ranked as
  // "the community's currently pinned reference" (see
  // syncCurrentPinnedMessage's own doc comment for why Telegram gives no
  // direct unpin event to react to instead). Best-effort -- a failed sync
  // (missing token, transient Telegram error) never blocks generation, it
  // just means this one call falls back to whatever was last indexed.
  if (token) await syncCurrentPinnedMessage(admin, token, communityId, chatId);
  const items = await loadCommunityKnowledgeItems(admin, communityId);
  if (!items.length) return null;
  const pinned = items.find((i) => i.isAdminAuthor && i.isPinned);
  const pinnedLink = pinned && pinned.messageThreadId != null ? buildTopicLink(chatUsername, chatId, pinned.messageThreadId) : null;
  return buildCommunityKnowledgeGrounding(query, items, new Date(), pinnedLink);
}

/* ---------------------------------------------------- community connect ---- */
// Session-less core shared by the owner-authed connectCommunity action
// (actions/moderator.ts) AND the Phase 4.O /start-driven auto-connect below
// -- same "extract the real logic into a plain server-only lib module, keep
// the action a thin auth wrapper over it" pattern already used for
// orders/place.ts's placeOrderForAccount.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface DeploymentHealthInfo {
  present: boolean;
  canSend: boolean;
  canDelete: boolean;
  canRestrict: boolean;
  checkedAt: string | null;
}

export interface CommunityDeploymentRow {
  deploymentId: string;
  communityId: string;
  chatId: string;
  handle: string | null;
  title: string | null;
  chatType: string | null;
  enabled: boolean;
  health: DeploymentHealthInfo;
  botAckMode: BotAckMode;
  /** Phase 4.M (F) — who partnership/AMA/collab inquiries get routed to in
   *  this community, owner-typed (username or plain description). Null =
   *  unset; the moderator never invents a contact when this is unset. */
  collabContact: string | null;
  /** Phase 4.O — delivery-based bot-to-bot verification (spec §13/§15).
   *  "verified_by_delivery" is only ever set from an actual successful
   *  bot-ack send, never fabricated from a UI checkbox. */
  botToBotStatus: "not_tested" | "ready_for_test" | "verified_by_delivery" | "failed";
}

/**
 * Starts the 7-day free trial (spec §45) the moment a panel's first
 * ModeratorDeployment is about to go live, IF this owner account has never
 * had one before. Idempotent/race-safe: moderator_trial_usage.owner_id is a
 * primary key, so the insert either wins exactly once (grant it) or fails
 * with a unique violation (already used, on this panel or another — no-op).
 * Silently does nothing if the panel already has a paid tier or an active
 * trial; capacity for that case is already correct.
 */
async function startModeratorTrialIfEligible(admin: SupabaseClient, ownerId: string, panelId: string, moderatorId: string): Promise<void> {
  const { data: panel } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  const settings = (panel?.settings as Record<string, unknown>) ?? {};
  if (hasVirtualModerator(settings)) return; // already entitled (paid tier or active trial) — nothing to grant

  const now = new Date();
  const endsAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60_000);
  const { error } = await admin.from("moderator_trial_usage").insert({
    owner_id: ownerId,
    panel_id: panelId,
    virtual_moderator_id: moderatorId,
    started_at: now.toISOString(),
    ends_at: endsAt.toISOString(),
  });
  if (error) return; // this owner already has a trial on record (or a genuine DB error) — don't grant/modify anything

  const addons = (settings.addons as Record<string, unknown>) ?? {};
  const moderatorAddon = (addons.moderator as Record<string, unknown>) ?? {};
  const nextSettings = {
    ...settings,
    addons: {
      ...addons,
      moderator: { ...moderatorAddon, trial: { startedAt: now.toISOString(), endsAt: endsAt.toISOString() } },
    },
  };
  await admin.from("panels").update({ settings: nextSettings }).eq("id", panelId);
}

/**
 * Shared core of "connect a bot-ready moderator to a Telegram community" —
 * everything AFTER Telegram membership has been verified with the
 * moderator's own bot token (trial-start, capacity checks, project/community/
 * deployment upsert). Called from BOTH the owner-authed connectCommunity
 * action AND the Phase 4.O /start-driven auto-connect below — ONE
 * deployment-creation path, never a second competing implementation of the
 * same cap-respecting logic (telegram-bot-to-bot-onboarding-spec.md's
 * explicit "do not create a parallel moderator/deployment system"
 * instruction).
 */
/** The only Telegram chat/resource types a Community connection may
 *  represent — mirrors `watch-runtime.ts`'s `createAccountCommunity` guard
 *  (the standalone-Watch creation path, fixed in migration 0071's identity
 *  pass). `finalizeCommunityConnection` — the shared Panel-owner/`/start`
 *  connect core — never had the equivalent check, which is exactly how a
 *  private 1:1 chat with a Telegram PERSON (e.g. the account holder's own
 *  conversation with their moderator's bot) could reach this function and
 *  get treated as a real Community: a Project auto-created and named after
 *  that person's Telegram username/display name (`membership.chat.title ??
 *  membership.chat.username`), plus a `communities` row with `chat_type:
 *  "private"`. Migration 0071 already cleaned up the resulting private
 *  `communities` rows; migration 0072 cleans up the orphaned Projects left
 *  behind by this exact gap. This checked EARLY (before the trial-start side
 *  effect) closes the gap at its actual source going forward. */
const SUPPORTED_TELEGRAM_COMMUNITY_CHAT_TYPES = new Set(["group", "supergroup", "channel"]);

export async function finalizeCommunityConnection(
  admin: SupabaseClient,
  panelId: string,
  moderatorId: string,
  ownerId: string,
  panelSettings: unknown,
  membership: ChatMembershipResult
): Promise<Result<CommunityDeploymentRow>> {
  if (membership.chat.type && !SUPPORTED_TELEGRAM_COMMUNITY_CHAT_TYPES.has(membership.chat.type)) {
    return { ok: false, error: "This is a personal Telegram account, not a group or channel. Add the bot to a Telegram group, supergroup, or channel instead." };
  }

  // Past all Telegram verification — this connection attempt is real, so this
  // is the right moment to start the trial if this owner has never had one
  // (spec §45: trial starts on the first deployment actually going live, not
  // merely on moderator/draft creation). Re-fetch settings afterward so the
  // capacity check below sees trial capacity on this very first call.
  await startModeratorTrialIfEligible(admin, ownerId, panelId, moderatorId);
  const { data: freshPanel } = await admin.from("panels").select("settings").eq("id", panelId).maybeSingle();
  const currentSettings = freshPanel?.settings ?? panelSettings;

  const capacity = moderatorCapacity(currentSettings);
  const { count: existingCommunityCount } = await admin
    .from("communities")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", panelId);
  const { data: existingCommunity } = await admin
    .from("communities")
    .select("id, project_id")
    .eq("panel_id", panelId)
    .eq("platform", "telegram")
    .eq("chat_id", String(membership.chat.id))
    .maybeSingle();
  if (communityCountExceeded(!existingCommunity, existingCommunityCount ?? 0, capacity.maxCommunities)) {
    return { ok: false, error: `You've reached the limit of ${capacity.maxCommunities} communit${capacity.maxCommunities === 1 ? "y" : "ies"} for your current plan.` };
  }

  // Panel -> Project -> Community: every community belongs to exactly one
  // project (communities.project_id is NOT NULL, migration 0057). Reuse the
  // EXISTING community's project unchanged (never silently reassign it on a
  // reconnect); a genuinely new community gets its own new project, named
  // after the Telegram chat itself -- the same conservative "one project per
  // community" default the migration used for existing data, since this
  // action has no project-selector UI yet to ask the owner explicitly.
  let projectId = existingCommunity?.project_id ?? null;
  if (!projectId) {
    const { data: project, error: projectError } = await admin
      .from("projects")
      // account_id = the panel owner (projects.account_id is the canonical
      // neutral owner, migration 0066); panel_id is kept as the Forge
      // distribution-channel reference, not the owner.
      .insert({ panel_id: panelId, account_id: ownerId, name: membership.chat.title ?? membership.chat.username ?? "Project" })
      .select("id")
      .single();
    if (projectError || !project) return { ok: false, error: projectError?.message ?? "Could not create a project for this community." };
    projectId = project.id;
  }

  const { data: community, error: communityError } = await admin
    .from("communities")
    .upsert(
      {
        panel_id: panelId,
        platform: "telegram",
        chat_id: String(membership.chat.id),
        handle: membership.chat.username ?? null,
        title: membership.chat.title ?? null,
        chat_type: membership.chat.type ?? null,
        project_id: projectId,
      },
      { onConflict: "panel_id,platform,chat_id" }
    )
    .select("id, chat_id, handle, title, chat_type, bot_ack_mode, collab_contact")
    .single();
  if (communityError || !community) return { ok: false, error: communityError?.message ?? "Could not save the community." };

  const { count: activeSlotCount } = await admin
    .from("moderator_deployments")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", panelId)
    .eq("enabled", true);
  const { data: existingDeployment } = await admin
    .from("moderator_deployments")
    .select("id, enabled")
    .eq("moderator_id", moderatorId)
    .eq("community_id", community.id)
    .maybeSingle();

  // Flat per-community cap, independent of tier — keeps bot-to-bot
  // acknowledgement traffic sane even on plans with plenty of total Active
  // Mod Slots left. Innvil's own connection only; doesn't touch how many
  // bots the owner adds to the Telegram group directly. Same shared check
  // used by every other deployment-creation/re-activation path.
  const { count: communityDeploymentCount } = await admin
    .from("moderator_deployments")
    .select("id", { count: "exact", head: true })
    .eq("community_id", community.id)
    .eq("enabled", true);
  const slotCheck = checkDeploymentSlotCaps({
    isExistingDeployment: !!existingDeployment,
    activeSlotCount: activeSlotCount ?? 0,
    maxActiveSlots: capacity.maxActiveSlots,
    communityDeploymentCount: communityDeploymentCount ?? 0,
  });
  if (!slotCheck.ok) return { ok: false, error: deploymentSlotCheckErrorMessage(slotCheck, capacity.maxActiveSlots) };

  const checkedAt = new Date().toISOString();
  const health: DeploymentHealthInfo = {
    present: membership.present,
    canSend: membership.canSend,
    canDelete: membership.canDelete,
    canRestrict: membership.canRestrict,
    checkedAt,
  };

  const { data: deployment, error: deploymentError } = await admin
    .from("moderator_deployments")
    .upsert(
      { panel_id: panelId, moderator_id: moderatorId, community_id: community.id, enabled: true, health },
      { onConflict: "moderator_id,community_id" }
    )
    .select("id")
    .single();
  if (deploymentError || !deployment) return { ok: false, error: deploymentError?.message ?? "Could not create the deployment." };

  await admin.from("virtual_moderators").update({ provisioning_status: "active" }).eq("id", moderatorId);

  return {
    ok: true,
    data: {
      deploymentId: deployment.id,
      communityId: community.id,
      chatId: community.chat_id,
      handle: community.handle,
      title: community.title,
      chatType: community.chat_type,
      enabled: true,
      health,
      botAckMode: (community.bot_ack_mode as BotAckMode) ?? "off",
      collabContact: community.collab_contact ?? null,
      botToBotStatus: "not_tested",
    },
  };
}

/** Fetch a Telegram bot credential directly from its integration row (no
 *  deployment required) — used by the /start handler below, which only has
 *  the inbound integration itself, not yet a resolved deployment. */
async function getBotTokenForIntegration(admin: SupabaseClient, integrationId: string): Promise<string | null> {
  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integrationId, p_secret: providerKeySecret() });
  return (tokenData as string | null) ?? null;
}

async function sendPlainMessage(token: string, chatId: string | number, text: string): Promise<void> {
  const res = await telegramApiCall(token, "sendMessage", { chat_id: chatId, text });
  if (!res.ok) console.error("[telegram/setup] sendMessage failed", res.error);
}

export const START_COMMAND_RE = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i;

/**
 * Handles Telegram's /start command — both the private-chat "what is this
 * bot" touchpoint AND the group-chat add-to-group completion
 * (telegram-bot-to-bot-onboarding-spec.md §2/§6/§23). Tapping
 * buildAddToGroupDeepLink's `?startgroup=<token>` link makes Telegram itself
 * deliver `/start <token>` as an ordinary message right after the user picks
 * a group and confirms — there is no separate Telegram-side callback.
 * Returns true whenever the message WAS a /start command (handled or not),
 * so the caller stops there — a /start is never routed into moderation,
 * chatter, or bot-ack.
 */
async function handleStartCommand(
  admin: SupabaseClient,
  integration: { id: string; panel_id: string | null; virtual_moderator_id: string },
  message: TelegramMessage
): Promise<boolean> {
  const match = START_COMMAND_RE.exec((message.text ?? "").trim());
  if (!match) return false;

  const token = await getBotTokenForIntegration(admin, integration.id);
  if (!token) return true; // nothing we can safely do without a bot credential

  const { data: moderator } = await admin.from("virtual_moderators").select("name").eq("id", integration.virtual_moderator_id).maybeSingle();
  const moderatorName = (moderator?.name as string | undefined)?.trim() || "your Innvil moderator";

  if (message.chat.type === "private") {
    // Never disclose tenant/panel/community data to whoever sent this —
    // Telegram gives no guarantee the sender is the real subscriber (spec
    // §29: "never trust Telegram username as identity"). A generic, safe
    // touchpoint only, never a reactive-quota-consuming chatter reply.
    await sendPlainMessage(
      token,
      message.chat.id,
      `Hi! I'm ${moderatorName}, an AI community moderator powered by Innvil. To add me to your Telegram group, use the "Add to group" button from your Innvil dashboard.`
    );
    return true;
  }

  // Group/supergroup/channel: only meaningful when it carries the opaque
  // setup-session token from buildAddToGroupDeepLink's startgroup payload —
  // a bare /start with no token (e.g. someone typed it manually) has
  // nothing to correlate to, so it's swallowed silently rather than
  // auto-connecting an unrelated group to an unrelated moderator.
  const setupToken = match[1]?.trim();
  if (!setupToken) return true;

  await completeGroupSetupSession(admin, integration, message, setupToken, token, moderatorName);
  return true;
}

/** Consumes an opaque telegram_setup_sessions token to finish the Phase 4.O
 *  add-to-group flow — validates the session belongs to THIS bot/panel,
 *  hasn't expired, and hasn't already been consumed (a duplicate Telegram
 *  delivery of the same /start must never complete the same session twice),
 *  then calls the SAME finalizeCommunityConnection every owner-initiated
 *  connection goes through. */
async function completeGroupSetupSession(
  admin: SupabaseClient,
  integration: { id: string; panel_id: string | null; virtual_moderator_id: string },
  message: TelegramMessage,
  setupToken: string,
  botToken: string,
  moderatorName: string
): Promise<void> {
  // The /start deep-link setup-session flow (Phase 4.O) is created
  // exclusively by the owner-side createTelegramSetupSession action, which
  // is Panel-scoped -- a standalone (Panel-less) integration structurally
  // can never have a real telegram_setup_sessions row to consume here.
  // Standalone Telegram connection isn't wired to this flow yet (see
  // watch-runtime.ts's createAccountCommunity, the DB/ownership layer for
  // it); this is a safe no-op, never a crash, for that case.
  if (!integration.panel_id) return;
  const now = new Date();
  const { data: session } = await admin
    .from("telegram_setup_sessions")
    .select("id, panel_id, virtual_moderator_id, status, expires_at")
    .eq("token", setupToken)
    .maybeSingle();

  if (!session || session.status !== "pending" || new Date(session.expires_at).getTime() < now.getTime()) {
    if (session?.status === "pending") await admin.from("telegram_setup_sessions").update({ status: "expired" }).eq("id", session.id);
    await sendPlainMessage(botToken, message.chat.id, "This setup link has expired or was already used — start a new one from your Innvil dashboard.");
    return;
  }

  // The token must belong to THIS bot's own moderator — a setup session
  // created for a different moderator (even under the same panel) must
  // never be completed by a different bot's webhook.
  if (session.virtual_moderator_id !== integration.virtual_moderator_id || session.panel_id !== integration.panel_id) return;

  // Consume atomically-enough: a single UPDATE keyed on the still-pending
  // status, so two overlapping deliveries of the same /start can't both
  // "win" and double-run the connection logic below.
  const { data: consumed } = await admin
    .from("telegram_setup_sessions")
    .update({ status: "consumed", consumed_at: now.toISOString() })
    .eq("id", session.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!consumed) return; // another delivery already consumed it

  const membership = await checkChatMembership(botToken, String(message.chat.id));
  if (!membership.ok || !membership.result.present) {
    await sendPlainMessage(botToken, message.chat.id, "I couldn't verify my membership in this group yet — try the add-to-group link again in a moment.");
    return;
  }

  const { data: panelRow } = await admin.from("panels").select("owner_id, settings").eq("id", integration.panel_id).maybeSingle();
  if (!panelRow) return;

  const result = await finalizeCommunityConnection(
    admin,
    integration.panel_id,
    integration.virtual_moderator_id,
    panelRow.owner_id as string,
    panelRow.settings,
    membership.result
  );

  if (!result.ok) {
    await sendPlainMessage(botToken, message.chat.id, `I'm in the group, but couldn't finish connecting: ${result.error}`);
    return;
  }

  await sendPlainMessage(botToken, message.chat.id, `${moderatorName} is now connected and ready to help moderate this community.`);
}

/** Tenant-isolated sender classification (spec §2/§4/§5) — the DB lookups behind event-types.ts's pure decision.
 *  Exported for direct testing (community-runtime.test.ts) of the display-
 *  name resolution fix — this is the ACTUAL source of the "@kwan_mod_bot in
 *  generated conversation" leak, so it needs its own direct test, not just a
 *  downstream one on the coordinator's template layer. */
/** Prefix marking a synthesized "the channel itself posted this" identity
 *  (an anonymous Telegram channel post has no real `from` user) -- never a
 *  real numeric Telegram user id, so any code checking a platformUserId
 *  against Telegram (e.g. isSenderAdminOrTrusted's getChatMember call) must
 *  recognize this prefix and skip the live lookup rather than let it fail. */
export const SYNTHETIC_CHANNEL_SENDER_PREFIX = "channel:";

export function isSyntheticChannelSender(platformUserId: string | null | undefined): boolean {
  return !!platformUserId && platformUserId.startsWith(SYNTHETIC_CHANNEL_SENDER_PREFIX);
}

export async function classifySender(admin: SupabaseClient, panelId: string | null, communityId: string, from: TelegramUser): Promise<CommunityEvent["sender"]> {
  const platformUserId = String(from.id);
  if (!from.is_bot) {
    return { platformUserId, isBot: false, senderType: "HUMAN", displayName: from.first_name ?? from.username ?? null, username: from.username ?? null };
  }

  // Never filter by panel here — deliberately fetch ALL integrations sharing
  // this numeric bot id, then require an EXACT match on THIS event's panel.
  // A bot id known to Innvil under a different tenant must never be trusted.
  // Also pulls the moderator's own CONFIGURED name (virtual_moderators.name)
  // -- required so a bot sender's displayName can be its human-facing name
  // ("Kwan") rather than its Telegram bot username ("kwan_mod_bot"), which
  // must never leak into generated conversational text (see below).
  const { data: candidates } = await admin
    .from("telegram_bot_integrations")
    .select("id, panel_id, virtual_moderator_id, username, virtual_moderators(name)")
    .eq("telegram_bot_id", from.id)
    .limit(5);
  const integration = (candidates ?? []).find((c) => c.panel_id === panelId) ?? null;
  const integrationModerator = integration
    ? (Array.isArray(integration.virtual_moderators) ? integration.virtual_moderators[0] : integration.virtual_moderators)
    : null;
  const moderatorConfiguredName = (integrationModerator as { name?: string } | null)?.name ?? null;

  const knownBot = integration
    ? {
        integration: { panelId: integration.panel_id, virtualModeratorId: integration.virtual_moderator_id },
        activeDeploymentInThisCommunity: null as { deploymentId: string } | null,
      }
    : null;

  if (knownBot) {
    const { data: deployment } = await admin
      .from("moderator_deployments")
      .select("id")
      .eq("moderator_id", integration!.virtual_moderator_id)
      .eq("community_id", communityId)
      .eq("enabled", true)
      .maybeSingle();
    if (deployment) knownBot.activeDeploymentInThisCommunity = { deploymentId: deployment.id };
  }

  const senderType = classifySenderPure(true, knownBot);
  // CRITICAL: for a recognized Innvil moderator, displayName must be the
  // moderator's CONFIGURED name ("Kwan"), never the Telegram bot username
  // ("kwan_mod_bot") -- this is the name that flows straight into generated
  // bot-to-bot acknowledgement text (coordinator.ts's craftAckText). Only an
  // EXTERNAL_BOT (or a human) falls back to Telegram-provided naming, which
  // is fine there since that path never claims to be "a moderator's name."
  // A missing configured name (shouldn't happen for a real deployment, but
  // never assumed) safely falls through to null -- craftAckText's name-free
  // template pool -- rather than ever falling back to the raw username.
  const displayName = senderType === "INNVIL_MODERATOR" ? moderatorConfiguredName : (from.username ?? from.first_name ?? null);
  return {
    platformUserId,
    isBot: true,
    senderType,
    displayName,
    innvilModeratorId: senderType === "INNVIL_MODERATOR" ? integration?.virtual_moderator_id : undefined,
    deploymentId: senderType === "INNVIL_MODERATOR" ? knownBot?.activeDeploymentInThisCommunity?.deploymentId : undefined,
  };
}

/**
 * Records the inbound message AND doubles as the cross-bot claim for it —
 * platform_message_id is assigned per-chat by Telegram (not per-bot), so
 * when several Innvil-managed bots are deployed in the same community with
 * Group Privacy Mode off, every one of them receives the SAME real message
 * on their OWN webhook independently. Without a claim, each webhook call
 * would go on to independently run bot-ack/chatter and could each execute
 * an action — confirmed live as a double-send (the same bot posting its own
 * reply twice back-to-back). The unique index on (community_id,
 * platform_message_id) (migration 0049) makes whichever webhook call reaches
 * this insert first the sole owner of processing this message; every other
 * one gets a conflict and must stop before touching bot-ack/chatter.
 */
async function recordCommunityMessage(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  message: TelegramMessage,
  sender: CommunityEvent["sender"]
): Promise<{ claimed: boolean }> {
  const { error } = await admin.from("community_messages").insert({
    panel_id: panelId,
    community_id: communityId,
    platform_message_id: String(message.message_id),
    sender_type: sender.senderType,
    sender_platform_id: sender.platformUserId,
    sender_display_name: sender.displayName,
    deployment_id: sender.senderType === "INNVIL_MODERATOR" ? sender.deploymentId ?? null : null,
    text: message.text ?? message.caption ?? "",
    reply_to_platform_message_id: message.reply_to_message ? String(message.reply_to_message.message_id) : null,
    message_thread_id: message.message_thread_id ?? null,
  });
  if (!error) return { claimed: true };
  if (error.code === "23505") return { claimed: false }; // another bot's webhook already claimed this message
  throw new Error(`recordCommunityMessage failed: ${error.message}`);
}

/**
 * Resolves the TRUE origin/interactionDepth of the message currently being
 * classified, instead of assuming every inbound event is a fresh HUMAN-
 * equivalent one. A bot-ack SEND_TEXT reply is delivered to every OTHER
 * bot's webhook as an ordinary new message — Telegram gives no signal that
 * it was itself an acknowledgement — so without this lookup the coordinator's
 * hard loop-prevention gates (`origin === "BOT_ACK"`, `interactionDepth >=
 * MAX_BOT_INTERACTION_DEPTH`) are unreachable: they'd always see origin
 * HUMAN/depth 0. `recordBotAckReply` (below) is what populates the row this
 * reads — only for SEND_TEXT acks, keyed by the outbound message's own
 * platform_message_id (shared across every bot in the chat, since Telegram
 * message IDs are per-chat, not per-recipient). Ordinary messages (human,
 * natural-chatter replies, proactive posts) never get an `origin` row, so
 * this safely defaults to HUMAN/0 for everything else.
 */
export async function resolveEventOrigin(admin: SupabaseClient, communityId: string, platformMessageId: string): Promise<{ origin: CommunityEvent["origin"]; interactionDepth: number }> {
  const { data } = await admin
    .from("community_messages")
    .select("origin, interaction_depth")
    .eq("community_id", communityId)
    .eq("platform_message_id", platformMessageId)
    .not("origin", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data?.origin) return { origin: "HUMAN", interactionDepth: 0 };
  return { origin: data.origin as CommunityEvent["origin"], interactionDepth: data.interaction_depth ?? 0 };
}

/** Persists the provenance of a bot-ack SEND_TEXT or COMMUNITY_HANDOFF reply
 *  so resolveEventOrigin can recognize it when another bot's webhook
 *  re-classifies this same message. REACT actions never call this — a
 *  reaction isn't delivered as a new "message" update, so there's nothing
 *  for another webhook to re-classify and no loop risk to guard against.
 *  A COMMUNITY_HANDOFF action carries no `origin` field of its own (its
 *  kind IS the signal — see event-types.ts) — recorded as origin
 *  "COMMUNITY_HANDOFF" so the NEXT event's resolveEventOrigin correctly
 *  hits coordinator.ts's hard "no bot response to a handoff" gate. */
async function recordBotAckReply(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  sentMessageId: string,
  action: Extract<CommunityAction, { kind: "SEND_TEXT" | "COMMUNITY_HANDOFF" }>
) {
  await admin.from("community_messages").insert({
    panel_id: panelId,
    community_id: communityId,
    platform_message_id: sentMessageId,
    sender_type: "INNVIL_MODERATOR",
    sender_platform_id: null,
    sender_display_name: null,
    deployment_id: action.targetDeploymentId,
    text: action.text,
    reply_to_platform_message_id: action.replyToMessageId ?? null,
    origin: action.kind === "COMMUNITY_HANDOFF" ? "COMMUNITY_HANDOFF" : action.origin,
    interaction_depth: action.interactionDepth,
  });
}

/* ------------------------------------------------------- bot acknowledgement ---- */

interface DeploymentStateRow {
  last_bot_ack_at: string | null;
  bot_acks_today: number;
  bot_acks_day: string | null;
}

async function loadEligibleTargets(admin: SupabaseClient, communityId: string, excludeDeploymentId: string): Promise<EligibleTarget[]> {
  const { data: deployments } = await admin
    .from("moderator_deployments")
    .select("id, virtual_moderators(name)")
    .eq("community_id", communityId)
    .eq("enabled", true)
    .neq("id", excludeDeploymentId);
  const rows = (deployments ?? []) as Array<{ id: string; virtual_moderators: { name: string } | { name: string }[] | null }>;
  if (!rows.length) return [];

  const { data: states } = await admin
    .from("deployment_state")
    .select("deployment_id, last_bot_ack_at, bot_acks_today, bot_acks_day")
    .in("deployment_id", rows.map((r) => r.id));
  const stateById = new Map<string, DeploymentStateRow>();
  for (const s of (states ?? []) as Array<{ deployment_id: string } & DeploymentStateRow>) {
    stateById.set(s.deployment_id, s);
  }

  return rows.map((r) => {
    const vm = Array.isArray(r.virtual_moderators) ? r.virtual_moderators[0] : r.virtual_moderators;
    const s = stateById.get(r.id);
    return {
      deploymentId: r.id,
      displayName: vm?.name ?? "Moderator",
      lastBotAckAt: s?.last_bot_ack_at ?? null,
      botAcksToday: s?.bot_acks_today ?? 0,
      botAcksDay: s?.bot_acks_day ?? null,
    };
  });
}

async function recordBotAck(admin: SupabaseClient, deploymentId: string, now: Date) {
  const day = now.toISOString().slice(0, 10);
  const { data: existing } = await admin.from("deployment_state").select("bot_acks_today, bot_acks_day").eq("deployment_id", deploymentId).maybeSingle();
  const nextCount = existing?.bot_acks_day === day ? (existing.bot_acks_today ?? 0) + 1 : 1;
  await admin
    .from("deployment_state")
    .upsert({ deployment_id: deploymentId, last_bot_ack_at: now.toISOString(), bot_acks_today: nextCount, bot_acks_day: day }, { onConflict: "deployment_id" });
}

/* --------------------------------------------------------------- outbound ---- */

async function executeAction(admin: SupabaseClient, chatId: string, action: CommunityAction): Promise<{ sentMessageId: string | null; ok: boolean; error?: string }> {
  if (action.kind === "IGNORE") return { sentMessageId: null, ok: true };

  const { data: deployment } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id")
    .eq("id", action.targetDeploymentId)
    .maybeSingle();
  if (!deployment) return { sentMessageId: null, ok: false, error: "deployment not found" };

  const { data: integration } = await admin
    .from("telegram_bot_integrations")
    .select("id")
    .eq("virtual_moderator_id", deployment.moderator_id)
    .maybeSingle();
  if (!integration) return { sentMessageId: null, ok: false, error: "telegram integration not found" };

  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  const token = tokenData as string | null;
  if (!token) return { sentMessageId: null, ok: false, error: "bot token unavailable" };

  if (action.kind === "REACT") {
    // Result was previously discarded here -- a rejected reaction (bot
    // lacking rights, or the chat's own restricted reaction set) failed
    // completely silently, with the caller logging "REACT" as if it had
    // worked. Now surfaced so the caller can log/console.error the real
    // outcome instead of assuming success.
    const res = await telegramApiCall(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: action.targetMessageId,
      reaction: [{ type: "emoji", emoji: action.emoji }],
    });
    if (res.ok) return { sentMessageId: null, ok: true };
    // Defense in depth: the chosen emoji may still not be in THIS chat's
    // (or Telegram's own) allowed-reactions set even after the emoji-pool
    // fix above -- retry once with "👍", a near-universal Telegram reaction,
    // rather than silently losing the acknowledgement entirely. A single
    // retry, not a discovery round-trip to the chat's actual allowed set.
    if (action.emoji !== "👍" && res.error === "Bad Request: REACTION_INVALID") {
      const retry = await telegramApiCall(token, "setMessageReaction", {
        chat_id: chatId,
        message_id: action.targetMessageId,
        reaction: [{ type: "emoji", emoji: "👍" }],
      });
      return { sentMessageId: null, ok: retry.ok, error: retry.ok ? undefined : retry.error };
    }
    return { sentMessageId: null, ok: false, error: res.error };
  }

  if (action.kind === "SEND_TEXT" || action.kind === "COMMUNITY_HANDOFF") {
    const parseMode = action.kind === "SEND_TEXT" ? action.parseMode : undefined;
    const res = await telegramApiCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: action.text,
      reply_to_message_id: action.replyToMessageId ?? undefined,
      ...(parseMode ? { parse_mode: parseMode } : {}),
    });
    return { sentMessageId: res.ok ? String(res.result.message_id) : null, ok: res.ok, error: res.ok ? undefined : res.error };
  }

  if (action.kind === "DELETE_MESSAGE") {
    const res = await telegramApiCall(token, "deleteMessage", { chat_id: chatId, message_id: action.targetMessageId });
    return { sentMessageId: null, ok: res.ok, error: res.ok ? undefined : res.error };
  }

  if (action.kind === "RESTRICT_USER") {
    if (action.mode === "MUTE") {
      // Full temporary mute (all can_send_* permissions off), until
      // `muteMinutes` minutes from NOW (execution time, not decision time --
      // avoids any clock-skew between when the enforcement was decided and
      // when this actually runs).
      const untilDate = Math.floor(Date.now() / 1000) + action.muteMinutes * 60;
      const res = await telegramApiCall(token, "restrictChatMember", {
        chat_id: chatId,
        user_id: action.targetPlatformUserId,
        permissions: {
          can_send_messages: false, can_send_audios: false, can_send_documents: false,
          can_send_photos: false, can_send_videos: false, can_send_video_notes: false,
          can_send_voice_notes: false, can_send_polls: false, can_send_other_messages: false,
          can_add_web_page_previews: false,
        },
        until_date: untilDate,
      });
      return { sentMessageId: null, ok: res.ok, error: res.ok ? undefined : res.error };
    }
    if (action.mode === "KICK") {
      // Telegram has no dedicated "kick" method -- its own documented idiom
      // is banChatMember immediately followed by unbanChatMember (removes
      // the user, but does NOT leave them permanently banned -- they can
      // rejoin via a fresh invite). `only_if_banned` makes the unban a
      // no-op rather than an error if something upstream already banned
      // this user by other means.
      const banRes = await telegramApiCall(token, "banChatMember", { chat_id: chatId, user_id: action.targetPlatformUserId });
      if (!banRes.ok) return { sentMessageId: null, ok: false, error: banRes.error };
      const unbanRes = await telegramApiCall(token, "unbanChatMember", { chat_id: chatId, user_id: action.targetPlatformUserId, only_if_banned: true });
      return { sentMessageId: null, ok: unbanRes.ok, error: unbanRes.ok ? undefined : unbanRes.error };
    }
    const res = await telegramApiCall(token, "banChatMember", { chat_id: chatId, user_id: action.targetPlatformUserId });
    return { sentMessageId: null, ok: res.ok, error: res.ok ? undefined : res.error };
  }

  return { sentMessageId: null, ok: true };
}

/** Bounded, best-effort cleanup of a removed user's recent messages in a
 *  Community -- reuses the EXISTING per-message DELETE_MESSAGE action (via
 *  executeAction) once per message id, never a second Telegram call
 *  mechanism. Never claims success unless Telegram actually confirmed each
 *  deletion (spec §12) -- `purged` only counts real `ok:true` results.
 *  Bounded by MESSAGE_PURGE_LIMIT (avoids an unbounded sweep/rate-limit
 *  risk for a very chatty offender) and MESSAGE_PURGE_LOOKBACK_MS (stays
 *  safely inside Telegram's own ~48h message-delete window). */
const MESSAGE_PURGE_LIMIT = 50;
const MESSAGE_PURGE_LOOKBACK_MS = 47 * 60 * 60_000;

async function purgeUserMessages(
  admin: SupabaseClient,
  chatId: string,
  communityId: string,
  platformUserId: string,
  enforcerDeploymentId: string,
  now: Date
): Promise<{ attempted: number; purged: number; failed: boolean }> {
  const since = new Date(now.getTime() - MESSAGE_PURGE_LOOKBACK_MS).toISOString();
  const { data: rows } = await admin
    .from("community_messages")
    .select("platform_message_id")
    .eq("community_id", communityId)
    .eq("sender_platform_id", platformUserId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_PURGE_LIMIT);
  const candidates = (rows ?? []) as Array<{ platform_message_id: string }>;
  if (candidates.length === 0) return { attempted: 0, purged: 0, failed: false };

  let purged = 0;
  for (const row of candidates) {
    const res = await executeAction(admin, chatId, { kind: "DELETE_MESSAGE", targetDeploymentId: enforcerDeploymentId, targetMessageId: row.platform_message_id });
    if (res.ok) purged++;
  }
  return { attempted: candidates.length, purged, failed: purged === 0 };
}

/* ----------------------------------------------------------- observability ---- */

async function logActivity(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  deploymentId: string | null,
  eventType: string,
  decision: string,
  reasonCode: string,
  meta: Record<string, unknown> = {}
) {
  await admin.from("moderator_activity_log").insert({
    panel_id: panelId,
    community_id: communityId,
    deployment_id: deploymentId,
    event_type: eventType,
    decision,
    reason_code: reasonCode,
    meta,
  });
}

async function logBotAckDecision(admin: SupabaseClient, panelId: string | null, communityId: string, event: CommunityEvent, action: CommunityAction) {
  await logActivity(admin, panelId, communityId, event.sender.deploymentId ?? null, "bot_message", action.kind, event.sender.senderType, {
    interactionDepth: event.interactionDepth,
    origin: event.origin,
    targetDeploymentId: action.kind !== "IGNORE" ? action.targetDeploymentId : null,
  });
}

/* -------------------------------------------------------- natural chatter ---- */

const KNOWLEDGE_SELECT = "id, panel_id, scope_type, project_id, community_id, kind, title, content, active, expires_at";

function toKnowledgeSources(rows: Array<Record<string, unknown>> | null): KnowledgeSource[] {
  return (rows ?? []).map((r) => ({
    id: r.id as string, panelId: r.panel_id as string, scopeType: r.scope_type as KnowledgeSource["scopeType"],
    projectId: (r.project_id as string) ?? null, communityId: (r.community_id as string) ?? null, kind: r.kind as KnowledgeSource["kind"],
    title: (r.title as string) ?? "", content: (r.content as string) ?? "", active: r.active !== false,
    expiresAt: (r.expires_at as string) ?? null,
  }));
}

/** Resolves which PROJECT a community belongs to — never trusts a
 *  client-supplied project id; always derived from the community itself
 *  (Panel -> Project -> Community hierarchy). Every community has exactly
 *  one project (communities.project_id is NOT NULL, migration 0057). */
async function resolveCommunityProjectId(admin: SupabaseClient, communityId: string): Promise<string | null> {
  const { data } = await admin.from("communities").select("project_id").eq("id", communityId).maybeSingle();
  return data?.project_id ?? null;
}

/** Phase 4.N, simplified: ONE Project Profile a community inherits (name,
 *  overview, contacts), rather than three competing knowledge systems. Every
 *  community has exactly one project (communities.project_id NOT NULL,
 *  migration 0057). */
async function loadProjectProfileRow(admin: SupabaseClient, projectId: string): Promise<{ name: string; overview: string; contacts: ProjectContacts } | null> {
  const { data } = await admin.from("projects").select("name, overview, contacts").eq("id", projectId).maybeSingle();
  if (!data) return null;
  return { name: data.name ?? "", overview: data.overview ?? "", contacts: (data.contacts as ProjectContacts) ?? {} };
}

/** Phase 4.N, simplified to a single Project Profile a community inherits
 *  (name, overview, structured contact presets) plus small optional
 *  Community-specific context and legacy Organization Knowledge as a
 *  low-priority fallback (data preserved from before the simplification,
 *  never surfaced as an equal competing scope — see CLAUDE.md's Phase 4.N
 *  entry).
 *
 *  Two independent mechanisms, combined:
 *   1. STRUCTURED CONTACT PRESETS (project-profile.ts's resolveContactIntent) —
 *      when the question's intent clearly maps to a configured contact
 *      (support/partnerships/sales/technical_support), that preset is
 *      returned as an AUTHORITATIVE entry, always first, bypassing
 *      relevance scoring entirely — a support question must never depend on
 *      keyword luck to surface the right contact. A community may override
 *      the project's preset with its own local value (project-profile.ts's
 *      findCommunityContactOverride), checked FIRST.
 *   2. RELEVANCE-SCORED KNOWLEDGE — the project's own `overview` field
 *      becomes a synthetic entry that competes in the SAME scoring pool as
 *      any additional PROJECT-scope knowledge rows (so it's "the best-
 *      scoring project fact" for a given question, not force-injected into
 *      every answer), community-specific context, and legacy
 *      ORGANIZATION-scope rows as a last-resort fallback.
 *
 *  Isolation is enforced by the query filters themselves (`project_id =
 *  <this community's own resolved project>`), never by prompting alone.
 *  Returns undefined when nothing relevant is found at all, so the caller
 *  can omit the prompt block entirely. */
export async function loadRelevantKnowledge(admin: SupabaseClient, panelId: string | null, communityId: string, query: string): Promise<KnowledgeContextEntry[] | undefined> {
  const projectId = await resolveCommunityProjectId(admin, communityId);

  // ORGANIZATION scope is inherently panel-wide (shared across every
  // Project a Panel owns) -- `knowledge_sources.panel_id` is still NOT NULL
  // (unlike the ownership tables migration 0069 touched), so there's no way
  // to even create a standalone ORGANIZATION-scope row today. A standalone
  // (panelId: null) community simply has none -- skip the query entirely
  // rather than pass a null panelId into a `.eq()` filter (which would
  // never match anything anyway, but this is clearer and saves a query).
  const [communityRes, projectRes, organizationRes, profile] = await Promise.all([
    admin.from("knowledge_sources").select(KNOWLEDGE_SELECT).eq("community_id", communityId).eq("scope_type", "COMMUNITY").eq("active", true),
    projectId
      ? admin.from("knowledge_sources").select(KNOWLEDGE_SELECT).eq("project_id", projectId).eq("scope_type", "PROJECT").eq("active", true)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    panelId
      ? admin.from("knowledge_sources").select(KNOWLEDGE_SELECT).eq("panel_id", panelId).eq("scope_type", "ORGANIZATION").eq("active", true)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    projectId ? loadProjectProfileRow(admin, projectId) : Promise.resolve(null),
  ]);

  const communitySources = toKnowledgeSources(communityRes.data);
  const projectSources = toKnowledgeSources(projectRes.data);
  const organizationSources = toKnowledgeSources(organizationRes.data);

  // Structured contact preset -- resolved BEFORE relevance scoring, never
  // dependent on it. Community override checked first. The matched
  // community entry (if any) is EXCLUDED from the normal relevance-scored
  // pool below so it never appears twice (once authoritative, once as an
  // ordinary scored duplicate).
  const contactEntries: KnowledgeContextEntry[] = [];
  const intent = resolveContactIntent(query);
  let usedCommunitySourceId: string | null = null;
  if (intent) {
    const communityOverrideSource = communitySources.find((s) => findCommunityContactOverride(intent, [{ title: s.title, content: s.content }]) !== null);
    const value = communityOverrideSource?.content ?? profile?.contacts?.[intent];
    if (value) {
      contactEntries.push({ scope: "PRESET", title: CONTACT_LABELS[intent], content: value, authoritative: true });
      if (communityOverrideSource) usedCommunitySourceId = communityOverrideSource.id;
    }
  }
  const communitySourcesForScoring = usedCommunitySourceId ? communitySources.filter((s) => s.id !== usedCommunitySourceId) : communitySources;

  // The project's own overview competes in the SAME relevance pool as any
  // additional PROJECT-scope knowledge -- never unconditionally injected.
  const projectSourcesWithOverview: KnowledgeSource[] = profile?.overview
    ? [{ id: `profile-overview-${projectId}`, panelId, scopeType: "PROJECT", projectId, communityId: null, kind: "overview", title: profile.name || "Overview", content: profile.overview, active: true }, ...projectSources]
    : projectSources;

  if (contactEntries.length === 0 && communitySourcesForScoring.length === 0 && projectSourcesWithOverview.length === 0 && organizationSources.length === 0) return undefined;

  const relevantCommunity = retrieveRelevantKnowledge(query, communitySourcesForScoring);
  const relevantProject = retrieveRelevantKnowledge(query, projectSourcesWithOverview);
  const relevantOrganization = retrieveRelevantKnowledge(query, organizationSources);
  const combined = combineKnowledgeRetrieval(relevantCommunity, relevantProject, relevantOrganization);
  const scored = combined.map((s) => ({ scope: s.scopeType, title: s.title, content: s.content }));

  const result = [...contactEntries, ...scored];
  if (result.length === 0) return undefined;
  return result;
}

export interface ChatterDeployment {
  deploymentId: string;
  /** virtual_moderators.id -- the Watcher PROFILE's own identity, distinct
   *  from deploymentId (the Watcher-to-Community assignment). Needed for
   *  Shared Escalation Group (Phase 1): an escalation's `watcher_id`
   *  references this, since the resolve-back send later needs to find the
   *  SAME Watcher's deployment (which may differ from `deploymentId` if the
   *  deployment was recreated), not just replay the original deployment id. */
  moderatorId: string;
  moderatorName: string;
  persona: ModeratorPersona;
  botUsername: string | null;
  /** moderator_deployments.created_at -- the SOLE source of stable,
   *  deterministic "position" (W1/W2/.../W5) for Watcher role assignment +
   *  chatter rotation (see watcher-roles.ts). Never re-derived from
   *  incidental query-result order. */
  createdAt: string;
}

/** All chatter-eligible deployments in this community — every ENABLED
 *  ModeratorDeployment, not just one. Selection among them happens in
 *  selectChatterAction (chatter-coordinator.ts): the Coordinator picks one
 *  social action and AT MOST ONE responder per human message, never runs a
 *  separate decision per deployment. Ordered by created_at ascending — this
 *  IS the stable "position" (W1, W2, ...) the Watcher role/chatter-rotation
 *  system (watcher-roles.ts) is built on; never incidental Postgres row
 *  order, which is not contractually guaranteed. */
async function findChatterDeployments(admin: SupabaseClient, communityId: string): Promise<ChatterDeployment[]> {
  const { data: deployments } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id, created_at, virtual_moderators(name, persona)")
    .eq("community_id", communityId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });
  const rows = (deployments ?? []) as Array<{
    id: string;
    moderator_id: string;
    created_at: string;
    virtual_moderators: { name: string; persona: unknown } | { name: string; persona: unknown }[] | null;
  }>;
  if (!rows.length) return [];

  const { data: integrations } = await admin
    .from("telegram_bot_integrations")
    .select("virtual_moderator_id, username")
    .in("virtual_moderator_id", rows.map((r) => r.moderator_id));
  const usernameByModeratorId = new Map((integrations ?? []).map((i) => [i.virtual_moderator_id as string, i.username as string | null]));

  return rows.map((row) => {
    const vm = Array.isArray(row.virtual_moderators) ? row.virtual_moderators[0] : row.virtual_moderators;
    return {
      deploymentId: row.id,
      moderatorId: row.moderator_id,
      moderatorName: vm?.name ?? "Moderator",
      persona: normalizeModeratorPersona(vm?.persona),
      botUsername: usernameByModeratorId.get(row.moderator_id) ?? null,
      createdAt: row.created_at,
    };
  });
}

/** Single source of truth for Watcher role assignment + chatter-rotation
 *  state, called once per triggering message (never per capability) so
 *  every stage of handleHumanMessage (moderation, chatter selection) agrees
 *  on the exact same role/duty snapshot. `continuityDeploymentIds` should be
 *  every deployment currently mid an active exchange with a human
 *  (wasLastSpeaker/recentlyParticipated) -- see watcher-roles.ts's own doc
 *  comment for why that's what keeps chatter rotation from abruptly cutting
 *  off a live conversation. */
function computeRoleAssignments(deployments: ChatterDeployment[], now: Date, continuityDeploymentIds: Set<string> = new Set()): WatcherRoleAssignment[] {
  return assignWatcherRoles(
    deployments.map((d) => ({ deploymentId: d.deploymentId, createdAt: d.createdAt, enabled: true })),
    { now, continuityDeploymentIds }
  );
}

async function resolveRepliedToDeployment(admin: SupabaseClient, communityId: string, replyToMessageId: string | null): Promise<string | null> {
  if (!replyToMessageId) return null;
  const { data } = await admin
    .from("community_messages")
    .select("deployment_id")
    .eq("community_id", communityId)
    .eq("platform_message_id", replyToMessageId)
    .maybeSingle();
  return data?.deployment_id ?? null;
}

async function loadChatterPacing(admin: SupabaseClient, deploymentId: string): Promise<ChatterPacingState> {
  const { data } = await admin.from("deployment_state").select("last_spoke_at, consecutive_messages").eq("deployment_id", deploymentId).maybeSingle();
  return { lastSpokeAt: data?.last_spoke_at ?? null, consecutiveMessages: data?.consecutive_messages ?? 0 };
}

/** A fresh human message breaks the bot's own back-to-back-message streak. */
async function resetChatterStreak(admin: SupabaseClient, deploymentId: string) {
  await admin.from("deployment_state").upsert({ deployment_id: deploymentId, consecutive_messages: 0 }, { onConflict: "deployment_id" });
}

async function recordBotSpoke(admin: SupabaseClient, deploymentId: string, now: Date) {
  const { data: existing } = await admin.from("deployment_state").select("consecutive_messages, messages_recent").eq("deployment_id", deploymentId).maybeSingle();
  await admin.from("deployment_state").upsert(
    {
      deployment_id: deploymentId,
      last_spoke_at: now.toISOString(),
      consecutive_messages: (existing?.consecutive_messages ?? 0) + 1,
      messages_recent: (existing?.messages_recent ?? 0) + 1,
    },
    { onConflict: "deployment_id" }
  );
}

async function loadRecentContext(admin: SupabaseClient, communityId: string, limit = 10): Promise<ChatterContextMessage[]> {
  const { data } = await admin
    .from("community_messages")
    .select("sender_type, sender_display_name, sender_platform_id, text, deployment_id, created_at, message_thread_id, platform_message_id, reply_to_platform_message_id")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (
    (data ?? []) as Array<{
      sender_type: string;
      sender_display_name: string | null;
      sender_platform_id: string | null;
      text: string;
      deployment_id: string | null;
      created_at: string;
      message_thread_id: number | null;
      platform_message_id: string | null;
      reply_to_platform_message_id: string | null;
    }>
  )
    .reverse()
    .map((r) => ({
      senderType: r.sender_type as ChatterContextMessage["senderType"],
      senderName: r.sender_display_name,
      text: r.text,
      deploymentId: r.deployment_id,
      createdAt: r.created_at,
      senderPlatformId: r.sender_platform_id,
      messageThreadId: r.message_thread_id ?? null,
      platformMessageId: r.platform_message_id ?? null,
      replyToPlatformMessageId: r.reply_to_platform_message_id ?? null,
    }));
}

/** Finds the most recent message in `context` matching `messageThreadId`
 *  (topic-scoped "conversation ownership" -- rule 8's "must be conversation-
 *  specific, not admin-exists-anywhere-in-group"), optionally filtered to a
 *  sender type and/or excluding one specific platform user id (so a user's
 *  own second message never counts as "someone else already engaged").
 *  `messageThreadId: null` matches only OTHER null-thread messages (an
 *  ordinary non-forum chat, or Telegram's own unlabeled default topic) --
 *  never conflated with a real numbered topic. */
export function findMostRecentMessageInTopic(
  context: ChatterContextMessage[],
  messageThreadId: number | null,
  opts?: { senderType?: ChatterContextMessage["senderType"]; excludePlatformId?: string | null }
): ChatterContextMessage | null {
  for (let i = context.length - 1; i >= 0; i--) {
    const m = context[i];
    if ((m.messageThreadId ?? null) !== messageThreadId) continue;
    if (opts?.senderType && m.senderType !== opts.senderType) continue;
    if (opts?.excludePlatformId && m.senderPlatformId === opts.excludePlatformId) continue;
    return m;
  }
  return null;
}

/** A prior message only counts as "the room is mid an active exchange" if it
 *  happened recently. Without this, a moderator's last message from hours
 *  ago (simply because it's the last row in history) makes the runtime
 *  treat a brand-new opener sent much later as "already handled" and stay
 *  silent — a live-observed bug: "hey guys 👋" sent 95 minutes after the
 *  previous message (a moderator reply) was silenced with reason
 *  "already_handled" even though the room had gone completely quiet. */
export const RECENT_EXCHANGE_WINDOW_MS = 5 * 60_000;
export function isRecentMessage(createdAt: string | null | undefined, now: Date): boolean {
  if (!createdAt) return false;
  return now.getTime() - new Date(createdAt).getTime() < RECENT_EXCHANGE_WINDOW_MS;
}

// The 120-second "admin still likely engaged" window is now the SAME real,
// persisted wait the pending-reply scheduler itself uses -- see
// pending-reply.ts's PENDING_REPLY_DELAY_MS/isWithinPendingReplyWindow,
// which superseded this file's own earlier, narrower approximation
// (ADMIN_DEFERENCE_WINDOW_MS, a backward-looking-only recency check with no
// real scheduling behind it). One canonical 120s constant now governs both
// "is an admin recently active enough to count as handling this topic" and
// "how long an undirected Watcher reply actually waits before firing."

/** True only when a DIFFERENT human recently engaged the room -- NOT when
 *  the prior message is simply human, which would also match the same
 *  person's own earlier, unanswered message. Live bug: "anyone here?" right
 *  after the SAME person's own unanswered "yo! what's up" was silenced as
 *  already_handled, even though nothing had actually been handled -- the
 *  prior message just happened to also be human. A different person's prior
 *  message genuinely signals "the room organically engaged"; the same
 *  asker's own unanswered follow-up does not. */
export function humanRecentlyResponded(
  priorMessage: { senderType: string; senderPlatformId?: string | null; createdAt?: string | null } | null,
  currentSenderPlatformId: string,
  now: Date
): boolean {
  if (!priorMessage || priorMessage.senderType !== "HUMAN") return false;
  if (!isRecentMessage(priorMessage.createdAt, now)) return false;
  return priorMessage.senderPlatformId !== currentSenderPlatformId;
}

/** True if THIS deployment sent ANY message within the given recent-context
 *  window (not just the literal last one — see wasLastSpeaker for that
 *  narrower signal) and that message is still within the recency window
 *  (isRecentMessage). Drives ChatterCandidate.recentlyParticipated, which
 *  feeds ambient reaction eligibility (chatter-coordinator.ts) — a
 *  moderator that took part in the exchange a couple of turns ago, not only
 *  the very last message, is still socially relevant to react to a human's
 *  follow-up remark about it. */
export function deploymentRecentlyParticipated(recentContext: ChatterContextMessage[], deploymentId: string, now: Date): boolean {
  return recentContext.some((m) => m.senderType === "INNVIL_MODERATOR" && m.deploymentId === deploymentId && isRecentMessage(m.createdAt, now));
}

/** Moderation anti-repetition context (2026-09-04) -- the raw text of THIS
 *  specific deployment's own recent messages within `context`, used only to
 *  decide whether a freshly-generated warning reads as a near-duplicate of
 *  something this SAME Watcher already said (see link-moderation.ts's
 *  isNearDuplicateWarning / link-classify.ts's generatePersonaSolicitationWarning).
 *  Never affects WHETHER a violation is flagged/deleted/counted -- only
 *  candidate wording. Correctly scoped by construction, not by a runtime
 *  check: `context` is already loaded scoped to one specific community (the
 *  caller's own `loadRecentContext(admin, community.id, ...)`), and this
 *  filter further narrows it to one specific deployment -- a different
 *  Watcher's or a different Community's recent wording can never appear in
 *  the result. */
export function recentOwnModeratorMessages(context: ChatterContextMessage[], deploymentId: string): string[] {
  return context.filter((m) => m.senderType === "INNVIL_MODERATOR" && m.deploymentId === deploymentId).map((m) => m.text);
}

/* -------------------------------------------------- trial reactive quota ---- */
// Phase 4.M (B): 20 successfully-executed reactive conversational text
// responses (CASUAL_CHAT/ANSWER/SHORT_ACK) per community per local
// community day, trial only. No per-community timezone field exists
// anywhere in the schema yet (see migration 0050's header), so "local day"
// is a UTC calendar date for now -- revisit once real per-community
// timezone configuration exists.
export function reactiveQuotaDay(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/** Read-only check, done BEFORE any AI generation is attempted (spec §17) --
 *  never itself consumes quota. Only meaningful for trial entitlement;
 *  callers must gate on that first (paid tiers are out of scope, spec §2). */
export async function hasReactiveQuotaRemaining(admin: SupabaseClient, communityId: string, quotaDay: string): Promise<boolean> {
  const { data } = await admin
    .from("community_reactive_quota")
    .select("reactive_count")
    .eq("community_id", communityId)
    .eq("quota_day", quotaDay)
    .maybeSingle();
  return ((data as { reactive_count: number } | null)?.reactive_count ?? 0) < TRIAL_REACTIVE_DAILY_LIMIT;
}

/** Called ONLY after a reactive text response has actually been sent
 *  successfully -- atomic upsert-increment (migration 0050), avoiding a
 *  read-then-write race between concurrent webhook deliveries. Never blocks
 *  the send that's already happened; a race that pushes the count slightly
 *  past the limit is a harmless, bounded overshoot, not a correctness bug. */
export async function recordReactiveQuotaUse(admin: SupabaseClient, panelId: string | null, communityId: string, quotaDay: string): Promise<void> {
  await admin.rpc("increment_community_reactive_quota", { p_panel_id: panelId, p_community_id: communityId, p_quota_day: quotaDay });
}

/** The real, persisted count behind hasReactiveQuotaRemaining -- read-only,
 *  same query shape, exposed separately so a Usage surface can display
 *  actual consumption ("used / limit today") rather than only a boolean.
 *  Never a fabricated/estimated number -- zero rows (no reactive replies
 *  sent yet today) correctly reads as 0, not "unknown". */
export async function getCommunityReactiveQuotaUsage(admin: SupabaseClient, communityId: string, quotaDay: string): Promise<number> {
  const { data } = await admin
    .from("community_reactive_quota")
    .select("reactive_count")
    .eq("community_id", communityId)
    .eq("quota_day", quotaDay)
    .maybeSingle();
  return (data as { reactive_count: number } | null)?.reactive_count ?? 0;
}

/** Pure: turns a raw resolveMultiTargetAddress() result into the bounded set
 *  of ADDITIONAL responders that should independently reply alongside the
 *  primary. Excludes the primary (already answering — dedup-safety: the
 *  primary must never also run as an "additional" responder against itself)
 *  and caps at `maxAdditional` (default MAX_ADDITIONAL_RESPONDERS) regardless
 *  of how many the address resolved to (no-pile-on safety — a "you both" in a
 *  20-slot Pro panel must never fan out to 20 replies). The caller passes a
 *  SCALED cap instead for a genuine room-wide address ("everyone") — see
 *  roomWideResponderCount in chatter-coordinator.ts — since that invites the
 *  whole team, not a fixed small group. Order-preserving (deployments
 *  closest to the front of resolveMultiTargetAddress's result — e.g. a named
 *  list's own order — are kept over ones the cap would otherwise drop). */
export function resolveAdditionalResponderIds(primaryDeploymentId: string, multiTargets: string[], maxAdditional: number = MAX_ADDITIONAL_RESPONDERS): string[] {
  return multiTargets.filter((id) => id !== primaryDeploymentId).slice(0, Math.max(0, maxAdditional));
}

/* ------------------------------------------------- conversational task state ---- */
// Temporary, explicit multi-step shared activities ("let's all count, I'll
// start with 1..."). Normal chatter above stays turn-free by design; this is
// the SEPARATE mechanism for when a human establishes ordered/shared
// structure that must be remembered and enforced across messages. See
// task-state.ts for the pure state machine -- this section is purely
// persistence + orchestration around it. Persisted (migration 0052), never
// process memory, since a task spans multiple stateless webhook invocations.

interface TaskRecord {
  id: string;
  task: ConversationTask;
}

async function loadActiveTask(admin: SupabaseClient, communityId: string): Promise<TaskRecord | null> {
  const { data } = await admin
    .from("moderator_conversation_tasks")
    .select("id, state")
    .eq("community_id", communityId)
    .in("status", ["ACTIVE", "PAUSED"])
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string, task: data.state as ConversationTask };
}

/** A race with another webhook invocation creating a task for the same
 *  community at the same moment is resolved by the DB's OWN partial unique
 *  index (migration 0052) -- whichever insert loses simply gets a 23505 and
 *  is swallowed here; the winner's task is the community's one active task,
 *  never two silently coexisting ones. */
async function insertTask(admin: SupabaseClient, panelId: string | null, communityId: string, task: ConversationTask): Promise<void> {
  const { error } = await admin.from("moderator_conversation_tasks").insert({
    panel_id: panelId,
    community_id: communityId,
    status: task.status,
    state: task,
    created_from_message_id: task.createdFromMessageId,
  });
  if (error && error.code !== "23505") throw new Error(`insertTask failed: ${error.message}`);
}

async function persistTask(admin: SupabaseClient, id: string, task: ConversationTask): Promise<void> {
  await admin.from("moderator_conversation_tasks").update({ status: task.status, state: task }).eq("id", id);
}

async function logTaskActivity(admin: SupabaseClient, panelId: string | null, communityId: string, deploymentId: string | null, decision: string, reasonCode: string, meta: Record<string, unknown> = {}) {
  await logActivity(admin, panelId, communityId, deploymentId, "conversation_task", decision, reasonCode, meta);
}

/** Executes each consecutive MODERATOR turn the task now expects, in the
 *  SAME invocation that just advanced it (webhooks are one-shot, so a
 *  cascade of moderator turns -- e.g. Test's "2" immediately unlocking
 *  Kwan's "3" -- has to run serially here rather than waiting for a new
 *  inbound event that will never arrive on its own). Stops the moment the
 *  next expected participant is HUMAN (moderators wait, no "your turn"
 *  reminder is generated) or the task completes. NUMERIC turns are sent
 *  with ZERO LLM calls (the runtime already knows the exact required
 *  value); only FREEFORM turns call generateChatterReply, and even then
 *  never for anything the task itself can determine deterministically. */
async function runModeratorTaskCascade(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  chatId: string,
  deployments: ChatterDeployment[],
  record: TaskRecord,
  now: Date
): Promise<void> {
  let current = record;
  let iterations = 0;
  const safetyCap = current.task.participants.length + 2; // a full extra lap is never a legitimate cascade
  while (current.task.status === "ACTIVE" && expectedParticipant(current.task).kind === "MODERATOR" && iterations < safetyCap) {
    iterations++;
    const expected = expectedParticipant(current.task);
    const deployment = deployments.find((d) => d.deploymentId === expected.id);
    if (!deployment) break; // the expected moderator is no longer deployed -- stop rather than guessing who should stand in

    let outputText: string;
    if (current.task.progression.kind === "NUMERIC") {
      // Deterministic -- the runtime already knows the correct value, so it
      // is sent directly. No DeepSeek/Sonnet call for this branch at all.
      outputText = String(expectedNumericValue(current.task));
    } else {
      const generation = await generateChatterReply({
        action: "CASUAL_CHAT",
        selfDeploymentId: deployment.deploymentId,
        moderatorName: deployment.moderatorName,
        persona: deployment.persona,
        recentContext: await loadRecentContext(admin, communityId, 10),
        triggerMessage: { senderName: "the shared activity", text: "It's your turn in the group activity everyone agreed to." },
        isDirectedAtBot: true,
        addressedWithTypo: false,
        otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== deployment.deploymentId).map((d) => d.moderatorName),
      });
      // "escalate" is structurally unreachable here (this call is always
      // action: "CASUAL_CHAT", and ESCALATE_REQUIRED is only ever offered
      // to ANSWER's own prompt) -- guarded anyway so a future change can't
      // silently corrupt task state by treating an escalate result as a
      // real turn.
      if (!generation.ok || "noReply" in generation || "escalate" in generation || "mentionAdmin" in generation) break; // can't produce a turn right now -- leave the task exactly as-is, don't corrupt state
      outputText = generation.reply;
    }

    const sendAction: CommunityAction = {
      kind: "SEND_TEXT",
      text: outputText,
      targetDeploymentId: deployment.deploymentId,
      replyToMessageId: null,
      origin: "HUMAN",
      interactionDepth: 0,
      causationMessageId: null,
    };
    const sent = await executeAction(admin, chatId, sendAction);
    if (!sent.sentMessageId) break;
    await admin.from("community_messages").insert({
      panel_id: panelId,
      community_id: communityId,
      platform_message_id: sent.sentMessageId,
      sender_type: "INNVIL_MODERATOR",
      sender_platform_id: null,
      sender_display_name: deployment.moderatorName,
      deployment_id: deployment.deploymentId,
      text: outputText,
    });

    // The moderator's OWN just-sent output is what advances its own turn --
    // for NUMERIC this can never mismatch (it's exactly what was computed),
    // so this call effectively always returns ADVANCED or COMPLETED here.
    const result = advanceSequenceTask(current.task, { kind: "MODERATOR", id: deployment.deploymentId }, outputText, now);
    await persistTask(admin, current.id, result.task);
    await logTaskActivity(admin, panelId, communityId, deployment.deploymentId, result.outcome === "COMPLETED" ? "TASK_COMPLETED" : "TASK_ADVANCED", "moderator_turn", { taskId: current.id });
    current = { id: current.id, task: result.task };
    if (result.outcome !== "ADVANCED") break;
  }
}

/** Checked BEFORE ordinary chatter routing. Returns true when this human
 *  message was fully owned by conversational-task handling (control
 *  instruction, a turn contribution -- matching, mismatched, or
 *  irrelevant --, or newly creating a task) and the caller must NOT also
 *  run selectChatterAction for it: "task-local state wins unless the user
 *  explicitly changes the task" (product invariant) means an active task
 *  suppresses ordinary quietest-longest/continuity/multi-responder/ambient-
 *  reaction selection entirely for the duration it governs, not just for
 *  the specific participant whose turn it is. Returns false only when there
 *  is genuinely no task governing this message (none exists and this
 *  message didn't create one, or an existing one just expired), in which
 *  case the caller proceeds with the existing chatter pipeline unchanged. */
async function routeConversationTask(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string },
  chatId: string,
  event: CommunityEvent,
  deployments: ChatterDeployment[],
  now: Date
): Promise<boolean> {
  const communityId = community.id;
  let record = await loadActiveTask(admin, communityId);

  if (!record) {
    const moderatorIdentities: TaskModeratorIdentity[] = deployments.map((d) => ({ deploymentId: d.deploymentId, name: d.moderatorName }));
    const created = detectSequenceTaskIntent(event.text, moderatorIdentities, event.sender.platformUserId, now, event.messageId);
    if (!created) return false; // an ordinary message -- proceed with normal chatter
    await insertTask(admin, panelId, communityId, created);
    const inserted = await loadActiveTask(admin, communityId);
    if (!inserted) return true; // lost the creation race to a concurrent invocation -- the winner's task governs, not this message
    await logTaskActivity(admin, panelId, communityId, null, "TASK_CREATED", "sequence_detected", {
      taskId: inserted.id,
      participantCount: inserted.task.participants.length,
      end: inserted.task.progression.kind === "NUMERIC" ? inserted.task.progression.end : null,
    });
    // The SETUP message itself never counts as a turn contribution. If the
    // human put themself first (the common case), the task simply now
    // waits on them -- no reply to the setup message. If the first turn is
    // a moderator's (an unusual but valid setup), run its cascade now.
    if (expectedParticipant(inserted.task).kind === "MODERATOR") {
      await runModeratorTaskCascade(admin, panelId, communityId, chatId, deployments, inserted, now);
    }
    return true;
  }

  if (isTaskExpired(record.task, now)) {
    await persistTask(admin, record.id, { ...record.task, status: "EXPIRED" });
    await logTaskActivity(admin, panelId, communityId, null, "TASK_EXPIRED", "inactivity_ttl", { taskId: record.id });
    return false; // the task no longer governs -- fall through to ordinary chatter for this message
  }

  const instruction = classifyTaskInstruction(event.text);
  if (instruction) {
    let updated = record.task;
    let decision = "TASK_UPDATED";
    if (instruction === "CANCEL") { updated = cancelTask(record.task, now); decision = "TASK_CANCELLED"; }
    else if (instruction === "RESET") { updated = resetSequenceTask(record.task, now); decision = "TASK_UPDATED"; }
    else if (instruction === "PAUSE") { updated = pauseTask(record.task, now); decision = "TASK_PAUSED"; }
    else if (instruction === "RESUME") { updated = resumeTask(record.task, now); decision = "TASK_RESUMED"; }
    await persistTask(admin, record.id, updated);
    await logTaskActivity(admin, panelId, communityId, null, decision, instruction.toLowerCase(), { taskId: record.id });
    return true; // a control message is never ALSO evaluated as a turn contribution
  }

  const reordered = applyReorderInstruction(record.task, event.text);
  if (reordered !== record.task) {
    await persistTask(admin, record.id, reordered);
    await logTaskActivity(admin, panelId, communityId, null, "TASK_UPDATED", "reorder", { taskId: record.id });
    return true;
  }

  const result = advanceSequenceTask(record.task, { kind: "HUMAN", id: event.sender.platformUserId }, event.text, now);
  await persistTask(admin, record.id, result.task);
  if (result.outcome === "MISMATCH") {
    await logTaskActivity(admin, panelId, communityId, null, "TASK_MISMATCH", "wrong_value", { taskId: record.id });
    return true;
  }
  if (result.outcome === "NO_MATCH") {
    // Not this participant's turn, or content that doesn't match the
    // expected value/step -- silently ignored (e.g. "wait for me to start,
    // lol" while the human's own turn is pending). The task keeps waiting;
    // ordinary chatter is still suppressed (task-local state wins).
    return true;
  }
  if (result.outcome === "COMPLETED") {
    await logTaskActivity(admin, panelId, communityId, null, "TASK_COMPLETED", "end_reached", { taskId: record.id });
    return true;
  }
  await logTaskActivity(admin, panelId, communityId, null, "TASK_ADVANCED", "human_turn", { taskId: record.id, currentIndex: result.task.currentIndex });
  await runModeratorTaskCascade(admin, panelId, communityId, chatId, deployments, { id: record.id, task: result.task }, now);
  return true;
}

/* --------------------------------------------------------- link moderation ---- */
// Phase 4.M (C)-(F). Moderation asks a SEPARATE question from chatter (spec
// §18/§50): "does this message violate community policy?" — it runs
// independent of the reactive chatter quota (spec §45) for as long as a
// trial community's daily quota still has headroom left (checked once in
// handleHumanMessage, before this stage is ever reached), and needs no
// @mention (spec §46). Corrected 2026-09-03: once that daily quota is
// FULLY exhausted, moderation pauses alongside chatter for the rest of the
// day, rather than continuing to run forever independent of it — see the
// gate at the top of handleHumanMessage. See link-moderation.ts for the
// pure classification/policy layer this section persists state for and
// executes enforcement from.

async function loadLinkWarningState(admin: SupabaseClient, communityId: string, platformUserId: string): Promise<LinkWarningState> {
  const { data } = await admin
    .from("moderator_link_warning_state")
    .select("warning_count, warning_at, recent_link_hash, recent_link_at, recent_link_count_in_window, scam_strike_count, scam_strike_at, media_warning_count")
    .eq("community_id", communityId)
    .eq("platform_user_id", platformUserId)
    .maybeSingle();
  if (!data) return EMPTY_WARNING_STATE;
  return {
    warningCount: data.warning_count ?? 0,
    warningAt: data.warning_at ?? null,
    recentLinkHash: data.recent_link_hash ?? null,
    recentLinkAt: data.recent_link_at ?? null,
    recentLinkCountInWindow: data.recent_link_count_in_window ?? 0,
    scamStrikeCount: data.scam_strike_count ?? 0,
    scamStrikeAt: data.scam_strike_at ?? null,
    mediaWarningCount: data.media_warning_count ?? 0,
  };
}

async function persistLinkWarningState(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  platformUserId: string,
  state: LinkWarningState,
  violation: { kind: string; now: Date } | null
): Promise<void> {
  await admin.from("moderator_link_warning_state").upsert(
    {
      panel_id: panelId,
      community_id: communityId,
      platform_user_id: platformUserId,
      warning_count: state.warningCount,
      warning_at: state.warningAt,
      recent_link_hash: state.recentLinkHash,
      recent_link_at: state.recentLinkAt,
      recent_link_count_in_window: state.recentLinkCountInWindow,
      scam_strike_count: state.scamStrikeCount,
      scam_strike_at: state.scamStrikeAt,
      media_warning_count: state.mediaWarningCount,
      ...(violation ? { last_violation_at: violation.now.toISOString(), last_violation_kind: violation.kind } : {}),
    },
    { onConflict: "community_id,platform_user_id" }
  );
}

/** Same token-resolution shape as executeAction, exposed standalone for
 *  moderation's admin-role check (which needs a token BEFORE deciding which
 *  action, if any, to execute). Deliberately not refactored to share code
 *  with executeAction, to avoid touching that already-established path. */
async function getBotTokenForDeployment(admin: SupabaseClient, deploymentId: string): Promise<string | null> {
  const { data: deployment } = await admin.from("moderator_deployments").select("moderator_id").eq("id", deploymentId).maybeSingle();
  if (!deployment) return null;
  const { data: integration } = await admin.from("telegram_bot_integrations").select("id").eq("virtual_moderator_id", deployment.moderator_id).maybeSingle();
  if (!integration) return null;
  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  return (tokenData as string | null) ?? null;
}

/** Admins/trusted roles may legitimately post partner/AMA/campaign links
 *  (spec §43) — reuses Telegram's own membership status rather than
 *  inventing a parallel trust concept. Fails closed (not exempt) on any
 *  lookup error, since the exemption is a convenience, not a safety-
 *  relevant default. */
async function isSenderAdminOrTrusted(token: string, chatId: string, platformUserId: string): Promise<boolean> {
  // A synthesized "the channel itself posted this" identity is never a
  // real Telegram user id -- getChatMember would just fail for it (and
  // fail-closed to `false`, incorrectly treating a channel's own broadcast
  // as an untrusted stranger). Only a channel admin can post to a channel
  // at all, so this is trusted by construction, no live lookup needed.
  if (isSyntheticChannelSender(platformUserId)) return true;
  const res = await telegramApiCall<{ status: string }>(token, "getChatMember", { chat_id: chatId, user_id: platformUserId });
  if (!res.ok) return false;
  return res.result.status === "administrator" || res.result.status === "creator";
}

/** Checked BEFORE ordinary task/chatter routing (spec §18) for every human
 *  message, regardless of chatter entitlement/quota. Zero AI calls when the
 *  message contains no links at all (the overwhelming majority of ordinary
 *  chatter) — extractLinks is a cheap regex scan. `handled: true` means the
 *  message was DELETED (nothing left to task-route or chat about, so the
 *  caller must not do either); `collabRoutable: true` (only meaningful when
 *  `handled` is false) tells the caller this message may naturally mention
 *  the community's configured collab contact if ordinary chatter decides to
 *  reply to it at all — moderation itself never sends that reply, chatter's
 *  own existing selection/quota governs whether anything is said. */
export async function runLinkModeration(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string; project_id?: string | null; allow_solicitation?: boolean | null; promotion_channel_link?: string | null; promotion_channel_name?: string | null },
  chatId: string,
  event: CommunityEvent,
  deployments: ChatterDeployment[],
  now: Date,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING,
  roleAssignments: WatcherRoleAssignment[] = [],
  chatUsername: string | null = null
): Promise<{ handled: boolean; collabRoutable: boolean }> {
  if (!deployments.length) return { handled: false, collabRoutable: false };

  const links = extractLinks(event.text);
  // A bare mention of one of THIS community's own deployed Watcher bot
  // usernames is addressing, not a link/promotion candidate -- excluded
  // BEFORE anything else runs, using the SAME trusted runtime bot identity
  // (ChatterDeployment.botUsername, sourced from telegram_bot_integrations)
  // every other addressing/routing decision already reads. Never a
  // hardcoded username, never a manual whitelist -- and scoped to only THIS
  // community's own deployments, so it never trusts a username globally.
  // Any OTHER link/handle in the same message (a real phishing URL, an
  // unrelated external @handle) is left untouched and still evaluated below
  // -- this narrowly exempts the self-mention, never the whole message.
  const moderationCandidates = links.length ? filterOutOwnBotMentions(links, deployments.map((d) => d.botUsername)) : [];
  const hasRealLinkCandidate = moderationCandidates.length > 0;
  // Live-caught gap: a promotional pitch with NO link/handle at all ("DM me,
  // I can promote your project...") never matched any of the above, so it
  // silently bypassed moderation entirely and fell through to ordinary
  // chatter, which just socially commented on it instead of removing it.
  // looksLikeUnsolicitedPitch is a cheap, narrow, ENGLISH-ONLY gate (never
  // the verdict itself) -- classifyLinkIntent + decideLinkEnforcement still
  // make the real decision below, exactly as for a link-bearing message.
  // Also covers the SEARCH_SPAM pre-filter (2026-09-03) -- an off-topic
  // "search X" instruction has no link/handle/contact-ask at all either, so
  // it needs the same link-less gate to even reach classification.
  let isTextModerationCandidate = !hasRealLinkCandidate && (looksLikeUnsolicitedPitch(event.text) || looksLikeSearchInstructionSpam(event.text));
  // Language-agnostic backstop, only reached when the free regex already
  // said no -- a real pitch in Russian/Chinese/any other language has no
  // English vocabulary for the regex to match, no matter how that list
  // keeps growing. Skipped for anything too short to plausibly be a real
  // pitch sentence (an ordinary short chat message never needs an AI call
  // here) and bounded by the same request-budget pattern as the ambient-
  // greeting fallback -- a timeout or failure just means "not flagged",
  // never an escalation.
  if (!hasRealLinkCandidate && !isTextModerationCandidate && event.text.trim().length >= PITCH_CLASSIFY_MIN_LENGTH) {
    const pitchClassify = await raceWithTimeout(classifyPitchLikelihood(event.text, aiRouting), PITCH_CLASSIFY_BUDGET_MS);
    if (pitchClassify.ok && pitchClassify.value.ok && pitchClassify.value.isPitch) isTextModerationCandidate = true;
  }
  if (!hasRealLinkCandidate && !isTextModerationCandidate) return { handled: false, collabRoutable: false };

  // Spam & Scam Moderator owns link/phishing/scam moderation events end to
  // end (see watcher-roles.ts) -- detection AND every resulting action
  // (delete/warn/mute/kick/ban) execute under THIS SAME deployment, never
  // handed off to a different domain regardless of severity. Replaces the
  // old arbitrary deployments[0] pick.
  const enforcer = resolveModerationEnforcer(deployments, roleAssignments, "spam_scam");
  const senderPlatformId = event.sender.platformUserId;

  const priorState = await loadLinkWarningState(admin, community.id, senderPlatformId);
  // Flood-repeat tracking is inherently about the SAME link being reposted
  // rapidly -- a link-less text pitch has nothing to hash/repost-track, so
  // it's left out of the flood-window observation entirely (repeat text
  // pitches still escalate normally via the ordinary warningCount-based
  // 3-strike progression in decideLinkEnforcement, unrelated to flood
  // detection).
  const observedState = hasRealLinkCandidate ? recordLinkObservation(priorState, linkHash(moderationCandidates[0]), now) : priorState;
  // Never derived from stale prior-link flood state for a text-only pitch --
  // isFloodRepeat would otherwise read leftover flood-window data from an
  // EARLIER, unrelated real link this same sender once posted.
  const floodRepeat = hasRealLinkCandidate ? isFloodRepeat(observedState) : false;

  const linkModerationContext = await loadRecentContext(admin, community.id, 8);
  const recentContextSummary = linkModerationContext.map((m) => `${m.senderName ?? "Someone"}: ${m.text}`).join("\n");
  const classification = await classifyLinkIntent(event.text, recentContextSummary, aiRouting);

  // SEARCH_SPAM's own "coordinated vs. isolated" signal (2026-09-03 live
  // feedback) -- the current message has already been recorded into
  // community_messages by the time this runs (recordCommunityMessage's
  // claim happens earlier in the pipeline), so it's typically the LAST
  // entry in linkModerationContext -- excluded here by its own platform
  // message id (never by array position alone) so this is correct
  // regardless of ordering edge cases. The result only matters once
  // `enforcement.reason` is actually search-spam-related, computed either
  // way since it's a pure, cheap, no-I/O check.
  const priorRoomMessages = linkModerationContext.filter((m) => m.platformMessageId !== event.messageId);
  const precedingRoomMessage = priorRoomMessages.length ? priorRoomMessages[priorRoomMessages.length - 1] : null;
  const isCoordinatedSearchSpam = isBackToBackSpamPattern(precedingRoomMessage, now);

  const token = await getBotTokenForDeployment(admin, enforcer.deploymentId);
  const isAdminOrTrusted = token ? await isSenderAdminOrTrusted(token, chatId, senderPlatformId) : false;

  // Gap 3 deterministic backstop: was THIS message directly solicited by a
  // real, recent admin/mod request ("send me your project link")? Only
  // ever checked when a plausible request-shaped message actually exists
  // in the recent window (findRecentAdminInformationRequest is pure/cheap)
  // -- the extra Telegram admin-status lookup only runs on that ONE
  // candidate, never on every message in the window.
  let adminSolicitedExemption = false;
  const requestCandidate = findRecentAdminInformationRequest(
    linkModerationContext.map((m) => ({
      senderType: m.senderType, text: m.text, createdAt: m.createdAt, senderPlatformId: m.senderPlatformId,
      platformMessageId: m.platformMessageId, replyToPlatformMessageId: m.replyToPlatformMessageId,
    })),
    now
  );
  if (requestCandidate && (requestCandidate.targetPlatformUserId == null || requestCandidate.targetPlatformUserId === senderPlatformId)) {
    const requesterId = requestCandidate.candidate.senderPlatformId;
    adminSolicitedExemption = requesterId && token ? await isSenderAdminOrTrusted(token, chatId, requesterId) : false;
  }

  const priorScamStrikeCount = effectiveScamStrikeCount(priorState.scamStrikeCount, priorState.scamStrikeAt, now);

  // Solicitation is allowed either via the community-WIDE toggle, or when
  // this message was posted in a topic the owner has explicitly assigned
  // the "promotion" POLICY (watch_community_topics, keyed by the stable
  // Telegram message_thread_id, never the display name) -- always allowed
  // THERE regardless of whether the community-wide toggle is on or off. A
  // non-forum chat (event.messageThreadId is null) can never match a real
  // topic, so this is a pure no-op for the common non-topic case.
  const topics = await loadCommunityTopics(admin, community.id);
  const currentTopic = findCommunityTopic(topics, event.messageThreadId);
  const promotionTopic = findPromotionTopic(topics);
  const solicitationAllowedHere = community.allow_solicitation === true || topicAllowsSolicitation(currentTopic?.policy);

  const enforcement = decideLinkEnforcement({
    category: classification.category,
    confidence: classification.confidence,
    isAdminOrTrusted,
    floodRepeat,
    priorWarningCount: effectiveWarningCount(priorState.warningCount, priorState.warningAt, now),
    priorScamStrikeCount,
    solicitationAllowed: solicitationAllowedHere,
    adminSolicitedExemption,
  });

  await logActivity(admin, panelId, community.id, enforcer.deploymentId, "link_moderation", enforcement.kind, classification.category, {
    confidence: classification.confidence,
    floodRepeat,
    isAdminOrTrusted,
    scamStrikeCount: priorScamStrikeCount,
  });

  if (enforcement.kind === "ALLOW") {
    // Still persist the flood-window observation (needed for the NEXT
    // message's flood detection) -- but never touch warningCount/scam
    // strike state on an ALLOW.
    await persistLinkWarningState(
      admin, panelId, community.id, senderPlatformId,
      { ...observedState, warningCount: priorState.warningCount, warningAt: priorState.warningAt, scamStrikeCount: priorState.scamStrikeCount, scamStrikeAt: priorState.scamStrikeAt },
      null
    );
    return { handled: false, collabRoutable: COLLAB_ROUTABLE_CATEGORIES.has(classification.category) };
  }

  const isScamEnforcement = enforcement.reason === "scam_or_phishing" || enforcement.reason === "repeated_scam_or_phishing";

  // DELETE_WARN, DELETE_KICK, or DELETE_BAN from here -- the message is
  // being removed FIRST (spec: "the original malicious link should
  // disappear as quickly as possible"), so nothing further should try to
  // task-route or chat about its now-gone content.
  if (token) {
    const deleteResult = await executeAction(admin, chatId, { kind: "DELETE_MESSAGE", targetDeploymentId: enforcer.deploymentId, targetMessageId: event.messageId });
    if (!deleteResult.ok) console.error("[telegram/community] link moderation DELETE_MESSAGE failed", deleteResult.error);
  }

  if (enforcement.kind === "DELETE_BAN") {
    if (token) {
      const banResult = await executeAction(admin, chatId, { kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: senderPlatformId, mode: "BAN" });
      if (!banResult.ok) console.error("[telegram/community] link moderation RESTRICT_USER failed", banResult.error);
    }
    const nextState: LinkWarningState = isScamEnforcement
      ? { ...observedState, scamStrikeCount: priorScamStrikeCount + 1, scamStrikeAt: now.toISOString() }
      : observedState;
    await persistLinkWarningState(admin, panelId, community.id, senderPlatformId, nextState, { kind: enforcement.reason, now });
    return { handled: true, collabRoutable: false };
  }

  if (enforcement.kind === "DELETE_KICK") {
    // REMOVES the user (kick), never a permanent ban on its own (see
    // event-types.ts's RESTRICT_USER doc comment) -- reached for the 2nd
    // confirmed scam offense, the 3rd spam violation, or a confirmed
    // high-confidence explicit link, all now with a message purge.
    let kickFailed = false;
    let kickError: string | undefined;
    if (token) {
      const kickResult = await executeAction(admin, chatId, { kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: senderPlatformId, mode: "KICK" });
      if (!kickResult.ok) {
        console.error("[telegram/community] link moderation RESTRICT_USER (kick) failed", kickResult.error);
        kickFailed = true;
        kickError = kickResult.error;
      }
    }
    // Strike is recorded regardless of whether the kick itself succeeded --
    // per spec "Kick failure: preserve the strike" (a duplicate webhook
    // delivery of the SAME message never reaches here a second time at
    // all, since recordCommunityMessage's claim already made this whole
    // function run at most once per real message).
    const nextState: LinkWarningState = isScamEnforcement
      ? { ...observedState, scamStrikeCount: priorScamStrikeCount + 1, scamStrikeAt: now.toISOString() }
      : { ...observedState, warningCount: effectiveWarningCount(priorState.warningCount, priorState.warningAt, now) + 1, warningAt: now.toISOString() };
    await persistLinkWarningState(admin, panelId, community.id, senderPlatformId, nextState, { kind: enforcement.reason, now });

    let purgeResult: { attempted: number; purged: number; failed: boolean } = { attempted: 0, purged: 0, failed: false };
    if (enforcement.purge && token && !kickFailed) {
      purgeResult = await purgeUserMessages(admin, chatId, community.id, senderPlatformId, enforcer.deploymentId, now);
    }

    // The scam-repeat public warning stays exactly as before (deterministic,
    // never AI, never reproduces the URL); a spam/promotion or
    // explicit-link kick has no equivalent public message today (matches
    // the existing convention that only scam kicks announce themselves in
    // the community) -- the Watcher Ops report below is where every kick
    // is actually recorded regardless.
    if (isScamEnforcement) {
      const mention = renderHumanModerationMention(senderPlatformId, event.sender.username ?? null, event.sender.displayName);
      const warningText = scamRepeatOffenseWarningHtml(mention);
      if (token) {
        const sendResult = await executeAction(admin, chatId, {
          kind: "SEND_TEXT", text: warningText, targetDeploymentId: enforcer.deploymentId, replyToMessageId: null,
          origin: "HUMAN", interactionDepth: 0, causationMessageId: event.messageId, parseMode: "HTML",
        });
        if (sendResult.sentMessageId) {
          await admin.from("community_messages").insert({
            panel_id: panelId, community_id: community.id, platform_message_id: sendResult.sentMessageId,
            sender_type: "INNVIL_MODERATOR", sender_platform_id: null, sender_display_name: enforcer.moderatorName,
            deployment_id: enforcer.deploymentId, text: warningText,
          });
        }
      }
    }

    if (community.project_id) {
      const violationCategory: ModerationViolationCategory = isScamEnforcement
        ? "scam_link"
        : enforcement.reason === "explicit_content"
          ? "explicit_link"
          : enforcement.reason === "repeated_competing_project_promotion"
            ? "competing_project"
            : enforcement.reason === "repeated_search_spam"
              ? "off_topic_spam"
              : "spam";
      await sendModerationReport({
        admin, projectId: community.project_id, sourceCommunityId: community.id, watcherId: enforcer.moderatorId,
        platformUserId: senderPlatformId, username: event.sender.username ?? null, displayName: event.sender.displayName,
        event: {
          userMention: renderHumanModerationMention(senderPlatformId, event.sender.username ?? null, event.sender.displayName),
          violationCategory, warningNumber: null, warningLimit: null, muteMinutes: null,
          actionsTaken: enforcement.purge ? ["kick", "message_purge"] : ["kick"],
          reasonText: isScamEnforcement
            ? "Repeated confirmed scam/phishing link after a prior warning."
            : violationCategory === "explicit_link"
              ? "User posted a confirmed high-confidence explicit/malicious link."
              : violationCategory === "competing_project"
                ? "Repeated rallying to promote a different, unrelated project or token after prior warnings."
                : violationCategory === "off_topic_spam"
                  ? "Repeated off-topic spam instruction (unrelated to this project) after prior warnings."
                  : "Repeated spam after prior warnings and temporary restrictions.",
          previousEnforcementSummary: [],
          purgedCount: enforcement.purge ? purgeResult.purged : null,
          purgeFailed: enforcement.purge ? purgeResult.failed : false,
          purgeFailureReason: enforcement.purge && purgeResult.failed ? "The Watcher does not currently have permission to remove older messages." : null,
          telegramActionFailed: kickFailed,
          telegramFailureReason: kickFailed ? (kickError ?? "The Watcher does not currently have permission to remove members.") : null,
        },
      });
    }

    return { handled: true, collabRoutable: false };
  }

  // DELETE_WARN -- either ordinary unsolicited-promotion/spam escalation
  // (AI-phrased, unchanged, with a deterministic mute-duration sentence
  // appended) or a FIRST confirmed scam/phishing offense (deterministic/
  // template-based ONLY -- never a model call, never reproduces the
  // malicious URL).
  const nextState: LinkWarningState = isScamEnforcement
    ? { ...observedState, scamStrikeCount: priorScamStrikeCount + 1, scamStrikeAt: now.toISOString() }
    : { ...observedState, warningCount: enforcement.warningNumber, warningAt: now.toISOString() };
  await persistLinkWarningState(admin, panelId, community.id, senderPlatformId, nextState, { kind: enforcement.reason, now });

  // Every DELETE_WARN now explicitly mentions the offender -- deterministic
  // in both cases (never AI-decided formatting): the scam template embeds
  // it directly; the ordinary unsolicited-promotion warning keeps its
  // EXISTING AI-phrased body (unchanged generation logic, per explicit
  // "don't rewrite detection/generation unless required") and is prefixed
  // with the SAME mention mechanism deterministically, never asking the
  // model to compose or format the mention itself. A mute duration, when
  // this violation includes one, is likewise ALWAYS a deterministic
  // sentence appended after the model's own text -- the exact number must
  // never be left to the model to state.
  // For an ordinary (non-scam) promotion warning, direct the offender to the
  // Project's own configured Partnerships contact -- the same structured
  // contact preset already used to answer a genuine "who do I contact about
  // a partnership?" question (project-profile.ts). Reused verbatim, never a
  // second contact model. Deterministic, appended AFTER the model's own
  // generated text -- same discipline as the mute-duration sentence above:
  // an exact fact (a real handle/email) must never be left to the model to
  // state or invent. Omitted entirely when the Project has no partnerships
  // contact configured -- never fabricates one.
  const isPromotionEnforcement = enforcement.reason === "unsolicited_promotion" || enforcement.reason === "repeated_unsolicited_promotion";
  // "Global no-go" (2026-09-02): promoting a DIFFERENT, specifically named
  // project/token is never redirected anywhere, even to this community's
  // OWN real configured Promotion destination/contact -- isPromotionEnforcement
  // above deliberately stays scoped to ordinary unsolicited_promotion only,
  // so promotionContact already correctly resolves to null for this reason
  // with no extra guard needed here.
  const isCompetingProjectEnforcement = enforcement.reason === "competing_project_promotion" || enforcement.reason === "repeated_competing_project_promotion";
  // SEARCH_SPAM (2026-09-03): an off-topic "search X" instruction, flagged
  // as spam -- never a project pitch, so it never has a Promotion/contact
  // redirect either, same treatment as isCompetingProjectEnforcement.
  const isSearchSpamEnforcement = enforcement.reason === "search_spam" || enforcement.reason === "repeated_search_spam";
  const promotionContact = isPromotionEnforcement && community.project_id
    ? (await loadProjectProfileRow(admin, community.project_id))?.contacts?.partnerships ?? null
    : null;
  const mention = renderHumanModerationMention(senderPlatformId, event.sender.username ?? null, event.sender.displayName);
  // A Forum-topic-based Promotion redirect only applies to a chat that
  // actually HAS Telegram Forum topics -- an ordinary (non-Forum) group has
  // no such structure (message_thread_id is always null there), so
  // promotionTopic can never resolve for one. `promotion_channel_name` is
  // the manually-configured fallback for exactly that case (a separate
  // Telegram destination, e.g. a dedicated promotions group), also used
  // when a Forum-based Promotion topic exists but has no KNOWN real name
  // (see hasKnownTopicName below).
  //
  // CRITICAL, corrected per live feedback (2026-09-02): "it should not send
  // the promotion link, it should say promotion" -- the redirect is ALWAYS
  // spoken BY NAME ONLY. A raw link/URL is never surfaced in the generated
  // warning text at all anymore, from any source, regardless of whether one
  // is technically available (buildTopicLink/promotion_channel_link) --
  // there is deliberately no `redirectLink`/`promotionTopicLink` value fed
  // into the warning generator anymore.
  //
  // Also corrected: `promotionTopic`'s own auto-observed name must never be
  // trusted as a real, statable name unless hasKnownTopicName confirms one
  // is actually known. Telegram only ever reports a topic's real name via a
  // forum_topic_created/edited service message -- when the bot never
  // observed one (e.g. the topic already existed before the bot joined),
  // `topicDisplayName` falls back to a generic placeholder ("this topic")
  // that reads fine as plain PROSE ("no promos in this topic") but is NOT a
  // real name -- handing that placeholder to the AI generator as if it WERE
  // a nameable destination produced a nonsensical warning literally quoting
  // "this topic" as a place ("it's called 'this topic'"). When no real name
  // is known for the Forum topic, this now falls through to the plain-
  // community `promotion_channel_name` fallback exactly as if the Forum
  // topic didn't exist at all (never states a fake name) -- which is why
  // the owner needs a real way to type in a name for that specific topic;
  // see CommunityTopicPolicies.tsx's per-topic custom-name field, backed by
  // watch_community_topics.custom_name (migration 0124).
  //
  // Forced to null for a competing-project violation regardless of what's
  // actually configured -- see isCompetingProjectEnforcement above and
  // generatePersonaSolicitationWarning's own isCompetingProjectPromotion
  // handling, which never surfaces a redirect for this reason either way.
  const knownPromotionTopicName = promotionTopic && hasKnownTopicName(promotionTopic) ? topicDisplayName(promotionTopic) : null;
  const redirectName = (isCompetingProjectEnforcement || isSearchSpamEnforcement) ? null : knownPromotionTopicName || community.promotion_channel_name || null;
  // "isolated" | "coordinated" | undefined -- see isBackToBackSpamPattern's
  // own doc comment (link-moderation.ts). Only ever set for SEARCH_SPAM;
  // undefined for every other category, matching generatePersonaSolicitation
  // Warning's own contract.
  const searchSpamPattern = isSearchSpamEnforcement ? (isCoordinatedSearchSpam ? "coordinated" as const : "isolated" as const) : undefined;
  // Solicitation warnings are now PERSONA-VOICED (per explicit live product
  // feedback: "the way it says a warning is too generic... it should be
  // persona based, not a generic bot warning") -- every stated fact (the
  // current topic's real name, the exact mute duration when one applies,
  // the real configured redirect destination, the real configured contact)
  // is still deterministic and required, never left to the model to invent
  // -- see generatePersonaSolicitationWarning's own doc comment. Falls back
  // to the exact previous deterministic template on any generation failure.
  //
  // Anti-repetition context (2026-09-04, live feedback: a Watcher was
  // producing near-identical warnings across different offenders): reuses
  // the SAME already-loaded linkModerationContext (no new query), via
  // recentOwnModeratorMessages -- see its own doc comment for the scoping
  // guarantee.
  const recentOwnWarnings = recentOwnModeratorMessages(linkModerationContext, enforcer.deploymentId);
  const generatedWarning = await generatePersonaSolicitationWarning(
    enforcer.moderatorName,
    enforcer.persona,
    {
      currentTopicName: topicDisplayName(currentTopic),
      muteMinutes: enforcement.muteMinutes,
      promotionTopicName: redirectName,
      // Never speak a raw link in the warning text -- see the doc
      // comment on redirectName above.
      promotionTopicLink: null,
      contactHandle: promotionContact,
      isCompetingProjectPromotion: isCompetingProjectEnforcement,
      searchSpamPattern,
      warningNumber: enforcement.warningNumber,
    },
    aiRouting,
    recentOwnWarnings
  );
  // A coordinated (multi-account) SEARCH_SPAM burst is deliberately never
  // addressed to a specific person (live feedback: "if 2 messages followed
  // each other, the warning should be only general please stop spamming")
  // -- the mention prefix is omitted entirely for that one case; every
  // other category (incl. an ISOLATED SEARCH_SPAM occurrence) keeps the
  // existing explicit mention, unchanged.
  const warningText = isScamEnforcement
    ? scamFirstOffenseWarningHtml(mention)
    : searchSpamPattern === "coordinated"
      ? generatedWarning
      : `${mention}, ${generatedWarning}`;
  if (token) {
    const sendResult = await executeAction(admin, chatId, {
      kind: "SEND_TEXT",
      text: warningText,
      targetDeploymentId: enforcer.deploymentId,
      replyToMessageId: null,
      origin: "HUMAN",
      interactionDepth: 0,
      causationMessageId: event.messageId,
      parseMode: "HTML",
    });
    if (sendResult.sentMessageId) {
      await admin.from("community_messages").insert({
        panel_id: panelId,
        community_id: community.id,
        platform_message_id: sendResult.sentMessageId,
        sender_type: "INNVIL_MODERATOR",
        sender_platform_id: null,
        sender_display_name: enforcer.moderatorName,
        deployment_id: enforcer.deploymentId,
        text: warningText,
      });
    }
  }

  // The mute itself (a REAL Telegram restriction, separate from the SEND_TEXT
  // warning above) -- executed whenever this violation includes one,
  // regardless of category.
  let muteFailed = false;
  let muteError: string | undefined;
  if (enforcement.muteMinutes && token) {
    const muteResult = await executeAction(admin, chatId, {
      kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: senderPlatformId, mode: "MUTE", muteMinutes: enforcement.muteMinutes,
    });
    if (!muteResult.ok) {
      console.error("[telegram/community] link moderation RESTRICT_USER (mute) failed", muteResult.error);
      muteFailed = true;
      muteError = muteResult.error;
    }
  }

  if (community.project_id) {
    const violationCategory: ModerationViolationCategory = isScamEnforcement
      ? "scam_link"
      : isCompetingProjectEnforcement
        ? "competing_project"
        : isSearchSpamEnforcement
          ? "off_topic_spam"
          : "spam";
    await sendModerationReport({
      admin, projectId: community.project_id, sourceCommunityId: community.id, watcherId: enforcer.moderatorId,
      platformUserId: senderPlatformId, username: event.sender.username ?? null, displayName: event.sender.displayName,
      event: {
        userMention: mention,
        violationCategory,
        warningNumber: enforcement.warningNumber,
        warningLimit: isScamEnforcement ? 1 : SOLICITATION_WARNING_LIMIT,
        muteMinutes: enforcement.muteMinutes ?? null,
        actionsTaken: enforcement.muteMinutes ? ["warning", "temporary_mute"] : ["warning"],
        reasonText: isScamEnforcement
          ? "First confirmed scam/phishing link from this member."
          : isCompetingProjectEnforcement
            ? (enforcement.warningNumber === 1
                ? "First confirmed rally/request to promote a different, unrelated project or token."
                : "Repeated rallying to promote a different, unrelated project or token after a prior warning.")
            : isSearchSpamEnforcement
              ? (enforcement.warningNumber === 1
                  ? `First confirmed off-topic spam instruction, unrelated to this project${searchSpamPattern === "coordinated" ? " (part of a coordinated multi-account pattern)" : ""}.`
                  : "Repeated off-topic spam instruction after a prior warning.")
              : enforcement.warningNumber === 1
                ? "First confirmed spam/unsolicited-promotion violation."
                : "Repeated spam/unsolicited-promotion after a prior warning.",
        previousEnforcementSummary: [],
        purgedCount: null, purgeFailed: false, purgeFailureReason: null,
        telegramActionFailed: muteFailed,
        telegramFailureReason: muteFailed ? (muteError ?? "The Watcher does not currently have permission to restrict members.") : null,
      },
    });
  }

  return { handled: true, collabRoutable: false };
}

/* -------------------------------------------------------- media moderation ---- */
// Direct photo/video NSFW detection -- extends the SAME ModerationEnforcement
// abstraction runLinkModeration uses above (media-moderation.ts), rather than
// a second competing moderation engine. A SEPARATE decision from Natural
// Chatter/link moderation: never routes through DeepSeek/Claude conversational
// paths, only the specialized visual-safety classifier (media-safety-provider.ts).

/** A media processing cap tighter than Telegram's own 20MB getFile ceiling --
 *  untrusted uploads shouldn't be downloaded up to the platform maximum by
 *  default. */
const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const MEDIA_MAX_VIDEO_DURATION_S = 5 * 60; // 5 minutes -- longer videos are skipped as unsupported, never downloaded

export interface DetectedMedia {
  kind: MediaKind;
  fileId: string;
  fileUniqueId: string;
  fileSize: number | null;
  durationS: number | null;
  mimeType: string | null;
}

/** Recognizes Telegram's own typed media fields (photo/video/animation) plus
 *  a document ONLY when Telegram's own reported mime_type identifies it as
 *  an image/video -- never based on filename/extension alone (spec: "do not
 *  blindly process arbitrary documents based only on an untrusted filename
 *  extension"). */
export function detectSupportedMedia(message: TelegramMessage): DetectedMedia | null {
  if (message.photo && message.photo.length > 0) {
    // Telegram sends smallest-first; the LAST entry is the highest
    // resolution without needing to compare/fetch every variant.
    const largest = message.photo[message.photo.length - 1];
    return { kind: "photo", fileId: largest.file_id, fileUniqueId: largest.file_unique_id, fileSize: largest.file_size ?? null, durationS: null, mimeType: "image/jpeg" };
  }
  if (message.video) {
    return { kind: "video", fileId: message.video.file_id, fileUniqueId: message.video.file_unique_id, fileSize: message.video.file_size ?? null, durationS: message.video.duration ?? null, mimeType: message.video.mime_type ?? "video/mp4" };
  }
  if (message.animation) {
    return { kind: "animation", fileId: message.animation.file_id, fileUniqueId: message.animation.file_unique_id, fileSize: message.animation.file_size ?? null, durationS: message.animation.duration ?? null, mimeType: message.animation.mime_type ?? "video/mp4" };
  }
  if (message.document?.mime_type?.startsWith("image/")) {
    return { kind: "photo", fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, fileSize: message.document.file_size ?? null, durationS: null, mimeType: message.document.mime_type };
  }
  if (message.document?.mime_type?.startsWith("video/")) {
    return { kind: "video", fileId: message.document.file_id, fileUniqueId: message.document.file_unique_id, fileSize: message.document.file_size ?? null, durationS: null, mimeType: message.document.mime_type };
  }
  return null;
}

type MediaDedupEnforcementKind = "ALLOW" | "DELETE_WARN" | "DELETE_KICK" | "DELETE_BAN";

async function loadMediaDedup(admin: SupabaseClient, communityId: string, fileUniqueId: string): Promise<{ enforcementKind: MediaDedupEnforcementKind } | null> {
  const { data } = await admin.from("moderator_media_dedup").select("enforcement_kind").eq("community_id", communityId).eq("file_unique_id", fileUniqueId).maybeSingle();
  if (!data) return null;
  return { enforcementKind: data.enforcement_kind as MediaDedupEnforcementKind };
}

async function recordMediaDedup(admin: SupabaseClient, panelId: string | null, communityId: string, fileUniqueId: string, verdict: "safe" | "uncertain" | "explicit" | "error", enforcementKind: MediaDedupEnforcementKind) {
  await admin.from("moderator_media_dedup").upsert(
    { panel_id: panelId, community_id: communityId, file_unique_id: fileUniqueId, verdict, enforcement_kind: enforcementKind },
    { onConflict: "community_id,file_unique_id" }
  );
}

/** Pure -- the trial's own Media Moderation Units "period" (its real,
 *  one-time started_at/ends_at, never a recurring monthly window like a
 *  paid subscription's), or null when there's no active trial to derive one
 *  from. Kept separate from resolveAccountBillingPeriod (which reads
 *  product_entitlements -- a table a trial account has no row in at all)
 *  so a trial's real dates are used instead of silently resolving to
 *  "no period, unmetered". */
export function trialMediaModerationPeriod(trial: ModeratorTrialState): { start: string; end: string } | null {
  return trial.active && trial.startedAt && trial.endsAt ? { start: trial.startedAt, end: trial.endsAt } : null;
}

/** Same overall shape as runLinkModeration: a SEPARATE moderation decision,
 *  checked once per message via a SINGLE enforcer (the community's Media
 *  Safety Moderator role-holder, see watcher-roles.ts -- the SAME single-
 *  coordinated-actor pattern link moderation already uses, so an explicit
 *  upload never produces one action per deployed moderator). `handled:
 *  true` means the message was deleted (nothing left to task-route/chat
 *  about). */
async function runMediaModeration(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string; project_id?: string | null },
  chatId: string,
  message: TelegramMessage,
  event: CommunityEvent,
  deployments: ChatterDeployment[],
  settings: unknown,
  now: Date,
  accountId: string | null = null,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING,
  // REVISED (2026-08-27, trial capped 2026-09-02): the account's real,
  // unconditionally-included Media Moderation Units base allowance for its
  // current Watch plan -- self-serve tier, byo20, any Enterprise variant,
  // or the Free Trial's own TRIAL_MEDIA_MODERATION_ALLOWANCE -- resolved
  // ONCE by the caller (a plain constant lookup, no I/O). `null` means this
  // account has no representable Watch plan at all (a legacy Panel-
  // distributed deployment), which keeps running media moderation
  // completely unmetered, exactly as before this gate existed. Supersedes
  // the old `bundledMediaAddon`/per-tier-purchase-gate model -- see
  // money.ts's MEDIA_MODERATION_BASE_ALLOWANCE for the full rationale.
  mediaBaseAllowance: number | null = null,
  roleAssignments: WatcherRoleAssignment[] = []
): Promise<{ handled: boolean }> {
  if (!virtualModMediaModeration(settings) || !deployments.length) return { handled: false };

  // Media Safety Moderator owns media moderation events end to end (see
  // watcher-roles.ts) -- detection AND every resulting action (delete/
  // warn/mute/kick/ban) execute under THIS SAME deployment, never handed
  // off to a different domain regardless of severity. Replaces the old
  // arbitrary deployments[0] pick. Used for every log/enforcement call
  // below, including the early skip-logs.
  const roleEnforcer = resolveModerationEnforcer(deployments, roleAssignments, "media_safety");

  const media = detectSupportedMedia(message);
  if (!media) return { handled: false };

  // Cost-saving dedup only (spec: "prevent unnecessary duplicate
  // processing") -- genuine Telegram webhook retries are ALREADY fully
  // covered upstream by isDuplicateUpdate's per-update dedup before this
  // function is ever reached; this is purely "don't reclassify the exact
  // same file content if reposted as a distinct message". Known, accepted
  // limitation: does not track classifier/policy version, so a provider or
  // threshold change won't retroactively reclassify an already-cached file
  // -- acceptable for a v1 per the "keep this simple" instruction.
  const cached = await loadMediaDedup(admin, community.id, media.fileUniqueId);
  if (cached) return { handled: cached.enforcementKind !== "ALLOW" };

  if (media.fileSize && media.fileSize > MEDIA_MAX_BYTES) {
    await recordMediaDedup(admin, panelId, community.id, media.fileUniqueId, "error", "ALLOW");
    await logActivity(admin, panelId, community.id, roleEnforcer.deploymentId, "media_moderation", "SKIPPED", "too_large", { mediaKind: media.kind, fileSize: media.fileSize });
    return { handled: false };
  }
  if (media.kind !== "photo") {
    if (!virtualModVideoModeration(settings)) return { handled: false }; // video moderation not yet enabled -- skip silently, never treated as explicit
    if (media.durationS != null && media.durationS > MEDIA_MAX_VIDEO_DURATION_S) {
      await recordMediaDedup(admin, panelId, community.id, media.fileUniqueId, "error", "ALLOW");
      await logActivity(admin, panelId, community.id, roleEnforcer.deploymentId, "media_moderation", "SKIPPED", "duration_exceeded", { mediaKind: media.kind, durationS: media.durationS });
      return { handled: false };
    }
  }

  // Media Moderation Units gate -- REVISED (2026-08-27), checked BEFORE any
  // classification is attempted. Every real Watch plan now gets a real,
  // controlled INCLUDED base allowance automatically (money.ts's
  // MEDIA_MODERATION_BASE_ALLOWANCE / ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE)
  // -- there is no more "no active add-on" state to report; the only way an
  // account with a real plan can be blocked here is genuinely exhausting its
  // available units (base + any purchased expansion packs) for the current
  // period. The Free Trial ALSO has a real, metered allowance now
  // (TRIAL_MEDIA_MODERATION_ALLOWANCE = 10% of Bronze -- see money.ts, kept
  // as a DERIVED constant so it can never drift from Bronze's own value) --
  // its "period" is the trial's own started_at/ends_at (read straight off
  // the already-resolved `settings` object via readModeratorAddon, never a
  // second DB query), since a one-time 7-day trial has no recurring
  // subscription period to reuse resolveAccountBillingPeriod against. Only a
  // genuinely UNREPRESENTABLE plan (a legacy Panel-distributed deployment,
  // or a legacy pre-migration-0080 row with an untrackable billing period)
  // still runs completely unmetered here. This is a genuine capacity limit,
  // not a content classification -- reaching it never implies or logs
  // anything about the media's actual content, and resolves to a silent
  // skip, never a fabricated result or a deleted message, matching every
  // other "can't classify" case in this function. Deliberately NOT run
  // through recordMediaDedup's cache: unlike too_large/duration_exceeded
  // (permanent properties of the file), the account's remaining allowance
  // is temporal -- caching it would incorrectly blacklist a file from ever
  // being reclassified once more capacity is purchased or the period rolls
  // over (for trial: once the trial itself is over, this gate no longer
  // applies at all -- moderation stops being reachable once entitlement
  // expires, same as every other trial capability).
  let mediaUsagePeriod: Awaited<ReturnType<typeof resolveAccountBillingPeriod>> = null;
  if (mediaBaseAllowance != null && accountId) {
    const trial = readModeratorAddon(settings).trial;
    mediaUsagePeriod = trialMediaModerationPeriod(trial) ?? await resolveAccountBillingPeriod(admin, accountId);
    if (mediaUsagePeriod) {
      const [used, expansionUnits] = await Promise.all([
        getWatchMediaModerationUsage(admin, accountId, mediaUsagePeriod.start),
        getMediaModerationExpansionUnits(admin, accountId, mediaUsagePeriod.start),
      ]);
      if (isMediaModerationLimitReached(used, mediaBaseAllowance, expansionUnits)) {
        await logActivity(admin, panelId, community.id, roleEnforcer.deploymentId, "media_moderation", "SKIPPED", "MEDIA_LIMIT_REACHED", { mediaKind: media.kind });
        return { handled: false };
      }
    }
  }

  const enforcer = roleEnforcer;
  const token = await getBotTokenForDeployment(admin, enforcer.deploymentId);
  if (!token) return { handled: false };

  const fileRes = await getTelegramFile(token, media.fileId);
  if (!fileRes.ok) {
    await logActivity(admin, panelId, community.id, enforcer.deploymentId, "media_moderation", "SKIPPED", "download_failed", { mediaKind: media.kind });
    return { handled: false };
  }
  const download = await downloadTelegramFileBuffer(token, fileRes.result.file_path, Math.min(MEDIA_MAX_BYTES, TELEGRAM_MAX_DOWNLOADABLE_BYTES));
  if (!download.ok) {
    await logActivity(admin, panelId, community.id, enforcer.deploymentId, "media_moderation", "SKIPPED", "download_failed", { mediaKind: media.kind, error: download.error });
    return { handled: false };
  }

  let result: MediaClassificationResult;
  let unitsConsumed: number;
  if (media.kind === "photo") {
    result = await classifyImageBytes(download.buffer, media.mimeType ?? "image/jpeg");
    unitsConsumed = result.ok ? 1 : 0;
  } else {
    const positions = computeSamplePositions((media.durationS ?? 30) * 1000);
    const extraction = await extractVideoFrames(download.buffer, positions);
    if (!extraction.ok) {
      result = { ok: false, failure: "decode_failed" };
      unitsConsumed = 0;
    } else {
      const sampled = await classifySampledFrames(extraction.frames, classifyImageBytes);
      result = sampled.result;
      unitsConsumed = sampled.framesClassified;
    }
  }

  // Real Media Moderation Unit metering -- ONLY for a gated self-serve
  // account (mediaUsagePeriod is only ever set inside the gate above, which
  // itself only runs for accountId+paidTier). A REAL, ok:true classification
  // consumes units even if the message is ultimately ALLOWed -- a unit is
  // "was this actually classified", never "was it flagged" (same principle
  // as the AI Generation pool counting on a successful provider call, not on
  // the downstream outcome).
  if (accountId && mediaUsagePeriod && unitsConsumed > 0) {
    await incrementWatchMediaModerationUsage(admin, accountId, mediaUsagePeriod, unitsConsumed);
  }

  // Media's OWN strike counter (mediaWarningCount) -- structurally separate
  // from solicitation's `warningCount` since the 2026-09-02 split (see
  // LinkWarningState's doc comment), still stored on the SAME per-
  // (community, user) row as link moderation's warning state, rather than a
  // second parallel table.
  const priorState = await loadLinkWarningState(admin, community.id, event.sender.platformUserId);
  const enforcement = decideMediaEnforcement({ result, priorWarningCount: priorState.mediaWarningCount });

  await logActivity(admin, panelId, community.id, enforcer.deploymentId, "media_moderation", enforcement.kind, result.ok ? result.verdict : result.failure, {
    mediaKind: media.kind,
    confidence: result.ok ? result.confidence : undefined,
  });
  await recordMediaDedup(admin, panelId, community.id, media.fileUniqueId, result.ok ? result.verdict : "error", enforcement.kind);

  if (enforcement.kind === "ALLOW") return { handled: false };

  if (token) {
    const deleteResult = await executeAction(admin, chatId, { kind: "DELETE_MESSAGE", targetDeploymentId: enforcer.deploymentId, targetMessageId: event.messageId });
    if (!deleteResult.ok) console.error("[telegram/community] media moderation DELETE_MESSAGE failed", deleteResult.error);
  }

  if (enforcement.kind === "DELETE_KICK") {
    // Zero-tolerance: immediate kick + purge for a confirmed explicit
    // result, no warning; or the borderline path's own repeat-offense
    // ceiling reaching the same removal + cleanup outcome. Never a
    // permanent ban (see event-types.ts's RESTRICT_USER doc comment).
    let kickFailed = false;
    let kickError: string | undefined;
    if (token) {
      const kickResult = await executeAction(admin, chatId, { kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: event.sender.platformUserId, mode: "KICK" });
      if (!kickResult.ok) {
        console.error("[telegram/community] media moderation RESTRICT_USER (kick) failed", kickResult.error);
        kickFailed = true;
        kickError = kickResult.error;
      }
    }
    await persistLinkWarningState(admin, panelId, community.id, event.sender.platformUserId, { ...priorState, mediaWarningCount: priorState.mediaWarningCount + 1 }, { kind: enforcement.reason, now });

    let purgeResult: { attempted: number; purged: number; failed: boolean } = { attempted: 0, purged: 0, failed: false };
    if (enforcement.purge && token && !kickFailed) {
      purgeResult = await purgeUserMessages(admin, chatId, community.id, event.sender.platformUserId, enforcer.deploymentId, now);
    }

    if (community.project_id) {
      await sendModerationReport({
        admin, projectId: community.project_id, sourceCommunityId: community.id, watcherId: enforcer.moderatorId,
        platformUserId: event.sender.platformUserId, username: event.sender.username ?? null, displayName: event.sender.displayName,
        event: {
          userMention: renderHumanModerationMention(event.sender.platformUserId, event.sender.username ?? null, event.sender.displayName),
          violationCategory: "nsfw", warningNumber: null, warningLimit: null, muteMinutes: null,
          actionsTaken: enforcement.purge ? ["kick", "message_purge"] : ["kick"],
          reasonText: enforcement.reason === "explicit_content"
            ? "User posted prohibited pornographic/NSFW content."
            : "Repeated borderline explicit media after a prior warning.",
          previousEnforcementSummary: [],
          purgedCount: enforcement.purge ? purgeResult.purged : null,
          purgeFailed: enforcement.purge ? purgeResult.failed : false,
          purgeFailureReason: enforcement.purge && purgeResult.failed ? "The Watcher does not currently have permission to remove older messages." : null,
          telegramActionFailed: kickFailed,
          telegramFailureReason: kickFailed ? (kickError ?? "The Watcher does not currently have permission to remove members.") : null,
        },
      });
    }
    return { handled: true };
  }

  // DELETE_WARN (borderline only -- a high-confidence explicit result never
  // reaches here, see decideMediaEnforcement)
  const nextState: LinkWarningState = { ...priorState, mediaWarningCount: enforcement.warningNumber };
  await persistLinkWarningState(admin, panelId, community.id, event.sender.platformUserId, nextState, { kind: enforcement.reason, now });
  const warningText = await generateMediaModerationWarning(
    enforcer.moderatorName, enforcer.persona, enforcement.warningNumber, enforcement.warningNumber >= SPAM_WARNING_LIMIT, aiRouting
  );
  if (token) {
    const sendResult = await executeAction(admin, chatId, {
      kind: "SEND_TEXT", text: warningText, targetDeploymentId: enforcer.deploymentId, replyToMessageId: null, origin: "HUMAN", interactionDepth: 0, causationMessageId: event.messageId,
    });
    if (sendResult.sentMessageId) {
      await admin.from("community_messages").insert({
        panel_id: panelId, community_id: community.id, platform_message_id: sendResult.sentMessageId,
        sender_type: "INNVIL_MODERATOR", sender_platform_id: null, sender_display_name: enforcer.moderatorName, deployment_id: enforcer.deploymentId, text: warningText,
      });
    }
  }
  if (community.project_id) {
    await sendModerationReport({
      admin, projectId: community.project_id, sourceCommunityId: community.id, watcherId: enforcer.moderatorId,
      platformUserId: event.sender.platformUserId, username: event.sender.username ?? null, displayName: event.sender.displayName,
      event: {
        userMention: renderHumanModerationMention(event.sender.platformUserId, event.sender.username ?? null, event.sender.displayName),
        violationCategory: "nsfw", warningNumber: enforcement.warningNumber, warningLimit: SPAM_WARNING_LIMIT, muteMinutes: null,
        actionsTaken: ["warning"],
        reasonText: "Borderline explicit/uncertain media content flagged for review.",
        previousEnforcementSummary: [], purgedCount: null, purgeFailed: false, purgeFailureReason: null,
        telegramActionFailed: false, telegramFailureReason: null,
      },
    });
  }
  return { handled: true };
}

async function handleHumanMessage(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string; collab_contact?: string | null; project_id?: string | null; allow_solicitation?: boolean | null; acknowledge_admin_mod?: boolean | null; pending_reply_delay_seconds?: number | null },
  message: TelegramMessage,
  event: CommunityEvent,
  isTrialEntitlement: boolean,
  timer: RequestTimer,
  settings: unknown,
  accountId: string | null = null,
  paidTier: ModeratorPlanTier | null = null,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING,
  mediaBaseAllowance: number | null = null,
  chatterActive: boolean = true
) {
  const deployments = await findChatterDeployments(admin, community.id);
  timer.mark("chatter_deployment_lookup", { deploymentCount: deployments.length });
  if (!deployments.length) return; // no chatter-eligible deployment in this community

  // Phase 4.M (B), corrected 2026-09-03 -- moderation must keep running for
  // as long as the trial's daily reactive-chatter quota (TRIAL_REACTIVE_
  // DAILY_LIMIT/day) has ANY headroom left, even though moderation itself
  // never spends a unit of that quota (recordReactiveQuotaUse is only ever
  // called from the conversational-reply path in respondAsDeployment, never
  // from runMediaModeration/runLinkModeration). Only once the quota is
  // FULLY exhausted for today does moderation pause too -- at that point
  // ordinary chatter/Q&A is already independently silenced by the identical
  // check inside respondAsDeployment, so this makes the whole community
  // (both safety enforcement and chat) go quiet together for the rest of
  // that day, rather than leaving spam/scam moderation running indefinitely
  // on a trial that's stopped generating for the day. Paid/Enterprise
  // accounts are unaffected (isTrialEntitlement is only ever true for the
  // trial entitlement source).
  if (isTrialEntitlement && !(await hasReactiveQuotaRemaining(admin, community.id, reactiveQuotaDay(new Date())))) {
    await logActivity(admin, panelId, community.id, deployments[0]?.deploymentId ?? null, "human_message", "SILENCE", "trial_reactive_quota_exhausted", {
      reasons: ["trial_reactive_quota_exhausted"],
      stage: "moderation_and_chat_paused",
    });
    return;
  }

  // Stable specialist-role assignment (Watcher Role Separation) -- computed
  // once, immediately after resolving the deployment set, and reused by
  // every moderation stage below. Chatter duty (which depends on
  // wasLastSpeaker/recentlyParticipated continuity signals not yet
  // available here) is recomputed separately, further down, right before
  // ordinary chatter routing -- moderation only ever reads `.domains`,
  // which never depends on continuity, so this single early computation is
  // sufficient and correct for it. See watcher-roles.ts.
  const roleAssignments = computeRoleAssignments(deployments, new Date());
  timer.mark("watcher_role_assignment", { roles: roleAssignments.map((r) => r.roleLabel) });

  // Media moderation is a SEPARATE decision, checked BEFORE link moderation
  // -- a message that's a flagged photo/video has nothing left to check for
  // links/task-route/chat about either. Never routed through DeepSeek/Claude
  // conversational paths -- only the specialized visual-safety classifier.
  // aiRouting only ever affects the WARNING TEXT (media-warning.ts) -- the
  // vision classifier itself (media-safety-provider.ts) is never BYO-routed
  // (see watch-byo.ts's own scope note). The Media Safety Moderator role
  // owns this event (see runMediaModeration's own enforcer selection) --
  // still runs continuously for EVERY deployment count regardless of
  // chatter duty, per the Watcher Role Separation spec.
  const chatId = String(message.chat.id);
  const mediaModeration = await runMediaModeration(
    admin, panelId, community, chatId, message, event, deployments, settings, new Date(), accountId, aiRouting, mediaBaseAllowance, roleAssignments
  );
  timer.mark("media_moderation_check", { handled: mediaModeration.handled });
  if (mediaModeration.handled) return;

  // Link moderation is a SEPARATE decision from chatter (spec §18/§50) --
  // checked first, independent of chatter's own quota-exhaustion gate
  // inside respondAsDeployment (spec §45) as long as the trial's daily
  // quota (checked once, above, before this whole function's moderation
  // stage even starts) still has headroom left. If the message got
  // deleted, there is nothing left to task-route or chat about, so it
  // short-circuits everything else. The Spam & Scam Moderator role owns
  // this event -- runs continuously regardless of chatter duty, per the
  // Watcher Role Separation spec.
  const moderation = await runLinkModeration(admin, panelId, community, chatId, event, deployments, new Date(), aiRouting, roleAssignments, message.chat.username ?? null);
  timer.mark("link_moderation_check", { handled: moderation.handled });
  if (moderation.handled) return;
  const collabContact = moderation.collabRoutable ? (community.collab_contact ?? null) : null;

  // Everything above this line (media moderation, link moderation) is a
  // SEPARATE decision from conversational chatter and always runs
  // regardless of `chatterActive` -- see the doc comment at this
  // function's caller. Only the conversational-reply portion below
  // (conversation tasks, ordinary chatter selection, generation) is gated
  // on Natural Chatter actually being entitled/enabled.
  if (!chatterActive) return;

  // Checked BEFORE any ordinary chatter routing -- an active/newly-created
  // conversational task fully owns this message (see routeConversationTask's
  // doc comment for why "task-local state wins" means suppressing ordinary
  // selection entirely, not just for the participant whose turn it is).
  const taskHandled = await routeConversationTask(admin, panelId, community, chatId, event, deployments, new Date());
  timer.mark("conversation_task_check", { handled: taskHandled });
  if (taskHandled) return;

  const repliedToDeploymentId = await resolveRepliedToDeployment(admin, community.id, event.replyToMessageId);

  // Load every deployment's pacing BEFORE resetting anyone's streak, so the
  // "is this bot dominating the conversation" check sees the true prior
  // state rather than a freshly-zeroed counter.
  const pacings = await Promise.all(deployments.map((d) => loadChatterPacing(admin, d.deploymentId)));

  // A fresh human message breaks EVERY deployment's own back-to-back streak,
  // not just whichever one ends up responding.
  await Promise.all(deployments.map((d) => resetChatterStreak(admin, d.deploymentId)));

  // Loaded before selection — this message was already recorded
  // (recordCommunityMessage, called by the caller before branching here), so
  // it's recentContext's LAST entry; the one before it (index length-2) is
  // what "recentlyAnsweredByModerator"/"recentlyRespondedByHuman"/
  // "wasLastSpeaker" check. All three additionally require priorMessage to be
  // RECENT (see isRecentMessage) -- who spoke last is meaningless on its own
  // after the room has gone quiet for a while; see RECENT_EXCHANGE_WINDOW_MS.
  const recentContext = await loadRecentContext(admin, community.id, 10);
  timer.mark("context_history_loading", { recentContextCount: recentContext.length });
  const priorMessage = recentContext.length >= 2 ? recentContext[recentContext.length - 2] : null;
  const now = new Date();
  const priorMessageIsRecent = isRecentMessage(priorMessage?.createdAt, now);
  const recentlyAnsweredByModerator = priorMessage?.senderType === "INNVIL_MODERATOR" && priorMessageIsRecent;
  const recentlyRespondedByHuman = humanRecentlyResponded(priorMessage ?? null, event.sender.platformUserId, now);

  // Resolved ONCE per event (not per-candidate): @username, reply-to, the
  // moderator's own configured name, or a typo-tolerant near-spelling of it
  // ("what persona are you kwan?", "how are you knaw?"). Ambiguous matches
  // resolve to no directed target rather than guessing.
  const directedMatch = resolveDirectedModerator(
    event.text,
    deployments.map((d) => ({ deploymentId: d.deploymentId, name: d.moderatorName, botUsername: d.botUsername }))
  );

  const candidates: ChatterCandidate[] = deployments.map((d, i) => ({
    deploymentId: d.deploymentId,
    isDirectedAtBot: repliedToDeploymentId === d.deploymentId || directedMatch?.deploymentId === d.deploymentId,
    // Same staleness guard as recentlyAnsweredByModerator above -- a
    // moderator's last message from hours ago doesn't mean it's "mid an
    // active exchange" just because it's the last row in history.
    wasLastSpeaker: priorMessage?.senderType === "INNVIL_MODERATOR" && priorMessage.deploymentId === d.deploymentId && priorMessageIsRecent,
    recentlyParticipated: deploymentRecentlyParticipated(recentContext, d.deploymentId, now),
    pacing: pacings[i],
  }));

  // Resolved ONCE per message -- a single Telegram getChatMember round trip
  // covers every admin-related decision below: (a) full conversational-
  // engagement suppression toward an admin/mod SENDER (rule 2/3), (b)
  // cancelling any still-pending scheduled reply for this topic the moment
  // an admin/mod message arrives (rule 8), and (c) whether an admin/mod is
  // the most recent OTHER speaker in THIS topic (feeds the coordinator's
  // own admin-deference check). Always computed when a deployment exists,
  // regardless of the acknowledge_admin_mod toggle -- (b) must fire
  // independent of that toggle (an admin taking over cancels a pending
  // reply either way; the toggle only governs whether the WATCHER itself
  // may converse with the admin, a separate question).
  const engagementCheckToken = deployments.length ? await getBotTokenForDeployment(admin, deployments[0].deploymentId) : null;
  const senderIsAdminOrTrusted = engagementCheckToken
    ? await isSenderAdminOrTrusted(engagementCheckToken, chatId, event.sender.platformUserId)
    : false;

  // Rule 2/3: when acknowledge_admin_mod is OFF (default), the Watcher must
  // not voluntarily engage a real Telegram admin/mod CONVERSATIONALLY AT
  // ALL -- no reaction, no short acknowledgement, no substantive reply, no
  // jumping in "to help" alongside them, not even when the admin/mod
  // directly @mentions the Watcher. Moderation/safety processing already
  // ran above and is completely independent of this flag. Same "off unless
  // explicitly turned on" discipline as bot-to-bot acknowledgement
  // (BOT_ACKNOWLEDGEMENT_ENABLED) and the fellow-bot case classifySender
  // already handles separately.
  const suppressAcknowledgementForSender = community.acknowledge_admin_mod !== true && senderIsAdminOrTrusted;

  // Rule 8: the instant an admin/mod's own message lands in a topic, any
  // Watcher reply that this SPECIFIC message actually takes over is
  // cancelled synchronously -- never waiting for the next cron tick, and
  // never a blanket "cancel every pending reply in this topic" (gap 2,
  // 2026-09-02 correction) -- see cancelPendingRepliesForTopic's own doc
  // comment for the exact conversation-ownership signals used.
  if (senderIsAdminOrTrusted) {
    await cancelPendingRepliesForTopic(admin, community.id, event.messageThreadId, {
      replyToPlatformMessageId: event.replyToMessageId, createdAt: event.timestamp,
    });
  }

  // Whether a real Telegram admin/mod is the most recent OTHER speaker in
  // THIS SAME topic/thread -- a human staff member is clearly present and
  // actively handling this exact conversation, so the Watcher defers rather
  // than duplicating/competing with them (explicit product rule: "when an
  // admin is talking with the user, it will stay quiet"). Explicit
  // direction always overrides this inside the coordinator (an @mention/
  // reply/configured-name match means the human asked THIS moderator
  // directly, which still gets answered regardless of who else is
  // handling the room). Uses the SAME 120s window the pending-reply
  // scheduler itself waits (PENDING_REPLY_DELAY_MS, via
  // isWithinPendingReplyWindow) -- an admin quiet for over 2 minutes no
  // longer holds this topic, and the Watcher may respond/be scheduled
  // normally. Applies uniformly to every plan/tier -- never gated by
  // entitlement.
  let recentlyRespondedByAdminOrMod = false;
  const mostRecentOtherHuman = findMostRecentMessageInTopic(recentContext, event.messageThreadId, {
    senderType: "HUMAN", excludePlatformId: event.sender.platformUserId,
  });
  const communityDelayMs = clampPendingReplyDelaySeconds(community.pending_reply_delay_seconds) * 1000;
  if (mostRecentOtherHuman && isWithinPendingReplyWindow(mostRecentOtherHuman.createdAt, now, communityDelayMs) && mostRecentOtherHuman.senderPlatformId && engagementCheckToken) {
    recentlyRespondedByAdminOrMod = await isSenderAdminOrTrusted(engagementCheckToken, chatId, mostRecentOtherHuman.senderPlatformId);
  }

  // Picks the socially appropriate ACTION (SILENCE/REACT/SHORT_ACK/
  // CASUAL_CHAT/ANSWER) and AT MOST ONE responder across every eligible
  // deployment — deterministic, no probability roll anywhere. Chatter
  // duty (Watcher Role Separation) does NOT change this function or its
  // internals at all -- it's reconciled as a separate, explicit step right
  // after, so chatter-coordinator.ts's own extensively-tested selection
  // logic stays completely untouched by this feature.
  let action = selectChatterAction({
    text: event.text, candidates, now: new Date(), recentlyAnsweredByModerator, recentlyRespondedByHuman,
    suppressAcknowledgementForSender, recentlyRespondedByAdminOrMod,
  });
  timer.mark("coordinator_action_selected", { actionType: action.type });

  if (action.type === "SILENCE" && isAmbientOpenerFallbackCandidate(action, event.text)) {
    // Narrow, cheap fallback for messages that failed every deterministic
    // classifier (see chatter-coordinator.ts "ambient-greeting model
    // fallback") -- e.g. "waddup guys", a phonetic greeting spelling no
    // regex can connect to "what's up". A single DeepSeek Flash
    // classification call (5-token output, never Sonnet); on any failure
    // the original deterministic SILENCE stands, no escalation. Budget-
    // raced same as the main generation call below -- defense in depth on
    // top of the model-level timeout fix in client.ts's postJson.
    const classifyResult = await raceWithTimeout(classifyAmbientGreeting(event.text, aiRouting), AMBIENT_CLASSIFY_BUDGET_MS);
    timer.mark("ambient_greeting_classification", { timedOut: !classifyResult.ok });
    if (classifyResult.ok && classifyResult.value.ok && classifyResult.value.isGreeting) {
      action = resolveAmbientOpenerFallback({ text: event.text, candidates, now, recentlyAnsweredByModerator, recentlyRespondedByHuman });
    }
  }

  // Watcher Role Separation: chatter duty is recomputed HERE (not reused
  // from the moderation-time roleAssignments above) so it reflects the real
  // continuity signals (wasLastSpeaker/recentlyParticipated) just computed
  // into `candidates` -- a Watcher mid an active exchange stays
  // ACTIVE_CHATTER even outside its rotation window, per the spec's
  // explicit "do not abruptly switch identity mid-conversation"
  // requirement. Only ever REPLACES the chosen deploymentId for ambient
  // CASUAL_CHAT/SHORT_ACK (restricting to the current chatter-duty pool)
  // or an undirected ANSWER (preferring the Knowledge role) -- a directed
  // mention/reply, REACT, and SILENCE are all passed through unchanged.
  // See watcher-roles.ts's own doc comment for the full contract.
  const chatterRoleAssignments = computeRoleAssignments(
    deployments, now,
    new Set(candidates.filter((c) => c.wasLastSpeaker || c.recentlyParticipated).map((c) => c.deploymentId))
  );
  const preReconcileDeploymentId = "deploymentId" in action ? action.deploymentId : undefined;
  action = reconcileAmbientPick(action, candidates, chatterRoleAssignments);
  const postReconcileDeploymentId = "deploymentId" in action ? action.deploymentId : undefined;
  if (postReconcileDeploymentId !== preReconcileDeploymentId) {
    timer.mark("chatter_duty_reconciled", { from: preReconcileDeploymentId, to: postReconcileDeploymentId });
  }

  if (action.type === "SILENCE") {
    await logActivity(admin, panelId, community.id, null, "human_message", "SILENCE", action.reasons.join(","), { reasons: action.reasons });
    return;
  }

  const deployment = deployments.find((d) => d.deploymentId === action.deploymentId);
  if (!deployment) return; // selection only ever returns an ID drawn from `candidates`/`deployments`

  if (action.type === "REACT") {
    // Deterministic, zero Sonnet calls — a real Telegram reaction, never a
    // standalone emoji text message. Reactions never call generateChatterReply
    // at all (lightweight ambient social content is handled by REACT/SILENCE,
    // not a wasted DeepSeek call for something a reaction already covers) and
    // never insert into community_messages, so — unlike a SEND_TEXT reply —
    // they can never be re-observed by another bot's webhook and can never
    // start a new bot-chain event, no matter how many reactors fire below.
    await reactAsDeployment(admin, panelId, community.id, String(message.chat.id), event.messageId, deployment, action.emoji, action.reasons);

    // Reactions are not turn-taking: this reactor's action does not consume
    // the human's message. When the primary reaction came from an AMBIENT
    // path (not a message literally directed at one specific moderator —
    // that stays single-target, since it's that moderator's to answer),
    // other currently-relevant moderators may independently react to the
    // SAME message too, bounded by MAX_ADDITIONAL_REACTORS so a room with
    // many deployed moderators never turns one "lol" into a pile-on.
    if (!action.reasons.includes("directed_trivial_acknowledgement")) {
      const additionalReactorIds = resolveAdditionalReactors(
        { text: event.text, candidates, now, recentlyAnsweredByModerator, recentlyRespondedByHuman },
        deployment.deploymentId
      );
      for (const id of additionalReactorIds) {
        const additionalDeployment = deployments.find((d) => d.deploymentId === id);
        if (!additionalDeployment) continue;
        await reactAsDeployment(admin, panelId, community.id, String(message.chat.id), event.messageId, additionalDeployment, action.emoji, ["ambient_relevant_acknowledgement"]);
      }
    }
    return;
  }

  // Rule 1 (revised, gap 1 correction 2026-09-02): EVERY ANSWER/CASUAL_CHAT
  // -- whether the Watcher was explicitly mentioned/replied-to/named or is
  // volunteering on its own via continuity/quietest-longest -- gives a
  // human the first opportunity before it may respond. An explicit mention
  // is a signal for WHO should eventually answer, never a grant of
  // permission to bypass human/admin priority. Instead of sending now, a
  // real, PERSISTED pending reply is scheduled per targeted deployment
  // (watch_pending_replies, never an in-memory timer -- survives a
  // restart/new invocation by construction) and the cron sweep
  // (pending-reply-runtime.ts) fires it after this community's own
  // configured delay (communities.pending_reply_delay_seconds, default
  // 45s, owner-adjustable 15-120s), unless an admin/mod takes over that
  // SPECIFIC conversation first (cancelled synchronously above the moment
  // that happens -- see cancelPendingRepliesForTopic). Applies uniformly
  // to every plan/tier. The only thing that ever pre-empts this wait
  // entirely is moderation/safety enforcement, which already ran earlier
  // in this function and returns before this point is ever reached.
  //
  // A genuine multi-target address (e.g. two moderators named together, or
  // a room-wide address) schedules ONE independent pending-reply row per
  // targeted deployment (all sharing this same trigger message + scheduled
  // time) -- each still respects human/admin priority on its own, and each
  // fires independently once due. Deliberate simplification versus the
  // previous synchronous fan-out: a deferred additional responder no
  // longer sees what the other already replied -- multiple relevant
  // moderators still each eventually answer, just without cross-awareness
  // of each other's exact wording.
  if (action.type === "ANSWER" || action.type === "CASUAL_CHAT") {
    const communityDelayMs = clampPendingReplyDelaySeconds(community.pending_reply_delay_seconds) * 1000;
    await schedulePendingReply(admin, {
      communityId: community.id, panelId, deploymentId: deployment.deploymentId, chatId: String(message.chat.id),
      messageThreadId: event.messageThreadId, triggerPlatformMessageId: event.messageId,
      senderPlatformId: event.sender.platformUserId, senderDisplayName: event.sender.displayName,
      senderUsername: event.sender.username ?? null, messageText: event.text, actionKind: action.type, now, delayMs: communityDelayMs,
    });
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "SILENCE", "deferred_pending_reply", { actionKind: action.type });

    const multiTargets = resolveMultiTargetAddress(
      event.text,
      deployments.map((d) => ({ deploymentId: d.deploymentId, name: d.moderatorName, botUsername: d.botUsername }))
    );
    if (multiTargets) {
      const additionalCap = isRoomWideAddress(event.text)
        ? Math.max(0, roomWideResponderCount(deployments.length) - 1)
        : undefined;
      const additionalIds = resolveAdditionalResponderIds(deployment.deploymentId, multiTargets, additionalCap);
      for (const id of additionalIds) {
        const additionalDeployment = deployments.find((d) => d.deploymentId === id);
        if (!additionalDeployment) continue;
        await schedulePendingReply(admin, {
          communityId: community.id, panelId, deploymentId: additionalDeployment.deploymentId, chatId: String(message.chat.id),
          messageThreadId: event.messageThreadId, triggerPlatformMessageId: event.messageId,
          senderPlatformId: event.sender.platformUserId, senderDisplayName: event.sender.displayName,
          senderUsername: event.sender.username ?? null, messageText: event.text, actionKind: action.type, now, delayMs: communityDelayMs,
        });
      }
    }
    return;
  }
}

/** Executes + logs ONE deployment's REACT to the current message. Extracted
 *  so it can run once for the primary reactor and, independently, once per
 *  additional relevant reactor (see the multi-reactor fan-out block above) --
 *  the SAME zero-Sonnet, zero-community_messages-insert shape every time,
 *  just scoped to a different deployment + its own persona-flavored emoji
 *  (personaReactionEmoji, chatter-generate.ts) so two moderators reacting to
 *  the same message don't have to use an identical one. */
async function reactAsDeployment(
  admin: SupabaseClient,
  panelId: string | null,
  communityId: string,
  chatId: string,
  targetMessageId: string,
  deployment: ChatterDeployment,
  baseEmoji: string,
  reasons: string[]
): Promise<void> {
  const emoji = personaReactionEmoji(baseEmoji, deployment.persona);
  const reactAction: CommunityAction = { kind: "REACT", emoji, targetDeploymentId: deployment.deploymentId, targetMessageId };
  const result = await executeAction(admin, chatId, reactAction);
  if (!result.ok) {
    // Previously silent -- Telegram rejecting the reaction (missing bot
    // rights, or the chat restricting its allowed-reactions set) looked
    // identical to a successful react from every log/observability angle.
    console.error("[telegram/community] REACT failed", result.error);
    await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "REACT_FAILED", reasons.join(","), { reasons, emoji, error: result.error });
    return;
  }
  await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "REACT", reasons.join(","), { reasons, emoji });
}

/** Generates (if needed), sends, and logs one moderator's response to the
 *  current human message. Extracted so it can run once for the primary
 *  responder and, independently, once per additional co-addressed responder
 *  (see the multi-target block above) -- same budget/timeout/quota/logging
 *  shape every time, just scoped to a different deployment + its own persona. */
export async function respondAsDeployment(params: {
  admin: SupabaseClient;
  panelId: string | null;
  communityId: string;
  chatId: string;
  event: CommunityEvent;
  deployment: ChatterDeployment;
  actionType: "SHORT_ACK" | "CASUAL_CHAT" | "ANSWER";
  reasons: string[];
  isTrialEntitlement: boolean;
  /** Direct-Watch account id, resolved only for a standalone (Panel-less)
   *  integration -- null for a Panel-distributed deployment or a trial
   *  account, in which case the MODERATOR_AI_GENERATION_POOL gate below never
   *  applies (see handleCommunityUpdate's resolution). */
  accountId: string | null;
  /** The account's real current paid tier -- null unless accountId is also
   *  set and the account is genuinely on a paid (non-trial) subscription. */
  paidTier: ModeratorPlanTier | null;
  now: Date;
  recentContext: ChatterContextMessage[];
  isDirectedAtBot: boolean;
  addressedWithTypo: boolean;
  otherActiveModeratorNames: string[];
  /** Only meaningful for an additional (non-primary) responder — see
   *  GenerateChatterReplyInput's doc comments for both fields. */
  priorResponsesToThisMessage?: { moderatorName: string; text: string }[];
  individualContributionExpected?: boolean;
  /** Phase 4.M (F) — set only when the triggering message was link-
   *  classified as a genuine collab/AMA/partnership inquiry AND the
   *  community has a configured contact. See GenerateChatterReplyInput's
   *  doc comment. */
  collabContact?: string | null;
  /** Phase 4.N — already-retrieved, relevance-ranked, scope-labeled
   *  knowledge for THIS triggering message (see GenerateChatterReplyInput's
   *  doc comment). Only ever set for ANSWER. */
  projectKnowledge?: KnowledgeContextEntry[];
  /** Already-retrieved community-message knowledge (pinned posts,
   *  announcements, official links from THIS community's own admin/mod
   *  messages) -- see GenerateChatterReplyInput's own doc comment. Only
   *  ever resolved for ANSWER, and only AFTER every engagement/deference/
   *  scheduling decision already cleared the Watcher to respond. */
  communityKnowledge?: CommunityKnowledgeGrounding | null;
  /** Silence/command/fallback policy (§15) -- the configured general
   *  fallback contact, if any (see GenerateChatterReplyInput's own doc
   *  comment). Used BOTH to tell the model the option exists (via
   *  generateChatterReply's own input) AND, if the model emits the
   *  mention-only sentinel, as the LITERAL text sent -- a bare mention,
   *  nothing else. */
  fallbackAdminMention?: string | null;
  /** BYO Enterprise (Phase 2, 2026-08-24) -- the account's already-resolved
   *  AI-provider routing decision (see GenerateChatterReplyInput's own doc
   *  comment). Defaults to MANAGED_AI_ROUTING when omitted. */
  aiRouting?: AccountAiRouting;
  /** Shared Escalation Group (Phase 1) -- this community's Project id, when
   *  known (see handleHumanMessage's own doc comment on when this may be
   *  null). Required (with escalationTarget) to actually create an
   *  escalation when the model emits ESCALATE_REQUIRED. */
  projectId?: string | null;
  /** Already-resolved once per message (handleHumanMessage) -- null means
   *  no escalation group is configured/deployable for this project, in
   *  which case generateChatterReply is never even offered the
   *  ESCALATE_REQUIRED sentinel (escalationConfigured: false) and this
   *  field is unused. */
  escalationTarget?: EscalationTarget | null;
  timer: RequestTimer;
}): Promise<{ replied: false; modelDeclined?: boolean } | { replied: true; text: string }> {
  const {
    admin, panelId, communityId, chatId, event, deployment, actionType, reasons, isTrialEntitlement, accountId, paidTier, now, recentContext,
    isDirectedAtBot, addressedWithTypo, otherActiveModeratorNames, priorResponsesToThisMessage, individualContributionExpected, collabContact, projectKnowledge, communityKnowledge, fallbackAdminMention, timer,
    aiRouting: initialAiRouting = MANAGED_AI_ROUTING,
    projectId = null, escalationTarget = null,
  } = params;
  // Phase 4.V.1 (item 2) -- reassignable (`let`), since the deployment-
  // scoped usage-policy re-check below (SHORT_ACK-excluded -- see the
  // `else` branch) may narrow it once the responding deployment is known.
  let aiRouting = initialAiRouting;

  // Phase 4.M (B): trial-only, checked BEFORE any AI generation is attempted
  // (spec §17) -- SHORT_ACK/CASUAL_CHAT/ANSWER are all reactive conversational
  // text responses and share this one gate. Checked per-responder, so a
  // second (additional) responder is subject to the exact same quota as the
  // primary would have been.
  if (isTrialEntitlement && !(await hasReactiveQuotaRemaining(admin, communityId, reactiveQuotaDay(now)))) {
    await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "SILENCE", "trial_reactive_quota_exhausted", {
      reasons: ["trial_reactive_quota_exhausted"],
      attemptedAction: actionType,
    });
    return { replied: false };
  }

  let replyText: string;
  let aiUsagePeriod: { start: string; end: string } | null = null;
  if (actionType === "SHORT_ACK") {
    // Deterministic, zero Sonnet calls.
    replyText = shortAckText(deployment.persona);
  } else {
    // MODERATOR_AI_GENERATION_POOL (money.ts) -- direct-Watch paid accounts
    // only (accountId/paidTier both set only in that case, see
    // handleCommunityUpdate). Deliberately scoped to CASUAL_CHAT/ANSWER
    // only (this whole branch) -- SHORT_ACK never reaches here, matching
    // the pool's own doc comment ("SILENCE, REACT, deterministic SHORT_ACK
    // ... never consume it"). Checked BEFORE any AI call, same discipline
    // as the trial reactive-quota gate above -- an exhausted pool must
    // never itself pay for a wasted Sonnet/DeepSeek call. Never applies to
    // moderation (runLinkModeration/media moderation are separate,
    // independent code paths that already ran earlier and are untouched by
    // this gate).
    if (accountId && paidTier) {
      aiUsagePeriod = await resolveAccountBillingPeriod(admin, accountId);
      if (aiUsagePeriod) {
        const used = await getWatchAiGenerationUsage(admin, accountId, aiUsagePeriod.start);
        if (!hasAiGenerationPoolRemaining(used, paidTier)) {
          await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "SILENCE", "ai_generation_pool_exhausted", {
            reasons: ["ai_generation_pool_exhausted"],
            attemptedAction: actionType,
          });
          return { replied: false };
        }
      }
    }
    // Phase 4.V.1 (item 2) -- once the responding deployment is known
    // (right here, unlike the once-per-message resolveAccountAiRouting
    // call before this function even runs), re-check the DEPLOYMENT-scoped
    // BYO usage policy specifically. Correctly scoped to CASUAL_CHAT/ANSWER
    // only (this `else` branch) -- SHORT_ACK makes zero AI calls and
    // consumes zero BYO spend, so it must never be gated by this. Gated on
    // `aiRouting.credential` ALREADY being usable (matches
    // applyDeploymentUsagePolicy's own no-op guard) -- an already-unusable
    // credential (missing/unconfigured) must keep falling through to the
    // EXISTING GENERATION_STARTED -> GENERATION_FAILED path unchanged, never
    // intercepted here as a new SILENCE, which would be a real behavior
    // regression for a case this gate was never meant to touch.
    if (aiRouting.required && aiRouting.credential) {
      aiRouting = await applyDeploymentUsagePolicy(admin, aiRouting, accountId, communityId, deployment.deploymentId, "reactive");
      if (!aiRouting.credential) {
        await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "SILENCE", "byo_deployment_usage_policy_exhausted", {
          reasons: ["byo_deployment_usage_policy_exhausted"],
          attemptedAction: actionType,
        });
        return { replied: false };
      }
    }
    // GENERATION_STARTED is written BEFORE the model call specifically so a
    // killed function still leaves a diagnostic trace in the DB alone -- the
    // live incident this closes had a recorded community_messages row but
    // ZERO moderator_activity_log rows, because the function died mid-
    // generation before reaching any log call at all.
    await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "GENERATION_STARTED", reasons.join(","), {
      reasons,
      actionType,
      // Mirrors resolveChatterRoute()'s own routing rule (chatter-generate.ts)
      // -- CASUAL_CHAT -> DeepSeek Flash, ANSWER -> Sonnet 5 medium, UNLESS
      // this account is BYO Enterprise, in which case both route through the
      // account's own stored credential/provider instead.
      provider: aiRouting.required ? (aiRouting.credential?.provider ?? "byo_unconfigured") : actionType === "CASUAL_CHAT" ? "deepseek" : "anthropic",
    });
    timer.mark("generation_start", { actionType, deploymentId: deployment.deploymentId });

    const genRace = await raceWithTimeout(
      generateChatterReply({
        action: actionType,
        selfDeploymentId: deployment.deploymentId,
        moderatorName: deployment.moderatorName,
        persona: deployment.persona,
        recentContext,
        triggerMessage: { senderName: event.sender.displayName, text: event.text },
        isDirectedAtBot,
        // Only true when THIS is the moderator the typo-tolerant match
        // resolved to — lets it optionally play along with the misspelling
        // without forcing every reply to comment on it.
        addressedWithTypo,
        // Grounds the "don't fabricate another moderator's presence" prompt
        // rule in actual deployment state, not the model's guess.
        otherActiveModeratorNames,
        priorResponsesToThisMessage,
        individualContributionExpected,
        collabContact,
        projectKnowledge,
        communityKnowledge,
        fallbackAdminMention,
        aiRouting,
        // Shared Escalation Group (Phase 1) -- only ever true for ANSWER
        // (escalationTarget is only ever resolved for ANSWER, see
        // handleHumanMessage), and only when a real, deployable escalation
        // group exists for this project.
        escalationConfigured: !!escalationTarget,
      }),
      CHATTER_TOTAL_BUDGET_MS
    );
    timer.mark("generation_end", { timedOut: !genRace.ok, deploymentId: deployment.deploymentId });

    if (!genRace.ok) {
      // Defense in depth: the model call's OWN internal timeout (client.ts's
      // AI_REQUEST_TIMEOUT_MS, now correctly covering the full request incl.
      // body read) should always fire well before this outer budget does.
      // If it somehow doesn't, this still guarantees the function returns
      // and logs instead of hanging until the platform kills it with no trace.
      console.error("[telegram/community] chatter generation exceeded total budget", CHATTER_TOTAL_BUDGET_MS);
      await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "GENERATION_TIMEOUT", reasons.join(","), {
        reasons,
        budgetMs: CHATTER_TOTAL_BUDGET_MS,
      });
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, false, "generation timed out");
      return { replied: false };
    }
    const generation = genRace.value;

    if (!generation.ok) {
      console.error("[telegram/community] chatter generation failed", generation.error);
      await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "GENERATION_FAILED", reasons.join(","), { reasons });
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, false, generation.error);
      return { replied: false };
    }
    if ("escalate" in generation) {
      // Shared Escalation Group (Phase 1) -- the model found ZERO relevant
      // Project Knowledge for a question that genuinely needs it, and a
      // real escalation group is configured. Real provider spend already
      // happened (a genuine successful call) -- counted the same way a
      // normal successful reply is (see the counting-semantics comment
      // below), never treated as a free/zero-cost outcome just because no
      // text was sent to the community.
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, true, undefined, generation.usage);
      if (accountId && aiUsagePeriod) {
        await incrementWatchAiGenerationUsage(admin, accountId, aiUsagePeriod);
      }
      if (escalationTarget && projectId) {
        const result = await createEscalation({
          admin, projectId, sourceCommunityId: communityId,
          escalatingModeratorId: deployment.moderatorId, watcherName: deployment.moderatorName,
          askerPlatformUserId: event.sender.platformUserId, askerDisplayName: event.sender.displayName,
          sourceMessageId: event.messageId, questionText: event.text,
        });
        if (result.ok) {
          await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "ESCALATED", reasons.join(","), { reasons });
          replyText = result.forwardedText;
        } else {
          // Narrow failure path -- escalationConfigured was only true
          // because a real target was resolved moments earlier, so this
          // means the actual SEND to the escalation group failed (e.g. a
          // permission/rate-limit hiccup), not a missing configuration.
          // Never promises "forwarded to the team" when it wasn't.
          console.error("[telegram/community] escalation creation failed despite a resolved target", communityId);
          await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "ESCALATION_FAILED", reasons.join(","), { reasons });
          replyText = "I don't have a confirmed answer for that right now.";
        }
      } else {
        // Should be unreachable (escalationConfigured mirrors escalationTarget
        // exactly) -- defensive fallback, never silently drops the question.
        console.error("[telegram/community] model emitted ESCALATE_REQUIRED with no escalation target resolved", communityId);
        await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "ESCALATION_FAILED", reasons.join(","), { reasons });
        replyText = "I don't have a confirmed answer for that right now.";
      }
    } else if ("mentionAdmin" in generation) {
      // Silence/command/fallback policy (§15) -- no reliable answer exists,
      // but a general fallback contact IS configured. The send is ALWAYS
      // just the bare mention -- no persona filler, no lead-in sentence --
      // per the explicit "mention-only fallback stays mention-only" rule.
      // Real provider spend already happened (a genuine successful call),
      // counted the same way a normal successful reply is.
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, true, undefined, generation.usage);
      if (accountId && aiUsagePeriod) {
        await incrementWatchAiGenerationUsage(admin, accountId, aiUsagePeriod);
      }
      if (fallbackAdminMention) {
        await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "MENTION_ADMIN_FALLBACK", reasons.join(","), { reasons });
        replyText = fallbackAdminMention;
      } else {
        // Should be unreachable (fallbackAdminMention mirrors the prompt's
        // own offer of this sentinel exactly) -- defensive fallback, never
        // sends an empty/garbled mention.
        console.error("[telegram/community] model emitted MENTION_ADMIN_REQUIRED with no fallback contact resolved", communityId);
        await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "MODEL_DECLINED", reasons.join(","), { reasons });
        return { replied: false, modelDeclined: true };
      }
    } else if ("noReply" in generation) {
      await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "MODEL_DECLINED", reasons.join(","), { reasons });
      // A genuine successful BYO call -- the model responded, it just chose
      // not to reply. Real provider spend happened, so this counts as a
      // successful call for telemetry purposes, same as any real reply.
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, true, undefined, generation.usage);
      return { replied: false, modelDeclined: true };
    } else {
      replyText = generation.reply;
      recordByoCall(admin, aiRouting, accountId, communityId, deployment.deploymentId, `NATURAL_CHATTER_${actionType}`, true, undefined, generation.usage);

      // 2026-08-22 counting-semantics change: an "AI Generation" is consumed
      // the moment the provider successfully produces a usable reply -- NOT
      // gated on the subsequent Telegram send. A timeout/auth failure/outage/
      // declined generation (all handled above, all `return` before reaching
      // this line) counts as 0; a successful generation whose Telegram
      // delivery later fails still counts as 1 (the customer's provider spend
      // already happened). This intentionally differs from the trial's
      // SEPARATE reactive-quota counter below, which still counts only on a
      // confirmed send -- the two are different products with different
      // counting rules, never conflated.
      if (accountId && aiUsagePeriod) {
        await incrementWatchAiGenerationUsage(admin, accountId, aiUsagePeriod);
      }
    }
  }

  const sendAction: CommunityAction = {
    kind: "SEND_TEXT",
    text: replyText,
    targetDeploymentId: deployment.deploymentId,
    replyToMessageId: event.messageId,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: event.messageId,
  };
  const sent = await executeAction(admin, chatId, sendAction);
  timer.mark("telegram_send", { sent: !!sent.sentMessageId, deploymentId: deployment.deploymentId });
  await recordBotSpoke(admin, deployment.deploymentId, new Date());
  await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", actionType, reasons.join(","), { reasons });
  timer.mark("activity_logging", { deploymentId: deployment.deploymentId });

  // Only consumed after the send actually succeeded (spec §7) -- never for a
  // failed outbound send, a declined/failed generation (both already
  // returned above), or a SILENCE/REACT (neither reaches this line at all).
  if (isTrialEntitlement && sent.sentMessageId) {
    await recordReactiveQuotaUse(admin, panelId, communityId, reactiveQuotaDay(now));
  }
  // The paid MODERATOR_AI_GENERATION_POOL is now incremented earlier, right
  // after a successful generation (see above) -- never here, and never
  // gated on `sent.sentMessageId`.

  if (sent.sentMessageId) {
    await admin.from("community_messages").insert({
      panel_id: panelId,
      community_id: communityId,
      platform_message_id: sent.sentMessageId,
      sender_type: "INNVIL_MODERATOR",
      sender_platform_id: null,
      sender_display_name: deployment.moderatorName,
      deployment_id: deployment.deploymentId,
      text: replyText,
      reply_to_platform_message_id: event.messageId,
    });
    return { replied: true, text: replyText };
  }
  return { replied: false };
}

/* ------------------------------------------------------------- entry point ---- */

/** Entry point called by the per-bot webhook handler (telegram.ts). */
export async function handleCommunityUpdate(integrationId: string, update: TelegramUpdate): Promise<void> {
  const timer = createRequestTimer(integrationId);
  timer.mark("webhook_received");
  const admin = createAdminClient();

  const isDup = await isDuplicateUpdate(admin, integrationId, update.update_id);
  timer.mark("duplicate_update_check", { isDuplicate: isDup });
  if (isDup) return;

  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message?.chat) { timer.mark("no_message_or_sender"); return; }
  // A real Telegram CHANNEL post (broadcast, not a group/supergroup message)
  // is almost always anonymous -- `from` is only present when the channel
  // owner has explicitly enabled message signatures, which is rare -- so
  // requiring `from` unconditionally silently dropped every channel post
  // before it ever reached moderation, making a Watcher deployed to a real
  // channel structurally unable to do anything at all (found investigating
  // a live "Watcher deployed to a channel is not doing anything" report,
  // 2026-09-02). `from` is still required for a group/supergroup/private
  // message -- those genuinely have no meaningful anonymous-sender case
  // (Telegram represents an anonymous GROUP admin as a real, if synthetic,
  // `from` user -- "GroupAnonymousBot" -- never an absent `from`).
  const isAnonymousChannelPost = !message.from && (!!update.channel_post || !!update.edited_channel_post);
  if (!message.from && !isAnonymousChannelPost) { timer.mark("no_message_or_sender"); return; }

  const integration = await resolveIntegration(admin, integrationId);
  if (!integration) { timer.mark("no_integration"); return; }

  // /start (Phase 4.O — telegram-bot-to-bot-onboarding-spec.md) is checked
  // BEFORE resolveCommunity's bail-out, since its whole purpose is to
  // complete a connection for a chat that doesn't have a community row YET.
  // Never routed into moderation/chatter/bot-ack either way.
  if (await handleStartCommand(admin, integration, message)) { timer.mark("start_command_handled"); return; }

  // Panel-backed: read panels.settings as before, unchanged. Standalone
  // (direct-Watch, integration.panel_id: null): synthesize the SAME
  // settings shape from the account's real product_entitlements tier, so
  // every downstream virtualMod*(settings) capability check runs
  // completely unmodified either way (see watch-runtime.ts's
  // resolveStandaloneModeratorSettings).
  let settings: unknown = null;
  if (integration.panel_id) {
    const { data: panel } = await admin.from("panels").select("settings").eq("id", integration.panel_id).maybeSingle();
    settings = panel?.settings ?? null;
  } else {
    settings = await resolveStandaloneModeratorSettings(admin, integration.virtual_moderator_id);
  }

  const community = await resolveCommunity(admin, integration.panel_id, message.chat);
  if (!community) { timer.mark("no_community", { chatId: message.chat.id, chatType: message.chat.type }); return; }

  // Shared Escalation Group (Phase 1) -- an escalation-group community is
  // an internal ops channel, never a customer-facing one. Branched BEFORE
  // sender classification/moderation/chatter, none of which are meaningful
  // here: an admin's reply either resolves a tracked escalation or it's a
  // no-op, nothing else about this chat is ever moderated/chatted with.
  if (community.connection_type === "escalation_group") {
    await handleEscalationGroupMessage(admin, { id: community.id, chatId: String(message.chat.id) }, message);
    timer.mark("escalation_group_message_handled");
    return;
  }

  // A synthetic, non-Telegram-user identity for an anonymous channel post --
  // deliberately never real enough to pass isSenderAdminOrTrusted's live
  // getChatMember lookup (there's no real numeric user id to check), so
  // every call site that resolves it treats `channel:`-prefixed ids as
  // trusted-by-construction instead of attempting (and failing) a live
  // check -- see isSyntheticChannelSender below. Only Telegram channel
  // ADMINS can post to a channel at all, so treating channel-broadcast
  // content as inherently trusted for the ordinary-promotion exemption is
  // correct; scam/phishing/explicit-content enforcement is never role-
  // exempt regardless (decideLinkEnforcement), so a compromised channel
  // posting malicious links is still caught.
  const sender = isAnonymousChannelPost
    ? {
        platformUserId: `${SYNTHETIC_CHANNEL_SENDER_PREFIX}${message.chat.id}`,
        isBot: false as const,
        senderType: "HUMAN" as const,
        displayName: message.chat.title ?? message.chat.username ?? "Channel",
        username: message.chat.username ?? null,
      }
    : await classifySender(admin, integration.panel_id, community.id, message.from!);

  // Resolves whether THIS message is itself a bot-ack reply another
  // deployment sent — Telegram gives no such signal on the update itself,
  // so without this lookup every inbound event defaulted to HUMAN/depth 0,
  // making the coordinator's loop-prevention gates unreachable in practice.
  const { origin, interactionDepth } = await resolveEventOrigin(admin, community.id, String(message.message_id));

  const event: CommunityEvent = {
    panelId: integration.panel_id,
    communityId: community.id,
    integrationId,
    messageId: String(message.message_id),
    sender,
    timestamp: new Date().toISOString(),
    text: message.text ?? message.caption ?? "",
    replyToMessageId: message.reply_to_message ? String(message.reply_to_message.message_id) : null,
    messageThreadId: message.message_thread_id ?? null,
    origin,
    interactionDepth,
    causationMessageId: null,
  };

  // Bounded recent-context log — recorded regardless of which capability (if
  // any) is active; both bot-ack correlation and chatter context need it.
  // Also the cross-bot claim (see recordCommunityMessage's doc comment): if
  // another deployed bot's webhook already recorded this exact message,
  // this call is a redundant observation of the same real Telegram message —
  // stop here so bot-ack/chatter never runs (and never sends) twice for it.
  // Telegram delivers the SAME update to EVERY bot that's a group member, so
  // this race is expected/normal on every message with 2+ deployed
  // moderators, never a bug on its own -- traced here (not persisted to
  // moderator_activity_log, which stays reserved for real decisions) purely
  // so a live incident can distinguish "this invocation never even entered
  // the pipeline" from "it entered and then something went wrong downstream."
  const { claimed } = await recordCommunityMessage(admin, integration.panel_id, community.id, message, sender);
  timer.mark(claimed ? "claim_won" : "claim_lost_duplicate", { messageId: event.messageId });
  if (!claimed) return;

  // Telegram Forum topic auto-discovery + pinned-message tracking --
  // unconditional (any sender type), best-effort, never blocks message
  // processing on failure. Real message_thread_id is the sole lookup key;
  // a plain sighting never clobbers an already-known topic name with null.
  if (message.message_thread_id != null) {
    const topicNameFromEvent = message.forum_topic_created?.name ?? message.forum_topic_edited?.name ?? null;
    await recordTopicSighting(admin, community.id, message.message_thread_id, topicNameFromEvent);
  }
  if (message.pinned_message) {
    const currentTopics = await loadCommunityTopics(admin, community.id);
    const pinnedTopic = findCommunityTopic(currentTopics, message.pinned_message.message_thread_id ?? null);
    await indexCommunityKnowledgeMessage(admin, community.id, message.pinned_message, {
      isAdminAuthor: true, isAnnouncementTopic: pinnedTopic?.policy === "announcement", forcePinned: true,
    });
  }

  if (sender.senderType === "INNVIL_MODERATOR" && sender.deploymentId) {
    if (!virtualModBotAcknowledgement(settings)) return;
    const eligibleTargets = await loadEligibleTargets(admin, community.id, sender.deploymentId);
    const action = decideBotAcknowledgement({ event, botAckMode: community.bot_ack_mode, eligibleTargets, now: new Date() });
    await logBotAckDecision(admin, integration.panel_id, community.id, event, action);
    if (action.kind === "IGNORE") return;
    const sent = await executeAction(admin, String(message.chat.id), action);
    if (!sent.ok) {
      // Previously silent -- logBotAckDecision above already logged the
      // DECIDED action (e.g. "REACT") before execution even ran, so a
      // Telegram-side rejection (missing bot rights, an invalid/unsupported
      // reaction emoji, chat restrictions, ...) looked identical to success
      // from every log/observability angle. Mirrors reactAsDeployment's
      // REACT_FAILED pattern (Natural Chatter's own REACT path).
      console.error("[telegram/community] bot-ack action failed", action.kind, sent.error);
      await logActivity(admin, integration.panel_id, community.id, action.targetDeploymentId, "bot_message", `${action.kind}_FAILED`, event.sender.senderType, {
        error: sent.error,
      });
      return;
    }
    // Only counts against the target's pacing/rate-limit budget once the
    // action actually landed -- a failed send must never consume it.
    await recordBotAck(admin, action.targetDeploymentId, new Date());
    if ((action.kind === "SEND_TEXT" || action.kind === "COMMUNITY_HANDOFF") && sent.sentMessageId) {
      await recordBotAckReply(admin, integration.panel_id, community.id, sent.sentMessageId, action);
    }
    // Phase 4.O delivery-based verification (spec §13/§15) -- reaching this
    // point means THIS deployment both received another bot's message (Bot-
    // to-Bot Communication Mode is genuinely on) and successfully sent its
    // own acknowledgement. Only ever set from an ACTUAL successful delivery,
    // never from a UI checkbox/self-report.
    await admin.from("moderator_deployments").update({ bot_to_bot_status: "verified_by_delivery" }).eq("id", sender.deploymentId);
    return;
  }

  if (sender.senderType === "HUMAN") {
    // Natural Chatter's own entitlement is a SEPARATE decision from
    // moderation (see runMediaModeration/runLinkModeration's own doc
    // comments: "independent of and never disabled by the reactive chatter
    // quota"). Previously this gate short-circuited BEFORE
    // handleHumanMessage was ever called, which meant an inactive/disabled
    // Natural Chatter entitlement (a lapsed plan, the master rollout flag
    // off, etc.) silently disabled moderation too -- a real bug, not the
    // intended design. `chatterActive` is now only ever consulted INSIDE
    // handleHumanMessage, strictly to gate the conversational-reply portion
    // (task routing onward) -- media/link moderation always run first,
    // unconditionally, regardless of this flag.
    // An anonymous channel broadcast has no real conversational partner --
    // there's nothing to reply/converse with, and the bot may well lack
    // post permission in the channel regardless -- so conversational
    // routing is skipped entirely for it (moderation above is unaffected,
    // it already ran unconditionally). This is the ONLY effect
    // isAnonymousChannelPost has on chatterActive; entitlement/rollout-flag
    // gating is otherwise unchanged.
    const chatterActive = virtualModNaturalChatterActive(settings) && !isAnonymousChannelPost;
    timer.mark("natural_chatter_entitlement_gate", { active: chatterActive, isAnonymousChannelPost });
    // Phase 4.M (B): the 20/day reactive quota is trial-only (spec §2) --
    // paid tiers are unaffected and this patch does not change their
    // existing (unlimited) behavior.
    const entitlementSource = moderatorEntitlementSource(settings);
    const isTrialEntitlement = entitlementSource === "trial";
    // MODERATOR_AI_GENERATION_POOL (money.ts) usage gate -- direct-Watch
    // accounts only (integration.panel_id null), never the legacy Panel-
    // distributed Virtual Moderator system, which has its own separate
    // commercial model. `resolveStandaloneModeratorSettings` already
    // resolved `entitlementSource` to the account's REAL current paid tier
    // for a standalone integration, so this is a plain type-narrow, not a
    // second entitlement lookup. Enterprise is DELIBERATELY excluded here
    // too (paidTier stays null for it) -- Enterprise has its own separate,
    // much larger fixed AI Generation pool (money.ts's
    // MANAGED_ENTERPRISE_50_AI_GENERATIONS) that isn't wired into this
    // specific self-serve-tier gate; gating it here would incorrectly cap
    // Enterprise usage against Platinum's own smaller pool. This is an
    // existing, separate, already-documented gap (Enterprise's own pool
    // isn't consumption-enforced anywhere yet), not a regression introduced
    // by this fix.
    const accountId = integration.panel_id ? null : await resolveWatcherAccountId(admin, integration.virtual_moderator_id);
    // byo20 (2026-08-25) is excluded here too, for the exact same reason as
    // Enterprise -- it always routes through the customer's own AI
    // provider credential (never Innvil's), so it must never consume or be
    // capped against this self-serve Innvil-Managed pool at all.
    const paidTier: ModeratorPlanTier | null =
      !integration.panel_id && entitlementSource && entitlementSource !== "trial" && entitlementSource !== "enterprise" && entitlementSource !== "byo20" ? entitlementSource : null;
    // BYO Enterprise (Phase 2, 2026-08-24) -- resolved ONCE per message,
    // gated on entitlementSource === "enterprise" so a self-serve/trial
    // account (the overwhelming majority of traffic) never pays for the
    // extra Enterprise-entitlement lookup. Threaded through every real
    // AI-generation call site inside handleHumanMessage. `kind: "reactive"`
    // (explicit, Phase 4.V.1) -- this whole path only ever runs off a REAL
    // inbound Telegram message, never a scheduler tick, so it's always
    // governed by the customer's reactive usage-policy ceiling, never the
    // proactive one (Watcher Presence Scheduling's own, separate ceiling).
    // deploymentId is omitted (null) here -- no responder has been chosen
    // yet at this point; respondAsDeployment re-checks the deployment-scoped
    // ceiling once it knows which Watcher is actually about to generate
    // (applyDeploymentUsagePolicy, Phase 4.V.1 item 2).
    const aiRouting = await resolveAccountAiRouting(admin, accountId, entitlementSource === "enterprise", community.id, null, "reactive", entitlementSource === "byo20");
    // Media Moderation Units base allowance -- REVISED (2026-08-27, trial
    // capped 2026-09-02). Every real Watch plan now gets a real, controlled
    // INCLUDED allowance automatically -- resolved ONCE here (a plain
    // constant lookup, no I/O) from whichever tier this account actually
    // has: an Enterprise variant (via resolveEnterpriseMediaAddonKey, the
    // same resolver the Usage page reads, so display and enforcement can
    // never disagree about which package's allowance applies), byo20, a
    // self-serve paidTier, or -- per explicit product decision -- the Free
    // Trial's own TRIAL_MEDIA_MODERATION_ALLOWANCE (10% of Bronze's
    // allowance, kept DERIVED from money.ts's canonical Bronze value rather
    // than a second hardcoded number). Enterprise's OLD devops-granted
    // `mediaAddonActive` flag is no longer read here -- every Enterprise
    // account now gets its base allowance unconditionally, the same
    // "included on every plan" rule every other tier gets (the flag/column
    // still exist, just unused by this gate). `null` means "no
    // representable Watch plan" (a legacy Panel-distributed deployment) --
    // that falls through to runMediaModeration's own existing, unchanged
    // unmetered behavior; trial no longer falls into this bucket.
    const enterpriseEntitlement = entitlementSource === "enterprise" && accountId ? await resolveAccountEnterpriseEntitlement(admin, accountId) : null;
    const mediaBaseAllowance: number | null = enterpriseEntitlement
      ? ENTERPRISE_MEDIA_MODERATION_BASE_ALLOWANCE[resolveEnterpriseMediaAddonKey(enterpriseEntitlement.apiSourceMode, enterpriseEntitlement.slots)]
      : entitlementSource === "byo20" && accountId
        ? MEDIA_MODERATION_BASE_ALLOWANCE.byo20
        : paidTier
          ? MEDIA_MODERATION_BASE_ALLOWANCE[paidTier]
          : isTrialEntitlement && accountId
            ? TRIAL_MEDIA_MODERATION_ALLOWANCE
            : null;
    await handleHumanMessage(
      admin, integration.panel_id, community, message, event, isTrialEntitlement, timer, settings, accountId, paidTier, aiRouting, mediaBaseAllowance, chatterActive
    );
    timer.mark("total_request_duration", { totalMs: timer.totalMs() });
    return;
  }

  // EXTERNAL_BOT — always ignored here (spec §10).
}

/* ================================================== pending-reply sweep ==========
   The cron half of the real 120-second "wait, give a human the first
   opportunity" scheduler (see pending-reply.ts for the pure decision
   logic, and handleHumanMessage's own scheduling call for the write side).
   Deliberately kept IN this file rather than a separate *-runtime.ts module
   (the established convention for other Watch cron sweeps, e.g. presence-
   runtime.ts/autopost-runtime.ts) -- unlike those, this sweep is tightly
   coupled to community-runtime's own internals (respondAsDeployment,
   findChatterDeployments, loadRecentContext, the settings/entitlement
   resolution `handleCommunityUpdate` already does) and would need most of
   this file re-exported to live elsewhere. */

interface PendingReplyDbRow {
  id: string;
  community_id: string;
  panel_id: string | null;
  deployment_id: string;
  chat_id: string;
  message_thread_id: number | null;
  trigger_platform_message_id: string;
  sender_platform_id: string;
  sender_display_name: string | null;
  sender_username: string | null;
  message_text: string;
  action_kind: DeferredActionKind;
  scheduled_for: string;
  created_at: string;
}

async function loadCommunityById(admin: SupabaseClient, communityId: string) {
  const { data } = await admin
    .from("communities")
    .select("id, bot_ack_mode, collab_contact, project_id, connection_type, allow_solicitation, acknowledge_admin_mod, pending_reply_delay_seconds, promotion_channel_link, promotion_channel_name")
    .eq("id", communityId)
    .maybeSingle();
  return data as {
    id: string; bot_ack_mode: BotAckMode; collab_contact: string | null; project_id: string | null;
    connection_type: "community" | "escalation_group"; allow_solicitation: boolean | null;
    acknowledge_admin_mod: boolean | null; pending_reply_delay_seconds: number | null;
    promotion_channel_link: string | null; promotion_channel_name: string | null;
  } | null;
}

async function finishPendingReply(admin: SupabaseClient, id: string, status: "cancelled" | "expired" | "sent" | "failed", cancelReason?: string): Promise<void> {
  await admin.from("watch_pending_replies").update({ status, cancel_reason: cancelReason ?? null, resolved_at: new Date().toISOString() }).eq("id", id);
}

/** Revalidates + (if still warranted) actually fires ONE due pending reply.
 *  Re-resolves settings/entitlement/routing FRESH (never reused/persisted
 *  from scheduling time, ~120s+ earlier) -- both for correctness (reflects
 *  the account's CURRENT state, not a stale snapshot) and for safety (a
 *  decrypted BYO credential/aiRouting object is never written to the
 *  watch_pending_replies row in the first place). */
async function processDuePendingReply(admin: SupabaseClient, row: PendingReplyDbRow, now: Date): Promise<void> {
  if (isPendingReplyStale({ scheduledFor: row.scheduled_for }, now)) {
    await finishPendingReply(admin, row.id, "expired");
    return;
  }

  const deployments = await findChatterDeployments(admin, row.community_id);
  const deployment = deployments.find((d) => d.deploymentId === row.deployment_id);
  if (!deployment) {
    // No longer an active/enabled deployment for this community -- nothing
    // sensible to send as.
    await finishPendingReply(admin, row.id, "cancelled", "already_answered");
    return;
  }
  const community = await loadCommunityById(admin, row.community_id);
  if (!community) {
    await finishPendingReply(admin, row.id, "cancelled", "already_answered");
    return;
  }

  // Revalidation (§ "make sure the delayed response is revalidated before
  // sending"): already answered by a moderator, an admin/mod responded
  // since scheduling (belt-and-suspenders -- normally already caught by
  // cancel-on-arrival at write time), and whether the original asker is
  // still a member of the community.
  const recentContext = await loadRecentContext(admin, row.community_id, 25);
  const rowCreatedAt = new Date(row.created_at);
  const alreadyAnsweredByModerator = recentContext.some(
    (m) => m.senderType === "INNVIL_MODERATOR" && (m.messageThreadId ?? null) === row.message_thread_id && m.createdAt && new Date(m.createdAt) > rowCreatedAt
  );
  // Gap 2-consistent belt-and-suspenders check: the SAME conversation-
  // ownership definition as the synchronous cancel-on-arrival path
  // (isAdminMessageHandlingConversation), not merely "any different human
  // spoke in this topic afterward" -- an unrelated later message in a busy
  // topic must not falsely cancel this row here either. hasInterveningMessage
  // is derived from this already-loaded 25-message window (a bounded,
  // secondary check -- the primary defense is the synchronous path, this
  // only matters if that was somehow missed).
  const laterOtherHumans = recentContext.filter(
    (m) => m.senderType === "HUMAN" && (m.messageThreadId ?? null) === row.message_thread_id && m.senderPlatformId && m.senderPlatformId !== row.sender_platform_id && m.createdAt && new Date(m.createdAt) > rowCreatedAt
  );
  const token = await getBotTokenForDeployment(admin, deployment.deploymentId);
  let adminRespondedSinceScheduling = false;
  for (const candidate of laterOtherHumans) {
    const hasInterveningMessage = recentContext.some(
      (m) =>
        m.createdAt &&
        candidate.createdAt &&
        new Date(m.createdAt).getTime() > rowCreatedAt.getTime() &&
        new Date(m.createdAt).getTime() < new Date(candidate.createdAt).getTime()
    );
    const owns = isAdminMessageHandlingConversation({
      triggerPlatformMessageId: row.trigger_platform_message_id,
      triggerCreatedAt: row.created_at,
      askerMessageIds: recentContext.filter((m) => m.senderPlatformId === row.sender_platform_id && m.platformMessageId).map((m) => m.platformMessageId as string),
      adminMessage: { replyToPlatformMessageId: candidate.replyToPlatformMessageId ?? null, createdAt: candidate.createdAt as string },
      hasInterveningMessage,
    });
    if (owns && candidate.senderPlatformId && token && (await isSenderAdminOrTrusted(token, row.chat_id, candidate.senderPlatformId))) {
      adminRespondedSinceScheduling = true;
      break;
    }
  }
  // "Is the user still in the community?" -- a lookup failure (network
  // hiccup, transient Telegram error) fails SAFE by assuming still present:
  // a real answer is never withheld just because a status check briefly
  // failed, only when we can positively confirm the user actually left.
  let senderStillPresent = true;
  if (token) {
    const memberRes = await telegramApiCall<{ status: string }>(token, "getChatMember", { chat_id: row.chat_id, user_id: row.sender_platform_id });
    if (memberRes.ok) senderStillPresent = memberRes.result.status !== "left" && memberRes.result.status !== "kicked";
  }

  const validation = revalidatePendingReply({
    now, row: { scheduledFor: row.scheduled_for },
    alreadyAnsweredByModerator, adminRespondedSinceScheduling, senderStillPresent,
  });
  if (!validation.ok) {
    await finishPendingReply(admin, row.id, "cancelled", validation.reason);
    return;
  }

  // Fresh settings/entitlement resolution -- mirrors handleCommunityUpdate's
  // own setup exactly, re-derived rather than persisted from scheduling time.
  let settings: unknown = null;
  if (row.panel_id) {
    const { data: panel } = await admin.from("panels").select("settings").eq("id", row.panel_id).maybeSingle();
    settings = panel?.settings ?? null;
  } else {
    settings = await resolveStandaloneModeratorSettings(admin, deployment.moderatorId);
  }
  const entitlementSource = moderatorEntitlementSource(settings);
  const isTrialEntitlement = entitlementSource === "trial";
  const accountId = row.panel_id ? null : await resolveWatcherAccountId(admin, deployment.moderatorId);
  const paidTier: ModeratorPlanTier | null =
    !row.panel_id && entitlementSource && entitlementSource !== "trial" && entitlementSource !== "enterprise" && entitlementSource !== "byo20" ? entitlementSource : null;
  // A deferred reply fired later by the sweep is still a REACTIVE response
  // to a real inbound message -- same "reactive" kind as the original
  // webhook-time resolution, never the proactive/scheduled-presence kind.
  const aiRouting = await resolveAccountAiRouting(admin, accountId, entitlementSource === "enterprise", row.community_id, deployment.deploymentId, "reactive", entitlementSource === "byo20");

  const projectKnowledge = row.action_kind === "ANSWER" ? await loadRelevantKnowledge(admin, row.panel_id, row.community_id, row.message_text) : undefined;
  const communityKnowledge = row.action_kind === "ANSWER"
    ? await loadCommunityKnowledgeGrounding(admin, row.community_id, row.message_thread_id, row.chat_id, null, row.message_text, token)
    : undefined;
  const fallbackAdminMention = row.action_kind === "ANSWER" && community.project_id
    ? (await loadProjectProfileRow(admin, community.project_id))?.contacts?.support ?? null
    : null;
  const escalationTarget = row.action_kind === "ANSWER" && community.project_id ? await resolveProjectEscalationTarget(admin, community.project_id) : null;

  const event: CommunityEvent = {
    panelId: row.panel_id,
    communityId: row.community_id,
    integrationId: row.deployment_id,
    messageId: row.trigger_platform_message_id,
    sender: { senderType: "HUMAN", isBot: false, platformUserId: row.sender_platform_id, displayName: row.sender_display_name, username: row.sender_username },
    timestamp: row.created_at,
    text: row.message_text,
    replyToMessageId: null,
    messageThreadId: row.message_thread_id,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
  };

  let result = await respondAsDeployment({
    admin, panelId: row.panel_id, communityId: row.community_id, chatId: row.chat_id, event,
    deployment, actionType: row.action_kind, reasons: ["deferred_pending_reply_fired"], isTrialEntitlement, accountId, paidTier, now,
    recentContext,
    isDirectedAtBot: false,
    addressedWithTypo: false,
    otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== deployment.deploymentId).map((d) => d.moderatorName),
    collabContact: null,
    projectKnowledge,
    communityKnowledge,
    fallbackAdminMention,
    aiRouting,
    projectId: community.project_id ?? null,
    escalationTarget,
    timer: createRequestTimer(row.deployment_id),
  });

  // Decline-fallback reroute (ported to fire time, same shape as the
  // original synchronous version): the picked responder's own model
  // declined to answer (a reasoned "this isn't for me", never an infra
  // failure) and a DIFFERENT deployed moderator's name appears in the
  // message -- retry once with that moderator, treated as directed. The
  // human already waited their full delay for this already-approved
  // response, so the reroute itself runs immediately, no additional wait.
  // Bounded to a single retry, same as before.
  if (!result.replied && result.modelDeclined) {
    const lowerText = row.message_text.toLowerCase();
    const named = deployments.find(
      (d) => d.deploymentId !== deployment.deploymentId && d.moderatorName.trim() && lowerText.includes(d.moderatorName.trim().toLowerCase())
    );
    if (named) {
      result = await respondAsDeployment({
        admin, panelId: row.panel_id, communityId: row.community_id, chatId: row.chat_id, event,
        deployment: named, actionType: row.action_kind, reasons: ["deferred_pending_reply_fired", "decline_fallback_reroute"], isTrialEntitlement, accountId, paidTier, now,
        recentContext,
        isDirectedAtBot: true,
        addressedWithTypo: false,
        otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== named.deploymentId).map((d) => d.moderatorName),
        collabContact: null,
        projectKnowledge,
        communityKnowledge,
        fallbackAdminMention,
        aiRouting,
        projectId: community.project_id ?? null,
        escalationTarget,
        timer: createRequestTimer(named.deploymentId),
      });
    }
  }
  await finishPendingReply(admin, row.id, result.replied ? "sent" : "failed");
}

/** Entry point for the pending-replies cron (app/api/cron/pending-replies).
 *  Claims a bounded batch of due rows via a conditional UPDATE (status
 *  'pending' -> 'sending', matching WHERE status='pending' still holds) so
 *  two overlapping sweep invocations can never both process the same row --
 *  the loser's update simply matches zero rows and is skipped. */
export async function sweepPendingReplies(admin: SupabaseClient, now: Date = new Date(), limit = 25): Promise<{ processed: number }> {
  const { data: dueRows } = await admin
    .from("watch_pending_replies")
    .select("id, community_id, panel_id, deployment_id, chat_id, message_thread_id, trigger_platform_message_id, sender_platform_id, sender_display_name, sender_username, message_text, action_kind, scheduled_for, created_at")
    .eq("status", "pending")
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  let processed = 0;
  for (const row of (dueRows ?? []) as PendingReplyDbRow[]) {
    const { data: claimed } = await admin
      .from("watch_pending_replies")
      .update({ status: "sending" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // lost the claim race, or already resolved (e.g. cancelled) between the select and here
    processed++;
    try {
      await processDuePendingReply(admin, row, now);
    } catch (err) {
      console.error("[telegram/community] processDuePendingReply failed", row.id, err);
      await finishPendingReply(admin, row.id, "failed");
    }
  }
  return { processed };
}
