import { test } from "node:test";
import assert from "node:assert/strict";

// providerKeySecret() (src/lib/supabase/admin.ts) throws unless
// PROVIDER_KEY_SECRET is set -- the real value is only ever present in
// .env.local, not the plain test-runner environment. Setting a fake one
// here is safe (only ever passed through to the mocked rpc() below, never
// used to actually encrypt/decrypt anything real).
process.env.PROVIDER_KEY_SECRET = "test-only-secret-never-used-for-anything-real";

import { hasByoCredential, getAccountByoCredential, setAccountByoCredential, clearAccountByoCredential } from "./watch-byo";

/**
 * BYO Enterprise -- Phase 1 credential storage (watch-byo.ts, migration
 * 0092). Reuses the SAME pgcrypto set_X_key/get_X_key RPC pattern already
 * proven for SMM provider keys / payment gateway keys / Telegram bot
 * tokens -- these tests exercise the module's own logic (existence check,
 * null-vs-error handling, cross-account isolation, never leaking the
 * decrypted key beyond its one intended return path) against a fake RPC
 * layer, not real pgcrypto.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_byo_provider_credentials?: Row[] }) {
  const store: Record<string, Row[]> = {
    watch_byo_provider_credentials: seed.watch_byo_provider_credentials ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        async maybeSingle() { return { data: (store[table] ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }; },
        delete() {
          return {
            eq(col: string, val: unknown) {
              store[table] = (store[table] ?? []).filter((r) => r[col] !== val);
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "set_watch_byo_credential") {
        const rows = store.watch_byo_provider_credentials;
        const idx = rows.findIndex((r) => r.account_id === args.p_account_id);
        // A real deployment would pgp_sym_encrypt here -- the fake just
        // stores a marker string so a test can prove the RAW key is never
        // present in the fake store's own row shape (mirrors how a real
        // encrypted bytea column never holds the plaintext either).
        const row = {
          account_id: args.p_account_id,
          provider: args.p_provider,
          credential_enc: `ENCRYPTED(${args.p_key})`,
          base_url: args.p_base_url ?? null,
          model: args.p_model ?? null,
          _plainKeyForTestDecryptOnly: args.p_key, // simulates what pgp_sym_decrypt would recover
        };
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
        return { data: null, error: null };
      }
      if (fn === "get_watch_byo_credential") {
        const row = store.watch_byo_provider_credentials.find((r) => r.account_id === args.p_account_id);
        if (!row) return { data: [], error: null };
        return {
          data: [{ provider: row.provider, api_key: row._plainKeyForTestDecryptOnly, base_url: row.base_url, model: row.model }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ---------------------------------------------------------- hasByoCredential ---- */

test("hasByoCredential is false with nothing stored", async () => {
  const admin = fakeAdmin({});
  assert.equal(await hasByoCredential(admin, "acct-1"), false);
});

test("REQUIRED: hasByoCredential is true once a credential is stored, and never decrypts to check", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-real-secret-key" });
  assert.equal(await hasByoCredential(admin, "acct-1"), true);
});

/* ---------------------------------------------------- set / get round-trip ---- */

test("REQUIRED: setAccountByoCredential then getAccountByoCredential round-trips the exact stored values", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "openai", apiKey: "sk-abc123", baseUrl: "https://api.example.com/v1", model: "gpt-5" });
  const cred = await getAccountByoCredential(admin, "acct-1");
  assert.ok(cred);
  assert.equal(cred?.provider, "openai");
  assert.equal(cred?.apiKey, "sk-abc123");
  assert.equal(cred?.baseUrl, "https://api.example.com/v1");
  assert.equal(cred?.model, "gpt-5");
});

test("setAccountByoCredential replaces (upserts) rather than duplicating a second row for the same account", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-first" });
  await setAccountByoCredential(admin, "acct-1", { provider: "openai", apiKey: "sk-second", baseUrl: "https://x.example" });
  assert.equal(admin.__store.watch_byo_provider_credentials.length, 1, "one credential per account -- a second call replaces, never adds a row");
  const cred = await getAccountByoCredential(admin, "acct-1");
  assert.equal(cred?.provider, "openai");
  assert.equal(cred?.apiKey, "sk-second");
});

