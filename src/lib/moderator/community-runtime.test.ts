import { test } from "node:test";
import assert from "node:assert/strict";
import { isDuplicateUpdate } from "./community-runtime";

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
