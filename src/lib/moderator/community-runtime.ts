import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { virtualModBotAcknowledgement, virtualModNaturalChatterActive, moderatorEntitlementSource, TRIAL_REACTIVE_DAILY_LIMIT } from "./plan";
import { decideBotAcknowledgement, type BotAckMode, type EligibleTarget } from "./coordinator";
import {
  selectChatterAction, resolveDirectedModerator, isAmbientOpenerFallbackCandidate, resolveAmbientOpenerFallback,
  type ChatterCandidate, type ChatterPacingState,
} from "./chatter-coordinator";
import { generateChatterReply, shortAckText, classifyAmbientGreeting, type ChatterContextMessage } from "./chatter-generate";
import { normalizeModeratorPersona, type ModeratorPersona } from "./domain";
import { classifySender as classifySenderPure, type CommunityEvent, type CommunityAction } from "./event-types";

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

type TelegramChat = { id: number; type?: string; title?: string; username?: string };
type TelegramUser = { id: number; is_bot?: boolean; username?: string; first_name?: string };
type TelegramMessage = {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  reply_to_message?: { message_id: number };
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
  return data as { id: string; panel_id: string; virtual_moderator_id: string; telegram_bot_id: number | null } | null;
}

async function resolveCommunity(admin: SupabaseClient, panelId: string, chat: TelegramChat) {
  const chatId = String(chat.id);
  const { data, error } = await admin
    .from("communities")
    .upsert(
      { panel_id: panelId, platform: "telegram", chat_id: chatId, handle: chat.username ?? null, title: chat.title ?? null, chat_type: chat.type ?? null },
      { onConflict: "panel_id,platform,chat_id" }
    )
    .select("id, bot_ack_mode")
    .single();
  if (error || !data) return null;
  return data as { id: string; bot_ack_mode: BotAckMode };
}

/** Tenant-isolated sender classification (spec §2/§4/§5) — the DB lookups behind event-types.ts's pure decision. */
async function classifySender(admin: SupabaseClient, panelId: string, communityId: string, from: TelegramUser): Promise<CommunityEvent["sender"]> {
  const platformUserId = String(from.id);
  if (!from.is_bot) {
    return { platformUserId, isBot: false, senderType: "HUMAN", displayName: from.first_name ?? from.username ?? null };
  }

  // Never filter by panel here — deliberately fetch ALL integrations sharing
  // this numeric bot id, then require an EXACT match on THIS event's panel.
  // A bot id known to Innvil under a different tenant must never be trusted.
  const { data: candidates } = await admin
    .from("telegram_bot_integrations")
    .select("id, panel_id, virtual_moderator_id, username")
    .eq("telegram_bot_id", from.id)
    .limit(5);
  const integration = (candidates ?? []).find((c) => c.panel_id === panelId) ?? null;

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
  return {
    platformUserId,
    isBot: true,
    senderType,
    displayName: from.username ?? from.first_name ?? null,
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
  panelId: string,
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

/** Persists the provenance of a bot-ack SEND_TEXT reply so resolveEventOrigin
 *  can recognize it when another bot's webhook re-classifies this same
 *  message. REACT actions never call this — a reaction isn't delivered as a
 *  new "message" update, so there's nothing for another webhook to
 *  re-classify and no loop risk to guard against. */
async function recordBotAckReply(
  admin: SupabaseClient,
  panelId: string,
  communityId: string,
  sentMessageId: string,
  action: Extract<CommunityAction, { kind: "SEND_TEXT" }>
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
    origin: action.origin,
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
    return { sentMessageId: null, ok: res.ok, error: res.ok ? undefined : res.error };
  }

  if (action.kind === "SEND_TEXT") {
    const res = await telegramApiCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: action.text,
      reply_to_message_id: action.replyToMessageId ?? undefined,
    });
    return { sentMessageId: res.ok ? String(res.result.message_id) : null, ok: res.ok, error: res.ok ? undefined : res.error };
  }

  return { sentMessageId: null, ok: true };
}

/* ----------------------------------------------------------- observability ---- */

