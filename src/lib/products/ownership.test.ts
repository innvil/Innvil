import { test } from "node:test";
import assert from "node:assert/strict";
import { hasProductAccess, createStandaloneProject, projectBelongsToAccount, activateWatchEntitlement, listAccountProjects } from "./ownership";
import { WATCH_PRODUCT_SLUG } from "./watch";

/**
 * Phase 4.T continued — neutral ownership + generic Product entitlement.
 * Validates the architecture itself (independence from Panel/Forge), not
 * existing Virtual Moderator business logic, which is untouched.
 */

type Row = Record<string, unknown>;

function fakeAdmin(seed: { panels?: Row[]; products?: Row[]; product_entitlements?: Row[]; projects?: Row[]; watch_trial_claims?: Row[]; watch_telegram_links?: Row[] }) {
  const store: Record<string, Row[]> = {
    panels: seed.panels ?? [],
    products: seed.products ?? [],
    product_entitlements: seed.product_entitlements ?? [],
    projects: seed.projects ?? [],
    watch_trial_claims: seed.watch_trial_claims ?? [],
    watch_telegram_links: seed.watch_telegram_links ?? [],
  };
  return {
    __store: store,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push([col, val]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() { return { data: rowsMatching()[0] ?? null, error: null }; },
        insert(row: Row) {
          return {
            select() { return this; },
            async single() {
              const id = (row.id as string | undefined) ?? `gen-${table}-${(store[table] ?? []).length + 1}`;
              const newRow = { id, ...row };
              store[table] = [...(store[table] ?? []), newRow];
              return { data: newRow, error: null };
            },
          };
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          resolve({ data: rowsMatching(), error: null });
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const rows = store[table] ?? [];
          const existingIdx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (existingIdx >= 0) rows[existingIdx] = { ...rows[existingIdx], ...row };
          else rows.push({ id: `gen-${table}-${rows.length + 1}`, ...row });
          store[table] = rows;
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const WATCH_PRODUCT_ROW = { id: "product-watch", slug: WATCH_PRODUCT_SLUG, name: "Innvil Watch" };

test("REQUIRED: an account with a direct product_entitlements row has Watch access with NO Forge/Panel at all", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active" }],
    panels: [],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), true);
});

test("a trial-status entitlement also grants access", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "trial" }],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), true);
});

test("a cancelled/inactive entitlement does NOT grant access", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "cancelled" }],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), false);
});

test("REQUIRED: Forge ownership alone (a Panel with NO active moderator addon) does NOT imply Watch entitlement", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    panels: [{ id: "panel-1", owner_id: "acct-1", settings: {} }], // no addons.moderator at all
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), false);
});

test("REQUIRED: an active direct-Watch trial claim grants access with NO Forge/Panel and NO product_entitlements row at all", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    watch_trial_claims: [{ account_id: "acct-1", telegram_user_id: 555, ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() }],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), true);
});

test("an expired trial claim does NOT grant access", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    watch_trial_claims: [{ account_id: "acct-1", telegram_user_id: 555, ends_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), false);
});

test("REQUIRED: an existing Panel-distributed Watch subscriber (legacy path) still resolves as entitled", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    panels: [{ id: "panel-1", owner_id: "acct-1", settings: { addons: { moderator: { tier: "pro" } } } }],
  });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), true);
});

test("Watch entitlement never leaks to a different account", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active" }],
  });
  assert.equal(await hasProductAccess(admin, "acct-2", WATCH_PRODUCT_SLUG), false);
});

/* ------------------------------------------- standalone project creation ---- */

test("REQUIRED: a Watch-entitled account can create a Project with NO Panel at all", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active" }],
  });
  const result = await createStandaloneProject(admin, "acct-1", "My Community Hub");
  assert.equal(result.ok, true);
  const created = admin.__store.projects.find((p: Row) => p.id === result.projectId);
  assert.equal(created?.account_id, "acct-1");
  assert.equal(created?.panel_id, null); // no commercial Panel required
});

test("REQUIRED: a non-entitled account cannot create a standalone Watch project (and nothing is written)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW] });
  const result = await createStandaloneProject(admin, "acct-1", "Nope");
  assert.equal(result.ok, false);
  assert.equal(admin.__store.projects.length, 0);
});

