import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { activateWatchEntitlement, setPendingWatchTier } from "./ownership";
import { getAccountPaidPlan, listAccountCommunities, resolveAccountWatchTier } from "./watch-runtime";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { watchPlanOptions, watchPlanDisplayName, watchTierFromDisplayName, type WatchPlanDisplayName } from "./watch-plans";
import { creditPriceCents, annualCreditPriceCents, ANNUAL_ELIGIBLE_TIERS } from "./innvil-credit-pricing";
import type { WatchBillingInterval } from "./watch-billing-period";
import { getCommunityExpansionState, finalizeAddonsOnRenewal, finalizeAddonsOnTierChange } from "./watch-community-expansion";
import { getMediaModerationAddonState } from "./watch-media-moderation-addon";
import { getMediaModerationExpansionUnits } from "./watch-media-moderation-expansion";
import { resolveAccountBillingPeriod } from "./watch-ai-usage";
import {
  COMMUNITY_EXPANSION_MONTHLY_PRICE, isCommunityExpansionEligibleTier, MODERATOR_MEDIA_ADDON,
  mediaModerationExpansionPackByUnits, type ModeratorPlanTier,
} from "@/src/lib/money";
import { CAPACITY } from "@/src/lib/moderator/plan";

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
  | {
      ok: true;
      paidThrough: string | null;
      balanceCents: number;
      /** True only when this call SCHEDULED a downgrade rather than
       *  charging/activating anything right now -- see the "downgrades are
       *  deferred" section below. `effectiveAt` is the account's current
       *  `current_period_end`, i.e. when the scheduled tier actually takes
       *  over. Omitted (undefined) for every other outcome (a fresh
       *  purchase, an upgrade, a same-tier renewal, or a previously-
       *  scheduled downgrade actually being applied), so an existing caller
       *  checking only `ok`/`paidThrough`/`balanceCents` is unaffected. */
      scheduled?: boolean;
      effectiveAt?: string | null;
    }
  | { ok: false; error: string };

/**
 * Purchases OR renews the direct Watch subscription using Innvil Credit --
 * the SAME single function either way (mirrors createDirectWatchCheckout's
 * own "one shape, purpose derived at settlement time" design), since
 * activateWatchEntitlement already decides purchase-vs-renewal timing from
 * the account's current entitlement state. Also the SAME function for
 * monthly and annual billing intervals -- annual is not a second purchase
 * path, just a different canonical price + a different period-extension
 * length, both already parameterized. Debit-then-activate, with a
 * compensating reversal ledger entry if activation itself fails after a
 * successful debit -- true single-statement DB atomicity across the credit
 * ledger and product_entitlements isn't attempted here (they're two
 * separate tables mutated by two separate calls); this is a deliberate,
 * documented compensating-transaction choice, not full ACID atomicity.
 *
 * Also this function's own single entry point for BOTH plan changes:
 *
 * - An UPGRADE (the requested tier's regular price is higher than the
 *   account's current tier) takes effect immediately, charged the
 *   DIFFERENCE between the new tier's price and the current tier's price
 *   at the SAME billing interval -- never the new tier's full price on top
 *   of what was already paid this period. The period is still extended via
 *   the existing activateWatchEntitlement/computeRenewedPeriod mechanics,
 *   unchanged from before this pass -- only the CHARGED AMOUNT changed.
 * - A DOWNGRADE (the requested tier's regular price is lower) is never
 *   charged or activated immediately. It's recorded as `pending_tier`
 *   (migration 0111) and takes effect automatically at the account's own
 *   next renewal -- either the customer clicking "Renew" (RenewWatchButton
 *   always passes the account's CURRENT tier, so that call lands in the
 *   `applyingPendingDowngrade` branch below) or the automatic
 *   sweepWatchAutoRenewals cron. At that point it's charged the pending
 *   tier's OWN full price (never a delta off the higher tier it replaces).
 */
