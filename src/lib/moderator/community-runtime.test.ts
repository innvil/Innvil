import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicateUpdate, resolveEventOrigin } from "./community-runtime";

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
