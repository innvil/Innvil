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

import { randomBytes } from "node:crypto";
import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { DEFAULT_MODERATOR_PERSONA, DEFAULT_PROVISIONING_DRAFT, normalizeModeratorPersona } from "@/src/lib/moderator/domain";
import { resolvePersonaPreset, applyPersonaPreset } from "@/src/lib/moderator/presets";
import {
  hasVirtualModerator, moderatorCapacity, moderatorMaxSavedModerators, readModeratorAddon,
  TRIAL_DURATION_DAYS, virtualModBotAcknowledgement, virtualModModeration, virtualModContentGeneration,
  communityCountExceeded, checkDeploymentSlotCaps, deploymentSlotCheckErrorMessage,
} from "@/src/lib/moderator/plan";
import type { BotAckMode } from "@/src/lib/moderator/coordinator";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildManagedBotDeepLink,
  buildAddToGroupDeepLink,
  computeRequiredAdminRights,
  checkChatMembership,
  getManagerBotUsername,
  setIntegrationWebhook,
  validateRequestedUsername,
  verifyBotToken,
  type RequiredAdminRights,
} from "@/src/lib/moderator/manager";
import { finalizeCommunityConnection, type CommunityDeploymentRow, type DeploymentHealthInfo } from "@/src/lib/moderator/community-runtime";

const BOT_ACK_MODES: BotAckMode[] = ["off", "reactions_only", "acknowledgements", "role_handoffs"];

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
  /** Owner-authored self-description ("laid-back, friendly, concise") -- the
   *  authoritative answer when a member asks the moderator what its persona
   *  is. Empty when never configured. */
  personaDescription: string;
  /** Free-form behavioral guidance, either typed directly or materialized
   *  from a preset — already wired into generation via personaStyle(). */
  personaCustomInstructions: string;
  /** Which preset (see presets.ts) this persona was last applied from, for
   *  UI display only ("based on: Calm Professional"). Null = custom. */
  personaPresetId: string | null;
}

export async function listVirtualModerators(panelId: string): Promise<VirtualModeratorRow[]> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return [];
  const { data } = await ctx.admin
    .from("virtual_moderators")
    .select("id, name, status, provisioning_status, last_error, persona, telegram_bot_integrations(username)")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const integration = row.telegram_bot_integrations as { username?: string | null } | Array<{ username?: string | null }> | null;
    const username = Array.isArray(integration) ? integration[0]?.username ?? null : integration?.username ?? null;
    const persona = normalizeModeratorPersona(row.persona);
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      provisioningStatus: String(row.provisioning_status),
      telegramUsername: username ?? null,
      lastError: (row.last_error as string | null) ?? null,
      personaDescription: persona.description,
      personaCustomInstructions: persona.customInstructions,
      personaPresetId: persona.presetId,
    };
  });
}

/** Owner applies a persona preset (see presets.ts) — a ONE-TIME
 *  materialization onto the moderator's persona fields, not a live binding.
 *  Overwrites description/customInstructions/style dials with the preset's
 *  values; leaves language/topicsToAvoid untouched. Subsequent manual edits
 *  are never overwritten by re-applying this preset later — the owner would
 *  have to explicitly pick it again. */
