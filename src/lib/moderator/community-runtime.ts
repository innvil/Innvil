import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall, getTelegramFile, downloadTelegramFileBuffer, TELEGRAM_MAX_DOWNLOADABLE_BYTES } from "./telegram-client";
import {
  virtualModBotAcknowledgement, virtualModNaturalChatterActive, virtualModMediaModeration, virtualModVideoModeration,
  moderatorEntitlementSource, TRIAL_REACTIVE_DAILY_LIMIT,
  hasVirtualModerator, moderatorCapacity, TRIAL_DURATION_DAYS,
  communityCountExceeded, checkDeploymentSlotCaps, deploymentSlotCheckErrorMessage,
} from "./plan";
import { decideBotAcknowledgement, type BotAckMode, type EligibleTarget } from "./coordinator";
import {
  selectChatterAction, resolveDirectedModerator, resolveMultiTargetAddress, requiresIndividualContribution,
  isRoomWideAddress, roomWideResponderCount,
  isAmbientOpenerFallbackCandidate, resolveAmbientOpenerFallback, resolveAdditionalReactors,
  MAX_ADDITIONAL_RESPONDERS, type ChatterCandidate, type ChatterPacingState,
} from "./chatter-coordinator";
import { generateChatterReply, shortAckText, classifyAmbientGreeting, personaReactionEmoji, type ChatterContextMessage } from "./chatter-generate";
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
  COLLAB_ROUTABLE_CATEGORIES, PROMOTION_WARNING_LIMIT, type LinkWarningState,
  effectiveScamStrikeCount, renderHumanModerationMention, scamFirstOffenseWarningHtml, scamRepeatOffenseWarningHtml,
  filterOutOwnBotMentions,
} from "./link-moderation";
import { classifyLinkIntent, generateModerationWarning } from "./link-classify";
import {
  decideMediaEnforcement, computeSamplePositions, classifySampledFrames,
  type MediaKind, type MediaClassificationResult,
} from "./media-moderation";
import { classifyImageBytes } from "./media-safety-provider";
import { extractVideoFrames } from "./media-frame-extractor";
import { generateMediaModerationWarning } from "./media-warning";
import { checkChatMembership, type ChatMembershipResult } from "./manager";
import {
  resolveStandaloneModeratorSettings, resolveWatcherAccountId, resolveAccountAiRouting,
  MANAGED_AI_ROUTING, type AccountAiRouting,
} from "@/src/lib/products/watch-runtime";
import { recordByoUsageEvent } from "@/src/lib/products/watch-byo-usage";

/** Fire-and-forget BYO usage telemetry -- only ever called when
 *  `aiRouting.required` is true (a Managed account has nothing BYO-specific
 *  to record). Never awaited by callers, and recordByoUsageEvent itself
 *  never throws (best-effort) -- a telemetry write must never add latency
 *  to, or break, the 30s-bounded webhook handler it's called from.
 *
 *  Scoped to respondAsDeployment's own generateChatterReply outcome ONLY --
 *  the ONE call site with a genuine, unambiguous ok/error signal to record
 *  (matches the scope of Innvil's own MODERATOR_AI_GENERATION_POOL metering
 *  for Managed accounts). classifyLinkIntent/classifyAmbientGreeting/the
 *  warning-generation functions all degrade gracefully to a safe fallback
 *  on ANY failure by design (never throw, never expose a clean success/
 *  failure distinction in their return shape) -- recording them as "ok"
 *  regardless of whether the underlying call actually succeeded would be
 *  fabricated telemetry, so they are deliberately NOT instrumented here. */
