"use server";

/**
 * Virtual Moderator — owner-facing server actions.
 *
 * Phase 2: Telegram provisioning. requestTelegramCreation() is the primary
 * "Innvil-first" path (spec §18/§73) — it validates + reserves a username and
 * hands the caller a Managed Bots deep link to open; Innvil detects success
 * asynchronously via the Manager Bot's own webhook (manager-webhook.ts), not
 * a callback from this action. connectExistingBotToken() is the BotFather
 * fallback for an already-created bot (spec §19).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { DEFAULT_MODERATOR_PERSONA, DEFAULT_PROVISIONING_DRAFT } from "@/src/lib/moderator/domain";
import { hasVirtualModerator, moderatorCapacity, moderatorMaxSavedModerators, readModeratorAddon } from "@/src/lib/moderator/plan";
import {
  buildManagedBotDeepLink,
  getManagerBotUsername,
  setIntegrationWebhook,
  validateRequestedUsername,
  verifyBotToken,
} from "@/src/lib/moderator/manager";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PROVISIONING_ATTEMPT_TTL_MINUTES = 10;

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

async function ownedModerator(panelId: string, moderatorId: string) {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const { data: moderator } = await ctx.admin
    .from("virtual_moderators")
    .select("id, panel_id, name, provisioning_status")
    .eq("id", moderatorId)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (!moderator) return null;
  return { ...ctx, moderator };
}

export interface VirtualModeratorRow {
  id: string;
  name: string;
  status: string;
  provisioningStatus: string;
  telegramUsername: string | null;
  lastError: string | null;
}

export async function listVirtualModerators(panelId: string): Promise<VirtualModeratorRow[]> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return [];
  const { data } = await ctx.admin
    .from("virtual_moderators")
    .select("id, name, status, provisioning_status, last_error, telegram_bot_integrations(username)")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const integration = row.telegram_bot_integrations as { username?: string | null } | Array<{ username?: string | null }> | null;
    const username = Array.isArray(integration) ? integration[0]?.username ?? null : integration?.username ?? null;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      provisioningStatus: String(row.provisioning_status),
      telegramUsername: username ?? null,
      lastError: (row.last_error as string | null) ?? null,
    };
  });
}

export interface ModeratorPlanInfo {
  offered: boolean;
  tier: ReturnType<typeof readModeratorAddon>["tier"];
  commercialMode: ReturnType<typeof readModeratorAddon>["commercialMode"];
  trialActive: boolean;
  maxCommunities: number;
  maxActiveSlots: number;
  maxSavedModerators: number;
}

export async function getModeratorPlanInfo(panelId: string): Promise<ModeratorPlanInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const addon = readModeratorAddon(ctx.panel.settings);
  const capacity = moderatorCapacity(ctx.panel.settings);
  return {
    offered: hasVirtualModerator(ctx.panel.settings),
    tier: addon.tier,
    commercialMode: addon.commercialMode,
    trialActive: addon.trial.active,
    maxCommunities: capacity.maxCommunities,
    maxActiveSlots: capacity.maxActiveSlots,
    maxSavedModerators: moderatorMaxSavedModerators(ctx.panel.settings),
  };
}

export async function createVirtualModerator(panelId: string, name: string): Promise<Result<VirtualModeratorRow>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 60) return { ok: false, error: "Name is too long." };

  const maxSaved = moderatorMaxSavedModerators(ctx.panel.settings);
  if (Number.isFinite(maxSaved)) {
    const { count } = await ctx.admin
      .from("virtual_moderators")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panelId);
    if ((count ?? 0) >= maxSaved) {
      return { ok: false, error: `You've reached the limit of ${maxSaved} saved moderator(s) for your current plan.` };
    }
  }

  const { data, error } = await ctx.admin
    .from("virtual_moderators")
    .insert({
      panel_id: panelId,
      name: trimmed,
      persona: DEFAULT_MODERATOR_PERSONA,
      provisioning_draft: DEFAULT_PROVISIONING_DRAFT,
    })
    .select("id, name, status, provisioning_status")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create moderator." };

  return {
    ok: true,
    data: {
      id: data.id,
      name: data.name,
      status: data.status,
      provisioningStatus: data.provisioning_status,
      telegramUsername: null,
      lastError: null,
    },
  };
}

/* --------------------------------------------------- Telegram provisioning ---- */

export interface TelegramCreationRequest {
  deepLink: string;
  requestedUsername: string;
  expiresAt: string;
}

