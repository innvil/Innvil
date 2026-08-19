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
 * invoice + redirect) and `verifyWebhook` — genuinely usable here through
 * this generic flow. Binance Pay's adapter (`adapters/binance.ts`) is
 * deliberately transaction-id-based (`createCheckout` THROWS by design,
 * `verifyWebhook` always returns `paid:false`) — it exists only so the
 * owner's CONNECT form can reuse the shared credential-storage UI, and is
 * therefore NOT part of THIS generic hosted-checkout flow. Binance Pay IS
 * supported for direct Watch, through its own dedicated claim-by-
 * transaction-id flow — see `watch-binance.ts` (`createWatchBinanceDeposit`/
 * `claimWatchBinancePayment`, migration 0068).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAdapter } from "@/src/lib/payments/adapters";
import { getPlatformGatewayContext } from "@/src/lib/payments/platform";
import { watchPlanOptions, type WatchPlanDisplayName, watchTierFromDisplayName, watchPlanDisplayName } from "./watch-plans";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { getAccountPaidPlan, listAccountCommunities } from "./watch-runtime";
import { getCommunityExpansionState } from "./watch-community-expansion";
import { COMMUNITY_EXPANSION_MONTHLY_PRICE, isCommunityExpansionEligibleTier, type ModeratorPlanTier } from "@/src/lib/money";
import { CAPACITY } from "@/src/lib/moderator/plan";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Providers usable through THIS generic hosted-checkout flow — Binance Pay
 *  is handled separately (see file doc comment above), not because it's
 *  unsupported, but because its claim shape is structurally different.
 *  NOT exported: a `"use server"` file may only export async functions --
 *  exporting this constant directly breaks Next's combined server-actions
 *  bundle at module-evaluation time (taking down every OTHER server action
 *  in the app as collateral damage, incl. totally unrelated ones like
 *  signOutAction). Nothing outside this file needs it (verified: no other
 *  module imports it), so it's simply kept internal. */
const WATCH_DIRECT_PAYMENT_GATEWAYS = ["cryptomus", "nowpayments"] as const;

/** How long an unconfirmed pending checkout still blocks creating a new
 *  one (matches typical crypto-invoice-provider expiry windows). This
 *  codebase has no provider-side "invoice expired" webhook/callback for
 *  any gateway today, so a genuinely-abandoned invoice would otherwise
 *  block a customer from ever retrying -- past this window a NEW pending
 *  checkout is allowed again even though the stale row is never deleted
 *  (a duplicate CONFIRMED payment is still impossible either way, since
 *  each deposit's own atomic pending->completed claim in
 *  handlePlatformWebhook is what actually gates entitlement activation). */
const PENDING_CHECKOUT_STALE_MINUTES = 60;

/** Real pending crypto payment for this account's direct Watch subscription
 *  (initial purchase or renewal -- both share the same `watch_subscription`
 *  purpose, see the module doc's "one checkout shape either way" note),
 *  or null. Billing surfaces this instead of letting the customer create a
 *  second, duplicate pending invoice on every button click. */
export interface PendingWatchPayment {
  id: string;
  gateway: string;
  plan: string | null;
  amount: number;
  currency: string;
  createdAt: string;
}
export async function getPendingWatchPayment(): Promise<PendingWatchPayment | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const staleBefore = new Date(Date.now() - PENDING_CHECKOUT_STALE_MINUTES * 60_000).toISOString();
  const { data } = await admin
    .from("platform_deposits")
    .select("id, gateway, plan, paid_amount, currency, created_at")
    .eq("owner_id", user.id)
    .eq("purpose", "watch_subscription")
    .eq("status", "pending")
    .gte("created_at", staleBefore)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    gateway: data.gateway as string,
    plan: (data.plan as string | null) ?? null,
    amount: Number(data.paid_amount ?? 0),
    currency: (data.currency as string | null) ?? "USD",
    createdAt: data.created_at as string,
  };
}

/**
 * Creates a checkout for the direct Watch product -- used for BOTH an
 * initial purchase AND a renewal/plan-change. Deliberately the SAME
 * function/shape either way: what a checkout charges for is identical from
 * the payment-provider's point of view ("pay $X for plan Y via gateway
 * Z"); what differs is only computed AFTER settlement, inside
 * `activateWatchEntitlement` (which reads the account's CURRENT
 * entitlement state at that moment to decide whether to extend an existing
 * period or start a fresh one) -- so there's no separate "renewal purpose"
 * to invent or keep in sync.
 */
