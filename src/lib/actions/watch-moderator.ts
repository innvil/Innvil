"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { providerKeySecret } from "@/src/lib/supabase/admin";
import { DEFAULT_PROVISIONING_DRAFT } from "@/src/lib/moderator/domain";
import {
  buildManagedBotDeepLink, checkChatMembership, getManagerBotUsername, setIntegrationWebhook,
  validateRequestedUsername, verifyBotToken,
} from "@/src/lib/moderator/manager";
import { createAccountCommunity, deployAccountWatcher, type AccountCommunityRow } from "@/src/lib/products/watch-runtime";

/**
 * Self-serve Telegram provisioning for DIRECT (Panel-less) Watch accounts —
 * the "NEXT SAFE STEP" flagged at the end of v1.25.0/v1.26.0. Mirrors the
 * EXISTING, already-working customer-facing flow (`actions/customer-
 * moderator.ts`, itself mirroring the owner flow in `actions/moderator.ts`)
 * via the SAME auth-agnostic Telegram helpers in `moderator/manager.ts` —
 * nothing about how Innvil talks to Telegram is duplicated here.
 *
 * What's genuinely different from both existing flows: the ownership check
 * (`virtual_moderators.account_id`, a direct Innvil account — not a panel
 * owner, not a `customer_accounts` storefront customer) and the capacity/
 * entitlement source (this account's own `product_entitlements` tier via
 * `watch-runtime.ts`'s `createAccountCommunity`/`deployAccountWatcher`,
 * which already enforce it — never `panels.settings`).
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PROVISIONING_ATTEMPT_TTL_MINUTES = 10;
const DEPLOYABLE_PROVISIONING_STATUSES = new Set(["bot_ready", "community_setup_required", "active"]);
const RETRIABLE_PROVISIONING_STATUSES = new Set([
  "draft", "requires_retry", "cancelled", "username_unavailable", "telegram_creation_failed", "credential_setup_failed", "expired",
]);

/** Account-scoped equivalent of moderator.ts's ownedModerator() /
 *  customer-moderator.ts's ctxModerator() — verifies the authenticated
 *  session AND that this Watcher belongs to THIS account directly (never
 *  another account's, never a Panel-owned one). */
async function ctxModerator(moderatorId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: moderator } = await admin
    .from("virtual_moderators")
    .select("id, name, provisioning_status, account_id, last_error")
    .eq("id", moderatorId)
    .maybeSingle();
  if (!moderator || moderator.account_id !== user.id) return null;
  return { admin, accountId: user.id, moderator };
}

export interface AccountTelegramCreationRequest {
  deepLink: string;
  requestedUsername: string;
  expiresAt: string;
}

/** Primary "Innvil-first" path: reserve a username, hand back the Managed
 *  Bots deep link to open. */
