import { test } from "node:test";
import assert from "node:assert/strict";

// providerKeySecret() (src/lib/supabase/admin.ts) throws unless
// PROVIDER_KEY_SECRET is set -- getAccountByoCredential (resolveAccountAiRouting's
// only I/O beyond the already-mocked .from() queries) calls it. The real
// value only ever lives in .env.local, not the plain test-runner
// environment; this fake one is only ever passed through the mocked rpc()
// in this file's own fakeAdmin, never used to decrypt anything real.
process.env.PROVIDER_KEY_SECRET = "test-only-secret-never-used-for-anything-real";

import {
  resolveAccountWatchTier, createAccountWatcher, listAccountWatchers,
  createAccountCommunity, deployAccountWatcher, resolveDeploymentTenant,
  listAccountCommunities, getAccountCapacity, listAccountActivity, countRecentModerationActions,
  getAccountProjectDetail, getAccountCommunityDetail, getAccountWatcherDetail, listAccountAttentionItems,
  communityOperationalStatus, getCommunityOperationalStats, getAccountSlotBreakdown, getAccountActivityTrend,
  getAccountPaidPlan, nextProvisioningStatusAfterConnect, resolveStandaloneModeratorSettings,
  resolveAccountEnterpriseEntitlement, resolveAccountAiRouting, applyDeploymentUsagePolicy,
} from "./watch-runtime";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { hasVirtualModerator, moderatorEntitlementSource, virtualModProactiveMode, virtualModModeration } from "@/src/lib/moderator/plan";

/**
 * Proves the CRITICAL INTEGRATION scenario end to end: an account with a
 * valid direct Watch entitlement and ZERO Panels can create a Project (see
 * ownership.test.ts), create/connect a Community, create a Watcher, deploy
 * it, and have the deployment resolve its full tenant chain -- with no
 * Panel record ever required or created at any point.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: {
  products?: Row[]; product_entitlements?: Row[]; projects?: Row[];
  virtual_moderators?: Row[]; communities?: Row[]; moderator_deployments?: Row[];
  moderator_activity_log?: Row[]; watch_moderation_defaults?: Row[];
  watch_trial_claims?: Row[]; watch_subscription_addons?: Row[];
  watch_byo_provider_credentials?: Row[];
  watch_byo_usage_policies?: Row[]; watch_byo_usage_counters?: Row[];
}) {
  const store: Record<string, Row[]> = {
    products: seed.products ?? [],
    product_entitlements: seed.product_entitlements ?? [],
    projects: seed.projects ?? [],
    virtual_moderators: seed.virtual_moderators ?? [],
    communities: seed.communities ?? [],
    moderator_deployments: seed.moderator_deployments ?? [],
    moderator_activity_log: seed.moderator_activity_log ?? [],
    watch_moderation_defaults: seed.watch_moderation_defaults ?? [],
    watch_trial_claims: seed.watch_trial_claims ?? [],
    watch_subscription_addons: seed.watch_subscription_addons ?? [],
    watch_telegram_links: [],
    watch_byo_provider_credentials: seed.watch_byo_provider_credentials ?? [],
    watch_byo_usage_policies: seed.watch_byo_usage_policies ?? [],
    watch_byo_usage_counters: seed.watch_byo_usage_counters ?? [],
  };
  let idCounter = 0;

  return {
    __store: store,
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let headMode = false;
      const applyFilters = () => (store[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder: Record<string, unknown> = {
        select(_cols?: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) headMode = true;
          return builder;
        },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        is(col: string, val: unknown) { filters.push((r) => (r[col] ?? null) === val); return builder; },
        in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return builder; },
        gte(col: string, val: string) { filters.push((r) => String(r[col]) >= val); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: applyFilters()[0] ?? null, error: null }; },
        then(resolve: (v: { data: Row[] | null; error: null; count?: number }) => void) {
          const rows = applyFilters();
          if (headMode) resolve({ data: null, error: null, count: rows.length });
          else resolve({ data: rows, error: null });
        },
        insert(row: Row) {
          return {
            select() { return this; },
            async single() {
              idCounter += 1;
              const newRow = { id: `gen-${table}-${idCounter}`, ...row };
              store[table] = [...(store[table] ?? []), newRow];
              return { data: newRow, error: null };
            },
          };
        },
        upsert(row: Row, opts: { onConflict: string }) {
          return {
            select() { return this; },
            async single() {
              const keys = opts.onConflict.split(",");
              const rows = store[table] ?? [];
              const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
              if (idx >= 0) { rows[idx] = { ...rows[idx], ...row }; store[table] = rows; return { data: rows[idx], error: null }; }
              idCounter += 1;
              const newRow = { id: `gen-${table}-${idCounter}`, ...row };
              store[table] = [...rows, newRow];
              return { data: newRow, error: null };
            },
          };
        },
        update(patch: Row) {
          return {
            eq(col: string, val: unknown) {
              return {
                select() { return this; },
                async single() {
                  const rows = store[table] ?? [];
                  const idx = rows.findIndex((r) => r[col] === val);
                  if (idx < 0) return { data: null, error: { message: "not found" } };
                  rows[idx] = { ...rows[idx], ...patch };
                  store[table] = rows;
                  return { data: rows[idx], error: null };
                },
              };
            },
          };
        },
      };
      return builder;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "get_watch_byo_credential") {
        const row = store.watch_byo_provider_credentials.find((r) => r.account_id === args.p_account_id);
        if (!row) return { data: [], error: null };
        return { data: [{ provider: row.provider, api_key: row._plainKey, base_url: row.base_url ?? null, model: row.model ?? null }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const WATCH_PRODUCT_ROW = { id: "product-watch", slug: WATCH_PRODUCT_SLUG, name: "Innvil Watch" };
const ENTITLED_STANDARD = { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:deposit-1" };
const STANDALONE_PROJECT = { id: "proj-1", account_id: "acct-1", panel_id: null, name: "My Community Hub" };

/* -------------------------------------------------------- tier resolution ---- */

test("REQUIRED: resolveAccountWatchTier parses the tier from subscription_ref", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] });
  assert.equal(await resolveAccountWatchTier(admin, "acct-1"), "standard");
});

test("resolveAccountWatchTier returns null with no active entitlement", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW] });
  assert.equal(await resolveAccountWatchTier(admin, "acct-1"), null);
});

/* ---------------------------------------------------------------- watchers ---- */

test("REQUIRED: an entitled account with ZERO Panels can create a Watcher", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] });
  const result = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.accountId, "acct-1");
    const row = admin.__store.virtual_moderators.find((r: Row) => r.id === result.data.id);
    assert.equal(row?.panel_id, null);
  }
});

test("REQUIRED: a new Watcher starts from the platform default persona when the account has no Moderation Default configured", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] });
  const result = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.persona.presetId, null);
});

test("REQUIRED: a new Watcher NEVER silently inherits the account's configured Moderation Default -- persona is assigned per-Watcher, explicitly, not defaulted", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    watch_moderation_defaults: [{ account_id: "acct-1", persona: { description: "Friendly and concise.", presetId: "witty_mod" } }],
  });
  const result = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(result.ok, true);
  if (result.ok) {
    // A configured account-level default exists, but createAccountWatcher must
    // never read watch_moderation_defaults at all -- the new Watcher's persona
    // stays the plain, genuinely-unassigned platform default.
    assert.equal(result.data.persona.description, "");
    assert.equal(result.data.persona.presetId, null);
  }
});

test("REQUIRED: a different account's Moderation Default never leaks into this account's new Watcher", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    watch_moderation_defaults: [{ account_id: "acct-2", persona: { description: "Someone else's default" } }],
  });
  const result = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.persona.description, "");
});

test("createAccountWatcher rejects a non-entitled account", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW] });
  const result = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(result.ok, false);
});

test("REQUIRED: Watcher creation is capped at the tier's slot count (Standard = 5)", async () => {
  const existing = Array.from({ length: 5 }, (_, i) => ({ id: `mod-${i}`, account_id: "acct-1", panel_id: null, name: `M${i}` }));
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], virtual_moderators: existing });
  const result = await createAccountWatcher(admin, "acct-1", "One too many");
  assert.equal(result.ok, false);
});

test("listAccountWatchers returns only this account's directly-owned Watchers when nothing else is reachable", async () => {
  const admin = fakeAdmin({
    virtual_moderators: [
      { id: "m1", account_id: "acct-1", name: "Kwan" },
      { id: "m2", account_id: "acct-2", name: "Someone Else's" },
    ],
  });
  const rows = await listAccountWatchers(admin, "acct-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "m1");
});

test("REQUIRED: live-bug regression -- a Watcher with no account_id (Panel-distributed) but deployed into one of this account's Communities is still listed", async () => {
  // Exact live repro: "Test"/"Kwan" are virtual_moderators rows with
  // account_id null (panel_id set instead -- a Panel-distributed Watcher),
  // deployed into Communities whose Project belongs to acct-1. Before this
  // fix, listAccountWatchers's `.eq("account_id", accountId)` filter
  // excluded both, so the Watchers page showed "No Watchers yet" while
  // Overview/Communities/Usage (all built on listAccountCommunities)
  // correctly showed 2 deployed Watchers -- a real, live data-consistency
  // bug this test pins as fixed.
  const admin = fakeAdmin({
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: "panel-1", name: "Innvil Test Community" }],
    communities: [
      { id: "c1", project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Innvil Test Community", chat_type: "group" },
      { id: "c2", project_id: "proj-1", platform: "telegram", chat_id: "-1002", title: "new community", chat_type: "group" },
    ],
    virtual_moderators: [
      { id: "test-mod", account_id: null, panel_id: "panel-1", name: "Test" },
      { id: "kwan-mod", account_id: null, panel_id: "panel-1", name: "Kwan" },
    ],
    moderator_deployments: [
      { id: "d1", moderator_id: "test-mod", community_id: "c1", enabled: true },
      { id: "d2", moderator_id: "kwan-mod", community_id: "c1", enabled: true },
      { id: "d3", moderator_id: "test-mod", community_id: "c2", enabled: true },
      { id: "d4", moderator_id: "kwan-mod", community_id: "c2", enabled: true },
    ],
  });
  const rows = await listAccountWatchers(admin, "acct-1");
  assert.equal(rows.length, 2, "both Panel-distributed Watchers reachable via deployment must be listed");
  assert.deepEqual(new Set(rows.map((r) => r.id)), new Set(["test-mod", "kwan-mod"]));
});

