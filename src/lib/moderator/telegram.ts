import "server-only";

import { integrationWebhookSecret } from "./manager";
import { handleCommunityUpdate, type TelegramUpdate } from "./community-runtime";

/**
 * Community-runtime Telegram webhook handler — one endpoint per subscriber
 * bot (app/api/webhooks/telegram/bots/[integrationId]), verified against that
 * integration's own DERIVED secret_token (see manager.ts integrationWebhookSecret)
 * rather than a single global secret.
 *
 * Scope so far: normalize the event, classify the sender (HUMAN/
 * INNVIL_MODERATOR/EXTERNAL_BOT), and — only for INNVIL_MODERATOR senders —
 * route through the Community Coordinator for a possible bounded
 * acknowledgement (community-runtime.ts). Human message handling (Natural
 * Chatter) is a separate, not-yet-built decision path.
 */

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function handleCommunityWebhook(integrationId: string, raw: string, headers: Headers): Promise<Response> {
  const provided = headers.get("x-telegram-bot-api-secret-token") ?? "";
  let expected: string;
  try {
    expected = integrationWebhookSecret(integrationId);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Not configured" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  if (provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  let update: TelegramUpdate;
  try {
    update = JSON.parse(raw) as TelegramUpdate;
  } catch {
    return ok();
  }

  try {
    await handleCommunityUpdate(integrationId, update);
  } catch (err) {
    // Never fail the webhook response for a runtime/processing error — Telegram
    // would just retry, and this isn't the customer-facing moderator's only
    // job (the rest of Virtual Moderator functionality must keep working).
    console.error("[telegram/community] handleCommunityUpdate failed", integrationId, err instanceof Error ? err.message : err);
  }

  return ok();
}
