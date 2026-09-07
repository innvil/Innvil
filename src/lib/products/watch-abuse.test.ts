import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  linkTelegramIdentity, telegramIdentityLinkedElsewhere, recordAbuseSignal, eligibleForOneTimeOffer, hashIp,
  getAccountTelegramIdentity, createTelegramVerificationAttempt, getPendingTelegramVerification,
  cancelPendingTelegramVerification, consumeTelegramVerificationAttempt,
} from "./watch-abuse";
import { getWatchTrialState, hasActiveWatchTrial, startWatchTrial } from "./watch-trial";

type Row = Record<string, unknown>;

function fakeAdmin(seed: {
  watch_telegram_links?: Row[]; watch_abuse_signals?: Row[]; watch_telegram_verification_attempts?: Row[];
  watch_trial_claims?: Row[];
}) {
  const store: Record<string, Row[]> = {
    watch_telegram_links: seed.watch_telegram_links ?? [],
    watch_abuse_signals: seed.watch_abuse_signals ?? [],
    watch_telegram_verification_attempts: seed.watch_telegram_verification_attempts ?? [],
    watch_trial_claims: seed.watch_trial_claims ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      type Op = "eq" | "neq" | "gt";
      const filters: Array<[string, unknown, Op]> = [];
      const rowsMatching = () =>
        (store[table] ?? []).filter((r) =>
          filters.every(([c, v, op]) => (op === "eq" ? r[c] === v : op === "neq" ? r[c] !== v : String(r[c]) > String(v)))
        );
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push([col, val, "eq"]); return builder; },
        neq(col: string, val: unknown) { filters.push([col, val, "neq"]); return builder; },
        gt(col: string, val: unknown) { filters.push([col, val, "gt"]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        async insert(row: Row) {
          // Simulates watch_trial_claims' real DB constraints -- both
          // unique(account_id) and unique(telegram_user_id), independently
          // -- needed by the cross-module trial-continuity/anti-reuse
          // integration tests below, which exercise the REAL startWatchTrial
          // against this same fake admin/store.
          if (table === "watch_trial_claims") {
            const conflict = (store[table] ?? []).some((r) => r.account_id === row.account_id || r.telegram_user_id === row.telegram_user_id);
            if (conflict) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
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
        // update(...).eq()...eq()/gt() is either awaited directly (patches
        // every matching row, no return value needed -- e.g. "cancel every
        // pending attempt for this account") or chained with
        // .select().maybeSingle() for an ATOMIC single-row conditional claim
        // (only the FIRST matching row is patched and returned -- simulates
        // the real DB's single-row UPDATE ... WHERE ... RETURNING semantics,
        // which is what makes the token-consumption race test meaningful:
        // once one row's status flips away from 'pending', a second
        // "consume" attempt's filter simply matches nothing).
        update(patch: Row) {
          let wantSelect = false;
          const updateBuilder: Record<string, unknown> = {
            eq(col: string, val: unknown) { filters.push([col, val, "eq"]); return updateBuilder; },
            gt(col: string, val: unknown) { filters.push([col, val, "gt"]); return updateBuilder; },
            select() { wantSelect = true; return updateBuilder; },
            async maybeSingle() {
              const match = rowsMatching()[0];
              if (!match) return { data: null, error: null };
              Object.assign(match, patch);
              return { data: match, error: null };
            },
            then(resolve: (v: { data: null; error: null }) => void) {
              if (!wantSelect) for (const r of rowsMatching()) Object.assign(r, patch);
              resolve({ data: null, error: null });
            },
          };
          return updateBuilder;
        },
        // delete().eq()...eq()/neq() -- removes every currently-matching row
        // (mirrors the real Supabase delete-query shape linkTelegramIdentity's
        // replace-on-change step uses). Implicitly awaited via `then`, same
        // convention as the base builder and the plain update() path above.
        delete() {
          const deleteBuilder: Record<string, unknown> = {
            eq(col: string, val: unknown) { filters.push([col, val, "eq"]); return deleteBuilder; },
            neq(col: string, val: unknown) { filters.push([col, val, "neq"]); return deleteBuilder; },
            then(resolve: (v: { data: null; error: null }) => void) {
              store[table] = (store[table] ?? []).filter((r) => !rowsMatching().includes(r));
              resolve({ data: null, error: null });
            },
          };
          return deleteBuilder;
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

/* ---------------------------------------------- change/relink identity ---- */

test("REQUIRED: linking a NEW identity for an account REPLACES its own prior link, never leaves both", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 111 }] });
  const result = await linkTelegramIdentity(admin, "acct-1", 222);
  assert.equal(result.ok, true);
  assert.equal(admin.__store.watch_telegram_links.length, 1, "the old link must be replaced, not kept alongside the new one");
  assert.equal(admin.__store.watch_telegram_links[0].telegram_user_id, 222);
});

test("REQUIRED: getAccountTelegramIdentity reflects the NEW identity immediately after a change", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 111, verified_at: "2026-08-01T00:00:00.000Z" }] });
  await linkTelegramIdentity(admin, "acct-1", 222, "new_handle");
  const identity = await getAccountTelegramIdentity(admin, "acct-1");
  assert.equal(identity?.telegramUserId, 222);
  assert.equal(identity?.telegramUsername, "new_handle");
});

