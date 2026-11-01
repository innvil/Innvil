import { test } from "node:test";
import assert from "node:assert/strict";
import { getWatchMediaModerationUsage, incrementWatchMediaModerationUsage, hasMediaModerationUnitsRemaining } from "./watch-media-moderation-usage";

/**
 * Mirrors watch-ai-usage.test.ts's exact structure for the analogous
 * Media Moderation Unit allowance (MODERATOR_MEDIA_ADDON, money.ts). The
 * one real difference from the AI Generation pool: increments are by a
 * VARIABLE amount (1 photo, or N real classified video frames), not always
 * exactly 1 -- these tests cover that explicitly.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_media_moderation_usage?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_media_moderation_usage: seed.watch_media_moderation_usage ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        async maybeSingle() { return { data: (store[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }; },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== "increment_watch_media_moderation_usage") throw new Error(`unexpected rpc ${fn}`);
      const rows = store.watch_media_moderation_usage;
      const idx = rows.findIndex((r) => r.account_id === args.p_account_id && r.period_start === args.p_period_start);
      const units = args.p_units as number;
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], unit_count: (rows[idx].unit_count as number) + units };
        return { data: rows[idx].unit_count, error: null };
      }
      const row = { account_id: args.p_account_id, period_start: args.p_period_start, period_end: args.p_period_end, unit_count: units };
      rows.push(row);
      return { data: units, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const PERIOD = { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" };

/* --------------------------------------------------------------- read / increment ---- */

test("getWatchMediaModerationUsage returns 0 for a brand-new period with no recorded usage yet", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-1", PERIOD.start), 0);
});

test("REQUIRED: incrementWatchMediaModerationUsage increments by the given VARIABLE unit count, not always 1 -- e.g. one photo (1) then a video's real frame count (4)", async () => {
  const admin = fakeAdmin({});
  await incrementWatchMediaModerationUsage(admin, "acct-1", PERIOD, 1);
  await incrementWatchMediaModerationUsage(admin, "acct-1", PERIOD, 4);
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-1", PERIOD.start), 5);
});

test("REQUIRED: incrementing by 0 units is a real no-op -- never calls the RPC, never creates a stray zero-count row", async () => {
  const admin = fakeAdmin({});
  await incrementWatchMediaModerationUsage(admin, "acct-1", PERIOD, 0);
  assert.equal(admin.__store.watch_media_moderation_usage.length, 0);
});

test("REQUIRED: usage is isolated per account -- one account's increments never affect another's count", async () => {
  const admin = fakeAdmin({});
  await incrementWatchMediaModerationUsage(admin, "acct-1", PERIOD, 3);
  await incrementWatchMediaModerationUsage(admin, "acct-2", PERIOD, 1);
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-1", PERIOD.start), 3);
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-2", PERIOD.start), 1);
});

test("REQUIRED: a new period (different period_start, e.g. after renewal) starts fresh at 0 -- no manual reset logic needed", async () => {
  const admin = fakeAdmin({});
  const sepPeriod = { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" };
  await incrementWatchMediaModerationUsage(admin, "acct-1", PERIOD, 7);
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-1", sepPeriod.start), 0);
  assert.equal(await getWatchMediaModerationUsage(admin, "acct-1", PERIOD.start), 7);
});

/* --------------------------------------------------------------- headroom ---- */

test("REQUIRED: hasMediaModerationUnitsRemaining is true strictly below the allowance, false at and above it", () => {
  assert.equal(hasMediaModerationUnitsRemaining(999, 1000), true);
  assert.equal(hasMediaModerationUnitsRemaining(1000, 1000), false);
  assert.equal(hasMediaModerationUnitsRemaining(1001, 1000), false);
});

test("hasMediaModerationUnitsRemaining works for any real allowance, not a fixed per-tier assumption -- the allowance is the caller's own resolved value", () => {
  assert.equal(hasMediaModerationUnitsRemaining(2500, 3000), true); // Gold's real 3000-unit package
  assert.equal(hasMediaModerationUnitsRemaining(4000, 4000), false); // Platinum's real 4000-unit package, exhausted
});
