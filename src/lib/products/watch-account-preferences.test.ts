import { test } from "node:test";
import assert from "node:assert/strict";
import { getAccountPreferences, setAccountPreferences } from "./watch-account-preferences";

type Row = Record<string, unknown>;

function fakeAdmin(seed: { watch_account_preferences?: Row[] }) {
  const store: Record<string, Row[]> = { watch_account_preferences: seed.watch_account_preferences ?? [] };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return {
        select() { return this; },
        eq(col: string, val: unknown) { filters.push([col, val]); return this; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const idx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx >= 0) { store[table][idx] = { ...store[table][idx], ...row }; return Promise.resolve({ data: null, error: null }); }
          store[table] = [...(store[table] ?? []), { ...row }];
          return Promise.resolve({ data: null, error: null });
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("REQUIRED: getAccountPreferences defaults to UTC/24h and persists the default on first read", async () => {
  const admin = fakeAdmin({});
  const prefs = await getAccountPreferences(admin, "acct-1");
  assert.deepEqual(prefs, { timezone: "UTC", timeFormat: "24h" });
  assert.equal(admin.__store.watch_account_preferences.length, 1);
});

test("getAccountPreferences returns the account's own saved preference, not a re-derived default", async () => {
  const admin = fakeAdmin({ watch_account_preferences: [{ account_id: "acct-1", timezone: "Asia/Manila", time_format: "12h" }] });
  const prefs = await getAccountPreferences(admin, "acct-1");
  assert.deepEqual(prefs, { timezone: "Asia/Manila", timeFormat: "12h" });
});

test("REQUIRED: preferences never leak across accounts", async () => {
  const admin = fakeAdmin({ watch_account_preferences: [{ account_id: "acct-2", timezone: "Asia/Manila", time_format: "12h" }] });
  const prefs = await getAccountPreferences(admin, "acct-1");
  assert.equal(prefs.timezone, "UTC", "acct-1 must get its own default, not acct-2's saved value");
});

test("REQUIRED: setAccountPreferences rejects an invalid IANA timezone -- never persists it", async () => {
  const admin = fakeAdmin({});
  const result = await setAccountPreferences(admin, "acct-1", "Not/AZone", "24h");
  assert.equal(result.ok, false);
  assert.equal(admin.__store.watch_account_preferences.length, 0);
});

test("setAccountPreferences accepts a real IANA timezone and getAccountPreferences reflects it afterward", async () => {
  const admin = fakeAdmin({});
  const result = await setAccountPreferences(admin, "acct-1", "Asia/Manila", "12h");
  assert.equal(result.ok, true);
  assert.deepEqual(await getAccountPreferences(admin, "acct-1"), { timezone: "Asia/Manila", timeFormat: "12h" });
});

test("setAccountPreferences trims whitespace from the timezone input", async () => {
  const admin = fakeAdmin({});
  await setAccountPreferences(admin, "acct-1", "  Asia/Manila  ", "24h");
  assert.equal((await getAccountPreferences(admin, "acct-1")).timezone, "Asia/Manila");
});
