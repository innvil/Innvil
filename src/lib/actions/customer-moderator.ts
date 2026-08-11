"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { round4, MODERATOR_COMMISSION_SHARE, MODERATOR_PLAN_PERIOD_DAYS, moderatorPlanPrice, type ModeratorPlanTier } from "@/src/lib/money";
import {
  resolveTrialQualification, trialAccessGranted, customerModeratorCapacity, customerModeratorMaxSavedModerators, sumNetOrderSpend,
  CUSTOMER_TRIAL_DURATION_DAYS, TRIAL_WALLET_MIN_BALANCE,
  type TrialQualificationSource, type PersistedTrialState,
} from "@/src/lib/moderator/customer-entitlement";
import { DEFAULT_MODERATOR_PERSONA, DEFAULT_PROVISIONING_DRAFT } from "@/src/lib/moderator/domain";
import { MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";
import type { BotAckMode } from "@/src/lib/moderator/coordinator";
import {
  buildManagedBotDeepLink, checkChatMembership, getManagerBotUsername, setIntegrationWebhook,
  validateRequestedUsername, verifyBotToken,
} from "@/src/lib/moderator/manager";
import { createTicket } from "@/src/lib/actions/tickets";

/* =========================================================
   Customer-facing AI Moderator — storefront product. A panel CUSTOMER (not
   the panel owner) qualifies for a free 7-day trial or subscribes to a paid
   tier, billed from their OWN panel wallet (customer_accounts.balance) via
   charge_customer_for_moderator_subscription (migration 0051), which also
   credits the panel owner's Innvil balance with their commission share —
   the remainder is Innvil's own revenue, realized by never crediting it
   anywhere further (same implicit-revenue pattern as the 5% order commission).

   Separate from the older owner-facing prototype in moderator/plan.ts +
   actions/moderator.ts (panels.settings.addons.moderator, owner-granted
   trial) — that surface is untouched by this file.
   ========================================================= */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ctx(panelId: string) {
  const supa = await createStorefrontClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const admin = createAdminClient();
  const { data: panel } = await admin.from("panels").select("id, status, settings").eq("id", panelId).maybeSingle();
  if (!panel) return null;
  const { data: account } = await admin
    .from("customer_accounts")
    .select("id, balance, status, created_at")
    .eq("user_id", user.id)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (!account) return null;
  return { admin, panel, account };
}

/** Net lifetime spend on real panel services (SMM orders), refunds netted
 *  out — NEVER deposits, other add-on subscription charges, or manual
 *  balance adjustments. balance_transactions.ref_order_id is only ever set
 *  by genuine order placement/refund code (verified: no subscription/add-on
 *  charge in this codebase sets it), so filtering on it is what safely
 *  excludes everything the spec explicitly says not to count — filtering by
 *  `type = 'order'` alone would NOT be safe, since e.g. the Automator
 *  subscription charge also uses type='order' with no ref_order_id. */
async function lifetimeCompletedServiceSpend(admin: SupabaseClient, customerId: string): Promise<number> {
  const { data } = await admin
    .from("balance_transactions")
    .select("amount")
    .eq("customer_id", customerId)
    .in("type", ["order", "refund"])
    .not("ref_order_id", "is", null);
  return sumNetOrderSpend(((data as Array<{ amount: number | string }> | null) ?? []).map((r) => ({ amount: Number(r.amount) })));
}

function accountAgeDays(createdAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86_400_000);
}

export interface ModeratorEligibilityInfo {
  offered: boolean;
  /** Current entitlement, if any — "trial" only while trialAccessGranted() is true. */
  entitlementSource: "trial" | ModeratorPlanTier | null;
  maxActiveSlots: number;
  // Trial
  trialEverUsed: boolean;
  trialActive: boolean;
  trialQualificationSource: TrialQualificationSource | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** Only meaningful when trialQualificationSource === "WALLET". */
  trialPausedForWallet: boolean;
  canStartTrial: boolean;
  /** Which path the customer would qualify through right now, if they haven't used their trial yet. */
  wouldQualifyVia: TrialQualificationSource | null;
  // Paid plan
  tier: ModeratorPlanTier | null;
  lapsed: boolean;
  nextChargeAt: string | null;
  // Inputs, surfaced for storefront copy
  accountAgeDays: number;
  lifetimeSpend: number;
  walletBalance: number;
}

