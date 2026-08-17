import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { retrieveProductKnowledge } from "./bot-manager-knowledge";
import { classifyManagerMessageIntent, generateManagerSupportReply, MANAGER_INTENT_CONFIDENCE_THRESHOLD } from "./bot-manager-classify";
import type { TelegramMessage, TelegramUpdate } from "./community-runtime";

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
export async function handleBotManagerUpdate(update: TelegramUpdate): Promise<void> {
  const admin = createAdminClient();
  if (await isDuplicateManagerUpdate(admin, update.update_id)) return;

  const message = update.message ?? update.edited_message;
  if (!message?.from || !message.chat) return;
  if (message.from.is_bot) return; // never engage another bot, incl. accidental self-loops

  await recordKnownChat(admin, message);

  const text = (message.text ?? "").trim();
  if (!text) return;

  const { data: chatRow } = await admin
    .from("bot_manager_chats")
    .select("support_enabled")
    .eq("chat_id", String(message.chat.id))
    .maybeSingle();
  if (chatRow && chatRow.support_enabled === false) return;

  const intentResult = await classifyManagerMessageIntent(text);
  if (intentResult.intent !== "INNVIL_PRODUCT_QUESTION" || intentResult.confidence < MANAGER_INTENT_CONFIDENCE_THRESHOLD) {
    return; // stays silent on anything not confidently about Innvil itself
  }

  const retrieved = retrieveProductKnowledge(text);
  const reply = await generateManagerSupportReply(text, retrieved);

  const token = botManagerToken();
  await telegramApiCall(token, "sendMessage", {
    chat_id: message.chat.id,
    text: reply,
    reply_to_message_id: message.message_id,
  });
}