export async function purchaseWatchWithCredit(
  admin: SupabaseClient,
  accountId: string,
  planName: Exclude<WatchPlanDisplayName, "Enterprise">,
  billingInterval: WatchBillingInterval = "monthly"
): Promise<PurchaseWithCreditResult> {
  const requestedTier = watchTierFromDisplayName(planName);
  const requestedOption = watchPlanOptions().find((o) => o.tier === requestedTier);
  if (!requestedOption) return { ok: false, error: "Unknown plan." };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const existingPlan = await getAccountPaidPlan(admin, accountId);

  // Renewing at the account's OWN current tier while a downgrade is
  // already scheduled means renewal time has actually arrived -- the
  // scheduled downgrade takes effect NOW, at ITS OWN price, instead of
  // renewing the higher tier it's meant to replace. Every other case
  // (a fresh purchase, an explicit upgrade, a brand-new downgrade request)
  // resolves the tier from what the caller actually requested.
  const applyingPendingDowngrade = !!(existingPlan && requestedTier === existingPlan.tier && existingPlan.pendingTier);
  const tier = applyingPendingDowngrade ? (existingPlan!.pendingTier as ModeratorPlanTier) : requestedTier;
  const option = applyingPendingDowngrade ? watchPlanOptions().find((o) => o.tier === tier)! : requestedOption;

  if (billingInterval === "annual" && !ANNUAL_ELIGIBLE_TIERS.includes(tier)) {
    return { ok: false, error: "Annual billing isn't available for this plan." };
  }

  const type = existingPlan ? "subscription_renewal" : "subscription_purchase";
  let priceCents = billingInterval === "annual" ? annualCreditPriceCents(option.price) : creditPriceCents(option.price, tier);

  // Community Expansion renews TOGETHER with the base subscription, one
  // atomic combined debit -- never a second/independent charge. Only
  // folded in on a genuine RENEWAL of the tier the account is already ON
  // (never when applying a pending downgrade, which is itself a tier
  // change -- addons never carry across one, see below), and only when
  // it's not scheduled for removal (cancel_at_period_end) -- a removal-
  // pending addon is finalized (see finalizeAddonsOnRenewal below) and
  // simply isn't charged for this final time.
  const foldedAddonLabels: string[] = [];
  let addonToFinalizeOnTierChange = false;
  const isGenuineSameTierRenewal = !!existingPlan && existingPlan.tier === tier && !applyingPendingDowngrade;
  if (isGenuineSameTierRenewal && isCommunityExpansionEligibleTier(tier)) {
    const expansion = await getCommunityExpansionState(admin, accountId);
    if (expansion && !expansion.cancelAtPeriodEnd) {
      const addonRegular = COMMUNITY_EXPANSION_MONTHLY_PRICE[tier];
      priceCents += billingInterval === "annual" ? annualCreditPriceCents(addonRegular) : creditPriceCents(addonRegular, tier);
      foldedAddonLabels.push("Community Expansion");
    }
  }
  // Media Moderation + renews together with the base subscription too --
  // available on ALL FOUR self-serve tiers (never gated to Gold/Platinum
  // like Community Expansion), so this check runs independently of the
  // eligibility branch above; both addons can be folded into the SAME
  // combined debit simultaneously.
  if (isGenuineSameTierRenewal) {
    const media = await getMediaModerationAddonState(admin, accountId, tier);
    if (media && !media.cancelAtPeriodEnd) {
      const addonRegular = MODERATOR_MEDIA_ADDON[tier].price;
      priceCents += billingInterval === "annual" ? annualCreditPriceCents(addonRegular) : creditPriceCents(addonRegular, tier);
      foldedAddonLabels.push("Media Moderation +");
    }
  }

  const isTierChange = !!existingPlan && existingPlan.tier !== tier;
  if (isTierChange) {
    const currentOption = watchPlanOptions().find((o) => o.tier === existingPlan!.tier);
    const isDowngrade = !!currentOption && option.price < currentOption.price;

    if (isDowngrade && !applyingPendingDowngrade) {
      // A NEW downgrade request -- never charged, never activated right
      // now. Validated against the SAME community-capacity guard an
      // immediate tier change already used, checked here at SCHEDULING
      // time (not re-validated at the moment the downgrade actually
      // applies -- a small, documented limitation: the worst case is the
      // downgrade taking effect while the account is still over the new
      // tier's Community cap, which is exactly the same "connected
      // resources are never force-disconnected" behavior this codebase
      // already has everywhere else once a plan's limits are exceeded).
      const communities = await listAccountCommunities(admin, accountId);
      const includedCap = CAPACITY[tier as ModeratorPlanTier].maxCommunities;
      if (communities.length > includedCap) {
        return {
          ok: false,
          error: `You have ${communities.length} Communities connected — more than the ${includedCap} included in ${option.displayName}. Disconnect down to ${includedCap} or fewer before scheduling this downgrade.`,
        };
      }
      await setPendingWatchTier(admin, accountId, tier);
      return {
        ok: true,
        paidThrough: existingPlan!.currentPeriodEnd,
        balanceCents: (await getInnvilCreditBalance(admin, accountId)).balanceCents,
        scheduled: true,
        effectiveAt: existingPlan!.currentPeriodEnd,
      };
    }

    // An upgrade, or a previously-scheduled downgrade finally taking
    // effect at its own renewal moment. Neither carries an active
    // Community Expansion OR Media Moderation + add-on across the tier
    // change -- see finalizeAddonsOnTierChange's own doc comment for why.
    // Blocked here (not just hidden in UI) if current Community usage
    // would exceed the NEW tier's plain INCLUDED capacity. Media
    // Moderation + has no equivalent usage-safety check (no per-request
    // consumption metering exists to check against yet) -- it's simply
    // finalized/removed on any tier change, same as Community Expansion.
    const expansion = await getCommunityExpansionState(admin, accountId);
    if (expansion) {
      const communities = await listAccountCommunities(admin, accountId);
      const includedCap = CAPACITY[tier as ModeratorPlanTier].maxCommunities;
      if (communities.length > includedCap) {
        return {
          ok: false,
          error: `You have ${communities.length} Communities connected — more than the ${includedCap} included in ${option.displayName}. Disconnect down to ${includedCap} or fewer before changing plans (Community Expansion doesn't carry over to a new plan automatically).`,
        };
      }
      addonToFinalizeOnTierChange = true;
    }
    const existingMedia = await getMediaModerationAddonState(admin, accountId, existingPlan!.tier);
    if (existingMedia) addonToFinalizeOnTierChange = true;

    // Upgrade pricing -- charge only the DIFFERENCE between the new
    // tier's price and what the account is already paying for its
    // current tier, at the SAME billing interval, never the new tier's
    // full price stacked on top of what this period already cost. An
    // already-scheduled downgrade actually taking effect is priced at
    // the pending tier's OWN full price (computed above, unchanged) --
    // it isn't a delta off the higher tier it's replacing.
    if (!applyingPendingDowngrade && currentOption) {
      const currentTierPriceCents = billingInterval === "annual" ? annualCreditPriceCents(currentOption.price) : creditPriceCents(currentOption.price, existingPlan!.tier);
      priceCents = Math.max(0, priceCents - currentTierPriceCents);
    }
  }

  let debitId: string | null = null;
  let balanceAfterCents: number;
  if (priceCents > 0) {
    const debit = await applyCreditChange(admin, accountId, -priceCents, type, {
      productId: product.id as string,
      description: `${option.displayName} — ${billingInterval === "annual" ? "annual" : ""} ${type === "subscription_renewal" ? "renewal" : "subscription"}${foldedAddonLabels.length ? ` (incl. ${foldedAddonLabels.join(" + ")})` : ""}`.replace(/\s+/g, " ").trim(),
    });
    if (!debit.ok) return { ok: false, error: debit.error };
    debitId = debit.data.id;
    balanceAfterCents = debit.data.balance_after_cents;
  } else {
    // A $0 charge (an upgrade whose price difference rounds to nothing, or
    // two tiers priced identically) -- never a debit for zero, still a
    // real activation. `subscriptionRef` still needs a unique-looking
    // pointer, so a plain timestamp stands in for a real deposit/ledger id.
    debitId = `free:${Date.now()}`;
    balanceAfterCents = (await getInnvilCreditBalance(admin, accountId)).balanceCents;
  }

  try {
    await activateWatchEntitlement(admin, accountId, tier, `credit:${debitId}`, billingInterval, undefined, undefined, undefined, undefined, true);
    await finalizeAddonsOnRenewal(admin, accountId);
    if (addonToFinalizeOnTierChange) await finalizeAddonsOnTierChange(admin, accountId);
  } catch (e) {
    // Compensating reversal -- the debit (if any) already committed;
    // refund it in full rather than leave the customer charged with no
    // active subscription to show for it.
    if (priceCents > 0) {
      await applyCreditChange(admin, accountId, priceCents, "adjustment", {
        productId: product.id as string,
        paymentRef: `reversal:${debitId}`,
        description: "Reversal: subscription activation failed",
      });
    }
    return { ok: false, error: e instanceof Error ? e.message : "Could not activate the subscription. Your credit was refunded." };
  }

  const paidPlan = await getAccountPaidPlan(admin, accountId);
  return { ok: true, paidThrough: paidPlan?.currentPeriodEnd ?? null, balanceCents: balanceAfterCents };
}

