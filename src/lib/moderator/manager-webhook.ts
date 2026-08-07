import "server-only";

import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { cleanTelegramHandle } from "./telegram-client";
import { fetchManagedBotToken, integrationWebhookSecret, managerWebhookSecret, setIntegrationWebhook } from "./manager";

/**
 * The Innvil Telegram Manager Bot's OWN webhook — control-plane events only
 * (spec §21). Handles the ManagedBotCreated/ManagedBotUpdated update that
 * arrives when a subscriber confirms bot creation in Telegram. Never touches
 * community runtime events (those go to app/api/webhooks/telegram/bots/[id]
 * instead, one per subscriber bot).
 *
 * Telegram's managed-bot deep link carries no custom correlation parameter,
 * so this correlates the incoming event back to the Innvil draft that
 * requested it by matching the created bot's username against a pending
 * telegram_provisioning_attempts row (short expiry window) — see §96 of the
 * spec, which flags this as a known best-effort tradeoff, not a hard
 * cryptographic correlation. Usernames are globally unique on Telegram, so
 * this is safe in practice.
 */

type ManagedBotUpdatePayload = {
  managed_bot?: {
    bot?: { id?: number; username?: string; is_bot?: boolean };
    user?: { id?: number };
  };
};

function ok() {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
}

export async function handleManagerWebhook(raw: string, headers: Headers): Promise<Response> {
  const provided = headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (provided !== managerWebhookSecret()) {
    return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
  }

  let update: ManagedBotUpdatePayload & { update_id?: number };
  try {
    update = JSON.parse(raw) as ManagedBotUpdatePayload & { update_id?: number };
  } catch {
    return ok();
  }

  // TEMPORARY diagnostic logging (no secrets/credentials) — remove once event
  // delivery is confirmed working end-to-end. Logs every update that reaches
  // this webhook at all, regardless of shape, so a delivery-shape mismatch is
  // visible even if the managed_bot filtering below doesn't match.
  console.log("[telegram/manager] update received", {
    update_id: update.update_id,
    topLevelKeys: Object.keys(update),
    managedBotUsername: update.managed_bot?.bot?.username,
    managedBotId: update.managed_bot?.bot?.id,
  });

  const bot = update.managed_bot?.bot;
  if (!bot?.id || !bot.username) return ok();

  const username = cleanTelegramHandle(bot.username)?.toLowerCase();
  if (!username) return ok();

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: attempt } = await admin
    .from("telegram_provisioning_attempts")
    .select("id, panel_id, virtual_moderator_id, expires_at")
    .eq("suggested_username", username)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt) return ok(); // nothing pending for this username — unrelated/duplicate delivery

  if (new Date(attempt.expires_at).getTime() < Date.now()) {
    await admin.from("telegram_provisioning_attempts").update({ status: "expired" }).eq("id", attempt.id);
    await admin
      .from("virtual_moderators")
      .update({ provisioning_status: "expired", last_error: "Telegram confirmation window expired." })
      .eq("id", attempt.virtual_moderator_id);
    return ok();
  }

  const tokenRes = await fetchManagedBotToken(bot.id);
  if (!tokenRes.ok) {
    console.error("[telegram/manager] getManagedBotToken failed", tokenRes.error);
    await admin.from("telegram_provisioning_attempts").update({ status: "cancelled" }).eq("id", attempt.id);
    await admin
      .from("virtual_moderators")
      .update({ provisioning_status: "credential_setup_failed", last_error: tokenRes.error })
      .eq("id", attempt.virtual_moderator_id);
    return ok();
  }

  const { data: integration, error: integrationError } = await admin
    .from("telegram_bot_integrations")
    .upsert(
      {
        panel_id: attempt.panel_id,
        virtual_moderator_id: attempt.virtual_moderator_id,
        telegram_bot_id: bot.id,
        username,
        source: "managed",
        manager_relationship: "active",
        last_verified_at: nowIso,
      },
      { onConflict: "virtual_moderator_id" }
    )
    .select("id")
    .single();

  if (integrationError || !integration) {
    console.error("[telegram/manager] failed to store integration", integrationError?.message);
    await admin
      .from("virtual_moderators")
      .update({ provisioning_status: "credential_setup_failed", last_error: integrationError?.message ?? "Could not store bot integration." })
      .eq("id", attempt.virtual_moderator_id);
    return ok();
  }

  await admin.rpc("set_telegram_bot_key", { p_row: integration.id, p_key: tokenRes.result, p_secret: providerKeySecret() });

  const webhookRes = await setIntegrationWebhook(tokenRes.result, integration.id);
  const webhookNote = webhookRes.ok ? null : `Bot ready, but webhook registration failed: ${webhookRes.error}`;
  if (!webhookRes.ok) console.error("[telegram/manager] setWebhook failed", webhookRes.error, integrationWebhookSecret(integration.id).slice(0, 4) + "…");

  await admin
    .from("virtual_moderators")
    .update({ provisioning_status: "bot_ready", last_error: webhookNote })
    .eq("id", attempt.virtual_moderator_id);

  await admin
    .from("telegram_provisioning_attempts")
    .update({ status: "matched", matched_telegram_bot_id: bot.id, matched_at: nowIso })
    .eq("id", attempt.id);

  return ok();
}
