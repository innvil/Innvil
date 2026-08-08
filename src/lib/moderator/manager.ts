import "server-only";
import crypto from "crypto";

import { telegramApiCall, cleanTelegramHandle, type TelegramResult } from "./telegram-client";

/**
 * Innvil Telegram Manager Bot — control plane only (spec §5/§21).
 *
 * This module NEVER acts as a community moderator. Its only job is:
 *   - hold Innvil's own infra-owned bot credential (TELEGRAM_MANAGER_BOT_TOKEN)
 *   - build the Telegram Managed Bots creation deep link
 *   - receive the Manager Bot's own webhook (ManagedBotCreated/Updated) and
 *     fetch the newly-created subscriber-owned bot's token via
 *     getManagedBotToken, then hand it off to be encrypted/stored
 *   - derive a per-integration webhook secret so each subscriber bot gets
 *     its own webhook without Innvil having to persist yet another secret
 *
 * Telegram Bot API 9.6 (April 2026) "Managed Bots": a bot with bot-management
 * mode enabled (via BotFather) can create/own child bots on a subscriber's
 * behalf. `managed_bot` IS an ordinary webhook-deliverable Update field
 * (confirmed against current docs — not getUpdates-only); the suggested
 * username in the deep link is onboarding intent only, never authoritative
 * (see ./correlation.ts, which owns the correlation/identity logic this
 * module's callers rely on).
 */

function managerBotToken(): string {
  const token = process.env.TELEGRAM_MANAGER_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_MANAGER_BOT_TOKEN is not set");
  return token;
}

/** secret_token Telegram must send back on the Manager Bot's OWN webhook (control-plane events). */
export function managerWebhookSecret(): string {
  const secret = process.env.TELEGRAM_MANAGER_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("TELEGRAM_MANAGER_WEBHOOK_SECRET is not set");
  return secret;
}

/** HMAC seed used to DERIVE each subscriber bot's own webhook secret_token, so
 *  Innvil never has to store a secret per integration — verification just
 *  recomputes the same HMAC and compares. */
function webhookSecretSeed(): string {
  const seed = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!seed) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set");
  return seed;
}

/** Deterministic per-integration webhook secret_token (hex, well under Telegram's 256-char limit). */
export function integrationWebhookSecret(integrationId: string): string {
  return crypto.createHmac("sha256", webhookSecretSeed()).update(integrationId).digest("hex");
}

function appUrl(): string {
  const url = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!url) throw new Error("NEXT_PUBLIC_APP_URL is not set");
  return url;
}

export function integrationWebhookUrl(integrationId: string): string {
  return `${appUrl()}/api/webhooks/telegram/bots/${integrationId}`;
}

export async function getManagerBotUsername(): Promise<string> {
  const res = await telegramApiCall<{ username?: string }>(managerBotToken(), "getMe");
  if (!res.ok || !res.result?.username) throw new Error(res.ok ? "Manager bot has no username" : res.error);
  return res.result.username;
}

/* -------------------------------------------------------- username rules ---- */

const USERNAME_BODY_RE = /^[A-Za-z][A-Za-z0-9_]{3,29}$/; // Telegram: 5-32 chars total, must start with a letter

export function validateRequestedUsername(rawName: string): { ok: true; username: string } | { ok: false; error: string } {
  let username = cleanTelegramHandle(rawName) ?? "";
  if (!username) return { ok: false, error: "Enter a Telegram username for this bot." };
  if (!/bot$/i.test(username)) username = `${username}_bot`; // Telegram requires bot usernames to end in "bot"
  if (!USERNAME_BODY_RE.test(username)) {
    return { ok: false, error: "Username must be 5-32 characters, start with a letter, and use only letters/numbers/underscore." };
  }
  return { ok: true, username };
}

/**
 * Managed Bots creation deep link (Bot API 9.6):
 *   https://t.me/newbot/<manager_bot_username>/<suggested_bot_username>?name=<suggested_bot_name>
 * Tapping it opens Telegram's own "Create bot?" confirmation for the
 * subscriber — Innvil never sees their Telegram credentials, and the
 * subscriber remains the owner of the resulting bot (spec §4/§18).
 */