/** Clears a scheduled downgrade set by purchaseWatchWithCredit -- the
 *  account simply keeps renewing at its current tier going forward, same
 *  as if the downgrade had never been requested. A no-op if nothing is
 *  scheduled. */
export async function cancelPendingWatchDowngrade(admin: SupabaseClient, accountId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = await getAccountPaidPlan(admin, accountId);
  if (!plan) return { ok: false, error: "No active Watch subscription found." };
  if (!plan.pendingTier) return { ok: true };
  await setPendingWatchTier(admin, accountId, null);
  return { ok: true };
}

export type CommunityExpansionPurchaseResult =
  | { ok: true; balanceCents: number; active: true }
  | { ok: false; error: string };

/**
 * Purchases (or, if already active, safely no-ops / un-cancels) Community
 * Expansion for the account's CURRENT Gold/Platinum tier -- Innvil Credit
 * only in this function; the direct-crypto monthly path lives in
 * watch-checkout.ts's `createCommunityExpansionCheckout`. Priced at the
 * account's own billing interval (monthly credit price, or the annual
 * price if the base subscription is annual) via the SAME canonical
 * creditPriceCents/annualCreditPriceCents functions the base plan uses --
 * never a duplicated discount formula.
 */
export async function purchaseCommunityExpansionWithCredit(admin: SupabaseClient, accountId: string): Promise<CommunityExpansionPurchaseResult> {
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (!tier) return { ok: false, error: "An active paid Watch subscription is required." };
  if (!isCommunityExpansionEligibleTier(tier)) return { ok: false, error: "Community Expansion is only available on Gold and Platinum." };

  const existing = await getCommunityExpansionState(admin, accountId);
  if (existing) {
    // Already active -- if it was scheduled for removal, un-cancel it (no
    // re-charge; the customer already paid for the period it's still in).
    if (existing.cancelAtPeriodEnd) {
      await admin.from("watch_subscription_addons").update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
        .eq("account_id", accountId).eq("addon_type", "community_expansion").eq("status", "active");
    }
    const balance = await getInnvilCreditBalance(admin, accountId);
    return { ok: true, balanceCents: balance.balanceCents, active: true };
  }

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const paidPlan = await getAccountPaidPlan(admin, accountId);
  const billingInterval = paidPlan?.billingInterval ?? "monthly";
  const regular = COMMUNITY_EXPANSION_MONTHLY_PRICE[tier];
  const priceCents = billingInterval === "annual" ? annualCreditPriceCents(regular) : creditPriceCents(regular, tier);
  const planName = watchPlanDisplayName(tier);

  const debit = await applyCreditChange(admin, accountId, -priceCents, "subscription_purchase", {
    productId: product.id as string,
    description: `${planName} Community Expansion${billingInterval === "annual" ? " (annual)" : ""}`,
  });
  if (!debit.ok) return { ok: false, error: debit.error };

  const { error } = await admin.from("watch_subscription_addons").insert({ account_id: accountId, addon_type: "community_expansion", status: "active" });
  if (error) {
    // A concurrent purchase already activated it (23505 on the partial
    // unique index), or a genuine failure -- either way, reverse this
    // debit; never leave a charge with nothing to show for it.
    await applyCreditChange(admin, accountId, priceCents, "adjustment", {
      productId: product.id as string,
      paymentRef: `reversal:${debit.data.id}`,
      description: error.code === "23505" ? "Reversal: Community Expansion already active" : "Reversal: Community Expansion activation failed",
    });
    if (error.code === "23505") {
      const balance = await getInnvilCreditBalance(admin, accountId);
      return { ok: true, balanceCents: balance.balanceCents, active: true };
    }
    return { ok: false, error: "Could not activate Community Expansion. Your credit was refunded." };
  }

  const balance = await getInnvilCreditBalance(admin, accountId);
  return { ok: true, balanceCents: balance.balanceCents, active: true };
}