export async function applyModeratorPersonaPreset(panelId: string, moderatorId: string, presetId: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  const preset = resolvePersonaPreset(presetId);
  if (!preset) return { ok: false, error: "Unknown persona preset." };

  const { data: current } = await ctx.admin.from("virtual_moderators").select("persona").eq("id", moderatorId).maybeSingle();
  const persona = applyPersonaPreset(normalizeModeratorPersona(current?.persona), preset);

  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Owner clears the preset link so the picker shows "Custom" — does NOT
 *  reset any persona field, only the provenance tag. */
export async function clearModeratorPersonaPreset(panelId: string, moderatorId: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };

  const { data: current } = await ctx.admin.from("virtual_moderators").select("persona").eq("id", moderatorId).maybeSingle();
  const persona = normalizeModeratorPersona(current?.persona);
  persona.presetId = null;

  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Owner edits the free-form behavioral guidance directly (whether typed
 *  from scratch or refining what a preset materialized). Does not touch
 *  presetId — editing customInstructions after picking a preset is exactly
 *  the "customize" path, not a reason to silently drop the provenance tag. */
export async function setModeratorCustomInstructions(panelId: string, moderatorId: string, customInstructions: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  const trimmed = customInstructions.slice(0, 2000);

  const { data: current } = await ctx.admin.from("virtual_moderators").select("persona").eq("id", moderatorId).maybeSingle();
  const persona = normalizeModeratorPersona(current?.persona);
  persona.customInstructions = trimmed;

  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Owner sets/updates this moderator's persona self-description -- the
 *  authoritative "who am I" text Natural Chatter draws from when asked about
 *  its persona/personality. Merges into the existing persona jsonb rather
 *  than replacing it, so the style knobs (formality/humor/slang/...) are
 *  preserved untouched. */
export async function setModeratorPersonaDescription(panelId: string, moderatorId: string, description: string): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  const trimmed = description.trim().slice(0, 300);

  const { data: current } = await ctx.admin.from("virtual_moderators").select("persona").eq("id", moderatorId).maybeSingle();
  const persona = normalizeModeratorPersona(current?.persona);
  persona.description = trimmed;

  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export interface ModeratorPlanInfo {
  offered: boolean;
  tier: ReturnType<typeof readModeratorAddon>["tier"];
  commercialMode: ReturnType<typeof readModeratorAddon>["commercialMode"];
  trialActive: boolean;
  maxCommunities: number;
  maxActiveSlots: number;
  maxSavedModerators: number;
  botAckEnabled: boolean;
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
    botAckEnabled: virtualModBotAcknowledgement(ctx.panel.settings),
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
      personaDescription: "",
      personaCustomInstructions: "",
      personaPresetId: null,
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

/* --------------------------------------------------------- Communities ---- */

const DEPLOYABLE_PROVISIONING_STATUSES = new Set(["bot_ready", "community_setup_required", "active"]);

const TELEGRAM_SETUP_SESSION_TTL_MINUTES = 15;

/** Phase 4.O — "Add [moderator] to Telegram" deep link (spec §2/§6/§23).
 *  Returns a `startgroup` link that opens Telegram's own add-to-group flow;
 *  the opaque token correlates the resulting group /start back to this
 *  moderator (never tenant data in the visible token itself — spec §6). */
export async function createTelegramSetupSession(panelId: string, moderatorId: string): Promise<Result<{ deepLink: string; token: string; expiresAt: string; requiredRights: RequiredAdminRights }>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  if (!DEPLOYABLE_PROVISIONING_STATUSES.has(ctx.moderator.provisioning_status)) {
    return { ok: false, error: "Connect this moderator's Telegram bot before adding a community." };
  }
  const { data: integration } = await ctx.admin.from("telegram_bot_integrations").select("username").eq("virtual_moderator_id", moderatorId).maybeSingle();
  if (!integration?.username) return { ok: false, error: "No Telegram bot connected for this moderator yet." };

  const token = randomBytes(16).toString("base64url");
  const expiresAt = new Date(Date.now() + TELEGRAM_SETUP_SESSION_TTL_MINUTES * 60_000).toISOString();
  const { error } = await ctx.admin.from("telegram_setup_sessions").insert({
    token, panel_id: panelId, virtual_moderator_id: moderatorId, initiator: "owner", expires_at: expiresAt,
  });
  if (error) return { ok: false, error: "Could not start the setup session." };

  const requiredRights = computeRequiredAdminRights({
    moderationEnabled: virtualModModeration(ctx.panel.settings),
    autoPostingEnabled: virtualModContentGeneration(ctx.panel.settings),
  });
  return { ok: true, data: { deepLink: buildAddToGroupDeepLink(integration.username, token), token, expiresAt, requiredRights } };
}

/** Connect a bot-ready moderator to a Telegram community: verify presence/permissions with the
 *  moderator's OWN bot token, then create (or attach to) the community + deployment. */
export async function connectCommunity(panelId: string, moderatorId: string, chatIdOrHandle: string): Promise<Result<CommunityDeploymentRow>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };
  if (!DEPLOYABLE_PROVISIONING_STATUSES.has(ctx.moderator.provisioning_status)) {
    return { ok: false, error: "Connect this moderator's Telegram bot before adding a community." };
  }
  const trimmed = chatIdOrHandle.trim();
  if (!trimmed) return { ok: false, error: "Enter a Telegram chat ID or @handle." };

  const { data: integration } = await ctx.admin
    .from("telegram_bot_integrations")
    .select("id")
    .eq("virtual_moderator_id", moderatorId)
    .maybeSingle();
  if (!integration) return { ok: false, error: "No Telegram bot connected for this moderator yet." };

  const { data: tokenData, error: keyError } = await ctx.admin.rpc("get_telegram_bot_key", {
    p_row: integration.id,
    p_secret: providerKeySecret(),
  });
  const token = tokenData as string | null;
  if (keyError || !token) return { ok: false, error: "Could not read this moderator's Telegram credential." };

  const membership = await checkChatMembership(token, trimmed);
  if (!membership.ok) return { ok: false, error: `Telegram couldn't verify that chat: ${membership.error}` };
  if (!membership.result.present) return { ok: false, error: "This bot isn't a member of that chat yet — add it in Telegram first, then try again." };

  return finalizeCommunityConnection(ctx.admin, panelId, moderatorId, ctx.user.id, ctx.panel.settings, membership.result);
}