export function buildManagedBotDeepLink(managerUsername: string, suggestedUsername: string, displayName: string): string {
  const params = new URLSearchParams({ name: displayName.slice(0, 64) });
  return `https://t.me/newbot/${encodeURIComponent(managerUsername)}/${encodeURIComponent(suggestedUsername)}?${params.toString()}`;
}

/**
 * Fetches a managed bot's token. Confirmed against Telegram's current Bot
 * API 9.6 docs: getManagedBotToken takes `user_id` = the MANAGED bot's own
 * numeric id (i.e. `managed_bot.bot.id`), NOT the creator/owner's id
 * (`managed_bot.user.id`) — easy to get backwards since the parameter is
 * still named `user_id`. This is deliberately the only place that calls it.
 */
export async function fetchManagedBotToken(managedBotId: number): Promise<TelegramResult<string>> {
  const res = await telegramApiCall<{ token?: string } | string>(managerBotToken(), "getManagedBotToken", {
    user_id: managedBotId,
  });
  if (!res.ok) return res;
  const token = typeof res.result === "string" ? res.result : res.result?.token;
  if (!token) return { ok: false, error: "getManagedBotToken returned no token" };
  return { ok: true, result: token };
}

/** Register the per-bot webhook for a freshly-created/connected subscriber bot. */
export async function setIntegrationWebhook(botToken: string, integrationId: string): Promise<TelegramResult<boolean>> {
  return telegramApiCall<boolean>(botToken, "setWebhook", {
    url: integrationWebhookUrl(integrationId),
    secret_token: integrationWebhookSecret(integrationId),
  });
}

/** Verify a bot identity via getMe — used for the BotFather-token fallback path. */
export async function verifyBotToken(botToken: string): Promise<TelegramResult<{ id: number; username?: string; is_bot?: boolean }>> {
  return telegramApiCall(botToken, "getMe");
}

/* -------------------------------------------------------- community connect ---- */

export interface TelegramChatInfo {
  id: number;
  title?: string;
  username?: string;
  type?: string;
}

export interface ChatMembershipResult {
  chat: TelegramChatInfo;
  present: boolean;
  canSend: boolean;
  canDelete: boolean;
  canRestrict: boolean;
}

/** Accepts a numeric chat id ("-1001234567890") or a handle ("@name"/"name") and normalizes for the Telegram API. */
export function normalizeChatIdInput(raw: string): string {
  const trimmed = raw.trim();
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/**
 * Verifies the given bot (by its OWN token) can see the target chat and
 * reports its membership/admin capabilities there — used by "Connect
 * Community" (spec: permissions are per-community, never inferred from
 * token validity alone; least-privilege — don't require admin rights the
 * deployment isn't configured to use).
 */
export async function checkChatMembership(botToken: string, chatIdOrHandle: string): Promise<TelegramResult<ChatMembershipResult>> {
  const chatId = normalizeChatIdInput(chatIdOrHandle);
  const chatRes = await telegramApiCall<TelegramChatInfo>(botToken, "getChat", { chat_id: chatId });
  if (!chatRes.ok) return chatRes;

  const meRes = await telegramApiCall<{ id: number }>(botToken, "getMe");
  if (!meRes.ok) return meRes;

  const memberRes = await telegramApiCall<{
    status: string;
    can_delete_messages?: boolean;
    can_restrict_members?: boolean;
    can_send_messages?: boolean;
  }>(botToken, "getChatMember", { chat_id: chatId, user_id: meRes.result.id });
  if (!memberRes.ok) return memberRes;

  const status = memberRes.result.status;
  const present = status !== "left" && status !== "kicked";
  const isAdmin = status === "administrator" || status === "creator";
  const canSend = present && (isAdmin || status === "member" || memberRes.result.can_send_messages === true);
  const canDelete = isAdmin && memberRes.result.can_delete_messages === true;
  const canRestrict = isAdmin && memberRes.result.can_restrict_members === true;

  return { ok: true, result: { chat: chatRes.result, present, canSend, canDelete, canRestrict } };
}