export async function getModeratorEligibility(panelId: string): Promise<ModeratorEligibilityInfo | null> {
  const c = await ctx(panelId);
  if (!c) return null;

  const spend = await lifetimeCompletedServiceSpend(c.admin, c.account.id);
  const age = accountAgeDays(c.account.created_at as string, new Date());
  const wallet = round4(Number(c.account.balance) || 0);
  const wouldQualifyVia = resolveTrialQualification({ accountAgeDays: age, lifetimeCompletedServiceSpend: spend, walletBalance: wallet });

  const { data: ent } = await c.admin
    .from("customer_moderator_entitlement")
    .select("tier, lapsed, next_charge_at, trial_started_at, trial_ends_at, trial_qualification_source")
    .eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();

  const tier = (ent?.tier as ModeratorPlanTier | null) ?? null;
  const trialStartedAt = (ent?.trial_started_at as string | null) ?? null;
  const trialEndsAt = (ent?.trial_ends_at as string | null) ?? null;
  const trialSource = (ent?.trial_qualification_source as TrialQualificationSource | null) ?? null;

  let trialActive = false;
  let trialPausedForWallet = false;
  if (trialStartedAt && trialEndsAt && trialSource) {
    const trial: PersistedTrialState = { qualificationSource: trialSource, startedAt: trialStartedAt, endsAt: trialEndsAt };
    trialActive = trialAccessGranted(trial, wallet, new Date());
    const expired = new Date(trialEndsAt).getTime() <= Date.now();
    trialPausedForWallet = trialSource === "WALLET" && !expired && !trialActive;
  }

  const entitlementSource: "trial" | ModeratorPlanTier | null = tier && !ent?.lapsed ? tier : trialActive ? "trial" : null;

  return {
    offered: true, // Phase 1: always offered; owner enable/disable toggle is a Phase 1.5/2 follow-up (see report).
    entitlementSource,
    maxActiveSlots: customerModeratorCapacity(entitlementSource).maxActiveSlots,
    trialEverUsed: !!trialStartedAt,
    trialActive,
    trialQualificationSource: trialSource,
    trialStartedAt,
    trialEndsAt,
    trialPausedForWallet,
    canStartTrial: !trialStartedAt && wouldQualifyVia !== null,
    wouldQualifyVia,
    tier,
    lapsed: ent?.lapsed ?? false,
    nextChargeAt: (ent?.next_charge_at as string | null) ?? null,
    accountAgeDays: age,
    lifetimeSpend: spend,
    walletBalance: wallet,
  };
}

/** Starts the 7-day trial — ONE-TIME per (panel, customer), enforced by the
 *  primary key on customer_moderator_entitlement. Re-derives eligibility
 *  server-side rather than trusting client state. */
export async function startCustomerModeratorTrial(panelId: string): Promise<Result<ModeratorEligibilityInfo>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  if (c.account.status !== "active") return { ok: false, error: "Your account can't start a trial right now." };

  const { data: existing } = await c.admin
    .from("customer_moderator_entitlement")
    .select("trial_started_at")
    .eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();
  if (existing?.trial_started_at) return { ok: false, error: "You've already used your free trial." };

  const spend = await lifetimeCompletedServiceSpend(c.admin, c.account.id);
  const age = accountAgeDays(c.account.created_at as string, new Date());
  const wallet = round4(Number(c.account.balance) || 0);
  const source = resolveTrialQualification({ accountAgeDays: age, lifetimeCompletedServiceSpend: spend, walletBalance: wallet });
  if (!source) {
    return {
      ok: false,
      error: `You're not eligible for the free trial yet. Keep at least $${TRIAL_WALLET_MIN_BALANCE.toFixed(2)} in your wallet to unlock it, or qualify through account history/spend.`,
    };
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + CUSTOMER_TRIAL_DURATION_DAYS * 86_400_000);
  const { error } = await c.admin.from("customer_moderator_entitlement").upsert(
    {
      panel_id: panelId,
      customer_id: c.account.id,
      trial_started_at: now.toISOString(),
      trial_ends_at: endsAt.toISOString(),
      trial_qualification_source: source,
    },
    { onConflict: "panel_id,customer_id" }
  );
  if (error) return { ok: false, error: error.message };

  const info = await getModeratorEligibility(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Trial started, but couldn't read state." };
}

