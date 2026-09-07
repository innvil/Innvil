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
 * UNIT: two independent, optional dimensions per (scope, kind, period) --
 * REQUESTS (always required -- "successful generations of the given kind")
 * and, as of 2026-08-25, real TOKENS (input + output combined, from the
 * provider's own reported usage -- see client.ts's aiCompleteWithMeta(),
 * which finally gave aiComplete() a real per-call token count to report,
 * closing the "would be dishonest to fabricate one" gap this comment used
 * to document). A customer may configure a token ceiling ALONGSIDE the
 * always-required request ceiling for the same policy row; the gate blocks
 * if EITHER configured limit is exhausted. A call whose provider response
 * genuinely didn't report usage increments used_tokens by 0, never guessed.
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
  /** Optional real-token ceiling (input+output combined), independent of
   *  requestLimit. Null = no token ceiling configured for this policy. */
  tokenLimit: number | null;
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
    tokenLimit: (row.token_limit as number | null | undefined) ?? null,
  };
}

const POLICY_COLUMNS = "id, account_id, community_id, deployment_id, kind, period, request_limit, token_limit";

/** Every policy configured for this account -- every scope, both kinds.
 *  Used by both the owner-facing settings UI and the gate below (never a
 *  second, duplicated read path). */
export async function listByoUsagePolicies(admin: SupabaseClient, accountId: string): Promise<WatchByoUsagePolicy[]> {
  const { data } = await admin
    .from("watch_byo_usage_policies")
    .select(POLICY_COLUMNS)
    .eq("account_id", accountId)
    .order("community_id", { ascending: true, nullsFirst: true })
    .order("deployment_id", { ascending: true, nullsFirst: true })
    .order("kind", { ascending: true });
  return (data ?? []).map(toPolicy);
}

