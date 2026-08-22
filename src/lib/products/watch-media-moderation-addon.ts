import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MODERATOR_MEDIA_ADDON, type ModeratorPlanTier } from "@/src/lib/money";

/**
 * Self-serve Media Moderation + -- a real, purchasable add-on (Bronze
 * through Platinum, all four self-serve tiers, unlike Community Expansion's
 * Gold/Platinum-only restriction) layered on the SAME `watch_subscription_
 * addons` table Community Expansion already uses (migration 0087,
 * addon_type='media_moderation') -- never a duplicated/parallel add-on
 * system. Mirrors `watch-community-expansion.ts`'s exact read-only shape:
 * this module is the ONLY thing that reads `watch_subscription_addons` for
 * this addon_type directly.
 *
 * SCOPE OF THIS FILE, stated honestly: entitlement/capacity representation
 * ONLY. There is no purchase/renewal/removal action that writes a
 * 'media_moderation' row yet (that's the Community-Expansion-equivalent
 * purchase pipeline in innvil-credit.ts/watch-checkout.ts, not built for
 * this add-on), and no real per-request Media Moderation Unit CONSUMPTION
 * metering wired into the live moderation runtime (media-moderation.ts/
 * community-runtime.ts's runMediaModeration still runs unmetered, gated
 * only by MEDIA_MODERATION_ENABLED/virtualModModeration, exactly as before
 * this file existed). Both are real, separate, larger follow-ups -- see the
 * dated CLAUDE.md entry.
 */

export interface MediaModerationAddonState {
  active: boolean;
  cancelAtPeriodEnd: boolean;
  /** The real unit allowance for the CURRENT tier while active -- read live
   *  from the canonical MODERATOR_MEDIA_ADDON table, never stored/duplicated
   *  on the addon row itself (so a tier change is never left pointing at a
   *  stale allowance number). */
  units: number;
}

/** The account's current Media Moderation + state for a given self-serve
 *  tier, or null if never purchased / already removed. Scoped strictly by
 *  account_id -- never trusts a client-supplied id (every caller re-derives
 *  it server-side). */
export async function getMediaModerationAddonState(
  admin: SupabaseClient,
  accountId: string,
  tier: ModeratorPlanTier
): Promise<MediaModerationAddonState | null> {
  const { data } = await admin
    .from("watch_subscription_addons")
    .select("cancel_at_period_end")
    .eq("account_id", accountId)
    .eq("addon_type", "media_moderation")
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  return { active: true, cancelAtPeriodEnd: data.cancel_at_period_end === true, units: MODERATOR_MEDIA_ADDON[tier].units };
}

export async function hasActiveMediaModerationAddon(admin: SupabaseClient, accountId: string): Promise<boolean> {
  const { data } = await admin
    .from("watch_subscription_addons")
    .select("id")
    .eq("account_id", accountId)
    .eq("addon_type", "media_moderation")
    .eq("status", "active")
    .maybeSingle();
  return data != null;
}
