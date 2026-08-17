import { test } from "node:test";
import assert from "node:assert/strict";
import { linkTelegramIdentity, telegramIdentityLinkedElsewhere, recordAbuseSignal, eligibleForOneTimeOffer, hashIp } from "./watch-abuse";

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_telegram_links?: Row[]; watch_abuse_signals?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_telegram_links: seed.watch_telegram_links ?? [],
    watch_abuse_signals: seed.watch_abuse_signals ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<[string, unknown, "eq" | "neq"]> = [];
      const rowsMatching = () =>
        (store[table] ?? []).filter((r) =>
          filters.every(([c, v, op]) => (op === "eq" ? r[c] === v : r[c] !== v))
        );
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push([col, val, "eq"]); return builder; },
        neq(col: string, val: unknown) { filters.push([col, val, "neq"]); return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        async insert(row: Row) {
          const id = `gen-${table}-${(store[table] ?? []).length + 1}`;
          store[table] = [...(store[table] ?? []), { id, ...row }];
          return { data: null, error: null };
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const existingIdx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (existingIdx >= 0) store[table][existingIdx] = { ...store[table][existingIdx], ...row };
          else store[table] = [...(store[table] ?? []), { id: `gen-${table}-${(store[table] ?? []).length + 1}`, ...row }];
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: rowsMatching(), error: null });
        },
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ---------------------------------------------------- Telegram identity ---- */

test("REQUIRED: linking is idempotent -- linking the same (account, telegram id) twice does not duplicate", async () => {
  const admin = fakeAdmin({});
  await linkTelegramIdentity(admin, "acct-1", 555);
  await linkTelegramIdentity(admin, "acct-1", 555);
  assert.equal(admin.__store.watch_telegram_links.length, 1);
});

test("REQUIRED: the SAME verified Telegram identity linked to a DIFFERENT account is detected", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [
      { account_id: "acct-1", telegram_user_id: 555 },
      { account_id: "acct-2", telegram_user_id: 555 },
    ],
  });
  const others = await telegramIdentityLinkedElsewhere(admin, "acct-1", 555);
  assert.deepEqual(others, ["acct-2"]);
});

test("a Telegram identity linked ONLY to this account reports no cross-account pattern", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 555 }] });
  assert.deepEqual(await telegramIdentityLinkedElsewhere(admin, "acct-1", 555), []);
});

/* --------------------------------------------------------- offer eligibility ---- */

test("REQUIRED: a fresh account+identity is eligible for the one-time offer", async () => {
  const admin = fakeAdmin({});
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-1", 555, "trial_consumed"), true);
});

test("REQUIRED: an account that already consumed the offer is ineligible, even under a different Telegram identity", async () => {
  const admin = fakeAdmin({
    watch_abuse_signals: [{ account_id: "acct-1", abuse_type: "trial_consumed", scope: "account" }],
  });
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-1", 999, "trial_consumed"), false);
});

test("REQUIRED: a NEW account cannot re-consume the offer if the SAME verified Telegram identity already did (cross-account abuse prevention)", async () => {
  const admin = fakeAdmin({
    watch_abuse_signals: [{ account_id: "acct-1", telegram_user_id: 555, abuse_type: "trial_consumed", scope: "telegram_identity" }],
  });
  // acct-2 is a brand new account, never itself consumed anything -- but shares the Telegram identity
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-2", 555, "trial_consumed"), false);
});

test("a different Telegram identity under a different account remains eligible", async () => {
  const admin = fakeAdmin({
    watch_abuse_signals: [{ account_id: "acct-1", telegram_user_id: 555, abuse_type: "trial_consumed", scope: "telegram_identity" }],
  });
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-2", 777, "trial_consumed"), true);
});

test("promo_consumed and trial_consumed are tracked independently", async () => {
  const admin = fakeAdmin({
    watch_abuse_signals: [{ account_id: "acct-1", abuse_type: "trial_consumed", scope: "account" }],
  });
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-1", null, "promo_consumed"), true);
});

test("recordAbuseSignal writes a row with the given fields", async () => {
  const admin = fakeAdmin({});
  await recordAbuseSignal(admin, { accountId: "acct-1", telegramUserId: 555, abuseType: "trial_consumed", scope: "telegram_identity" });
  assert.equal(admin.__store.watch_abuse_signals.length, 1);
  assert.equal(admin.__store.watch_abuse_signals[0].abuse_type, "trial_consumed");
});

/* -------------------------------------------------------------------- IP ---- */

test("REQUIRED: hashIp never returns the raw input", () => {
  const raw = "203.0.113.42";
  const hashed = hashIp(raw);
  assert.notEqual(hashed, raw);
  assert.equal(hashed.length, 64); // sha256 hex
});

test("hashIp is deterministic for the same input (needed for correlation) but differs across inputs", () => {
  assert.equal(hashIp("203.0.113.42"), hashIp("203.0.113.42"));
  assert.notEqual(hashIp("203.0.113.42"), hashIp("203.0.113.43"));
});
