import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAllDatabasePages } from "./paginate";

test("loads every page beyond PostgREST's common 1,000-row boundary", async () => {
  const source = Array.from({ length: 2_144 }, (_, id) => id + 1);
  const calls: Array<[number, number]> = [];
  const rows = await loadAllDatabasePages(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(rows.length, 2_144);
  assert.deepEqual(calls, [[0, 499], [500, 999], [1000, 1499], [1500, 1999], [2000, 2499]]);
});

test("propagates a later-page database error instead of returning a silently truncated catalog", async () => {
  await assert.rejects(
    loadAllDatabasePages(async (from) => (
      from === 500
        ? { data: null, error: { message: "database unavailable" } }
        : { data: Array.from({ length: 500 }, (_, id) => id), error: null }
    )),
    /database unavailable/
  );
});