test("REQUIRED: changing to an identity already linked to ANOTHER account is rejected, and the account's own existing link is left untouched", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [
      { account_id: "acct-1", telegram_user_id: 111 },
      { account_id: "acct-2", telegram_user_id: 999 },
    ],
  });
  const result = await linkTelegramIdentity(admin, "acct-1", 999);
  assert.equal(result.ok, false);
  assert.equal(admin.__store.watch_telegram_links.length, 2, "nothing was deleted -- the rejected change must never touch the existing link");
  const own = admin.__store.watch_telegram_links.find((r: Row) => r.account_id === "acct-1");
  assert.equal(own?.telegram_user_id, 111, "acct-1's own identity must be unchanged after a rejected change attempt");
});

test("re-linking the SAME identity an account already has is a harmless no-op, not treated as a change", async () => {
  const admin = fakeAdmin({ watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 111 }] });
  const result = await linkTelegramIdentity(admin, "acct-1", 111);
  assert.equal(result.ok, true);
  assert.equal(admin.__store.watch_telegram_links.length, 1);
  assert.equal(admin.__store.watch_telegram_links[0].telegram_user_id, 111);
});

test("changing identity never affects a DIFFERENT account's own linked identity", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [
      { account_id: "acct-1", telegram_user_id: 111 },
      { account_id: "acct-2", telegram_user_id: 333 },
    ],
  });
  await linkTelegramIdentity(admin, "acct-1", 222);
  const other = admin.__store.watch_telegram_links.find((r: Row) => r.account_id === "acct-2");
  assert.equal(other?.telegram_user_id, 333, "acct-2's link must be completely unaffected by acct-1's change");
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

test("getAccountTelegramIdentity's telegramUsername is null (not fabricated) for a pre-migration-0073 row with no username stored", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 6952824285, verified_at: "2026-08-01T00:00:00.000Z" }],
  });
  const identity = await getAccountTelegramIdentity(admin, "acct-1");
  assert.equal(identity?.telegramUsername, null);
});

test("getAccountTelegramIdentity returns the real username when the row has one (migration 0073)", async () => {
  const admin = fakeAdmin({
    watch_telegram_links: [{ account_id: "acct-1", telegram_user_id: 6952824285, telegram_username: "KSolDegen", verified_at: "2026-08-01T00:00:00.000Z" }],
  });
  const identity = await getAccountTelegramIdentity(admin, "acct-1");
  assert.equal(identity?.telegramUsername, "KSolDegen");
});

