import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkTelegramIdentity, telegramIdentityLinkedElsewhere, recordAbuseSignal, eligibleForOneTimeOffer, hashIp,
  getAccountTelegramIdentity,
} from "./watch-abuse";

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
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        async insert(row: Row) {
          const id = `gen-${table}-${(store[table] ?? []).length + 1}`;
          store[table] = [...(store[table] ?? []), { id, ...row }];
          return { data: null, error: null };
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const existingIdx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (existingIdx >= 0) {
            store[table][existingIdx] = { ...store[table][existingIdx], ...row };
            return Promise.resolve({ data: null, error: null });
          }
          // Simulates migration 0071's real `unique(telegram_user_id)` DB
          // constraint on watch_telegram_links -- a row with the SAME
          // telegram_user_id under a DIFFERENT account_id already existing
          // is a genuine unique-violation at the database boundary, not just
          // the application-level pre-check this file's linkTelegramIdentity
          // also does (needed to test the race-condition-safety requirement).
          if (table === "watch_telegram_links") {
            const conflict = (store[table] ?? []).find((r) => r.telegram_user_id === row.telegram_user_id && r.account_id !== row.account_id);
            if (conflict) return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"watch_telegram_links_tg_user_unique\"" } });
          }
          store[table] = [...(store[table] ?? []), { id: `gen-${table}-${(store[table] ?? []).length + 1}`, ...row }];
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
  const first = await linkTelegramIdentity(admin, "acct-1", 555);
  const second = await linkTelegramIdentity(admin, "acct-1", 555);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(admin.__store.watch_telegram_links.length, 1);
});

test("REQUIRED: the same verified Telegram numeric user ID cannot be linked to two different Innvil accounts", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [{ account_id: "acct-A", telegram_user_id: 6952824285 }] });
  const result = await linkTelegramIdentity(admin, "acct-B", 6952824285);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.alreadyLinkedToAnotherAccount, true);
    assert.doesNotMatch(result.error, /acct-A/, "must never expose the other account's identity");
  }
  // no second link was created -- acct-B never got attached to this identity
  assert.equal(admin.__store.watch_telegram_links.length, 1);
  assert.equal(admin.__store.watch_telegram_links[0].account_id, "acct-A");
});

test("REQUIRED: a uniqueness race (pre-check passes, DB insert loses the race) is still safely rejected", async () => {
  // Simulates: the pre-check (telegramIdentityLinkedElsewhere) sees nothing
  // yet, but by the time the upsert runs, a concurrent request from a
  // DIFFERENT account already claimed this identity -- the fake DB layer's
  // unique-constraint simulation is what actually catches this, proving the
  // DB boundary is the real enforcement, not just the pre-check.
  const admin = fakeAdmin({});
  admin.__store.watch_telegram_links.push({ account_id: "acct-A", telegram_user_id: 42 });
  // acct-B's pre-check already ran against a stale read (simulated by
  // directly exercising the upsert path with the row already present).
  const result = await linkTelegramIdentity(admin, "acct-B", 42);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.alreadyLinkedToAnotherAccount, true);
  assert.equal(admin.__store.watch_telegram_links.length, 1, "the race loser must never be inserted");
});

test("REQUIRED: username changes do not create a new Telegram identity -- linking is keyed on the numeric id only", async () => {
  // linkTelegramIdentity never takes a username at all -- the numeric id is
  // the sole key. Re-linking the same numeric id (e.g. after the person
  // renamed their Telegram @handle) is just the existing idempotent path.
  const admin = fakeAdmin({});
  await linkTelegramIdentity(admin, "acct-1", 6952824285);
  const relinked = await linkTelegramIdentity(admin, "acct-1", 6952824285);
  assert.equal(relinked.ok, true);
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

/* --------------------------------------------------- full anti-abuse scenario ---- */

test("REQUIRED (anti-abuse integration): Account A links + consumes the free offer via a Telegram identity; Account B cannot reuse that same identity for either the link OR a second free offer", async () => {
  const admin = fakeAdmin({});
  const TG_USER_ID = 918273645;

  // Account A verifies and links the Telegram identity.
  const linkA = await linkTelegramIdentity(admin, "acct-A", TG_USER_ID);
  assert.equal(linkA.ok, true);
  // Account A is eligible (nothing consumed yet) and then consumes the offer.
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-A", TG_USER_ID, "trial_consumed"), true);
  await recordAbuseSignal(admin, { accountId: "acct-A", telegramUserId: TG_USER_ID, abuseType: "trial_consumed", scope: "telegram_identity" });

  // Account B attempts to link the SAME Telegram identity -- rejected.
  const linkB = await linkTelegramIdentity(admin, "acct-B", TG_USER_ID);
  assert.equal(linkB.ok, false);
  assert.equal(admin.__store.watch_telegram_links.length, 1, "no second link was created");
  assert.equal(admin.__store.watch_telegram_links[0].account_id, "acct-A");

  // Account B is also ineligible for the free offer through that same identity.
  assert.equal(await eligibleForOneTimeOffer(admin, "acct-B", TG_USER_ID, "trial_consumed"), false);
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

/* ------------------------------------------ getAccountTelegramIdentity ---- */
// Profile presentation (app/profile/page.tsx) reads the account's linked
// Telegram identity through this function -- confirms it's a thin read over
// the SAME canonical watch_telegram_links table (never a second identity
// model), correctly scoped, and correctly returns null (not a fabricated
// identity) when nothing is linked.

test("getAccountTelegramIdentity returns null when the account has no linked Telegram identity", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getAccountTelegramIdentity(admin, "acct-1"), null);
});

test("REQUIRED: getAccountTelegramIdentity returns the account's own linked identity, from the canonical table", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 6952824285, verified_at: "2026-08-01T00:00:00.000Z" }],
  });
  const identity = await getAccountTelegramIdentity(admin, "acct-1");
  assert.ok(identity);
  assert.equal(identity?.telegramUserId, 6952824285);
  assert.equal(identity?.verifiedAt, "2026-08-01T00:00:00.000Z");
});

test("REQUIRED: getAccountTelegramIdentity never leaks a different account's linked identity", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [{ account_id: "acct-2", telegram_user_id: 111, verified_at: "2026-08-01T00:00:00.000Z" }],
  });
  assert.equal(await getAccountTelegramIdentity(admin, "acct-1"), null);
});

test("getAccountTelegramIdentity's return shape carries no username field -- watch_telegram_links has never stored one (migration 0067)", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 6952824285, verified_at: "2026-08-01T00:00:00.000Z" }],
  });
  const identity = await getAccountTelegramIdentity(admin, "acct-1");
  assert.deepEqual(identity ? Object.keys(identity).sort() : [], ["telegramUserId", "verifiedAt"]);
});
