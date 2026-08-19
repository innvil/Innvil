"use server";

/**
 * Thin auth wrappers around the session-less core in
 * src/lib/products/innvil-credit.ts — every export re-derives the account
 * from the authenticated session, never a client-supplied id (same
 * established pattern as watch-dashboard.ts/watch-trial.ts).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { getInnvilCreditBalance, listInnvilCreditActivity, purchaseWatchWithCredit } from "@/src/lib/products/innvil-credit";
import type { InnvilCreditBalance, CreditActivityItem, PurchaseWithCreditResult } from "@/src/lib/products/innvil-credit";
import type { WatchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";

export async function getInnvilCreditBalanceAction(): Promise<InnvilCreditBalance> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { balanceCents: 0, balanceUsd: 0 };
  return getInnvilCreditBalance(admin, user.id);
}

export async function listInnvilCreditActivityAction(): Promise<CreditActivityItem[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  return listInnvilCreditActivity(admin, user.id);
}

export async function purchaseWatchWithCreditAction(
  planName: Exclude<WatchPlanDisplayName, "Enterprise">,
  billingInterval: WatchBillingInterval = "monthly"
): Promise<PurchaseWithCreditResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return purchaseWatchWithCredit(admin, user.id, planName, billingInterval);
}