async function logActivity(
  admin: SupabaseClient,
  panelId: string,
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

async function logBotAckDecision(admin: SupabaseClient, panelId: string, communityId: string, event: CommunityEvent, action: CommunityAction) {
  await logActivity(admin, panelId, communityId, event.sender.deploymentId ?? null, "bot_message", action.kind, event.sender.senderType, {
    interactionDepth: event.interactionDepth,
    origin: event.origin,
    targetDeploymentId: action.kind !== "IGNORE" ? action.targetDeploymentId : null,
  });
}

/* -------------------------------------------------------- natural chatter ---- */

interface ChatterDeployment {
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
export async function recordReactiveQuotaUse(admin: SupabaseClient, panelId: string, communityId: string, quotaDay: string): Promise<void> {
  await admin.rpc("increment_community_reactive_quota", { p_panel_id: panelId, p_community_id: communityId, p_quota_day: quotaDay });
}

async function handleHumanMessage(
  admin: SupabaseClient,
  panelId: string,
  community: { id: string },
  message: TelegramMessage,
  event: CommunityEvent,
  isTrialEntitlement: boolean
) {
  const deployments = await findChatterDeployments(admin, community.id);
  if (!deployments.length) return; // no chatter-eligible deployment in this community

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
    pacing: pacings[i],
  }));

  // Picks the socially appropriate ACTION (SILENCE/REACT/SHORT_ACK/
  // CASUAL_CHAT/ANSWER) and AT MOST ONE responder across every eligible
  // deployment — deterministic, no probability roll anywhere.
  let action = selectChatterAction({ text: event.text, candidates, now: new Date(), recentlyAnsweredByModerator, recentlyRespondedByHuman });

  if (action.type === "SILENCE" && isAmbientOpenerFallbackCandidate(action, event.text)) {
    // Narrow, cheap fallback for messages that failed every deterministic
    // classifier (see chatter-coordinator.ts "ambient-greeting model
    // fallback") -- e.g. "waddup guys", a phonetic greeting spelling no
    // regex can connect to "what's up". A single DeepSeek Flash
    // classification call (5-token output, never Sonnet); on any failure
    // the original deterministic SILENCE stands, no escalation.
    const classified = await classifyAmbientGreeting(event.text);
    if (classified.ok && classified.isGreeting) {
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
    // standalone emoji text message, and never starts another bot-chain event.
    const reactAction: CommunityAction = { kind: "REACT", emoji: action.emoji, targetDeploymentId: deployment.deploymentId, targetMessageId: event.messageId };
    const result = await executeAction(admin, String(message.chat.id), reactAction);
    if (!result.ok) {
      // Previously silent -- Telegram rejecting the reaction (missing bot
      // rights, or the chat restricting its allowed-reactions set) looked
      // identical to a successful react from every log/observability angle.
      console.error("[telegram/community] REACT failed", result.error);
      await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "REACT_FAILED", action.reasons.join(","), { reasons: action.reasons, emoji: action.emoji, error: result.error });
      return;
    }
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "REACT", action.reasons.join(","), { reasons: action.reasons, emoji: action.emoji });
    return;
  }

  // Phase 4.M (B): trial-only, checked BEFORE any AI generation is attempted
  // (spec §17) -- SHORT_ACK/CASUAL_CHAT/ANSWER are all reactive conversational
  // text responses and share this one gate; REACT/SILENCE above are
  // unaffected (moderation is never gated by this either). A plain read, not
  // itself a quota consumption.
  if (isTrialEntitlement && !(await hasReactiveQuotaRemaining(admin, community.id, reactiveQuotaDay(now)))) {
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "SILENCE", "trial_reactive_quota_exhausted", {
      reasons: ["trial_reactive_quota_exhausted"],
      attemptedAction: action.type,
    });
    return;
  }

  let replyText: string;
  if (action.type === "SHORT_ACK") {
    // Deterministic, zero Sonnet calls.
    replyText = shortAckText(deployment.persona);
  } else {
    const generation = await generateChatterReply({
      action: action.type,
      selfDeploymentId: deployment.deploymentId,
      moderatorName: deployment.moderatorName,
      persona: deployment.persona,
      recentContext,
      triggerMessage: { senderName: event.sender.displayName, text: event.text },
      isDirectedAtBot: candidates.find((c) => c.deploymentId === deployment.deploymentId)?.isDirectedAtBot ?? false,
      // Only true when THIS is the moderator the typo-tolerant match
      // resolved to — lets it optionally play along with the misspelling
      // without forcing every reply to comment on it.
      addressedWithTypo: directedMatch?.isTypo === true && directedMatch.deploymentId === deployment.deploymentId,
      // Grounds the "don't fabricate another moderator's presence" prompt
      // rule in actual deployment state, not the model's guess.
      otherActiveModeratorNames: deployments.filter((d) => d.deploymentId !== deployment.deploymentId).map((d) => d.moderatorName),
    });

    if (!generation.ok) {
      console.error("[telegram/community] chatter generation failed", generation.error);
      await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "GENERATION_FAILED", action.reasons.join(","), { reasons: action.reasons });
      return;
    }
    if ("noReply" in generation) {
      await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "MODEL_DECLINED", action.reasons.join(","), { reasons: action.reasons });
      return;
    }
    replyText = generation.reply;
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
  const sent = await executeAction(admin, String(message.chat.id), sendAction);
  await recordBotSpoke(admin, deployment.deploymentId, new Date());
  await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", action.type, action.reasons.join(","), { reasons: action.reasons });

  // Only consumed after the send actually succeeded (spec §7) -- never for a
  // failed outbound send, a declined/failed generation (both already
  // returned above), or a SILENCE/REACT (neither reaches this line at all).
  if (isTrialEntitlement && sent.sentMessageId) {
    await recordReactiveQuotaUse(admin, panelId, community.id, reactiveQuotaDay(now));
  }

  if (sent.sentMessageId) {
    await admin.from("community_messages").insert({
      panel_id: panelId,
      community_id: community.id,
      platform_message_id: sent.sentMessageId,
      sender_type: "INNVIL_MODERATOR",
      sender_platform_id: null,
      sender_display_name: deployment.moderatorName,
      deployment_id: deployment.deploymentId,
      text: replyText,
      reply_to_platform_message_id: event.messageId,
    });
  }
}

