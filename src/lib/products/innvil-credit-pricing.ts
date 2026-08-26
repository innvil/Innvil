/**
 * Pure, client-safe (no `server-only`) Innvil Credit discount pricing --
 * the SINGLE canonical calculation every surface (Plans, Billing, the
 * purchase/renewal actions, tests) must call, never a duplicated
 * percentage formula. All arithmetic happens in integer CENTS to avoid
 * floating-point drift; dollars are only ever a display-boundary
 * conversion.
 *
 * Discount is keyed by the STABLE internal tier id ("basic"/"standard"/
 * "premium"/"pro"), never a display-name string comparison ("Silver").
 * Enterprise is structurally excluded -- it isn't a ModeratorPlanTier value
 * at all, so it can't compile into a call to these functions.
 */

import type { ModeratorPlanTier } from "@/src/lib/money";

/** Bronze gets no Innvil Credit discount; Silver/Gold/Platinum/BYO 20 get 5%
 *  off when paying with Innvil Credit instead of a direct crypto payment. */
export const INNVIL_CREDIT_DISCOUNT: Record<ModeratorPlanTier, number> = {
  basic: 0,
  standard: 0.05,
  premium: 0.05,
  pro: 0.05,
  byo20: 0.05,
};

/** Converts a canonical USD plan price into integer cents -- the ONE place
 *  this conversion happens, so every caller agrees on rounding. */
export function toCents(usd: number): number {
  return Math.round(usd * 100);
}

/** The Innvil Credit price for a plan, in integer cents, deterministically
 *  rounded (round-half-up via Math.round on the discounted cent value --
 *  never a second independent rounding rule anywhere else). */
export function creditPriceCents(regularPriceUsd: number, tier: ModeratorPlanTier): number {
  const regularCents = toCents(regularPriceUsd);
  const discount = INNVIL_CREDIT_DISCOUNT[tier];
  return Math.round(regularCents * (1 - discount));
}

/** Same as creditPriceCents, converted back to a display USD amount. The
 *  canonical PLAN price itself is never changed by this -- this is a
 *  payment-method benefit computed on top of it, not a new price. */
export function creditPriceUsd(regularPriceUsd: number, tier: ModeratorPlanTier): number {
  return creditPriceCents(regularPriceUsd, tier) / 100;
}

export function creditSavingsUsd(regularPriceUsd: number, tier: ModeratorPlanTier): number {
  return Math.round((toCents(regularPriceUsd) - creditPriceCents(regularPriceUsd, tier))) / 100;
}

/**
 * Annual billing -- a BILLING INTERVAL on the existing plan identity, never
 * a second product/plan id ("Silver Annual" etc.). Two independent annual
 * offers, both paid one year upfront: 10% off via Innvil Credit (below), or
 * 5% off via any available direct payment option (crypto -- see
 * ANNUAL_DIRECT_DISCOUNT_BPS further down). Neither stacks with the
 * separate monthly 5% credit discount -- annual has its own dedicated
 * pricing path entirely, for both payment methods.
 */
export const ANNUAL_CREDIT_DISCOUNT_BPS = 1000; // 10%, basis points (avoids a bare float percentage)

/** Every self-serve tier, including Bronze -- Bronze's monthly credit
 *  discount is 0%, but annual still applies the 10% annual discount
 *  (explicit, intentional per product decision: the two discounts are
 *  independent commercial rules, not "annual = monthly discount + more"). */
export const ANNUAL_ELIGIBLE_TIERS: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro", "byo20"];

function annualBaseCents(monthlyRegularPriceUsd: number): number {
  return toCents(monthlyRegularPriceUsd) * 12;
}

/** The Innvil Credit price for a full year, in integer cents -- 10% off
 *  12 × the canonical MONTHLY DIRECT price (never the already-discounted
 *  monthly credit price, which would obscure the intended 10% figure).
 *  Deterministically rounded the same way as creditPriceCents. */
export function annualCreditPriceCents(monthlyRegularPriceUsd: number): number {
  const base = annualBaseCents(monthlyRegularPriceUsd);
  return Math.round((base * (10000 - ANNUAL_CREDIT_DISCOUNT_BPS)) / 10000);
}

