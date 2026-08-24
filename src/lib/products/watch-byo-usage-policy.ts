import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * BYO Enterprise usage POLICY (Phase 4.V) -- customer-owned, self-
 * configured operational ceilings layered ON TOP OF an already-stored BYO
 * credential (watch-byo.ts). A genuinely separate concept from Innvil's own
 * commercial plan config (money.ts/product_entitlements) -- this never
 * reads or mutates either, and it never governs whether the account IS
 * BYO; it only caps how much of the customer's OWN BYO provider spend a
 * Watcher is allowed to generate.
 *
 * HIERARCHY (explicit scope decision, documented not silent): account-wide
 * and per-Community. Deployment/Watcher-level granularity is NOT built
 * this pass -- the same pragmatic scope-down already made for BYO
 * telemetry (watch-byo-usage.ts) -- account+Community already covers the
 * two most commonly wanted ceilings (an overall spend cap, plus per-
 * Community caps for a multi-Community Enterprise account). The TIGHTEST
 * configured limit wins when both are set (checkByoUsageAllowed evaluates
 * every configured scope and blocks if ANY is exhausted).
 *
 * KIND (Phase 4.V.1): every policy/counter is now also scoped by
 * `reactive` vs `proactive` -- two structurally separate ceilings a
 * customer can configure independently, at the SAME account/Community
 * scope. `reactive` = a real triggering human message exists (chatter
 * ANSWER/CASUAL_CHAT, via community-runtime.ts). `proactive` = unprompted,
 * scheduler-driven generation (Watcher Presence Scheduling's transition
 * messages, presence-runtime.ts, the only proactive BYO call site that
 * exists today -- Auto-Posting is structurally Panel-only/unreachable for
 * BYO, see watch-runtime.ts). A caller must always say which kind of call
 * it's making; there is no "both" gate -- checking one kind never consumes
 * or blocks the other.
 *
 * UNIT: requests per period (never tokens -- aiComplete()'s current return
 * shape doesn't expose a real token count to every caller; fabricating one
 * would be dishonest, same reasoning already documented for
 * watch_byo_ai_usage_events). "Requests" here means successful
 * generations of the given kind specifically.
 *
 * PERIOD: a plain UTC calendar day/month boundary (never an invented
 * per-community-timezone scheme) -- the same established, accepted
 * pattern already used for the Free Trial's reactive quota
 * (community-runtime.ts's reactiveQuotaDay).
 */

export type UsagePolicyPeriod = "daily" | "monthly";
export type UsagePolicyKind = "reactive" | "proactive";

export interface WatchByoUsagePolicy {
  id: string;
  accountId: string;
  communityId: string | null; // null = account-wide
  kind: UsagePolicyKind;
  period: UsagePolicyPeriod;
  requestLimit: number;
}

const ACCOUNT_SCOPE_KEY = "__account__";

/** The current period's stable key -- UTC calendar day ("daily:2026-08-25")
 *  or month ("monthly:2026-08"). A fresh period always starts the counter
 *  at 0 (no row exists for the new key yet), so a policy never needs an
 *  explicit reset. */
export function periodKey(period: UsagePolicyPeriod, now: Date): string {
  const iso = now.toISOString();
  return period === "daily" ? `daily:${iso.slice(0, 10)}` : `monthly:${iso.slice(0, 7)}`;
}

function scopeKeyFor(communityId: string | null): string {
  return communityId ?? ACCOUNT_SCOPE_KEY;
}

function toPolicy(row: Record<string, unknown>): WatchByoUsagePolicy {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    communityId: (row.community_id as string | null) ?? null,
    kind: (row.kind as UsagePolicyKind | undefined) ?? "reactive",
    period: row.period as UsagePolicyPeriod,
    requestLimit: row.request_limit as number,
  };
}

/** Every policy configured for this account -- both kinds, account-wide row
 *  (if any) first, then per-Community rows. Used by both the owner-facing
 *  settings UI and the gate below (never a second, duplicated read path). */
