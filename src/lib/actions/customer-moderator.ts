"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createStorefrontClient } from "@/src/lib/supabase/server";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { round4, MODERATOR_COMMISSION_SHARE, MODERATOR_PLAN_PERIOD_DAYS, moderatorPlanPrice, type ModeratorPlanTier } from "@/src/lib/money";
import {
  resolveTrialQualification, trialAccessGranted, customerModeratorCapacity, customerModeratorMaxSavedModerators, sumNetOrderSpend,
  CUSTOMER_TRIAL_DURATION_DAYS, TRIAL_WALLET_MIN_BALANCE,
  type TrialQualificationSource, type PersistedTrialState,
} from "@/src/lib/moderator/customer-entitlement";
import { DEFAULT_MODERATOR_PERSONA, DEFAULT_PROVISIONING_DRAFT } from "@/src/lib/moderator/domain";
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
