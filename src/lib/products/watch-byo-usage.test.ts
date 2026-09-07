import { test } from "node:test";
import assert from "node:assert/strict";
import { recordByoUsageEvent, getByoUsageSummary, getByoProviderHealth } from "./watch-byo-usage";

/**
 * BYO Enterprise -- Phase 2 (2026-08-24) usage telemetry, extended
 * 2026-08-25 with real per-call token counts + duration (Phase 4.V.1,
 * items 1/3 off the honest deferred list) once aiCompleteWithMeta() gave
 * the AI client a real usage return path. Never a fabricated token/cost
 * figure -- an event/summary with no observed usage reports null, not 0.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_byo_ai_usage_events?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_byo_ai_usage_events: seed.watch_byo_ai_usage_events ?? [],
  };
  let idCounter = 0;
  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let headCount = false;
      let sortCol: string | null = null;
      let sortDesc = false;
      let limitN: number | null = null;
      const rowsFor = () => {
        let rows = (store[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (sortCol) {
          const col = sortCol;
          rows = [...rows].sort((a, b) => (sortDesc ? String(b[col]).localeCompare(String(a[col])) : String(a[col]).localeCompare(String(b[col]))));
        }
        if (limitN != null) rows = rows.slice(0, limitN);
        return rows;
      };
      const builder: Record<string, unknown> = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) { headCount = !!opts?.head; return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        gte(col: string, val: string) { filters.push((r) => String(r[col]) >= val); return builder; },
        order(col: string, opts?: { ascending?: boolean }) { sortCol = col; sortDesc = opts?.ascending === false; return builder; },
        limit(n: number) { limitN = n; return builder; },
        async maybeSingle() {
          const rows = rowsFor();
          return { data: rows[0] ?? null, error: null };
        },
        then(resolve: (v: { data: Row[] | null; error: null; count?: number }) => void) {
          const rows = rowsFor();
          resolve(headCount ? { data: null, error: null, count: rows.length } : { data: rows, error: null });
        },
        async insert(row: Row) {
          idCounter += 1;
          store[table] = [...(store[table] ?? []), { id: idCounter, created_at: new Date().toISOString(), ...row }];
          return { data: null, error: null };
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ------------------------------------------------------- recordByoUsageEvent ---- */

test("REQUIRED: recordByoUsageEvent inserts a real row", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, { accountId: "acct-1", communityId: "comm-1", automation: "NATURAL_CHATTER_ANSWER", provider: "anthropic", model: "claude-sonnet-5", ok: true });
  assert.equal(admin.__store.watch_byo_ai_usage_events.length, 1);
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.account_id, "acct-1");
  assert.equal(row.community_id, "comm-1");
  assert.equal(row.ok, true);
});

test("REQUIRED: recordByoUsageEvent never throws even when the underlying insert errors", async () => {
  const admin = { from: () => ({ insert: async () => ({ data: null, error: { message: "db down" } }) }) } as unknown as Parameters<typeof recordByoUsageEvent>[0];
  await assert.doesNotReject(recordByoUsageEvent(admin, { accountId: "acct-1", automation: "x", provider: "anthropic", model: "m", ok: false, error: "boom" }));
});

test("REQUIRED: recordByoUsageEvent never throws even when .from() itself throws", async () => {
  const admin = { from: () => { throw new Error("connection reset"); } } as unknown as Parameters<typeof recordByoUsageEvent>[0];
  await assert.doesNotReject(recordByoUsageEvent(admin, { accountId: "acct-1", automation: "x", provider: "anthropic", model: "m", ok: true }));
});

test("communityId/deploymentId/error default to null when omitted", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, { accountId: "acct-1", automation: "x", provider: "anthropic", model: "m", ok: true });
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.community_id, null);
  assert.equal(row.deployment_id, null);
  assert.equal(row.error, null);
});

