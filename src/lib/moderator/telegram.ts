import "server-only";

/**
 * Community-runtime Telegram webhook handler — PLACEHOLDER for Phase 1.
 *
 * The old version of this file read a single global TELEGRAM_BOT_TOKEN and
 * collapsed the Manager Bot / subscriber-bot / community actors into one
 * runtime path (see the architecture audit). It's being replaced by:
 *   - src/lib/moderator/manager.ts        (control-plane: managed-bot creation)
 *   - src/lib/moderator/events.ts         (CommunityEvent normalization)
 *   - src/lib/moderator/coordinator.ts    (Community Coordinator)
 *   - src/lib/moderator/actions.ts        (execute via the SELECTED subscriber bot)
 * landing in the next phases. Until then this just acknowledges Telegram so
 * webhooks don't pile up retries; it performs no moderation/chatter yet.
 */

export async function handleTelegramModeratorUpdate(_raw: string, _headers: Headers): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}
