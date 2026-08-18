import { test } from "node:test";
import assert from "node:assert/strict";
import { getNotificationPreferences, setNotificationPreferences, sweepAttentionNotifications } from "./watch-notifications";

type Row = Record<string, unknown>;

/** Fake admin covering exactly what watch-notifications.ts touches:
 *  watch_notification_preferences (read/upsert/update), plus a stubbed
 *  listAccountAttentionItems-equivalent surface (communities/moderator_
 *  deployments/virtual_moderators/product_entitlements) and a fake
 *  auth.admin.getUserById for email resolution. */
function fakeAdmin(seed: {
  watch_notification_preferences?: Row[];
  communities?: Row[];
  moderator_deployments?: Row[];
  virtual_moderators?: Row[];
  projects?: Row[];
  product_entitlements?: Row[];
  users?: Record<string, string | undefined>;
}) {
  const store: Record<string, Row[]> = {
    watch_notification_preferences: seed.watch_notification_preferences ?? [],
    communities: seed.communities ?? [],
    moderator_deployments: seed.moderator_deployments ?? [],
    virtual_moderators: seed.virtual_moderators ?? [],
    projects: seed.projects ?? [],
    product_entitlements: seed.product_entitlements ?? [],
  };
  const users = seed.users ?? {};

  return {
    __store: store,
    auth: { admin: { async getUserById(id: string) { return { data: { user: users[id] ? { email: users[id] } : null } }; } } },
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push([col, val]); return builder; },
        in(col: string, vals: unknown[]) { filters.push([col, { __in: vals } as unknown]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const idx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx >= 0) { store[table][idx] = { ...store[table][idx], ...row }; return Promise.resolve({ data: null, error: null }); }
          store[table] = [...(store[table] ?? []), { ...row }];
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: Row) {
          return {
            eq(col: string, val: unknown) {
              const idx = (store[table] ?? []).findIndex((r) => r[col] === val);
              if (idx >= 0) store[table][idx] = { ...store[table][idx], ...patch };
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        then(resolve: (v: { data: Row[]; error: null; count?: number }) => void) {
          const rows = (store[table] ?? []).filter((r) =>
            filters.every(([c, v]) => {
              if (v && typeof v === "object" && "__in" in (v as Record<string, unknown>)) {
                return ((v as { __in: unknown[] }).__in).includes(r[c]);
              }
              return r[c] === v;
            })
          );
          resolve({ data: rows, error: null, count: rows.length });
        },
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ---------------------------------------------------------- preferences ---- */

test("REQUIRED: getNotificationPreferences defaults to enabled and persists the default on first read", async () => {
  const admin = fakeAdmin({});
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.equal(prefs.attentionAlertsEnabled, true);
  assert.equal(admin.__store.watch_notification_preferences.length, 1);
  assert.equal(admin.__store.watch_notification_preferences[0].account_id, "acct-1");
});

test("getNotificationPreferences returns the account's own already-saved preference, not a re-derived default", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: false }] });
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.equal(prefs.attentionAlertsEnabled, false);
});

test("setNotificationPreferences persists the new value and getNotificationPreferences reflects it", async () => {
  const admin = fakeAdmin({});
  await setNotificationPreferences(admin, "acct-1", false);
  assert.equal((await getNotificationPreferences(admin, "acct-1")).attentionAlertsEnabled, false);
});

test("REQUIRED: notification preferences never leak across accounts", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-2", attention_alerts_enabled: false }] });
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.equal(prefs.attentionAlertsEnabled, true, "acct-1 must get its own default, not acct-2's saved value");
});

/* -------------------------------------------------------------- sweep ---- */

test("sweepAttentionNotifications sends nothing when no account has alerts enabled", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: false }] });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0);
});

test("REQUIRED: sweepAttentionNotifications never sends when the account has zero real attention items", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: true }],
    users: { "acct-1": "owner@example.com" },
    // no communities/watchers at all -- listAccountAttentionItems resolves to []
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0, "no scheduled 'all clear' email");
});

test("REQUIRED: sweepAttentionNotifications sends when a real attention item exists, and records last_digest_sent_at", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: true }],
    users: { "acct-1": "owner@example.com" },
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
    // zero deployments -> the Community has no active Watcher -> a real HIGH attention item
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 1);
  assert.ok(admin.__store.watch_notification_preferences[0].last_digest_sent_at);
});

test("REQUIRED: an account digested within the last 24h is skipped even if it still has attention items", async () => {
  const recentIso = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: true, last_digest_sent_at: recentIso }],
    users: { "acct-1": "owner@example.com" },
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0);
});

test("REQUIRED: a digest sent more than 24h ago is eligible again", async () => {
  const oldIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: true, last_digest_sent_at: oldIso }],
    users: { "acct-1": "owner@example.com" },
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 1);
});

test("sweepAttentionNotifications is per-account isolated: one account's attention items never affect another's send decision", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [
      { account_id: "acct-quiet", attention_alerts_enabled: true },
      { account_id: "acct-needs-it", attention_alerts_enabled: true },
    ],
    users: { "acct-quiet": "quiet@example.com", "acct-needs-it": "needs@example.com" },
    projects: [{ id: "proj-needs", account_id: "acct-needs-it" }],
    communities: [{ id: "c1", project_id: "proj-needs", title: "Unwatched" }],
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.swept, 2);
  assert.equal(result.sent, 1, "only the account with a real attention item gets an email");
});

test("a real attention item is skipped, not fatal, when the account has no resolvable email", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", attention_alerts_enabled: true }],
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
    // no users entry -> getUserById resolves user: null
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0);
});