async function loadPolicy(admin: SupabaseClient, accountId: string, scope: UsagePolicyScope, kind: UsagePolicyKind): Promise<WatchByoUsagePolicy | null> {
  let query = admin.from("watch_byo_usage_policies").select(POLICY_COLUMNS).eq("account_id", accountId).eq("kind", kind);
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
 *  must be a positive integer (always required -- unchanged). `tokenLimit`
 *  is a genuinely optional THIRD state, not a boolean:
 *    - omitted (undefined)  -> never included in the upsert payload, so an
 *      existing token limit is left completely untouched on an update
 *      (same "omit to preserve" idiom already used elsewhere in this
 *      codebase, e.g. activateWatchEntitlement's enterpriseSlots), and a
 *      brand-new row gets the column default (null, no token ceiling).
 *    - explicit null         -> clears any previously-configured token limit.
 *    - a positive number     -> validated + rounded, sets the ceiling.
 *  Never touches any OTHER scope/kind's policy -- an account-wide, a
 *  Community, and a deployment policy for the SAME kind are all
 *  independent. */
export async function setByoUsagePolicy(
  admin: SupabaseClient,
  accountId: string,
  scope: UsagePolicyScope,
  kind: UsagePolicyKind,
  period: UsagePolicyPeriod,
  requestLimit: number,
  tokenLimit?: number | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const limit = Math.round(requestLimit);
  if (!(limit > 0)) return { ok: false, error: "Request limit must be a positive number." };
  let roundedTokenLimit: number | null | undefined = tokenLimit;
  if (typeof tokenLimit === "number") {
    roundedTokenLimit = Math.round(tokenLimit);
    if (!(roundedTokenLimit > 0)) return { ok: false, error: "Token limit must be a positive number, or left blank." };
  }
  const payload: Record<string, unknown> = {
    account_id: accountId,
    community_id: scope.type === "community" ? scope.communityId : null,
    deployment_id: scope.type === "deployment" ? scope.deploymentId : null,
    kind, period, request_limit: limit, updated_at: new Date().toISOString(),
  };
  if (roundedTokenLimit !== undefined) payload.token_limit = roundedTokenLimit;
  const { error } = await admin.from("watch_byo_usage_policies").upsert(payload, { onConflict: onConflictFor(scope) });
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

interface CounterDetail { requestCount: number; usedTokens: number; }

async function readCounter(admin: SupabaseClient, accountId: string, scope: UsagePolicyScope, kind: UsagePolicyKind, key: string): Promise<CounterDetail> {
  const { data } = await admin.from("watch_byo_usage_counters").select("request_count, used_tokens").eq("account_id", accountId).eq("scope_key", scopeKeyFor(scope)).eq("kind", kind).eq("period_key", key).maybeSingle();
  return { requestCount: (data?.request_count as number | undefined) ?? 0, usedTokens: (data?.used_tokens as number | undefined) ?? 0 };
}

/** True the instant EITHER of a policy's two independent, optional
 *  dimensions is exhausted -- requestLimit is always present; tokenLimit
 *  may or may not be configured. */
function policyExhausted(policy: WatchByoUsagePolicy, counter: CounterDetail): "requests" | "tokens" | null {
  if (counter.requestCount >= policy.requestLimit) return "requests";
  if (policy.tokenLimit != null && counter.usedTokens >= policy.tokenLimit) return "tokens";
  return null;
}

export interface ByoUsageGateResult {
  /** False when no policy is configured for THIS kind at ANY applicable
   *  scope -- unlimited, by the customer's own choice. */
  limited: boolean;
  allowed: boolean;
  /** Which scope's limit is the binding (tightest, currently-exhausted)
   *  one -- null when allowed or when `limited` is false. Diagnostic only. */
  blockedScope: "account" | "community" | "deployment" | null;
  /** Which of that scope's two dimensions was the one actually exhausted --
   *  null when allowed. Diagnostic only, lets the UI/logs say "you hit your
   *  token ceiling" vs. "you hit your request ceiling" rather than a bare
   *  "blocked." */
  blockedBy: "requests" | "tokens" | null;
}

/** Evaluates every policy configured for this account AND KIND across all
 *  THREE applicable scopes -- account-wide, this Community (if given), and
 *  this specific deployment (if given) -- and blocks if ANY is exhausted
 *  (either its request ceiling OR its optional token ceiling) for its own
 *  current period. The tightest configured ceiling always wins, regardless
 *  of which scope/dimension it's set at. A reactive-kind check never looks
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
  if (!accountPolicy && !communityPolicy && !deploymentPolicy) return { limited: false, allowed: true, blockedScope: null, blockedBy: null };

  if (accountPolicy) {
    const counter = await readCounter(admin, accountId, { type: "account" }, kind, periodKey(accountPolicy.period, now));
    const exhausted = policyExhausted(accountPolicy, counter);
    if (exhausted) return { limited: true, allowed: false, blockedScope: "account", blockedBy: exhausted };
  }
  if (communityPolicy && communityId) {
    const counter = await readCounter(admin, accountId, { type: "community", communityId }, kind, periodKey(communityPolicy.period, now));
    const exhausted = policyExhausted(communityPolicy, counter);
    if (exhausted) return { limited: true, allowed: false, blockedScope: "community", blockedBy: exhausted };
  }
  if (deploymentPolicy && deploymentId) {
    const counter = await readCounter(admin, accountId, { type: "deployment", deploymentId }, kind, periodKey(deploymentPolicy.period, now));
    const exhausted = policyExhausted(deploymentPolicy, counter);
    if (exhausted) return { limited: true, allowed: false, blockedScope: "deployment", blockedBy: exhausted };
  }
  return { limited: true, allowed: true, blockedScope: null, blockedBy: null };
}

/** Records ONE successful request of the given KIND against every scope
 *  that currently has a configured policy FOR THAT KIND (account-wide,
 *  this Community, and/or this deployment) -- re-resolved at increment
 *  time (never assumed from the gate check) so a policy added mid-period
 *  starts its counter fresh from 0. A scope with NO configured policy for
 *  this kind is never written to. `tokens` (real, from the provider's own
 *  reported usage -- see client.ts's aiCompleteWithMeta()) is added to
 *  EVERY target's used_tokens counter regardless of whether that specific
 *  scope has a token ceiling configured -- so a token limit added mid-
 *  period after calls already happened still reflects real accrued usage,
 *  not a fresh-from-zero undercount. Omitted/0 when the caller has no real
 *  token count to report (e.g. a call site with no ok/error usage signal).
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
  admin: SupabaseClient, accountId: string, communityId: string | null, deploymentId: string | null = null, kind: UsagePolicyKind = "reactive", tokens = 0, now: Date = new Date()
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
          p_tokens: Math.max(0, Math.round(tokens || 0)),
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
 *  period's real used request count AND real used token count. Never
 *  fabricates a number for a scope/kind with no configured policy (those
 *  simply aren't returned). */
export async function getByoUsageStatus(admin: SupabaseClient, accountId: string, now: Date = new Date()): Promise<Array<WatchByoUsagePolicy & { used: number; usedTokens: number }>> {
  const policies = await listByoUsagePolicies(admin, accountId);
  return Promise.all(
    policies.map(async (p) => {
      const counter = await readCounter(admin, accountId, p.scope, p.kind, periodKey(p.period, now));
      return { ...p, used: counter.requestCount, usedTokens: counter.usedTokens };
    })
  );
}
