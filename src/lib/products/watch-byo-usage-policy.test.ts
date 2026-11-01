import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodKey, listByoUsagePolicies, setByoUsagePolicy, clearByoUsagePolicy,
  checkByoUsageAllowed, recordByoPolicyUsage, getByoUsageStatus, type UsagePolicyScope,
} from "./watch-byo-usage-policy";

/**
 * BYO Enterprise usage POLICY (Phase 4.V, extended in 4.V.1 with a
 * reactive/proactive kind split (item 1) and a real 3-level account/
 * Community/deployment hierarchy (item 2)) -- customer-owned, self-
 * configured operational ceilings on top of an already-stored BYO
 * credential. Tightest configured limit wins PER KIND across all three
 * applicable scopes, requests-per-period counted only for a successful
 * generation of that kind (community-runtime.ts's recordByoCall for
 * reactive, presence-runtime.ts's recordByoPresenceCall for proactive).
 */

const ACCOUNT: UsagePolicyScope = { type: "account" };
const COMMUNITY_1: UsagePolicyScope = { type: "community", communityId: "community-1" };
const COMMUNITY_2: UsagePolicyScope = { type: "community", communityId: "community-2" };
const DEPLOYMENT_1: UsagePolicyScope = { type: "deployment", deploymentId: "deployment-1" };
const DEPLOYMENT_2: UsagePolicyScope = { type: "deployment", deploymentId: "deployment-2" };

type Row = Record<string, unknown>;

