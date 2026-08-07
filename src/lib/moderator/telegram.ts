import "server-only";

import { integrationWebhookSecret } from "./manager";

/**
 * Community-runtime Telegram webhook handler — one endpoint per subscriber
 * bot (app/api/webhooks/telegram/bots/[integrationId]), verified against that
 * integration's own DERIVED secret_token (see manager.ts integrationWebhookSecret)
 * rather than a single global secret. This still just acknowledges Telegram
 * for now; the actual pipeline (normalize CommunityEvent -> Community
 * Coordinator -> decision engine -> CommunityAction -> execute via the
 * SAME subscriber bot) lands in the next phases.
 */

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

  // Parsed but intentionally unused until Phase 3 (event normalization + coordinator).
  void raw;

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}
