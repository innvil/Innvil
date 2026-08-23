import { test } from "node:test";
import assert from "node:assert/strict";
import { recordByoUsageEvent, getByoUsageSummary } from "./watch-byo-usage";

/**
 * BYO Enterprise -- Phase 2 (2026-08-24) usage telemetry. A plain
 * call/outcome ledger -- never a fabricated token/cost figure -- see the
 * module's own doc comment for why per-call token counts are out of scope.
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
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        gte(col: string, val: string) { filters.push((r) => String(r[col]) >= val); return builder; },
        then(resolve: (v: { data: Row[] | null; error: null }) => void) {
          resolve({ data: (store[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
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

test("communityId/error default to null when omitted", async () => {
  const admin = fakeAdmin({});
  await recordByoUsageEvent(admin, { accountId: "acct-1", automation: "x", provider: "anthropic", model: "m", ok: true });
  const row = admin.__store.watch_byo_ai_usage_events[0];
  assert.equal(row.community_id, null);
  assert.equal(row.error, null);
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
  assert.deepEqual(summary, { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byAutomation: [] });
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
  assert.deepEqual(summary, { totalCalls: 0, successfulCalls: 0, failedCalls: 0, byAutomation: [] });
});
