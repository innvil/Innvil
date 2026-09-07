"use server";

/**
 * Innvil Credit top-up checkout — reuses the EXISTING platform_payment_
 * gateways/platform_deposits system (same pattern as watch-checkout.ts),
 * with `purpose='innvil_credit_topup'` (migration 0081) so the shared
 * webhook handler credits the ledger instead of activating a Watch
 * subscription or a panel balance. Cryptomus/NOWPayments only in this
 * pass -- Binance Pay's claim-by-transaction-id flow (watch-binance.ts) is
 * a structurally separate flow per gateway; wiring a THIRD purpose through
 * it is deferred (documented, not silently skipped -- see CLAUDE.md).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { getAdapter } from "@/src/lib/payments/adapters";
import { getPlatformGatewayContext } from "@/src/lib/payments/platform";
import { INNVIL_CREDIT_MIN_TOPUP_USD, INNVIL_CREDIT_MAX_TOPUP_USD } from "./innvil-credit-pricing";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const INNVIL_CREDIT_TOPUP_GATEWAYS = ["cryptomus", "nowpayments"] as const;

export async function listAvailableInnvilCreditGateways(): Promise<string[]> {
  const available: string[] = [];
  for (const gateway of INNVIL_CREDIT_TOPUP_GATEWAYS) {
    const ctx = await getPlatformGatewayContext(gateway);
    if (ctx && Object.keys(ctx.secrets).length > 0) available.push(gateway);
  }
  return available;
}

export async function createInnvilCreditTopUpCheckout(amountUsd: number, gateway: string): Promise<Result<{ url: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!(INNVIL_CREDIT_TOPUP_GATEWAYS as readonly string[]).includes(gateway)) {
    return { ok: false, error: "That payment method isn't available for Innvil Credit." };
  }
  const amount = Math.round(amountUsd * 100) / 100;
  if (!Number.isFinite(amount) || amount < INNVIL_CREDIT_MIN_TOPUP_USD || amount > INNVIL_CREDIT_MAX_TOPUP_USD) {
    return { ok: false, error: `Enter an amount between $${INNVIL_CREDIT_MIN_TOPUP_USD} and $${INNVIL_CREDIT_MAX_TOPUP_USD}.` };
  }

  const adapter = getAdapter(gateway);
  if (!adapter) return { ok: false, error: "That gateway isn't implemented." };
  const ctx = await getPlatformGatewayContext(gateway);
  if (!ctx || Object.keys(ctx.secrets).length === 0) {
    return { ok: false, error: "This payment method isn't fully configured yet. Please contact support." };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (!appUrl) return { ok: false, error: "Payments aren't configured (NEXT_PUBLIC_APP_URL)." };

  const { data: deposit, error } = await admin
    .from("platform_deposits")
    .insert({
      owner_id: user.id,
      panel_id: null,
      gateway,
      purpose: "innvil_credit_topup",
      product_id: null,
      plan: null,
      paid_amount: amount,
      credit_amount: amount,
      currency: "USD",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !deposit) return { ok: false, error: error?.message ?? "Could not start the payment." };

  try {
    const { url, ref } = await adapter.createCheckout({
      amount,
      currency: "USD",
      orderId: deposit.id as string,
      callbackUrl: `${appUrl}/api/webhooks/platform/${gateway}`,
      returnUrl: `${appUrl}/billing`,
      config: ctx.config,
      secrets: ctx.secrets,
      customerEmail: user.email ?? null,
    });
    await admin.from("platform_deposits").update({ gateway_ref: ref }).eq("id", deposit.id);
    return { ok: true, data: { url } };
  } catch (e) {
    await admin.from("platform_deposits").delete().eq("id", deposit.id);
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach the payment gateway." };
  }
}
