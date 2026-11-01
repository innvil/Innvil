import { botManagerWebhookSecret, handleBotManagerUpdate } from "@/src/lib/moderator/bot-manager-runtime";
import type { TelegramUpdate } from "@/src/lib/moderator/community-runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

/** innvil_bot_manager's OWN webhook — a separate credential/route from both
 *  the control-plane Manager Bot (/api/webhooks/telegram/manager) and every
 *  subscriber-owned moderator bot (/api/webhooks/telegram/bots/[id]). Set
 *  this route's URL (with INNVIL_OFFICIAL_BOT_WEBHOOK_SECRET as the
 *  secret_token) via Telegram's setWebhook once for this one bot — there is
 *  no per-integration variant here, this bot is a single, platform-wide
 *  identity. */
export async function POST(req: Request) {
  const provided = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  let expected: string;
  try {
    expected = botManagerWebhookSecret();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  if (provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return ok();
  }

  try {
    await handleBotManagerUpdate(update);
  } catch (err) {
    // Never fail the webhook response for a runtime error — Telegram would
    // just retry the same update.
    console.error("[telegram/bot-manager] handleBotManagerUpdate failed", err instanceof Error ? err.message : err);
  }

  return ok();
}