export async function listByoUsagePolicies(admin: SupabaseClient, accountId: string): Promise<WatchByoUsagePolicy[]> {
  const { data } = await admin
    .from("watch_byo_usage_policies")
    .select("id, account_id, community_id, kind, period, request_limit")
    .eq("account_id", accountId)
    .order("community_id", { ascending: true, nullsFirst: true })
    .order("kind", { ascending: true });
  return (data ?? []).map(toPolicy);
}

async function loadPolicy(admin: SupabaseClient, accountId: string, communityId: string | null, kind: UsagePolicyKind): Promise<WatchByoUsagePolicy | null> {
  const query = admin.from("watch_byo_usage_policies").select("id, account_id, community_id, kind, period, request_limit").eq("account_id", accountId).eq("kind", kind);
  const { data } = await (communityId ? query.eq("community_id", communityId) : query.is("community_id", null)).maybeSingle();
  return data ? toPolicy(data) : null;
}

/** Sets (or replaces) the policy for one (scope, kind) pair. `requestLimit`
 *  must be a positive integer. Never touches any OTHER scope/kind's policy
 *  -- a reactive and a proactive policy at the same scope are independent. */
export async function setByoUsagePolicy(
  admin: SupabaseClient,
  accountId: string,
  communityId: string | null,
  kind: UsagePolicyKind,
  period: UsagePolicyPeriod,
  requestLimit: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limit = Math.round(requestLimit);
  if (!(limit > 0)) return { ok: false, error: "Request limit must be a positive number." };
  const { error } = await admin.from("watch_byo_usage_policies").upsert(
    { account_id: accountId, community_id: communityId, kind, period, request_limit: limit, updated_at: new Date().toISOString() },
    { onConflict: communityId ? "account_id,community_id,kind" : "account_id,kind" }
  );
  if (error) return { ok: false, error: "Couldn't save the usage limit." };
  return { ok: true };
}

export async function clearByoUsagePolicy(admin: SupabaseClient, accountId: string, communityId: string | null, kind: UsagePolicyKind): Promise<void> {
  const query = admin.from("watch_byo_usage_policies").delete().eq("account_id", accountId).eq("kind", kind);
  await (communityId ? query.eq("community_id", communityId) : query.is("community_id", null));
}

async function readCounter(admin: SupabaseClient, accountId: string, scopeKey: string, kind: UsagePolicyKind, key: string): Promise<number> {
  const { data } = await admin.from("watch_byo_usage_counters").select("request_count").eq("account_id", accountId).eq("scope_key", scopeKey).eq("kind", kind).eq("period_key", key).maybeSingle();
  return (data?.request_count as number | undefined) ?? 0;
}

export interface ByoUsageGateResult {
  /** False when no policy is configured for THIS kind at ANY scope --
   *  unlimited, by the customer's own choice (no ceiling was ever set for
   *  this kind -- the OTHER kind's policy, if any, is irrelevant here). */
  limited: boolean;
  allowed: boolean;
  /** Which scope's limit is the binding (tightest, currently-exhausted)
   *  one -- null when allowed (nothing is currently exhausted) or when
   *  `limited` is false. Purely diagnostic/UI-facing. */
  blockedScope: "account" | "community" | null;
}

/** Evaluates every policy configured for this account AND KIND (account-wide
 *  + this specific Community, if a communityId is given) and blocks if
 *  EITHER is exhausted for its own current period -- the tightest
 *  configured ceiling always wins, regardless of which scope it's set at.
 *  A reactive-kind check never looks at (or is blocked by) a proactive
 *  policy, and vice versa -- the two are fully independent gates. Checked
 *  BEFORE a BYO-routed AI call is attempted (never after), same discipline
 *  as every other quota/pool gate in this codebase. */
