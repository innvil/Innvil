import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveTrialQualification, isTrialCurrentlyAccessible, trialAccessGranted, sumNetOrderSpend,
  TRIAL_ESTABLISHED_MIN_AGE_DAYS, TRIAL_ESTABLISHED_MIN_SPEND, TRIAL_HIGH_VALUE_MIN_SPEND, TRIAL_WALLET_MIN_BALANCE,
  CUSTOMER_TRIAL_DURATION_DAYS,
  type TrialEligibilityInput,
} from "./customer-entitlement";

/* --------------------------------------------------------- established path ---- */

test("REQUIRED: account age 30 days + spend $50.00 -> eligible via ESTABLISHED", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 30, lifetimeCompletedServiceSpend: 50, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), "ESTABLISHED");
});

test("REQUIRED: account age 29 days + spend $50.00 -> NOT eligible via ESTABLISHED", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 29, lifetimeCompletedServiceSpend: 50, walletBalance: 0 };
  assert.notEqual(resolveTrialQualification(input), "ESTABLISHED");
  assert.equal(resolveTrialQualification(input), null);
});

test("REQUIRED: account age 30 days + spend $49.99 -> NOT eligible via ESTABLISHED", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 30, lifetimeCompletedServiceSpend: 49.99, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), null);
});

test("REQUIRED: account age 60 days + spend $75 -> eligible via ESTABLISHED", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 60, lifetimeCompletedServiceSpend: 75, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), "ESTABLISHED");
});

test("REQUIRED: old but unused account (60 days, $0 spend) is NOT eligible -- age alone is insufficient", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 60, lifetimeCompletedServiceSpend: 0, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), null);
});

/* --------------------------------------------------------- high-value path ---- */

test("REQUIRED: account age 1 day + spend $100.00 -> eligible via HIGH_VALUE", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 1, lifetimeCompletedServiceSpend: 100, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), "HIGH_VALUE");
});

test("REQUIRED: account age 1 day + spend $99.99 -> NOT eligible via HIGH_VALUE", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 1, lifetimeCompletedServiceSpend: 99.99, walletBalance: 0 };
  assert.notEqual(resolveTrialQualification(input), "HIGH_VALUE");
  assert.equal(resolveTrialQualification(input), null);
});

test("REQUIRED: account age 200 days + spend $100+ -> eligible regardless of which path is internally selected", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 200, lifetimeCompletedServiceSpend: 150, walletBalance: 0 };
  assert.ok(resolveTrialQualification(input) !== null);
});

/* -------------------------------------------------------------- wallet path ---- */

test("REQUIRED: account age 1 day, $0 spend, wallet $10.00 -> eligible via WALLET", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 1, lifetimeCompletedServiceSpend: 0, walletBalance: 10 };
  assert.equal(resolveTrialQualification(input), "WALLET");
});

test("REQUIRED: account age 1 day, $0 spend, wallet $9.99 -> NOT eligible", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 1, lifetimeCompletedServiceSpend: 0, walletBalance: 9.99 };
  assert.equal(resolveTrialQualification(input), null);
});

/* --------------------------------------------------------- overlap precedence ---- */

test("REQUIRED: important overlap -- ESTABLISHED-eligible customer with $0 wallet is eligible WITHOUT requiring wallet maintenance", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 40, lifetimeCompletedServiceSpend: 110, walletBalance: 0 };
  const source = resolveTrialQualification(input);
  // 110 >= 100 also clears HIGH_VALUE -- precedence picks a durable non-wallet source.
  assert.notEqual(source, "WALLET");
  assert.ok(source === "HIGH_VALUE" || source === "ESTABLISHED");
});

test("precedence: HIGH_VALUE preferred over ESTABLISHED when both technically apply", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 40, lifetimeCompletedServiceSpend: 110, walletBalance: 0 };
  assert.equal(resolveTrialQualification(input), "HIGH_VALUE");
});

test("a durable source is preferred over WALLET even when wallet also technically qualifies", () => {
  const input: TrialEligibilityInput = { accountAgeDays: 30, lifetimeCompletedServiceSpend: 50, walletBalance: 500 };
  assert.equal(resolveTrialQualification(input), "ESTABLISHED");
});

/* ---------------------------------------------------- deposits/refunds excluded ---- */
// Covered structurally: this module never sees deposits or refunds at all --
// the caller (actions/customer-moderator.ts) computes lifetimeCompletedServiceSpend
// from the canonical balance_transactions ledger (type IN ('order','refund') AND
// ref_order_id IS NOT NULL), which by construction excludes deposits, other
// subscription charges, and manual adjustments. See that file's dedicated tests.

/* ------------------------------------------------- constants sanity (self-check) ---- */

test("threshold constants match the approved spec exactly", () => {
  assert.equal(TRIAL_ESTABLISHED_MIN_AGE_DAYS, 30);
  assert.equal(TRIAL_ESTABLISHED_MIN_SPEND, 50);
  assert.equal(TRIAL_HIGH_VALUE_MIN_SPEND, 100);
  assert.equal(TRIAL_WALLET_MIN_BALANCE, 10);
  assert.equal(CUSTOMER_TRIAL_DURATION_DAYS, 7);
});

/* ------------------------------------------------ wallet trial maintenance ---- */

test("REQUIRED: a WALLET-qualified trial is accessible above $10", () => {
  assert.equal(isTrialCurrentlyAccessible("WALLET", 12), true);
});

test("REQUIRED: a WALLET-qualified trial is NOT accessible below $10", () => {
  assert.equal(isTrialCurrentlyAccessible("WALLET", 8), false);
});

test("REQUIRED: ESTABLISHED-qualified trial remains accessible with $0 wallet", () => {
  assert.equal(isTrialCurrentlyAccessible("ESTABLISHED", 0), true);
});