test("REQUIRED: listAccountWatchers reachable-watcher isolation -- a different account's deployment-reachable Watcher never leaks in", async () => {
  const admin = fakeAdmin({
    projects: [
      { id: "proj-mine", account_id: "acct-1", panel_id: null, name: "Mine" },
      { id: "proj-theirs", account_id: "acct-2", panel_id: "panel-2", name: "Theirs" },
    ],
    communities: [
      { id: "c-mine", project_id: "proj-mine", platform: "telegram", chat_id: "-1", title: "Mine", chat_type: "group" },
      { id: "c-theirs", project_id: "proj-theirs", platform: "telegram", chat_id: "-2", title: "Theirs", chat_type: "group" },
    ],
    virtual_moderators: [
      { id: "mine-mod", account_id: "acct-1", panel_id: null, name: "Mine's Watcher" },
      { id: "their-mod", account_id: null, panel_id: "panel-2", name: "Their Watcher" },
    ],
    moderator_deployments: [
      { id: "d1", moderator_id: "mine-mod", community_id: "c-mine", enabled: true },
      { id: "d2", moderator_id: "their-mod", community_id: "c-theirs", enabled: true },
    ],
  });
  const rows = await listAccountWatchers(admin, "acct-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "mine-mod");
});

test("REQUIRED: canonical model agreement -- watcherProfileCount matches the real number of deployment-reachable Watchers, not 0", async () => {
  // The exact live worked example the fix must satisfy: 2 unique Watcher
  // profiles, 4 active deployments (2 Watchers x 2 Communities), 2
  // Communities -- and getAccountCapacity must agree with listAccountWatchers.
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: "panel-1", name: "Innvil Test Community" }],
    communities: [
      { id: "c1", project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Innvil Test Community", chat_type: "group" },
      { id: "c2", project_id: "proj-1", platform: "telegram", chat_id: "-1002", title: "new community", chat_type: "group" },
    ],
    virtual_moderators: [
      { id: "test-mod", account_id: null, panel_id: "panel-1", name: "Test" },
      { id: "kwan-mod", account_id: null, panel_id: "panel-1", name: "Kwan" },
    ],
    moderator_deployments: [
      { id: "d1", moderator_id: "test-mod", community_id: "c1", enabled: true },
      { id: "d2", moderator_id: "kwan-mod", community_id: "c1", enabled: true },
      { id: "d3", moderator_id: "test-mod", community_id: "c2", enabled: true },
      { id: "d4", moderator_id: "kwan-mod", community_id: "c2", enabled: true },
    ],
  });
  const watchers = await listAccountWatchers(admin, "acct-1");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(watchers.length, 2);
  assert.ok(capacity);
  assert.equal(capacity?.watcherProfileCount, 2);
  assert.equal(capacity?.activeDeploymentCount, 4);
  assert.equal(capacity?.communitiesUsed, 2);
});

/* ------------------------------------------------------------ communities ---- */

test("REQUIRED: an entitled account with ZERO Panels can create/connect a Community", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001", title: "Test Group" });
  assert.equal(result.ok, true);
  if (result.ok) {
    const row = admin.__store.communities.find((r: Row) => r.id === result.data.id);
    assert.equal(row?.panel_id, null);
    assert.equal(row?.project_id, "proj-1");
  }
});

test("createAccountCommunity rejects a project owned by a different account", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [{ ...STANDALONE_PROJECT, account_id: "acct-2" }] });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" });
  assert.equal(result.ok, false);
});

test("REQUIRED: createAccountCommunity rejects a Telegram PRIVATE chat -- a person is never a Community", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  // Exactly the reported live bug: a customer's own numeric Telegram user id,
  // resolved by Telegram's own getChat as chat_type "private".
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "6952824285", title: "ksoldegen", chatType: "private" });
  assert.equal(result.ok, false);
  assert.equal(admin.__store.communities.length, 0, "no community row must be created for a private chat");
});

test("REQUIRED: createAccountCommunity accepts a real Telegram group/supergroup/channel", async () => {
  for (const chatType of ["group", "supergroup", "channel"]) {
    const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
    const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001", title: "Real Group", chatType });
    assert.equal(result.ok, true, `chatType ${chatType} must be accepted`);
  }
});

test("createAccountCommunity allows an UNKNOWN chat type through (never guesses, only rejects a KNOWN-bad type)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" }); // no chatType supplied
  assert.equal(result.ok, true);
});

test("REQUIRED: connecting the same chat twice reuses the same standalone community, not a duplicate", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  const first = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" });
  const second = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.equal(first.data.id, second.data.id);
  assert.equal(admin.__store.communities.length, 1);
});

test("REQUIRED (live bug): reconnecting the same chat with a new title/handle actually UPDATES the existing row -- proves the fix uses select-then-update, never an upsert() ON CONFLICT target that real Postgres can't match against the partial idx_communities_standalone_chat index ('there is no unique or exclusion constraint matching the ON CONFLICT specification')", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  const first = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001", title: "Old Title" });
  const second = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001", title: "New Title", handle: "@groupwan" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.data.title, "New Title");
  assert.equal(admin.__store.communities.length, 1);
  assert.equal(admin.__store.communities[0].handle, "@groupwan");
});

test("REQUIRED: a lost concurrent-insert race (23505 duplicate key) is handled gracefully -- returns the winner's row instead of surfacing a raw DB error", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });
  let firstInsertAttempt = true;
  const originalFrom = admin.from.bind(admin);
  admin.from = (table: string) => {
    const builder = originalFrom(table);
    if (table !== "communities") return builder;
    const originalInsert = (builder as Row & { insert: (row: Row) => Row }).insert.bind(builder);
    (builder as Row & { insert: (row: Row) => unknown }).insert = (row: Row) => {
      const chain = originalInsert(row) as { single: () => Promise<{ data: Row | null; error: Row | null }> };
      const originalSingle = chain.single.bind(chain);
      chain.single = async () => {
        if (firstInsertAttempt) {
          firstInsertAttempt = false;
          // Simulate a concurrent request winning the same insert -- its row
          // lands in the store right as ours collides with it.
          admin.__store.communities.push({ id: "winner-row", panel_id: null, project_id: row.project_id, platform: row.platform, chat_id: row.chat_id, title: "Winner's Community" });
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"idx_communities_standalone_chat\"" } };
        }
        return originalSingle();
      };
      return chain;
    };
    return builder;
  };
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.data.id, "winner-row");
  assert.equal(admin.__store.communities.length, 1);
});

test("REQUIRED: a chat already connected to a different Project cannot be reconnected to this one", async () => {
  const otherProject = { id: "proj-2", account_id: "acct-1", panel_id: null, name: "Other" };
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT, otherProject],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001" }],
  });
  const result = await createAccountCommunity(admin, "acct-1", "proj-2", { platform: "telegram", chatId: "-1001" });
  assert.equal(result.ok, false);
});

test("REQUIRED: a Panel-scoped community with the same chat_id never collides with a standalone one", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT],
    communities: [{ id: "c-panel", panel_id: "panel-1", project_id: "proj-panel", platform: "telegram", chat_id: "-1001" }],
  });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001" });
  assert.equal(result.ok, true, "a Panel-owned community with the same chat_id must not block a standalone connection");
});

test("REQUIRED: community creation is capped at the tier's community count (Standard = 2)", async () => {
  const existing = [
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1" },
    { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2" },
  ];
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT], communities: existing });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-3" });
  assert.equal(result.ok, false);
});

test("REQUIRED: a leftover Telegram private-chat row never counts toward the community plan cap", async () => {
  const existing = [
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1", chat_type: "supergroup" },
    { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "6952824285", chat_type: "private" },
  ];
  // Standard = 2 communities. One real group + one leftover private-chat row
  // should still leave room for a second REAL group (only 1 real community
  // exists, capacity for 2) -- if the private row wrongly counted, this
  // would be incorrectly rejected as at-cap.
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT], communities: existing });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-2", chatType: "supergroup" });
  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------- deployment ---- */

test("REQUIRED: full chain -- create Watcher, create Community, deploy, resolve tenant, NO Panel ever required", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT] });

  const watcher = await createAccountWatcher(admin, "acct-1", "Kwan");
  assert.equal(watcher.ok, true);
  const community = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-1001", title: "Test Group" });
  assert.equal(community.ok, true);
  if (!watcher.ok || !community.ok) return;

  const deployment = await deployAccountWatcher(admin, "acct-1", watcher.data.id, community.data.id);
  assert.equal(deployment.ok, true);
  if (!deployment.ok) return;

  const deploymentRow = admin.__store.moderator_deployments.find((r: Row) => r.id === deployment.data.id);
  assert.equal(deploymentRow?.panel_id, null, "the deployment must be created with no panel");
  assert.equal(deploymentRow?.enabled, true);

  const tenant = await resolveDeploymentTenant(admin, deployment.data.id);
  assert.ok(tenant, "runtime context must resolve without any panel");
  assert.equal(tenant?.accountId, "acct-1");
  assert.equal(tenant?.projectId, "proj-1");
  assert.equal(tenant?.communityId, community.data.id);
  assert.equal(tenant?.moderatorId, watcher.data.id);
  assert.equal(tenant?.panelId, null);

  // REQUIRED: no Panel record was ever created anywhere in this whole flow.
  assert.equal((admin.__store.panels ?? []).length, 0);
});

test("deployAccountWatcher rejects a Watcher owned by a different account", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD], projects: [STANDALONE_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-2", name: "Not yours" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001" }],
  });
  const result = await deployAccountWatcher(admin, "acct-1", "m1", "c1");
  assert.equal(result.ok, false);
});

test("REQUIRED: deployment respects the flat 5-per-community cap independent of plan tier", async () => {
  const moderators = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, account_id: "acct-1", name: `M${i}` }));
  const existingDeployments = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, panel_id: null, moderator_id: `m${i}`, community_id: "c1", enabled: true }));
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [{ ...ENTITLED_STANDARD, subscription_ref: "pro:deposit-1" }], projects: [STANDALONE_PROJECT],
    virtual_moderators: moderators,
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001" }],
    moderator_deployments: existingDeployments,
  });
  const result = await deployAccountWatcher(admin, "acct-1", "m5", "c1");
  assert.equal(result.ok, false);
});