/** Subscribe (or renew a lapsed sub) to a paid tier — charges the customer's
 *  wallet in full via the atomic RPC (migration 0051): debit customer,
 *  credit the owner's commission share, both-or-neither. */
export async function subscribeCustomerModeratorPlan(panelId: string, tier: ModeratorPlanTier): Promise<Result<ModeratorEligibilityInfo>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  if (c.account.status !== "active") return { ok: false, error: "Your account can't subscribe right now." };

  const { data: existing } = await c.admin
    .from("customer_moderator_entitlement")
    .select("tier, lapsed, since")
    .eq("panel_id", panelId).eq("customer_id", c.account.id).maybeSingle();
  if (existing?.tier === tier && !existing.lapsed) return { ok: false, error: "You're already on this plan." };

  const price = moderatorPlanPrice(tier);
  const ownerShare = round4(price * MODERATOR_COMMISSION_SHARE);
  const { data: chargeResult, error: chargeErr } = await c.admin.rpc("charge_customer_for_moderator_subscription", {
    p_customer_id: c.account.id,
    p_panel_id: panelId,
    p_amount: price,
    p_owner_share: ownerShare,
    p_reason: `AI Moderator subscription — ${tier}`,
  });
  if (chargeErr) return { ok: false, error: "Couldn't charge your wallet. Please try again." };
  if (chargeResult === "INSUFFICIENT_BALANCE") return { ok: false, error: `You need $${price.toFixed(2)} in your wallet. Add funds, then subscribe.` };
  if (chargeResult !== "OK") return { ok: false, error: "Couldn't complete the charge. Please try again." };

  const now = new Date();
  const next = new Date(now.getTime() + MODERATOR_PLAN_PERIOD_DAYS * 86_400_000);
  const { error } = await c.admin.from("customer_moderator_entitlement").upsert(
    {
      panel_id: panelId,
      customer_id: c.account.id,
      tier,
      since: (existing?.since as string | null) ?? now.toISOString(),
      last_charge_at: now.toISOString(),
      next_charge_at: next.toISOString(),
      lapsed: false,
    },
    { onConflict: "panel_id,customer_id" }
  );
  // The charge already succeeded and cannot be silently un-done here — a
  // failure to persist the tier is surfaced as an explicit error so support
  // can reconcile, rather than pretending the charge didn't happen.
  if (error) return { ok: false, error: `Charged, but couldn't activate the plan (${error.message}). Contact support.` };

  const info = await getModeratorEligibility(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Subscribed, but couldn't read state." };
}

export async function cancelCustomerModeratorPlan(panelId: string): Promise<Result<ModeratorEligibilityInfo>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  const { error } = await c.admin
    .from("customer_moderator_entitlement")
    .update({ tier: null, next_charge_at: null, lapsed: false })
    .eq("panel_id", panelId).eq("customer_id", c.account.id);
  if (error) return { ok: false, error: error.message };
  const info = await getModeratorEligibility(panelId);
  return info ? { ok: true, data: info } : { ok: false, error: "Canceled, but couldn't read state." };
}

/** Enterprise (20+ slots) is never self-serve — opens a real support ticket
 *  to the PANEL OWNER (the existing customer -> owner support path), not a
 *  direct customer -> Innvil channel, which doesn't exist by design (keeps
 *  Innvil invisible to end customers, same boundary as everywhere else). */
export async function contactEnterpriseModeratorSales(panelId: string, note: string): Promise<Result<{ id: string }>> {
  const subject = "Enterprise AI Moderator inquiry (20+ Active Moderator Slots)";
  const body = note.trim() || "I'm interested in an Enterprise AI Moderator plan (more than 20 Active Moderator Slots).";
  return createTicket(panelId, subject, body);
}

/* ------------------------------------------------------- moderator ownership ---- */