export async function listModeratorCommunities(panelId: string, moderatorId: string): Promise<CommunityDeploymentRow[]> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return [];
  const { data } = await ctx.admin
    .from("moderator_deployments")
    .select("id, enabled, health, bot_to_bot_status, communities(id, chat_id, handle, title, chat_type, bot_ack_mode, collab_contact)")
    .eq("moderator_id", moderatorId)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const community = (Array.isArray(row.communities) ? row.communities[0] : row.communities) as
      | { id: string; chat_id: string; handle: string | null; title: string | null; chat_type: string | null; bot_ack_mode: string | null; collab_contact: string | null }
      | null;
    const health = (row.health as Partial<DeploymentHealthInfo>) ?? {};
    return {
      deploymentId: String(row.id),
      communityId: community?.id ?? "",
      chatId: community?.chat_id ?? "",
      handle: community?.handle ?? null,
      title: community?.title ?? null,
      chatType: community?.chat_type ?? null,
      enabled: row.enabled === true,
      health: {
        present: health.present ?? false,
        canSend: health.canSend ?? false,
        canDelete: health.canDelete ?? false,
        canRestrict: health.canRestrict ?? false,
        checkedAt: health.checkedAt ?? null,
      },
      botAckMode: (BOT_ACK_MODES.includes(community?.bot_ack_mode as BotAckMode) ? community?.bot_ack_mode : "off") as BotAckMode,
      collabContact: community?.collab_contact ?? null,
      botToBotStatus: (row.bot_to_bot_status as CommunityDeploymentRow["botToBotStatus"]) ?? "not_tested",
    };
  });
}

/** Owner-facing control for spec §25's community setting ("Allow Innvil moderators to
 *  acknowledge each other"). Scoped to the community (shared across any moderators
 *  deployed there), verified via panel ownership rather than a specific moderator. */
export async function setCommunityBotAckMode(panelId: string, communityId: string, mode: BotAckMode): Promise<Result<null>> {
  if (!BOT_ACK_MODES.includes(mode)) return { ok: false, error: "Invalid mode." };
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { error } = await ctx.admin
    .from("communities")
    .update({ bot_ack_mode: mode })
    .eq("id", communityId)
    .eq("panel_id", panelId);
  if (error) return { ok: false, error: error.message };

  // Phase 4.O (spec §15) — turning bot-ack on makes this community's
  // deployments eligible for a real delivery test; never claim VERIFIED here
  // (only an actual successful bot-ack send does that, in community-runtime.ts).
  // Turning it off resets an unverified deployment back to not_tested rather
  // than leaving a stale "ready" status once there's nothing to test.
  await ctx.admin
    .from("moderator_deployments")
    .update({ bot_to_bot_status: mode === "off" ? "not_tested" : "ready_for_test" })
    .eq("community_id", communityId)
    .neq("bot_to_bot_status", "verified_by_delivery");

  return { ok: true, data: null };
}

/** Owner-facing control for Phase 4.M (F) — who legitimate partnership/AMA/
 *  collaboration inquiries get routed to in this community. Conversational
 *  routing only, never an authorization grant (spec §36) — this contact
 *  gains no special authority from being configured here. Same
 *  community-scoped, panel-ownership-verified pattern as bot-ack mode.
 *  Empty/whitespace clears it (never invents a contact when unset). */
export async function setCommunityCollabContact(panelId: string, communityId: string, contact: string | null): Promise<Result<null>> {
  const trimmed = contact?.trim() || null;
  if (trimmed && trimmed.length > 100) return { ok: false, error: "Keep the contact under 100 characters." };
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const { error } = await ctx.admin
    .from("communities")
    .update({ collab_contact: trimmed })
    .eq("id", communityId)
    .eq("panel_id", panelId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Pause a deployment (spec §51) — stops it consuming an Active Mod Slot without deleting config/memory. */
export async function setDeploymentEnabled(panelId: string, moderatorId: string, deploymentId: string, enabled: boolean): Promise<Result<null>> {
  const ctx = await ownedModerator(panelId, moderatorId);
  if (!ctx) return { ok: false, error: "Moderator not found." };

  if (enabled) {
    const capacity = moderatorCapacity(ctx.panel.settings);
    const { count: activeSlotCount } = await ctx.admin
      .from("moderator_deployments")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panelId)
      .eq("enabled", true);

    const { data: target } = await ctx.admin.from("moderator_deployments").select("community_id").eq("id", deploymentId).maybeSingle();
    let communityDeploymentCount = 0;
    if (target?.community_id) {
      const { count } = await ctx.admin
        .from("moderator_deployments")
        .select("id", { count: "exact", head: true })
        .eq("community_id", target.community_id)
        .eq("enabled", true);
      communityDeploymentCount = count ?? 0;
    }
    const slotCheck = checkDeploymentSlotCaps({
      isExistingDeployment: false, // re-activating a currently-disabled deployment -- always re-checked
      activeSlotCount: activeSlotCount ?? 0,
      maxActiveSlots: capacity.maxActiveSlots,
      communityDeploymentCount,
    });
    if (!slotCheck.ok) return { ok: false, error: deploymentSlotCheckErrorMessage(slotCheck, capacity.maxActiveSlots) };
  }

  const { error } = await ctx.admin
    .from("moderator_deployments")
    .update({ enabled })
    .eq("id", deploymentId)
    .eq("moderator_id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