function fakeAdmin(seed: { policies?: Row[]; counters?: Row[] } = {}) {
  const policies: Row[] = [...(seed.policies ?? [])];
  const counters: Row[] = [...(seed.counters ?? [])];
  let idCounter = 0;

  function policiesBuilder() {
    const filters: Array<(r: Row) => boolean> = [];
    let pendingOp: "select" | "delete" = "select";
    const builder: Record<string, unknown> = {
      select() { return builder; },
      delete() { pendingOp = "delete"; return builder; },
      order() { return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return builder; },
      async maybeSingle() {
        const rows = policies.filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
      upsert(row: Row, opts: { onConflict: string }) {
        return {
          then(resolve: (v: { data: Row | null; error: null }) => void) {
            const keys = opts.onConflict.split(",");
            const idx = policies.findIndex((r) => keys.every((k) => r[k] === row[k]));
            if (idx >= 0) { policies[idx] = { ...policies[idx], ...row }; }
            else { idCounter += 1; policies.push({ id: `gen-policy-${idCounter}`, ...row }); }
            resolve({ data: null, error: null });
          },
        };
      },
      then(resolve: (v: { data: Row[] | null; error: null }) => void) {
        const rows = policies.filter((r) => filters.every((f) => f(r)));
        if (pendingOp === "delete") {
          for (let i = policies.length - 1; i >= 0; i--) {
            if (filters.every((f) => f(policies[i]))) policies.splice(i, 1);
          }
          resolve({ data: null, error: null });
          return;
        }
        resolve({ data: rows, error: null });
      },
    };
    return builder;
  }

  function countersBuilder() {
    const filters: Array<(r: Row) => boolean> = [];
    const builder: Record<string, unknown> = {
      select() { return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      async maybeSingle() {
        const rows = counters.filter((r) => filters.every((f) => f(r)));
        return { data: rows[0] ?? null, error: null };
      },
    };
    return builder;
  }

  return {
    __policies: policies,
    __counters: counters,
    from(table: string) {
      if (table === "watch_byo_usage_policies") return policiesBuilder();
      if (table === "watch_byo_usage_counters") return countersBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== "increment_watch_byo_usage") throw new Error(`unexpected rpc ${fn}`);
      const tokens = Math.max(0, Math.round((args.p_tokens as number | undefined) ?? 0));
      const idx = counters.findIndex((r) => r.account_id === args.p_account_id && r.scope_key === args.p_scope_key && r.kind === (args.p_kind ?? "reactive") && r.period_key === args.p_period_key);
      if (idx >= 0) {
        counters[idx] = { ...counters[idx], request_count: (counters[idx].request_count as number) + 1, used_tokens: ((counters[idx].used_tokens as number | undefined) ?? 0) + tokens };
        return { data: [{ request_count: counters[idx].request_count, used_tokens: counters[idx].used_tokens }], error: null };
      }
      const row = { account_id: args.p_account_id, scope_key: args.p_scope_key, kind: args.p_kind ?? "reactive", period_key: args.p_period_key, deployment_id: args.p_deployment_id ?? null, request_count: 1, used_tokens: tokens };
      counters.push(row);
      return { data: [{ request_count: 1, used_tokens: tokens }], error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function policyRow(accountId: string, scope: UsagePolicyScope, kind: "reactive" | "proactive", period: "daily" | "monthly", requestLimit: number, tokenLimit: number | null = null): Row {
  return {
    id: `pol-${accountId}-${JSON.stringify(scope)}-${kind}`,
    account_id: accountId,
    community_id: scope.type === "community" ? scope.communityId : null,
    deployment_id: scope.type === "deployment" ? scope.deploymentId : null,
    kind, period, request_limit: requestLimit, token_limit: tokenLimit,
  };
}
function counterRow(accountId: string, scopeKey: string, kind: "reactive" | "proactive", periodKeyStr: string, count: number, usedTokens = 0): Row {
  return { account_id: accountId, scope_key: scopeKey, kind, period_key: periodKeyStr, request_count: count, used_tokens: usedTokens };
}

/* --------------------------------------------------------------- periodKey ---- */

test("periodKey resolves a real UTC calendar day/month key, deterministic", () => {
  const now = new Date("2026-08-25T14:30:00.000Z");
  assert.equal(periodKey("daily", now), "daily:2026-08-25");
  assert.equal(periodKey("monthly", now), "monthly:2026-08");
});

/* --------------------------------------------------------- CRUD (set/list/clear) ---- */

test("REQUIRED: setByoUsagePolicy rejects a non-positive limit, writes nothing", async () => {
  const admin = fakeAdmin();
  const res = await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 0);
  assert.equal(res.ok, false);
  assert.equal(admin.__policies.length, 0);
});

test("REQUIRED: account-wide, per-Community, and per-deployment policies for the SAME account all coexist independently", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", COMMUNITY_1, "reactive", "daily", 100);
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "daily", 10);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 3);
  assert.ok(list.some((p) => p.scope.type === "account" && p.requestLimit === 5000));
  assert.ok(list.some((p) => p.scope.type === "community" && p.requestLimit === 100));
  assert.ok(list.some((p) => p.scope.type === "deployment" && p.requestLimit === 10));
});

test("setByoUsagePolicy on an already-existing (scope, kind) REPLACES it, never adds a duplicate row", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "daily", 200);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].period, "daily");
  assert.equal(list[0].requestLimit, 200);
});

test("REQUIRED: a reactive and a proactive policy at the SAME (deployment) scope coexist independently", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "proactive", "daily", 50);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2);
  const reactive = list.find((p) => p.kind === "reactive")!;
  const proactive = list.find((p) => p.kind === "proactive")!;
  assert.equal(reactive.requestLimit, 5000);
  assert.equal(proactive.requestLimit, 50);
});

test("REQUIRED: a deployment-scoped policy is distinct from that same deployment's Community's policy -- setting one never touches the other", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", COMMUNITY_1, "reactive", "monthly", 1000);
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "monthly", 50);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2, "the Community policy and the deployment policy must both survive as separate rows");
});

test("clearByoUsagePolicy removes only the targeted (scope, kind), never another account's, scope's, or kind's policy", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "proactive", "monthly", 50);
  await setByoUsagePolicy(admin, "acct-1", DEPLOYMENT_1, "reactive", "daily", 100);
  await setByoUsagePolicy(admin, "acct-2", ACCOUNT, "reactive", "monthly", 999);
  await clearByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive");
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2, "the account-wide PROACTIVE policy and the deployment policy must survive");
  assert.ok(list.some((p) => p.scope.type === "account" && p.kind === "proactive"));
  assert.ok(list.some((p) => p.scope.type === "deployment"));
  const other = await listByoUsagePolicies(admin, "acct-2");
  assert.equal(other.length, 1, "a different account's policy must be untouched");
});