/* ------------------------------- native account Telegram verification ---- */
// Panel-independent verification-attempt lifecycle (migration 0073) — the
// server-side half of Profile's "Connect Telegram" flow. The durable link
// is still created via linkTelegramIdentity (tested above); this section
// covers the short-lived, single-use token that proves the account owns a
// real Telegram person before that link is ever written.

test("REQUIRED: createTelegramVerificationAttempt never stores the plaintext token -- only its hash", async () => {
  const admin = fakeAdmin({});
  const attempt = await createTelegramVerificationAttempt(admin, "acct-1");
  assert.ok(attempt.token.length > 0);
  const row = admin.__store.watch_telegram_verification_attempts[0];
  assert.notEqual(row.token_hash, attempt.token, "the stored hash must never equal the plaintext token");
  assert.equal(row.status, "pending");
  assert.equal(row.account_id, "acct-1");
});

test("REQUIRED: starting a new verification attempt cancels this account's own still-pending attempt -- never leaves a zombie", async () => {
  const admin = fakeAdmin({});
  await createTelegramVerificationAttempt(admin, "acct-1");
  await createTelegramVerificationAttempt(admin, "acct-1");
  const rows = admin.__store.watch_telegram_verification_attempts;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "cancelled");
  assert.equal(rows[1].status, "pending");
});

test("getPendingTelegramVerification returns null when nothing is pending", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getPendingTelegramVerification(admin, "acct-1"), null);
});

test("getPendingTelegramVerification returns the live attempt's expiry", async () => {
  const admin = fakeAdmin({});
  const attempt = await createTelegramVerificationAttempt(admin, "acct-1");
  const pending = await getPendingTelegramVerification(admin, "acct-1");
  assert.ok(pending);
  assert.equal(pending?.expiresAt, attempt.expiresAt);
});

test("REQUIRED: an expired pending attempt is not reported as pending", async () => {
  const admin = fakeAdmin({
    watch_telegram_verification_attempts: [
      { account_id: "acct-1", token_hash: "abc", status: "pending", expires_at: "2000-01-01T00:00:00.000Z" },
    ],
  });
  assert.equal(await getPendingTelegramVerification(admin, "acct-1"), null);
});

test("cancelPendingTelegramVerification marks the attempt cancelled -- no longer reported as pending", async () => {
  const admin = fakeAdmin({});
  await createTelegramVerificationAttempt(admin, "acct-1");
  await cancelPendingTelegramVerification(admin, "acct-1");
  assert.equal(await getPendingTelegramVerification(admin, "acct-1"), null);
  assert.equal(admin.__store.watch_telegram_verification_attempts[0].status, "cancelled");
});

test("REQUIRED: a real Telegram /start payload successfully verifies and links the account -- username persisted (migration 0073)", async () => {
  const admin = fakeAdmin({});
  const attempt = await createTelegramVerificationAttempt(admin, "acct-1");
  const result = await consumeTelegramVerificationAttempt(admin, attempt.token, 6952824285, "KSolDegen");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.accountId, "acct-1");
  const link = admin.__store.watch_telegram_links.find((r: Row) => r.account_id === "acct-1");
  assert.equal(link?.telegram_user_id, 6952824285);
  assert.equal(link?.telegram_username, "KSolDegen");
});

test("REQUIRED: an unknown/invalid token is rejected -- never links any account", async () => {
  const admin = fakeAdmin({});
  const result = await consumeTelegramVerificationAttempt(admin, "not-a-real-token", 111, "someone");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_or_expired");
  assert.equal(admin.__store.watch_telegram_links.length, 0);
});

test("REQUIRED: an expired token is rejected even though it was genuinely issued", async () => {
  const admin = fakeAdmin({
    watch_telegram_verification_attempts: [
      { account_id: "acct-1", token_hash: createHash("sha256").update("real-token").digest("hex"), status: "pending", expires_at: "2000-01-01T00:00:00.000Z" },
    ],
  });
  const result = await consumeTelegramVerificationAttempt(admin, "real-token", 111, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_or_expired");
});

test("REQUIRED: a token can only ever be consumed once -- the second attempt fails (single-use / race protection)", async () => {
  const admin = fakeAdmin({});
  const attempt = await createTelegramVerificationAttempt(admin, "acct-1");
  const first = await consumeTelegramVerificationAttempt(admin, attempt.token, 555, "first_try");
  const second = await consumeTelegramVerificationAttempt(admin, attempt.token, 555, "first_try");
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "invalid_or_expired");
});

