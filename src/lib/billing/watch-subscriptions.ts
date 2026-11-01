import "server-only";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";
import { purchaseWatchWithCredit } from "@/src/lib/products/innvil-credit";
import { watchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { ModeratorPlanTier } from "@/src/lib/money";
import type { WatchPlanDisplayName } from "@/src/lib/products/watch-plans";

/* =========================================================
   Automatic renewal of a direct Watch subscription from a customer's own
   Innvil Credit balance (called by the bill-addons cron alongside every
   other recurring-billing sweep in this codebase).

   Only ever touches an entitlement whose MOST RECENT successful payment
   was made with Innvil Credit (`product_entitlements.renewal_mode ===
   "innvil_credit"`, set by activateWatchEntitlement's `paidViaCredit`
   argument on every credit-paid purchase/renewal that already exists) --
   a customer who has only ever paid by direct crypto checkout is NEVER
   auto-charged from a balance they never opted to use this way. Reuses
   `purchaseWatchWithCredit` verbatim -- there is no separate renewal-
   pricing model here; this is the EXACT SAME function a customer's own
   "Renew" button already calls (RenewWatchButton always passes the
   account's own current tier), so an account with an already-scheduled
   downgrade (migration 0111) correctly renews INTO that pending tier
   here too, at its own price, exactly as it would if the customer had
   clicked Renew themselves.

   An account without enough credit is left exactly where it already sits
   today: `current_period_end` stays in the past, so `resolveAccountWatchTier`
   / `getAccountCapacity` already stop granting access via their existing
   expiry check -- nothing here deletes a Project/Community/Watcher, and
   nothing here invents a grace period or a retry backoff; the sweep simply
   tries again on its next run (a no-op / harmless re-attempt if credit is
   still short).
   ========================================================= */

export interface WatchAutoRenewalSweepResult {
  checked: number;
  renewed: number;
  lapsed: number;
  errors: number;
}

const SELF_SERVE_TIERS: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro", "byo20"];

export async function sweepWatchAutoRenewals(): Promise<WatchAutoRenewalSweepResult> {
  const admin = createAdminClient();
  const result: WatchAutoRenewalSweepResult = { checked: 0, renewed: 0, lapsed: 0, errors: 0 };

  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return result;

  const nowIso = new Date().toISOString();
  const { data: due } = await admin
    .from("product_entitlements")
    .select("account_id, subscription_ref, current_period_end, billing_interval")
    .eq("product_id", product.id)
    .eq("status", "active")
    .eq("renewal_mode", "innvil_credit")
    .lte("current_period_end", nowIso);

  for (const row of (due as Array<{ account_id: string; subscription_ref: string | null; billing_interval: string | null }> | null) ?? []) {
    const rawTier = (row.subscription_ref ?? "").split(":")[0];
    const tier = SELF_SERVE_TIERS.find((t) => t === rawTier);
    if (!tier) continue; // Enterprise / an unrecognized ref never reaches this sweep.
    result.checked++;
    try {
      const planName = watchPlanDisplayName(tier) as Exclude<WatchPlanDisplayName, "Enterprise">;
      const billingInterval = row.billing_interval === "annual" ? "annual" : "monthly";
      const res = await purchaseWatchWithCredit(admin, row.account_id, planName, billingInterval);
      if (res.ok) result.renewed++;
      else result.lapsed++;
    } catch {
      result.errors++;
    }
  }

  return result;
}