test("createStandaloneProject rejects an empty name", async () => {
  const admin = fakeAdmin({
    products: [WATCH_PRODUCT_ROW],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active" }],
  });
  const result = await createStandaloneProject(admin, "acct-1", "   ");
  assert.equal(result.ok, false);
});

/* ---------------------------------------------------- tenant isolation ---- */

test("REQUIRED: projectBelongsToAccount rejects a cross-tenant match", () => {
  assert.equal(projectBelongsToAccount({ accountId: "acct-1" }, "acct-1"), true);
  assert.equal(projectBelongsToAccount({ accountId: "acct-1" }, "acct-2"), false);
});

/* -------------------------------------------------------- direct payment ---- */

test("REQUIRED: activateWatchEntitlement creates an active entitlement for the account", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.status, "active");
  assert.equal(row?.product_id, "product-watch");
  assert.match(String(row?.subscription_ref), /^standard:deposit-1$/);
});

test("REQUIRED: activateWatchEntitlement is idempotent -- calling it twice (duplicate webhook) does not create two entitlement rows", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  const rows = admin.__store.product_entitlements.filter((r: Row) => r.account_id === "acct-1");
  assert.equal(rows.length, 1);
});

test("activateWatchEntitlement never writes anything if the Watch product row is missing (never fabricates one)", async () => {
  const admin = fakeAdmin({ products: [] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  assert.equal(admin.__store.product_entitlements.length, 0);
});

test("REQUIRED: an initial activation establishes a real current_period_start/current_period_end", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.ok(row?.current_period_start);
  assert.ok(row?.current_period_end);
});

test("REQUIRED: a renewal before the existing period ends extends from the EXISTING end, not from now", async () => {
  const futureEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: futureEnd }],
  });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.notEqual(row?.current_period_end, futureEnd, "must be extended by one month from the existing end, not left unchanged");
});

test("a renewal after the existing period already expired starts a fresh period from now", async () => {
  const pastEnd = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: pastEnd }],
  });
  const before = Date.now();
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.ok(new Date(row?.current_period_start as string).getTime() >= before, "the new period must start from settlement time, never retroactively from the old expiry");
});

test("REQUIRED: activateWatchEntitlement persists billing_interval='annual' and forces renewal_mode='innvil_credit' when called with 'annual'", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-1", "annual");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.billing_interval, "annual");
  assert.equal(row?.renewal_mode, "innvil_credit");
});

test("activateWatchEntitlement defaults to billing_interval='monthly' when the parameter is omitted -- every existing (crypto webhook) caller is unaffected", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.billing_interval, "monthly");
});

test("REQUIRED: an annual activation extends a still-active period by a full year, matching computeRenewedPeriod's canonical rule", async () => {
  const futureEnd = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [{ id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1", current_period_end: futureEnd, billing_interval: "monthly" }],
  });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-1", "annual");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  const daysUntilNewEnd = (new Date(row?.current_period_end as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  assert.ok(daysUntilNewEnd > 300, "an annual extension from a still-active period must add roughly a year, not a month");
});

test("a subsequent activation for the SAME account+product now grants hasProductAccess", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), false);
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-1");
  assert.equal(await hasProductAccess(admin, "acct-1", WATCH_PRODUCT_SLUG), true);
});

/* -------------------------------------------------------- account projects ---- */

test("listAccountProjects returns only this account's projects, standalone and Panel-backed alike", async () => {
  const admin = fakeAdmin({
    projects: [
      { id: "proj-1", account_id: "acct-1", panel_id: null, name: "Standalone Hub", created_at: "2026-01-01T00:00:00Z" },
      { id: "proj-2", account_id: "acct-1", panel_id: "panel-1", name: "Panel Project", created_at: "2026-01-02T00:00:00Z" },
      { id: "proj-3", account_id: "acct-2", panel_id: null, name: "Someone Else's", created_at: "2026-01-01T00:00:00Z" },
    ],
  });
  const rows = await listAccountProjects(admin, "acct-1");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.id !== "proj-3"));
  assert.equal(rows.find((r) => r.id === "proj-1")?.panelId, null);
  assert.equal(rows.find((r) => r.id === "proj-2")?.panelId, "panel-1");
});