/* --------------------------------------------------- checkByoUsageAllowed (the gate) ---- */

test("REQUIRED: no policy configured at any scope -- unlimited, allowed (defaults to reactive)", async () => {
  const admin = fakeAdmin();
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-1");
  assert.equal(gate.limited, false);
  assert.equal(gate.allowed, true);
});

test("REQUIRED: an account-wide policy AT its limit blocks the call", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10)],
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 10)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "account");
});

test("REQUIRED: the TIGHTEST configured limit wins -- a Community-level limit blocks even though the account-wide one has headroom", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10000), policyRow("acct-1", COMMUNITY_1, "reactive", "daily", 5)],
    counters: [
      counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 1),
      counterRow("acct-1", "community:community-1", "reactive", periodKey("daily", now), 5),
    ],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-1", null, "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "community");
});

test("REQUIRED: a per-DEPLOYMENT limit is the tightest and wins over both account-wide and Community headroom", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [
      policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10000),
      policyRow("acct-1", COMMUNITY_1, "reactive", "monthly", 1000),
      policyRow("acct-1", DEPLOYMENT_1, "reactive", "daily", 3),
    ],
    counters: [
      counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 1),
      counterRow("acct-1", "community:community-1", "reactive", periodKey("monthly", now), 1),
      counterRow("acct-1", "deployment:deployment-1", "reactive", periodKey("daily", now), 3),
    ],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-1", "deployment-1", "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "deployment");
});

test("a deployment-scoped policy never blocks a DIFFERENT deployment's calls, even in the same Community", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", DEPLOYMENT_1, "reactive", "daily", 1)],
    counters: [counterRow("acct-1", "deployment:deployment-1", "reactive", periodKey("daily", now), 1)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-1", "deployment-2", "reactive", now);
  assert.equal(gate.allowed, true, "deployment-2 has no policy of its own");
});

test("a Community-scoped policy never blocks a DIFFERENT Community's calls under the same account", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", COMMUNITY_1, "reactive", "daily", 1)],
    counters: [counterRow("acct-1", "community:community-1", "reactive", periodKey("daily", now), 1)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-2", null, "reactive", now);
  assert.equal(gate.allowed, true);
});

test("a new period resets the counter to 0 -- a policy that was exhausted yesterday is allowed again today", async () => {
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "daily", 1)],
    counters: [counterRow("acct-1", "account:__", "reactive", "daily:2026-08-24", 1)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(gate.allowed, true);
});

/* ------------------------------------------- reactive/proactive independence (Phase 4.V.1 item 1) ---- */

test("REQUIRED: an EXHAUSTED reactive policy never blocks a proactive call at the same scope, and vice versa", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10), policyRow("acct-1", ACCOUNT, "proactive", "monthly", 10)],
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 10)],
  });
  const reactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(reactiveGate.allowed, false);
  const proactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, null, "proactive", now);
  assert.equal(proactiveGate.allowed, true, "the proactive policy has separate, untouched headroom");
});

test("only ONE kind's policy configured -- the OTHER kind resolves as genuinely unlimited (limited:false)", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 1)] });
  const proactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, null, "proactive");
  assert.equal(proactiveGate.limited, false);
  assert.equal(proactiveGate.allowed, true);
});

/* ----------------------------------------------------------- recordByoPolicyUsage ---- */

test("REQUIRED: recording usage increments only the scopes that have a CONFIGURED policy for that kind", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100)] });
  const now = new Date("2026-08-25T00:00:00.000Z");
  await recordByoPolicyUsage(admin, "acct-1", "community-1", null, "reactive", 0, now); // community-1 has NO configured policy
  assert.equal(admin.__counters.length, 1, "only the account-wide scope should have been written to");
  assert.equal(admin.__counters[0].scope_key, "account:__");
  assert.equal(admin.__counters[0].request_count, 1);
});