export interface CustomerModeratorRow {
  id: string;
  name: string;
  status: string;
  provisioningStatus: string;
}

/** The customer's OWN saved moderators only — never another customer's, even
 *  within the same panel (scoped by customer_id, not just panel_id). */
export async function listCustomerModerators(panelId: string): Promise<CustomerModeratorRow[]> {
  const c = await ctx(panelId);
  if (!c) return [];
  const { data } = await c.admin
    .from("virtual_moderators")
    .select("id, name, status, provisioning_status")
    .eq("panel_id", panelId)
    .eq("customer_id", c.account.id)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status),
    provisioningStatus: String(row.provisioning_status),
  }));
}

/** Creates a customer-owned VirtualModerator — gated on an active entitlement
 *  (trial or paid) and the saved-moderator cap for that entitlement's tier.
 *  Telegram provisioning (connect bot / connect community) reuses the SAME
 *  pipeline as the owner-facing flow in actions/moderator.ts; wiring the
 *  storefront through that pipeline is the explicit next follow-up (see the
 *  release note) rather than duplicated here. */
export async function createCustomerModerator(panelId: string, name: string): Promise<Result<CustomerModeratorRow>> {
  const c = await ctx(panelId);
  if (!c) return { ok: false, error: "Please log in." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 60) return { ok: false, error: "Name is too long." };

  const eligibility = await getModeratorEligibility(panelId);
  if (!eligibility || !eligibility.entitlementSource) {
    return { ok: false, error: "Start your free trial or subscribe to a plan before creating a moderator." };
  }

  const maxSaved = customerModeratorMaxSavedModerators(eligibility.entitlementSource);
  if (Number.isFinite(maxSaved)) {
    const { count } = await c.admin
      .from("virtual_moderators")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panelId)
      .eq("customer_id", c.account.id);
    if ((count ?? 0) >= maxSaved) {
      return { ok: false, error: `You've reached the limit of ${maxSaved} saved moderator(s) for your current plan.` };
    }
  }

  const { data, error } = await c.admin
    .from("virtual_moderators")
    .insert({
      panel_id: panelId,
      customer_id: c.account.id,
      name: trimmed,
      persona: DEFAULT_MODERATOR_PERSONA,
      provisioning_draft: DEFAULT_PROVISIONING_DRAFT,
    })
    .select("id, name, status, provisioning_status")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create moderator." };

  return { ok: true, data: { id: data.id, name: data.name, status: data.status, provisioningStatus: data.provisioning_status } };
}

/* ================================================================================
   Self-serve Telegram provisioning (Phase 4.M.1 Phase 2).

   Reuses the SAME Telegram-facing pipeline as the owner flow
   (actions/moderator.ts) via the shared, auth-agnostic helpers in
   moderator/manager.ts (deep-link building, username validation, bot-token
   verification, webhook registration, chat-membership checks) — nothing
   about how Innvil talks to Telegram is duplicated here.

   What IS separate from the owner flow, deliberately: the ownership check
   (customer_id, not panel owner_id) and the capacity/entitlement source
   (customerModeratorCapacity(eligibility.entitlementSource) — this
   customer's own trial/plan — never panels.settings, which governs the
   OWNER's own unrelated legacy moderator entitlement). The owner-only
   "start a trial on first deployment" step (startModeratorTrialIfEligible)
   is intentionally NOT called here — a customer's trial is explicit
   (startCustomerModeratorTrial), never silently auto-granted.
   ================================================================================ */

const PROVISIONING_ATTEMPT_TTL_MINUTES = 10;
const DEPLOYABLE_PROVISIONING_STATUSES = new Set(["bot_ready", "community_setup_required", "active"]);
const RETRIABLE_PROVISIONING_STATUSES = new Set([
  "draft", "requires_retry", "cancelled", "username_unavailable", "telegram_creation_failed", "credential_setup_failed", "expired",
]);

/** Customer-scoped equivalent of moderator.ts's ownedModerator() — verifies
 *  the storefront session AND that this moderator belongs to THIS customer
 *  (never another customer's, even within the same panel). */
