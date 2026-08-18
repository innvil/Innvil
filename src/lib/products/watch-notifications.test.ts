import { test } from "node:test";
import assert from "node:assert/strict";
import { getNotificationPreferences, setNotificationCategory, sweepAttentionNotifications, sendTestNotificationEmail } from "./watch-notifications";

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

const ALL_ON = { no_active_watcher_enabled: true, capacity_warning_enabled: true, watcher_status_enabled: true };
const ALL_OFF = { no_active_watcher_enabled: false, capacity_warning_enabled: false, watcher_status_enabled: false };

/* ---------------------------------------------------------- preferences ---- */

test("REQUIRED: getNotificationPreferences defaults every category to enabled and persists the default on first read", async () => {
  const admin = fakeAdmin({});
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.deepEqual(prefs, { noActiveWatcherEnabled: true, capacityWarningEnabled: true, watcherStatusEnabled: true });
  assert.equal(admin.__store.watch_notification_preferences.length, 1);
  assert.equal(admin.__store.watch_notification_preferences[0].account_id, "acct-1");
});

test("getNotificationPreferences returns the account's own already-saved per-category values, not re-derived defaults", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-1", no_active_watcher_enabled: false, capacity_warning_enabled: true, watcher_status_enabled: false }] });
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.deepEqual(prefs, { noActiveWatcherEnabled: false, capacityWarningEnabled: true, watcherStatusEnabled: false });
});

test("setNotificationCategory updates only the ONE category, leaving the others untouched", async () => {
  const admin = fakeAdmin({});
  await getNotificationPreferences(admin, "acct-1"); // seed the default row
  await setNotificationCategory(admin, "acct-1", "capacityWarning", false);
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.deepEqual(prefs, { noActiveWatcherEnabled: true, capacityWarningEnabled: false, watcherStatusEnabled: true });
});

test("REQUIRED: notification preferences never leak across accounts", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-2", ...ALL_OFF }] });
  const prefs = await getNotificationPreferences(admin, "acct-1");
  assert.equal(prefs.noActiveWatcherEnabled, true, "acct-1 must get its own default, not acct-2's saved value");
});

/* -------------------------------------------------------------- sweep ---- */

test("sweepAttentionNotifications sends nothing when every category is disabled", async () => {
  const admin = fakeAdmin({ watch_notification_preferences: [{ account_id: "acct-1", ...ALL_OFF }] });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0);
});

test("REQUIRED: sweepAttentionNotifications never sends when the account has zero real attention items", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", ...ALL_ON }],
    users: { "acct-1": "owner@example.com" },
    // no communities/watchers at all -- listAccountAttentionItems resolves to []
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0, "no scheduled 'all clear' email");
});

test("REQUIRED: sweepAttentionNotifications sends when a real HIGH attention item exists (noActiveWatcher category), and records last_digest_sent_at", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", ...ALL_ON }],
    users: { "acct-1": "owner@example.com" },
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
    // zero deployments -> the Community has no active Watcher -> a real HIGH attention item
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 1);
  assert.ok(admin.__store.watch_notification_preferences[0].last_digest_sent_at);
});

test("REQUIRED: a disabled category's items are never sent, even while other categories stay on", async () => {
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", no_active_watcher_enabled: false, capacity_warning_enabled: true, watcher_status_enabled: true }],
    users: { "acct-1": "owner@example.com" },
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
    // the only real attention item here is the HIGH "no active watcher" one -- muted
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0, "the HIGH item's own category is disabled, so nothing is reported");
});

test("REQUIRED: an account digested within the last 24h is skipped even if it still has attention items", async () => {
  const recentIso = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
  const admin = fakeAdmin({
    watch_notification_preferences: [{ account_id: "acct-1", ...ALL_ON, last_digest_sent_at: recentIso }],
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
    watch_notification_preferences: [{ account_id: "acct-1", ...ALL_ON, last_digest_sent_at: oldIso }],
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
      { account_id: "acct-quiet", ...ALL_ON },
      { account_id: "acct-needs-it", ...ALL_ON },
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
    watch_notification_preferences: [{ account_id: "acct-1", ...ALL_ON }],
    projects: [{ id: "proj-1", account_id: "acct-1" }],
    communities: [{ id: "c1", project_id: "proj-1", title: "No Watcher Community" }],
    // no users entry -> getUserById resolves user: null
  });
  const result = await sweepAttentionNotifications(admin);
  assert.equal(result.sent, 0);
});

/* --------------------------------------------------------- test email ---- */
// RESEND_API_KEY is never set in this test environment -- these prove the
// function fails HONESTLY (never a fake "sent" success) rather than
// exercising real delivery, which is exactly what the missing-key guard is
// for (sendEmail itself would otherwise silently no-op, which -- without
// this explicit pre-check -- would look identical to a real send).

test("REQUIRED: sendTestNotificationEmail reports a real failure when email delivery isn't configured, never a fake success", async () => {
  const admin = fakeAdmin({ users: { "acct-1": "owner@example.com" } });
  const result = await sendTestNotificationEmail(admin, "acct-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /configured/i);
});

test("REQUIRED: sendTestNotificationEmail fails honestly when the account has no resolvable email", async () => {
  const admin = fakeAdmin({});
  const result = await sendTestNotificationEmail(admin, "acct-1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /no email/i);
});