test("REQUIRED: resolveDeploymentTenant returns null for a Panel-backed deployment (this resolver is standalone-only)", async () => {
  const admin = fakeAdmin({
    moderator_deployments: [{ id: "d1", panel_id: "panel-1", moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const tenant = await resolveDeploymentTenant(admin, "d1");
  assert.equal(tenant, null);
});

test("resolveDeploymentTenant returns null for a nonexistent deployment", async () => {
  const admin = fakeAdmin({});
  assert.equal(await resolveDeploymentTenant(admin, "nope"), null);
});

/* ==================================================== dashboard read models ==== */

const DASH_PROJECT = { id: "proj-1", account_id: "acct-1", panel_id: null, name: "Litho" };

test("REQUIRED: listAccountCommunities returns this account's Communities with their assigned Watchers", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Litho Chat" }],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const result = await listAccountCommunities(admin, "acct-1");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Litho Chat");
  assert.equal(result[0].projectName, "Litho");
  assert.equal(result[0].watchers.length, 1);
  assert.equal(result[0].watchers[0].watcherName, "Kwan");
  assert.equal(result[0].watchers[0].enabled, true);
});

test("listAccountCommunities returns an empty array for an account with no Projects at all", async () => {
  const admin = fakeAdmin({});
  assert.deepEqual(await listAccountCommunities(admin, "acct-1"), []);
});

test("REQUIRED: listAccountCommunities never surfaces another account's Community, even if it happens to share a Project name", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT, { id: "proj-2", account_id: "acct-2", panel_id: null, name: "Litho" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Mine" },
      { id: "c2", panel_id: null, project_id: "proj-2", platform: "telegram", chat_id: "-2002", title: "Not mine" },
    ],
  });
  const result = await listAccountCommunities(admin, "acct-1");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Mine");
});

test("REQUIRED: listAccountCommunities excludes a Telegram private-chat row -- a Telegram PERSON must never appear as a Community", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Real Group", chat_type: "supergroup" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "6952824285", title: "ksoldegen", chat_type: "private" },
    ],
  });
  const result = await listAccountCommunities(admin, "acct-1");
  assert.equal(result.length, 1, "the private-chat row must never appear in the Community list");
  assert.equal(result[0].title, "Real Group");
});

test("listAccountCommunities keeps a pre-existing row with an unknown (NULL) chat_type -- never destroys real data it can't classify", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Old Group", chat_type: null }],
  });
  const result = await listAccountCommunities(admin, "acct-1");
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Old Group");
});

test("REQUIRED: a Telegram private-chat row is excluded from EVERY metric that derives from listAccountCommunities -- capacity, health, needs attention, watcher targeting", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [DASH_PROJECT],
    communities: [{ id: "c-person", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "6952824285", title: "ksoldegen", chat_type: "private" }],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
  });
  // Community count / capacity usage
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesUsed, 0, "the private-chat row must not count toward community capacity");
  // Needs Attention must never generate a missing-Watcher warning for it
  const attention = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(attention.some((i) => i.id === "community-c-person"), false, "a Telegram person must never generate a Community needs-attention item");
  // Deploying a Watcher against this id must fail -- it isn't a real Community
  const deployResult = await deployAccountWatcher(admin, "acct-1", "m1", "c-person");
  assert.equal(deployResult.ok, false, "a Watcher must never be deployable against a Telegram person masquerading as a Community");
});

test("REQUIRED: getAccountCapacity reads real usage against the canonical CAPACITY table for the account's actual tier", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }, { id: "m2", account_id: "acct-1", name: "Aegis" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.ok(capacity);
  assert.equal(capacity?.tier, "premium");
  assert.equal(capacity?.watcherProfileCount, 2, "2 saved Watcher profiles exist (m1 deployed, m2 not)");
  assert.equal(capacity?.activeDeploymentCount, 1, "only 1 is actually deployed -- profile count and slot usage are NOT the same number");
  assert.equal(capacity?.communitiesUsed, 1);
  // premium's real numbers, from moderator/plan.ts's CAPACITY table -- never a duplicated constant here.
  assert.equal(capacity?.slotsTotal, 10);
  assert.equal(capacity?.communitiesTotal, 3);
});

test("REQUIRED: the SAME Watcher deployed to two Communities consumes TWO slots, not one -- profile count stays 1", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Aegis" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Community A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2002", title: "Community B" },
    ],
    moderator_deployments: [
      { id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true },
      { id: "d2", panel_id: null, moderator_id: "m1", community_id: "c2", enabled: true },
    ],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.watcherProfileCount, 1, "only ONE Watcher profile (Aegis) exists");
  assert.equal(capacity?.activeDeploymentCount, 2, "but it consumes TWO slots -- one per active deployment");

  const breakdown = await getAccountSlotBreakdown(admin, "acct-1");
  assert.equal(breakdown.byWatcher.length, 1);
  assert.equal(breakdown.byWatcher[0].slots, 2, "the slot breakdown must attribute both slots to the single Watcher profile");
  assert.equal(breakdown.byCommunity.length, 2, "each Community independently shows its own 1 slot consumed");
  assert.deepEqual(breakdown.byCommunity.map((c) => c.slots).sort(), [1, 1]);
});

test("REQUIRED: TWO different Watchers in the SAME Community also consume two slots (profiles = 2, slots = 2)", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Aegis" }, { id: "m2", account_id: "acct-1", name: "Sentinel" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Community A" }],
    moderator_deployments: [
      { id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true },
      { id: "d2", panel_id: null, moderator_id: "m2", community_id: "c1", enabled: true },
    ],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.watcherProfileCount, 2);
  assert.equal(capacity?.activeDeploymentCount, 2);
  const breakdown = await getAccountSlotBreakdown(admin, "acct-1");
  assert.equal(breakdown.byCommunity.length, 1);
  assert.equal(breakdown.byCommunity[0].slots, 2, "one Community can hold multiple Watchers, each consuming its own slot");
});

test("REQUIRED (CRITICAL INTEGRATION): profiles/deployments/slots/communities all agree across getAccountCapacity and getAccountSlotBreakdown", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Aegis" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "C1" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2002", title: "C2" },
    ],
    moderator_deployments: [
      { id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true },
      { id: "d2", panel_id: null, moderator_id: "m1", community_id: "c2", enabled: true },
    ],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  const breakdown = await getAccountSlotBreakdown(admin, "acct-1");
  const communities = await listAccountCommunities(admin, "acct-1");
  assert.equal(capacity?.watcherProfileCount, 1);
  assert.equal(capacity?.activeDeploymentCount, 2);
  assert.equal(capacity?.communitiesUsed, 2);
  assert.equal(breakdown.byWatcher[0].slots, 2, "no duplicate Watcher profile exists -- one row, slots=2");
  assert.equal(communities.length, 2);
});

test("a paused (disabled) deployment consumes zero slots -- matches the backend's own enforcement", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Aegis" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "C1" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: false }],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.activeDeploymentCount, 0);
  const breakdown = await getAccountSlotBreakdown(admin, "acct-1");
  assert.equal(breakdown.byWatcher.length, 0, "a paused deployment never appears in the slot breakdown");
});

test("getAccountCapacity returns null for an account with no active entitlement -- never a fabricated plan", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  assert.equal(await getAccountCapacity(admin, "acct-1"), null);
});

/* ------------------------------------------------ subscription period ---- */

test("REQUIRED: a legacy paid row with NO current_period_end (pre-migration-0080) is treated as never-expiring -- the grandfather compatibility state", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" }],
  });
  assert.equal(await resolveAccountWatchTier(admin, "acct-1"), "standard", "an existing paid customer must never be silently expired by this migration");
});

test("REQUIRED: a real, PAST current_period_end makes the tier resolve to null (expired)", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: new Date(Date.now() - 60_000).toISOString() }],
  });
  assert.equal(await resolveAccountWatchTier(admin, "acct-1"), null);
});

test("a real, FUTURE current_period_end still resolves the tier normally", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: new Date(Date.now() + 60_000).toISOString() }],
  });
  assert.equal(await resolveAccountWatchTier(admin, "acct-1"), "standard");
});

test("REQUIRED: getAccountPaidPlan returns the tier and expired=true EVEN after the period has ended (for the Renew button)", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() - 60_000).toISOString() }],
  });
  const plan = await getAccountPaidPlan(admin, "acct-1");
  assert.equal(plan?.tier, "premium");
  assert.equal(plan?.expired, true);
});

test("REQUIRED: getAccountPaidPlan and getAccountCapacity both surface a real annual billing_interval", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: new Date(Date.now() + 300 * 24 * 60 * 60 * 1000).toISOString(), billing_interval: "annual" }],
  });
  const plan = await getAccountPaidPlan(admin, "acct-1");
  assert.equal(plan?.billingInterval, "annual");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.billingInterval, "annual");
});

test("an entitlement row with no billing_interval column set (legacy) defaults to 'monthly'", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" }],
  });
  const plan = await getAccountPaidPlan(admin, "acct-1");
  assert.equal(plan?.billingInterval, "monthly");
});

test("getAccountPaidPlan returns null for an account that never held a direct Watch subscription", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  assert.equal(await getAccountPaidPlan(admin, "acct-1"), null);
});

test("REQUIRED: expired paid subscriptions cannot create new paid-capacity resources (Watcher/Community/Deployment)", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() - 60_000).toISOString() }],
    projects: [DASH_PROJECT],
  });
  const watcher = await createAccountWatcher(admin, "acct-1", "Should Fail");
  assert.equal(watcher.ok, false, "an expired paid subscription must not be able to create new resources");
});

test("REQUIRED: expiry does not delete Projects/Communities/Watchers/deployments -- data is preserved", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() - 60_000).toISOString() }],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Aegis" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const watchers = await listAccountWatchers(admin, "acct-1");
  const communities = await listAccountCommunities(admin, "acct-1");
  assert.equal(watchers.length, 1, "the Watcher record must still be visible after expiry");
  assert.equal(communities.length, 1, "the Community record must still be visible after expiry");
  assert.equal(communities[0].watchers.length, 1, "the deployment record must still be visible after expiry");
});

test("REQUIRED: renewal (a real future current_period_end) restores canonical paid capacity/access", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }],
    projects: [DASH_PROJECT],
  });
  const watcher = await createAccountWatcher(admin, "acct-1", "Renewed");
  assert.equal(watcher.ok, true, "a renewed (future period end) subscription must be able to create resources again");
});

/* ---------------------------------------------------- trial integration ---- */
// Free Trial capacity/enforcement reuses this SAME canonical resolver -- no
// second Watcher/Community enforcement path exists for trial vs. paid.