/** Primary "Innvil-first" path: reserve a username, hand back the Managed Bots deep link to open. */
export async function requestTelegramCreation(
  panelId: string,
  moderatorId: string,
  requestedUsername: string
): Promise<Result<TelegramCreationRequest>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  // Allowed from a fresh draft OR any terminal failure state (retry). NOT from
  // an in-flight/succeeded status (telegram_confirmation_pending and later) —
  // cancel first if you want to restart a pending attempt.
  const RETRIABLE = new Set([
    "draft",
    "requires_retry",
    "cancelled",
    "username_unavailable",
    "telegram_creation_failed",
    "credential_setup_failed",
    "expired",
  ]);
  if (!RETRIABLE.has(ctx.moderator.provisioning_status)) {
    return { ok: false, error: `Cannot request Telegram creation from status "${ctx.moderator.provisioning_status}".` };
  }

  const validated = validateRequestedUsername(requestedUsername);
  if (!validated.ok) return { ok: false, error: validated.error };
  const username = validated.username.toLowerCase();

  let managerUsername: string;
  try {
    managerUsername = await getManagerBotUsername();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Manager bot is not configured." };
  }

  // Expire any of THIS moderator's stale pending attempts before creating a new one.
  await ctx.admin
    .from("telegram_provisioning_attempts")
    .update({ status: "expired" })
    .eq("virtual_moderator_id", moderatorId)
    .eq("status", "pending");

  const expiresAt = new Date(Date.now() + PROVISIONING_ATTEMPT_TTL_MINUTES * 60_000).toISOString();
  const { error: attemptError } = await ctx.admin.from("telegram_provisioning_attempts").insert({
    panel_id: panelId,
    virtual_moderator_id: moderatorId,
    suggested_username: username,
    status: "pending",
    expires_at: expiresAt,
  });
  if (attemptError) return { ok: false, error: attemptError.message };

  const { error: updateError } = await ctx.admin
    .from("virtual_moderators")
    .update({
      provisioning_status: "telegram_confirmation_pending",
      provisioning_draft: { ...DEFAULT_PROVISIONING_DRAFT, requestedUsername: username },
      last_error: null,
    })
    .eq("id", moderatorId);
  if (updateError) return { ok: false, error: updateError.message };

  const deepLink = buildManagedBotDeepLink(managerUsername, username, ctx.moderator.name);
  return { ok: true, data: { deepLink, requestedUsername: username, expiresAt } };
}

export interface ModeratorProvisioningStatusInfo {
  provisioningStatus: string;
  telegramUsername: string | null;
  lastError: string | null;
}

/** Poll target for the "waiting on Telegram confirmation" UI state — Innvil detects success server-side via the Manager Bot's webhook, not a redirect back from Telegram. */
export async function getModeratorProvisioning(panelId: string, moderatorId: string): Promise<ModeratorProvisioningStatusInfo | null> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return null;
  const { data } = await ctx.admin
    .from("virtual_moderators")
    .select("provisioning_status, last_error, telegram_bot_integrations(username)")
    .eq("id", moderatorId)
    .maybeSingle();
  if (!data) return null;
  const integration = data.telegram_bot_integrations as { username?: string | null } | Array<{ username?: string | null }> | null;
  const username = Array.isArray(integration) ? integration[0]?.username ?? null : integration?.username ?? null;
  return {
    provisioningStatus: data.provisioning_status,
    telegramUsername: username ?? null,
    lastError: data.last_error ?? null,
  };
}

export async function cancelTelegramProvisioning(panelId: string, moderatorId: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  await ctx.admin
    .from("telegram_provisioning_attempts")
    .update({ status: "cancelled" })
    .eq("virtual_moderator_id", moderatorId)
    .eq("status", "pending");
  await ctx.admin.from("virtual_moderators").update({ provisioning_status: "draft", last_error: null }).eq("id", moderatorId);
  return { ok: true, data: null };
}

/** Fallback path: connect an already-created bot by pasting its BotFather token (spec §19). */
export async function connectExistingBotToken(panelId: string, moderatorId: string, token: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  const trimmedToken = token.trim();
  if (!trimmedToken) return { ok: false, error: "Paste the bot token from BotFather." };

  const verified = await verifyBotToken(trimmedToken);
  if (!verified.ok || !verified.result?.is_bot) {
    return { ok: false, error: verified.ok ? "That token doesn't belong to a bot." : `Telegram rejected the token: ${verified.error}` };
  }

  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await ctx.admin
    .from("telegram_bot_integrations")
    .upsert(
      {
        panel_id: panelId,
        virtual_moderator_id: moderatorId,
        telegram_bot_id: verified.result.id,
        username: verified.result.username ?? null,
        source: "botfather",
        manager_relationship: "unknown", // not managed via Telegram Managed Bots — Innvil just holds this token directly
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: "virtual_moderator_id" }
    )
    .select("id")
    .single();
  if (integrationError || !integration) return { ok: false, error: integrationError?.message ?? "Could not save the integration." };

  const { error: keyError } = await admin.rpc("set_telegram_bot_key", {
    p_row: integration.id,
    p_key: trimmedToken,
    p_secret: providerKeySecret(),
  });
  if (keyError) return { ok: false, error: keyError.message };

  const webhookRes = await setIntegrationWebhook(trimmedToken, integration.id);

  await ctx.admin
    .from("virtual_moderators")
    .update({
      provisioning_status: "bot_ready",
      last_error: webhookRes.ok ? null : `Bot ready, but webhook registration failed: ${webhookRes.error}`,
    })
    .eq("id", moderatorId);

  return { ok: true, data: null };
}
