import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMediaModerationExpansionUnits, computeMediaModerationCapacity, isMediaModerationLimitReached,
} from "./watch-media-moderation-expansion";

/**
 * Mirrors watch-media-moderation-usage.test.ts's exact fake-admin structure
 * for the analogous real, stackable, current-period expansion-pack table
 * (watch_media_moderation_expansions, migration 0110).
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_media_moderation_expansions?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_media_moderation_expansions: seed.watch_media_moderation_expansions ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: (store[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PERIOD_START = "2026-08-01T00:00:00Z";
const OTHER_PERIOD_START = "2026-09-01T00:00:00Z";

/* --------------------------------------------------------------- read/sum ---- */

test("getMediaModerationExpansionUnits returns 0 for a period with no purchases yet", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_START), 0);
});

test("REQUIRED (9): a single purchased pack correctly increases available capacity", async () => {
  const admin = fakeAdmin({ watch_media_moderation_expansions: [
    { account_id: "acct-1", period_start: PERIOD_START, units: 1000 },
  ] });
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_START), 1000);
});

test("REQUIRED (10): multiple expansion packs, even of DIFFERENT sizes, aggregate correctly within the same period", async () => {
  const admin = fakeAdmin({ watch_media_moderation_expansions: [
    { account_id: "acct-1", period_start: PERIOD_START, units: 1000 },
    { account_id: "acct-1", period_start: PERIOD_START, units: 5000 },
    { account_id: "acct-1", period_start: PERIOD_START, units: 20000 },
  ] });
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_START), 26000);
});

test("a purchase scoped to a DIFFERENT period never counts toward the current period -- a fresh period starts back at just the base allowance", async () => {
  const admin = fakeAdmin({ watch_media_moderation_expansions: [
    { account_id: "acct-1", period_start: PERIOD_START, units: 10000 },
  ] });
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", OTHER_PERIOD_START), 0);
});

test("REQUIRED (20): expansion units are isolated per account -- one account's purchases never leak into another's available capacity", async () => {
  const admin = fakeAdmin({ watch_media_moderation_expansions: [
    { account_id: "acct-1", period_start: PERIOD_START, units: 20000 },
    { account_id: "acct-2", period_start: PERIOD_START, units: 1000 },
  ] });
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_START), 20000);
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-2", PERIOD_START), 1000);
});

/* --------------------------------------------------------------- pure capacity math ---- */

test("computeMediaModerationCapacity combines base + expansion into total, and floors available at 0", () => {
  assert.deepEqual(computeMediaModerationCapacity(500, 0, 420), { base: 500, expansion: 0, total: 500, used: 420, available: 80 });
  assert.deepEqual(computeMediaModerationCapacity(500, 2000, 420), { base: 500, expansion: 2000, total: 2500, used: 420, available: 2080 });
  assert.deepEqual(computeMediaModerationCapacity(500, 0, 900), { base: 500, expansion: 0, total: 500, used: 900, available: 0 });
});

test("REQUIRED (15): isMediaModerationLimitReached is true strictly at or above the total allowance (base + expansion), false below it -- this is a capacity limit, never a content-classification result", () => {
  assert.equal(isMediaModerationLimitReached(499, 500, 0), false);
  assert.equal(isMediaModerationLimitReached(500, 500, 0), true);
  assert.equal(isMediaModerationLimitReached(501, 500, 0), true);
  // Expansion genuinely raises the ceiling -- reaching the OLD base alone is no longer a limit once expansion exists.
  assert.equal(isMediaModerationLimitReached(500, 500, 2000), false);
  assert.equal(isMediaModerationLimitReached(2500, 500, 2000), true);
});