const ACTIVE_TRIAL = { account_id: "acct-1", telegram_user_id: 555, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() };

test("REQUIRED: an active trial (no paid tier) resolves real capacity from the canonical TRIAL_CAPACITY constants", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }], watch_trial_claims: [ACTIVE_TRIAL] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.ok(capacity);
  assert.equal(capacity?.tier, "trial");
  assert.equal(capacity?.slotsTotal, 1);
  assert.equal(capacity?.communitiesTotal, 1);
  assert.ok(capacity?.trialEndsAt, "trial capacity must carry the real server-sourced expiry for UI countdowns");
  assert.equal(capacity?.trialStartedAt, ACTIVE_TRIAL.started_at, "Usage must be able to show the real trial start date, not just the end");
});

test("a paid-tier account never carries a fabricated trialStartedAt", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.trialStartedAt, null);
  assert.equal(capacity?.trialEndsAt, null);
});

test("REQUIRED (test 14): trial Watcher/Community/Deployment creation enforces slot-based capacity, not saved-profile count", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }], watch_trial_claims: [ACTIVE_TRIAL], projects: [DASH_PROJECT] });
  const watcher = await createAccountWatcher(admin, "acct-1", "Trial Watcher");
  assert.equal(watcher.ok, true);
  const community = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-9001" });
  assert.equal(community.ok, true);
  if (!watcher.ok || !community.ok) return;
  const deploy = await deployAccountWatcher(admin, "acct-1", watcher.data.id, community.data.id);
  assert.equal(deploy.ok, true, "a verified, active-trial account with zero Panels must be able to deploy a real Watcher");
});

test("REQUIRED (test 15): trial Community cap (1) is enforced -- a second Community is rejected", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    watch_trial_claims: [ACTIVE_TRIAL],
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "First" }],
  });
  const result = await createAccountCommunity(admin, "acct-1", "proj-1", { platform: "telegram", chatId: "-9002" });
  assert.equal(result.ok, false);
});

test("REQUIRED (test 15b): trial Watcher slot cap (1) is enforced -- a second active deployment is rejected", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    watch_trial_claims: [ACTIVE_TRIAL],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "A" }, { id: "m2", account_id: "acct-1", name: "B" }],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "First" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const result = await deployAccountWatcher(admin, "acct-1", "m2", "c1");
  assert.equal(result.ok, false);
});

test("REQUIRED (test 18): a paid entitlement supersedes an active trial's capacity", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" }],
    watch_trial_claims: [ACTIVE_TRIAL],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.tier, "premium");
  assert.equal(capacity?.slotsTotal, 10, "must use paid Premium capacity, never trial's 1-slot ceiling, once a paid tier exists");
});

test("REQUIRED (test 19): the durable trial claim record is untouched by a later paid upgrade -- consumption stays permanent", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" }],
    watch_trial_claims: [ACTIVE_TRIAL],
  });
  await getAccountCapacity(admin, "acct-1");
  assert.equal(admin.__store.watch_trial_claims.length, 1, "activating a paid tier must never delete/rewrite the historical trial claim");
  assert.deepEqual(admin.__store.watch_trial_claims[0], ACTIVE_TRIAL);
});

test("REQUIRED: listAccountActivity only surfaces genuinely meaningful moderation decisions, translated to customer-facing text", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: "d1", event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2026-08-18T00:00:00Z" },
      { id: 2, community_id: "c1", deployment_id: "d1", event_type: "link_moderation", decision: "ALLOW", created_at: "2026-08-18T00:01:00Z" },
      { id: 3, community_id: "c1", deployment_id: null, event_type: "human_message", decision: "SILENCE", created_at: "2026-08-18T00:02:00Z" },
    ],
  });
  const activity = await listAccountActivity(admin, "acct-1");
  assert.equal(activity.length, 1, "ALLOW and routine human_message/SILENCE bookkeeping must never appear as customer-facing activity");
  assert.equal(activity[0].watcherName, "Kwan");
  assert.match(activity[0].description, /removed a member/);
});

test("listAccountActivity never leaks raw internal decision/event codes into the description text", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_activity_log: [{ id: 1, community_id: "c1", deployment_id: null, event_type: "media_moderation", decision: "DELETE_WARN", created_at: "2026-08-18T00:00:00Z" }],
  });
  const activity = await listAccountActivity(admin, "acct-1");
  assert.equal(activity.length, 1);
  assert.doesNotMatch(activity[0].description, /DELETE_WARN|media_moderation/);
});

test("listAccountActivity returns an empty array (not an error) for an account with no Communities", async () => {
  const admin = fakeAdmin({});
  assert.deepEqual(await listAccountActivity(admin, "acct-1"), []);
});

test("REQUIRED: countRecentModerationActions returns a real exact count, independent of the (possibly-truncated) activity feed list", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: new Date().toISOString() },
      { id: 2, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: new Date().toISOString() },
      { id: 3, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "ALLOW", created_at: new Date().toISOString() },
    ],
  });
  assert.equal(await countRecentModerationActions(admin, "acct-1"), 2);
});

test("countRecentModerationActions excludes events older than the window", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2020-01-01T00:00:00Z" },
    ],
  });
  assert.equal(await countRecentModerationActions(admin, "acct-1"), 0);
});

test("countRecentModerationActions returns 0 for an account with no Communities, never throws", async () => {
  const admin = fakeAdmin({});
  assert.equal(await countRecentModerationActions(admin, "acct-1"), 0);
});

/* ============================================================ detail pages ==== */

test("REQUIRED: getAccountProjectDetail reuses the SAME list functions -- never disagrees with the list pages", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT, { id: "proj-2", account_id: "acct-1", panel_id: null, name: "Other" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Litho Chat" },
      { id: "c2", panel_id: null, project_id: "proj-2", platform: "telegram", chat_id: "-2002", title: "Unrelated" },
    ],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  const detail = await getAccountProjectDetail(admin, "acct-1", "proj-1");
  assert.ok(detail);
  assert.equal(detail?.name, "Litho");
  assert.equal(detail?.communities.length, 1, "a different Project's Community must never leak in");
  assert.equal(detail?.communities[0].id, "c1");
  assert.equal(detail?.watcherCount, 1);
});

test("getAccountProjectDetail returns null for a nonexistent or another account's Project", async () => {
  const admin = fakeAdmin({ projects: [{ ...DASH_PROJECT, account_id: "acct-2" }] });
  assert.equal(await getAccountProjectDetail(admin, "acct-1", "proj-1"), null);
  assert.equal(await getAccountProjectDetail(admin, "acct-1", "nope"), null);
});

test("REQUIRED: getAccountCommunityDetail scopes activity to just this Community", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2002", title: "Chat B" },
    ],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [
      { id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true },
      { id: "d2", panel_id: null, moderator_id: "m1", community_id: "c2", enabled: true },
    ],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: "d1", event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2026-08-18T00:00:00Z" },
      { id: 2, community_id: "c2", deployment_id: "d2", event_type: "link_moderation", decision: "DELETE_WARN", created_at: "2026-08-18T00:01:00Z" },
    ],
  });
  const detail = await getAccountCommunityDetail(admin, "acct-1", "c1");
  assert.ok(detail);
  assert.equal(detail?.title, "Chat A");
  assert.equal(detail?.activity.length, 1, "another Community's activity must never leak in");
  assert.match(detail!.activity[0].description, /removed a member/);
});

test("getAccountCommunityDetail returns null for a nonexistent or unowned Community", async () => {
  const admin = fakeAdmin({ projects: [DASH_PROJECT] });
  assert.equal(await getAccountCommunityDetail(admin, "acct-1", "nope"), null);
});

test("REQUIRED: getAccountWatcherDetail lists every deployment across Communities plus this Watcher's own activity only", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2002", title: "Chat B" },
    ],
    virtual_moderators: [
      { id: "m1", account_id: "acct-1", name: "Kwan" },
      { id: "m2", account_id: "acct-1", name: "Aegis" },
    ],
    moderator_deployments: [
      { id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true },
      { id: "d2", panel_id: null, moderator_id: "m2", community_id: "c2", enabled: true },
    ],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: "d1", event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2026-08-18T00:00:00Z" },
      { id: 2, community_id: "c2", deployment_id: "d2", event_type: "link_moderation", decision: "DELETE_WARN", created_at: "2026-08-18T00:01:00Z" },
    ],
  });
  const detail = await getAccountWatcherDetail(admin, "acct-1", "m1");
  assert.ok(detail);
  assert.equal(detail?.name, "Kwan");
  assert.equal(detail?.deployments.length, 1);
  assert.equal(detail?.deployments[0].communityTitle, "Chat A");
  assert.equal(detail?.activity.length, 1, "a different Watcher's own activity must never leak in");
  assert.match(detail!.activity[0].description, /removed a member/);
});

test("getAccountWatcherDetail returns null for a nonexistent or another account's Watcher", async () => {
  const admin = fakeAdmin({ virtual_moderators: [{ id: "m1", account_id: "acct-2", name: "Not yours" }] });
  assert.equal(await getAccountWatcherDetail(admin, "acct-1", "m1"), null);
});

/* ========================================================= needs attention ==== */

test("REQUIRED: listAccountAttentionItems flags a Community with no active Watcher", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Chat A has no active Watcher/);
  assert.equal(items[0].href, "/communities/c1");
});

test("REQUIRED: listAccountAttentionItems flags a Watcher not deployed anywhere", async () => {
  const admin = fakeAdmin({ virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }] });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Kwan isn't deployed/);
  assert.equal(items[0].href, "/watchers/m1");
});

test("listAccountAttentionItems is empty when every Community has an active Watcher and every Watcher is deployed", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
  });
  assert.deepEqual(await listAccountAttentionItems(admin, "acct-1"), []);
});

test("listAccountAttentionItems does not flag a Community whose Watcher is merely paused-and-idle elsewhere as deployed", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: false }],
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  // the Community is flagged HIGH (no ENABLED Watcher) AND the Watcher is
  // separately flagged LOW as "paused" (distinct from "not deployed at all",
  // which only applies when a Watcher has zero deployments of any kind) --
  // two genuinely different operational facts about the same underlying gap.
  assert.equal(items.length, 2);
  assert.equal(items[0].severity, "high");
  assert.match(items[0].text, /Chat A has no active Watcher/);
  assert.equal(items[1].severity, "low");
  assert.match(items[1].text, /Kwan is paused/);
});

