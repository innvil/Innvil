import "server-only";

import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { cleanTelegramHandle, telegramApiCall } from "./telegram-client";
import { fetchManagedBotToken, managerWebhookSecret, setIntegrationWebhook } from "./manager";
import { resolveProvisioningAttempt, verifyManagedBotIdentity, type ProvisioningAttemptCandidate } from "./correlation";

/**
 * The Innvil Telegram Manager Bot's OWN webhook — control-plane events only
 * (spec §21). Handles Update.managed_bot (ManagedBotUpdated), which Telegram
 * emits for THREE distinct lifecycle events (spec §15): a brand-new managed
 * bot creation, a token change, or an owner change. This file distinguishes
 * them by whether telegram_bot_integrations already has a row for the
 * numeric telegram_bot_id — that id is the only durable identity (spec §4/§26);
 * the username is display metadata that can legitimately change (spec §17),
 * and the SUGGESTED username from the deep link is onboarding intent only,
 * never a correlation key or identity (spec §3) — see ./correlation.ts for
 * the (unit-tested) pure logic this file orchestrates.
 *
 * Never touches community runtime events (those go to
 * app/api/webhooks/telegram/bots/[id] instead, one per subscriber bot).
 */

type ManagedBotUpdatePayload = {
  update_id?: number;
  managed_bot?: {
    bot?: { id?: number; username?: string; is_bot?: boolean };
    user?: { id?: number };
  };
};

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Encrypt + store a verified managed-bot token, register its webhook. Shared by the new-bot and reconcile paths. */
async function storeAndVerifyIntegration(
  admin: ReturnType<typeof createAdminClient>,
  integrationId: string,
  botId: number,
  reportedUsername: string | undefined
): Promise<{ ok: true; username: string | null } | { ok: false; error: string }> {
  const tokenRes = await fetchManagedBotToken(botId);
  if (!tokenRes.ok) return { ok: false, error: `getManagedBotToken failed: ${tokenRes.error}` };

  // Final identity verification (spec §6) — never trust the webhook payload's
  // username or id alone; the token we're about to store must itself report
  // the same numeric id. Never log the token itself.
  const meRes = await telegramApiCall<{ id: number; username?: string }>(tokenRes.result, "getMe");
  const verification = verifyManagedBotIdentity(meRes.ok ? meRes.result : null, botId);
  if (!verification.ok) return { ok: false, error: `Identity verification failed: ${verification.reason}` };

  const canonicalUsername = verification.username ?? cleanTelegramHandle(reportedUsername) ?? null;

  await admin.rpc("set_telegram_bot_key", { p_row: integrationId, p_key: tokenRes.result, p_secret: providerKeySecret() });

  const webhookRes = await setIntegrationWebhook(tokenRes.result, integrationId);
  if (!webhookRes.ok) console.error("[telegram/manager] setWebhook failed", integrationId, webhookRes.error);

  await admin
    .from("telegram_bot_integrations")
    .update({
      username: canonicalUsername,
      manager_relationship: "active",
      last_verified_at: new Date().toISOString(),
    })
    .eq("id", integrationId);

  return { ok: true, username: canonicalUsername };
}

