/* =========================================================
   Customer-facing AI Moderator entitlement — pure logic, no I/O.

   This is the STOREFRONT product: a panel CUSTOMER (not the panel owner)
   qualifies for a free 7-day trial, or subscribes to a paid tier, from
   their own panel wallet (customer_accounts.balance). Separate from the
   older owner-facing prototype in moderator/plan.ts (panels.settings.addons
   .moderator), which this does not touch or read.

   Trial eligibility (exact rule, from the approved spec):
     eligibleEstablished = accountAgeDays >= 30 AND lifetimeCompletedServiceSpend >= 50
     eligibleHighValue   = lifetimeCompletedServiceSpend >= 100
     eligibleByWallet    = walletBalance >= 10
     canStartTrial = eligibleEstablished OR eligibleHighValue OR eligibleByWallet

   Precedence when resolving WHICH source to persist (HIGH_VALUE, then
   ESTABLISHED, then WALLET) prefers a durable non-wallet qualification over
   WALLET, so a customer who happens to also clear a spend/age bar is never
   subjected to the $10 maintenance rule.

   The $10 is NEVER a fee — it is the customer's own usable wallet balance,
   never charged or confiscated by starting/maintaining a trial.

   Trial window is FIXED at start (trialStartedAt/trialEndsAt) and never
   recomputed. A WALLET-qualified trial whose balance drops below $10 loses
   ACCESS (a live, derived check re-evaluated every read) without touching
   the window — restoring the balance re-enables access only if the
   original window hasn't expired. There is deliberately no persisted
   "paused" flag: pause/resume is a pure function of (qualification source,
   current wallet balance, now vs. trialEndsAt), which structurally
   prevents any "dip below $10 to extend the trial" exploit.
   ========================================================= */

import type { ModeratorPlanTier } from "@/src/lib/money";
import { CAPACITY, TRIAL_CAPACITY, type ModeratorCapacity } from "./plan";

export const TRIAL_ESTABLISHED_MIN_AGE_DAYS = 30;
export const TRIAL_ESTABLISHED_MIN_SPEND = 50;
export const TRIAL_HIGH_VALUE_MIN_SPEND = 100;
export const TRIAL_WALLET_MIN_BALANCE = 10;
export const CUSTOMER_TRIAL_DURATION_DAYS = 7;

export type TrialQualificationSource = "ESTABLISHED" | "HIGH_VALUE" | "WALLET";

export interface TrialEligibilityInput {
  accountAgeDays: number;
  /** Net of refunds, real panel-service orders only — never deposits,
   *  subscription charges, or manual adjustments. See
   *  actions/customer-moderator.ts's lifetimeCompletedServiceSpend() for the
   *  canonical calculation against balance_transactions. */
  lifetimeCompletedServiceSpend: number;
  walletBalance: number;
}

/** Cent-integer comparison — avoids float drift at exact-dollar boundaries
 *  ($49.99 vs $50.00, $9.99 vs $10.00). */
function cents(n: number): number {
  return Math.round(n * 100);
}

/** Which path (if any) qualifies this customer to START a trial right now.
 *  Precedence: HIGH_VALUE > ESTABLISHED > WALLET — prefers a durable
 *  non-wallet source when more than one technically applies, per the
 *  explicit "prefer a durable non-wallet qualification source" instruction. */
export function resolveTrialQualification(input: TrialEligibilityInput): TrialQualificationSource | null {
  const spend = cents(input.lifetimeCompletedServiceSpend);
  if (spend >= cents(TRIAL_HIGH_VALUE_MIN_SPEND)) return "HIGH_VALUE";
  if (input.accountAgeDays >= TRIAL_ESTABLISHED_MIN_AGE_DAYS && spend >= cents(TRIAL_ESTABLISHED_MIN_SPEND)) return "ESTABLISHED";
  if (cents(input.walletBalance) >= cents(TRIAL_WALLET_MIN_BALANCE)) return "WALLET";
  return null;
}

/** True when a WALLET-qualified trial's maintenance condition is currently
 *  met. ESTABLISHED/HIGH_VALUE sources are permanently exempt — the $10
 *  rule applies ONLY to a trial that was started via the wallet path. */
export function isTrialCurrentlyAccessible(qualificationSource: TrialQualificationSource, walletBalance: number): boolean {
  if (qualificationSource !== "WALLET") return true;
  return cents(walletBalance) >= cents(TRIAL_WALLET_MIN_BALANCE);
}

export interface PersistedTrialState {
  qualificationSource: TrialQualificationSource;
  startedAt: string;
  /** Fixed at start. Never recomputed/extended by this module or any caller. */
  endsAt: string;
}

/** Whether an already-started trial currently grants access — combines the
 *  fixed expiry window with the live wallet-maintenance check. This is the
 *  ONLY function that decides "is the trial usable right now"; nothing else
 *  should re-derive this independently. */
export function trialAccessGranted(trial: PersistedTrialState, walletBalance: number, now: Date): boolean {
  if (new Date(trial.endsAt).getTime() <= now.getTime()) return false;
  return isTrialCurrentlyAccessible(trial.qualificationSource, walletBalance);
}

/** Pure ledger-netting logic behind lifetimeCompletedServiceSpend
 *  (actions/customer-moderator.ts) — extracted so the exact "deposits/other
 *  subscriptions don't count, refunds net out" behavior is directly
 *  testable without a live database. Callers pass only
 *  balance_transactions rows already filtered to
 *  `type IN ('order','refund') AND ref_order_id IS NOT NULL` (the safe
 *  filter — ref_order_id is only ever set by genuine order placement/refund
 *  code, never by deposits or other add-on subscription charges, even ones
 *  that also use type='order'). 'order' rows are negative debits, 'refund'
 *  rows are positive credits back; net spend is the negated sum, clamped at
 *  0 for the (over-refund) edge case. */
export function sumNetOrderSpend(transactions: Array<{ amount: number }>): number {
  const total = transactions.reduce((sum, row) => sum + Number(row.amount), 0);
  return Math.max(0, Math.round(-total * 10000) / 10000);
}

/** Active Moderator Slot capacity for a customer's current entitlement —
 *  reuses the exact same tier->slots table as the legacy owner-facing model
 *  (moderator/plan.ts CAPACITY) since the numbers are shared; only ownership
 *  and billing differ. */
export function customerModeratorCapacity(source: "trial" | ModeratorPlanTier | null): ModeratorCapacity {
  if (source === "trial") return TRIAL_CAPACITY;
  if (source) return CAPACITY[source];
  return { maxCommunities: 0, maxActiveSlots: 0 };
}

/** Max saved (not necessarily deployed) VirtualModerator identities for a
 *  customer's current entitlement — mirrors the owner-facing model's own
 *  rule (moderator/plan.ts moderatorMaxSavedModerators): capped at the
 *  entitlement's Active Mod Slot count, since a persona the customer can
 *  never deploy isn't worth letting them save either. */
export function customerModeratorMaxSavedModerators(source: "trial" | ModeratorPlanTier | null): number {
  return customerModeratorCapacity(source).maxActiveSlots;
}

export type ModeratorPricingTier = { tier: ModeratorPlanTier; price: number; slots: number };
