import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { retrieveProductKnowledge } from "./bot-manager-knowledge";
import { classifyManagerMessageIntent, generateManagerSupportReply, MANAGER_INTENT_CONFIDENCE_THRESHOLD } from "./bot-manager-classify";
import { START_COMMAND_RE, type TelegramMessage, type TelegramUpdate } from "./community-runtime";
import { consumeTelegramVerificationAttempt } from "@/src/lib/products/watch-abuse";

/**
 * innvil_bot_manager — Innvil's own platform-wide product bot
 * (innvil-bot-manager-spec.md). Deliberately a SEPARATE credential/module
 * from BOTH the control-plane-only Manager Bot (manager.ts,
 * TELEGRAM_MANAGER_BOT_TOKEN — never posts customer/community-facing
 * content) and the per-panel subscriber moderators (community-runtime.ts).
 * This pass implements the reactive-support half of the spec (grounded Q&A
 * about Innvil itself, silent on anything else); the proactive marketing-
 * campaign SEND path (cron sweep + superadmin approval UI) is scaffolded at
 * the DB layer (bot_manager_campaigns/bot_manager_campaign_sends,
 * migration 0064) but its actual sweep/send implementation is deliberately
 * NOT built this pass -- documented follow-up, same "ship the safer/more
 * valuable half first, flag the rest" pattern used elsewhere in this
 * codebase (e.g. Rental commercial mode, AI response pool metering).
 */

function botManagerToken(): string {
  const token = process.env.INNVIL_OFFICIAL_BOT_TOKEN?.trim();
  if (!token) throw new Error("INNVIL_OFFICIAL_BOT_TOKEN is not set");
  return token;
}

export function botManagerWebhookSecret(): string {
  const secret = process.env.INNVIL_OFFICIAL_BOT_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("INNVIL_OFFICIAL_BOT_WEBHOOK_SECRET is not set");
  return secret;
}

/** This bot's own Telegram @username, resolved live via getMe (mirrors
 *  manager.ts's getManagerBotUsername -- same pattern, different bot/
 *  credential) -- used to build the `/start` verification deep link. Not
 *  cached: this is only called when a user clicks "Connect Telegram", far
 *  from a hot path. */
export async function getBotManagerUsername(): Promise<string> {
  const res = await telegramApiCall<{ username?: string }>(botManagerToken(), "getMe");
  if (!res.ok || !res.result?.username) throw new Error(res.ok ? "Innvil bot has no username" : res.error);
  return res.result.username;
}

async function isDuplicateManagerUpdate(admin: SupabaseClient, updateId: number | undefined): Promise<boolean> {
  if (updateId == null) return false;
  const { error } = await admin.from("bot_manager_processed_updates").insert({ update_id: updateId });
  if (!error) return false;
  return error.code === "23505";
}

/** Best-effort registration of the chat this message came from — lets a
 *  future superadmin campaign sweep enumerate real known destinations
 *  instead of guessing. Never blocks the reactive-support reply on failure. */
async function recordKnownChat(admin: SupabaseClient, message: TelegramMessage): Promise<void> {
  const chatType = message.chat.type;
  if (chatType !== "private" && chatType !== "group" && chatType !== "supergroup" && chatType !== "channel") return;
  await admin
    .from("bot_manager_chats")
    .upsert(
      { chat_id: String(message.chat.id), chat_type: chatType, title: message.chat.title ?? null },
      { onConflict: "chat_id" }
    );
}

/**
 * Priority-over-customer-moderators (spec "3. Priority in shared groups") is
 * DEFERRED this pass -- documented, not silently skipped. In practice this
 * risk is already substantially mitigated structurally: a customer
 * moderator only ever routes a HUMAN message through Natural Chatter/bot-ack
 * when it's deployed in THAT community; innvil_bot_manager is never a
 * recognized INNVIL_MODERATOR from any individual panel's perspective (it
 * has no telegram_bot_integrations row), so from a customer moderator's own
 * classifySender it reads as an ordinary human/external sender, not
 * "another bot to defer to." A genuine suppression mechanism (e.g. a shared
 * per-community flag customer moderators check before answering an
 * Innvil-product question) needs its own design pass and is intentionally
 * not built here.
 */
