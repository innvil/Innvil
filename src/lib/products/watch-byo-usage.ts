import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * BYO Enterprise -- Phase 2 (2026-08-24): real usage TELEMETRY for calls
 * routed through a BYO account's own AI provider credential
 * (watch-runtime.ts's resolveAccountAiRouting).
 *
 * A plain call/outcome LEDGER, not a token-cost accounting system. Per-call
 * token counts are DELIBERATELY not captured here -- `aiComplete()`
 * (ai/client.ts) currently returns only the generated text, and widening
 * its return shape to also carry usage would touch every existing caller
 * across the codebase. This module records only what's genuinely, cheaply
 * observable at the orchestration layer today: which account, which
 * automation, which provider/model, whether the call succeeded, and when.
 * Never fabricates a token/cost figure it doesn't actually have.
 *
 * `recordByoUsageEvent` is called fire-and-forget from community-runtime.ts
 * (never awaited on the critical path) -- a telemetry write failure must
 * NEVER break moderation/chatter, and must never add latency to the
 * 30s-bounded Telegram webhook handler.
 */

export interface ByoUsageEventInput {
  accountId: string;
  communityId?: string | null;
  /** Phase 4.V.1 -- the specific Watcher deployment that made this call,
   *  when known (every call site already resolves this for the separate
   *  usage-POLICY accounting -- see recordByoCall/recordByoPresenceCall).
   *  Omitted (never a fabricated id) for anything not attributable to one
   *  specific deployment. */
  deploymentId?: string | null;
  automation: string;
  provider: string;
  model: string;
  ok: boolean;
  error?: string | null;
}

/** Best-effort insert -- never throws. A telemetry write failure is logged
 *  and swallowed, exactly like the DB write itself never happened, rather
 *  than propagating and risking the caller's own (unrelated) error
 *  handling or a dangling unhandled rejection on the webhook's hot path. */
export async function recordByoUsageEvent(admin: SupabaseClient, input: ByoUsageEventInput): Promise<void> {
  try {
    const { error } = await admin.from("watch_byo_ai_usage_events").insert({
      account_id: input.accountId,
      community_id: input.communityId ?? null,
      deployment_id: input.deploymentId ?? null,
      automation: input.automation,
      provider: input.provider,
      model: input.model,
      ok: input.ok,
      error: input.error ?? null,
    });
    if (error) console.error("[watch-byo-usage] recordByoUsageEvent failed", input.accountId, error.message);
  } catch (err) {
    console.error("[watch-byo-usage] recordByoUsageEvent threw", input.accountId, err instanceof Error ? err.message : err);
  }
}

export interface ByoUsageAutomationCount {
  automation: string;
  total: number;
  successful: number;
  failed: number;
}

/** Raw ids only -- this module is a pure telemetry-read layer with no
 *  access to Watcher/Community NAMES (it doesn't import
 *  listAccountCommunities, deliberately, to avoid a new cross-module
 *  coupling in a file whose whole job is "what does this one table say").
 *  The caller (Usage page) already has the account's full Community/Watcher
 *  data fetched for other purposes and resolves these ids to real names
 *  from that, the same way getAccountSlotBreakdown's own callers already do. */
export interface ByoUsageCommunityCount {
  communityId: string;
  total: number;
  successful: number;
  failed: number;
}
export interface ByoUsageDeploymentCount {
  deploymentId: string;
  total: number;
  successful: number;
  failed: number;
}

export interface ByoUsageSummary {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  byAutomation: ByoUsageAutomationCount[];
  byCommunity: ByoUsageCommunityCount[];
  byDeployment: ByoUsageDeploymentCount[];
}

const EMPTY_SUMMARY: ByoUsageSummary = { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byAutomation: [], byCommunity: [], byDeployment: [] };

function tallyBucket(map: Map<string, { total: number; successful: number; failed: number }>, key: string, ok: boolean): void {
  const bucket = map.get(key) ?? { total: 0, successful: 0, failed: 0 };
  bucket.total += 1;
  if (ok) bucket.successful += 1; else bucket.failed += 1;
  map.set(key, bucket);
}

/** Real, observed call/outcome counts for this account over the last
 *  `sinceDays` -- never a fabricated/estimated number. Returns the empty
 *  summary (never throws) when nothing has been recorded yet, a genuine,
 *  expected state for an account that hasn't made a BYO call recently.
 *  byDeployment/byCommunity omit events with no recorded deployment_id/
 *  community_id (e.g. events written before migration 0102 added deployment
 *  attribution) -- never bucketed under a fabricated "unknown" id. */
export async function getByoUsageSummary(admin: SupabaseClient, accountId: string, sinceDays = 30): Promise<ByoUsageSummary> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("watch_byo_ai_usage_events")
    .select("automation, community_id, deployment_id, ok")
    .eq("account_id", accountId)
    .gte("created_at", since);
  if (error || !data) return EMPTY_SUMMARY;

  const byAutomation = new Map<string, { total: number; successful: number; failed: number }>();
  const byCommunity = new Map<string, { total: number; successful: number; failed: number }>();
  const byDeployment = new Map<string, { total: number; successful: number; failed: number }>();
  let successfulCalls = 0;
  let failedCalls = 0;
  for (const row of data as Array<{ automation: string; community_id: string | null; deployment_id: string | null; ok: boolean }>) {
    tallyBucket(byAutomation, row.automation, row.ok);
    if (row.community_id) tallyBucket(byCommunity, row.community_id, row.ok);
    if (row.deployment_id) tallyBucket(byDeployment, row.deployment_id, row.ok);
    if (row.ok) successfulCalls += 1; else failedCalls += 1;
  }

  return {
    totalCalls: data.length,
    successfulCalls,
    failedCalls,
    byAutomation: Array.from(byAutomation.entries())
      .map(([automation, c]) => ({ automation, total: c.total, successful: c.successful, failed: c.failed }))
      .sort((a, b) => b.total - a.total),
    byCommunity: Array.from(byCommunity.entries())
      .map(([communityId, c]) => ({ communityId, total: c.total, successful: c.successful, failed: c.failed }))
      .sort((a, b) => b.total - a.total),
    byDeployment: Array.from(byDeployment.entries())
      .map(([deploymentId, c]) => ({ deploymentId, total: c.total, successful: c.successful, failed: c.failed }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * Phase 4.V.1 (provider health/observability) -- "is my BYO provider
 * actually working?" A real status view built entirely from data this
 * module already records (watch_byo_ai_usage_events' own ok/error/
 * created_at columns) -- no new schema, no fabricated freshness signal.
 * Never invents a "healthy"/"unhealthy" verdict -- only reports the real
 * last-success/last-error timestamps and a real 7-day call volume; the
 * caller (UI) decides how to present that, this module only observes.
 */
export interface ByoProviderHealth {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  callsLast7Days: number;
}

const EMPTY_HEALTH: ByoProviderHealth = { lastSuccessAt: null, lastErrorAt: null, lastError: null, callsLast7Days: 0 };

/** Real, observed provider health for this account -- never throws (a read
 *  failure degrades to the empty/unknown state, same discipline as
 *  getByoUsageSummary). `callsLast7Days` counts EVERY recorded call
 *  (success + failure), matching the "recent request volume" the spec asks
 *  for -- not just successes. */
export async function getByoProviderHealth(admin: SupabaseClient, accountId: string): Promise<ByoProviderHealth> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [lastSuccess, lastError, recent] = await Promise.all([
      admin.from("watch_byo_ai_usage_events").select("created_at").eq("account_id", accountId).eq("ok", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("watch_byo_ai_usage_events").select("created_at, error").eq("account_id", accountId).eq("ok", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("watch_byo_ai_usage_events").select("id", { count: "exact", head: true }).eq("account_id", accountId).gte("created_at", since),
    ]);
    return {
      lastSuccessAt: (lastSuccess.data?.created_at as string | undefined) ?? null,
      lastErrorAt: (lastError.data?.created_at as string | undefined) ?? null,
      lastError: (lastError.data?.error as string | undefined) ?? null,
      callsLast7Days: recent.count ?? 0,
    };
  } catch (err) {
    console.error("[watch-byo-usage] getByoProviderHealth failed", accountId, err instanceof Error ? err.message : err);
    return EMPTY_HEALTH;
  }
}