test("REQUIRED: recordByoUsageEvent records the given deploymentId (Phase 4.V.1 attribution)", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, { accountId: "acct-1", communityId: "comm-1", deploymentId: "dep-1", automation: "WATCHER_PRESENCE", provider: "anthropic", model: "m", ok: true });
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.deployment_id, "dep-1");
});

test("REQUIRED: recordByoUsageEvent records real input/output tokens + duration", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, {
    accountId: "acct-1", automation: "NATURAL_CHATTER_ANSWER_BYO", provider: "anthropic", model: "m", ok: true,
    inputTokens: 812, outputTokens: 143, durationMs: 2450,
  });
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.input_tokens, 812);
  assert.equal(row.output_tokens, 143);
  assert.equal(row.duration_ms, 2450);
});

test("inputTokens/outputTokens/durationMs default to null when omitted (never a fabricated 0)", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, { accountId: "acct-1", automation: "x", provider: "anthropic", model: "m", ok: true });
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.input_tokens, null);
  assert.equal(row.output_tokens, null);
  assert.equal(row.duration_ms, null);
});

/* -------------------------------------------------------- getByoUsageSummary ---- */

const ROWS_FOR_ACCT1: Row[] = [
  { account_id: "acct-1", automation: "NATURAL_CHATTER_ANSWER", ok: true, created_at: new Date().toISOString() },
  { account_id: "acct-1", automation: "NATURAL_CHATTER_ANSWER", ok: true, created_at: new Date().toISOString() },
  { account_id: "acct-1", automation: "NATURAL_CHATTER_ANSWER", ok: false, created_at: new Date().toISOString() },
  { account_id: "acct-1", automation: "NATURAL_CHATTER_CASUAL_CHAT", ok: true, created_at: new Date().toISOString() },
];

test("REQUIRED: getByoUsageSummary computes real total/success/failure counts, grouped by automation", async () => {
  const admin = fakeAdmin({ watch_byo_ai_usage_events: ROWS_FOR_ACCT1 });
  const summary = await getByoUsageSummary(admin, "acct-1");
  assert.equal(summary.totalCalls, 4);
  assert.equal(summary.successfulCalls, 3);
  assert.equal(summary.failedCalls, 1);
  const answer = summary.byAutomation.find((a) => a.automation === "NATURAL_CHATTER_ANSWER");
  assert.equal(answer?.total, 3);
  assert.equal(answer?.successful, 2);
  assert.equal(answer?.failed, 1);
  const casual = summary.byAutomation.find((a) => a.automation === "NATURAL_CHATTER_CASUAL_CHAT");
  assert.equal(casual?.total, 1);
  assert.equal(casual?.successful, 1);
});

test("getByoUsageSummary returns the empty summary (never throws) for an account with nothing recorded", async () => {
  const admin = fakeAdmin({});
  const summary = await getByoUsageSummary(admin, "acct-empty");
  assert.deepEqual(summary, { totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalInputTokens: null, totalOutputTokens: null, avgDurationMs: null, byAutomation: [], byCommunity: [], byDeployment: [] });
});

test("REQUIRED: getByoUsageSummary sums real input/output tokens and averages real duration across the window", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", automation: "A", ok: true, input_tokens: 500, output_tokens: 100, duration_ms: 2000, created_at: new Date().toISOString() },
      { account_id: "acct-1", automation: "A", ok: true, input_tokens: 300, output_tokens: 80, duration_ms: 1000, created_at: new Date().toISOString() },
    ],
  });
  const summary = await getByoUsageSummary(admin, "acct-1");
  assert.equal(summary.totalInputTokens, 800);
  assert.equal(summary.totalOutputTokens, 180);
  assert.equal(summary.avgDurationMs, 1500);
});

test("REQUIRED: an event with no recorded usage is skipped from the totals, never treated as 0", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", automation: "A", ok: true, input_tokens: 500, output_tokens: 100, duration_ms: 2000, created_at: new Date().toISOString() },
      { account_id: "acct-1", automation: "A", ok: true, input_tokens: null, output_tokens: null, duration_ms: null, created_at: new Date().toISOString() },
    ],
  });
  const summary = await getByoUsageSummary(admin, "acct-1");
  assert.equal(summary.totalCalls, 2, "the call itself still counts");
  assert.equal(summary.totalInputTokens, 500, "only the event that reported usage contributes");
  assert.equal(summary.avgDurationMs, 2000, "average is over samples that reported a duration, not all calls");
});