export async function createDirectWatchCheckout(
  planName: Exclude<WatchPlanDisplayName, "Enterprise">,
  gateway: string
): Promise<Result<{ url: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!(WATCH_DIRECT_PAYMENT_GATEWAYS as readonly string[]).includes(gateway)) {
    return { ok: false, error: "That payment method isn't available for a direct Watch subscription." };
  }

  const pending = await getPendingWatchPayment();
  if (pending) return { ok: false, error: "You already have a pending payment for this subscription. Complete or wait for it to clear before starting another." };

  const tier = watchTierFromDisplayName(planName);
  const basePrice = watchPlanOptions().find((o) => o.tier === tier)?.price;
  if (!basePrice) return { ok: false, error: "Unknown plan." };

  // Community Expansion renews TOGETHER with the base subscription -- if
  // this is a renewal (same tier already held) with an active, non-
  // removal-pending addon, its price is folded into this SAME checkout,
  // never a second/independent crypto charge.
  let price = basePrice;
  const existingPlan = await getAccountPaidPlan(admin, user.id);
  if (existingPlan && existingPlan.tier === tier && isCommunityExpansionEligibleTier(tier)) {
    const expansion = await getCommunityExpansionState(admin, user.id);
    if (expansion && !expansion.cancelAtPeriodEnd) price += COMMUNITY_EXPANSION_MONTHLY_PRICE[tier];
  } else if (existingPlan && existingPlan.tier !== tier) {
    // A plan CHANGE never carries Community Expansion across tiers (see
    // watch-community-expansion.ts's finalizeAddonsOnTierChange doc comment)
    // -- block the checkout itself (never just hide it in UI) if current
    // Community usage would exceed the NEW tier's included capacity once the
    // add-on is finalized on settlement (platform.ts's webhook handler).
    const expansion = await getCommunityExpansionState(admin, user.id);
    if (expansion) {
      const communities = await listAccountCommunities(admin, user.id);
      const includedCap = CAPACITY[tier as ModeratorPlanTier].maxCommunities;
      if (communities.length > includedCap) {
        return {
          ok: false,
          error: `You have ${communities.length} Communities connected — more than the ${includedCap} included in this plan. Disconnect down to ${includedCap} or fewer before changing plans (Community Expansion doesn't carry over to a new plan automatically).`,
        };
      }
    }
  }

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

/**
 * Standalone direct-crypto purchase of Community Expansion (Gold/Platinum,
 * MONTHLY only -- annual is Innvil-Credit-only by product rule, and this
 * function never accepts a billing-interval parameter at all, the same
 * "structurally impossible" pattern used for the base annual plan). A
 * distinct purpose (`watch_addon_purchase`, migration 0083) so the webhook
 * activates the ADD-ON, never re-extends/misinterprets the base
 * subscription period.
 */
export async function createCommunityExpansionCheckout(gateway: string): Promise<Result<{ url: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  if (!(WATCH_DIRECT_PAYMENT_GATEWAYS as readonly string[]).includes(gateway)) {
    return { ok: false, error: "That payment method isn't available for Community Expansion." };
  }

  const paidPlan = await getAccountPaidPlan(admin, user.id);
  if (!paidPlan || paidPlan.expired) return { ok: false, error: "An active paid Watch subscription is required." };
  if (!isCommunityExpansionEligibleTier(paidPlan.tier)) return { ok: false, error: "Community Expansion is only available on Gold and Platinum." };

  const existing = await getCommunityExpansionState(admin, user.id);
  if (existing && !existing.cancelAtPeriodEnd) return { ok: false, error: "Community Expansion is already active." };

  const { data: pendingAddon } = await admin
    .from("platform_deposits")
    .select("id")
    .eq("owner_id", user.id)
    .eq("purpose", "watch_addon_purchase")
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (pendingAddon) return { ok: false, error: "You already have a pending Community Expansion payment. Complete or wait for it to clear before starting another." };

  const price = COMMUNITY_EXPANSION_MONTHLY_PRICE[paidPlan.tier];

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
      purpose: "watch_addon_purchase",
      product_id: product.id,
      plan: paidPlan.tier,
      paid_amount: price,
      credit_amount: price,
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

export interface WatchPaymentRecord {
  id: string;
  createdAt: string;
  plan: string | null;
  gateway: string;
  amount: number;
  currency: string;
  status: string;
  reference: string | null;
  purpose: "watch_subscription" | "watch_addon_purchase";
}

/** Real crypto payment/invoice history for the authenticated account only --
 *  never trusts a client-supplied account id, scoped by owner_id + the two
 *  direct-Watch purposes (base subscription + standalone Community
 *  Expansion crypto purchases) so a panel-owner's unrelated Forge top-ups
 *  never leak in here. This is a checkout-event history (one row per
 *  invoice attempted), not a fabricated recurring-billing ledger. A
 *  renewal that folded in an active add-on's price is still ONE real
 *  `watch_subscription` row for the combined amount -- never duplicated
 *  into a second misleading row. */
export async function listWatchPaymentHistory(): Promise<WatchPaymentRecord[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  const { data } = await admin
    .from("platform_deposits")
    .select("id, created_at, plan, gateway, paid_amount, currency, status, gateway_ref, purpose")
    .eq("owner_id", user.id)
    .in("purpose", ["watch_subscription", "watch_addon_purchase"])
    .order("created_at", { ascending: false });
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    plan: (r.plan as string | null) ?? null,
    gateway: r.gateway as string,
    amount: Number(r.paid_amount ?? 0),
    currency: (r.currency as string | null) ?? "USD",
    status: r.status as string,
    reference: (r.gateway_ref as string | null) ?? null,
    purpose: r.purpose as "watch_subscription" | "watch_addon_purchase",
  }));
}

/** Which providers can actually be offered right now — configured AND
 *  either on the direct-checkout-capable allowlist above OR Binance Pay
 *  (its own dedicated claim-by-transaction-id flow, watch-binance.ts).
 *  Never claims a provider works without checking its stored credentials
 *  actually exist. */
export async function listAvailableDirectWatchGateways(): Promise<string[]> {
  const admin = createAdminClient();
  const available: string[] = [];
  for (const gateway of WATCH_DIRECT_PAYMENT_GATEWAYS) {
    const ctx = await getPlatformGatewayContext(gateway);
    if (ctx && Object.keys(ctx.secrets).length > 0) available.push(gateway);
  }
  const binanceCtx = await getPlatformGatewayContext("binance_pay");
  if (binanceCtx && binanceCtx.config.payId && binanceCtx.secrets.apiKey && binanceCtx.secrets.apiSecret) {
    available.push("binance_pay");
  }
  return available;
}