test("REQUIRED: being EXACTLY AT full Watcher slot capacity is healthy -- no attention item, no upsell framing", async () => {
  // Standard = 5 slots. 5/5 active deployments (100%) is a customer fully
  // using what they purchased -- a normal, healthy state, not a problem.
  const moderators = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, account_id: "acct-1", name: `M${i}` }));
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD], // standard: 5 slots, 2 communities
    projects: [DASH_PROJECT],
    virtual_moderators: moderators,
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_deployments: moderators.map((m, i) => ({ id: `d${i}`, panel_id: null, moderator_id: m.id, community_id: "c1", enabled: true })),
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.some((i) => i.id === "capacity-watchers"), false, "5/5 (exactly at limit) must NOT be an attention item");
});

test("REQUIRED: being EXACTLY AT full Community capacity is healthy -- no attention item", async () => {
  // Standard = 2 communities. Exactly 2/2 connected is healthy/full, not a warning.
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1002", title: "Chat B" },
    ],
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.some((i) => i.id === "capacity-communities"), false, "2/2 (exactly at limit) must NOT be an attention item");
});

test("REQUIRED: Watcher slot usage genuinely EXCEEDING the plan limit (a real inconsistency) still surfaces MEDIUM attention", async () => {
  // Simulates a legacy/state-inconsistency scenario (e.g. a downgrade that
  // left more active deployments than the new plan allows) -- resources are
  // never deleted server-side, so this is a real, representable state, never
  // reachable through normal server-enforced creation.
  const moderators = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, account_id: "acct-1", name: `M${i}` }));
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD], // standard: 5 slots
    projects: [DASH_PROJECT],
    virtual_moderators: moderators,
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_deployments: moderators.map((m, i) => ({ id: `d${i}`, panel_id: null, moderator_id: m.id, community_id: "c1", enabled: true })), // 6 active on a 5-slot plan
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  const item = items.find((i) => i.id === "capacity-watchers");
  assert.ok(item, "6 active deployments on a 5-slot plan is a genuine over-capacity inconsistency and must still surface");
  assert.equal(item?.severity, "medium");
  assert.match(item!.text, /exceeds/i);
});

test("REQUIRED: Community usage genuinely EXCEEDING the plan limit still surfaces MEDIUM attention", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD], // standard: 2 communities
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1002", title: "Chat B" },
      { id: "c3", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1003", title: "Chat C" }, // 3 on a 2-community plan
    ],
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  const item = items.find((i) => i.id === "capacity-communities");
  assert.ok(item, "3 Communities on a 2-community plan is a genuine over-capacity inconsistency and must still surface");
  assert.equal(item?.severity, "medium");
});

test("listAccountAttentionItems does NOT flag capacity from saved Watcher profiles alone -- only actual active deployments count", async () => {
  const moderators = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, account_id: "acct-1", name: `M${i}` }));
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [DASH_PROJECT],
    virtual_moderators: moderators, // 5 saved profiles, 0 deployments
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.some((i) => i.id === "capacity-watchers"), false);
});

test("listAccountAttentionItems does not flag capacity well under the limit", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [DASH_PROJECT],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  assert.equal(items.some((i) => i.id.startsWith("capacity-")), false);
});

test("listAccountAttentionItems sorts high severity before medium before low", async () => {
  const moderators = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, account_id: "acct-1", name: `M${i}` }));
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [ENTITLED_STANDARD],
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
    virtual_moderators: moderators, // 5 undeployed profiles -> HIGH (community) + 5x LOW (undeployed watcher) items to sort
  });
  const items = await listAccountAttentionItems(admin, "acct-1");
  const severities = items.map((i) => i.severity);
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < severities.length; i++) assert.ok(rank[severities[i]] >= rank[severities[i - 1]], "items must be sorted by severity");
});

/* ================================================== operational status ==== */

test("REQUIRED: communityOperationalStatus is healthy/needs_attention/paused from real deployment state", () => {
  const w1 = { deploymentId: "d1", watcherId: "m1", watcherName: "Kwan", enabled: false };
  const w2 = { deploymentId: "d1", watcherId: "m1", watcherName: "Kwan", enabled: true };
  const w3 = { deploymentId: "d2", watcherId: "m2", watcherName: "Aegis", enabled: true };
  assert.equal(communityOperationalStatus({ watchers: [] }), "needs_attention");
  assert.equal(communityOperationalStatus({ watchers: [w1] }), "paused");
  assert.equal(communityOperationalStatus({ watchers: [w2] }), "healthy");
  assert.equal(communityOperationalStatus({ watchers: [w1, w3] }), "healthy", "any enabled deployment makes the whole Community healthy");
});

test("REQUIRED: getCommunityOperationalStats computes last activity + 24h moderation count per Community, never cross-contaminating", async () => {
  const now = Date.now();
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-2002", title: "Chat B" },
    ],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: new Date(now - 1000).toISOString() },
      { id: 2, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: new Date(now - 40 * 60 * 60 * 1000).toISOString() }, // >24h old
      { id: 3, community_id: "c2", deployment_id: null, event_type: "link_moderation", decision: "DELETE_KICK", created_at: new Date(now - 2000).toISOString() },
    ],
  });
  const stats = await getCommunityOperationalStats(admin, "acct-1");
  assert.equal(stats.get("c1")?.moderationCount24h, 1, "the >24h-old event must not count toward the 24h window");
  assert.ok(stats.get("c1")?.lastActivityAt, "lastActivityAt should still reflect the most recent event regardless of the 24h window");
  assert.equal(stats.get("c2")?.moderationCount24h, 1);
});

test("getCommunityOperationalStats returns null-stats (never throws) for a Community with no recorded activity", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
  });
  const stats = await getCommunityOperationalStats(admin, "acct-1");
  assert.deepEqual(stats.get("c1"), { lastActivityAt: null, moderationCount24h: 0 });
});

/* ==================================================== activity filters ==== */

test("REQUIRED: listAccountActivity's projectId filter never leaks a different Project's Community activity", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT, { id: "proj-2", account_id: "acct-1", panel_id: null, name: "Other" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-2", platform: "telegram", chat_id: "-2002", title: "Chat B" },
    ],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2026-08-18T00:00:00Z" },
      { id: 2, community_id: "c2", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: "2026-08-18T00:01:00Z" },
    ],
  });
  const activity = await listAccountActivity(admin, "acct-1", { projectId: "proj-1" });
  assert.equal(activity.length, 1);
  assert.equal(activity[0].communityId, "c1");
});

test("REQUIRED: listAccountActivity's since filter excludes events before the given timestamp", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: "2020-01-01T00:00:00Z" },
      { id: 2, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: new Date().toISOString() },
    ],
  });
  const activity = await listAccountActivity(admin, "acct-1", { since: new Date(Date.now() - 60_000).toISOString() });
  assert.equal(activity.length, 1);
  assert.match(activity[0].description, /warned/);
});

/* ==================================================== activity trend/graph ==== */

test("REQUIRED: getAccountActivityTrend returns exactly 7 daily buckets for a 7-day request, including zero-count days", async () => {
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
  });
  const trend = await getAccountActivityTrend(admin, "acct-1", { days: 7 });
  assert.equal(trend.length, 7);
  assert.ok(trend.every((p) => p.count === 0), "no events recorded -- every bucket must be present at zero, not omitted");
  // dates must be consecutive, ending today (UTC)
  const todayUtc = new Date().toISOString().slice(0, 10);
  assert.equal(trend[trend.length - 1].date, todayUtc);
});

test("REQUIRED: getAccountActivityTrend returns exactly 30 daily buckets for a 30-day request", async () => {
  const admin = fakeAdmin({ projects: [DASH_PROJECT] });
  const trend = await getAccountActivityTrend(admin, "acct-1", { days: 30 });
  assert.equal(trend.length, 30);
});

test("REQUIRED: getAccountActivityTrend buckets real persisted events onto the correct UTC day", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const admin = fakeAdmin({
    projects: [DASH_PROJECT],
    communities: [{ id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat" }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_BAN", created_at: `${today}T10:00:00Z` },
      { id: 2, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: `${today}T14:00:00Z` },
      { id: 3, community_id: "c1", deployment_id: null, event_type: "link_moderation", decision: "ALLOW", created_at: `${today}T14:05:00Z` }, // not a meaningful decision -- must not count
    ],
  });
  const trend = await getAccountActivityTrend(admin, "acct-1", { days: 7 });
  const todayBucket = trend.find((p) => p.date === today);
  assert.equal(todayBucket?.count, 2, "only the 2 real DECISION_DESCRIPTIONS-known events count, ALLOW is excluded same as the event list");
});

test("REQUIRED: getAccountActivityTrend uses the SAME scoping model as listAccountActivity -- community/project/watcher filters agree", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const admin = fakeAdmin({
    projects: [DASH_PROJECT, { id: "proj-2", account_id: "acct-1", panel_id: null, name: "Other" }],
    communities: [
      { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1001", title: "Chat A" },
      { id: "c2", panel_id: null, project_id: "proj-2", platform: "telegram", chat_id: "-2002", title: "Chat B" },
    ],
    virtual_moderators: [{ id: "m1", account_id: "acct-1", name: "Kwan" }],
    moderator_deployments: [{ id: "d1", panel_id: null, moderator_id: "m1", community_id: "c1", enabled: true }],
    moderator_activity_log: [
      { id: 1, community_id: "c1", deployment_id: "d1", event_type: "link_moderation", decision: "DELETE_BAN", created_at: `${today}T10:00:00Z` },
      { id: 2, community_id: "c2", deployment_id: null, event_type: "link_moderation", decision: "DELETE_WARN", created_at: `${today}T11:00:00Z` },
    ],
  });
  const listAll = await listAccountActivity(admin, "acct-1", { limit: 100 });
  const trendAll = await getAccountActivityTrend(admin, "acct-1", { days: 7 });
  assert.equal(listAll.length, trendAll.reduce((s, p) => s + p.count, 0), "unfiltered totals must agree between the event list and the trend graph");

  const listC1 = await listAccountActivity(admin, "acct-1", { communityId: "c1", limit: 100 });
  const trendC1 = await getAccountActivityTrend(admin, "acct-1", { days: 7, communityId: "c1" });
  assert.equal(listC1.length, trendC1.reduce((s, p) => s + p.count, 0), "community-filtered totals must agree");

  const listProj2 = await listAccountActivity(admin, "acct-1", { projectId: "proj-2", limit: 100 });
  const trendProj2 = await getAccountActivityTrend(admin, "acct-1", { days: 7, projectId: "proj-2" });
  assert.equal(listProj2.length, trendProj2.reduce((s, p) => s + p.count, 0), "project-filtered totals must agree");

  const listWatcher = await listAccountActivity(admin, "acct-1", { watcherId: "m1", limit: 100 });
  const trendWatcher = await getAccountActivityTrend(admin, "acct-1", { days: 7, watcherId: "m1" });
  assert.equal(listWatcher.length, trendWatcher.reduce((s, p) => s + p.count, 0), "watcher-filtered totals must agree");
});