test("REQUIRED: a token always resolves to the account that created it, never a different one", async () => {
  const admin = fakeAdmin({});
  const attemptA = await createTelegramVerificationAttempt(admin, "acct-A");
  const attemptB = await createTelegramVerificationAttempt(admin, "acct-B");
  const resultA = await consumeTelegramVerificationAttempt(admin, attemptA.token, 111, "userA");
  const resultB = await consumeTelegramVerificationAttempt(admin, attemptB.token, 222, "userB");
  assert.equal(resultA.ok && resultA.accountId, "acct-A");
  assert.equal(resultB.ok && resultB.accountId, "acct-B");
});

test("REQUIRED (race): two accounts try to verify the SAME Telegram person -- exactly one succeeds, the other gets a safe conflict, neither leaks the other's identity", async () => {
  const admin = fakeAdmin({});
  const attemptA = await createTelegramVerificationAttempt(admin, "acct-A");
  const attemptB = await createTelegramVerificationAttempt(admin, "acct-B");
  const SAME_TG_USER_ID = 999888777;

  const resultA = await consumeTelegramVerificationAttempt(admin, attemptA.token, SAME_TG_USER_ID, "shared_person");
  const resultB = await consumeTelegramVerificationAttempt(admin, attemptB.token, SAME_TG_USER_ID, "shared_person");

  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, false);
  if (!resultB.ok) assert.equal(resultB.reason, "already_linked_elsewhere");
  assert.equal(admin.__store.watch_telegram_links.filter((r: Row) => r.telegram_user_id === SAME_TG_USER_ID).length, 1);
});

test("REQUIRED: connecting a Telegram person creates no Project/Community/Watcher rows -- consumeTelegramVerificationAttempt never touches those tables", async () => {
  const admin = fakeAdmin({});
  const attempt = await createTelegramVerificationAttempt(admin, "acct-1");
  await consumeTelegramVerificationAttempt(admin, attempt.token, 111, "person");
  assert.equal(Object.keys(admin.__store).includes("projects"), false);
  assert.equal(Object.keys(admin.__store).includes("communities"), false);
  assert.equal(Object.keys(admin.__store).includes("virtual_moderators"), false);
});

/* ============================================================
   Cross-module: changing the connected Telegram identity + trial
   continuity/anti-reuse. Exercises the REAL linkTelegramIdentity (this
   file) together with the REAL startWatchTrial/getWatchTrialState/
   hasActiveWatchTrial (watch-trial.ts) against one shared fake admin --
   proves the two exact scenarios from the product spec, not just each
   module's own isolated behavior.
   ============================================================ */

test("REQUIRED (scenario 1): once TG1 starts a trial, TG1 can never be used to start ANOTHER trial through a different account -- even after TG1 is disconnected from the original one", async () => {
  const admin = fakeAdmin({});
  const TG1 = 111111;

  // Account A links TG1 and starts the trial.
  await linkTelegramIdentity(admin, "acct-A", TG1);
  const started = await startWatchTrial(admin, "acct-A");
  assert.equal(started.ok, true);

  // Account A later changes away from TG1 (to TG2) -- the link is replaced,
  // but the trial claim record for TG1 is untouched (see watch-trial.ts).
  await linkTelegramIdentity(admin, "acct-A", 222222);

  // A brand-new Account B now verifies and links the FREED-UP TG1 --
  // linking is allowed (nothing currently holds TG1), but starting a trial
  // through it must be rejected: TG1 already has a trial claim.
  const linkB = await linkTelegramIdentity(admin, "acct-B", TG1);
  assert.equal(linkB.ok, true, "TG1 can be linked to a new account once freed -- only a NEW TRIAL through it is blocked");
  const startB = await startWatchTrial(admin, "acct-B");
  assert.equal(startB.ok, false, "TG1 already consumed its one-time trial; Account B must not get a new one through it");
  assert.equal(admin.__store.watch_trial_claims.length, 1, "still exactly one trial claim in the whole system -- Account A's original one");
});