function recordByoCall(
  admin: SupabaseClient, aiRouting: AccountAiRouting, accountId: string | null, communityId: string, automation: string, ok: boolean, error?: string
): void {
  if (!aiRouting.required || !accountId) return;
  void recordByoUsageEvent(admin, {
    accountId, communityId, automation,
    provider: aiRouting.credential?.provider ?? "unconfigured",
    model: aiRouting.credential?.model ?? "unconfigured",
    ok, error,
  });
}
import { resolveAccountBillingPeriod, getWatchAiGenerationUsage, incrementWatchAiGenerationUsage, hasAiGenerationPoolRemaining } from "@/src/lib/products/watch-ai-usage";
import { getMediaModerationAddonState } from "@/src/lib/products/watch-media-moderation-addon";
import {
  getWatchMediaModerationUsage, incrementWatchMediaModerationUsage, hasMediaModerationUnitsRemaining,
} from "@/src/lib/products/watch-media-moderation-usage";
import type { ModeratorPlanTier } from "@/src/lib/money";

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
  /** Telegram sends an ARRAY of the same photo at multiple resolutions
   *  (smallest first) — the LAST entry is the highest resolution without
   *  needing to fetch/compare every variant. */
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  animation?: TelegramAnimation;
  document?: TelegramDocument;
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
    .select("id, bot_ack_mode, collab_contact")
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

  return data as { id: string; bot_ack_mode: BotAckMode; collab_contact: string | null };
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

const KNOWLEDGE_SELECT = "id, panel_id, scope_type, project_id, community_id, kind, title, content, active";

function toKnowledgeSources(rows: Array<Record<string, unknown>> | null): KnowledgeSource[] {
  return (rows ?? []).map((r) => ({
    id: r.id as string, panelId: r.panel_id as string, scopeType: r.scope_type as KnowledgeSource["scopeType"],
    projectId: (r.project_id as string) ?? null, communityId: (r.community_id as string) ?? null, kind: r.kind as KnowledgeSource["kind"],
    title: (r.title as string) ?? "", content: (r.content as string) ?? "", active: r.active !== false,
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
  moderatorName: string;
  persona: ModeratorPersona;
  botUsername: string | null;
}

/** All chatter-eligible deployments in this community — every ENABLED
 *  ModeratorDeployment, not just one. Selection among them happens in
 *  selectChatterAction (chatter-coordinator.ts): the Coordinator picks one
 *  social action and AT MOST ONE responder per human message, never runs a
 *  separate decision per deployment. */
async function findChatterDeployments(admin: SupabaseClient, communityId: string): Promise<ChatterDeployment[]> {
  const { data: deployments } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id, virtual_moderators(name, persona)")
    .eq("community_id", communityId)
    .eq("enabled", true);
  const rows = (deployments ?? []) as Array<{
    id: string;
    moderator_id: string;
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
      moderatorName: vm?.name ?? "Moderator",
      persona: normalizeModeratorPersona(vm?.persona),
      botUsername: usernameByModeratorId.get(row.moderator_id) ?? null,
    };
  });
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
    .select("sender_type, sender_display_name, sender_platform_id, text, deployment_id, created_at")
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
    }));
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
      if (!generation.ok || "noReply" in generation) break; // can't produce a turn right now -- leave the task exactly as-is, don't corrupt state
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
// independent of, and is never disabled by, the reactive chatter quota
// (spec §45), and needs no @mention (spec §46). See link-moderation.ts for
// the pure classification/policy layer this section persists state for and
// executes enforcement from.