export function annualCreditPriceUsd(monthlyRegularPriceUsd: number): number {
  return annualCreditPriceCents(monthlyRegularPriceUsd) / 100;
}

/** Savings vs. 12 ordinary monthly DIRECT payments (never vs. the already-
 *  discounted monthly credit price -- that would understate the real
 *  annual benefit and obscure the 10% commercial model). */
export function annualSavingsUsd(monthlyRegularPriceUsd: number): number {
  return (annualBaseCents(monthlyRegularPriceUsd) - annualCreditPriceCents(monthlyRegularPriceUsd)) / 100;
}

/** Display-only "equivalent to $X/month" figure -- the customer is still
 *  charged the full annual amount upfront; this never implies installments. */
export function annualEquivalentMonthlyUsd(monthlyRegularPriceUsd: number): number {
  return Math.round(annualCreditPriceCents(monthlyRegularPriceUsd) / 12) / 100;
}

/**
 * Annual billing via DIRECT payment (crypto: Cryptomus/NOWPayments/Binance
 * Pay) -- a SECOND, smaller annual discount, independent of the Innvil
 * Credit annual discount above. Same base (12 * regular monthly price),
 * same "never stack with the monthly credit discount" rule, same
 * integer-cent rounding discipline. The two annual paths are genuinely
 * different offers, not one discount with a payment-method modifier:
 * paying a full year upfront in crypto saves 5%; paying a full year
 * upfront with Innvil Credit saves 10% -- Credit is the bigger incentive
 * by design, to encourage funding/holding a Credit balance.
 */
export const ANNUAL_DIRECT_DISCOUNT_BPS = 500; // 5%, basis points

/** The DIRECT (crypto) price for a full year, in integer cents -- 5% off
 *  12 x the canonical MONTHLY DIRECT price. Deterministically rounded the
 *  same way as annualCreditPriceCents. */
export function annualDirectPriceCents(monthlyRegularPriceUsd: number): number {
  const base = annualBaseCents(monthlyRegularPriceUsd);
  return Math.round((base * (10000 - ANNUAL_DIRECT_DISCOUNT_BPS)) / 10000);
}

export function annualDirectPriceUsd(monthlyRegularPriceUsd: number): number {
  return annualDirectPriceCents(monthlyRegularPriceUsd) / 100;
}

/** Savings vs. 12 ordinary monthly DIRECT payments (the same baseline
 *  annualSavingsUsd compares against, so the two annual offers' savings
 *  figures are directly comparable on the same page). */
export function annualDirectSavingsUsd(monthlyRegularPriceUsd: number): number {
  return (annualBaseCents(monthlyRegularPriceUsd) - annualDirectPriceCents(monthlyRegularPriceUsd)) / 100;
}

/** Display-only "equivalent to $X/month" for the DIRECT annual price. */
export function annualDirectEquivalentMonthlyUsd(monthlyRegularPriceUsd: number): number {
  return Math.round(annualDirectPriceCents(monthlyRegularPriceUsd) / 12) / 100;
}

/** How much MORE a customer saves by choosing Innvil Credit over direct
 *  crypto for the SAME annual purchase (10% vs. 5% -- the "upgrade your
 *  savings" delta the UI advertises), in USD. Always positive since the
 *  Credit discount is always the larger one, by construction. */
export function annualCreditExtraSavingsUsd(monthlyRegularPriceUsd: number): number {
  return (annualDirectPriceCents(monthlyRegularPriceUsd) - annualCreditPriceCents(monthlyRegularPriceUsd)) / 100;
}

/** Innvil Credit top-up bounds -- kept in this plain (non-`"use server"`)
 *  module so both the server-side checkout validator and the client-side
 *  amount input can import the SAME constants directly. A `"use server"`
 *  file may only export async functions (exporting a plain const from one
 *  breaks Next's combined server-actions bundle at module-evaluation time —
 *  see CLAUDE.md's standing rule on this), which is why these don't live in
 *  innvil-credit-checkout.ts itself. */
export const INNVIL_CREDIT_MIN_TOPUP_USD = 10;
export const INNVIL_CREDIT_MAX_TOPUP_USD = 10000;