async function ctxModerator(panelId: string, moderatorId: string) {
  const c = await ctx(panelId);
  if (!c) return null;
  const { data: moderator } = await c.admin
    .from("virtual_moderators")
    .select("id, name, provisioning_status, customer_id")
    .eq("id", moderatorId)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (!moderator || moderator.customer_id !== c.account.id) return null;
  return { ...c, moderator };
}

async function currentEntitlementSource(admin: SupabaseClient, panelId: string, customerId: string): Promise<"trial" | ModeratorPlanTier | null> {
  const { data: ent } = await admin
    .from("customer_moderator_entitlement")
    .select("tier, lapsed, trial_started_at, trial_ends_at, trial_qualification_source")
    .eq("panel_id", panelId).eq("customer_id", customerId).maybeSingle();
  if (ent?.tier && !ent.lapsed) return ent.tier as ModeratorPlanTier;
  if (ent?.trial_started_at && ent.trial_ends_at && ent.trial_qualification_source) {
    const { data: account } = await admin.from("customer_accounts").select("balance").eq("id", customerId).maybeSingle();
    const trial: PersistedTrialState = {
      qualificationSource: ent.trial_qualification_source as TrialQualificationSource,
      startedAt: ent.trial_started_at as string,
      endsAt: ent.trial_ends_at as string,
    };
    if (trialAccessGranted(trial, round4(Number(account?.balance) || 0), new Date())) return "trial";
  }
  return null;
}

export interface CustomerTelegramCreationRequest {
  deepLink: string;
  requestedUsername: string;
  expiresAt: string;
}

/** Primary "Innvil-first" path: reserve a username, hand back the Managed
 *  Bots deep link to open — mirrors requestTelegramCreation (moderator.ts),
 *  customer-owned-moderator scoped. */
export async function requestCustomerTelegramCreation(
  panelId: string,
  moderatorId: string,
  requestedUsername: string
): Promise<Result<CustomerTelegramCreationRequest>> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return { ok: false, error: "Moderator not found." };
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
    panel_id: panelId,
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

export interface CustomerModeratorProvisioningStatusInfo {
  provisioningStatus: string;
  telegramUsername: string | null;
  lastError: string | null;
}

/** Poll target for the "waiting on Telegram confirmation" UI state — same
 *  async-detection model as the owner flow (the Manager Bot's own webhook
 *  detects success server-side, not a redirect back from Telegram). */
export async function getCustomerModeratorProvisioning(panelId: string, moderatorId: string): Promise<CustomerModeratorProvisioningStatusInfo | null> {
  const c = await ctxModerator(panelId, moderatorId);
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

export async function cancelCustomerTelegramProvisioning(panelId: string, moderatorId: string): Promise<Result<null>> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return { ok: false, error: "Moderator not found." };
  await c.admin
    .from("telegram_provisioning_attempts")
    .update({ status: "cancelled" })
    .eq("virtual_moderator_id", moderatorId)
    .eq("status", "pending");
  await c.admin.from("virtual_moderators").update({ provisioning_status: "draft", last_error: null }).eq("id", moderatorId);
  return { ok: true, data: null };
}

/** Fallback path: connect an already-created bot by pasting its BotFather
 *  token — mirrors connectExistingBotToken (moderator.ts). */
