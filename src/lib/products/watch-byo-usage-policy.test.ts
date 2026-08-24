import { test } from "node:test";
import assert from "node:assert/strict";
import {
  periodKey, listByoUsagePolicies, setByoUsagePolicy, clearByoUsagePolicy,
  checkByoUsageAllowed, recordByoPolicyUsage, getByoUsageStatus,
} from "./watch-byo-usage-policy";

/**
 * BYO Enterprise usage POLICY (Phase 4.V, extended in 4.V.1 with a
 * reactive/proactive kind split) -- customer-owned, self-configured
 * operational ceilings on top of an already-stored BYO credential.
 * Hierarchical (account-wide + per-Community, deployment deliberately out
 * of scope this pass -- see the file's own doc comment), tightest
 * configured limit wins PER KIND, requests-per-period counted only for a
 * successful generation of that kind (community-runtime.ts's recordByoCall
 * for reactive, presence-runtime.ts's recordByoPresenceCall for proactive).
 */

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
      const idx = counters.findIndex(
        (r) => r.account_id === args.p_account_id && r.scope_key === args.p_scope_key && r.kind === (args.p_kind ?? "reactive") && r.period_key === args.p_period_key
      );
      if (idx >= 0) { counters[idx] = { ...counters[idx], request_count: (counters[idx].request_count as number) + 1 }; return { data: counters[idx].request_count, error: null }; }
      const row = { account_id: args.p_account_id, scope_key: args.p_scope_key, kind: args.p_kind ?? "reactive", period_key: args.p_period_key, request_count: 1 };
      counters.push(row);
      return { data: 1, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
  const res = await setByoUsagePolicy(admin, "acct-1", null, "reactive", "monthly", 0);
  assert.equal(res.ok, false);
  assert.equal(admin.__policies.length, 0);
});

test("REQUIRED: an account-wide policy and a per-Community policy for the SAME account coexist independently", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", null, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", "community-1", "reactive", "daily", 100);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2);
  assert.ok(list.some((p) => p.communityId === null && p.requestLimit === 5000));
  assert.ok(list.some((p) => p.communityId === "community-1" && p.requestLimit === 100));
});

test("setByoUsagePolicy on an already-existing (scope, kind) REPLACES it, never adds a duplicate row", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", null, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", null, "reactive", "daily", 200);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 1);
  assert.equal(list[0].period, "daily");
  assert.equal(list[0].requestLimit, 200);
});

test("REQUIRED: a reactive and a proactive policy at the SAME scope coexist independently -- setting one never touches the other", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", null, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", null, "proactive", "daily", 50);
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2, "both the reactive and proactive account-wide policies must exist as separate rows");
  const reactive = list.find((p) => p.kind === "reactive")!;
  const proactive = list.find((p) => p.kind === "proactive")!;
  assert.equal(reactive.requestLimit, 5000);
  assert.equal(proactive.requestLimit, 50);
  assert.equal(reactive.period, "monthly");
  assert.equal(proactive.period, "daily");
});

test("clearByoUsagePolicy removes only the targeted (scope, kind), never another account's, scope's, or kind's policy", async () => {
  const admin = fakeAdmin();
  await setByoUsagePolicy(admin, "acct-1", null, "reactive", "monthly", 5000);
  await setByoUsagePolicy(admin, "acct-1", null, "proactive", "monthly", 50);
  await setByoUsagePolicy(admin, "acct-1", "community-1", "reactive", "daily", 100);
  await setByoUsagePolicy(admin, "acct-2", null, "reactive", "monthly", 999);
  await clearByoUsagePolicy(admin, "acct-1", null, "reactive");
  const list = await listByoUsagePolicies(admin, "acct-1");
  assert.equal(list.length, 2, "the account-wide PROACTIVE policy and the Community policy must survive");
  assert.ok(list.some((p) => p.communityId === null && p.kind === "proactive"));
  assert.ok(list.some((p) => p.communityId === "community-1"));
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

test("REQUIRED: an account-wide policy under its limit allows the call", async () => {
  const admin = fakeAdmin({ policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 10 }] });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, "reactive", new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(gate.limited, true);
  assert.equal(gate.allowed, true);
});