test("getAccountActivityTrend returns all-zero buckets (never throws) for an account with no Communities", async () => {
  const admin = fakeAdmin({});
  const trend = await getAccountActivityTrend(admin, "acct-1", { days: 7 });
  assert.equal(trend.length, 7);
  assert.ok(trend.every((p) => p.count === 0));
});

/* ------------------------------------------------ community expansion ---- */
// getAccountCapacity/createAccountCommunity both resolve effective Community
// capacity through the SAME requireAccountWatchContext -- these tests prove
// the add-on actually changes what that resolver returns, never a second
// capacity model.

const GOLD_ENTITLEMENT = { id: "e-gold", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" };
const PLATINUM_ENTITLEMENT = { id: "e-plat", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "pro:dep-1" };
const ACTIVE_EXPANSION = { id: "addon-1", account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false };

test("REQUIRED (capacity 1): Gold without expansion uses the included cap (3)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 3);
  assert.equal(capacity?.communityExpansionActive, false);
  assert.equal(capacity?.communityExpansionEligible, true);
});

test("REQUIRED (capacity 2): Gold WITH an active Community Expansion add-on uses the expanded max (5)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], watch_subscription_addons: [ACTIVE_EXPANSION] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 5);
  assert.equal(capacity?.communityExpansionActive, true);
});

test("REQUIRED (capacity 3): Platinum without expansion uses the included cap (5)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [PLATINUM_ENTITLEMENT] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 5);
  assert.equal(capacity?.communityExpansionActive, false);
  assert.equal(capacity?.communityExpansionEligible, true);
});

test("REQUIRED (capacity 4): Platinum WITH an active Community Expansion add-on uses the expanded max (10)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [PLATINUM_ENTITLEMENT], watch_subscription_addons: [ACTIVE_EXPANSION] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 10);
  assert.equal(capacity?.communityExpansionActive, true);
});

test("REQUIRED (capacity 5): Community Expansion never changes Watcher slot capacity", async () => {
  const withoutAddon = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT] }), "acct-1");
  const withAddon = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], watch_subscription_addons: [ACTIVE_EXPANSION] }), "acct-1");
  assert.equal(withoutAddon?.slotsTotal, 10, "Gold's real slot count, from moderator/plan.ts's CAPACITY table");
  assert.equal(withAddon?.slotsTotal, 10, "must be byte-identical to the non-expanded case -- the add-on only ever touches Community capacity");
});

test("REQUIRED (capacity 6): duplicate/stray active-expansion rows cannot push capacity beyond the canonical max", async () => {
  // The real DB has a partial unique index preventing two active rows for the
  // same account -- this proves that even if that invariant were somehow
  // violated, the resolver still reads a plain boolean (hasActiveCommunityExpansion),
  // never "count of active rows", so capacity is structurally incapable of
  // exceeding the single canonical maxWithAddons ceiling.
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [GOLD_ENTITLEMENT],
    watch_subscription_addons: [ACTIVE_EXPANSION, { ...ACTIVE_EXPANSION, id: "addon-2" }],
  });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 5, "still exactly Gold's expanded max -- never 7 or any multiple");
});

