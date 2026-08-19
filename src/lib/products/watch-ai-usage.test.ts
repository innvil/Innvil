import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAccountBillingPeriod, getWatchAiResponseUsage, incrementWatchAiResponseUsage,
  aiResponsePoolLimit, hasAiResponsePoolRemaining,
} from "./watch-ai-usage";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { MODERATOR_AI_RESPONSE_POOL } from "@/src/lib/money";

/**
 * MODERATOR_AI_RESPONSE_POOL (money.ts) is the ONE canonical monthly usage
 * limit that exists in the approved Watch plan/entitlement configuration
 * today. These tests cover the real usage-tracking layer built on top of
 * it -- period resolution (the account's REAL current subscription period,
 * never an invented calendar month), read/increment, and the pure
 * remaining-headroom check.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { products?: Row[]; product_entitlements?: Row[]; watch_ai_response_usage?: Row[] }) {
  const store: Record<string, Row[]> = {
    products: seed.products ?? [],
    product_entitlements: seed.product_entitlements ?? [],
    watch_ai_response_usage: seed.watch_ai_response_usage ?? [],
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
      if (fn !== "increment_watch_ai_response_usage") throw new Error(`unexpected rpc ${fn}`);
      const rows = store.watch_ai_response_usage;
      const idx = rows.findIndex((r) => r.account_id === args.p_account_id && r.period_start === args.p_period_start);
      if (idx >= 0) {
        rows[idx] = { ...rows[idx], response_count: (rows[idx].response_count as number) + 1 };
        return { data: rows[idx].response_count, error: null };
      }
      const row = { account_id: args.p_account_id, period_start: args.p_period_start, period_end: args.p_period_end, response_count: 1 };
      rows.push(row);
      return { data: 1, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const WATCH_PRODUCT_ROW = { id: "product-watch", slug: WATCH_PRODUCT_SLUG };

/* --------------------------------------------------------------- resolveAccountBillingPeriod ---- */

test("REQUIRED: resolveAccountBillingPeriod returns the account's REAL current subscription period, never an invented calendar month", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ account_id: "acct-1", product_id: "product-watch", current_period_start: "2026-08-01T00:00:00Z", current_period_end: "2026-09-01T00:00:00Z" }],
  });
  const period = await resolveAccountBillingPeriod(admin, "acct-1");
  assert.deepEqual(period, { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" });
});

test("resolveAccountBillingPeriod returns null for an account with no entitlement row at all", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW] });
  assert.equal(await resolveAccountBillingPeriod(admin, "acct-1"), null);
});

test("REQUIRED: a legacy never-expiring row (NULL current_period_end, pre-migration-0080) resolves to null -- never a fabricated period", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ account_id: "acct-1", product_id: "product-watch", current_period_start: null, current_period_end: null }],
  });
  assert.equal(await resolveAccountBillingPeriod(admin, "acct-1"), null);
});

test("resolveAccountBillingPeriod returns null when the Watch product catalog row is missing entirely", async () => {
  const admin = fakeAdmin({});
  assert.equal(await resolveAccountBillingPeriod(admin, "acct-1"), null);
});

/* --------------------------------------------------------------- read / increment ---- */

test("getWatchAiResponseUsage returns 0 for a brand-new period with no recorded usage yet", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getWatchAiResponseUsage(admin, "acct-1", "2026-08-01T00:00:00Z"), 0);
});

test("REQUIRED: incrementWatchAiResponseUsage is atomic (upsert-and-increment) and account/period scoped", async () => {
  const admin = fakeAdmin({});
  const period = { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" };
  await incrementWatchAiResponseUsage(admin, "acct-1", period);
  await incrementWatchAiResponseUsage(admin, "acct-1", period);
  await incrementWatchAiResponseUsage(admin, "acct-1", period);
  assert.equal(await getWatchAiResponseUsage(admin, "acct-1", period.start), 3);
});

test("REQUIRED: usage is isolated per account -- one account's increments never affect another's count", async () => {
  const admin = fakeAdmin({});
  const period = { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" };
  await incrementWatchAiResponseUsage(admin, "acct-1", period);
  await incrementWatchAiResponseUsage(admin, "acct-1", period);
  await incrementWatchAiResponseUsage(admin, "acct-2", period);
  assert.equal(await getWatchAiResponseUsage(admin, "acct-1", period.start), 2);
  assert.equal(await getWatchAiResponseUsage(admin, "acct-2", period.start), 1);
});

test("REQUIRED: a new period (different period_start, e.g. after renewal) starts fresh at 0 -- no manual reset logic needed", async () => {
  const admin = fakeAdmin({});
  const augPeriod = { start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" };
  const sepPeriod = { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" };
  await incrementWatchAiResponseUsage(admin, "acct-1", augPeriod);
  await incrementWatchAiResponseUsage(admin, "acct-1", augPeriod);
  assert.equal(await getWatchAiResponseUsage(admin, "acct-1", sepPeriod.start), 0);
  assert.equal(await getWatchAiResponseUsage(admin, "acct-1", augPeriod.start), 2);
});

/* --------------------------------------------------------------- pool limit ---- */

test("REQUIRED: aiResponsePoolLimit returns the exact canonical MODERATOR_AI_RESPONSE_POOL value per tier", () => {
  for (const tier of ["basic", "standard", "premium", "pro"] as const) {
    assert.equal(aiResponsePoolLimit(tier), MODERATOR_AI_RESPONSE_POOL[tier]);
  }
});

test("REQUIRED: hasAiResponsePoolRemaining is true strictly below the limit, false at and above it", () => {
  assert.equal(hasAiResponsePoolRemaining(1199, "basic"), true);
  assert.equal(hasAiResponsePoolRemaining(1200, "basic"), false);
  assert.equal(hasAiResponsePoolRemaining(1201, "basic"), false);
});

test("hasAiResponsePoolRemaining is independently correct per tier (higher tiers have real headroom where lower ones don't)", () => {
  assert.equal(hasAiResponsePoolRemaining(2000, "basic"), false); // basic pool is 1200
  assert.equal(hasAiResponsePoolRemaining(2000, "standard"), true); // standard pool is 2400
});