test("REQUIRED: totalInputTokens/totalOutputTokens/avgDurationMs are null (not 0) when NOTHING in the window reported usage", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", automation: "A", ok: true, created_at: new Date().toISOString() },
      { account_id: "acct-1", automation: "A", ok: false, created_at: new Date().toISOString() },
    ],
  });
  const summary = await getByoUsageSummary(admin, "acct-1");
  assert.equal(summary.totalCalls, 2);
  assert.equal(summary.totalInputTokens, null);
  assert.equal(summary.totalOutputTokens, null);
  assert.equal(summary.avgDurationMs, null);
});

test("REQUIRED: cross-account isolation -- one account's events never leak into another's summary", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [...ROWS_FOR_ACCT1, { account_id: "acct-2", automation: "NATURAL_CHATTER_ANSWER", ok: true, created_at: new Date().toISOString() }],
  });
  const summaryAcct2 = await getByoUsageSummary(admin, "acct-2");
  assert.equal(summaryAcct2.totalCalls, 1);
});

test("getByoUsageSummary never throws on a query error -- returns the empty summary", async () => {
  const admin = { from: () => ({ select: () => ({ eq: () => ({ gte: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }) } as unknown as Parameters<
    typeof getByoUsageSummary
  >[0];
  const summary = await getByoUsageSummary(admin, "acct-1");
  assert.deepEqual(summary, { totalCalls: 0, successfulCalls: 0, failedCalls: 0, totalInputTokens: null, totalOutputTokens: null, avgDurationMs: null, byAutomation: [], byCommunity: [], byDeployment: [] });
});

/* ------------------------------------------- getByoUsageSummary: byDeployment/byCommunity ---- */
// Phase 4.V.1 -- deployment-level attribution, closing part of the honest
// "still deferred" list (richer telemetry dimensions).

const ROWS_WITH_ATTRIBUTION: Row[] = [
  { account_id: "acct-1", automation: "NATURAL_CHATTER_ANSWER", community_id: "comm-1", deployment_id: "dep-1", ok: true, created_at: new Date().toISOString() },
  { account_id: "acct-1", automation: "NATURAL_CHATTER_ANSWER", community_id: "comm-1", deployment_id: "dep-1", ok: false, created_at: new Date().toISOString() },
  { account_id: "acct-1", automation: "WATCHER_PRESENCE", community_id: "comm-2", deployment_id: "dep-2", ok: true, created_at: new Date().toISOString() },
  // A pre-attribution event (migration 0093-era row, before deployment_id existed) -- must never be
  // bucketed under a fabricated "unknown" id, only omitted from byDeployment/byCommunity.
  { account_id: "acct-1", automation: "NATURAL_CHATTER_CASUAL_CHAT", community_id: null, deployment_id: null, ok: true, created_at: new Date().toISOString() },
];

test("REQUIRED: byDeployment groups real total/success/failure counts per deployment id", async () => {
  const admin = fakeAdmin({ watch_byo_ai_usage_events: ROWS_WITH_ATTRIBUTION });
  const summary = await getByoUsageSummary(admin, "acct-1");
  const dep1 = summary.byDeployment.find((d) => d.deploymentId === "dep-1");
  assert.equal(dep1?.total, 2);
  assert.equal(dep1?.successful, 1);
  assert.equal(dep1?.failed, 1);
  const dep2 = summary.byDeployment.find((d) => d.deploymentId === "dep-2");
  assert.equal(dep2?.total, 1);
  assert.equal(dep2?.successful, 1);
});

test("REQUIRED: byCommunity groups real total/success/failure counts per community id", async () => {
  const admin = fakeAdmin({ watch_byo_ai_usage_events: ROWS_WITH_ATTRIBUTION });
  const summary = await getByoUsageSummary(admin, "acct-1");
  const comm1 = summary.byCommunity.find((c) => c.communityId === "comm-1");
  assert.equal(comm1?.total, 2);
  const comm2 = summary.byCommunity.find((c) => c.communityId === "comm-2");
  assert.equal(comm2?.total, 1);
});

test("REQUIRED: events with no recorded deployment_id/community_id (pre-attribution) are omitted, never bucketed under a fabricated id", async () => {
  const admin = fakeAdmin({ watch_byo_ai_usage_events: ROWS_WITH_ATTRIBUTION });
  const summary = await getByoUsageSummary(admin, "acct-1");
  // 4 total rows, but only 3 carry real deployment/community attribution.
  assert.equal(summary.totalCalls, 4);
  const deploymentTotal = summary.byDeployment.reduce((s, d) => s + d.total, 0);
  const communityTotal = summary.byCommunity.reduce((s, c) => s + c.total, 0);
  assert.equal(deploymentTotal, 3);
  assert.equal(communityTotal, 3);
  assert.ok(!summary.byDeployment.some((d) => d.deploymentId === "null"));
  assert.ok(!summary.byCommunity.some((c) => c.communityId === "null"));
});

/* ----------------------------------------------------- getByoProviderHealth ---- */

test("REQUIRED: getByoProviderHealth reports the real last-success and last-error timestamps", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", ok: true, created_at: "2026-08-20T00:00:00.000Z" },
      { account_id: "acct-1", ok: true, created_at: "2026-08-24T00:00:00.000Z" }, // most recent success
      { account_id: "acct-1", ok: false, error: "timeout", created_at: "2026-08-22T00:00:00.000Z" },
    ],
  });
  const health = await getByoProviderHealth(admin, "acct-1");
  assert.equal(health.lastSuccessAt, "2026-08-24T00:00:00.000Z");
  assert.equal(health.lastErrorAt, "2026-08-22T00:00:00.000Z");
  assert.equal(health.lastError, "timeout");
});

