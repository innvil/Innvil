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
 *  payment path) -- finalizes an addon scheduled for removal
 *  (`cancel_at_period_end`) by marking it 'removed', so its price is never
 *  charged again and effective capacity drops back to the plan's included
 *  count on the NEXT capacity read (`requireAccountWatchContext` only ever
 *  reads `status='active'` rows). Safe to call unconditionally after every
 *  renewal AND every initial purchase -- the WHERE clause only ever
 *  matches a row genuinely scheduled for removal, so it's a real no-op
 *  otherwise (never touches an addon with `cancel_at_period_end=false`). */
export async function finalizeAddonsOnRenewal(admin: SupabaseClient, accountId: string): Promise<void> {
  await admin
    .from("watch_subscription_addons")
    .update({ status: "removed", updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("addon_type", "community_expansion")
    .eq("status", "active")
    .eq("cancel_at_period_end", true);
}

/** Called whenever the base subscription's TIER actually changes (e.g. Gold
 *  -> Platinum, Platinum -> Gold) -- unconditionally finalizes ANY active
 *  Community Expansion row, `cancel_at_period_end` or not. A plan change
 *  never carries the add-on across tiers: it was priced and sized for the
 *  OLD tier, and silently re-pricing/re-sizing it for the new one would be
 *  exactly the "Gold's $12.99 add-on becomes Platinum's $19.99 one for
 *  free" (or the reverse) commercial mismatch this feature must avoid. No
 *  refund is issued (same "no refunds for unused add-on time" rule as an
 *  explicit removal) -- the customer simply re-purchases Community
 *  Expansion under the new tier's own price/capacity if they still want it.
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
    .eq("addon_type", "community_expansion")
    .eq("status", "active");
}
