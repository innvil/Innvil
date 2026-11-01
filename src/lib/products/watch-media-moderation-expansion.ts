import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_MODERATION_EXPANSION_PACKS } from "@/src/lib/money";

/**
 * Media Moderation Units expansion packs -- a real, stackable, CURRENT-
 * BILLING-PERIOD top-up (migration 0110). Deliberately its own table
 * (`watch_media_moderation_expansions`), never the existing recurring
 * `watch_subscription_addons` model Community Expansion / the OLD Media
 * Moderation + add-on use -- see the migration's own doc comment for why:
 * this feature needs MULTIPLE, differently-sized purchases to stack within
 * one period, and each purchase must apply ONLY to the period it was bought
 * in, never become a permanent recurring increase.
 *
 * Scoped to direct-Watch accounts only (account_id), mirroring
 * watch-media-moderation-usage.ts exactly. The PURCHASE action itself
 * (`purchaseMediaModerationExpansion`) lives in innvil-credit.ts, alongside
 * every other Innvil-Credit-funded purchase (Community Expansion, the OLD
 * Media Moderation +, subscription purchase/renewal) -- this file holds only
 * the pure/read pieces every consumer (the runtime gate, Usage display,
 * the purchase function itself) shares.
 */

/** Sum of every expansion pack purchased for the given period -- 0 when
 *  none have been bought yet this period (never an error). */
export async function getMediaModerationExpansionUnits(admin: SupabaseClient, accountId: string, periodStart: string): Promise<number> {
  const { data } = await admin
    .from("watch_media_moderation_expansions")
    .select("units")
    .eq("account_id", accountId)
    .eq("period_start", periodStart);
  return (data ?? []).reduce((sum: number, row: { units: number }) => sum + row.units, 0);
}

/** Pure -- combines the account's real base allowance, purchased expansion,
 *  and already-consumed usage into the numbers a display surface needs.
 *  `available` is floored at 0 (never negative) so a display never shows a
 *  confusing "-40 remaining" if usage briefly overshoots the allowance
 *  under a race. */
export interface MediaModerationCapacity {
  base: number;
  expansion: number;
  total: number;
  used: number;
  available: number;
}
export function computeMediaModerationCapacity(base: number, expansion: number, used: number): MediaModerationCapacity {
  const total = base + expansion;
  return { base, expansion, total, used, available: Math.max(0, total - used) };
}

/** True once usage reaches (or exceeds) the account's real total allowance
 *  (base + expansion) -- the single source of truth the runtime gate checks
 *  before attempting a new classification, and what a display surface uses
 *  to decide whether to show the "capacity used up" state. */
export function isMediaModerationLimitReached(used: number, base: number, expansion: number): boolean {
  return used >= base + expansion;
}

/** Re-exported for convenience so a UI can render the canonical pack list
 *  without importing money.ts directly in every consumer. */
export { MEDIA_MODERATION_EXPANSION_PACKS };
