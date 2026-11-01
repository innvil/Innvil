import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "@/src/lib/moderator/telegram-client";

/**
 * One-off testing helper: send a Telegram message directly through a specific
 * moderator's OWN bot token, bypassing Reactive Natural Chatter entirely.
 *
 * Needed because findChatterDeployment (community-runtime.ts) always picks
 * just ONE deployment per community (documented limitation -- a real
 * multi-moderator Coordinator selection is Phase 4.M, not built yet), so with
 * two moderators deployed to the same community the second one can never be
 * selected to speak on its own. Bot-ack (already fully built) needs ONE bot
 * to actually post a message so the OTHER bot's webhook can classify it as
 * INNVIL_MODERATOR and run the real acknowledgement decision -- this script
 * produces that trigger message directly, without touching chatter selection.
 *
 * Usage: npm run moderator:send -- --integration=<telegram_bot_integrations.id> --chat=<telegram_chat_id> --text="hello"
 */

function parseArg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const integrationId = parseArg("integration");
  const chatId = parseArg("chat");
  const text = parseArg("text") ?? "test message";
  if (!integrationId || !chatId) {
    throw new Error("Pass --integration=<telegram_bot_integrations.id> --chat=<telegram_chat_id> [--text=\"...\"]");
  }

  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await admin
    .from("telegram_bot_integrations")
    .select("id, username")
    .eq("id", integrationId)
    .maybeSingle();
  if (integrationError || !integration) throw new Error(`Integration not found: ${integrationError?.message ?? integrationId}`);

  const { data: tokenData, error: keyError } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  const token = tokenData as string | null;
  if (keyError || !token) throw new Error(`Could not decrypt bot token: ${keyError?.message ?? "empty"}`);

  const res = await telegramApiCall<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text });
  if (!res.ok) throw new Error(`sendMessage failed: ${res.error}`);

  console.log(`Sent as @${integration.username ?? "?"} -> chat ${chatId}, message_id ${res.result.message_id}`);
}

main().catch((err) => {
  console.error("SEND_AS_MODERATOR_FATAL", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