export async function requestCustomerTelegramCreation(moderatorId: string, requestedUsername: string): Promise<Result<AccountTelegramCreationRequest>> {
  const c = await ctxModerator(moderatorId);
  if (!c) return { ok: false, error: "Watcher not found." };
  if (!RETRIABLE_PROVISIONING_STATUSES.has(c.moderator.provisioning_status)) {
    return { ok: false, error: `Cannot request Telegram creation from status "${c.moderator.provisioning_status}".` };
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

  await c.admin
    .from("telegram_provisioning_attempts")
    .update({ status: "expired" })
    .eq("virtual_moderator_id", moderatorId)
    .eq("status", "pending");

  const expiresAt = new Date(Date.now() + PROVISIONING_ATTEMPT_TTL_MINUTES * 60_000).toISOString();
  const { error: attemptError } = await c.admin.from("telegram_provisioning_attempts").insert({
    panel_id: null,
    virtual_moderator_id: moderatorId,
    suggested_username: username,
    status: "pending",
    expires_at: expiresAt,
  });
  if (attemptError) return { ok: false, error: attemptError.message };

  const { error: updateError } = await c.admin
    .from("virtual_moderators")
    .update({
      provisioning_status: "telegram_confirmation_pending",
      provisioning_draft: { ...DEFAULT_PROVISIONING_DRAFT, requestedUsername: username },
      last_error: null,
    })
    .eq("id", moderatorId);
  if (updateError) return { ok: false, error: updateError.message };

  const deepLink = buildManagedBotDeepLink(managerUsername, username, c.moderator.name);
  return { ok: true, data: { deepLink, requestedUsername: username, expiresAt } };
}

export interface AccountModeratorProvisioningStatusInfo {
  provisioningStatus: string;
  telegramUsername: string | null;
  lastError: string | null;
}

/** Poll target for the "waiting on Telegram confirmation" UI state — the
 *  Manager Bot's own webhook detects success server-side, not a redirect
 *  back from Telegram. */
export async function getCustomerModeratorProvisioning(moderatorId: string): Promise<AccountModeratorProvisioningStatusInfo | null> {
  const c = await ctxModerator(moderatorId);
  if (!c) return null;
  const { data } = await c.admin
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

export async function cancelCustomerTelegramProvisioning(moderatorId: string): Promise<Result<null>> {
  const c = await ctxModerator(moderatorId);
  if (!c) return { ok: false, error: "Watcher not found." };
  await c.admin
    .from("telegram_provisioning_attempts")
    .update({ status: "cancelled" })
    .eq("virtual_moderator_id", moderatorId)
    .eq("status", "pending");
  await c.admin.from("virtual_moderators").update({ provisioning_status: "draft", last_error: null }).eq("id", moderatorId);
  return { ok: true, data: null };
}

/** Fallback path: connect an already-created bot by pasting its BotFather token. */
export async function connectCustomerBotToken(moderatorId: string, token: string): Promise<Result<null>> {
  const c = await ctxModerator(moderatorId);
  if (!c) return { ok: false, error: "Watcher not found." };
  const trimmedToken = token.trim();
  if (!trimmedToken) return { ok: false, error: "Paste the bot token from BotFather." };

  const verified = await verifyBotToken(trimmedToken);
  if (!verified.ok || !verified.result?.is_bot) {
    return { ok: false, error: verified.ok ? "That token doesn't belong to a bot." : `Telegram rejected the token: ${verified.error}` };
  }

  const { data: integration, error: integrationError } = await c.admin
    .from("telegram_bot_integrations")
    .upsert(
      {
        panel_id: null,
        virtual_moderator_id: moderatorId,
        telegram_bot_id: verified.result.id,
        username: verified.result.username ?? null,
        source: "botfather",
        manager_relationship: "unknown",
        last_verified_at: new Date().toISOString(),
      },
      { onConflict: "virtual_moderator_id" }
    )
    .select("id")
    .single();
  if (integrationError || !integration) return { ok: false, error: integrationError?.message ?? "Could not save the integration." };

  const { error: keyError } = await c.admin.rpc("set_telegram_bot_key", {
    p_row: integration.id,
    p_key: trimmedToken,
    p_secret: providerKeySecret(),
  });
  if (keyError) return { ok: false, error: keyError.message };

  const webhookRes = await setIntegrationWebhook(trimmedToken, integration.id);

  await c.admin
    .from("virtual_moderators")
    .update({
      provisioning_status: "bot_ready",
      last_error: webhookRes.ok ? null : `Bot ready, but webhook registration failed: ${webhookRes.error}`,
    })
    .eq("id", moderatorId);

  return { ok: true, data: null };
}

export interface AccountCommunityDeploymentRow {
  deploymentId: string;
  communityId: string;
  chatId: string;
  title: string | null;
}

/** Connect a bot-ready Watcher to a Telegram community — verifies real
 *  Telegram membership (never assumed), then reuses `watch-runtime.ts`'s
 *  `createAccountCommunity`/`deployAccountWatcher`, which already enforce
 *  this account's own community/slot capacity from its real Watch
 *  entitlement (never a Panel's). Deliberately does NOT offer the `/start`
 *  add-to-group deep link here -- that flow's completion step
 *  (`completeGroupSetupSession`) only ever consumes a `telegram_setup_sessions`
 *  row, which is created EXCLUSIVELY by the owner-side
 *  `createTelegramSetupSession` action (Panel-scoped); a standalone
 *  integration structurally can never have one, so offering that link here
 *  would be a dead end. The user adds the bot to their group directly in
 *  Telegram (by its username, already known from the connect step) instead. */
export async function connectAccountCommunity(moderatorId: string, projectId: string, chatIdOrHandle: string): Promise<Result<AccountCommunityDeploymentRow>> {
  const c = await ctxModerator(moderatorId);
  if (!c) return { ok: false, error: "Watcher not found." };
  if (!DEPLOYABLE_PROVISIONING_STATUSES.has(c.moderator.provisioning_status)) {
    return { ok: false, error: "Connect this Watcher's Telegram bot before adding a community." };
  }
  const trimmed = chatIdOrHandle.trim();
  if (!trimmed) return { ok: false, error: "Enter a Telegram chat ID or @handle." };

  const { data: integration } = await c.admin
    .from("telegram_bot_integrations")
    .select("id, username")
    .eq("virtual_moderator_id", moderatorId)
    .maybeSingle();
  if (!integration) return { ok: false, error: "No Telegram bot connected for this Watcher yet." };

  const { data: tokenData, error: keyError } = await c.admin.rpc("get_telegram_bot_key", {
    p_row: integration.id,
    p_secret: providerKeySecret(),
  });
  const token = tokenData as string | null;
  if (keyError || !token) return { ok: false, error: "Could not read this Watcher's Telegram credential." };

  const membership = await checkChatMembership(token, trimmed);
  if (!membership.ok) return { ok: false, error: `Telegram couldn't verify that chat: ${membership.error}` };
  if (!membership.result.present) {
    const usernameNote = integration.username ? ` (search for @${integration.username} in Telegram)` : "";
    return { ok: false, error: `This bot isn't a member of that chat yet — add it there first${usernameNote}, then try again.` };
  }

  // Telegram's own `chat.type` from the verified getChat call above (never
  // guessed from chat_id sign/shape/username) is passed straight through --
  // createAccountCommunity is the single canonical creation path and is
  // itself responsible for rejecting a "private" chat type (a Telegram
  // PERSON, not a Community), so a customer pasting their own Telegram user
  // id/handle here is rejected with a clear error rather than silently
  // becoming a Community row.
  const communityResult = await createAccountCommunity(c.admin, c.accountId, projectId, {
    platform: "telegram",
    chatId: String(membership.result.chat.id),
    handle: membership.result.chat.username ?? null,
    title: membership.result.chat.title ?? null,
    chatType: membership.result.chat.type ?? null,
  });
  if (!communityResult.ok) return communityResult;
  const community = communityResult.data as AccountCommunityRow;

  const health = {
    present: membership.result.present,
    canSend: membership.result.canSend,
    canDelete: membership.result.canDelete,
    canRestrict: membership.result.canRestrict,
    checkedAt: new Date().toISOString(),
  };
  const deployResult = await deployAccountWatcher(c.admin, c.accountId, moderatorId, community.id, health);
  if (!deployResult.ok) return deployResult;

  await c.admin.from("virtual_moderators").update({ provisioning_status: "active" }).eq("id", moderatorId);

  return { ok: true, data: { deploymentId: deployResult.data.id, communityId: community.id, chatId: community.chatId, title: community.title } };
}

/** Pause/resume a deployment — capacity re-checked (against this account's
 *  own entitlement) only when re-enabling. */
export async function setCustomerDeploymentEnabled(moderatorId: string, deploymentId: string, enabled: boolean): Promise<Result<null>> {
  const c = await ctxModerator(moderatorId);
  if (!c) return { ok: false, error: "Watcher not found." };

  const { data: deployment } = await c.admin.from("moderator_deployments").select("id, moderator_id, community_id").eq("id", deploymentId).maybeSingle();
  if (!deployment || deployment.moderator_id !== moderatorId) return { ok: false, error: "Deployment not found." };

  if (enabled) {
    const result = await deployAccountWatcher(c.admin, c.accountId, moderatorId, deployment.community_id as string);
    if (!result.ok) return result;
    return { ok: true, data: null };
  }

  const { error } = await c.admin.from("moderator_deployments").update({ enabled: false }).eq("id", deploymentId).eq("moderator_id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