export async function checkByoUsageAllowed(
  admin: SupabaseClient, accountId: string, communityId: string | null, kind: UsagePolicyKind = "reactive", now: Date = new Date()
): Promise<ByoUsageGateResult> {
  const [accountPolicy, communityPolicy] = await Promise.all([
    loadPolicy(admin, accountId, null, kind),
    communityId ? loadPolicy(admin, accountId, communityId, kind) : Promise.resolve(null),
  ]);
  if (!accountPolicy && !communityPolicy) return { limited: false, allowed: true, blockedScope: null };

  if (accountPolicy) {
    const used = await readCounter(admin, accountId, ACCOUNT_SCOPE_KEY, kind, periodKey(accountPolicy.period, now));
    if (used >= accountPolicy.requestLimit) return { limited: true, allowed: false, blockedScope: "account" };
  }
  if (communityPolicy && communityId) {
    const used = await readCounter(admin, accountId, communityId, kind, periodKey(communityPolicy.period, now));
    if (used >= communityPolicy.requestLimit) return { limited: true, allowed: false, blockedScope: "community" };
  }
  return { limited: true, allowed: true, blockedScope: null };
}

/** Records ONE successful request of the given KIND against every scope
 *  that currently has a configured policy FOR THAT KIND (account-wide
 *  and/or this Community) -- re-resolved at increment time (never assumed
 *  from the gate check) so a policy added mid-period starts its counter
 *  fresh from 0, never inheriting usage that accrued before the limit
 *  existed. An account/Community with NO configured policy for this kind
 *  is never written to -- this table only ever holds real, policy-relevant
 *  counts, never speculative background data.
 *
 *  SCOPE OF WHAT COUNTS (explicit, documented -- mirrors the exact same
 *  judgment call already made for BYO telemetry in watch-byo-usage.ts):
 *  `kind: "reactive"` is recorded only from a successful conversational
 *  reply generation (chatter ANSWER/CASUAL_CHAT, community-runtime.ts's
 *  recordByoCall) -- the one BYO call site with a genuine, unambiguous
 *  success signal for reactive calls. `kind: "proactive"` is recorded only
 *  from a successfully SENT Watcher Presence Scheduling transition message
 *  (presence-runtime.ts) -- its own genuine, unambiguous success signal.
 *  Link-classification and media-moderation-warning BYO calls are NOT
 *  individually counted either way (they degrade silently by design and
 *  have no real ok/error signal to key off), but they ARE still blocked by
 *  the reactive gate above once a configured reactive limit is reached,
 *  since that gate governs the shared BYO credential itself for a
 *  reactive-triggered event, not one specific call site. */
export async function recordByoPolicyUsage(admin: SupabaseClient, accountId: string, communityId: string | null, kind: UsagePolicyKind = "reactive", now: Date = new Date()): Promise<void> {
  try {
    const [accountPolicy, communityPolicy] = await Promise.all([
      loadPolicy(admin, accountId, null, kind),
      communityId ? loadPolicy(admin, accountId, communityId, kind) : Promise.resolve(null),
    ]);
    const scopes: string[] = [];
    if (accountPolicy) scopes.push(ACCOUNT_SCOPE_KEY);
    if (communityPolicy && communityId) scopes.push(communityId);
    await Promise.all(
      scopes.map((scopeKey) => {
        const policy = scopeKey === ACCOUNT_SCOPE_KEY ? accountPolicy! : communityPolicy!;
        return admin.rpc("increment_watch_byo_usage", { p_account_id: accountId, p_scope_key: scopeKey, p_period_key: periodKey(policy.period, now), p_kind: kind });
      })
    );
  } catch (err) {
    // A usage-policy write failure must never break generation itself --
    // same "telemetry can't take down the feature" discipline as
    // recordByoUsageEvent.
    console.error("[watch-byo-usage-policy] recordByoPolicyUsage failed", err);
  }
}

/** Real observed usage for the Usage page's "BYO Usage Controls" section --
 *  every configured policy (both kinds), alongside its current period's
 *  real used count. Never fabricates a number for a scope/kind with no
 *  configured policy (those simply aren't returned). */
export async function getByoUsageStatus(admin: SupabaseClient, accountId: string, now: Date = new Date()): Promise<Array<WatchByoUsagePolicy & { used: number }>> {
  const policies = await listByoUsagePolicies(admin, accountId);
  return Promise.all(
    policies.map(async (p) => ({
      ...p,
      used: await readCounter(admin, accountId, scopeKeyFor(p.communityId), p.kind, periodKey(p.period, now)),
    }))
  );
}