// TEMPORARY diagnostic logging (remove once live behavior is confirmed) --
// mirrors the same "log the actual decision, not just token counts" pattern
// already used earlier in this codebase's Telegram debugging (manager-
// webhook.ts). Never logs the bot token/secret; truncates message text.
function dlog(step: string, meta: Record<string, unknown> = {}) {
  console.log("[bot-manager-debug]", step, JSON.stringify(meta));
}

/** Native (Panel-independent) account -> Telegram verification: a `/start
 *  <token>` sent to THIS bot in a PRIVATE chat is checked against the
 *  account's own pending watch_telegram_verification_attempts row (never a
 *  telegram_setup_sessions row -- that table is Panel-scoped group-connect
 *  only, structurally unrelated). `from.id`/`from.username` are Telegram's
 *  own trusted webhook fields -- never client-submitted. Returns true when
 *  the message WAS a verification attempt (handled either way, success or
 *  failure) so the caller never falls through to reactive Q&A for it. */
async function handleAccountVerificationStart(admin: SupabaseClient, message: TelegramMessage, botToken: string): Promise<boolean> {
  if (message.chat.type !== "private") return false;
  const match = START_COMMAND_RE.exec((message.text ?? "").trim());
  if (!match || !match[1]) return false;

  const token = match[1];
  const result = await consumeTelegramVerificationAttempt(admin, token, message.from!.id, message.from!.username ?? null);
  dlog("account_verification", { ok: result.ok, reason: result.ok ? undefined : result.reason });

  const reply = result.ok
    ? "Your Telegram account is now verified and linked to your Innvil account. You can close this chat and return to Innvil Watch."
    : result.reason === "already_linked_elsewhere"
      ? "This Telegram account is already linked to a different Innvil account, so it can't be linked here too."
      : "This verification link has expired or was already used. Go back to Innvil Watch Profile and click Connect Telegram again.";
  await telegramApiCall(botToken, "sendMessage", { chat_id: message.chat.id, text: reply });
  return true;
}

export async function handleBotManagerUpdate(update: TelegramUpdate): Promise<void> {
  const admin = createAdminClient();
  dlog("received", { updateId: update.update_id, keys: Object.keys(update) });

  if (await isDuplicateManagerUpdate(admin, update.update_id)) { dlog("stop:duplicate_update"); return; }

  const message = update.message ?? update.edited_message;
  if (!message?.from || !message.chat) { dlog("stop:no_message_or_sender"); return; }
  if (message.from.is_bot) { dlog("stop:sender_is_bot"); return; } // never engage another bot, incl. accidental self-loops

  if (await handleAccountVerificationStart(admin, message, botManagerToken())) { dlog("stop:handled_as_account_verification"); return; }

  await recordKnownChat(admin, message);

  const text = (message.text ?? "").trim();
  dlog("message_shape", { chatType: message.chat.type, hasText: !!message.text, textPreview: text.slice(0, 60) });
  if (!text) { dlog("stop:no_text"); return; }

  const { data: chatRow } = await admin
    .from("bot_manager_chats")
    .select("support_enabled")
    .eq("chat_id", String(message.chat.id))
    .maybeSingle();
  if (chatRow && chatRow.support_enabled === false) { dlog("stop:support_disabled_for_chat"); return; }

  const intentResult = await classifyManagerMessageIntent(text);
  dlog("intent_classified", { intent: intentResult.intent, confidence: intentResult.confidence, threshold: MANAGER_INTENT_CONFIDENCE_THRESHOLD });
  if (intentResult.intent !== "INNVIL_PRODUCT_QUESTION" || intentResult.confidence < MANAGER_INTENT_CONFIDENCE_THRESHOLD) {
    dlog("stop:below_confidence_threshold_or_unrelated");
    return; // stays silent on anything not confidently about Innvil itself
  }

  const retrieved = retrieveProductKnowledge(text);
  dlog("knowledge_retrieved", { count: retrieved.length, ids: retrieved.map((r) => r.id) });
  const reply = await generateManagerSupportReply(text, retrieved);
  dlog("reply_generated", { replyPreview: reply.slice(0, 80) });

  const token = botManagerToken();
  const sent = await telegramApiCall(token, "sendMessage", {
    chat_id: message.chat.id,
    text: reply,
    reply_to_message_id: message.message_id,
  });
  dlog("send_result", { ok: sent.ok, error: sent.ok ? undefined : sent.error });
}
