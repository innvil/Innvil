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
 * HIERARCHY (Phase 4.V.1, item 2 -- extends the original account+Community
 * scope-down to the real 3-level model the spec asked for): account-wide,
 * per-Community, or per-Watcher-deployment. A policy row is scoped to
 * EXACTLY ONE of those (never Community AND deployment together -- a
 * deployment already implies its own Community). The TIGHTEST configured
 * limit wins when more than one applies (checkByoUsageAllowed evaluates
 * every configured scope for the given (communityId, deploymentId) pair and
 * blocks if ANY is exhausted).
 *
 * KIND (Phase 4.V.1, item 1): every policy/counter is also scoped by
 * `reactive` vs `proactive` -- two structurally separate ceilings a
 * customer can configure independently, at the SAME account/Community/
 * deployment scope. `reactive` = a real triggering human message exists
 * (chatter ANSWER/CASUAL_CHAT, via community-runtime.ts). `proactive` =
 * unprompted, scheduler-driven generation (Watcher Presence Scheduling's
 * transition messages, presence-runtime.ts -- the only real proactive BYO
 * call site today). A caller must always say which kind of call it's
 * making; there is no "both" gate -- checking one kind never consumes or
 * blocks the other.
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

/** A policy's scope, as a discriminated union rather than two loosely
 *  related nullable ids -- self-documenting, and structurally impossible to
 *  set both a communityId AND a deploymentId (the DB also enforces this via
 *  a CHECK constraint, but the TS type makes the invalid state
 *  unrepresentable in the first place). */
export type UsagePolicyScope =
  | { type: "account" }
  | { type: "community"; communityId: string }
  | { type: "deployment"; deploymentId: string };

export interface WatchByoUsagePolicy {
  id: string;
  accountId: string;
  scope: UsagePolicyScope;
  kind: UsagePolicyKind;
  period: UsagePolicyPeriod;
  requestLimit: number;
}

const ACCOUNT_SCOPE_KEY = "account:__";

function scopeKeyFor(scope: UsagePolicyScope): string {
  if (scope.type === "account") return ACCOUNT_SCOPE_KEY;
  if (scope.type === "community") return `community:${scope.communityId}`;
  return `deployment:${scope.deploymentId}`;
}

/** The current period's stable key -- UTC calendar day ("daily:2026-08-25")
 *  or month ("monthly:2026-08"). A fresh period always starts the counter
 *  at 0 (no row exists for the new key yet), so a policy never needs an
 *  explicit reset. */
export function periodKey(period: UsagePolicyPeriod, now: Date): string {
  const iso = now.toISOString();
  return period === "daily" ? `daily:${iso.slice(0, 10)}` : `monthly:${iso.slice(0, 7)}`;
}

function scopeFromRow(row: Record<string, unknown>): UsagePolicyScope {
  const communityId = (row.community_id as string | null) ?? null;
  const deploymentId = (row.deployment_id as string | null) ?? null;
  if (deploymentId) return { type: "deployment", deploymentId };
  if (communityId) return { type: "community", communityId };
  return { type: "account" };
}

function toPolicy(row: Record<string, unknown>): WatchByoUsagePolicy {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    scope: scopeFromRow(row),
    kind: (row.kind as UsagePolicyKind | undefined) ?? "reactive",
    period: row.period as UsagePolicyPeriod,
    requestLimit: row.request_limit as number,
  };
}

/** Every policy configured for this account -- every scope, both kinds.
 *  Used by both the owner-facing settings UI and the gate below (never a
 *  second, duplicated read path). */
export async function listByoUsagePolicies(admin: SupabaseClient, accountId: string): Promise<WatchByoUsagePolicy[]> {
  const { data } = await admin
    .from("watch_byo_usage_policies")
    .select("id, account_id, community_id, deployment_id, kind, period, request_limit")
    .eq("account_id", accountId)
    .order("community_id", { ascending: true, nullsFirst: true })
    .order("deployment_id", { ascending: true, nullsFirst: true })
    .order("kind", { ascending: true });
  return (data ?? []).map(toPolicy);
}