export type ScheduleRemovalResult = { ok: true } | { ok: false; error: string };

/**
 * Schedules Community Expansion for removal at the end of the CURRENT
 * paid period -- never an immediate capacity cut, never a refund for
 * unused time. Blocked server-side (never just hidden in UI) if current
 * Community usage already exceeds the plan's INCLUDED (non-expanded) cap
 * -- removing the add-on would otherwise leave the account over its own
 * effective capacity.
 */
export async function scheduleCommunityExpansionRemoval(admin: SupabaseClient, accountId: string): Promise<ScheduleRemovalResult> {
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (!tier || !isCommunityExpansionEligibleTier(tier)) return { ok: false, error: "No active Community Expansion to remove." };

  const existing = await getCommunityExpansionState(admin, accountId);
  if (!existing) return { ok: false, error: "No active Community Expansion to remove." };
  if (existing.cancelAtPeriodEnd) return { ok: true }; // already scheduled -- idempotent

  const communities = await listAccountCommunities(admin, accountId);
  const includedCap = CAPACITY[tier as ModeratorPlanTier].maxCommunities;
  if (communities.length > includedCap) {
    return {
      ok: false,
      error: `You have ${communities.length} Communities connected — more than the ${includedCap} included in ${watchPlanDisplayName(tier)}. Disconnect down to ${includedCap} or fewer before removing Community Expansion.`,
    };
  }

  await admin.from("watch_subscription_addons").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("addon_type", "community_expansion").eq("status", "active");
  return { ok: true };
}