test("REQUIRED: an account-wide policy AT its limit blocks the call", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 10 }],
    counters: [{ account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: periodKey("monthly", now), request_count: 10 }],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "account");
});

test("REQUIRED: the TIGHTEST configured limit wins -- a Community-level limit blocks even though the account-wide one has headroom", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 10000 },
      { id: "p2", account_id: "acct-1", community_id: "community-1", kind: "reactive", period: "daily", request_limit: 5 },
    ],
    counters: [
      { account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: periodKey("monthly", now), request_count: 1 },
      { account_id: "acct-1", scope_key: "community-1", kind: "reactive", period_key: periodKey("daily", now), request_count: 5 },
    ],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-1", "reactive", now);
  assert.equal(gate.allowed, false);
  assert.equal(gate.blockedScope, "community");
});

test("a Community-scoped policy never blocks a DIFFERENT Community's calls under the same account", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [{ id: "p1", account_id: "acct-1", community_id: "community-1", kind: "reactive", period: "daily", request_limit: 1 }],
    counters: [{ account_id: "acct-1", scope_key: "community-1", kind: "reactive", period_key: periodKey("daily", now), request_count: 1 }],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", "community-2", "reactive", now);
  assert.equal(gate.allowed, true, "community-2 has no policy of its own and no account-wide one either");
});

test("a new period resets the counter to 0 -- a policy that was exhausted yesterday is allowed again today", async () => {
  const admin = fakeAdmin({
    policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "daily", request_limit: 1 }],
    counters: [{ account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: "daily:2026-08-24", request_count: 1 }],
  });
  const gate = await checkByoUsageAllowed(admin, "acct-1", null, "reactive", new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(gate.allowed, true);
});

/* ------------------------------------------- reactive/proactive independence (Phase 4.V.1) ---- */

test("REQUIRED: an EXHAUSTED reactive policy never blocks a proactive call at the same scope, and vice versa", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 10 },
      { id: "p2", account_id: "acct-1", community_id: null, kind: "proactive", period: "monthly", request_limit: 10 },
    ],
    counters: [
      { account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: periodKey("monthly", now), request_count: 10 },
    ],
  });
  const reactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, "reactive", now);
  assert.equal(reactiveGate.allowed, false, "the reactive policy IS exhausted");
  const proactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, "proactive", now);
  assert.equal(proactiveGate.allowed, true, "the proactive policy has separate, untouched headroom");
});

test("REQUIRED: recording a reactive call increments only the reactive counter, never the proactive one", async () => {
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 },
      { id: "p2", account_id: "acct-1", community_id: null, kind: "proactive", period: "monthly", request_limit: 100 },
    ],
  });
  await recordByoPolicyUsage(admin, "acct-1", null, "reactive", new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(admin.__counters.length, 1);
  assert.equal(admin.__counters[0].kind, "reactive");
});

test("only ONE kind's policy configured -- the OTHER kind resolves as genuinely unlimited (limited:false), never inheriting the configured kind's limit", async () => {
  const admin = fakeAdmin({ policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 1 }] });
  const proactiveGate = await checkByoUsageAllowed(admin, "acct-1", null, "proactive");
  assert.equal(proactiveGate.limited, false);
  assert.equal(proactiveGate.allowed, true);
});

/* ----------------------------------------------------------- recordByoPolicyUsage ---- */

test("REQUIRED: recording usage increments only the scopes that have a CONFIGURED policy for that kind", async () => {
  const admin = fakeAdmin({ policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 }] });
  const now = new Date("2026-08-25T00:00:00.000Z");
  await recordByoPolicyUsage(admin, "acct-1", "community-1", "reactive", now); // community-1 has NO configured policy
  assert.equal(admin.__counters.length, 1, "only the account-wide scope should have been written to");
  assert.equal(admin.__counters[0].scope_key, "__account__");
  assert.equal(admin.__counters[0].request_count, 1);
});