async function loadPolicy(admin: SupabaseClient, accountId: string, scope: UsagePolicyScope, kind: UsagePolicyKind): Promise<WatchByoUsagePolicy | null> {
  let query = admin.from("watch_byo_usage_policies").select("id, account_id, community_id, deployment_id, kind, period, request_limit").eq("account_id", accountId).eq("kind", kind);
  if (scope.type === "account") query = query.is("community_id", null).is("deployment_id", null);
  else if (scope.type === "community") query = query.eq("community_id", scope.communityId).is("deployment_id", null);
  else query = query.eq("deployment_id", scope.deploymentId);
  const { data } = await query.maybeSingle();
  return data ? toPolicy(data) : null;
}

function onConflictFor(scope: UsagePolicyScope): string {
  if (scope.type === "account") return "account_id,kind";
  if (scope.type === "community") return "account_id,community_id,kind";
  return "account_id,deployment_id,kind";
}

/** Sets (or replaces) the policy for one (scope, kind) pair. `requestLimit`
 *  must be a positive integer. Never touches any OTHER scope/kind's policy
 *  -- an account-wide, a Community, and a deployment policy for the SAME
 *  kind are all independent. */
export async function setByoUsagePolicy(
  admin: SupabaseClient,
  accountId: string,
  scope: UsagePolicyScope,
  kind: UsagePolicyKind,
  period: UsagePolicyPeriod,
  requestLimit: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limit = Math.round(requestLimit);
  if (!(limit > 0)) return { ok: false, error: "Request limit must be a positive number." };
  const { error } = await admin.from("watch_byo_usage_policies").upsert(
    {
      account_id: accountId,
      community_id: scope.type === "community" ? scope.communityId : null,
      deployment_id: scope.type === "deployment" ? scope.deploymentId : null,
      kind, period, request_limit: limit, updated_at: new Date().toISOString(),
    },
    { onConflict: onConflictFor(scope) }
  );
  if (error) return { ok: false, error: "Couldn't save the usage limit." };
  return { ok: true };
}

export async function clearByoUsagePolicy(admin: SupabaseClient, accountId: string, scope: UsagePolicyScope, kind: UsagePolicyKind): Promise<void> {
  let query = admin.from("watch_byo_usage_policies").delete().eq("account_id", accountId).eq("kind", kind);
  if (scope.type === "account") query = query.is("community_id", null).is("deployment_id", null);
  else if (scope.type === "community") query = query.eq("community_id", scope.communityId).is("deployment_id", null);
  else query = query.eq("deployment_id", scope.deploymentId);
  await query;
}

async function readCounter(admin: SupabaseClient, accountId: string, scope: UsagePolicyScope, kind: UsagePolicyKind, key: string): Promise<number> {
  const { data } = await admin.from("watch_byo_usage_counters").select("request_count").eq("account_id", accountId).eq("scope_key", scopeKeyFor(scope)).eq("kind", kind).eq("period_key", key).maybeSingle();
  return (data?.request_count as number | undefined) ?? 0;
}

export interface ByoUsageGateResult {
  /** False when no policy is configured for THIS kind at ANY applicable
   *  scope -- unlimited, by the customer's own choice. */
  limited: boolean;
  allowed: boolean;
  /** Which scope's limit is the binding (tightest, currently-exhausted)
   *  one -- null when allowed or when `limited` is false. Diagnostic only. */
  blockedScope: "account" | "community" | "deployment" | null;
}

/** Evaluates every policy configured for this account AND KIND across all
 *  THREE applicable scopes -- account-wide, this Community (if given), and
 *  this specific deployment (if given) -- and blocks if ANY is exhausted
 *  for its own current period. The tightest configured ceiling always wins,
 *  regardless of which scope it's set at. A reactive-kind check never looks
 *  at (or is blocked by) a proactive policy, and vice versa. Checked BEFORE
 *  a BYO-routed AI call is attempted (never after), same discipline as
 *  every other quota/pool gate in this codebase. */