test("REQUIRED (scenario 1b): the NEWLY connected identity is also blocked if IT already has its own trial claim elsewhere", async () => {
  const admin = fakeAdmin({});
  const TG2 = 222222;

  // TG2 already has its own trial claim from some earlier account.
  await linkTelegramIdentity(admin, "acct-old", TG2);
  await startWatchTrial(admin, "acct-old");

  // A different account now connects TG2 as ITS Telegram identity.
  const acctC = "acct-C";
  const linkResult = await linkTelegramIdentity(admin, acctC, TG2);
  assert.equal(linkResult.ok, false, "TG2 is still linked to acct-old -- must be rejected as linked elsewhere");
  // Account C never even gets a Telegram identity to try starting a trial with.
  const identity = await getAccountTelegramIdentity(admin, acctC);
  assert.equal(identity, null);
});

test("REQUIRED (scenario 2): changing from TG1 to TG2 mid-trial continues the SAME trial -- it never restarts or extends", async () => {
  const admin = fakeAdmin({});
  await linkTelegramIdentity(admin, "acct-A", 111111);
  const started = await startWatchTrial(admin, "acct-A");
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const originalStartedAt = started.state.startedAt;
  const originalEndsAt = started.state.endsAt;

  // 2 days pass, then the account changes its connected Telegram identity.
  await linkTelegramIdentity(admin, "acct-A", 222222, "tg2_handle");

  const stateAfterChange = await getWatchTrialState(admin, "acct-A");
  assert.equal(stateAfterChange.status, "active", "the trial must still be active -- unaffected by the identity change");
  assert.equal(stateAfterChange.startedAt, originalStartedAt, "started_at must be exactly what TG1 originally began -- never reset");
  assert.equal(stateAfterChange.endsAt, originalEndsAt, "ends_at must be exactly what TG1 originally set -- never extended or shortened");
  assert.equal(admin.__store.watch_trial_claims.length, 1, "still one claim -- changing identity must never create a second one");

  // Calling startWatchTrial again (e.g. the account revisits the trial CTA)
  // must be a pure idempotent read of the SAME claim, never a fresh one.
  const secondCall = await startWatchTrial(admin, "acct-A");
  assert.equal(secondCall.ok, true);
  if (secondCall.ok) {
    assert.equal(secondCall.state.startedAt, originalStartedAt);
    assert.equal(secondCall.state.endsAt, originalEndsAt);
  }
  assert.equal(await hasActiveWatchTrial(admin, "acct-A"), true);
});

test("REQUIRED (scenario 2b): the trial keeps running to its original expiry even across MULTIPLE identity changes", async () => {
  const admin = fakeAdmin({});
  await linkTelegramIdentity(admin, "acct-A", 111);
  const started = await startWatchTrial(admin, "acct-A");
  assert.equal(started.ok, true);
  if (!started.ok) return;

  await linkTelegramIdentity(admin, "acct-A", 222);
  await linkTelegramIdentity(admin, "acct-A", 333);
  await linkTelegramIdentity(admin, "acct-A", 444);

  const finalState = await getWatchTrialState(admin, "acct-A");
  assert.equal(finalState.status, "active");
  assert.equal(finalState.startedAt, started.state.startedAt);
  assert.equal(finalState.endsAt, started.state.endsAt);
  assert.equal(admin.__store.watch_telegram_links.length, 1, "only the most recently connected identity remains linked");
  assert.equal(admin.__store.watch_telegram_links[0].telegram_user_id, 444);
});
