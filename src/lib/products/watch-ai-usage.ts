import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MODERATOR_AI_GENERATION_POOL, type ModeratorPlanTier } from "@/src/lib/money";
import { WATCH_PRODUCT_SLUG } from "./watch";

/**
 * Real usage accounting for MODERATOR_AI_GENERATION_POOL (money.ts) -- the
 * ONE canonical monthly usage limit that exists anywhere in the approved
 * Watch plan/entitlement configuration. Everything else requested in the
 * broader "usage limits" brief (messages, provider requests, tokens, BYO
 * controls) has NO canonical source in this codebase today -- see the
 * dated CLAUDE.md entry for the full investigation. This file deliberately
 * covers ONLY this one real, already-approved metric.
 *
 * "Monthly" = the account's real current SUBSCRIPTION PERIOD
 * (product_entitlements.current_period_start/end, migration 0080 -- monthly
 * or annual per billing_interval), never an invented calendar-month
 * boundary. Scoped to direct-Watch accounts only (account_id, no panel_id)
 * -- this is a Watch-only concept; the legacy Panel-distributed Virtual
 * Moderator system has its own separate commercial model, untouched here.
 */

export interface WatchBillingPeriod {
  start: string;
  end: string;
}

/** The account's real current Watch subscription period, or null when
 *  there is no trackable period (no entitlement row, or a legacy
 *  never-expiring row predating migration 0080 -- current_period_end is
 *  NULL). Never fabricates a period boundary. */
export async function resolveAccountBillingPeriod(admin: SupabaseClient, accountId: string): Promise<WatchBillingPeriod | null> {
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return null;
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("current_period_start, current_period_end")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  const start = (entitlement?.current_period_start as string | null) ?? null;
  const end = (entitlement?.current_period_end as string | null) ?? null;
  if (!start || !end) return null;
  return { start, end };
}

/** Plain read of the account's AI-response count for a given period --
 *  zero if no usage has been recorded yet this period (never an error, a
 *  brand-new period always starts at 0). */
export async function getWatchAiGenerationUsage(admin: SupabaseClient, accountId: string, periodStart: string): Promise<number> {
  const { data } = await admin
    .from("watch_ai_response_usage")
    .select("response_count")
    .eq("account_id", accountId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return (data?.response_count as number | undefined) ?? 0;
}

/** Atomically increments this account's usage for the given period -- as of
 *  the 2026-08-22 counting-semantics change, called right after a
 *  CONVERSATIONAL AI GENERATION succeeds (see community-runtime.ts's
 *  respondAsDeployment), never gated on the subsequent Telegram send. A
 *  provider timeout/auth failure/outage/declined generation never reaches
 *  this call at all (all `return` earlier); a successful generation whose
 *  delivery later fails still counts. This intentionally differs from the
 *  trial's SEPARATE reactive-quota counter, which still counts only on a
 *  confirmed send. Race-safe under concurrent responders via the DB-level
 *  atomic upsert (increment_watch_ai_response_usage -- the underlying table/
 *  RPC names are unchanged; only the customer-facing terminology and the
 *  counting rule changed). */
export async function incrementWatchAiGenerationUsage(admin: SupabaseClient, accountId: string, period: WatchBillingPeriod): Promise<void> {
  await admin.rpc("increment_watch_ai_response_usage", {
    p_account_id: accountId,
    p_period_start: period.start,
    p_period_end: period.end,
  });
}

/** Pure -- the pool's total for a tier, or null when the tier has no fixed
 *  pool (Enterprise is custom/no fixed pool, per MODERATOR_AI_GENERATION_POOL's
 *  own doc comment -- deliberately not represented in that Record at all,
 *  so any lookup beyond the 4 self-serve tiers must go through this
 *  function rather than indexing the Record directly and risking a
 *  runtime `undefined`). */
export function aiGenerationPoolLimit(tier: ModeratorPlanTier): number {
  return MODERATOR_AI_GENERATION_POOL[tier];
}

/** Pure -- true when the account still has pool headroom this period.
 *  `usedCount` is the caller's already-read current usage (never re-fetched
 *  here, keeping this function I/O-free and directly testable). */
export function hasAiGenerationPoolRemaining(usedCount: number, tier: ModeratorPlanTier): boolean {
  return usedCount < aiGenerationPoolLimit(tier);
}
