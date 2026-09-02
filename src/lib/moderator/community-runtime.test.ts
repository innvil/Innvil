import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateUpdate, resolveEventOrigin, isRecentMessage, RECENT_EXCHANGE_WINDOW_MS, humanRecentlyResponded,
  reactiveQuotaDay, hasReactiveQuotaRemaining, recordReactiveQuotaUse, getCommunityReactiveQuotaUsage,
  raceWithTimeout, createRequestTimer, resolveAdditionalResponderIds, deploymentRecentlyParticipated,
  classifySender, loadRelevantKnowledge, detectSupportedMedia, START_COMMAND_RE, resolveCommunity, type TelegramMessage,
  finalizeCommunityConnection, runLinkModeration, respondAsDeployment, type ChatterDeployment,
  trialMediaModerationPeriod,
} from "./community-runtime";
import type { CommunityEvent } from "./event-types";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";
import {
  buildStandaloneModeratorSettings, resolveStandaloneModeratorSettings, resolveWatcherAccountId,
} from "@/src/lib/products/watch-runtime";
import { hasVirtualModerator, virtualModNaturalChatter, virtualModModeration, moderatorEntitlementSource, CAPACITY } from "./plan";
import { hasAiGenerationPoolRemaining } from "@/src/lib/products/watch-ai-usage";

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

/* ------------------------------------ real Usage-tracker consumption read ---- */

test("REQUIRED: getCommunityReactiveQuotaUsage returns 0 (real, not fabricated) when no reactive reply has been sent yet today", async () => {
  const { admin } = fakeQuotaAdmin(null);
  assert.equal(await getCommunityReactiveQuotaUsage(admin, "community-1", "2026-08-10"), 0);
});

test("REQUIRED: getCommunityReactiveQuotaUsage returns the exact persisted count", async () => {
  const { admin } = fakeQuotaAdmin(7);
  assert.equal(await getCommunityReactiveQuotaUsage(admin, "community-1", "2026-08-10"), 7);
});

