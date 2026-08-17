"use server";

/**
 * Direct (Panel-less) Innvil Watch checkout — reuses the EXISTING
 * platform_payment_gateways / platform_deposits system (`actions/platform-
 * payments.ts`'s `createPlatformDeposit`, migrations 0008/0016) that already
 * powers owner→Innvil top-ups via Cryptomus/NOWPayments, rather than
 * building a second payment system. The only new things are: `panel_id`
 * is null, `purpose='watch_subscription'`, and a `product_id`/`plan` are
 * attached (migration 0067) so the shared webhook handler
 * (`src/lib/payments/platform.ts`) can activate a Watch entitlement instead
 * of crediting a panel's Innvil balance.
 *
 * Payment provider status (checked before writing this, not assumed):
 * Cryptomus and NOWPayments both implement a real `createCheckout` (hosted
 * invoice + redirect) and `verifyWebhook` — genuinely usable here. Binance
 * Pay's adapter (`adapters/binance.ts`) is deliberately transaction-id-based
 * (`createCheckout` THROWS by design, `verifyWebhook` always returns
 * `paid:false`) — it exists only so the owner's CONNECT form can reuse the
 * shared credential-storage UI, never for an actual checkout. Binance Pay is
 * therefore NOT offered here; it would need its own bespoke claim-by-
 * transaction-id flow (like the existing panel-level Binance Pay feature)
 * to support Watch, which is not built this pass.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAdapter } from "@/src/lib/payments/adapters";
import { getPlatformGatewayContext } from "@/src/lib/payments/platform";
import { watchPlanOptions, type WatchPlanDisplayName, watchTierFromDisplayName } from "./watch-plans";
import { WATCH_PRODUCT_SLUG } from "./watch";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Providers actually usable for a real Watch hosted checkout — Binance Pay
 *  is deliberately excluded (see file doc comment above). */
export const WATCH_DIRECT_PAYMENT_GATEWAYS = ["cryptomus", "nowpayments"] as const;

export async function createDirectWatchCheckout(
  planName: Exclude<WatchPlanDisplayName, "Enterprise">,
  gateway: string
): Promise<Result<{ url: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!(WATCH_DIRECT_PAYMENT_GATEWAYS as readonly string[]).includes(gateway)) {
    return { ok: false, error: "That payment method isn't available for a direct Watch subscription." };
  }

  const tier = watchTierFromDisplayName(planName);
  const price = watchPlanOptions().find((o) => o.tier === tier)?.price;
  if (!price) return { ok: false, error: "Unknown plan." };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

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
      purpose: "watch_subscription",
      product_id: product.id,
      plan: tier,
      paid_amount: price,
      credit_amount: price, // no top-up bonus logic for a direct subscription purchase
      currency: "USD",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !deposit) return { ok: false, error: error?.message ?? "Could not start the payment." };

  try {
    const { url, ref } = await adapter.createCheckout({
      amount: price,
      currency: "USD",
      orderId: deposit.id as string,
      callbackUrl: `${appUrl}/api/webhooks/platform/${gateway}`,
      returnUrl: `${appUrl}/`,
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

/** Which providers can actually be offered right now — configured AND on
 *  the direct-checkout-capable allowlist above. Never claims a provider
 *  works without checking its stored credentials exist. */
export async function listAvailableDirectWatchGateways(): Promise<string[]> {
  const admin = createAdminClient();
  const available: string[] = [];
  for (const gateway of WATCH_DIRECT_PAYMENT_GATEWAYS) {
    const ctx = await getPlatformGatewayContext(gateway);
    if (ctx && Object.keys(ctx.secrets).length > 0) available.push(gateway);
  }
  return available;
}
