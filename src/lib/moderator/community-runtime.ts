import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { readModeratorAddon } from "./plan";
import { virtualModBotAcknowledgement } from "./plan";
import { decideBotAcknowledgement, type BotAckMode, type EligibleTarget } from "./coordinator";
import { classifySender as classifySenderPure, type CommunityEvent, type CommunityAction } from "./event-types";

/**
 * Community-runtime orchestration for a single incoming Telegram update on a
 * subscriber bot's webhook (app/api/webhooks/telegram/bots/[integrationId]).
 * Scope for this patch (spec §28): classify the sender, and when it's an
 * Innvil moderator, route through the Community Coordinator for a possible
 * bounded acknowledgement. HUMAN and EXTERNAL_BOT senders are classified and
 * then always ignored here — Natural Chatter for humans is a separate,
 * not-yet-built decision path (spec §10/§28: do not add chatter/moderation
 * behavior as a side effect of this feature).
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

async function executeAction(admin: SupabaseClient, chatId: string, action: CommunityAction) {
  if (action.kind === "IGNORE") return;

  const targetDeploymentId = action.kind === "REACT" ? action.targetDeploymentId : action.targetDeploymentId;
  const { data: deployment } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id")
    .eq("id", targetDeploymentId)
    .maybeSingle();
  if (!deployment) return;

  const { data: integration } = await admin
    .from("telegram_bot_integrations")
    .select("id")
    .eq("virtual_moderator_id", deployment.moderator_id)
    .maybeSingle();
  if (!integration) return;

  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  const token = tokenData as string | null;
  if (!token) return;

  if (action.kind === "REACT") {
    await telegramApiCall(token, "setMessageReaction", {
      chat_id: chatId,
      message_id: action.targetMessageId,
      reaction: [{ type: "emoji", emoji: action.emoji }],
    });
  } else if (action.kind === "SEND_TEXT") {
    await telegramApiCall(token, "sendMessage", {
      chat_id: chatId,
      text: action.text,
      reply_to_message_id: action.replyToMessageId ?? undefined,
    });
  }
}

async function logDecision(
  admin: SupabaseClient,
  panelId: string,
  communityId: string,
  event: CommunityEvent,
  action: CommunityAction
) {
  await admin.from("moderator_activity_log").insert({
    panel_id: panelId,
    community_id: communityId,
    deployment_id: event.sender.deploymentId ?? null,
    event_type: "bot_message",
    decision: action.kind,
    reason_code: event.sender.senderType,
    meta: {
      interactionDepth: event.interactionDepth,
      origin: event.origin,
      targetDeploymentId: action.kind !== "IGNORE" ? action.targetDeploymentId : null,
    },
  });
}

/** Entry point called by the per-bot webhook handler (telegram.ts). */
export async function handleCommunityUpdate(integrationId: string, update: TelegramUpdate): Promise<void> {
  const admin = createAdminClient();

  if (await isDuplicateUpdate(admin, integrationId, update.update_id)) return;

  const message = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!message?.from || !message.chat) return;

  const integration = await resolveIntegration(admin, integrationId);
  if (!integration) return;

  const { data: panel } = await admin.from("panels").select("settings").eq("id", integration.panel_id).maybeSingle();
  const addon = readModeratorAddon(panel?.settings ?? null);
  if (!virtualModBotAcknowledgement(panel?.settings ?? null)) return; // master switch / entitlement off (spec §24/§25)
  void addon; // reserved for future tier-specific gating

  const community = await resolveCommunity(admin, integration.panel_id, message.chat);
  if (!community) return;

  const sender = await classifySender(admin, integration.panel_id, community.id, message.from);

  // This patch only ever acts on Innvil-moderator senders (spec §10/§28) —
  // HUMAN and EXTERNAL_BOT are classified for future use (analytics, and
  // eventually Natural Chatter) but produce no action here.
  if (sender.senderType !== "INNVIL_MODERATOR" || !sender.deploymentId) return;

  const event: CommunityEvent = {
    panelId: integration.panel_id,
    communityId: community.id,
    integrationId,
    messageId: String(message.message_id),
    sender,
    timestamp: new Date().toISOString(),
    text: message.text ?? message.caption ?? "",
    replyToMessageId: message.reply_to_message ? String(message.reply_to_message.message_id) : null,
    // v1 has no way to distinguish a moderator's proactive vs reactive
    // message yet (Proactive Mode isn't built) — treat all Innvil-moderator
    // messages as origin HUMAN-equivalent (i.e. NOT BOT_ACK) unless this
    // exact update was already flagged otherwise, which nothing does yet.
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
  };

  const eligibleTargets = await loadEligibleTargets(admin, community.id, sender.deploymentId);
  const action = decideBotAcknowledgement({
    event,
    botAckMode: community.bot_ack_mode,
    eligibleTargets,
    now: new Date(),
  });

  await logDecision(admin, integration.panel_id, community.id, event, action);
  if (action.kind === "IGNORE") return;

  await executeAction(admin, String(message.chat.id), action);
  await recordBotAck(admin, action.targetDeploymentId, new Date());
}