test("REQUIRED: an account with no policy configured at all is never written to", async () => {
  const admin = fakeAdmin();
  await recordByoPolicyUsage(admin, "acct-1", "community-1");
  assert.equal(admin.__counters.length, 0);
});

test("recording usage increments ALL THREE scopes when account-wide, Community, and deployment policies are all configured (same kind)", async () => {
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100), policyRow("acct-1", COMMUNITY_1, "reactive", "daily", 10), policyRow("acct-1", DEPLOYMENT_1, "reactive", "daily", 5)],
  });
  await recordByoPolicyUsage(admin, "acct-1", "community-1", "deployment-1", "reactive", 0, new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(admin.__counters.length, 3);
});

test("REQUIRED: recording a reactive call never increments a deployment's proactive counter, or a different deployment's counter", async () => {
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", DEPLOYMENT_1, "reactive", "monthly", 100), policyRow("acct-1", DEPLOYMENT_1, "proactive", "monthly", 100), policyRow("acct-1", DEPLOYMENT_2, "reactive", "monthly", 100)],
  });
  await recordByoPolicyUsage(admin, "acct-1", "community-1", "deployment-1", "reactive", 0, new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(admin.__counters.length, 1);
  assert.equal(admin.__counters[0].scope_key, "deployment:deployment-1");
  assert.equal(admin.__counters[0].kind, "reactive");
});

test("REQUIRED: the increment RPC is atomic-upsert-shaped -- a second increment for the same scope+kind+period increments, not duplicates", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100)] });
  const now = new Date("2026-08-25T00:00:00.000Z");
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 0, now);
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 0, now);
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 0, now);
  assert.equal(admin.__counters.length, 1);
  assert.equal(admin.__counters[0].request_count, 3);
});

test("a usage-policy write failure never throws -- generation must never be broken by a telemetry-adjacent write", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100)] });
  admin.rpc = async () => { throw new Error("simulated DB failure"); };
  await assert.doesNotReject(recordByoPolicyUsage(admin, "acct-1", null));
});

/* ------------------------------------------------------------- getByoUsageStatus ---- */

test("getByoUsageStatus reports real used counts alongside every configured policy, zero for a fresh period", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100)],
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 7)],
  });
  const status = await getByoUsageStatus(admin, "acct-1", now);
  assert.equal(status.length, 1);
  assert.equal(status[0].used, 7);
  assert.equal(status[0].requestLimit, 100);
});

test("getByoUsageStatus never fabricates a scope that has no configured policy", async () => {
  const admin = fakeAdmin();
  const status = await getByoUsageStatus(admin, "acct-1");
  assert.deepEqual(status, []);
});

test("getByoUsageStatus reports account/Community/deployment scopes independently, each with its own used count", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100), policyRow("acct-1", DEPLOYMENT_1, "proactive", "monthly", 30)],
    counters: [
      counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 12),
      counterRow("acct-1", "deployment:deployment-1", "proactive", periodKey("monthly", now), 4),
    ],
  });
  const status = await getByoUsageStatus(admin, "acct-1", now);
  assert.equal(status.length, 2);
  const account = status.find((s) => s.scope.type === "account")!;
  const deployment = status.find((s) => s.scope.type === "deployment")!;
  assert.equal(account.used, 12);
  assert.equal(deployment.used, 4);
});

/* ----------------------------------------------------- token-based ceilings (4.V.1) ---- */
// Closes item 1 off the honest deferred list -- a token ceiling is an
// OPTIONAL second dimension on the same policy row, independent of the
// always-required request ceiling; the gate blocks if EITHER is exhausted.

test("REQUIRED: setByoUsagePolicy rejects a non-positive tokenLimit when one is given, writes nothing", async () => {
  const admin = fakeAdmin();
  const res = await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 100, 0);
  assert.equal(res.ok, false);
  assert.equal(admin.__policies.length, 0);
});