async function loadLinkWarningState(admin: SupabaseClient, communityId: string, platformUserId: string): Promise<LinkWarningState> {
  const { data } = await admin
    .from("moderator_link_warning_state")
    .select("warning_count, recent_link_hash, recent_link_at, recent_link_count_in_window, scam_strike_count, scam_strike_at")
    .eq("community_id", communityId)
    .eq("platform_user_id", platformUserId)
    .maybeSingle();
  if (!data) return EMPTY_WARNING_STATE;
  return {
    warningCount: data.warning_count ?? 0,
    recentLinkHash: data.recent_link_hash ?? null,
    recentLinkAt: data.recent_link_at ?? null,
    recentLinkCountInWindow: data.recent_link_count_in_window ?? 0,
    scamStrikeCount: data.scam_strike_count ?? 0,
    scamStrikeAt: data.scam_strike_at ?? null,
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
      recent_link_hash: state.recentLinkHash,
      recent_link_at: state.recentLinkAt,
      recent_link_count_in_window: state.recentLinkCountInWindow,
      scam_strike_count: state.scamStrikeCount,
      scam_strike_at: state.scamStrikeAt,
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
  community: { id: string },
  chatId: string,
  event: CommunityEvent,
  deployments: ChatterDeployment[],
  now: Date,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING
): Promise<{ handled: boolean; collabRoutable: boolean }> {
  const links = extractLinks(event.text);
  if (!links.length || !deployments.length) return { handled: false, collabRoutable: false };

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
  const moderationCandidates = filterOutOwnBotMentions(links, deployments.map((d) => d.botUsername));
  if (!moderationCandidates.length) return { handled: false, collabRoutable: false };

  const enforcer = deployments[0];
  const senderPlatformId = event.sender.platformUserId;

  const priorState = await loadLinkWarningState(admin, community.id, senderPlatformId);
  const observedState = recordLinkObservation(priorState, linkHash(moderationCandidates[0]), now);
  const floodRepeat = isFloodRepeat(observedState);

  const recentContextSummary = (await loadRecentContext(admin, community.id, 6)).map((m) => `${m.senderName ?? "Someone"}: ${m.text}`).join("\n");
  const classification = await classifyLinkIntent(event.text, recentContextSummary, aiRouting);

  const token = await getBotTokenForDeployment(admin, enforcer.deploymentId);
  const isAdminOrTrusted = token ? await isSenderAdminOrTrusted(token, chatId, senderPlatformId) : false;

  const priorScamStrikeCount = effectiveScamStrikeCount(priorState.scamStrikeCount, priorState.scamStrikeAt, now);

  const enforcement = decideLinkEnforcement({
    category: classification.category,
    confidence: classification.confidence,
    isAdminOrTrusted,
    floodRepeat,
    priorWarningCount: priorState.warningCount,
    priorScamStrikeCount,
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
      { ...observedState, warningCount: priorState.warningCount, scamStrikeCount: priorState.scamStrikeCount, scamStrikeAt: priorState.scamStrikeAt },
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
    // Second confirmed high-confidence scam/phishing offense within the
    // active strike window -- REMOVES the user (kick), never a permanent
    // ban on its own (see event-types.ts's RESTRICT_USER doc comment).
    if (token) {
      const kickResult = await executeAction(admin, chatId, { kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: senderPlatformId, mode: "KICK" });
      if (!kickResult.ok) console.error("[telegram/community] link moderation RESTRICT_USER (kick) failed", kickResult.error);
    }
    // Strike is recorded regardless of whether the kick itself succeeded --
    // per spec "Kick failure: preserve the second strike" (a duplicate
    // webhook delivery of the SAME message never reaches here a second
    // time at all, since recordCommunityMessage's claim already made this
    // whole function run at most once per real message).
    const nextState: LinkWarningState = { ...observedState, scamStrikeCount: priorScamStrikeCount + 1, scamStrikeAt: now.toISOString() };
    await persistLinkWarningState(admin, panelId, community.id, senderPlatformId, nextState, { kind: enforcement.reason, now });

    const mention = renderHumanModerationMention(senderPlatformId, event.sender.username ?? null, event.sender.displayName);
    const warningText = scamRepeatOffenseWarningHtml(mention);
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
    return { handled: true, collabRoutable: false };
  }

  // DELETE_WARN -- either ordinary unsolicited-promotion escalation (AI-
  // phrased, unchanged) or a FIRST confirmed scam/phishing offense
  // (deterministic/template-based ONLY -- never a model call, never
  // reproduces the malicious URL).
  const nextState: LinkWarningState = isScamEnforcement
    ? { ...observedState, scamStrikeCount: priorScamStrikeCount + 1, scamStrikeAt: now.toISOString() }
    : { ...observedState, warningCount: enforcement.warningNumber };
  await persistLinkWarningState(admin, panelId, community.id, senderPlatformId, nextState, { kind: enforcement.reason, now });

  // Every DELETE_WARN now explicitly mentions the offender -- deterministic
  // in both cases (never AI-decided formatting): the scam template embeds
  // it directly; the ordinary unsolicited-promotion warning keeps its
  // EXISTING AI-phrased body (unchanged generation logic, per explicit
  // "don't rewrite detection/generation unless required") and is prefixed
  // with the SAME mention mechanism deterministically, never asking the
  // model to compose or format the mention itself.
  const mention = renderHumanModerationMention(senderPlatformId, event.sender.username ?? null, event.sender.displayName);
  const warningText = isScamEnforcement
    ? scamFirstOffenseWarningHtml(mention)
    : `${mention}, ${await generateModerationWarning(
        enforcer.moderatorName, enforcer.persona, enforcement.warningNumber, enforcement.warningNumber >= PROMOTION_WARNING_LIMIT, aiRouting
      )}`;
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

async function loadMediaDedup(admin: SupabaseClient, communityId: string, fileUniqueId: string): Promise<{ enforcementKind: "ALLOW" | "DELETE_WARN" | "DELETE_BAN" } | null> {
  const { data } = await admin.from("moderator_media_dedup").select("enforcement_kind").eq("community_id", communityId).eq("file_unique_id", fileUniqueId).maybeSingle();
  if (!data) return null;
  return { enforcementKind: data.enforcement_kind as "ALLOW" | "DELETE_WARN" | "DELETE_BAN" };
}

async function recordMediaDedup(admin: SupabaseClient, panelId: string | null, communityId: string, fileUniqueId: string, verdict: "safe" | "uncertain" | "explicit" | "error", enforcementKind: "ALLOW" | "DELETE_WARN" | "DELETE_BAN") {
  await admin.from("moderator_media_dedup").upsert(
    { panel_id: panelId, community_id: communityId, file_unique_id: fileUniqueId, verdict, enforcement_kind: enforcementKind },
    { onConflict: "community_id,file_unique_id" }
  );
}

/** Same overall shape as runLinkModeration: a SEPARATE moderation decision,
 *  checked once per message via a SINGLE enforcer (deployments[0] — the
 *  SAME single-coordinated-actor pattern link moderation already uses, so
 *  an explicit upload never produces one action per deployed moderator).
 *  `handled: true` means the message was deleted (nothing left to
 *  task-route/chat about). */
async function runMediaModeration(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string },
  chatId: string,
  message: TelegramMessage,
  event: CommunityEvent,
  deployments: ChatterDeployment[],
  settings: unknown,
  now: Date,
  accountId: string | null = null,
  paidTier: ModeratorPlanTier | null = null,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING
): Promise<{ handled: boolean }> {
  if (!virtualModMediaModeration(settings) || !deployments.length) return { handled: false };

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
    await logActivity(admin, panelId, community.id, deployments[0].deploymentId, "media_moderation", "SKIPPED", "too_large", { mediaKind: media.kind, fileSize: media.fileSize });
    return { handled: false };
  }
  if (media.kind !== "photo") {
    if (!virtualModVideoModeration(settings)) return { handled: false }; // video moderation not yet enabled -- skip silently, never treated as explicit
    if (media.durationS != null && media.durationS > MEDIA_MAX_VIDEO_DURATION_S) {
      await recordMediaDedup(admin, panelId, community.id, media.fileUniqueId, "error", "ALLOW");
      await logActivity(admin, panelId, community.id, deployments[0].deploymentId, "media_moderation", "SKIPPED", "duration_exceeded", { mediaKind: media.kind, durationS: media.durationS });
      return { handled: false };
    }
  }

  // Media Moderation + gate -- self-serve accounts ONLY (paidTier is null
  // for trial/enterprise/legacy Panel-distributed accounts, which all keep
  // running media moderation unmetered exactly as before this gate existed
  // -- trial can't purchase an add-on at all, and Enterprise's own Media
  // Moderation + is inquiry/manual-provisioning with no persisted
  // entitlement state to check against, see money.ts's ENTERPRISE_MEDIA_ADDON
  // doc comment). A self-serve account with NO active add-on, or one that's
  // exhausted its real monthly allowance, gets a silent skip -- never a
  // fabricated explicit result, never a deleted message, matching every
  // other "can't classify" case in this function. Deliberately NOT run
  // through recordMediaDedup's cache: unlike too_large/duration_exceeded
  // (permanent properties of the file), addon/allowance state is temporal
  // -- caching it would incorrectly blacklist a file from ever being
  // reclassified once the add-on is purchased or the period rolls over.
  let mediaUsagePeriod: Awaited<ReturnType<typeof resolveAccountBillingPeriod>> = null;
  if (accountId && paidTier) {
    const addon = await getMediaModerationAddonState(admin, accountId, paidTier);
    if (!addon || !addon.active) {
      await logActivity(admin, panelId, community.id, deployments[0].deploymentId, "media_moderation", "SKIPPED", "media_addon_required", { mediaKind: media.kind });
      return { handled: false };
    }
    mediaUsagePeriod = await resolveAccountBillingPeriod(admin, accountId);
    if (mediaUsagePeriod) {
      const used = await getWatchMediaModerationUsage(admin, accountId, mediaUsagePeriod.start);
      if (!hasMediaModerationUnitsRemaining(used, addon.units)) {
        await logActivity(admin, panelId, community.id, deployments[0].deploymentId, "media_moderation", "SKIPPED", "media_allowance_exhausted", { mediaKind: media.kind });
        return { handled: false };
      }
    }
  }

  const enforcer = deployments[0];
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

  // Unified content-policy strike counter -- reuses the SAME per-(community,
  // user) warning state link moderation already maintains, rather than a
  // second parallel warning system.
  const priorState = await loadLinkWarningState(admin, community.id, event.sender.platformUserId);
  const enforcement = decideMediaEnforcement({ result, priorWarningCount: priorState.warningCount });

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

  if (enforcement.kind === "DELETE_BAN") {
    if (token) {
      const banResult = await executeAction(admin, chatId, { kind: "RESTRICT_USER", targetDeploymentId: enforcer.deploymentId, targetPlatformUserId: event.sender.platformUserId, mode: "BAN" });
      if (!banResult.ok) console.error("[telegram/community] media moderation RESTRICT_USER failed", banResult.error);
    }
    await persistLinkWarningState(admin, panelId, community.id, event.sender.platformUserId, priorState, { kind: enforcement.reason, now });
    return { handled: true };
  }

  // DELETE_WARN
  const nextState: LinkWarningState = { ...priorState, warningCount: enforcement.warningNumber };
  await persistLinkWarningState(admin, panelId, community.id, event.sender.platformUserId, nextState, { kind: enforcement.reason, now });
  const warningText = await generateMediaModerationWarning(
    enforcer.moderatorName, enforcer.persona, enforcement.warningNumber, enforcement.warningNumber >= PROMOTION_WARNING_LIMIT, aiRouting
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
  return { handled: true };
}

async function handleHumanMessage(
  admin: SupabaseClient,
  panelId: string | null,
  community: { id: string; collab_contact?: string | null },
  message: TelegramMessage,
  event: CommunityEvent,
  isTrialEntitlement: boolean,
  timer: RequestTimer,
  settings: unknown,
  accountId: string | null = null,
  paidTier: ModeratorPlanTier | null = null,
  aiRouting: AccountAiRouting = MANAGED_AI_ROUTING
) {
  const deployments = await findChatterDeployments(admin, community.id);
  timer.mark("chatter_deployment_lookup", { deploymentCount: deployments.length });
  if (!deployments.length) return; // no chatter-eligible deployment in this community

  // Media moderation is a SEPARATE decision, checked BEFORE link moderation
  // -- a message that's a flagged photo/video has nothing left to check for
  // links/task-route/chat about either. Never routed through DeepSeek/Claude
  // conversational paths -- only the specialized visual-safety classifier.
  // aiRouting only ever affects the WARNING TEXT (media-warning.ts) -- the
  // vision classifier itself (media-safety-provider.ts) is never BYO-routed
  // (see watch-byo.ts's own scope note).
  const chatId = String(message.chat.id);
  const mediaModeration = await runMediaModeration(admin, panelId, community, chatId, message, event, deployments, settings, new Date(), accountId, paidTier, aiRouting);
  timer.mark("media_moderation_check", { handled: mediaModeration.handled });
  if (mediaModeration.handled) return;

  // Link moderation is a SEPARATE decision from chatter (spec §18/§50) --
  // checked first, independent of and never disabled by the reactive
  // chatter quota (spec §45). If the message got deleted, there is nothing
  // left to task-route or chat about, so it short-circuits everything else.
  const moderation = await runLinkModeration(admin, panelId, community, chatId, event, deployments, new Date(), aiRouting);
  timer.mark("link_moderation_check", { handled: moderation.handled });
  if (moderation.handled) return;
  const collabContact = moderation.collabRoutable ? (community.collab_contact ?? null) : null;

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

  // Picks the socially appropriate ACTION (SILENCE/REACT/SHORT_ACK/
  // CASUAL_CHAT/ANSWER) and AT MOST ONE responder across every eligible
  // deployment — deterministic, no probability roll anywhere.
  let action = selectChatterAction({ text: event.text, candidates, now: new Date(), recentlyAnsweredByModerator, recentlyRespondedByHuman });
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

  // Phase 4.N — retrieved ONCE per triggering message (not per responder),
  // only for ANSWER (substantive Q&A never grounds casual chatter in
  // project facts). Empty when nothing relevant matches -- passed through
  // as undefined so generateChatterReply's prompt correctly omits the
  // "Project knowledge" block entirely rather than injecting an empty one.
  const projectKnowledge = action.type === "ANSWER" ? await loadRelevantKnowledge(admin, panelId, community.id, event.text) : undefined;

  let primaryResult = await respondAsDeployment({
    admin, panelId, communityId: community.id, chatId: String(message.chat.id), event,
    deployment, actionType: action.type, reasons: action.reasons, isTrialEntitlement, accountId, paidTier, now,
    recentContext,
    isDirectedAtBot: candidates.find((c) => c.deploymentId === deployment.deploymentId)?.isDirectedAtBot ?? false,
    addressedWithTypo: directedMatch?.isTypo === true && directedMatch.deploymentId === deployment.deploymentId,
    otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== deployment.deploymentId).map((d) => d.moderatorName),
    collabContact,
    projectKnowledge,
    aiRouting,
    timer,
  });
  let respondingDeployment = deployment;

  // ---- decline-fallback reroute (explicit product decision, 2026-08-20) ----
  // The primary responder was picked by continuity/quietest-longest (this
  // message didn't clearly ADDRESS anyone -- if it had, `deployment` above
  // would already BE the named moderator). If that pick's own model
  // declines to answer (a reasoned "this isn't really about/for me", not an
  // infra failure -- generation timeouts/failures/quota exhaustion are a
  // different problem a reroute wouldn't fix), and a DIFFERENT deployed
  // moderator's name appears anywhere in the message ("how about Ms VP?"),
  // retry with that moderator once, treating it as directed. Bounded to a
  // SINGLE retry -- never chains further even if the reroute also declines.
  if (!primaryResult.replied && primaryResult.modelDeclined) {
    const lowerText = event.text.toLowerCase();
    const named = deployments.find(
      (d) => d.deploymentId !== deployment.deploymentId && d.moderatorName.trim() && lowerText.includes(d.moderatorName.trim().toLowerCase())
    );
    if (named) {
      const rerouted = await respondAsDeployment({
        admin, panelId, communityId: community.id, chatId: String(message.chat.id), event,
        deployment: named, actionType: action.type, reasons: [...action.reasons, "decline_fallback_reroute"], isTrialEntitlement, accountId, paidTier, now,
        recentContext,
        isDirectedAtBot: true,
        addressedWithTypo: false,
        otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== named.deploymentId).map((d) => d.moderatorName),
        collabContact,
        projectKnowledge,
        aiRouting,
        timer,
      });
      if (rerouted.replied) {
        primaryResult = rerouted;
        respondingDeployment = named;
      }
    }
  }

  // ---- explicit multi-target address: additional independent responders ----
  // Human group conversation is not turn-based -- the primary moderator
  // answering above does not consume the human's turn. Only ever consulted
  // when the PRIMARY action was already a real reply (never for
  // REACT/SHORT_ACK/SILENCE, both of which returned before this point, or
  // for SHORT_ACK, which carries no generation to independently vary by
  // persona anyway). Each additional responder gets its OWN independent
  // generation call (own persona/own prompt) -- never a copy of the
  // primary's reply -- and is sent serialized, within this SAME
  // handleHumanMessage invocation triggered by the one claimed human event
  // (never a new webhook delivery or recursive bot-observation path), so no
  // new loop-safety code is needed: the bot-ack branch in
  // handleCommunityUpdate is a separate, untouched code path gated on
  // senderType === "INNVIL_MODERATOR".
  if (action.type === "CASUAL_CHAT" || action.type === "ANSWER") {
    const multiTargets = resolveMultiTargetAddress(
      event.text,
      deployments.map((d) => ({ deploymentId: d.deploymentId, name: d.moderatorName, botUsername: d.botUsername }))
    );
    if (multiTargets) {
      // A genuine room-wide address ("everyone"/"everybody") engages every
      // currently deployed moderator (not the fixed small-group cap used
      // for "you both"/"you guys") -- capped at MAX_ROOM_WIDE_RESPONDERS
      // for a very large deployment. See roomWideResponderCount's own doc
      // comment (chatter-coordinator.ts).
      const additionalCap = isRoomWideAddress(event.text)
        ? Math.max(0, roomWideResponderCount(deployments.length) - 1)
        : undefined;
      const additionalIds = resolveAdditionalResponderIds(respondingDeployment.deploymentId, multiTargets, additionalCap);
      // Whether the human's request is inherently per-person ("tell me about
      // yourself") vs. a shared/collective one a single sufficient answer
      // already covers ("why are you two replying like that?") -- decided
      // once per message, not per responder, since it's a property of the
      // QUESTION, not of who's answering it.
      const individualContributionExpected = requiresIndividualContribution(event.text);
      // Accumulates every reply actually sent to THIS message so far, so a
      // second additional responder (when the cap allows one) sees BOTH
      // prior replies, not just the primary's.
      const priorResponses: { moderatorName: string; text: string }[] = primaryResult.replied
        ? [{ moderatorName: respondingDeployment.moderatorName, text: primaryResult.text }]
        : [];
      for (const id of additionalIds) {
        const additionalDeployment = deployments.find((d) => d.deploymentId === id);
        if (!additionalDeployment) continue;
        const result = await respondAsDeployment({
          admin, panelId, communityId: community.id, chatId: String(message.chat.id), event,
          deployment: additionalDeployment, actionType: action.type, reasons: ["multi_target_address"], isTrialEntitlement, accountId, paidTier, now,
          recentContext,
          // Each additional responder answers on its own merit, not because
          // it was @mentioned individually -- but a genuine multi-target
          // address ("Kwan and Test, thoughts?") is directed at both, so it
          // should bypass pacing/cooldown the same way a single directed
          // mention would (see chatter-coordinator.ts bypassesPacing).
          isDirectedAtBot: true,
          addressedWithTypo: false,
          otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== additionalDeployment.deploymentId).map((d) => d.moderatorName),
          // Distinct-contribution rule (chatter-generate.ts's
          // obligationContextLines): grounds "did someone already cover
          // this?" in what was actually said, and tells the model whether
          // its own contribution is still individually required.
          priorResponsesToThisMessage: priorResponses,
          individualContributionExpected,
          collabContact,
          projectKnowledge,
          aiRouting,
          timer,
        });
        if (result.replied) priorResponses.push({ moderatorName: additionalDeployment.moderatorName, text: result.text });
      }
    }
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
  /** BYO Enterprise (Phase 2, 2026-08-24) -- the account's already-resolved
   *  AI-provider routing decision (see GenerateChatterReplyInput's own doc
   *  comment). Defaults to MANAGED_AI_ROUTING when omitted. */
  aiRouting?: AccountAiRouting;
  timer: RequestTimer;
}): Promise<{ replied: false; modelDeclined?: boolean } | { replied: true; text: string }> {
  const {
    admin, panelId, communityId, chatId, event, deployment, actionType, reasons, isTrialEntitlement, accountId, paidTier, now, recentContext,
    isDirectedAtBot, addressedWithTypo, otherActiveModeratorNames, priorResponsesToThisMessage, individualContributionExpected, collabContact, projectKnowledge, timer,
    aiRouting = MANAGED_AI_ROUTING,
  } = params;

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
        aiRouting,
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
      recordByoCall(admin, aiRouting, accountId, communityId, `NATURAL_CHATTER_${actionType}`, false, "generation timed out");
      return { replied: false };
    }
    const generation = genRace.value;

    if (!generation.ok) {
      console.error("[telegram/community] chatter generation failed", generation.error);
      await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "GENERATION_FAILED", reasons.join(","), { reasons });
      recordByoCall(admin, aiRouting, accountId, communityId, `NATURAL_CHATTER_${actionType}`, false, generation.error);
      return { replied: false };
    }
    if ("noReply" in generation) {
      await logActivity(admin, panelId, communityId, deployment.deploymentId, "human_message", "MODEL_DECLINED", reasons.join(","), { reasons });
      // A genuine successful BYO call -- the model responded, it just chose
      // not to reply. Real provider spend happened, so this counts as a
      // successful call for telemetry purposes, same as any real reply.
      recordByoCall(admin, aiRouting, accountId, communityId, `NATURAL_CHATTER_${actionType}`, true);
      return { replied: false, modelDeclined: true };
    }
    replyText = generation.reply;
    recordByoCall(admin, aiRouting, accountId, communityId, `NATURAL_CHATTER_${actionType}`, true);

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
  if (!message?.from || !message.chat) { timer.mark("no_message_or_sender"); return; }

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

  const sender = await classifySender(admin, integration.panel_id, community.id, message.from);

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
    const chatterActive = virtualModNaturalChatterActive(settings);
    timer.mark("natural_chatter_entitlement_gate", { active: chatterActive });
    if (!chatterActive) return;
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
    const paidTier: ModeratorPlanTier | null =
      !integration.panel_id && entitlementSource && entitlementSource !== "trial" && entitlementSource !== "enterprise" ? entitlementSource : null;
    // BYO Enterprise (Phase 2, 2026-08-24) -- resolved ONCE per message,
    // gated on entitlementSource === "enterprise" so a self-serve/trial
    // account (the overwhelming majority of traffic) never pays for the
    // extra Enterprise-entitlement lookup. Threaded through every real
    // AI-generation call site inside handleHumanMessage.
    const aiRouting = await resolveAccountAiRouting(admin, accountId, entitlementSource === "enterprise");
    await handleHumanMessage(admin, integration.panel_id, community, message, event, isTrialEntitlement, timer, settings, accountId, paidTier, aiRouting);
    timer.mark("total_request_duration", { totalMs: timer.totalMs() });
    return;
  }

  // EXTERNAL_BOT — always ignored here (spec §10).
}