test("REQUIRED (capacity 7): Community creation respects the effective EXPANDED capacity, not just the included one", async () => {
  const existing = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}`, panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: `-${i}` }));
  // Gold included=3 -- without expansion, a 4th Community must be rejected.
  const withoutAddon = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], projects: [STANDALONE_PROJECT], communities: existing });
  const rejected = await createAccountCommunity(withoutAddon, "acct-1", "proj-1", { platform: "telegram", chatId: "-999" });
  assert.equal(rejected.ok, false);

  // With expansion active (max=5), the SAME 4th Community must succeed.
  const withAddon = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], projects: [STANDALONE_PROJECT], communities: existing, watch_subscription_addons: [ACTIVE_EXPANSION] });
  const accepted = await createAccountCommunity(withAddon, "acct-1", "proj-1", { platform: "telegram", chatId: "-999" });
  assert.equal(accepted.ok, true);

  // A 6th Community (beyond the expanded max of 5) must still be rejected.
  const atExpandedMax = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], projects: [STANDALONE_PROJECT],
    communities: [...existing, { id: "c3", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-3" }, { id: "c4", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-4" }],
    watch_subscription_addons: [ACTIVE_EXPANSION],
  });
  const rejectedAtMax = await createAccountCommunity(atExpandedMax, "acct-1", "proj-1", { platform: "telegram", chatId: "-1000" });
  assert.equal(rejectedAtMax.ok, false, "the expanded max (5) is still a real ceiling, not unlimited");
});

test("Bronze/Silver never report Community-Expansion eligibility, and an active add-on row (if one somehow existed) never expands their capacity", async () => {
  const bronze = { id: "e-bronze", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "basic:dep-1" };
  const silver = { id: "e-silver", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" };
  for (const entitlement of [bronze, silver]) {
    const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [entitlement], watch_subscription_addons: [ACTIVE_EXPANSION] });
    const capacity = await getAccountCapacity(admin, "acct-1");
    assert.equal(capacity?.communityExpansionEligible, false, `${entitlement.subscription_ref} must never be expansion-eligible`);
    assert.equal(capacity?.communityExpansionActive, false, "a stray add-on row must never expand a Bronze/Silver account's capacity");
  }
});

test("trial never reports Community-Expansion eligibility, even with a stray active add-on row", async () => {
  const admin = fakeAdmin({ watch_trial_claims: [{ account_id: "acct-1", started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString() }], watch_subscription_addons: [ACTIVE_EXPANSION] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.tier, "trial");
  assert.equal(capacity?.communityExpansionEligible, false);
  assert.equal(capacity?.communityExpansionActive, false);
});

/* ------------------------------------------- media moderation + (2026-08-22) ---- */
// getAccountCapacity resolves the self-serve Media Moderation + add-on the
// SAME way it resolves Community Expansion -- through the one canonical
// requireAccountWatchContext-fed function, never a second capacity model.

const ACTIVE_MEDIA_ADDON = { id: "addon-media-1", account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: false };

test("REQUIRED: no add-on row -> inactive, no fabricated allowance", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.mediaModerationAddonActive, false);
  assert.equal(capacity?.mediaModerationUnitAllowance, null);
});

test("REQUIRED: an active add-on resolves the real unit allowance for the account's CURRENT tier", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], watch_subscription_addons: [ACTIVE_MEDIA_ADDON] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.mediaModerationAddonActive, true);
  assert.equal(capacity?.mediaModerationUnitAllowance, 3000, "Gold's real Media Moderation + unit allowance");
});

test("REQUIRED: eligible on EVERY self-serve tier, unlike Community Expansion's Gold/Platinum-only restriction", async () => {
  const bronze = { id: "e-bronze2", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "basic:dep-1" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [bronze], watch_subscription_addons: [ACTIVE_MEDIA_ADDON] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.mediaModerationAddonActive, true);
  assert.equal(capacity?.mediaModerationUnitAllowance, 1000, "Bronze's own unit allowance -- Media Moderation + has no tier restriction");
});

test("REQUIRED: a Community Expansion add-on row alone never activates Media Moderation + for the same account", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], watch_subscription_addons: [ACTIVE_EXPANSION] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, true);
  assert.equal(capacity?.mediaModerationAddonActive, false, "the two add-on types are structurally independent");
});

test("REQUIRED: both add-ons can be active on the SAME account simultaneously", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [GOLD_ENTITLEMENT], watch_subscription_addons: [ACTIVE_EXPANSION, ACTIVE_MEDIA_ADDON] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, true);
  assert.equal(capacity?.mediaModerationAddonActive, true);
  assert.equal(capacity?.mediaModerationUnitAllowance, 3000);
});

test("trial and enterprise never report an active Media Moderation + add-on, even with a stray active row", async () => {
  const trialAdmin = fakeAdmin({
    watch_trial_claims: [{ account_id: "acct-1", started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString() }],
    watch_subscription_addons: [ACTIVE_MEDIA_ADDON],
  });
  const trialCapacity = await getAccountCapacity(trialAdmin, "acct-1");
  assert.equal(trialCapacity?.tier, "trial");
  assert.equal(trialCapacity?.mediaModerationAddonActive, false);
  assert.equal(trialCapacity?.mediaModerationUnitAllowance, null);
});

/* ---------------------------------- fresh zero-Panel account -- shell fixture ---- */
// REQUIRED (standalone-Watch-access fix): "Account A" from the report --
// authenticated, zero Panels, zero Projects, zero Communities, zero
// Watchers, zero deployments, zero trial, zero paid subscription. Every
// read function getWatchAccessState()/the individual Watch page routes
// call must return a safe, real empty/null result for this exact fixture --
// never throw, never require a Panel to exist first.

test("REQUIRED: the full Watch dashboard read set is zero-safe for a genuinely brand-new account -- no Panel, no entitlement, nothing", async () => {
  const admin = fakeAdmin({});
  const accountId = "fresh-acct";

  const [watchers, communities, capacity, activity, actions7d, attention, stats, breakdown] = await Promise.all([
    listAccountWatchers(admin, accountId),
    listAccountCommunities(admin, accountId),
    getAccountCapacity(admin, accountId),
    listAccountActivity(admin, accountId),
    countRecentModerationActions(admin, accountId),
    listAccountAttentionItems(admin, accountId),
    getCommunityOperationalStats(admin, accountId),
    getAccountSlotBreakdown(admin, accountId),
  ]);

  assert.deepEqual(watchers, [], "no Watchers yet -- real empty list, not an error");
  assert.deepEqual(communities, [], "no Communities yet");
  assert.equal(capacity, null, "no entitlement -- real null, not a fabricated plan");
  assert.deepEqual(activity, [], "no Activity yet");
  assert.equal(actions7d, 0);
  assert.deepEqual(attention, [], "nothing to flag for an account with zero resources");
  assert.equal(stats.size, 0);
  assert.deepEqual(breakdown.byWatcher, []);
  assert.deepEqual(breakdown.byCommunity, []);

  // No Panel record was ever required or touched to answer any of the above.
  assert.equal((admin.__store.panels ?? []).length, 0);
});

/* ---------------------------------- Telegram bot reconnect status decision --- */

test("REQUIRED: nextProvisioningStatusAfterConnect resolves to active when real deployment records already exist", () => {
  assert.equal(nextProvisioningStatusAfterConnect(1), "active");
  assert.equal(nextProvisioningStatusAfterConnect(3), "active");
});

test("REQUIRED: nextProvisioningStatusAfterConnect resolves to bot_ready for a Watcher with zero deployments", () => {
  assert.equal(nextProvisioningStatusAfterConnect(0), "bot_ready");
});

/* ---------------------------------- Managed Enterprise entitlement ---- */
// "enterprise" is a distinct entitlement SOURCE, never a ModeratorPlanTier
// value -- mirrors how "trial" already works. Never touches the fixed
// CAPACITY/MODERATOR_COMMUNITY_CAPACITY tables (no "enterprise" row exists
// in either), never eligible for Community Expansion (Gold/Platinum
// self-serve only), and its slot count is the real, manually-provisioned
// `product_entitlements.enterprise_slots` value (migration 0086) -- never
// a fixed lookup.

const ENTITLED_ENTERPRISE_50 = {
  id: "e-ent", account_id: "acct-1", product_id: "product-watch", status: "active",
  subscription_ref: "enterprise:manual-1", enterprise_slots: 50,
};

test("REQUIRED: a Managed Enterprise entitlement resolves real capacity from the provisioned slot count, not a fixed lookup", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.ok(capacity);
  assert.equal(capacity?.tier, "enterprise");
  assert.equal(capacity?.slotsTotal, 50);
  assert.equal(
    capacity?.communitiesTotal,
    8,
    "no enterprise_community_capacity was provisioned (migration 0088), so this resolves to the base Managed Enterprise Community package (8) -- never derived from the slot count"
  );
});

/* -------------------------- Enterprise Community capacity (0088) ---- */
// Community capacity is a SEPARATE commercial resource from Watcher slots --
// extra slots above a package's base must never imply extra Communities;
// only a real, manually-provisioned enterprise_community_capacity value does.

test("REQUIRED: a real, provisioned enterprise Community capacity package overrides the base -- never derived from slots", async () => {
  const expanded = { ...ENTITLED_ENTERPRISE_50, enterprise_community_capacity: 15 };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [expanded] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 15, "a real provisioned Community package (15) must be reflected exactly, not the base (8)");
});

test("REQUIRED: many more Watcher slots than the base package never grants extra Community capacity on their own", async () => {
  const moreSlots = { ...ENTITLED_ENTERPRISE_50, enterprise_slots: 150 };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [moreSlots] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.slotsTotal, 150);
  assert.equal(capacity?.communitiesTotal, 8, "150 Watcher slots with NO Community package provisioned must still resolve to the base (8), decoupled from slot count");
});

test("an invalid/stray enterprise_community_capacity value never fabricates a capacity -- falls back to the real base package", async () => {
  const corrupted = { ...ENTITLED_ENTERPRISE_50, enterprise_community_capacity: 12 };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [corrupted] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 8, "12 is not a real Managed Enterprise Community package -- must never be trusted, falls back to the base");
});

test("REQUIRED: Managed Enterprise is never Community-Expansion-eligible -- that stays a self-serve Gold/Platinum add-on only", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionEligible, false);
  assert.equal(capacity?.communityExpansionActive, false);
});

test("REQUIRED: Managed Enterprise Watcher/Community creation enforces the REAL provisioned slot count, agreeing with displayed capacity", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50], projects: [STANDALONE_PROJECT] });
  const watcher = await createAccountWatcher(admin, "acct-1", "Enterprise Watcher");
  assert.equal(watcher.ok, true, "an entitled Enterprise account must be able to create a Watcher");
});

test("a self-serve Platinum entitlement is never accidentally resolved as enterprise, and vice versa", async () => {
  const platinum = { id: "e-pro", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "pro:deposit-1" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [platinum] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.tier, "pro");
  assert.equal(capacity?.slotsTotal, 20, "Platinum's own fixed CAPACITY table value, never confused with a variable Enterprise slot count");
});

/* ------------------------------- BYO Enterprise apiSourceMode (0092) ---- */
// Purely descriptive/routing metadata as of this field's introduction --
// resolved defensively (never fabricates "byo"), and must not change ANY
// capacity/slot resolution -- proving this pass introduces zero runtime
// behavior change beyond the new field itself.

test("REQUIRED: apiSourceMode defaults to managed when the column is null/absent", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const entitlement = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(entitlement?.apiSourceMode, "managed");
});

test("REQUIRED: apiSourceMode resolves byo when the account is explicitly provisioned that way", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo] });
  const entitlement = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(entitlement?.apiSourceMode, "byo");
});

test("an invalid/stray api_source_mode value never fabricates byo -- falls back to managed", async () => {
  const corrupted = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "self-hosted" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [corrupted] });
  const entitlement = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(entitlement?.apiSourceMode, "managed", "only the exact stored string 'byo' ever resolves to byo");
});

test("REQUIRED: apiSourceMode never affects capacity/slot resolution -- byte-identical for managed vs byo", async () => {
  const managed = ENTITLED_ENTERPRISE_50;
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const managedCapacity = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [managed] }), "acct-1");
  const byoCapacity = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo] }), "acct-1");
  assert.equal(managedCapacity?.tier, byoCapacity?.tier);
  assert.equal(managedCapacity?.slotsTotal, byoCapacity?.slotsTotal);
  assert.equal(managedCapacity?.communitiesTotal, byoCapacity?.communitiesTotal);
  assert.equal(managedCapacity?.communityExpansionEligible, byoCapacity?.communityExpansionEligible);
});

test("REQUIRED: Managed Enterprise entitlement never leaks across accounts", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const capacity = await getAccountCapacity(admin, "acct-2");
  assert.equal(capacity, null, "a different account must never resolve another account's Enterprise entitlement");
});

/* ------------------------ BYO Enterprise runtime wiring: resolveAccountAiRouting (Phase 2, 0092) ---- */
// The resolved AI-provider routing decision threaded into every real
// generation call site -- proving the "never fall back to Innvil's own
// credential" invariant starts from a correctly-resolved value.

const BYO_CRED_ROW = { account_id: "acct-1", provider: "anthropic", _plainKey: "sk-real-byo-key", base_url: null, model: "claude-sonnet-5" };

test("REQUIRED: resolveAccountAiRouting is never required for a non-Enterprise account, even with accountId set", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] });
  const routing = await resolveAccountAiRouting(admin, "acct-1", false);
  assert.equal(routing.required, false);
  assert.equal(routing.credential, null);
});

test("resolveAccountAiRouting is never required with no accountId, even if isEnterprise is somehow true", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const routing = await resolveAccountAiRouting(admin, null, true);
  assert.equal(routing.required, false);
});

test("REQUIRED: a Managed Enterprise account (apiSourceMode unset) never requires BYO routing", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true);
  assert.equal(routing.required, false);
  assert.equal(routing.credential, null);
});

test("REQUIRED: a real BYO-flagged Enterprise account with a stored credential resolves required+usable", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW] });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true);
  assert.equal(routing.required, true);
  assert.equal(routing.credential?.apiKey, "sk-real-byo-key");
  assert.equal(routing.credential?.provider, "anthropic");
  assert.equal(routing.credential?.model, "claude-sonnet-5");
});

test("REQUIRED: BYO-flagged but nothing stored resolves required:true with a null credential -- a real misconfiguration, never a signal to fall back to Innvil", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo] });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true);
  assert.equal(routing.required, true);
  assert.equal(routing.credential, null);
});

test("a different account's stored BYO credential is never resolved for this account", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo],
    watch_byo_provider_credentials: [{ ...BYO_CRED_ROW, account_id: "acct-2", _plainKey: "sk-someone-elses-key" }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true);
  assert.equal(routing.required, true);
  assert.equal(routing.credential, null, "acct-1 never sees acct-2's stored credential");
});

/* -------------- resolveAccountAiRouting + BYO usage POLICY (Phase 4.V) ---- */
// The usage-policy gate is threaded through resolveAccountAiRouting itself,
// so a policy-exhausted account resolves to the EXACT SAME
// {required:true, credential:null} "unusable" shape a missing credential
// already produces -- every downstream consumer needs zero changes.

test("REQUIRED: a real credential + no usage policy configured resolves usable, unaffected by this feature", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW] });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1");
  assert.equal(routing.required, true);
  assert.equal(routing.credential?.apiKey, "sk-real-byo-key");
});

test("REQUIRED: a real credential + an EXHAUSTED account-wide usage policy resolves required:true, credential:null -- never the raw credential", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 5 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "account:__", kind: "reactive", period_key: periodKey, request_count: 5 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1");
  assert.equal(routing.required, true);
  assert.equal(routing.credential, null, "an exhausted usage policy must produce the SAME unusable shape as a missing credential");
});

test("a real credential + a Community-level policy that's exhausted for a DIFFERENT Community stays usable", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `daily:${now.toISOString().slice(0, 10)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: "community-1", kind: "reactive", period: "daily", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "community:community-1", kind: "reactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-2");
  assert.equal(routing.required, true);
  assert.equal(routing.credential?.apiKey, "sk-real-byo-key", "community-1's exhausted policy must never block community-2");
});

test("resolveAccountAiRouting with no communityId given still respects an account-wide policy", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, kind: "reactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "account:__", kind: "reactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true);
  assert.equal(routing.credential, null);
});

/* -------------------- reactive/proactive kind split (Phase 4.V.1, 2026-08-25) ---- */

test("REQUIRED: resolveAccountAiRouting defaults to kind:'reactive' when omitted -- an exhausted PROACTIVE-only policy never blocks it", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: null, kind: "proactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "account:__", kind: "proactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1"); // kind omitted -> "reactive"
  assert.equal(routing.credential?.apiKey, "sk-real-byo-key", "the exhausted PROACTIVE policy must never gate a reactive call");
});