export async function checkByoUsageAllowed(
  admin: SupabaseClient, accountId: string, communityId: string | null, deploymentId: string | null = null, kind: UsagePolicyKind = "reactive", now: Date = new Date()
): Promise<ByoUsageGateResult> {
  const [accountPolicy, communityPolicy, deploymentPolicy] = await Promise.all([
    loadPolicy(admin, accountId, { type: "account" }, kind),
    communityId ? loadPolicy(admin, accountId, { type: "community", communityId }, kind) : Promise.resolve(null),
    deploymentId ? loadPolicy(admin, accountId, { type: "deployment", deploymentId }, kind) : Promise.resolve(null),
  ]);
  if (!accountPolicy && !communityPolicy && !deploymentPolicy) return { limited: false, allowed: true, blockedScope: null };

  if (accountPolicy) {
    const used = await readCounter(admin, accountId, { type: "account" }, kind, periodKey(accountPolicy.period, now));
    if (used >= accountPolicy.requestLimit) return { limited: true, allowed: false, blockedScope: "account" };
  }
  if (communityPolicy && communityId) {
    const used = await readCounter(admin, accountId, { type: "community", communityId }, kind, periodKey(communityPolicy.period, now));
    if (used >= communityPolicy.requestLimit) return { limited: true, allowed: false, blockedScope: "community" };
  }
  if (deploymentPolicy && deploymentId) {
    const used = await readCounter(admin, accountId, { type: "deployment", deploymentId }, kind, periodKey(deploymentPolicy.period, now));
    if (used >= deploymentPolicy.requestLimit) return { limited: true, allowed: false, blockedScope: "deployment" };
  }
  return { limited: true, allowed: true, blockedScope: null };
}

/** Records ONE successful request of the given KIND against every scope
 *  that currently has a configured policy FOR THAT KIND (account-wide,
 *  this Community, and/or this deployment) -- re-resolved at increment
 *  time (never assumed from the gate check) so a policy added mid-period
 *  starts its counter fresh from 0. A scope with NO configured policy for
 *  this kind is never written to.
 *
 *  SCOPE OF WHAT COUNTS: `kind: "reactive"` is recorded only from a
 *  successful conversational reply generation (chatter ANSWER/CASUAL_CHAT,
 *  community-runtime.ts's recordByoCall). `kind: "proactive"` is recorded
 *  only from a successfully SENT Watcher Presence Scheduling transition
 *  message (presence-runtime.ts's recordByoPresenceCall). Link-
 *  classification and media-moderation-warning BYO calls are NOT
 *  individually counted either way (no real ok/error signal to key off),
 *  but ARE still blocked by the reactive gate once a configured reactive
 *  limit is reached, since that gate governs the shared BYO credential
 *  itself for a reactive-triggered event, not one specific call site. */
export async function recordByoPolicyUsage(
  admin: SupabaseClient, accountId: string, communityId: string | null, deploymentId: string | null = null, kind: UsagePolicyKind = "reactive", now: Date = new Date()
): Promise<void> {
  try {
    const [accountPolicy, communityPolicy, deploymentPolicy] = await Promise.all([
      loadPolicy(admin, accountId, { type: "account" }, kind),
      communityId ? loadPolicy(admin, accountId, { type: "community", communityId }, kind) : Promise.resolve(null),
      deploymentId ? loadPolicy(admin, accountId, { type: "deployment", deploymentId }, kind) : Promise.resolve(null),
    ]);
    const targets: Array<{ scope: UsagePolicyScope; policy: WatchByoUsagePolicy }> = [];
    if (accountPolicy) targets.push({ scope: { type: "account" }, policy: accountPolicy });
    if (communityPolicy && communityId) targets.push({ scope: { type: "community", communityId }, policy: communityPolicy });
    if (deploymentPolicy && deploymentId) targets.push({ scope: { type: "deployment", deploymentId }, policy: deploymentPolicy });
    await Promise.all(
      targets.map(({ scope, policy }) =>
        admin.rpc("increment_watch_byo_usage", {
          p_account_id: accountId, p_scope_key: scopeKeyFor(scope), p_period_key: periodKey(policy.period, now), p_kind: kind,
          p_deployment_id: scope.type === "deployment" ? scope.deploymentId : null,
        })
      )
    );
  } catch (err) {
    // A usage-policy write failure must never break generation itself --
    // same "telemetry can't take down the feature" discipline as
    // recordByoUsageEvent.
    console.error("[watch-byo-usage-policy] recordByoPolicyUsage failed", err);
  }
}

/** Real observed usage for the Usage page's "BYO Usage Controls" section --
 *  every configured policy (every scope, both kinds), alongside its current
 *  period's real used count. Never fabricates a number for a scope/kind
 *  with no configured policy (those simply aren't returned). */
export async function getByoUsageStatus(admin: SupabaseClient, accountId: string, now: Date = new Date()): Promise<Array<WatchByoUsagePolicy & { used: number }>> {
  const policies = await listByoUsagePolicies(admin, accountId);
  return Promise.all(
    policies.map(async (p) => ({
      ...p,
      used: await readCounter(admin, accountId, p.scope, p.kind, periodKey(p.period, now)),
    }))
  );
}