export async function connectCustomerBotToken(panelId: string, moderatorId: string, token: string): Promise<Result<null>> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return { ok: false, error: "Moderator not found." };
  const trimmedToken = token.trim();
  if (!trimmedToken) return { ok: false, error: "Paste the bot token from BotFather." };

  const verified = await verifyBotToken(trimmedToken);
  if (!verified.ok || !verified.result?.is_bot) {
    return { ok: false, error: verified.ok ? "That token doesn't belong to a bot." : `Telegram rejected the token: ${verified.error}` };
  }

  const admin = createAdminClient();
  const { data: integration, error: integrationError } = await c.admin
    .from("telegram_bot_integrations")
    .upsert(
      {
        panel_id: panelId,
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

  const { error: keyError } = await admin.rpc("set_telegram_bot_key", {
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

export interface CustomerDeploymentHealthInfo {
  present: boolean;
  canSend: boolean;
  canDelete: boolean;
  canRestrict: boolean;
  checkedAt: string | null;
}

export interface CustomerCommunityDeploymentRow {
  deploymentId: string;
  communityId: string;
  chatId: string;
  handle: string | null;
  title: string | null;
  chatType: string | null;
  enabled: boolean;
  health: CustomerDeploymentHealthInfo;
  botAckMode: BotAckMode;
}

/** Connect a bot-ready moderator to a Telegram community — mirrors
 *  connectCommunity (moderator.ts), but capacity/limits are checked against
 *  THIS CUSTOMER's own entitlement (trial/plan), never the panel owner's. */
export async function connectCustomerCommunity(panelId: string, moderatorId: string, chatIdOrHandle: string): Promise<Result<CustomerCommunityDeploymentRow>> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return { ok: false, error: "Moderator not found." };
  if (!DEPLOYABLE_PROVISIONING_STATUSES.has(c.moderator.provisioning_status)) {
    return { ok: false, error: "Connect this moderator's Telegram bot before adding a community." };
  }
  const trimmed = chatIdOrHandle.trim();
  if (!trimmed) return { ok: false, error: "Enter a Telegram chat ID or @handle." };

  const { data: integration } = await c.admin
    .from("telegram_bot_integrations")
    .select("id")
    .eq("virtual_moderator_id", moderatorId)
    .maybeSingle();
  if (!integration) return { ok: false, error: "No Telegram bot connected for this moderator yet." };

  const { data: tokenData, error: keyError } = await c.admin.rpc("get_telegram_bot_key", {
    p_row: integration.id,
    p_secret: providerKeySecret(),
  });
  const token = tokenData as string | null;
  if (keyError || !token) return { ok: false, error: "Could not read this moderator's Telegram credential." };

  const membership = await checkChatMembership(token, trimmed);
  if (!membership.ok) return { ok: false, error: `Telegram couldn't verify that chat: ${membership.error}` };
  if (!membership.result.present) return { ok: false, error: "This bot isn't a member of that chat yet — add it in Telegram first, then try again." };

  const entitlementSource = await currentEntitlementSource(c.admin, panelId, c.account.id);
  const capacity = customerModeratorCapacity(entitlementSource);

  const { count: existingCommunityCount } = await c.admin
    .from("communities")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", panelId);
  const { data: existingCommunity } = await c.admin
    .from("communities")
    .select("id")
    .eq("panel_id", panelId)
    .eq("platform", "telegram")
    .eq("chat_id", String(membership.result.chat.id))
    .maybeSingle();
  if (!existingCommunity && (existingCommunityCount ?? 0) >= capacity.maxCommunities) {
    return { ok: false, error: `You've reached the limit of ${capacity.maxCommunities} communit${capacity.maxCommunities === 1 ? "y" : "ies"} for your current plan.` };
  }

  const { data: community, error: communityError } = await c.admin
    .from("communities")
    .upsert(
      {
        panel_id: panelId,
        platform: "telegram",
        chat_id: String(membership.result.chat.id),
        handle: membership.result.chat.username ?? null,
        title: membership.result.chat.title ?? null,
        chat_type: membership.result.chat.type ?? null,
      },
      { onConflict: "panel_id,platform,chat_id" }
    )
    .select("id, chat_id, handle, title, chat_type, bot_ack_mode")
    .single();
  if (communityError || !community) return { ok: false, error: communityError?.message ?? "Could not save the community." };

  const { count: activeSlotCount } = await c.admin
    .from("moderator_deployments")
    .select("id", { count: "exact", head: true })
    .eq("panel_id", panelId)
    .eq("enabled", true);
  const { data: existingDeployment } = await c.admin
    .from("moderator_deployments")
    .select("id, enabled")
    .eq("moderator_id", moderatorId)
    .eq("community_id", community.id)
    .maybeSingle();
  if (!existingDeployment && (activeSlotCount ?? 0) >= capacity.maxActiveSlots) {
    return { ok: false, error: `You've reached the limit of ${capacity.maxActiveSlots} active mod slot(s) for your current plan.` };
  }

  const { count: communityDeploymentCount } = await c.admin
    .from("moderator_deployments")
    .select("id", { count: "exact", head: true })
    .eq("community_id", community.id)
    .eq("enabled", true);
  if (!existingDeployment && (communityDeploymentCount ?? 0) >= MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY) {
    return { ok: false, error: `You've reached the maximum of ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} bots for this community.` };
  }

  const checkedAt = new Date().toISOString();
  const health: CustomerDeploymentHealthInfo = {
    present: membership.result.present,
    canSend: membership.result.canSend,
    canDelete: membership.result.canDelete,
    canRestrict: membership.result.canRestrict,
    checkedAt,
  };

  const { data: deployment, error: deploymentError } = await c.admin
    .from("moderator_deployments")
    .upsert(
      { panel_id: panelId, moderator_id: moderatorId, community_id: community.id, enabled: true, health },
      { onConflict: "moderator_id,community_id" }
    )
    .select("id")
    .single();
  if (deploymentError || !deployment) return { ok: false, error: deploymentError?.message ?? "Could not create the deployment." };

  await c.admin.from("virtual_moderators").update({ provisioning_status: "active" }).eq("id", moderatorId);

  return {
    ok: true,
    data: {
      deploymentId: deployment.id,
      communityId: community.id,
      chatId: community.chat_id,
      handle: community.handle,
      title: community.title,
      chatType: community.chat_type,
      enabled: true,
      health,
      botAckMode: (community.bot_ack_mode as BotAckMode) ?? "off",
    },
  };
}

export async function listCustomerModeratorCommunities(panelId: string, moderatorId: string): Promise<CustomerCommunityDeploymentRow[]> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return [];
  const { data } = await c.admin
    .from("moderator_deployments")
    .select("id, enabled, health, communities(id, chat_id, handle, title, chat_type, bot_ack_mode)")
    .eq("moderator_id", moderatorId)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const community = (Array.isArray(row.communities) ? row.communities[0] : row.communities) as
      | { id: string; chat_id: string; handle: string | null; title: string | null; chat_type: string | null; bot_ack_mode: string | null }
      | null;
    const health = (row.health as Partial<CustomerDeploymentHealthInfo>) ?? {};
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
      // Read-only from the customer side -- bot-ack mode is a community-wide
      // setting shared across every moderator deployed there (owner's and
      // customer's alike), so changing it stays an owner-only control
      // (setCommunityBotAckMode, moderator.ts) rather than duplicated here.
      botAckMode: (community?.bot_ack_mode as BotAckMode) ?? "off",
    };
  });
}