export type MediaModerationAddonPurchaseResult =
  | { ok: true; balanceCents: number; active: true; units: number }
  | { ok: false; error: string };

/**
 * Purchases (or, if already active, safely no-ops / un-cancels) Media
 * Moderation + for the account's CURRENT self-serve tier -- Innvil Credit
 * only (mirrors purchaseCommunityExpansionWithCredit exactly; there is no
 * direct-crypto checkout path for this add-on yet, a real, documented gap
 * -- see the dated CLAUDE.md entry, not silently faked here).
 *
 * Unlike Community Expansion, ALL FOUR self-serve tiers are eligible --
 * there is no premium/pro-only restriction, since MODERATOR_MEDIA_ADDON
 * defines a real price/unit allowance for every tier including Bronze.
 * Priced at the account's own billing interval via the SAME canonical
 * creditPriceCents/annualCreditPriceCents functions every other Watch
 * purchase uses -- never a duplicated discount formula.
 */
export async function purchaseMediaModerationAddonWithCredit(admin: SupabaseClient, accountId: string): Promise<MediaModerationAddonPurchaseResult> {
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (!tier) return { ok: false, error: "An active paid Watch subscription is required." };

  const existing = await getMediaModerationAddonState(admin, accountId, tier);
  if (existing) {
    // Already active -- if it was scheduled for removal, un-cancel it (no
    // re-charge; the customer already paid for the period it's still in).
    if (existing.cancelAtPeriodEnd) {
      await admin.from("watch_subscription_addons").update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
        .eq("account_id", accountId).eq("addon_type", "media_moderation").eq("status", "active");
    }
    const balance = await getInnvilCreditBalance(admin, accountId);
    return { ok: true, balanceCents: balance.balanceCents, active: true, units: existing.units };
  }

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const paidPlan = await getAccountPaidPlan(admin, accountId);
  const billingInterval = paidPlan?.billingInterval ?? "monthly";
  const regular = MODERATOR_MEDIA_ADDON[tier].price;
  const priceCents = billingInterval === "annual" ? annualCreditPriceCents(regular) : creditPriceCents(regular, tier);
  const planName = watchPlanDisplayName(tier);

  const debit = await applyCreditChange(admin, accountId, -priceCents, "subscription_purchase", {
    productId: product.id as string,
    description: `${planName} Media Moderation +${billingInterval === "annual" ? " (annual)" : ""}`,
  });
  if (!debit.ok) return { ok: false, error: debit.error };

  const { error } = await admin.from("watch_subscription_addons").insert({ account_id: accountId, addon_type: "media_moderation", status: "active" });
  if (error) {
    // A concurrent purchase already activated it (23505 on the partial
    // unique index), or a genuine failure -- either way, reverse this
    // debit; never leave a charge with nothing to show for it.
    await applyCreditChange(admin, accountId, priceCents, "adjustment", {
      productId: product.id as string,
      paymentRef: `reversal:${debit.data.id}`,
      description: error.code === "23505" ? "Reversal: Media Moderation + already active" : "Reversal: Media Moderation + activation failed",
    });
    if (error.code === "23505") {
      const balance = await getInnvilCreditBalance(admin, accountId);
      return { ok: true, balanceCents: balance.balanceCents, active: true, units: MODERATOR_MEDIA_ADDON[tier].units };
    }
    return { ok: false, error: "Could not activate Media Moderation +. Your credit was refunded." };
  }

  const balance = await getInnvilCreditBalance(admin, accountId);
  return { ok: true, balanceCents: balance.balanceCents, active: true, units: MODERATOR_MEDIA_ADDON[tier].units };
}