test("REQUIRED: a policy can be created with a real tokenLimit alongside its requestLimit", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000, 200000);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list[0].requestLimit, 5000);
  assert.equal(list[0].tokenLimit, 200000);
});

test("omitting tokenLimit on an update leaves a previously-configured token limit completely untouched", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000, 200000);
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 6000); // tokenLimit omitted entirely
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list[0].requestLimit, 6000, "the request limit change should have applied");
  assert.equal(list[0].tokenLimit, 200000, "the token limit must survive an update that never mentions it");
});

test("REQUIRED: explicit null tokenLimit clears a previously-configured token limit", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000, 200000);
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000, null);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list[0].tokenLimit, null);
});

test("a brand-new policy with tokenLimit omitted has no token ceiling at all (null, not 0)", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", ACCOUNT, "reactive", "monthly", 5000);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list[0].tokenLimit, null);
});

test("REQUIRED: a policy with a configured token limit blocks once TOKEN usage is exhausted, even with real request-count headroom", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10000, 5000)], // plenty of requests, tight tokens
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 3, 5000)], // only 3/10000 requests used, but tokens exhausted
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "account");
  assert.equal(gate.blockedBy, "tokens");
});

test("REQUIRED: blockedBy reports 'requests' when the request ceiling (not the token one) is what's exhausted", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 5, 1000000)], // tight requests, generous tokens
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 5, 100)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedBy, "requests");
});

test("a policy with NO token limit configured is never blocked by token usage, no matter how high", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 10000, null)],
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 3, 999999999)],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(gate.allowed, true);
});

test("REQUIRED: allowed gate returns blockedBy:null", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 100, 100000)] });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive");
  assert.equal(gate.allowed, true);
  assert.equal(gate.blockedBy, null);
});

test("REQUIRED: recordByoPolicyUsage's tokens param accumulates real usage on the counter", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 5000, 100000)] });
  const now = new Date("2026-08-25T00:00:00.000Z");
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 1200, now);
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 800, now);
  assert.equal(admin.__counters[0].request_count, 2);
  assert.equal(admin.__counters[0].used_tokens, 2000);
});

test("recordByoPolicyUsage with tokens omitted (default 0) never inflates the token counter", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 5000, 100000)] });
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive");
  assert.equal(admin.__counters[0].used_tokens, 0);
});

test("REQUIRED: recordByoPolicyUsage adds tokens to a scope's counter even when that scope has NO token limit configured -- real accrued usage, never dropped", async () => {
  const admin = fakeAdmin({ policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 5000, null)] });
  await recordByoPolicyUsage(admin, "acct-1", null, null, "reactive", 1500);
  assert.equal(admin.__counters[0].used_tokens, 1500, "tokens should accrue even without a configured token ceiling, so a limit added mid-period reflects real usage");
});

test("getByoUsageStatus reports real usedTokens alongside used (request count)", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "monthly", 5000, 100000)],
    counters: [counterRow("acct-1", "account:__", "reactive", periodKey("monthly", now), 12, 45000)],
  });
  const status = await getByoUsageStatus(admin, "acct-1", now);
  assert.equal(status[0].used, 12);
  assert.equal(status[0].usedTokens, 45000);
  assert.equal(status[0].tokenLimit, 100000);
});

/* -------------------------------------------------------- cross-account isolation ---- */

test("REQUIRED: usage counters and policies never leak across accounts", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [policyRow("acct-1", ACCOUNT, "reactive", "daily", 5), policyRow("acct-2", ACCOUNT, "reactive", "daily", 5)],
    counters: [counterRow("acct-2", "account:__", "reactive", periodKey("daily", now), 5)],
  });
  const acct1Gate = await checkByoUsageAllowed(admin, "acct-1", null, null, "reactive", now);
  assert.equal(acct1Gate.allowed, true, "acct-2's exhausted counter must never block acct-1");
});
