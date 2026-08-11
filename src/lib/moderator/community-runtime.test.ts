import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateUpdate, resolveEventOrigin, isRecentMessage, RECENT_EXCHANGE_WINDOW_MS, humanRecentlyResponded,
  reactiveQuotaDay, hasReactiveQuotaRemaining, recordReactiveQuotaUse,
  raceWithTimeout, createRequestTimer,
} from "./community-runtime";

/** Minimal fake mimicking ONLY the .from(table).insert(row) shape
 *  isDuplicateUpdate uses, enforcing a real (integration_id, update_id)
 *  uniqueness constraint in-memory — enough to prove the dedup logic without
 *  a live Supabase project. */
function fakeAdminWithUniqueInsert() {
  const seen = new Set<string>();
  return {
    from(_table: string) {
      return {
        insert(row: { integration_id: string; update_id: number }) {
          const key = `${row.integration_id}:${row.update_id}`;
          if (seen.has(key)) return Promise.resolve({ error: { code: "23505", message: "duplicate key value violates unique constraint" } });
          seen.add(key);
          return Promise.resolve({ error: null });
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("Case 9: same Telegram update_id delivered twice -> first call is new, second is detected as duplicate", async () => {
  const admin = fakeAdminWithUniqueInsert();
  const first = await isDuplicateUpdate(admin, "integration-1", 555);
  const second = await isDuplicateUpdate(admin, "integration-1", 555);
  assert.equal(first, false); // not a duplicate the first time
  assert.equal(second, true); // duplicate on retry -> caller must skip processing
});

test("different update_id on the same integration is NOT a duplicate", async () => {
  const admin = fakeAdminWithUniqueInsert();
  assert.equal(await isDuplicateUpdate(admin, "integration-1", 1), false);
  assert.equal(await isDuplicateUpdate(admin, "integration-1", 2), false);
});

test("same update_id on a DIFFERENT integration is NOT a duplicate (dedup is per-bot, not global)", async () => {
  const admin = fakeAdminWithUniqueInsert();
  assert.equal(await isDuplicateUpdate(admin, "integration-1", 555), false);
  assert.equal(await isDuplicateUpdate(admin, "integration-2", 555), false);
});

test("missing update_id lets the event through rather than silently dropping it", async () => {
  const admin = fakeAdminWithUniqueInsert();
  assert.equal(await isDuplicateUpdate(admin, "integration-1", undefined), false);
});

/* resolveEventOrigin — the bot-ack loop-prevention fix. Fakes the
 * .select().eq().eq().not().order().limit().maybeSingle() chain over an
 * in-memory row set, filtering the same way the real query does: matching
 * community_id + platform_message_id, origin not null, oldest first. */
interface FakeRow {
  community_id: string;
  platform_message_id: string;
  origin: string | null;
  interaction_depth: number;
  created_at: string;
}

function fakeAdminWithRows(rows: FakeRow[]) {
  return {
    from(_table: string) {
      const filters: { communityId?: string; platformMessageId?: string; requireOriginNotNull?: boolean } = {};
      const api = {
        select() { return api; },
        eq(column: string, value: string) {
          if (column === "community_id") filters.communityId = value;
          if (column === "platform_message_id") filters.platformMessageId = value;
          return api;
        },
        not(column: string, _op: string, _value: unknown) {
          if (column === "origin") filters.requireOriginNotNull = true;
          return api;
        },
        order() { return api; },
        limit() { return api; },
        async maybeSingle() {
          const matches = rows
            .filter((r) => r.community_id === filters.communityId && r.platform_message_id === filters.platformMessageId)
            .filter((r) => !filters.requireOriginNotNull || r.origin !== null)
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          return { data: matches[0] ?? null, error: null };
        },
      };
      return api;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
  } as any;
}

test("resolveEventOrigin: no matching row -> defaults to HUMAN/depth 0", async () => {
  const admin = fakeAdminWithRows([]);
  const result = await resolveEventOrigin(admin, "community-1", "100");
  assert.deepEqual(result, { origin: "HUMAN", interactionDepth: 0 });
});

test("resolveEventOrigin: an ordinary recorded message (origin null, e.g. human/chatter) -> still defaults to HUMAN/0", async () => {
  const admin = fakeAdminWithRows([
    { community_id: "community-1", platform_message_id: "100", origin: null, interaction_depth: 0, created_at: "2026-01-01T00:00:00Z" },
  ]);
  const result = await resolveEventOrigin(admin, "community-1", "100");
  assert.deepEqual(result, { origin: "HUMAN", interactionDepth: 0 });
});

test("resolveEventOrigin: a tracked bot-ack reply -> resolves its real origin/depth (this is the loop-prevention fix)", async () => {
  const admin = fakeAdminWithRows([
    { community_id: "community-1", platform_message_id: "200", origin: "BOT_ACK", interaction_depth: 1, created_at: "2026-01-01T00:00:00Z" },
  ]);
  const result = await resolveEventOrigin(admin, "community-1", "200");
  assert.deepEqual(result, { origin: "BOT_ACK", interactionDepth: 1 });
});

test("resolveEventOrigin: does not leak a match from a different community", async () => {
  const admin = fakeAdminWithRows([
    { community_id: "community-OTHER", platform_message_id: "200", origin: "BOT_ACK", interaction_depth: 1, created_at: "2026-01-01T00:00:00Z" },
  ]);
  const result = await resolveEventOrigin(admin, "community-1", "200");
  assert.deepEqual(result, { origin: "HUMAN", interactionDepth: 0 });
});

/* ------------------------------------------ isRecentMessage staleness guard ---- */
// Live bug: "hey guys 👋" sent 95 minutes after the previous message (a
// moderator reply) was silenced with reason "already_handled" -- the runtime
// treated "the last message happens to be from a moderator" as "the room is
// mid an active exchange" with NO regard for how much time had actually
// passed. isRecentMessage is the fix: recentlyAnsweredByModerator /
// recentlyRespondedByHuman / wasLastSpeaker now all additionally require the
// prior message to be within RECENT_EXCHANGE_WINDOW_MS.

test('REQUIRED (live bug repro): a prior message 95 minutes old is NOT "recent" -- a new community opener must not be silenced as already_handled', () => {
  const now = new Date("2026-08-10T01:34:26Z");
  const priorMessageAt = new Date("2026-08-09T23:59:40Z"); // 94m46s earlier
  assert.equal(isRecentMessage(priorMessageAt.toISOString(), now), false);
});

test("a prior message from 30 seconds ago IS recent -- an active back-and-forth is still treated as active", () => {
  const now = new Date("2026-08-10T01:34:26Z");
  const priorMessageAt = new Date(now.getTime() - 30_000);
  assert.equal(isRecentMessage(priorMessageAt.toISOString(), now), true);
});

test("exactly at the window boundary is NOT recent (strict less-than)", () => {
  const now = new Date("2026-08-10T01:34:26Z");
  const priorMessageAt = new Date(now.getTime() - RECENT_EXCHANGE_WINDOW_MS);
  assert.equal(isRecentMessage(priorMessageAt.toISOString(), now), false);
});

test("one second inside the window boundary IS recent", () => {
  const now = new Date("2026-08-10T01:34:26Z");
  const priorMessageAt = new Date(now.getTime() - RECENT_EXCHANGE_WINDOW_MS + 1000);
  assert.equal(isRecentMessage(priorMessageAt.toISOString(), now), true);
});

test("no prior message (null/undefined createdAt) is never treated as recent", () => {
  const now = new Date();
  assert.equal(isRecentMessage(null, now), false);
  assert.equal(isRecentMessage(undefined, now), false);
});

/* ------------------------------------------- humanRecentlyResponded ---- */
// Live bug: "anyone here?" sent 16 seconds after the SAME person's own
// unanswered "yo! what's up" was silenced with reason "already_handled" --
// nothing had actually been handled, the prior message just happened to
// also be from a human. Fixed by requiring the prior human message to be
// from a DIFFERENT person, not merely "human."

test('REQUIRED (live bug repro): the SAME person\'s own unanswered prior message does NOT count as "already responded"', () => {
  const now = new Date("2026-08-10T06:16:05Z");
  const priorMessage = { senderType: "HUMAN", senderPlatformId: "user-K", createdAt: new Date(now.getTime() - 16_000).toISOString() };
  assert.equal(humanRecentlyResponded(priorMessage, "user-K", now), false);
});

test("REQUIRED: a DIFFERENT person's recent message DOES count as already responded", () => {
  const now = new Date("2026-08-10T06:16:05Z");
  const priorMessage = { senderType: "HUMAN", senderPlatformId: "user-OTHER", createdAt: new Date(now.getTime() - 16_000).toISOString() };
  assert.equal(humanRecentlyResponded(priorMessage, "user-K", now), true);
});

test("a moderator's prior message never counts as humanRecentlyResponded (that's recentlyAnsweredByModerator's job)", () => {
  const now = new Date();
  const priorMessage = { senderType: "INNVIL_MODERATOR", senderPlatformId: null, createdAt: now.toISOString() };
  assert.equal(humanRecentlyResponded(priorMessage, "user-K", now), false);
});

test("a stale prior message from a different person is not recent enough to count", () => {
  const now = new Date("2026-08-10T06:16:05Z");
  const priorMessage = { senderType: "HUMAN", senderPlatformId: "user-OTHER", createdAt: new Date(now.getTime() - 95 * 60_000).toISOString() };
  assert.equal(humanRecentlyResponded(priorMessage, "user-K", now), false);
});

test("no prior message at all -> false", () => {
  assert.equal(humanRecentlyResponded(null, "user-K", new Date()), false);
});

/* ------------------------------------------ trial reactive quota (Phase 4.M B) ---- */
// 20 successfully-executed reactive conversational text responses
// (CASUAL_CHAT/ANSWER/SHORT_ACK) per community per local community day,
// trial only -- checked BEFORE AI generation, consumed only after a
// successful send.

test("reactiveQuotaDay: formats as a UTC calendar date (YYYY-MM-DD)", () => {
  assert.equal(reactiveQuotaDay(new Date("2026-08-10T23:59:59Z")), "2026-08-10");
  assert.equal(reactiveQuotaDay(new Date("2026-08-11T00:00:00Z")), "2026-08-11");
});

/** Fake mimicking .from("community_reactive_quota").select().eq().eq().maybeSingle()
 *  over an in-memory row, plus .rpc() for the atomic increment -- records
 *  every rpc call so tests can assert on what was actually sent. */
function fakeQuotaAdmin(existingCount: number | null) {
  const rpcCalls: Array<{ name: string; params: unknown }> = [];
  const admin = {
    from(_table: string) {
      const api = {
        select() { return api; },
        eq() { return api; },
        async maybeSingle() {
          return { data: existingCount === null ? null : { reactive_count: existingCount }, error: null };
        },
      };
      return api;
    },
    async rpc(name: string, params: unknown) {
      rpcCalls.push({ name, params });
      return { data: null, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { admin, rpcCalls };
}

test("REQUIRED: no usage recorded yet (no row) -> quota remaining", async () => {
  const { admin } = fakeQuotaAdmin(null);
  assert.equal(await hasReactiveQuotaRemaining(admin, "community-1", "2026-08-10"), true);
});

test("REQUIRED: under the 20/day limit -> quota remaining", async () => {
  const { admin } = fakeQuotaAdmin(19);
  assert.equal(await hasReactiveQuotaRemaining(admin, "community-1", "2026-08-10"), true);
});

test("REQUIRED: exactly at the 20/day limit -> exhausted", async () => {
  const { admin } = fakeQuotaAdmin(20);
  assert.equal(await hasReactiveQuotaRemaining(admin, "community-1", "2026-08-10"), false);
});

test("over the limit (e.g. from a race-condition overshoot) -> still exhausted", async () => {
  const { admin } = fakeQuotaAdmin(21);
  assert.equal(await hasReactiveQuotaRemaining(admin, "community-1", "2026-08-10"), false);
});

test("REQUIRED: recordReactiveQuotaUse calls the atomic increment RPC with the right scoping params", async () => {
  const { admin, rpcCalls } = fakeQuotaAdmin(0);
  await recordReactiveQuotaUse(admin, "panel-1", "community-1", "2026-08-10");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "increment_community_reactive_quota");
  assert.deepEqual(rpcCalls[0].params, { p_panel_id: "panel-1", p_community_id: "community-1", p_quota_day: "2026-08-10" });
});

/* ================================== timeout/budget hardening (live incident) ==========
   Live incident: a webhook was killed at the platform's 30s maxDuration with
   ZERO trace -- the message was recorded but no activity_log row existed
   anywhere, because the function died mid-generation before reaching any
   log call. Root cause (fixed separately in src/lib/ai/client.ts) was a
   stalled response BODY outside the old abort scope. raceWithTimeout is the
   community-runtime-layer safety net wrapped around the generation call as
   defense in depth -- these tests prove ITS contract in isolation, matching
   this file's established convention of testing exported pure/async
   utilities directly rather than the full DB-backed webhook flow. ================ */

// Mirrors community-runtime.ts's own (private) CHATTER_TOTAL_BUDGET_MS --
// 12s model timeout < this < 30s platform maxDuration.
const CHATTER_TOTAL_BUDGET_MS_FOR_TEST = 20_000;

test("REQUIRED: successful chatter -- a promise that resolves before the budget wins the race", async () => {
  const result = await raceWithTimeout(Promise.resolve("real reply"), 5_000);
  assert.deepEqual(result, { ok: true, value: "real reply" });
});

test("REQUIRED: slow/stalled provider -- a promise that never resolves is bounded by the budget, not left hanging", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const neverResolves = new Promise<string>(() => {});
  const racePromise = raceWithTimeout(neverResolves, 20_000);
  // Fake timers make this instant -- no real 20-second wait.
  t.mock.timers.tick(20_000);
  const result = await racePromise;
  assert.deepEqual(result, { ok: false });
});

test("REQUIRED: total budget -- a stage far slower than the budget still resolves at the budget boundary, never past it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Simulates a stage (e.g. a stalled model call) that would take far
  // longer than any reasonable budget if left unbounded.
  const slowStage = new Promise<string>((resolve) => {
    setTimeout(() => resolve("too slow"), 45_000);
  });
  const racePromise = raceWithTimeout(slowStage, CHATTER_TOTAL_BUDGET_MS_FOR_TEST);
  t.mock.timers.tick(CHATTER_TOTAL_BUDGET_MS_FOR_TEST);
  const result = await racePromise;
  assert.deepEqual(result, { ok: false }, "must resolve as timed-out at the budget, not wait for the slower inner stage");
});

test("provider failure -- a promise that rejects propagates as a rejection, not swallowed as a silent timeout", async () => {
  const failing = Promise.reject(new Error("provider 500"));
  await assert.rejects(raceWithTimeout(failing, 5_000), /provider 500/);
});

test("REQUIRED: no Sonnet fallback on timeout -- raceWithTimeout itself carries no provider/model info to fall back through", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  // Structural proof: the timed-out branch carries no value/model/provider
  // info at all -- there is nothing for a caller to silently "fall back"
  // through even if it wanted to; it only ever gets {ok:false}.
  const neverResolves = new Promise<string>(() => {});
  const racePromise = raceWithTimeout(neverResolves, 1_000);
  t.mock.timers.tick(1_000);
  const result = await racePromise;
  assert.deepEqual(Object.keys(result), ["ok"]);
});

test("createRequestTimer logs a structured checkpoint per mark(), including elapsed-since-start", () => {
  const originalLog = console.log;
  const logs: unknown[] = [];
  console.log = (...args: unknown[]) => { logs.push(args); };
  try {
    const timer = createRequestTimer("integration-123");
    timer.mark("webhook_received");
    timer.mark("duplicate_update_check", { isDuplicate: false });
    assert.equal(logs.length, 2);
    const [tag1, payload1] = logs[0] as [string, string];
    assert.equal(tag1, "[chatter-timing]");
    const parsed1 = JSON.parse(payload1);
    assert.equal(parsed1.integrationId, "integration-123");
    assert.equal(parsed1.label, "webhook_received");
    assert.equal(typeof parsed1.deltaMs, "number");
    assert.equal(typeof parsed1.totalMs, "number");
    const parsed2 = JSON.parse((logs[1] as [string, string])[1]);
    assert.equal(parsed2.label, "duplicate_update_check");
    assert.equal(parsed2.isDuplicate, false);
  } finally {
    console.log = originalLog;
  }
});

test("createRequestTimer never logs message text/prompt/secret content -- only label + timing + explicitly-passed small metadata", () => {
  const originalLog = console.log;
  const logs: unknown[] = [];
  console.log = (...args: unknown[]) => { logs.push(args); };
  try {
    const timer = createRequestTimer("integration-123");
    timer.mark("coordinator_action_selected", { actionType: "CASUAL_CHAT" });
    const parsed = JSON.parse((logs[0] as [string, string])[1]);
    assert.deepEqual(Object.keys(parsed).sort(), ["actionType", "deltaMs", "integrationId", "label", "totalMs"]);
  } finally {
    console.log = originalLog;
  }
});