export async function handleManagerWebhook(raw: string, headers: Headers): Promise<Response> {
  const provided = headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (provided !== managerWebhookSecret()) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  let update: ManagedBotUpdatePayload;
  try {
    update = JSON.parse(raw) as ManagedBotUpdatePayload;
  } catch {
    return ok();
  }

  const bot = update.managed_bot?.bot;
  const ownerId = update.managed_bot?.user?.id;

  // TEMPORARY diagnostic logging (spec §11) — no secrets/credentials, remove
  // once event delivery + correlation is confirmed working end-to-end.
  console.log("[telegram/manager] update received", {
    update_id: update.update_id,
    topLevelKeys: Object.keys(update),
    hasManagedBot: !!update.managed_bot,
    managedBotId: bot?.id,
    managedBotUsername: bot?.username,
    ownerTelegramId: ownerId,
  });

  if (!bot?.id || !bot.username || !bot.is_bot) return ok();
  const actualUsername = cleanTelegramHandle(bot.username);
  if (!actualUsername) return ok();

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // Not panel-scoped by design: a Telegram bot id is only known AFTER
  // correlation, so this is the one lookup that must run system-wide. The
  // composite (panel_id, telegram_bot_id) unique constraint means more than
  // one row here is a genuine anomaly, not an expected case.
  const { data: existingRows } = await admin
    .from("telegram_bot_integrations")
    .select("id, virtual_moderator_id")
    .eq("telegram_bot_id", bot.id)
    .limit(2);

  if (existingRows && existingRows.length > 1) {
    console.error("[telegram/manager] anomaly: multiple integrations share telegram_bot_id", bot.id);
    return ok();
  }

  if (existingRows && existingRows.length === 1) {
    // RECONCILE PATH (spec §15): token or owner changed on an already-known
    // bot, not a brand-new creation — refresh the stored credential/username,
    // don't touch provisioning state or create anything new.
    const result = await storeAndVerifyIntegration(admin, existingRows[0].id, bot.id, bot.username);
    if (!result.ok) console.error("[telegram/manager] reconcile failed", bot.id, result.error);
    return ok();
  }

  // NEW MANAGED BOT PATH — correlate to a pending Innvil provisioning attempt.
  // The suggested username is a WEAK HINT ONLY (spec §3/§7) — never required
  // to match. See ./correlation.ts for why "exactly one pending candidate" is
  // the only unambiguous case without a stronger signal Innvil doesn't
  // currently capture (a linked Telegram owner id, spec §8).
  const { data: pendingRows } = await admin
    .from("telegram_provisioning_attempts")
    .select("id, panel_id, virtual_moderator_id, suggested_username")
    .eq("status", "pending")
    .gt("expires_at", nowIso);

  const candidates: ProvisioningAttemptCandidate[] = (pendingRows ?? []).map((r) => ({
    id: r.id,
    suggestedUsername: r.suggested_username,
  }));
  const correlation = resolveProvisioningAttempt(candidates, actualUsername);

  if (!correlation.ok) {
    // Safe operational failure — do NOT attach to an arbitrary tenant
    // (spec §8: tenant isolation over convenience). Nothing to clean up;
    // the attempt(s), if any, remain pending until they naturally expire.
    console.error("[telegram/manager] could not correlate managed_bot event", { reason: correlation.reason, botId: bot.id, actualUsername, candidateCount: candidates.length });
    return ok();
  }

  const attemptRow = (pendingRows ?? []).find((r) => r.id === correlation.attempt.id);
  if (!attemptRow) return ok(); // shouldn't happen — candidates were derived from pendingRows

  const { data: integration, error: integrationError } = await admin
    .from("telegram_bot_integrations")
    .upsert(
      {
        panel_id: attemptRow.panel_id,
        virtual_moderator_id: attemptRow.virtual_moderator_id,
        telegram_bot_id: bot.id,
        username: actualUsername,
        source: "managed",
        manager_relationship: "pending", // finalized to "active" by storeAndVerifyIntegration below
      },
      { onConflict: "virtual_moderator_id" } // idempotent: a retried delivery for the same moderator updates, never duplicates
    )
    .select("id")
    .single();

  if (integrationError || !integration) {
    console.error("[telegram/manager] failed to store integration", integrationError?.message);
    await admin
      .from("virtual_moderators")
      .update({ provisioning_status: "credential_setup_failed", last_error: integrationError?.message ?? "Could not store bot integration." })
      .eq("id", attemptRow.virtual_moderator_id);
    return ok();
  }

  const stored = await storeAndVerifyIntegration(admin, integration.id, bot.id, bot.username);
  if (!stored.ok) {
    await admin
      .from("virtual_moderators")
      .update({ provisioning_status: "credential_setup_failed", last_error: stored.error })
      .eq("id", attemptRow.virtual_moderator_id);
    await admin.from("telegram_provisioning_attempts").update({ status: "cancelled" }).eq("id", attemptRow.id);
    return ok();
  }

  await admin
    .from("virtual_moderators")
    .update({ provisioning_status: "bot_ready", last_error: null })
    .eq("id", attemptRow.virtual_moderator_id);

  await admin
    .from("telegram_provisioning_attempts")
    .update({ status: "matched", matched_telegram_bot_id: bot.id, matched_at: nowIso })
    .eq("id", attemptRow.id);

  return ok();
}