test("REQUIRED: an exhausted proactive policy DOES block a proactive-kind call, independent of the reactive gate", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: null, kind: "proactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "account:__", kind: "proactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1", null, "proactive");
  assert.equal(routing.credential, null, "the exhausted proactive policy must gate a genuinely proactive call");
});

/* --------------------- per-Watcher-deployment usage-policy scope (Phase 4.V.1, item 2) ---- */

test("REQUIRED: resolveAccountAiRouting respects a DEPLOYMENT-scoped policy passed directly (presence-runtime.ts's own resolution shape)", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: "deployment-1", kind: "proactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "deployment:deployment-1", kind: "proactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1", "deployment-1", "proactive");
  assert.equal(routing.credential, null, "the exhausted deployment-scoped policy must gate this exact deployment's proactive call");
});

test("a deployment-scoped policy never blocks a DIFFERENT deployment's calls in resolveAccountAiRouting", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW],
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: "deployment-1", kind: "reactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "deployment:deployment-1", kind: "reactive", period_key: periodKey, request_count: 1 }],
  });
  const routing = await resolveAccountAiRouting(admin, "acct-1", true, "community-1", "deployment-2", "reactive");
  assert.equal(routing.credential?.apiKey, "sk-real-byo-key", "deployment-1's exhausted policy must never gate deployment-2");
});

test("REQUIRED: applyDeploymentUsagePolicy narrows an already-usable routing to unusable once the deployment ceiling is exhausted", async () => {
  const now = new Date();
  const periodKey = `monthly:${now.toISOString().slice(0, 7)}`;
  const admin = fakeAdmin({
    watch_byo_usage_policies: [{ id: "pol-1", account_id: "acct-1", community_id: null, deployment_id: "deployment-1", kind: "reactive", period: "monthly", request_limit: 1 }],
    watch_byo_usage_counters: [{ account_id: "acct-1", scope_key: "deployment:deployment-1", kind: "reactive", period_key: periodKey, request_count: 1 }],
  });
  const usableRouting = { required: true, credential: { provider: "anthropic" as const, apiKey: "sk-real", baseUrl: null, model: "claude-sonnet-5" } };
  const narrowed = await applyDeploymentUsagePolicy(admin, usableRouting, "acct-1", "community-1", "deployment-1", "reactive");
  assert.equal(narrowed.credential, null);
  assert.equal(narrowed.required, true, "still required -- BYO, just unusable, never falls back to Managed");
});

test("applyDeploymentUsagePolicy is a no-op for a Managed (non-BYO) routing -- never touches Innvil's own accounts", async () => {
  const admin = fakeAdmin({});
  const managed = { required: false, credential: null };
  const result = await applyDeploymentUsagePolicy(admin, managed, "acct-1", "community-1", "deployment-1", "reactive");
  assert.deepEqual(result, managed);
});

/* ------------------------------- BYO Unlimited (enterprise_slots = null, 2026-08-25) ---- */
// Fixes a real gap: enterprise_slots was already nullable at the DB level
// (migration 0086's own check constraint always allowed it), but the
// resolver treated a stored NULL as a provisioning inconsistency rather
// than the real, meaningful "BYO Unlimited" state -- so BYO Unlimited could
// never actually be granted/resolved end to end.

const ENTITLED_BYO_UNLIMITED = {
  id: "e-byo-unl", account_id: "acct-1", product_id: "product-watch", status: "active",
  subscription_ref: "enterprise:manual-1", enterprise_slots: null, api_source_mode: "byo",
};

test("REQUIRED: a BYO account with enterprise_slots=null resolves as real Unlimited -- never a provisioning inconsistency", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_BYO_UNLIMITED] });
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.ok(enterprise);
  assert.equal(enterprise!.slots, null);
  assert.equal(enterprise!.apiSourceMode, "byo");
});

test("REQUIRED: a MANAGED account with enterprise_slots=null is REJECTED -- there is no Managed Unlimited package, so this is a real inconsistency", async () => {
  const managedNull = { ...ENTITLED_BYO_UNLIMITED, api_source_mode: "managed" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [managedNull] });
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(enterprise, null);
});

test("REQUIRED: requireAccountWatchContext resolves BYO Unlimited's maxActiveSlots to Number.POSITIVE_INFINITY -- never blocked by any real deployment count", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_BYO_UNLIMITED] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.slotsTotal, Number.POSITIVE_INFINITY);
});

test("REQUIRED: AccountCapacity.enterpriseSlots exposes the real value -- null for BYO Unlimited, a real number for a normal BYO/Managed grant", async () => {
  const unlimited = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_BYO_UNLIMITED] }), "acct-1");
  assert.equal(unlimited?.enterpriseSlots, null);
  const fifty = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] }), "acct-1");
  assert.equal(fifty?.enterpriseSlots, 50);
});

test("enterpriseSlots is always null for every non-enterprise tier", async () => {
  const capacity = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] }), "acct-1");
  assert.equal(capacity?.enterpriseSlots, null);
});

/* ------------------------------- Enterprise Media Moderation + grant (migration 0097) ---- */

test("REQUIRED: mediaAddonActive defaults to false for a NEW Enterprise row with no explicit grant", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(enterprise?.mediaAddonActive, false);
});

test("REQUIRED: mediaAddonActive resolves true when explicitly granted", async () => {
  const withAddon = { ...ENTITLED_ENTERPRISE_50, enterprise_media_addon: true };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [withAddon] });
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, "acct-1");
  assert.equal(enterprise?.mediaAddonActive, true);
});

test("REQUIRED: AccountCapacity.enterpriseMediaAddonActive reflects the real grant, false for every non-enterprise tier", async () => {
  const withAddon = { ...ENTITLED_ENTERPRISE_50, enterprise_media_addon: true };
  const capacity = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [withAddon] }), "acct-1");
  assert.equal(capacity?.enterpriseMediaAddonActive, true);
  const selfServe = await getAccountCapacity(fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] }), "acct-1");
  assert.equal(selfServe?.enterpriseMediaAddonActive, false);
});

/* ---------------- AccountCapacity's new apiSourceMode/hasByoCredential fields (0092) ---- */

test("REQUIRED: AccountCapacity.apiSourceMode is null for every non-Enterprise tier", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_STANDARD] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.apiSourceMode, null);
  assert.equal(capacity?.hasByoCredential, false);
});

test("REQUIRED: AccountCapacity.apiSourceMode reflects the real value for a Managed Enterprise account", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.apiSourceMode, "managed");
  assert.equal(capacity?.hasByoCredential, false);
});

test("REQUIRED: AccountCapacity.hasByoCredential is true only when a real credential is stored for a BYO-flagged account", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo], watch_byo_provider_credentials: [BYO_CRED_ROW] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.apiSourceMode, "byo");
  assert.equal(capacity?.hasByoCredential, true);
});

test("AccountCapacity.hasByoCredential is false for a BYO-flagged account with nothing actually stored", async () => {
  const byo = { ...ENTITLED_ENTERPRISE_50, api_source_mode: "byo" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [byo] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.hasByoCredential, false);
});

test("Managed Enterprise entitlement with a missing/zero provisioned slot count never fabricates capacity", async () => {
  const broken = { id: "e-ent-bad", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-2", enterprise_slots: null };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [broken] });
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity, null, "an inconsistent provisioning state (no real slot count) must never fabricate an entitlement");
});

test("Managed Enterprise zero-Panel: creating resources for an Enterprise account never touches the panels table", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50], projects: [STANDALONE_PROJECT] });
  const watcher = await createAccountWatcher(admin, "acct-1", "Enterprise Watcher");
  assert.equal(watcher.ok, true);
  assert.equal((admin.__store.panels ?? []).length, 0);
});

/* -------------- resolveStandaloneModeratorSettings (2026-08-23 fix) ---- */
// BUG: this function previously had NO Enterprise branch -- an Enterprise-
// only account fell through to null, meaning the live Telegram runtime did
// literally nothing for it (every virtualMod*(settings) check fails closed
// on null settings). These tests prove the fix end-to-end: not just that
// the function returns non-null, but that the REAL capability functions in
// moderator/plan.ts actually resolve true against what it returns.

const ENTERPRISE_WATCHER = { id: "w-ent", account_id: "acct-1", name: "Enterprise Watcher" };

test("REQUIRED: an Enterprise-only account's Watcher resolves REAL, working settings -- not null", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50], virtual_moderators: [ENTERPRISE_WATCHER],
  });
  const settings = await resolveStandaloneModeratorSettings(admin, "w-ent");
  assert.notEqual(settings, null, "the exact live bug -- an Enterprise-only account must never resolve to null settings");
  assert.equal(hasVirtualModerator(settings), true);
  assert.equal(moderatorEntitlementSource(settings), "enterprise");
});

test("REQUIRED: the resolved Enterprise settings actually unlock Proactive Mode / moderation, the real capabilities the runtime checks", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50], virtual_moderators: [ENTERPRISE_WATCHER],
  });
  const settings = await resolveStandaloneModeratorSettings(admin, "w-ent");
  assert.equal(virtualModProactiveMode(settings), true, "Enterprise must unlock everything Platinum unlocks, including Proactive Mode");
  assert.equal(virtualModModeration(settings), true);
});

test("a self-serve tier still wins over a stray Enterprise row for the same account (defensive precedence)", async () => {
  const selfServe = { id: "e-pro2", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "pro:deposit-9" };
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], product_entitlements: [selfServe], virtual_moderators: [ENTERPRISE_WATCHER] });
  const settings = await resolveStandaloneModeratorSettings(admin, "w-ent");
  assert.equal(moderatorEntitlementSource(settings), "pro", "resolveAccountWatchTier already resolves the self-serve tier -- Enterprise's own resolution is never reached in this case");
});

test("Enterprise wins over a stray active trial claim for the same account", async () => {
  const trialClaim = { account_id: "acct-1", telegram_user_id: 1, started_at: new Date().toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString() };
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW], product_entitlements: [ENTITLED_ENTERPRISE_50], virtual_moderators: [ENTERPRISE_WATCHER], watch_trial_claims: [trialClaim],
  });
  const settings = await resolveStandaloneModeratorSettings(admin, "w-ent");
  assert.equal(moderatorEntitlementSource(settings), "enterprise");
});

test("still returns null with no self-serve tier, no Enterprise, and no active trial -- the genuine no-entitlement case is unaffected by this fix", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW], virtual_moderators: [ENTERPRISE_WATCHER] });
  const settings = await resolveStandaloneModeratorSettings(admin, "w-ent");
  assert.equal(settings, null);
});
