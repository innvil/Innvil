import { test } from "node:test";
import assert from "node:assert/strict";
import { getWatchTrialState, hasActiveWatchTrial, startWatchTrial, TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "./watch-trial";

type Row = Record<string, unknown>;

/** Fake admin covering exactly what watch-trial.ts touches: watch_trial_claims
 *  (the claim/atomicity table) + watch_telegram_links (read-only, via
 *  getAccountTelegramIdentity). The insert() on watch_trial_claims
 *  simulates the REAL DB unique constraints (unique(account_id),
 *  unique(telegram_user_id)) with a genuine 23505 error code -- this is
 *  what proves startWatchTrial's race-handling path, not just its happy path. */
function fakeAdmin(seed: { watch_trial_claims?: Row[]; watch_telegram_links?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_trial_claims: seed.watch_trial_claims ?? [],
    watch_telegram_links: seed.watch_telegram_links ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return {
        select() { return this; },
        eq(col: string, val: unknown) { filters.push([col, val]); return this; },
        order() { return this; },
        limit() { return this; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        async insert(row: Row) {
          if (table === "watch_trial_claims") {
            const existing = store.watch_trial_claims ?? [];
            const conflict = existing.some((r) => r.account_id === row.account_id || r.telegram_user_id === row.telegram_user_id);
            if (conflict) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          store[table] = [...(store[table] ?? []), { id: `gen-${(store[table] ?? []).length + 1}`, ...row }];
          return { data: null, error: null };
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const VERIFIED_TG = { account_id: "acct-1", telegram_user_id: 555, telegram_username: "kaleb", verified_at: new Date().toISOString() };

/* ------------------------------------------------------- state resolution ---- */

test("REQUIRED (test 1): an account without verified Telegram cannot start the trial", async () => {
  const admin = fakeAdmin({});
  const state = await getWatchTrialState(admin, "acct-1");
  assert.equal(state.status, "telegram_required");
  const start = await startWatchTrial(admin, "acct-1");
  assert.equal(start.ok, false);
  assert.equal(admin.__store.watch_trial_claims.length, 0, "no claim must be written for an unverified account");
});

test("a verified account with no claim yet is eligible", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  const state = await getWatchTrialState(admin, "acct-1");
  assert.equal(state.status, "eligible");
});

test("REQUIRED (test 2): a verified zero-Panel account can start the trial", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  const result = await startWatchTrial(admin, "acct-1");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.state.status, "active");
    assert.ok(result.state.startedAt);
    assert.ok(result.state.endsAt);
  }
});

test("REQUIRED (tests 3-5): starting the trial creates no Panel, Project, Community, or Watcher row -- only watch_trial_claims", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  await startWatchTrial(admin, "acct-1");
  assert.deepEqual(Object.keys(admin.__store).sort(), ["watch_telegram_links", "watch_trial_claims"]);
  assert.equal(admin.__store.watch_trial_claims.length, 1);
});

test("REQUIRED (tests 7-8): start/end timestamps are server-generated, not client-suppliable", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  const before = Date.now();
  const result = await startWatchTrial(admin, "acct-1");
  const after = Date.now();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const startedMs = new Date(result.state.startedAt!).getTime();
  const endsMs = new Date(result.state.endsAt!).getTime();
  assert.ok(startedMs >= before && startedMs <= after, "startedAt must be a real server-generated 'now'");
  assert.equal(Math.round((endsMs - startedMs) / (24 * 60 * 60 * 1000)), TRIAL_DURATION_DAYS, "duration must match the canonical TRIAL_DURATION_DAYS constant, never a guessed number");
});

test("REQUIRED (test 9): a double-click / concurrent second start results in exactly one trial, not an error", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  const [a, b] = await Promise.all([startWatchTrial(admin, "acct-1"), startWatchTrial(admin, "acct-1")]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(admin.__store.watch_trial_claims.length, 1, "exactly one claim row, regardless of request order");
  if (a.ok && b.ok) assert.deepEqual(a.state, b.state);
});

test("calling startWatchTrial again on an already-active trial returns the SAME state idempotently", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  const first = await startWatchTrial(admin, "acct-1");
  const second = await startWatchTrial(admin, "acct-1");
  assert.equal(admin.__store.watch_trial_claims.length, 1);
  assert.deepEqual(first, second);
});

test("REQUIRED (test 10): an account whose trial already expired cannot start another", async () => {
  const expired = { account_id: "acct-1", telegram_user_id: 555, started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), ends_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() };
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG], watch_trial_claims: [expired] });
  const state = await getWatchTrialState(admin, "acct-1");
  assert.equal(state.status, "expired");
  const result = await startWatchTrial(admin, "acct-1");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.state.status, "expired", "re-attempting start on an expired trial must never issue a fresh one");
  assert.equal(admin.__store.watch_trial_claims.length, 1, "the durable claim record must never be deleted or duplicated");
});

test("REQUIRED (test 11): the same Telegram numeric user id cannot obtain a trial through a second account", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [VERIFIED_TG, { account_id: "acct-2", telegram_user_id: 555, telegram_username: "kaleb2", verified_at: new Date().toISOString() }],
    watch_trial_claims: [{ account_id: "acct-1", telegram_user_id: 555, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString() }],
  });
  const result = await startWatchTrial(admin, "acct-2");
  assert.equal(result.ok, false, "a second account verified to the SAME Telegram identity must never claim a second trial");
  assert.equal(admin.__store.watch_trial_claims.length, 1);
});

test("REQUIRED (test 12): a Telegram username change does not reset eligibility -- the numeric id is the identity", async () => {
  const claim = { account_id: "acct-1", telegram_user_id: 555, started_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), ends_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() };
  const admin = fakeAdmin({ watch_telegram_links: [{ ...VERIFIED_TG, telegram_username: "brand_new_handle" }], watch_trial_claims: [claim] });
  const state = await getWatchTrialState(admin, "acct-1");
  assert.equal(state.status, "expired", "eligibility keys on telegram_user_id, never the mutable username");
});

test("REQUIRED (test 13): an active trial reports the real canonical capacity constants", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  await startWatchTrial(admin, "acct-1");
  assert.equal(await hasActiveWatchTrial(admin, "acct-1"), true);
  assert.equal(TRIAL_CAPACITY.maxActiveSlots, 1);
  assert.equal(TRIAL_CAPACITY.maxCommunities, 1);
});

test("a claim exactly at its expiry boundary is no longer active", async () => {
  const now = Date.now();
  const admin = fakeAdmin({ watch_trial_claims: [{ account_id: "acct-1", telegram_user_id: 1, started_at: new Date(now - 1000).toISOString(), ends_at: new Date(now - 1).toISOString() }] });
  assert.equal(await hasActiveWatchTrial(admin, "acct-1"), false);
});

test("hasActiveWatchTrial is false for an account with no claim at all", async () => {
  const admin = fakeAdmin({});
  assert.equal(await hasActiveWatchTrial(admin, "acct-1"), false);
});

test("trial state never leaks across accounts", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [VERIFIED_TG] });
  await startWatchTrial(admin, "acct-1");
  const other = await getWatchTrialState(admin, "acct-2");
  assert.equal(other.status, "telegram_required");
});