/* ------------------------------------------------------------- entry point ---- */

/** Entry point called by the per-bot webhook handler (telegram.ts). */
export async function handleCommunityUpdate(integrationId: string, update: TelegramUpdate): Promise<void> {
  const admin = createAdminClient();

  if (await isDuplicateUpdate(admin, integrationId, update.update_id)) return;

  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message?.from || !message.chat) return;

  const integration = await resolveIntegration(admin, integrationId);
  if (!integration) return;

  const { data: panel } = await admin.from("panels").select("settings").eq("id", integration.panel_id).maybeSingle();
  const settings = panel?.settings ?? null;

  const community = await resolveCommunity(admin, integration.panel_id, message.chat);
  if (!community) return;

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
  const { claimed } = await recordCommunityMessage(admin, integration.panel_id, community.id, message, sender);
  if (!claimed) return;

  if (sender.senderType === "INNVIL_MODERATOR" && sender.deploymentId) {
    if (!virtualModBotAcknowledgement(settings)) return;
    const eligibleTargets = await loadEligibleTargets(admin, community.id, sender.deploymentId);
    const action = decideBotAcknowledgement({ event, botAckMode: community.bot_ack_mode, eligibleTargets, now: new Date() });
    await logBotAckDecision(admin, integration.panel_id, community.id, event, action);
    if (action.kind === "IGNORE") return;
    const sent = await executeAction(admin, String(message.chat.id), action);
    await recordBotAck(admin, action.targetDeploymentId, new Date());
    if (action.kind === "SEND_TEXT" && sent.sentMessageId) {
      await recordBotAckReply(admin, integration.panel_id, community.id, sent.sentMessageId, action);
    }
    return;
  }

  if (sender.senderType === "HUMAN") {
    if (!virtualModNaturalChatterActive(settings)) return;
    // Phase 4.M (B): the 20/day reactive quota is trial-only (spec §2) --
    // paid tiers are unaffected and this patch does not change their
    // existing (unlimited) behavior.
    const isTrialEntitlement = moderatorEntitlementSource(settings) === "trial";
    await handleHumanMessage(admin, integration.panel_id, community, message, event, isTrialEntitlement);
    return;
  }

  // EXTERNAL_BOT — always ignored here (spec §10).
}