test("REQUIRED: an account with no policy configured at all is never written to", async () => {
  const admin = fakeAdmin();
  await recordByoPolicyUsage(admin, "acct-1", "community-1");
  assert.equal(admin.__counters.length, 0);
});

test("recording usage increments BOTH the account-wide and Community counters when both are configured (same kind)", async () => {
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 },
      { id: "p2", account_id: "acct-1", community_id: "community-1", kind: "reactive", period: "daily", request_limit: 10 },
    ],
  });
  await recordByoPolicyUsage(admin, "acct-1", "community-1", "reactive", new Date("2026-08-25T00:00:00.000Z"));
  assert.equal(admin.__counters.length, 2);
});

test("REQUIRED: the increment RPC is atomic-upsert-shaped -- a second increment for the same scope+kind+period increments, not duplicates", async () => {
  const admin = fakeAdmin({ policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 }] });
  const now = new Date("2026-08-25T00:00:00.000Z");
  await recordByoPolicyUsage(admin, "acct-1", null, "reactive", now);
  await recordByoPolicyUsage(admin, "acct-1", null, "reactive", now);
  await recordByoPolicyUsage(admin, "acct-1", null, "reactive", now);
  assert.equal(admin.__counters.length, 1, "one row per scope+kind+period, never duplicated");
  assert.equal(admin.__counters[0].request_count, 3);
});

test("a usage-policy write failure never throws -- generation must never be broken by a telemetry-adjacent write", async () => {
  const admin = fakeAdmin({ policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 }] });
  admin.rpc = async () => { throw new Error("simulated DB failure"); };
  await assert.doesNotReject(recordByoPolicyUsage(admin, "acct-1", null));
});

/* ------------------------------------------------------------- getByoUsageStatus ---- */

test("getByoUsageStatus reports real used counts alongside every configured policy, zero for a fresh period", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [{ id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 }],
    counters: [{ account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: periodKey("monthly", now), request_count: 7 }],
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

test("getByoUsageStatus reports both kinds independently, each with its own used count", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 100 },
      { id: "p2", account_id: "acct-1", community_id: null, kind: "proactive", period: "monthly", request_limit: 30 },
    ],
    counters: [
      { account_id: "acct-1", scope_key: "__account__", kind: "reactive", period_key: periodKey("monthly", now), request_count: 12 },
      { account_id: "acct-1", scope_key: "__account__", kind: "proactive", period_key: periodKey("monthly", now), request_count: 4 },
    ],
  });
  const status = await getByoUsageStatus(admin, "acct-1", now);
  assert.equal(status.length, 2);
  const reactive = status.find((s) => s.kind === "reactive")!;
  const proactive = status.find((s) => s.kind === "proactive")!;
  assert.equal(reactive.used, 12);
  assert.equal(proactive.used, 4);
});

/* -------------------------------------------------------- cross-account isolation ---- */

test("REQUIRED: usage counters and policies never leak across accounts", async () => {
  const now = new Date("2026-08-25T00:00:00.000Z");
  const admin = fakeAdmin({
    policies: [
      { id: "p1", account_id: "acct-1", community_id: null, kind: "reactive", period: "daily", request_limit: 5 },
      { id: "p2", account_id: "acct-2", community_id: null, kind: "reactive", period: "daily", request_limit: 5 },
    ],
    counters: [{ account_id: "acct-2", scope_key: "__account__", kind: "reactive", period_key: periodKey("daily", now), request_count: 5 }],
  });
  const acct1Gate = await checkByoUsageAllowed(admin, "acct-1", null, "reactive", now);
  assert.equal(acct1Gate.allowed, true, "acct-2's exhausted counter must never block acct-1");
});
