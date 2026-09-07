import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WatchBillingPeriod } from "./watch-ai-usage";

/**
 * Real usage accounting for MODERATOR_MEDIA_ADDON (money.ts) -- mirrors
 * watch-ai-usage.ts's exact shape for the analogous AI Generation pool.
 * "Monthly" = the account's real current subscription period
 * (resolveAccountBillingPeriod in watch-ai-usage.ts is reused directly,
 * never a second period resolver -- Media Moderation + renews on the same
 * cadence as the base subscription).
 *
 * A "unit" is EXACTLY what MODERATOR_MEDIA_ADDON's own doc comment defines:
 * 1 classified photo, or 1 sampled video frame that actually received a
 * REAL (ok:true) classification result -- never an attempted-but-failed
 * provider call (same counting philosophy as the AI Generation pool: only
 * a genuine successful provider response consumes a unit).
 */

/** Plain read of the account's Media Moderation Unit count for a given
 *  period -- zero if no usage has been recorded yet this period. */
export async function getWatchMediaModerationUsage(admin: SupabaseClient, accountId: string, periodStart: string): Promise<number> {
  const { data } = await admin
    .from("watch_media_moderation_usage")
    .select("unit_count")
    .eq("account_id", accountId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return (data?.unit_count as number | undefined) ?? 0;
}

/** Atomically increments this account's usage for the given period by
 *  `units` -- called ONLY after a REAL classification succeeds (see
 *  community-runtime.ts's runMediaModeration), never for a provider
 *  failure/timeout, and never before checking hasMediaModerationUnitsRemaining
 *  first (this function does not itself enforce the allowance -- it's a
 *  pure recorder, same division of responsibility as
 *  incrementWatchAiGenerationUsage). A no-op (never called) when `units`
 *  would be 0 -- callers should skip the call entirely rather than
 *  incrementing by zero. */
export async function incrementWatchMediaModerationUsage(admin: SupabaseClient, accountId: string, period: WatchBillingPeriod, units: number): Promise<void> {
  if (units <= 0) return;
  await admin.rpc("increment_watch_media_moderation_usage", {
    p_account_id: accountId,
    p_period_start: period.start,
    p_period_end: period.end,
    p_units: units,
  });
}

/** Pure -- true when the account still has unit headroom this period.
 *  `usedCount` is the caller's already-read current usage (never re-fetched
 *  here, keeping this function I/O-free and directly testable), `allowance`
 *  is the real unit allowance for the account's active Media Moderation +
 *  package (getMediaModerationAddonState's `units` field -- never a fixed
 *  per-tier lookup here, since it depends on whether the add-on is even
 *  active at all). */
export function hasMediaModerationUnitsRemaining(usedCount: number, allowance: number): boolean {
  return usedCount < allowance;
}