/** Pause/resume a deployment — mirrors setDeploymentEnabled (moderator.ts),
 *  customer-entitlement-capacity scoped. */
export async function setCustomerDeploymentEnabled(panelId: string, moderatorId: string, deploymentId: string, enabled: boolean): Promise<Result<null>> {
  const c = await ctxModerator(panelId, moderatorId);
  if (!c) return { ok: false, error: "Moderator not found." };

  if (enabled) {
    const entitlementSource = await currentEntitlementSource(c.admin, panelId, c.account.id);
    const capacity = customerModeratorCapacity(entitlementSource);
    const { count: activeSlotCount } = await c.admin
      .from("moderator_deployments")
      .select("id", { count: "exact", head: true })
      .eq("panel_id", panelId)
      .eq("enabled", true);
    if ((activeSlotCount ?? 0) >= capacity.maxActiveSlots) {
      return { ok: false, error: `You've reached the limit of ${capacity.maxActiveSlots} active mod slot(s) for your current plan.` };
    }

    const { data: target } = await c.admin.from("moderator_deployments").select("community_id").eq("id", deploymentId).maybeSingle();
    if (target?.community_id) {
      const { count: communityDeploymentCount } = await c.admin
        .from("moderator_deployments")
        .select("id", { count: "exact", head: true })
        .eq("community_id", target.community_id)
        .eq("enabled", true);
      if ((communityDeploymentCount ?? 0) >= MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY) {
        return { ok: false, error: `You've reached the maximum of ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} bots for this community.` };
      }
    }
  }

  const { error } = await c.admin
    .from("moderator_deployments")
    .update({ enabled })
    .eq("id", deploymentId)
    .eq("moderator_id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
