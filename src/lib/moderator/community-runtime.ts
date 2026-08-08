import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { virtualModBotAcknowledgement, virtualModNaturalChatterActive } from "./plan";
import { decideBotAcknowledgement, type BotAckMode, type EligibleTarget } from "./coordinator";
import { evaluateChatterGate, type ChatterPacingState } from "./chatter-coordinator";
import { generateChatterReply, type ChatterContextMessage } from "./chatter-generate";
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

async function recordCommunityMessage(
  admin: SupabaseClient,
  panelId: string,
  communityId: string,
  message: TelegramMessage,
  sender: CommunityEvent["sender"]
) {
  await admin.from("community_messages").insert({
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

async function executeAction(admin: SupabaseClient, chatId: string, action: CommunityAction): Promise<{ sentMessageId: string | null }> {
  if (action.kind === "IGNORE") return { sentMessageId: null };

  const { data: deployment } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id")
    .eq("id", action.targetDeploymentId)
    .maybeSingle();
  if (!deployment) return { sentMessageId: null };

  const { data: integration } = await admin
    .from("telegram_bot_integrations")
    .select("id")
    .eq("virtual_moderator_id", deployment.moderator_id)
    .maybeSingle();
  if (!integration) return { sentMessageId: null };

  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  const token = tokenData as string | null;
  if (!token) return { sentMessageId: null };

  if (action.kind === "REACT") {
    await telegramApiCall(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: action.targetMessageId,
      reaction: [{ type: "emoji", emoji: action.emoji }],
    });
    return { sentMessageId: null };
  }

  if (action.kind === "SEND_TEXT") {
    const res = await telegramApiCall<{ message_id: number }>(token, "sendMessage", {
      chat_id: chatId,
      text: action.text,
      reply_to_message_id: action.replyToMessageId ?? undefined,
    });
    return { sentMessageId: res.ok ? String(res.result.message_id) : null };
  }

  return { sentMessageId: null };
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

/** Picks the deployment that should handle chatter in this community. With
 *  more than one enabled deployment present (unreachable today — the trial
 *  caps at 1 active slot, so this can't happen until paid tiers exist), this
 *  takes the first one; a real Community Coordinator selection across
 *  multiple chatter-eligible deployments is future work, not needed yet. */
async function findChatterDeployment(admin: SupabaseClient, communityId: string): Promise<ChatterDeployment | null> {
  const { data: deployments } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id, virtual_moderators(name, persona)")
    .eq("community_id", communityId)
    .eq("enabled", true)
    .limit(1);
  const row = (deployments ?? [])[0] as
    | { id: string; moderator_id: string; virtual_moderators: { name: string; persona: unknown } | { name: string; persona: unknown }[] | null }
    | undefined;
  if (!row) return null;
  const vm = Array.isArray(row.virtual_moderators) ? row.virtual_moderators[0] : row.virtual_moderators;

  const { data: integration } = await admin
    .from("telegram_bot_integrations")
    .select("username")
    .eq("virtual_moderator_id", row.moderator_id)
    .maybeSingle();

  return {
    deploymentId: row.id,
    moderatorName: vm?.name ?? "Moderator",
    persona: normalizeModeratorPersona(vm?.persona),
    botUsername: integration?.username ?? null,
  };
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

function messageIsDirectedAtBot(text: string, isReplyToThisDeployment: boolean, botUsername: string | null): boolean {
  if (isReplyToThisDeployment) return true;
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
  return false;
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
    .select("sender_type, sender_display_name, text")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as Array<{ sender_type: string; sender_display_name: string | null; text: string }>)
    .reverse()
    .map((r) => ({ senderType: r.sender_type as ChatterContextMessage["senderType"], senderName: r.sender_display_name, text: r.text }));
}

async function handleHumanMessage(admin: SupabaseClient, panelId: string, community: { id: string }, message: TelegramMessage, event: CommunityEvent) {
  const deployment = await findChatterDeployment(admin, community.id);
  if (!deployment) return; // no chatter-eligible deployment in this community

  const repliedToDeploymentId = await resolveRepliedToDeployment(admin, community.id, event.replyToMessageId);
  const directed = messageIsDirectedAtBot(event.text, repliedToDeploymentId === deployment.deploymentId, deployment.botUsername);

  await resetChatterStreak(admin, deployment.deploymentId); // a human just spoke — the bot's own streak (if any) is broken

  const pacing = await loadChatterPacing(admin, deployment.deploymentId);
  const gate = evaluateChatterGate({ text: event.text, isDirectedAtBot: directed, pacing, now: new Date() });

  if (!gate.proceed) {
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "IGNORE", gate.reasonCode);
    return;
  }

  const recentContext = await loadRecentContext(admin, community.id, 10);
  const generation = await generateChatterReply({
    moderatorName: deployment.moderatorName,
    persona: deployment.persona,
    recentContext,
    triggerMessage: { senderName: event.sender.displayName, text: event.text },
    isDirectedAtBot: directed,
  });

  if (!generation.ok) {
    console.error("[telegram/community] chatter generation failed", generation.error);
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "IGNORE", "GENERATION_FAILED");
    return;
  }
  if ("noReply" in generation) {
    await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "IGNORE", "MODEL_DECLINED");
    return;
  }

  const action: CommunityAction = {
    kind: "SEND_TEXT",
    text: generation.reply,
    targetDeploymentId: deployment.deploymentId,
    replyToMessageId: event.messageId,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: event.messageId,
  };
  const sent = await executeAction(admin, String(message.chat.id), action);
  await recordBotSpoke(admin, deployment.deploymentId, new Date());
  await logActivity(admin, panelId, community.id, deployment.deploymentId, "human_message", "CHAT_REPLY", gate.reasonCode);

  if (sent.sentMessageId) {
    await admin.from("community_messages").insert({
      panel_id: panelId,
      community_id: community.id,
      platform_message_id: sent.sentMessageId,
      sender_type: "INNVIL_MODERATOR",
      sender_platform_id: null,
      sender_display_name: deployment.moderatorName,
      deployment_id: deployment.deploymentId,
      text: generation.reply,
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

  const event: CommunityEvent = {
    panelId: integration.panel_id,
    communityId: community.id,
    integrationId,
    messageId: String(message.message_id),
    sender,
    timestamp: new Date().toISOString(),
    text: message.text ?? message.caption ?? "",
    replyToMessageId: message.reply_to_message ? String(message.reply_to_message.message_id) : null,
    // Neither Proactive Mode nor a way to mark a moderator's own message as
    // BOT_ACK-originated exists on the INBOUND side yet — inbound events are
    // always treated as origin HUMAN-equivalent. BOT_ACK is only ever set on
    // the OUTBOUND action this runtime produces (coordinator.ts), which is
    // what actually prevents the loop (spec §8/§9).
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
  };

  // Bounded recent-context log — recorded regardless of which capability (if
  // any) is active; both bot-ack correlation and chatter context need it.
  await recordCommunityMessage(admin, integration.panel_id, community.id, message, sender);

  // TEMPORARY diagnostic logging — natural chatter is confirmed working
  // end-to-end; keep this one until bot-ack is also live-tested (currently
  // blocked on trial capacity — needs 2 communities). No secrets/tokens logged.
  console.log("[telegram/community] update classified", {
    senderType: sender.senderType,
    hasDeploymentId: !!sender.deploymentId,
    botAckEnabled: virtualModBotAcknowledgement(settings),
    naturalChatterEnabled: virtualModNaturalChatterActive(settings),
  });

  if (sender.senderType === "INNVIL_MODERATOR" && sender.deploymentId) {
    if (!virtualModBotAcknowledgement(settings)) return;
    const eligibleTargets = await loadEligibleTargets(admin, community.id, sender.deploymentId);
    const action = decideBotAcknowledgement({ event, botAckMode: community.bot_ack_mode, eligibleTargets, now: new Date() });
    await logBotAckDecision(admin, integration.panel_id, community.id, event, action);
    if (action.kind === "IGNORE") return;
    await executeAction(admin, String(message.chat.id), action);
    await recordBotAck(admin, action.targetDeploymentId, new Date());
    return;
  }

  if (sender.senderType === "HUMAN") {
    if (!virtualModNaturalChatterActive(settings)) return;
    await handleHumanMessage(admin, integration.panel_id, community, message, event);
    return;
  }

  // EXTERNAL_BOT — always ignored here (spec §10).
}
