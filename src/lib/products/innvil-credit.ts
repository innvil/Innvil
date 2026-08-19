import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { activateWatchEntitlement } from "./ownership";
import { getAccountPaidPlan } from "./watch-runtime";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { watchPlanOptions, watchTierFromDisplayName, type WatchPlanDisplayName } from "./watch-plans";
import { creditPriceCents } from "./innvil-credit-pricing";

/**
 * Innvil Credit — a reusable, account-owned (never Panel-owned), USD-
 * denominated prepaid service credit (migration 0081). Explicitly NOT a
 * crypto custody wallet: balance_cents is a plain USD ledger amount, never
 * a stored coin/token quantity; there is no withdrawal, no transfer, no
 * exchange, and no code path in this file (or anywhere else) exposes one.
 *
 * The ONLY authoritative mutation path is the `apply_innvil_credit_change`
 * Postgres function (security definer, row-locks the account, rejects a
 * negative balance, writes exactly one immutable ledger row per call) —
 * every function below is a thin, typed wrapper over that RPC. Application
 * code never reads-then-writes a balance.
 */

export interface InnvilCreditBalance {
  balanceCents: number;
  balanceUsd: number;
}

/** Real, current balance -- lazily reads a zero balance for an account with
 *  no ledger activity yet (no row is created here; apply_innvil_credit_change
 *  creates the account row on first mutation, which is the only place a
 *  balance can ever change anyway). */
export async function getInnvilCreditBalance(admin: SupabaseClient, accountId: string): Promise<InnvilCreditBalance> {
  const { data } = await admin.from("innvil_credit_accounts").select("balance_cents").eq("account_id", accountId).maybeSingle();
  const balanceCents = Number(data?.balance_cents ?? 0);
  return { balanceCents, balanceUsd: balanceCents / 100 };
}

export interface CreditActivityItem {
  id: string;
  createdAt: string;
  type: string;
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
}

export async function listInnvilCreditActivity(admin: SupabaseClient, accountId: string, limit = 30): Promise<CreditActivityItem[]> {
  const { data } = await admin
    .from("innvil_credit_transactions")
    .select("id, created_at, type, amount_cents, balance_after_cents, description")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    type: r.type as string,
    amountCents: Number(r.amount_cents),
    balanceAfterCents: Number(r.balance_after_cents),
    description: (r.description as string | null) ?? null,
  }));
}

type CreditRpcResult = { id: string; balance_after_cents: number };

async function applyCreditChange(
  admin: SupabaseClient,
  accountId: string,
  amountCents: number,
  type: "crypto_top_up" | "subscription_purchase" | "subscription_renewal" | "adjustment",
  opts: { productId?: string | null; paymentRef?: string | null; description?: string | null } = {}
): Promise<{ ok: true; data: CreditRpcResult } | { ok: false; error: string; code?: string }> {
  const { data, error } = await admin.rpc("apply_innvil_credit_change", {
    p_account: accountId,
    p_amount_cents: amountCents,
    p_type: type,
    p_product: opts.productId ?? null,
    p_payment_ref: opts.paymentRef ?? null,
    p_description: opts.description ?? null,
  });
  if (error) {
    if (error.message?.includes("insufficient_credit")) return { ok: false, error: "Not enough Innvil Credit.", code: "insufficient_credit" };
    if (error.code === "23505") return { ok: false, error: "This payment has already been credited.", code: "duplicate" };
    return { ok: false, error: error.message ?? "Could not update Innvil Credit." };
  }
  return { ok: true, data: data as CreditRpcResult };
}

/** Called ONLY from the authoritative crypto top-up webhook path
 *  (`platform.ts`'s `handlePlatformWebhook`, purpose='innvil_credit_topup')
 *  — never from a client redirect. `paymentRef` is the originating
 *  `platform_deposits.id`; the ledger's own unique index on `payment_ref`
 *  makes a duplicate webhook call for the SAME confirmed payment a clean,
 *  fully-rolled-back no-op (caught below via the `duplicate` code) rather
 *  than a double-credit. */
export async function creditInnvilCreditTopUp(admin: SupabaseClient, accountId: string, amountCents: number, depositId: string): Promise<void> {
  const result = await applyCreditChange(admin, accountId, amountCents, "crypto_top_up", { paymentRef: depositId, description: "Crypto top-up" });
  if (!result.ok && result.code !== "duplicate") {
    console.error("[innvil-credit] top-up crediting failed", { accountId, depositId, error: result.error });
  }
}

export type PurchaseWithCreditResult =
  | { ok: true; paidThrough: string | null; balanceCents: number }
  | { ok: false; error: string };

/**
 * Purchases OR renews the direct Watch subscription using Innvil Credit --
 * the SAME single function either way (mirrors createDirectWatchCheckout's
 * own "one shape, purpose derived at settlement time" design), since
 * activateWatchEntitlement already decides purchase-vs-renewal timing from
 * the account's current entitlement state. Debit-then-activate, with a
 * compensating reversal ledger entry if activation itself fails after a
 * successful debit -- true single-statement DB atomicity across the credit
 * ledger and product_entitlements isn't attempted here (they're two
 * separate tables mutated by two separate calls); this is a deliberate,
 * documented compensating-transaction choice, not full ACID atomicity.
 */
export async function purchaseWatchWithCredit(admin: SupabaseClient, accountId: string, planName: Exclude<WatchPlanDisplayName, "Enterprise">): Promise<PurchaseWithCreditResult> {
  const tier = watchTierFromDisplayName(planName);
  const option = watchPlanOptions().find((o) => o.tier === tier);
  if (!option) return { ok: false, error: "Unknown plan." };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const existingPlan = await getAccountPaidPlan(admin, accountId);
  const type = existingPlan ? "subscription_renewal" : "subscription_purchase";
  const priceCents = creditPriceCents(option.price, tier);

  const debit = await applyCreditChange(admin, accountId, -priceCents, type, {
    productId: product.id as string,
    description: `${option.displayName} — ${type === "subscription_renewal" ? "renewal" : "subscription"}`,
  });
  if (!debit.ok) return { ok: false, error: debit.error };

  try {
    await activateWatchEntitlement(admin, accountId, tier, `credit:${debit.data.id}`);
  } catch (e) {
    // Compensating reversal -- the debit already committed; refund it in
    // full rather than leave the customer charged with no active
    // subscription to show for it.
    await applyCreditChange(admin, accountId, priceCents, "adjustment", {
      productId: product.id as string,
      paymentRef: `reversal:${debit.data.id}`,
      description: "Reversal: subscription activation failed",
    });
    return { ok: false, error: e instanceof Error ? e.message : "Could not activate the subscription. Your credit was refunded." };
  }

  const paidPlan = await getAccountPaidPlan(admin, accountId);
  return { ok: true, paidThrough: paidPlan?.currentPeriodEnd ?? null, balanceCents: debit.data.balance_after_cents };
}