test("getByoProviderHealth returns the empty/unknown state (never fabricates) for an account with nothing recorded", async () => {
  const admin = fakeAdmin({});
  const health = await getByoProviderHealth(admin, "acct-empty");
  assert.deepEqual(health, { lastSuccessAt: null, lastErrorAt: null, lastError: null, callsLast7Days: 0 });
});

test("REQUIRED: callsLast7Days counts every recorded call (success + failure), not only successes", async () => {
  const now = Date.now();
  const recent = (offsetDays: number) => new Date(now - offsetDays * 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", ok: true, created_at: recent(1) },
      { account_id: "acct-1", ok: false, created_at: recent(2) },
      { account_id: "acct-1", ok: true, created_at: recent(10) }, // outside the 7-day window
    ],
  });
  const health = await getByoProviderHealth(admin, "acct-1");
  assert.equal(health.callsLast7Days, 2);
});

test("REQUIRED: cross-account isolation -- one account's health never reflects another's calls", async () => {
  const admin = fakeAdmin({
    watch_byo_ai_usage_events: [
      { account_id: "acct-1", ok: true, created_at: new Date().toISOString() },
      { account_id: "acct-2", ok: false, error: "acct-2's own error", created_at: new Date().toISOString() },
    ],
  });
  const health = await getByoProviderHealth(admin, "acct-1");
  assert.equal(health.lastErrorAt, null, "acct-2's error must never leak into acct-1's health");
});

test("getByoProviderHealth never throws when the underlying query errors -- degrades to the empty state", async () => {
  const admin = { from: () => { throw new Error("connection reset"); } } as unknown as Parameters<typeof getByoProviderHealth>[0];
  const health = await getByoProviderHealth(admin, "acct-1");
  assert.deepEqual(health, { lastSuccessAt: null, lastErrorAt: null, lastError: null, callsLast7Days: 0 });
});
