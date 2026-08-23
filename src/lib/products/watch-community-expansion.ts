import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCommunityExpansionEligibleTier, type CommunityExpansionEligibleTier } from "@/src/lib/money";

/**
 * Community Expansion -- a fixed-package Watch subscription add-on
 * (Gold/Platinum only, migration 0083). This module is deliberately the
 * ONLY thing that reads `watch_subscription_addons` directly -- both
 * `watch-runtime.ts` (capacity resolution) and `innvil-credit.ts`
 * (purchase/renewal/removal) import from here, never from each other, to
 * avoid a circular dependency (innvil-credit.ts already depends on
 * watch-runtime.ts for `getAccountPaidPlan`).
 *
 * No period fields exist on the add-on row at all -- it belongs to the
 * SAME subscription period as `product_entitlements`; "renewing" it just
 * means its price is folded into the base subscription's own renewal
 * charge (see innvil-credit.ts's `purchaseWatchWithCredit`).
 */

export { isCommunityExpansionEligibleTier };
export type { CommunityExpansionEligibleTier };

export interface CommunityExpansionState {
  active: boolean;
  cancelAtPeriodEnd: boolean;
}

/** The account's current Community Expansion state, or null if never
 *  purchased / already removed. Scoped strictly by account_id -- never
 *  trusts a client-supplied id (every caller re-derives it server-side). */
export async function getCommunityExpansionState(admin: SupabaseClient, accountId: string): Promise<CommunityExpansionState | null> {
  const { data } = await admin
    .from("watch_subscription_addons")
    .select("cancel_at_period_end")
    .eq("account_id", accountId)
    .eq("addon_type", "community_expansion")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  return { active: true, cancelAtPeriodEnd: data.cancel_at_period_end === true };
}

export async function hasActiveCommunityExpansion(admin: SupabaseClient, accountId: string): Promise<boolean> {
  return (await getCommunityExpansionState(admin, accountId)) != null;
}

/** Called whenever the base Watch subscription successfully renews (either
 *  payment path) -- finalizes ANY addon type scheduled for removal
 *  (`cancel_at_period_end`), not just Community Expansion, by marking it
 *  'removed', so its price is never charged again and effective capacity
 *  drops back to the plan's included/base state on the NEXT capacity read.
 *  Generalized (2026-08-22) beyond `community_expansion` alone once Media
 *  Moderation + became a second real purchasable addon_type on this SAME
 *  table -- both addon types share the identical "renews with the base
 *  subscription, no independent period" lifecycle, so one generic finalize
 *  call correctly covers both, never a second/duplicated finalize function
 *  per addon type. Safe to call unconditionally after every renewal AND
 *  every initial purchase -- the WHERE clause only ever matches a row
 *  genuinely scheduled for removal, so it's a real no-op otherwise (never
 *  touches an addon with `cancel_at_period_end=false`). */
export async function finalizeAddonsOnRenewal(admin: SupabaseClient, accountId: string): Promise<void> {
  await admin
    .from("watch_subscription_addons")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("status", "active")
    .eq("cancel_at_period_end", true);
}

/** Called whenever the base subscription's TIER actually changes (e.g. Gold
 *  -> Platinum, Platinum -> Gold) -- unconditionally finalizes ANY active
 *  addon row of ANY type (Community Expansion, Media Moderation +, or any
 *  future addon_type on this table), `cancel_at_period_end` or not. A plan
 *  change never carries an addon across tiers: every addon here is priced
 *  and/or sized for the OLD tier (Community Expansion's capacity ceiling,
 *  Media Moderation +'s price/unit allowance both vary by tier), and
 *  silently carrying either over would be exactly the "Gold's $9.99
 *  Community Expansion becomes Platinum's $14.99 one for free" (or a Media
 *  Moderation + equivalent) commercial mismatch this feature must avoid. No
 *  refund is issued (same "no refunds for unused add-on time" rule as an
 *  explicit removal) -- the customer simply re-purchases the addon under
 *  the new tier's own price/allowance if they still want it.
 *  Callers MUST run the matching capacity-safety check (see
 *  `innvil-credit.ts`'s `purchaseWatchWithCredit` / `watch-checkout.ts`'s
 *  `createDirectWatchCheckout`) BEFORE the tier change is allowed to
 *  complete, so this never fires the moment after leaving an account over
 *  its own new, un-expanded capacity. Real no-op when nothing is active. */
export async function finalizeAddonsOnTierChange(admin: SupabaseClient, accountId: string): Promise<void> {
  await admin
    .from("watch_subscription_addons")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("status", "active");
}