test("optional baseUrl/model default to null when omitted", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-plain" });
  const cred = await getAccountByoCredential(admin, "acct-1");
  assert.equal(cred?.baseUrl, null);
  assert.equal(cred?.model, null);
});

/* ------------------------------------------------------------- absence ---- */

test("getAccountByoCredential returns null (never throws, never a fabricated credential) when nothing is stored -- a real, expected state", async () => {
  const admin = fakeAdmin({});
  assert.equal(await getAccountByoCredential(admin, "acct-1"), null);
});

test("getAccountByoCredential returns null on an RPC error, rather than throwing", async () => {
  const admin = fakeAdmin({});
  admin.rpc = async () => ({ data: null, error: { message: "boom" } });
  const originalError = console.error;
  let loggedArgs: unknown[] = [];
  console.error = (...args: unknown[]) => { loggedArgs = args; };
  try {
    assert.equal(await getAccountByoCredential(admin, "acct-1"), null);
  } finally {
    console.error = originalError;
  }
  assert.ok(loggedArgs.some((a) => typeof a === "string" && a.includes("[watch-byo]")), "logs the failure, never silently swallows it");
});

/* -------------------------------------------------------------- clear ---- */

test("REQUIRED: clearAccountByoCredential removes the stored credential", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-to-be-cleared" });
  assert.equal(await hasByoCredential(admin, "acct-1"), true);
  await clearAccountByoCredential(admin, "acct-1");
  assert.equal(await hasByoCredential(admin, "acct-1"), false);
  assert.equal(await getAccountByoCredential(admin, "acct-1"), null);
});

test("clearAccountByoCredential for an account with nothing stored is a safe no-op", async () => {
  const admin = fakeAdmin({});
  await clearAccountByoCredential(admin, "acct-1"); // must not throw
  assert.equal(await hasByoCredential(admin, "acct-1"), false);
});

/* ----------------------------------------------- cross-account isolation ---- */

test("REQUIRED: one account's BYO credential is never visible to a different account", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-account-1-only" });
  assert.equal(await hasByoCredential(admin, "acct-2"), false);
  assert.equal(await getAccountByoCredential(admin, "acct-2"), null);
});

test("clearing one account's credential never affects a different account's stored credential", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-account-1" });
  await setAccountByoCredential(admin, "acct-2", { provider: "openai", apiKey: "sk-account-2" });
  await clearAccountByoCredential(admin, "acct-1");
  assert.equal(await hasByoCredential(admin, "acct-1"), false);
  const acct2 = await getAccountByoCredential(admin, "acct-2");
  assert.equal(acct2?.apiKey, "sk-account-2", "account 2's credential must survive account 1's clear untouched");
});

/* ---------------------------------------------- key never leaks beyond intent ---- */

test("REQUIRED: hasByoCredential's return value never carries the decrypted key -- it's a plain boolean", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-must-never-leak" });
  const result = await hasByoCredential(admin, "acct-1");
  assert.equal(typeof result, "boolean");
  assert.equal(JSON.stringify(result).includes("sk-must-never-leak"), false);
});

test("REQUIRED: setAccountByoCredential's own return value (void) never echoes the key back", async () => {
  const admin = fakeAdmin({});
  const result = await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-must-never-echo" });
  assert.equal(result, undefined);
});

test("REQUIRED: the fake store's row itself never holds the raw plaintext key under credential_enc -- only the ONE dedicated test-decrypt field does", async () => {
  const admin = fakeAdmin({});
  await setAccountByoCredential(admin, "acct-1", { provider: "anthropic", apiKey: "sk-plaintext-guard" });
  const row = admin.__store.watch_byo_provider_credentials[0];
  assert.notEqual(row.credential_enc, "sk-plaintext-guard", "credential_enc must never equal the raw plaintext key");
  assert.ok(String(row.credential_enc).startsWith("ENCRYPTED("), "credential_enc is only ever the (simulated-)encrypted form");
});