/**
 * Schedules Media Moderation + for removal at the end of the CURRENT paid
 * period -- never an immediate cut, never a refund for unused time. No
 * usage-safety check is needed here (unlike Community Expansion's Community-
 * count check) -- there is no real per-request Media Moderation Unit
 * consumption metering to check against yet, so there is nothing that could
 * be left "over capacity" by removing this addon.
 */
export async function scheduleMediaModerationAddonRemoval(admin: SupabaseClient, accountId: string): Promise<ScheduleRemovalResult> {
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (!tier) return { ok: false, error: "No active Media Moderation + to remove." };

  const existing = await getMediaModerationAddonState(admin, accountId, tier);
  if (!existing) return { ok: false, error: "No active Media Moderation + to remove." };
  if (existing.cancelAtPeriodEnd) return { ok: true }; // already scheduled -- idempotent

  await admin.from("watch_subscription_addons").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("addon_type", "media_moderation").eq("status", "active");
  return { ok: true };
}

export type PurchaseMediaModerationExpansionResult =
  | { ok: true; unitsAdded: number; totalExpansionThisPeriod: number; balanceCents: number }
  | { ok: false; error: string };

/**
 * Purchases one Media Moderation Units expansion pack (money.ts's
 * MEDIA_MODERATION_EXPANSION_PACKS) via Innvil Credit -- a real, one-time,
 * CURRENT-PERIOD top-up (migration 0110), deliberately NOT the recurring
 * `watch_subscription_addons` shape the two functions above use, since this
 * feature needs multiple, differently-sized purchases to stack within one
 * period (see watch-media-moderation-expansion.ts's own doc comment).
 * Available to EVERY plan with a resolvable current billing period --
 * self-serve, byo20, and every Enterprise variant alike (Enterprise/byo20
 * both already resolve a real period via resolveAccountBillingPeriod, the
 * exact same function their own media-moderation usage tracking already
 * relies on) -- never gated to a subset of tiers, matching the base
 * allowance's own "every plan" scope. `units` must be an EXACT canonical
 * pack size; an arbitrary number is rejected outright, never partially
 * honored or rounded to the nearest real pack.
 */
export async function purchaseMediaModerationExpansion(admin: SupabaseClient, accountId: string, units: number): Promise<PurchaseMediaModerationExpansionResult> {
  const pack = mediaModerationExpansionPackByUnits(units);
  if (!pack) return { ok: false, error: "That isn't a valid Media Moderation capacity pack." };

  const period = await resolveAccountBillingPeriod(admin, accountId);
  if (!period) return { ok: false, error: "An active Watch subscription is required to add media capacity." };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return { ok: false, error: "Innvil Watch is not available right now." };

  const priceCents = Math.round(pack.price * 100);
  const debit = await applyCreditChange(admin, accountId, -priceCents, "subscription_purchase", {
    productId: product.id as string,
    description: `Media Moderation capacity +${pack.units.toLocaleString()} units`,
  });
  if (!debit.ok) return { ok: false, error: debit.error };

  const { error } = await admin.from("watch_media_moderation_expansions").insert({
    account_id: accountId,
    period_start: period.start,
    period_end: period.end,
    units: pack.units,
    price_usd: pack.price,
    payment_ref: debit.data.id,
  });
  if (error) {
    // A genuine insert failure after a successful debit -- reverse it
    // rather than leave the customer charged with nothing to show for it.
    // No duplicate-purchase race to tolerate here (unlike the single-active-
    // row addons above) -- every purchase is its own new row, so a
    // concurrent purchase simply inserts its own separate row too, both
    // valid and both correctly summed by getMediaModerationExpansionUnits.
    await applyCreditChange(admin, accountId, priceCents, "adjustment", {
      productId: product.id as string,
      paymentRef: `reversal:${debit.data.id}`,
      description: "Reversal: media capacity purchase failed",
    });
    return { ok: false, error: "Could not add media capacity. Your credit was refunded." };
  }

  const totalExpansionThisPeriod = await getMediaModerationExpansionUnits(admin, accountId, period.start);
  const balance = await getInnvilCreditBalance(admin, accountId);
  return { ok: true, unitsAdded: pack.units, totalExpansionThisPeriod, balanceCents: balance.balanceCents };
}