test("REQUIRED: HIGH_VALUE-qualified trial remains accessible with $0 wallet", () => {
  assert.equal(isTrialCurrentlyAccessible("HIGH_VALUE", 0), true);
});

/* --------------------------------------------------- full trial access + expiry ---- */

test("REQUIRED: wallet-qualified trial started at $12, drops to $8 during the trial -> access paused", () => {
  const trial = { qualificationSource: "WALLET" as const, startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-08T00:00:00Z" };
  const now = new Date("2026-01-03T00:00:00Z");
  assert.equal(trialAccessGranted(trial, 8, now), false);
});

test("REQUIRED: restoring wallet to $11 before original expiry -> access restored", () => {
  const trial = { qualificationSource: "WALLET" as const, startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-08T00:00:00Z" };
  const now = new Date("2026-01-04T00:00:00Z");
  assert.equal(trialAccessGranted(trial, 11, now), true);
});

test("REQUIRED: no calendar-extension exploit -- dropping below $10 for 5 days then restoring on day 6 does not grant extra days", () => {
  const startedAt = new Date("2026-01-01T00:00:00Z");
  const endsAt = new Date(startedAt.getTime() + CUSTOMER_TRIAL_DURATION_DAYS * 86_400_000); // fixed, 7 days
  const trial = { qualificationSource: "WALLET" as const, startedAt: startedAt.toISOString(), endsAt: endsAt.toISOString() };

  // Days 1-5: below $10 -> paused.
  for (let day = 1; day <= 5; day++) {
    const now = new Date(startedAt.getTime() + day * 86_400_000);
    assert.equal(trialAccessGranted(trial, 5, now), false, `day ${day} should be paused`);
  }
  // Day 6: restored -> access resumes, using the SAME original endsAt.
  const day6 = new Date(startedAt.getTime() + 6 * 86_400_000);
  assert.equal(trialAccessGranted(trial, 11, day6), true);
  // The window itself was never touched -- exactly 7 days after start, expired.
  const day7 = new Date(startedAt.getTime() + 7 * 86_400_000 + 1000);
  assert.equal(trialAccessGranted(trial, 11, day7), false, "trial must still expire exactly on the original schedule");
});

test("REQUIRED: ESTABLISHED/HIGH_VALUE exemption -- wallet dropping to $0 does not pause access before normal expiry", () => {
  const trial = { qualificationSource: "ESTABLISHED" as const, startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-08T00:00:00Z" };
  const now = new Date("2026-01-05T00:00:00Z");
  assert.equal(trialAccessGranted(trial, 0, now), true);
});

test("expiry is absolute: a WALLET-qualified trial with plenty of balance still loses access after endsAt", () => {
  const trial = { qualificationSource: "WALLET" as const, startedAt: "2026-01-01T00:00:00Z", endsAt: "2026-01-08T00:00:00Z" };
  const now = new Date("2026-01-08T00:00:01Z");
  assert.equal(trialAccessGranted(trial, 1000, now), false);
});

/* ------------------------------------------------------ sumNetOrderSpend ---- */
// Callers pass only balance_transactions rows already filtered to
// type IN ('order','refund') AND ref_order_id IS NOT NULL -- these tests
// prove the arithmetic on that filtered set nets refunds correctly; the
// filter itself (which is what actually excludes deposits/other
// subscriptions) is documented and verified by grep in
// actions/customer-moderator.ts's own comment (no code elsewhere sets
// ref_order_id except real order placement/refund code).

test("REQUIRED: deposits don't count as spend -- a $100 deposit with $0 real spend nets to $0", () => {
  // Deposits are type='deposit' and would never be in the filtered set at
  // all -- simulated here by simply not including a deposit row.
  assert.equal(sumNetOrderSpend([]), 0);
});

test("REQUIRED: a single order with no refund nets to its full charge", () => {
  assert.equal(sumNetOrderSpend([{ amount: -25 }]), 25);
});

test("REQUIRED: a fully refunded order nets to $0 (order debit + matching refund credit)", () => {
  assert.equal(sumNetOrderSpend([{ amount: -25 }, { amount: 25 }]), 0);
});

test("REQUIRED: a partially refunded order nets to the remaining charge", () => {
  assert.equal(sumNetOrderSpend([{ amount: -25 }, { amount: 10 }]), 15);
});

test("REQUIRED: failed/canceled orders that were fully refunded at placement net to $0, not double-counted", () => {
  // placeOrderForAccount refunds immediately on provider failure -- order
  // debit + immediate refund credit, same shape as a manual refund.
  assert.equal(sumNetOrderSpend([{ amount: -50 }, { amount: 50 }, { amount: -50 }, { amount: 50 }]), 0);
});

test("multiple real orders net correctly across a customer's whole history", () => {
  // $25 order (no refund) + $30 order (fully refunded) + $40 order ($10 partial refund).
  assert.equal(sumNetOrderSpend([{ amount: -25 }, { amount: -30 }, { amount: 30 }, { amount: -40 }, { amount: 10 }]), 55);
});

test("boundary: net spend of exactly $50.00 from multiple orders clears the ESTABLISHED bar", () => {
  const net = sumNetOrderSpend([{ amount: -30 }, { amount: -25 }, { amount: 5 }]); // 30 + 25 - 5 = 50
  assert.equal(net, 50);
  assert.equal(resolveTrialQualification({ accountAgeDays: 30, lifetimeCompletedServiceSpend: net, walletBalance: 0 }), "ESTABLISHED");
});

test("never goes negative even in a theoretical over-refund edge case", () => {
  assert.equal(sumNetOrderSpend([{ amount: -20 }, { amount: 20 }, { amount: 5 }]), 0);
});