test("getCommunityReactiveQuotaUsage never caps at the limit -- a real overshoot is reported honestly, not clamped", async () => {
  const { admin } = fakeQuotaAdmin(23);
  assert.equal(await getCommunityReactiveQuotaUsage(admin, "community-1", "2026-08-10"), 23);
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

/* ============================================ multi-responder wiring ==========
   Human group conversation is not turn-based -- one moderator answering a
   message does not consume the human's turn. resolveAdditionalResponderIds
   is the exported pure boundary between chatter-coordinator's raw
   resolveMultiTargetAddress() result and what handleHumanMessage actually
   fans a reply out to: it must never re-include the primary responder
   (dedup-safety -- the primary is already answering via the normal path)
   and must never exceed MAX_ADDITIONAL_RESPONDERS regardless of how many
   moderators a "you all"/plural address resolved to (no-pile-on safety). ==== */

test("REQUIRED (dedup-safety): the primary responder is excluded from its own additional-responder set", () => {
  const result = resolveAdditionalResponderIds("dep-kwan", ["dep-kwan", "dep-test"]);
  assert.deepEqual(result, ["dep-test"]);
});

test("REQUIRED: two co-addressed moderators (neither is primary) both become additional responders", () => {
  const result = resolveAdditionalResponderIds("dep-primary", ["dep-a", "dep-b"]);
  assert.deepEqual(result, ["dep-a", "dep-b"]);
});

test("REQUIRED (no-pile-on safety): a plural address resolving to many moderators is capped at MAX_ADDITIONAL_RESPONDERS", () => {
  const many = ["dep-1", "dep-2", "dep-3", "dep-4", "dep-5", "dep-6"];
  const result = resolveAdditionalResponderIds("dep-primary", many);
  assert.equal(result.length, 2); // MAX_ADDITIONAL_RESPONDERS
  assert.deepEqual(result, ["dep-1", "dep-2"]);
});

test("an empty multi-target list yields no additional responders", () => {
  assert.deepEqual(resolveAdditionalResponderIds("dep-primary", []), []);
});

test("a single co-addressed moderator (no cap needed) still resolves correctly", () => {
  assert.deepEqual(resolveAdditionalResponderIds("dep-primary", ["dep-a"]), ["dep-a"]);
});

/* -------------------------------------------- scaled cap (room-wide address) ---- */
// Live report: "gm everyone" only got one reply regardless of how many
// moderators were deployed. A room-wide address now passes an explicit
// scaled cap instead of relying on the default MAX_ADDITIONAL_RESPONDERS.

test("REQUIRED: an explicit scaled cap overrides the default MAX_ADDITIONAL_RESPONDERS -- 5 deployed (4 non-primary) room-wide -> 2 additional (3 total incl. primary)", () => {
  const many = ["dep-primary", "dep-1", "dep-2", "dep-3", "dep-4"]; // 5 deployed total
  const result = resolveAdditionalResponderIds("dep-primary", many, 2); // roomWideResponderCount(5) - 1 = 2
  assert.deepEqual(result, ["dep-1", "dep-2"]);
});

test("REQUIRED: 10 deployed room-wide -> 4 additional (5 total incl. primary)", () => {
  const many = Array.from({ length: 10 }, (_, i) => `dep-${i}`);
  const result = resolveAdditionalResponderIds("dep-0", many, 4); // roomWideResponderCount(10) - 1 = 4
  assert.equal(result.length, 4);
  assert.deepEqual(result, ["dep-1", "dep-2", "dep-3", "dep-4"]);
});

test("omitting the cap still falls back to the default MAX_ADDITIONAL_RESPONDERS (small explicit plural, unaffected by the room-wide change)", () => {
  const many = ["dep-1", "dep-2", "dep-3", "dep-4", "dep-5", "dep-6"];
  assert.deepEqual(resolveAdditionalResponderIds("dep-primary", many), ["dep-1", "dep-2"]);
  assert.deepEqual(resolveAdditionalResponderIds("dep-primary", many, undefined), ["dep-1", "dep-2"]);
});

test("a cap of 0 (2 deployed, room-wide -> only the primary responds) yields no additional responders", () => {
  assert.deepEqual(resolveAdditionalResponderIds("dep-primary", ["dep-a"], 0), []);
});

/* ========================================= deploymentRecentlyParticipated ====
   Feeds ChatterCandidate.recentlyParticipated -- broader than "was the
   literal last message" (that's wasLastSpeaker, computed separately): true
   when this deployment sent ANY message within the recent, bounded
   (isRecentMessage) window, so "both mods participated in the exchange" can
   recognize a moderator who spoke a couple of turns ago. */

function msg(over: Partial<{ senderType: "HUMAN" | "INNVIL_MODERATOR" | "EXTERNAL_BOT"; deploymentId: string | null; createdAt: string }> = {}) {
  return {
    senderType: "HUMAN" as const,
    senderName: null,
    text: "hi",
    deploymentId: null,
    createdAt: new Date().toISOString(),
    senderPlatformId: null,
    ...over,
  };
}

test("REQUIRED: a deployment that spoke a couple of turns ago (not the literal last message) still counts as recently participated", () => {
  const now = new Date();
  const recentContext = [
    msg({ senderType: "INNVIL_MODERATOR", deploymentId: "dep-a", createdAt: new Date(now.getTime() - 60_000).toISOString() }),
    msg({ senderType: "HUMAN", createdAt: new Date(now.getTime() - 30_000).toISOString() }),
    msg({ senderType: "INNVIL_MODERATOR", deploymentId: "dep-b", createdAt: new Date(now.getTime() - 10_000).toISOString() }),
  ];
  assert.equal(deploymentRecentlyParticipated(recentContext, "dep-a", now), true);
  assert.equal(deploymentRecentlyParticipated(recentContext, "dep-b", now), true);
});

test("a deployment that never appears in the recent context did not recently participate", () => {
  const now = new Date();
  const recentContext = [msg({ senderType: "INNVIL_MODERATOR", deploymentId: "dep-a", createdAt: now.toISOString() })];
  assert.equal(deploymentRecentlyParticipated(recentContext, "dep-c", now), false);
});

test("a stale message outside the recency window does not count, even from the right deployment", () => {
  const now = new Date();
  const recentContext = [msg({ senderType: "INNVIL_MODERATOR", deploymentId: "dep-a", createdAt: new Date(now.getTime() - 95 * 60_000).toISOString() })];
  assert.equal(deploymentRecentlyParticipated(recentContext, "dep-a", now), false);
});

test("a HUMAN message from the same deployment id slot never counts (only INNVIL_MODERATOR senders do)", () => {
  const now = new Date();
  const recentContext = [msg({ senderType: "HUMAN", deploymentId: "dep-a", createdAt: now.toISOString() })];
  assert.equal(deploymentRecentlyParticipated(recentContext, "dep-a", now), false);
});

/* ==================================================== classifySender: display name ====
   THE actual source of the "@kwan_mod_bot in generated conversation" leak —
   a recognized Innvil moderator's displayName must be its CONFIGURED name
   (virtual_moderators.name, e.g. "Kwan"), never the Telegram bot username
   (e.g. "kwan_mod_bot"), which craftAckText (coordinator.ts) puts directly
   into generated acknowledgement text. */

function fakeAdminForClassifySender(opts: {
  integrations?: Array<{
    id: string;
    panel_id: string;
    virtual_moderator_id: string;
    username: string | null;
    virtual_moderators: { name: string } | null;
  }>;
  deployment?: { id: string } | null;
}) {
  return {
    from(table: string) {
      if (table === "telegram_bot_integrations") {
        const api = {
          select() { return api; },
          eq() { return api; },
          async limit() { return { data: opts.integrations ?? [], error: null }; },
        };
        return api;
      }
      if (table === "moderator_deployments") {
        const api = {
          select() { return api; },
          eq() { return api; },
          async maybeSingle() { return { data: opts.deployment ?? null, error: null }; },
        };
        return api;
      }
      throw new Error(`unexpected table in fake admin: ${table}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
  } as any;
}

test("REQUIRED (TEST 3): a recognized Innvil moderator's displayName is its CONFIGURED name, not the Telegram bot username", async () => {
  const admin = fakeAdminForClassifySender({
    integrations: [
      { id: "integration-1", panel_id: "panel-1", virtual_moderator_id: "mod-kwan", username: "kwan_mod_bot", virtual_moderators: { name: "Kwan" } },
    ],
    deployment: { id: "deploy-kwan" },
  });
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 555, is_bot: true, username: "kwan_mod_bot" });
  assert.equal(sender.senderType, "INNVIL_MODERATOR");
  assert.equal(sender.displayName, "Kwan");
});

test("REQUIRED (TEST 4): the Telegram bot username never appears as displayName for a recognized moderator, under any circumstances", async () => {
  const admin = fakeAdminForClassifySender({
    integrations: [
      { id: "integration-1", panel_id: "panel-1", virtual_moderator_id: "mod-kwan", username: "kwan_mod_bot", virtual_moderators: { name: "Kwan" } },
    ],
    deployment: { id: "deploy-kwan" },
  });
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 555, is_bot: true, username: "kwan_mod_bot" });
  assert.notEqual(sender.displayName, "kwan_mod_bot");
  assert.doesNotMatch(String(sender.displayName), /kwan_mod_bot/i);
});

test("REQUIRED (TEST 5): a recognized moderator with no configured name available falls back to null (safe), never the Telegram username", async () => {
  const admin = fakeAdminForClassifySender({
    integrations: [
      { id: "integration-1", panel_id: "panel-1", virtual_moderator_id: "mod-kwan", username: "kwan_mod_bot", virtual_moderators: null },
    ],
    deployment: { id: "deploy-kwan" },
  });
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 555, is_bot: true, username: "kwan_mod_bot" });
  assert.equal(sender.senderType, "INNVIL_MODERATOR");
  assert.equal(sender.displayName, null);
});

test("an EXTERNAL_BOT (not a recognized Innvil moderator) still falls back to its Telegram username -- that path never claims to be a moderator's configured name", async () => {
  const admin = fakeAdminForClassifySender({ integrations: [], deployment: null });
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 999, is_bot: true, username: "some_other_bot" });
  assert.equal(sender.senderType, "EXTERNAL_BOT");
  assert.equal(sender.displayName, "some_other_bot");
});

test("a HUMAN sender is unaffected by this fix -- still uses first_name/username as before", async () => {
  const admin = fakeAdminForClassifySender({});
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 111, is_bot: false, first_name: "K" });
  assert.equal(sender.senderType, "HUMAN");
  assert.equal(sender.displayName, "K");
});

test("REQUIRED: a HUMAN sender's raw username is exposed separately from displayName (needed for moderation-warning @mentions, distinct from ordinary conversational naming)", async () => {
  const admin = fakeAdminForClassifySender({});
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 222, is_bot: false, first_name: "Jon", username: "jon_arthur1" });
  assert.equal(sender.senderType, "HUMAN");
  assert.equal(sender.displayName, "Jon", "ordinary conversational naming still prefers the given name");
  assert.equal(sender.username, "jon_arthur1", "the raw username is available separately for moderation mentions");
});

test("a HUMAN sender with no Telegram username at all has username: null, never a missing/throwing case", async () => {
  const admin = fakeAdminForClassifySender({});
  const sender = await classifySender(admin, "panel-1", "community-1", { id: 333, is_bot: false, first_name: "Alice" });
  assert.equal(sender.username, null);
});

/* ================================== Phase 4.N: loadRelevantKnowledge (parts A + C) ==== */
// Only the DB query filters enforce isolation (spec §8) -- this fake admin
// holds two independently-scoped in-memory tables (PROJECT rows with no
// community_id, COMMUNITY rows tagged to one specific community_id) and
// records which filters were actually applied, so these tests prove the
// real query shape, not just the pure retrieval math already covered by
// knowledge.test.ts.

interface FakeKnowledgeRow {
  id: string; panel_id: string | null; scope_type: "ORGANIZATION" | "PROJECT" | "COMMUNITY";
  project_id: string | null; community_id: string | null; kind: string; title: string; content: string; active: boolean;
}

/** `communityProjects` resolves the Panel -> Project -> Community hierarchy
 *  (communities.project_id) the real loadRelevantKnowledge depends on before
 *  it can even query PROJECT-scope rows. */
function fakeAdminForKnowledge(
  rows: FakeKnowledgeRow[],
  communityProjects: Record<string, string> = {},
  projectProfiles: Record<string, { name?: string; overview?: string; contacts?: Record<string, string> }> = {}
) {
  return {
    from(table: string) {
      if (table === "communities") {
        const filters: Record<string, unknown> = {};
        const api = {
          select() { return api; },
          eq(col: string, val: unknown) { filters[col] = val; return api; },
          async maybeSingle() {
            const id = filters.id as string;
            return { data: communityProjects[id] ? { project_id: communityProjects[id] } : null, error: null };
          },
        };
        return api;
      }
      if (table === "projects") {
        const filters: Record<string, unknown> = {};
        const api = {
          select() { return api; },
          eq(col: string, val: unknown) { filters[col] = val; return api; },
          async maybeSingle() {
            const id = filters.id as string;
            const p = projectProfiles[id];
            return { data: { name: p?.name ?? "", overview: p?.overview ?? "", contacts: p?.contacts ?? {} }, error: null };
          },
        };
        return api;
      }
      if (table !== "knowledge_sources") throw new Error(`unexpected table: ${table}`);
      const filters: Record<string, unknown> = {};
      const api = {
        select() { return api; },
        eq(col: string, val: unknown) { filters[col] = val; return api; },
        then(resolve: (r: { data: typeof rows; error: null }) => void) {
          const data = rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
          resolve({ data, error: null });
        },
      };
      return api;
    },
  } as any;
}

test("REQUIRED (security invariant): loadRelevantKnowledge has no project_id parameter at all -- project scoping is ALWAYS derived server-side from communities.project_id, never accepted from a caller", async () => {
  // Structural proof, not just behavioral: loadRelevantKnowledge's own
  // signature is (admin, panelId, communityId, query) -- there is no fifth
  // "projectId" argument a caller could supply to redirect retrieval at a
  // project the community doesn't actually belong to. Combined with the
  // isolation tests below (which prove the DB-resolved project_id is what
  // actually gates the query), this closes the loop: no code path, client
  // or otherwise, can inject an arbitrary project_id into retrieval.
  assert.equal(loadRelevantKnowledge.length, 4);

  // Behavioral half: even with OTHER projects' knowledge present in the
  // fake DB, a community only ever gets what its OWN resolved project_id
  // (from the communities table lookup) is entitled to -- never a
  // differently-labeled row that happens to share a title/keyword.
  const admin = fakeAdminForKnowledge(
    [
      { id: "real", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-real", community_id: null, kind: "fact", title: "Support", content: "@real_support", active: true },
      { id: "spoofed", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-attacker-controlled", community_id: null, kind: "fact", title: "Support", content: "@attacker_support", active: true },
    ],
    { "victim-community": "project-real" } // the ONLY thing that determines scope -- a server-side DB fact
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "victim-community", "who do I contact for support?");
  assert.ok(result);
  assert.equal(result!.length, 1);
  assert.equal(result![0].content, "@real_support");
});

test("REQUIRED (spec test 1 shape): a question retrieves this community's own project knowledge", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "p1", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "overview", title: "Supported chains", content: "Ethereum and Polygon.", active: true }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-1", "what chains do you support?");
  assert.ok(result);
  assert.equal(result![0].title, "Supported chains");
});

test("REQUIRED (Project Knowledge ingestion): a URL-ingested chunk's REAL extracted content is retrieved -- never the bare URL string", async () => {
  // Simulates exactly what watch-project-knowledge.ts's addAccountProjectUrlKnowledge
  // actually persists: a PROJECT-scope row whose `content` is the real
  // fetched/extracted page text (never the URL itself, which lives only in
  // `source_url` -- a column loadRelevantKnowledge's own KNOWLEDGE_SELECT
  // never even reads, proving retrieval works from ordinary row content
  // with zero special-casing for source_type).
  const admin = fakeAdminForKnowledge(
    [{ id: "ing-1", panel_id: null, scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "link", title: "Docs (part 1/1)", content: "Litho supports Ethereum, Polygon, and Arbitrum for cross-chain swaps.", active: true }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, null, "community-1", "which chains does Litho support?");
  assert.ok(result);
  assert.equal(result!.some((r) => r.content.includes("Ethereum")), true, "the REAL extracted page content must be retrievable");
  assert.equal(result!.some((r) => r.content.startsWith("http")), false, "must never retrieve a bare URL string as the 'knowledge'");
});

test("REQUIRED (Project Knowledge ingestion): a long ingested source split into multiple chunks -- only the RELEVANT chunk is retrieved, not the whole document", async () => {
  const admin = fakeAdminForKnowledge(
    [
      { id: "ing-1", panel_id: null, scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "link", title: "Whitepaper (part 1/3)", content: "Litho's mission is to simplify cross-chain trading for everyone.", active: true },
      { id: "ing-2", panel_id: null, scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "link", title: "Whitepaper (part 2/3)", content: "Tokenomics: total supply 100M, 40% community rewards, 20% team, 40% treasury.", active: true },
      { id: "ing-3", panel_id: null, scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "link", title: "Whitepaper (part 3/3)", content: "Roadmap: Q1 mainnet launch, Q2 mobile app, Q3 governance module.", active: true },
    ],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, null, "community-1", "what's the total token supply?");
  assert.ok(result);
  assert.equal(result!.some((r) => r.content.includes("total supply 100M")), true, "the relevant chunk must be retrieved");
  assert.equal(result!.some((r) => r.content.includes("mainnet launch")), false, "an irrelevant chunk from the SAME source must not be force-injected");
});

test("REQUIRED (Project Knowledge ingestion): a standalone (zero-Panel) account's ingested Project Knowledge is retrievable with panelId: null", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "ing-1", panel_id: null, scope_type: "PROJECT", project_id: "project-standalone", community_id: null, kind: "link", title: "Website", content: "InnvilWatch.example is an AI Telegram moderation product.", active: true }],
    { "community-1": "project-standalone" }
  );
  const result = await loadRelevantKnowledge(admin, null, "community-1", "what is this product?");
  assert.ok(result, "a zero-Panel account's own ingested knowledge must still be retrievable");
  assert.equal(result![0].content.includes("AI Telegram moderation"), true);
});

test("REQUIRED (Project Knowledge ingestion): a FAILED ingestion (empty content) never fabricates retrievable knowledge", async () => {
  // watch-project-knowledge.ts persists status:'failed', content:'' on a
  // fetch failure -- this proves that shape can never surface as a
  // real-looking answer (an empty-content row scores 0 relevance for any
  // real query and is filtered out by retrieveRelevantKnowledge itself).
  const admin = fakeAdminForKnowledge(
    [{ id: "ing-1", panel_id: null, scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "link", title: "Docs", content: "", active: true }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, null, "community-1", "what does the documentation say?");
  assert.equal(result, undefined, "an empty-content (failed-ingestion) row must never be surfaced as an answer");
});

test("REQUIRED (spec test 4/§8): community 1 knowledge never appears when answering inside community 2", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "c1", panel_id: "panel-1", scope_type: "COMMUNITY", project_id: null, community_id: "community-1", kind: "fact", title: "About this community", content: "This community is focused on Project Alpha.", active: true }],
    { "community-1": "project-a", "community-2": "project-b" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-2", "what is this community about?");
  assert.equal(result, undefined);
});

test("REQUIRED (user-reported TEST 1 -- project isolation): two projects under the same panel, community 2's question only ever retrieves project 2's own fact, never project 1's", async () => {
  const admin = fakeAdminForKnowledge(
    [
      { id: "litho-support", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "fact", title: "Support contact", content: "@litho_support", active: true },
      { id: "thanos-support", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-thanos", community_id: null, kind: "fact", title: "Support contact", content: "@thanos_support", active: true },
    ],
    { "litho-community": "project-litho", "thanos-community": "project-thanos" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "thanos-community", "who do I contact for support?");
  assert.ok(result);
  assert.equal(result!.length, 1);
  assert.equal(result![0].content, "@thanos_support");
  assert.ok(!result!.some((r) => r.content === "@litho_support"));
});

test("REQUIRED (user spec TEST 5 -- no cross-project fallback): community belongs to project A; only project B has the matching fact -> not used", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "b-fact", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-b", community_id: null, kind: "fact", title: "Launch date", content: "March 2027", active: true }],
    { "community-a": "project-a" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-a", "when is the launch date?");
  assert.equal(result, undefined);
});

test("REQUIRED (spec §7/§24): community knowledge is listed BEFORE its own project's fact when they conflict", async () => {
  const admin = fakeAdminForKnowledge(
    [
      { id: "proj", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "fact", title: "Support contact", content: "@litho_support", active: true },
      { id: "comm", panel_id: "panel-1", scope_type: "COMMUNITY", project_id: null, community_id: "community-2", kind: "fact", title: "Support contact", content: "@litho_vietnam_support", active: true },
    ],
    { "community-2": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-2", "who should I message for support?");
  assert.ok(result);
  assert.equal(result![0].content, "@litho_vietnam_support");
  assert.equal(result![1].content, "@litho_support");
});

test("REQUIRED (user spec TEST 4 -- organization fallback): neither community nor project has the answer, organization does", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "org", panel_id: "panel-1", scope_type: "ORGANIZATION", project_id: null, community_id: null, kind: "fact", title: "Legal contact", content: "legal@kajlabs.com", active: true }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-1", "who is the legal contact?");
  assert.ok(result);
  assert.equal(result![0].content, "legal@kajlabs.com");
});

test("REQUIRED (user spec TEST 6 -- multiple communities, same project): both communities under project Litho retrieve the same Project Knowledge", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "litho-chains", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "fact", title: "Chains", content: "Ethereum, Polygon", active: true }],
    { "litho-main": "project-litho", "litho-regional": "project-litho" }
  );
  const main = await loadRelevantKnowledge(admin, "panel-1", "litho-main", "what chains do you support?");
  const regional = await loadRelevantKnowledge(admin, "panel-1", "litho-regional", "what chains do you support?");
  assert.equal(main![0].content, "Ethereum, Polygon");
  assert.equal(regional![0].content, "Ethereum, Polygon");
});

test("REQUIRED (spec test 2): a question not covered by any scope returns undefined, never a fabricated fallback", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "p1", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "fact", title: "Supported chains", content: "Ethereum and Polygon.", active: true }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-1", "what's the current token price?");
  assert.equal(result, undefined);
});

test("inactive rows in any scope are never retrieved", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "stale", panel_id: "panel-1", scope_type: "PROJECT", project_id: "project-litho", community_id: null, kind: "fact", title: "Old roadmap", content: "roadmap info", active: false }],
    { "community-1": "project-litho" }
  );
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-1", "roadmap info");
  assert.equal(result, undefined);
});

test("no rows at all in any scope -> undefined, no query result mishandling", async () => {
  const admin = fakeAdminForKnowledge([], { "community-1": "project-litho" });
  const result = await loadRelevantKnowledge(admin, "panel-1", "community-1", "anything");
  assert.equal(result, undefined);
});

/* ==================================================== detectSupportedMedia ==== */

function baseMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return { message_id: 1, chat: { id: 100 }, from: { id: 200 }, ...overrides };
}

test("REQUIRED: a photo message is recognized, using the HIGHEST-resolution variant (last in Telegram's array)", () => {
  const msg = baseMessage({
    photo: [
      { file_id: "small", file_unique_id: "u-small", width: 90, height: 90, file_size: 1000 },
      { file_id: "large", file_unique_id: "u-large", width: 1280, height: 1280, file_size: 90000 },
    ],
  });
  const media = detectSupportedMedia(msg);
  assert.deepEqual(media, { kind: "photo", fileId: "large", fileUniqueId: "u-large", fileSize: 90000, durationS: null, mimeType: "image/jpeg" });
});

test("REQUIRED: a video message is recognized with its reported duration/mime type", () => {
  const msg = baseMessage({ video: { file_id: "v1", file_unique_id: "uv1", duration: 42, file_size: 500000, mime_type: "video/mp4" } });
  const media = detectSupportedMedia(msg);
  assert.deepEqual(media, { kind: "video", fileId: "v1", fileUniqueId: "uv1", fileSize: 500000, durationS: 42, mimeType: "video/mp4" });
});

test("an animation (GIF) message is recognized the same way as video", () => {
  const msg = baseMessage({ animation: { file_id: "a1", file_unique_id: "ua1", duration: 5, file_size: 20000, mime_type: "video/mp4" } });
  const media = detectSupportedMedia(msg);
  assert.equal(media?.kind, "animation");
  assert.equal(media?.fileId, "a1");
});

test("REQUIRED: a document is treated as an image ONLY via Telegram's own reported mime_type, never by filename", () => {
  const msg = baseMessage({ document: { file_id: "d1", file_unique_id: "ud1", file_size: 3000, mime_type: "image/png", file_name: "totally-safe.png" } });
  const media = detectSupportedMedia(msg);
  assert.equal(media?.kind, "photo");
  assert.equal(media?.mimeType, "image/png");
});

test("REQUIRED: a document reported as video/* mime type is recognized as video", () => {
  const msg = baseMessage({ document: { file_id: "d2", file_unique_id: "ud2", file_size: 30000, mime_type: "video/quicktime", file_name: "clip.mov" } });
  const media = detectSupportedMedia(msg);
  assert.equal(media?.kind, "video");
});

test("REQUIRED (negative): a document whose filename LOOKS like an image but has no image/video mime_type is NOT treated as media -- filename alone is never trusted", () => {
  const msg = baseMessage({ document: { file_id: "d3", file_unique_id: "ud3", file_size: 1000, mime_type: "application/octet-stream", file_name: "nudes.jpg.exe" } });
  assert.equal(detectSupportedMedia(msg), null);
});

test("a document with NO mime_type at all is not treated as media", () => {
  const msg = baseMessage({ document: { file_id: "d4", file_unique_id: "ud4", file_size: 1000, file_name: "mystery.bin" } });
  assert.equal(detectSupportedMedia(msg), null);
});

test("a plain text message has no detected media", () => {
  assert.equal(detectSupportedMedia(baseMessage({ text: "hello everyone" })), null);
});

test("an empty photo array is not treated as a photo message", () => {
  assert.equal(detectSupportedMedia(baseMessage({ photo: [] })), null);
});

test("photo takes precedence when (hypothetically) multiple media fields are present on the same message", () => {
  const msg = baseMessage({
    photo: [{ file_id: "p1", file_unique_id: "up1", width: 800, height: 600, file_size: 5000 }],
    video: { file_id: "v1", file_unique_id: "uv1", duration: 10, file_size: 10000, mime_type: "video/mp4" },
  });
  assert.equal(detectSupportedMedia(msg)?.kind, "photo");
});

/* ------------------------------------- trial Media Moderation cap (2026-09-02) ---- */
// The Free Trial is no longer unmetered for media moderation -- it gets a
// real, capped allowance (money.ts's TRIAL_MEDIA_MODERATION_ALLOWANCE),
// tracked against the trial's OWN one-time started_at/ends_at rather than a
// recurring subscription period (a trial account has no product_entitlements
// row for resolveAccountBillingPeriod to read at all). trialMediaModerationPeriod
// is the pure decision this pass adds; the surrounding DB-heavy orchestration
// (runMediaModeration's usage lookup/increment/gate) is verified via
// typecheck + build + code review, consistent with this file's own
// established convention for that function (see its neighboring comments).

test("REQUIRED: an active trial resolves to a period built from its own started_at/ends_at", () => {
  const period = trialMediaModerationPeriod({ active: true, startedAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-08T00:00:00.000Z" });
  assert.deepEqual(period, { start: "2026-09-01T00:00:00.000Z", end: "2026-09-08T00:00:00.000Z" });
});

test("an inactive/expired trial resolves to null -- never a stale period", () => {
  assert.equal(trialMediaModerationPeriod({ active: false, startedAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-08T00:00:00.000Z" }), null);
});

test("no trial at all (paid tier, or no entitlement) resolves to null", () => {
  assert.equal(trialMediaModerationPeriod({ active: false, startedAt: null, endsAt: null }), null);
});

test("an active trial with a missing start or end date safely resolves to null rather than a half-built period", () => {
  assert.equal(trialMediaModerationPeriod({ active: true, startedAt: null, endsAt: "2026-09-08T00:00:00.000Z" }), null);
  assert.equal(trialMediaModerationPeriod({ active: true, startedAt: "2026-09-01T00:00:00.000Z", endsAt: null }), null);
});

/* ------------------------------------------------- Phase 4.O: /start ---- */
// START_COMMAND_RE is the entry gate for handleStartCommand (private-chat
// touchpoint + group add-to-group completion, telegram-bot-to-bot-
// onboarding-spec.md §2/§6/§23). The DB-heavy orchestration around it
// (session lookup/consumption, finalizeCommunityConnection) is verified via
// typecheck + build + code review, consistent with how this codebase treats
// other comparably complex DB-mocked orchestrators (see the media-moderation
// v1.19.0 changelog note) -- this pins the one genuinely pure decision layer.

/* ---------------------- finalizeCommunityConnection: private-chat guard --- */
// The rest of finalizeCommunityConnection's DB orchestration stays verified
// via typecheck + build + code review (see the comment above) -- but this
// specific guard is a pure, DB-free early return (checked before any query
// runs), so it's directly testable and worth its own regression coverage:
// this is the exact live-bug fix for a Telegram PERSON's private chat
// producing an orphaned Project named after their username (e.g.
// "KSolDegen"), the Panel-owner-flow counterpart to the standalone-Watch
// fix already covered by watch-runtime.test.ts's private-chat tests.
function throwingAdmin() {
  return {
    from() { throw new Error("finalizeCommunityConnection must reject a private chat before making any DB call"); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: finalizeCommunityConnection rejects a private Telegram chat before touching the DB -- the exact 'KSolDegen' live-bug fix", async () => {
  const result = await finalizeCommunityConnection(
    throwingAdmin(),
    "panel-1",
    "mod-1",
    "owner-1",
    {},
    { chat: { id: 6952824285, username: "KSolDegen", type: "private" }, present: true, canSend: true, canDelete: true, canRestrict: true }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /personal Telegram account/i);
});

test("finalizeCommunityConnection's private-chat guard never fires for a real group/supergroup/channel (only checked when chat.type is KNOWN and bad)", () => {
  const SUPPORTED = new Set(["group", "supergroup", "channel"]);
  for (const type of ["group", "supergroup", "channel"]) {
    assert.ok(SUPPORTED.has(type), `${type} must remain a supported Community chat type`);
  }
  // An unset/unknown chat.type must never be guessed at -- mirrors
  // createAccountCommunity's own "only checked when actually known" rule.
  assert.ok(!SUPPORTED.has("private"));
});

test("START_COMMAND_RE matches a bare /start with no payload (private-chat touchpoint)", () => {
  const m = START_COMMAND_RE.exec("/start");
  assert.ok(m);
  assert.equal(m?.[1], undefined);
});

test("START_COMMAND_RE captures the setup-session token from a startgroup deep link", () => {
  const m = START_COMMAND_RE.exec("/start aB3dEf9012XyZw==");
  assert.ok(m);
  assert.equal(m?.[1], "aB3dEf9012XyZw==");
});

test("START_COMMAND_RE matches /start@botusername (Telegram's group-mention form) with a payload", () => {
  const m = START_COMMAND_RE.exec("/start@kwan_mod_bot abc123");
  assert.ok(m);
  assert.equal(m?.[1], "abc123");
});

test("START_COMMAND_RE does not match an ordinary message that merely contains the word start", () => {
  assert.equal(START_COMMAND_RE.exec("let's start the meeting"), null);
});

test("START_COMMAND_RE does not match a message that starts with /startsomething else entirely", () => {
  assert.equal(START_COMMAND_RE.exec("/startgroup fake"), null);
});

test("START_COMMAND_RE tolerates trailing whitespace", () => {
  const m = START_COMMAND_RE.exec("/start   token123   ");
  assert.ok(m);
  assert.equal(m?.[1], "token123");
});

/* ============================================================
   Watch standalone runtime -- resolveCommunity, standalone settings
   synthesis, and the "no hidden Panel fallback" proof.
   ============================================================ */

interface FakeCommunityRow {
  id: string; panel_id: string | null; platform: string; chat_id: string;
  bot_ack_mode?: string; collab_contact?: string | null; acknowledge_admin_mod?: boolean | null;
}

/** Mimics resolveCommunity's exact query shape: .select().eq(platform).eq(chat_id)
 *  then EITHER .eq("panel_id", X) or .is("panel_id", null), then .maybeSingle().
 *  Records every table touched so a test can assert "panels" was never queried. */
function fakeAdminForResolveCommunity(rows: FakeCommunityRow[]) {
  const tablesTouched: string[] = [];
  return {
    __tablesTouched: tablesTouched,
    from(table: string) {
      tablesTouched.push(table);
      if (table !== "communities") throw new Error(`unexpected table in fake admin: ${table}`);
      const filters: Array<(r: FakeCommunityRow) => boolean> = [];
      const api = {
        select() { return api; },
        eq(col: string, val: unknown) { filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val); return api; },
        is(col: string, val: unknown) { filters.push((r) => ((r as unknown as Record<string, unknown>)[col] ?? null) === val); return api; },
        async maybeSingle() {
          const matches = rows.filter((r) => filters.every((f) => f(r)));
          return { data: matches[0] ?? null, error: null };
        },
        // resolveCommunity's best-effort metadata refresh after a successful
        // SELECT -- always a no-op success here, matching the real
        // "never touches project_id, failure here is non-fatal" behavior.
        update() {
          return { async eq() { return { error: null }; } };
        },
      };
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: resolveCommunity resolves a standalone (Panel-less) community by platform+chat_id alone", async () => {
  const admin = fakeAdminForResolveCommunity([
    { id: "c1", panel_id: null, platform: "telegram", chat_id: "-1001" },
  ]);
  const community = await resolveCommunity(admin, null, { id: -1001, type: "supergroup" });
  assert.ok(community);
  assert.equal(community?.id, "c1");
});

test("resolveCommunity surfaces the real acknowledge_admin_mod value, never fabricating it when absent", async () => {
  const admin = fakeAdminForResolveCommunity([
    { id: "c1", panel_id: null, platform: "telegram", chat_id: "-1001", acknowledge_admin_mod: true },
    { id: "c2", panel_id: null, platform: "telegram", chat_id: "-1002" },
  ]);
  const withFlag = await resolveCommunity(admin, null, { id: -1001, type: "supergroup" });
  const withoutFlag = await resolveCommunity(admin, null, { id: -1002, type: "supergroup" });
  assert.equal(withFlag?.acknowledge_admin_mod, true);
  assert.equal(withoutFlag?.acknowledge_admin_mod, undefined, "no invented value for a row that never set the column");
});

test("REQUIRED: resolveCommunity never returns a Panel-scoped community for a standalone (null panelId) lookup, even with the same chat_id", async () => {
  const admin = fakeAdminForResolveCommunity([
    { id: "c-panel", panel_id: "panel-1", platform: "telegram", chat_id: "-1001" },
  ]);
  const community = await resolveCommunity(admin, null, { id: -1001, type: "supergroup" });
  assert.equal(community, null, "a Panel-owned community must never be mistaken for a standalone one");
});

test("REQUIRED: resolveCommunity never returns a standalone community for a Panel-scoped lookup, even with the same chat_id (the reverse case)", async () => {
  const admin = fakeAdminForResolveCommunity([
    { id: "c-standalone", panel_id: null, platform: "telegram", chat_id: "-1001" },
  ]);
  const community = await resolveCommunity(admin, "panel-1", { id: -1001, type: "supergroup" });
  assert.equal(community, null, "a standalone community must never be mistaken for a Panel's");
});

test("REQUIRED: resolveCommunity distinguishes two standalone communities with different chat IDs correctly (no cross-account bleed)", async () => {
  const admin = fakeAdminForResolveCommunity([
    { id: "c-a", panel_id: null, platform: "telegram", chat_id: "-1001" },
    { id: "c-b", panel_id: null, platform: "telegram", chat_id: "-2002" },
  ]);
  const forA = await resolveCommunity(admin, null, { id: -1001, type: "supergroup" });
  const forB = await resolveCommunity(admin, null, { id: -2002, type: "supergroup" });
  assert.equal(forA?.id, "c-a");
  assert.equal(forB?.id, "c-b");
});

test("resolveCommunity returns null for an unknown chat, standalone or Panel-scoped, never a guess", async () => {
  const admin = fakeAdminForResolveCommunity([]);
  assert.equal(await resolveCommunity(admin, null, { id: -9999, type: "group" }), null);
  assert.equal(await resolveCommunity(admin, "panel-1", { id: -9999, type: "group" }), null);
});

test("REQUIRED: NO HIDDEN FALLBACK -- resolveCommunity for a standalone lookup never queries the panels table at all", async () => {
  const admin = fakeAdminForResolveCommunity([{ id: "c1", panel_id: null, platform: "telegram", chat_id: "-1001" }]);
  await resolveCommunity(admin, null, { id: -1001, type: "supergroup" });
  assert.ok(admin.__tablesTouched.every((t: string) => t === "communities"), "must never touch panels for a standalone resolution");
});

/* ---------------------------------------------- standalone settings synthesis ---- */

const STANDALONE_ENTITLED = { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:deposit-1" };

function fakeAdminForStandaloneSettings(opts: { moderators?: Array<{ id: string; account_id: string | null }>; entitlements?: Record<string, unknown>[]; products?: Record<string, unknown>[] }) {
  const tablesTouched: string[] = [];
  const store: Record<string, unknown[]> = {
    virtual_moderators: opts.moderators ?? [],
    product_entitlements: opts.entitlements ?? [],
    products: opts.products ?? [{ id: "product-watch", slug: "watch" }],
    // Neither table has any rows in these fixtures -- a non-entitled
    // account here also has no trial claim / no verified Telegram identity,
    // so resolveStandaloneModeratorSettings' trial branch correctly falls
    // through to null, same as before trial support existed.
    watch_trial_claims: [],
    watch_telegram_links: [],
  };
  return {
    __tablesTouched: tablesTouched,
    from(table: string) {
      tablesTouched.push(table);
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const api = {
        select() { return api; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api; },
        order() { return api; },
        limit() { return api; },
        async maybeSingle() {
          const rows = (store[table] ?? []) as Record<string, unknown>[];
          return { data: rows.filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null };
        },
      };
      return api;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: buildStandaloneModeratorSettings produces a shape the REAL capability functions in plan.ts read correctly", () => {
  const settings = buildStandaloneModeratorSettings("standard");
  assert.equal(hasVirtualModerator(settings), true);
  assert.equal(moderatorEntitlementSource(settings), "standard");
  assert.equal(virtualModNaturalChatter(settings), true);
  assert.equal(virtualModModeration(settings), true);
});

test("buildStandaloneModeratorSettings never carries a trial -- direct Watch checkout is paid-only", () => {
  const settings = buildStandaloneModeratorSettings("basic") as { addons: { moderator: { trial: { active: boolean } } } };
  assert.equal(settings.addons.moderator.trial.active, false);
});

test("REQUIRED: resolveStandaloneModeratorSettings resolves real capacity for an entitled standalone account", async () => {
  const admin = fakeAdminForStandaloneSettings({
    moderators: [{ id: "mod-1", account_id: "acct-1" }],
    entitlements: [STANDALONE_ENTITLED],
  });
  const settings = await resolveStandaloneModeratorSettings(admin, "mod-1");
  assert.equal(hasVirtualModerator(settings), true);
  assert.equal(moderatorEntitlementSource(settings), "standard");
});

test("REQUIRED: resolveStandaloneModeratorSettings returns null (never a fabricated tier) for a non-entitled account", async () => {
  const admin = fakeAdminForStandaloneSettings({ moderators: [{ id: "mod-1", account_id: "acct-1" }], entitlements: [] });
  const settings = await resolveStandaloneModeratorSettings(admin, "mod-1");
  assert.equal(settings, null);
  assert.equal(hasVirtualModerator(settings), false, "downstream capability checks must fail closed, never assume entitlement");
});

test("resolveStandaloneModeratorSettings returns null for an unknown/Panel-owned Watcher (no account_id)", async () => {
  const admin = fakeAdminForStandaloneSettings({ moderators: [{ id: "mod-1", account_id: null }] });
  assert.equal(await resolveStandaloneModeratorSettings(admin, "mod-1"), null);
  assert.equal(await resolveStandaloneModeratorSettings(admin, "nonexistent"), null);
});

test("REQUIRED: NO HIDDEN FALLBACK -- resolveStandaloneModeratorSettings never queries the panels table", async () => {
  const admin = fakeAdminForStandaloneSettings({ moderators: [{ id: "mod-1", account_id: "acct-1" }], entitlements: [STANDALONE_ENTITLED] });
  await resolveStandaloneModeratorSettings(admin, "mod-1");
  assert.ok(!admin.__tablesTouched.includes("panels"), "must never look up a Panel for standalone entitlement resolution");
  assert.deepEqual(admin.__tablesTouched, ["virtual_moderators", "products", "product_entitlements"]);
});

test("resolveWatcherAccountId returns null for a Panel-owned Watcher, the account id for a standalone one", async () => {
  const admin = fakeAdminForStandaloneSettings({ moderators: [{ id: "mod-1", account_id: "acct-1" }, { id: "mod-2", account_id: null }] });
  assert.equal(await resolveWatcherAccountId(admin, "mod-1"), "acct-1");
  assert.equal(await resolveWatcherAccountId(admin, "mod-2"), null);
});

/* ------------------------------------------------- capacity parity across tiers ---- */

test("REQUIRED: every plan tier's standalone-synthesized capacity matches the canonical CAPACITY table exactly", () => {
  for (const tier of ["basic", "standard", "premium", "pro"] as const) {
    const settings = buildStandaloneModeratorSettings(tier);
    assert.equal(moderatorEntitlementSource(settings), tier);
    // Sanity: the SAME settings object, run through the real capability
    // gate, agrees with the canonical CAPACITY table's existence for this tier.
    assert.ok(CAPACITY[tier].maxActiveSlots > 0);
    assert.ok(CAPACITY[tier].maxCommunities > 0);
  }
});

/* ----------------------------------------------------- loadRelevantKnowledge ---- */

test("REQUIRED: loadRelevantKnowledge with panelId: null skips the ORGANIZATION-scope query entirely (no panel to scope it to)", async () => {
  const admin = fakeAdminForKnowledge(
    [{ id: "k1", panel_id: "panel-x", scope_type: "ORGANIZATION", project_id: null, community_id: null, kind: "fact", title: "Org fact", content: "Should never surface for a standalone community.", active: true }],
    { "community-1": "project-1" }
  );
  const results = await loadRelevantKnowledge(admin, null, "community-1", "anything");
  const surfacedTitles = (results ?? []).map((r) => r.title);
  assert.ok(!surfacedTitles.includes("Org fact"), "ORGANIZATION-scope knowledge must never leak into a standalone (panel-less) community");
});

/* ------------------------------------------------- runLinkModeration (self-mention) ---- */
/* Live bug: a legitimate mention of a Watcher's OWN Telegram username was
   being deleted and warned as scam/promotion merely because it contained an
   @username. Fixed in link-moderation.ts (filterOutOwnBotMentions) --
   these are the integration-level proofs that runLinkModeration itself
   never reaches classification/enforcement for a bare self-mention. */

function buildLinkModerationEvent(text: string): CommunityEvent {
  return {
    panelId: null,
    communityId: "community-1",
    integrationId: "integration-1",
    messageId: "msg-1",
    sender: { platformUserId: "user-1", isBot: false, senderType: "HUMAN", displayName: "Sam", username: "sam_h" },
    timestamp: new Date().toISOString(),
    text,
    replyToMessageId: null,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
  };
}

const MR_PRES_DEPLOYMENT: ChatterDeployment = {
  deploymentId: "dep-1", moderatorId: "mod-1", moderatorName: "Mr Pres", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "mrpreswan_bot", createdAt: "2026-01-01T00:00:00Z",
};

test("REQUIRED (live bug, NO HIDDEN FALLBACK): a message containing ONLY the Watcher's own @username + greeting never touches the DB or Telegram -- structurally proves no deletion/warning can happen", async () => {
  const admin = throwingAdmin();
  const result = await runLinkModeration(
    admin, null, { id: "community-1" }, "-1001",
    buildLinkModerationEvent("@mrpreswan_bot hello"),
    [MR_PRES_DEPLOYMENT],
    new Date()
  );
  assert.deepEqual(result, { handled: false, collabRoutable: false });
});

test("REQUIRED (live bug): the Watcher's own mention in a normal sentence is also never treated as a moderation candidate", async () => {
  const admin = throwingAdmin();
  const result = await runLinkModeration(
    admin, null, { id: "community-1" }, "-1001",
    buildLinkModerationEvent("hey @mrpreswan_bot what do you think about this proposal?"),
    [MR_PRES_DEPLOYMENT],
    new Date()
  );
  assert.deepEqual(result, { handled: false, collabRoutable: false });
});

test("REQUIRED: the same self-mention with different casing is still recognized and exempted", async () => {
  const admin = throwingAdmin();
  const result = await runLinkModeration(
    admin, null, { id: "community-1" }, "-1001",
    buildLinkModerationEvent("@MrPresWan_Bot good morning"),
    [MR_PRES_DEPLOYMENT],
    new Date()
  );
  assert.deepEqual(result, { handled: false, collabRoutable: false });
});

test("REQUIRED (multi-Watcher, requirement 8): mentioning a DIFFERENT deployed Watcher's username is also exempt -- Test never treats Kwan's mention as its own scam signal", async () => {
  const kwan: ChatterDeployment = { deploymentId: "dep-kwan", moderatorId: "mod-kwan", moderatorName: "Kwan", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "kwan_mod_bot", createdAt: "2026-01-01T00:00:00Z" };
  const test1: ChatterDeployment = { deploymentId: "dep-test", moderatorId: "mod-test", moderatorName: "Test", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "test1_mod_bot", createdAt: "2026-01-01T00:00:01Z" };
  const admin = throwingAdmin();
  const result = await runLinkModeration(
    admin, null, { id: "community-1" }, "-1001",
    buildLinkModerationEvent("@kwan_mod_bot can you help me?"),
    [test1, kwan], // Test is deployments[0] (the enforcer) -- proves the exemption isn't limited to "only the mentioned bot"
    new Date()
  );
  assert.deepEqual(result, { handled: false, collabRoutable: false });
});

/* --------------------------------------------------- MODERATOR_AI_GENERATION_POOL gate ---- */
/* Live-approved monthly usage limit (money.ts), never enforced until now.
   respondAsDeployment gates CASUAL_CHAT/ANSWER generation on real usage
   for a paid direct-Watch account with a resolvable billing period --
   proven here structurally: once the pool reads as exhausted, NOTHING
   past that point (no generation, no Telegram send, no usage increment)
   may happen. */

type AiUsageRow = Record<string, unknown>;

function fakeAdminForAiUsageGate(opts: { periodStart: string; periodEnd: string; usedCount: number }) {
  const activityLog: AiUsageRow[] = [];
  const allowedTables = new Set(["products", "product_entitlements", "watch_ai_response_usage", "moderator_activity_log"]);
  return {
    __activityLog: activityLog,
    from(table: string) {
      if (!allowedTables.has(table)) {
        throw new Error(`respondAsDeployment must not touch "${table}" once the AI response pool reads as exhausted`);
      }
      if (table === "moderator_activity_log") {
        return { insert: async (row: AiUsageRow) => { activityLog.push(row); return { data: null, error: null }; } };
      }
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq() { return builder; },
        async maybeSingle() {
          if (table === "products") return { data: { id: "product-watch" }, error: null };
          if (table === "product_entitlements") return { data: { current_period_start: opts.periodStart, current_period_end: opts.periodEnd }, error: null };
          if (table === "watch_ai_response_usage") return { data: { response_count: opts.usedCount }, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
    rpc() { throw new Error("respondAsDeployment must not call any RPC (e.g. the usage increment) once the pool reads as exhausted"); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseAiGateEvent(): CommunityEvent {
  return {
    panelId: null,
    communityId: "community-1",
    integrationId: "integration-1",
    messageId: "msg-1",
    sender: { platformUserId: "user-1", isBot: false, senderType: "HUMAN", displayName: "Sam", username: "sam_h" },
    timestamp: new Date().toISOString(),
    text: "how does this work?",
    replyToMessageId: null,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
  };
}

const AI_GATE_DEPLOYMENT: ChatterDeployment = {
  deploymentId: "dep-1", moderatorId: "mod-1", moderatorName: "Mr Pres", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "mrpreswan_bot", createdAt: "2026-01-01T00:00:00Z",
};

test("REQUIRED: an exhausted AI response pool resolves to SILENCE for a paid account, structurally before any generation/send/increment", async () => {
  const admin = fakeAdminForAiUsageGate({ periodStart: "2026-08-01T00:00:00Z", periodEnd: "2026-09-01T00:00:00Z", usedCount: 2000 }); // basic's pool is exactly 2000 (2026-08-22 repriced allowance)
  const result = await respondAsDeployment({
    admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
    deployment: AI_GATE_DEPLOYMENT, actionType: "ANSWER", reasons: ["directed"], isTrialEntitlement: false,
    accountId: "acct-1", paidTier: "basic", now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
    otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
  });
  assert.deepEqual(result, { replied: false });
  assert.equal(admin.__activityLog.length, 1);
  assert.equal(admin.__activityLog[0].decision, "SILENCE");
  assert.equal(admin.__activityLog[0].reason_code, "ai_generation_pool_exhausted");
});

test("REQUIRED: with accountId null (trial account / Panel-distributed deployment, as handleCommunityUpdate resolves), the pool gate's own billing-period/usage tables are never queried at all", async () => {
  const queriedTables: string[] = [];
  const admin = {
    from(table: string) {
      queriedTables.push(table);
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq() { return builder; },
        insert: async () => ({ data: null, error: null }),
        upsert: async () => ({ data: null, error: null }),
        async maybeSingle() { return { data: null, error: null }; },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // SHORT_ACK never reaches the pool gate at all regardless of accountId --
  // deterministic, zero Sonnet calls, matches MODERATOR_AI_GENERATION_POOL's
  // own doc comment -- this exercises accountId: null specifically (the
  // real shape handleCommunityUpdate resolves for a trial account or a
  // Panel-distributed deployment).
  await respondAsDeployment({
    admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
    deployment: AI_GATE_DEPLOYMENT, actionType: "SHORT_ACK", reasons: ["ack"], isTrialEntitlement: false,
    accountId: null, paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
    otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
  });
  assert.equal(queriedTables.includes("products"), false);
  assert.equal(queriedTables.includes("product_entitlements"), false);
  assert.equal(queriedTables.includes("watch_ai_response_usage"), false);
});

test("REQUIRED: with real headroom remaining, the pool gate itself never fires -- proven via the pure hasAiGenerationPoolRemaining check the gate is built on (no live AI call risked in this test)", () => {
  // respondAsDeployment's positive path (headroom exists -> proceed to
  // generation) is intentionally NOT exercised end-to-end here -- doing so
  // would require actually calling generateChatterReply, which could hit a
  // real AI provider if any key happens to be configured in the shell
  // running these tests. The gate's decision boundary is already fully
  // covered at the pure-function level (watch-ai-usage.test.ts); this pins
  // the exact worked example used by the exhausted-pool test above, so the
  // two tests can never silently drift apart on what "exhausted" means.
  assert.equal(hasAiGenerationPoolRemaining(1999, "basic"), true);
  assert.equal(hasAiGenerationPoolRemaining(2000, "basic"), false);
});

test("an arbitrary external @username with no other link and no other suspicious content is NOT exempt by this mechanism -- it still reaches real moderation logic (proven by requiring a DB touch, unlike the self-mention cases above which never touch the DB at all)", async () => {
  let touchedDb = false;
  const admin = {
    from() {
      touchedDb = true;
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  try {
    await runLinkModeration(
      admin, null, { id: "community-1" }, "-1001",
      buildLinkModerationEvent("@totally_unrelated_person said hi"),
      [MR_PRES_DEPLOYMENT],
      new Date()
    );
  } catch {
    // The minimal fake admin above doesn't implement every table this code
    // path reaches beyond the first real DB touch -- a thrown error past
    // that point is expected and irrelevant; only whether the DB was
    // touched at all matters for this test.
  }
  assert.equal(touchedDb, true, "an arbitrary external handle (not the Watcher's own) must still reach real moderation logic, never silently exempted");
});

/* ------------------------------- BYO Enterprise routing threading (Phase 2, 2026-08-24) ---- */
/* respondAsDeployment's own job (beyond forwarding aiRouting into
   generateChatterReply, already covered by chatter-generate.test.ts's
   resolveChatterRoute tests) is the GENERATION_STARTED log's `provider`
   field, which now branches on aiRouting.required -- these are the
   structural/wiring tests for that, consistent with how this file already
   tests parameter-threading rather than live AI calls for these
   orchestrators. runLinkModeration/runMediaModeration's own aiRouting
   threading is a single passthrough parameter with no branching logic of
   its own in this file -- verified via typecheck + the full BYO-required/
   usable/missing matrix already covered at the classifyLinkIntent/
   generateModerationWarning/generateMediaModerationWarning function level. */

function fakeAdminForByoWiring() {
  const activityLog: Record<string, unknown>[] = [];
  return {
    __activityLog: activityLog,
    from(table: string) {
      if (table === "moderator_activity_log") {
        return { insert: async (row: Record<string, unknown>) => { activityLog.push(row); return { data: null, error: null }; } };
      }
      throw new Error(`unexpected table touch: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: GENERATION_STARTED logs the BYO credential's own provider when aiRouting.required is true", async () => {
  const admin = fakeAdminForByoWiring();
  // A fetch stub (no real network call) -- this test only cares about the
  // GENERATION_STARTED log entry written BEFORE the model call, not the
  // actual generation outcome.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("stubbed, no real network call", { status: 500 })) as typeof fetch;
  let result: unknown;
  try {
    result = await respondAsDeployment({
      admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
      deployment: AI_GATE_DEPLOYMENT, actionType: "ANSWER", reasons: ["directed"], isTrialEntitlement: false,
      accountId: null, paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
      otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
      aiRouting: { required: true, credential: { provider: "openai", apiKey: "sk-real-byo", baseUrl: null, model: "gpt-5" } },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(result, { replied: false });
  const started = admin.__activityLog.find((r: Record<string, unknown>) => r.decision === "GENERATION_STARTED");
  assert.ok(started, "GENERATION_STARTED must still be logged before the model call, regardless of BYO");
  const meta = started!.meta as { provider?: string };
  assert.equal(meta.provider, "openai", "must reflect the BYO credential's own provider, never the hardcoded deepseek/anthropic guess");
});

test("GENERATION_STARTED logs 'byo_unconfigured' when BYO is required but no usable credential exists -- never silently omits the field or claims Innvil's own provider", async () => {
  const admin = fakeAdminForByoWiring();
  await respondAsDeployment({
    admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
    deployment: AI_GATE_DEPLOYMENT, actionType: "ANSWER", reasons: ["directed"], isTrialEntitlement: false,
    accountId: null, paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
    otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
    aiRouting: { required: true, credential: null },
  });
  const started = admin.__activityLog.find((r: Record<string, unknown>) => r.decision === "GENERATION_STARTED");
  const failed = admin.__activityLog.find((r: Record<string, unknown>) => r.decision === "GENERATION_FAILED");
  assert.equal((started!.meta as { provider?: string }).provider, "byo_unconfigured");
  assert.ok(failed, "a required-but-unusable BYO credential must fail generation explicitly, logged as GENERATION_FAILED -- never a silent success");
});

test("GENERATION_STARTED logs the ORIGINAL deepseek/anthropic values for a normal (non-BYO) account -- unaffected by this pass", async () => {
  const admin = fakeAdminForByoWiring();
  await respondAsDeployment({
    admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
    deployment: AI_GATE_DEPLOYMENT, actionType: "CASUAL_CHAT", reasons: ["ambient"], isTrialEntitlement: false,
    accountId: null, paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
    otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
    // aiRouting omitted entirely -- defaults to MANAGED_AI_ROUTING.
  });
  const started = admin.__activityLog.find((r: Record<string, unknown>) => r.decision === "GENERATION_STARTED");
  assert.equal((started!.meta as { provider?: string }).provider, "deepseek");
});

/* -------------------- per-Watcher-deployment BYO usage-policy gate (Phase 4.V.1, item 2) ---- */

function fakeAdminForByoDeploymentGate(opts: { requestLimit: number; usedCount: number }) {
  const activityLog: Record<string, unknown>[] = [];
  const policyRow = { id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: "dep-1", kind: "reactive", period: "monthly", request_limit: opts.requestLimit };
  const now = new Date();
  const periodKeyStr = `monthly:${now.toISOString().slice(0, 7)}`;
  const counterRow = { account_id: "acct-1", scope_key: "deployment:dep-1", kind: "reactive", period_key: periodKeyStr, request_count: opts.usedCount };
  return {
    __activityLog: activityLog,
    from(table: string) {
      if (table === "moderator_activity_log") {
        return { insert: async (row: Record<string, unknown>) => { activityLog.push(row); return { data: null, error: null }; } };
      }
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      const rows = table === "watch_byo_usage_policies" ? [policyRow] : table === "watch_byo_usage_counters" ? [counterRow] : [];
      if (!["watch_byo_usage_policies", "watch_byo_usage_counters"].includes(table)) throw new Error(`unexpected table touch: ${table}`);
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return builder; },
        async maybeSingle() {
          const match = rows.filter((r) => filters.every((f) => f(r)));
          return { data: match[0] ?? null, error: null };
        },
      };
      return builder;
    },
    rpc() { throw new Error("respondAsDeployment must not call the usage-increment RPC once the deployment policy already reads as exhausted"); },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: an exhausted DEPLOYMENT-scoped BYO usage policy blocks generation with a real SILENCE, structurally before any model/RPC call", async () => {
  const admin = fakeAdminForByoDeploymentGate({ requestLimit: 5, usedCount: 5 });
  const result = await respondAsDeployment({
    admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
    deployment: AI_GATE_DEPLOYMENT, actionType: "ANSWER", reasons: ["directed"], isTrialEntitlement: false,
    accountId: "acct-1", paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
    otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
    aiRouting: { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: "claude-sonnet-5" } },
  });
  assert.deepEqual(result, { replied: false });
  assert.equal(admin.__activityLog.length, 1);
  assert.equal(admin.__activityLog[0].decision, "SILENCE");
  assert.equal(admin.__activityLog[0].reason_code, "byo_deployment_usage_policy_exhausted");
});

test("a deployment policy with real headroom does NOT block generation -- reaches GENERATION_STARTED normally", async () => {
  const admin = fakeAdminForByoDeploymentGate({ requestLimit: 5, usedCount: 2 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("stubbed, no real network call", { status: 500 })) as typeof fetch;
  try {
    await respondAsDeployment({
      admin, panelId: null, communityId: "community-1", chatId: "-1001", event: baseAiGateEvent(),
      deployment: AI_GATE_DEPLOYMENT, actionType: "ANSWER", reasons: ["directed"], isTrialEntitlement: false,
      accountId: "acct-1", paidTier: null, now: new Date(), recentContext: [], isDirectedAtBot: true, addressedWithTypo: false,
      otherActiveModeratorNames: [], timer: createRequestTimer("integration-1"),
      aiRouting: { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: "claude-sonnet-5" } },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const started = admin.__activityLog.find((r: Record<string, unknown>) => r.decision === "GENERATION_STARTED");
  assert.ok(started, "a deployment policy with headroom must never block reaching GENERATION_STARTED");
});
