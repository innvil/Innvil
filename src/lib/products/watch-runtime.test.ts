import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAccountWatchTier, createAccountWatcher, listAccountWatchers,
  createAccountCommunity, deployAccountWatcher, resolveDeploymentTenant,
  listAccountCommunities, getAccountCapacity, listAccountActivity, countRecentModerationActions,
  getAccountProjectDetail, getAccountCommunityDetail, getAccountWatcherDetail, listAccountAttentionItems,
  communityOperationalStatus, getCommunityOperationalStats, getAccountSlotBreakdown, getAccountActivityTrend,
} from "./watch-runtime";
import { WATCH_PRODUCT_SLUG } from "./watch";

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
  moderator_activity_log?: Row[];
}) {
  const store: Record<string, Row[]> = {
    products: seed.products ?? [],
    product_entitlements: seed.product_entitlements ?? [],
    projects: seed.projects ?? [],
    virtual_moderators: seed.virtual_moderators ?? [],
    communities: seed.communities ?? [],
    moderator_deployments: seed.moderator_deployments ?? [],
    moderator_activity_log: seed.moderator_activity_log ?? [],
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

test("REQUIRED: listAccountAttentionItems flags Watcher slot capacity nearing the plan limit as MEDIUM -- based on ACTIVE DEPLOYMENTS, not saved profile count", async () => {
  // Standard = 5 slots. 5 saved Watcher profiles with ZERO deployments must
  // NOT trigger this (that was the old, buggy semantics) -- only 5 actually
  // DEPLOYED (enabled) Watchers should.
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
  const watcherCapacityItem = items.find((i) => i.id === "capacity-watchers");
  assert.ok(watcherCapacityItem, "5/5 active deployments (100%) must trigger the capacity attention item");
  assert.equal(watcherCapacityItem?.severity, "medium");
  assert.equal(watcherCapacityItem?.href, "/usage");
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

test("listAccountAttentionItems does not flag capacity well under the threshold", async () => {
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
