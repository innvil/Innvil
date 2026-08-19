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

/** Bronze gets no Innvil Credit discount; Silver/Gold/Platinum get 5% off
 *  when paying with Innvil Credit instead of a direct crypto payment. */
export const INNVIL_CREDIT_DISCOUNT: Record<ModeratorPlanTier, number> = {
  basic: 0,
  standard: 0.05,
  premium: 0.05,
  pro: 0.05,
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

/** Innvil Credit top-up bounds -- kept in this plain (non-`"use server"`)
 *  module so both the server-side checkout validator and the client-side
 *  amount input can import the SAME constants directly. A `"use server"`
 *  file may only export async functions (exporting a plain const from one
 *  breaks Next's combined server-actions bundle at module-evaluation time —
 *  see CLAUDE.md's standing rule on this), which is why these don't live in
 *  innvil-credit-checkout.ts itself. */
export const INNVIL_CREDIT_MIN_TOPUP_USD = 10;
export const INNVIL_CREDIT_MAX_TOPUP_USD = 10000;
