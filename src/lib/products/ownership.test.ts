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

test("REQUIRED: activateWatchEntitlement persists billing_interval='annual'", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-1", "annual", undefined, undefined, undefined, undefined, true);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.billing_interval, "annual");
});

/* ------------------------- renewal_mode: real payment-method signal (not interval) ---- */
// 2026-08-25: annual billing became available via BOTH Innvil Credit AND
// direct crypto (5% vs. 10% discount) -- renewal_mode is now driven purely
// by the explicit paidViaCredit signal, never derived from billingInterval.

test("REQUIRED: paidViaCredit:true sets renewal_mode='innvil_credit' for an ANNUAL purchase", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-1", "annual", undefined, undefined, undefined, undefined, true);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.renewal_mode, "innvil_credit");
});

test("REQUIRED: paidViaCredit:false sets renewal_mode='manual_crypto' for an ANNUAL purchase -- annual is no longer Credit-exclusive", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-annual-1", "annual", undefined, undefined, undefined, undefined, false);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.billing_interval, "annual");
  assert.equal(row?.renewal_mode, "manual_crypto");
});

test("REQUIRED: paidViaCredit:true also sets renewal_mode='innvil_credit' for a MONTHLY purchase (previously only annual set this field)", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-2", "monthly", undefined, undefined, undefined, undefined, true);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.renewal_mode, "innvil_credit");
});

test("omitting paidViaCredit entirely (e.g. the devops grant tool) never touches renewal_mode", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "manual-1", "monthly");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.renewal_mode, undefined, "renewal_mode should never be set on the upsert payload when paidViaCredit is omitted");
});

test("a customer switching from Credit to crypto on renewal correctly flips renewal_mode back to manual_crypto", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "standard", "credit:tx-1", "monthly", undefined, undefined, undefined, undefined, true);
  let row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.renewal_mode, "innvil_credit");
  await activateWatchEntitlement(admin, "acct-1", "standard", "deposit-2", "monthly", undefined, undefined, undefined, undefined, false);
  row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.renewal_mode, "manual_crypto");
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

/* --------------------------------- Enterprise Community capacity (0088) ---- */

test("REQUIRED: activateWatchEntitlement persists a real, validated enterprise Community capacity package", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-1", "monthly", 50, 15);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_community_capacity, 15, "15 is a real Managed Enterprise Community package");
});

test("REQUIRED: an invalid enterprise Community capacity is never persisted -- silently dropped, not written as-is", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-1", "monthly", 50, 12);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.notEqual(row?.enterprise_community_capacity, 12, "12 is not a real Managed Enterprise Community package -- must never be persisted verbatim");
  assert.equal(row?.enterprise_community_capacity, undefined, "an invalid value must be dropped from the write entirely, not defaulted to something else");
});

test("a renewal that omits enterpriseCommunityCapacity never clobbers a previously-persisted valid value", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: 50, enterprise_community_capacity: 25 },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_community_capacity, 25, "omitting the parameter on renewal must never reset an already-provisioned Community package");
});

/* --------------------------------------- BYO Enterprise apiSourceMode (0092) ---- */

test("REQUIRED: activateWatchEntitlement persists a real apiSourceMode value", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-1", "monthly", 50, undefined, "byo");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.api_source_mode, "byo");
});

test("omitting apiSourceMode never clobbers a previously-persisted value on renewal", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: 50, api_source_mode: "byo" },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.api_source_mode, "byo", "omitting the parameter on renewal must never reset an already-provisioned mode");
});

test("apiSourceMode='managed' can be explicitly (re)persisted, e.g. switching a BYO account back to Managed", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: 50, api_source_mode: "byo" },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2", "monthly", undefined, undefined, "managed");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.api_source_mode, "managed");
});

/* -------------------------------------- BYO Unlimited: null vs undefined slots (2026-08-25) ---- */
// `enterpriseSlots` OMITTED (undefined) must never touch the field (renewal
// safety, unchanged); an EXPLICIT `null` must actually WRITE null -- a real,
// meaningful "BYO Unlimited" value, not treated the same as omission.

test("REQUIRED: an explicit null enterpriseSlots is actually WRITTEN as null, not treated as omitted", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-1", "monthly", null, undefined, "byo");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.ok("enterprise_slots" in (row as Row), "the field must actually be present in the write, not skipped");
  assert.equal(row?.enterprise_slots, null);
});

test("REQUIRED: omitting enterpriseSlots (undefined) on a renewal never clobbers a previously-persisted BYO Unlimited value", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: null, api_source_mode: "byo" },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_slots, null, "omitting the parameter must never reset a previously-persisted Unlimited grant to something else");
});

test("a real number still overwrites a previously-null (Unlimited) slots value, e.g. downgrading BYO Unlimited to BYO 50", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: null, api_source_mode: "byo" },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2", "monthly", 50);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_slots, 50);
});

/* ------------------------------------------- Enterprise Media Moderation + (migration 0097) ---- */

test("REQUIRED: activateWatchEntitlement persists a real enterpriseMediaAddon value", async () => {
  const admin = fakeAdmin({ products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }] });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-1", "monthly", 50, undefined, "managed", true);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_media_addon, true);
});

test("omitting enterpriseMediaAddon never clobbers a previously-persisted grant on renewal", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: 50, enterprise_media_addon: true },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2");
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_media_addon, true, "omitting the parameter must never reset an already-granted add-on");
});

test("enterpriseMediaAddon can be explicitly revoked (set to false)", async () => {
  const admin = fakeAdmin({
    products: [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: [
      { id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "enterprise:manual-1", enterprise_slots: 50, enterprise_media_addon: true },
    ],
  });
  await activateWatchEntitlement(admin, "acct-1", "enterprise", "manual-2", "monthly", undefined, undefined, undefined, false);
  const row = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.enterprise_media_addon, false);
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

/* ------------------------------------------- zero-Panel fresh account fixture ---- */
// REQUIRED (standalone-Watch-access fix): a genuinely brand-new Innvil
// account -- authenticated, zero Panels, zero Projects, zero trial, zero
// paid subscription -- must resolve as "not entitled" (real, not a crash)
// rather than being treated as unauthorized to even ask the question.
// hasProductAccess/listAccountProjects are the two functions
// getWatchAccessState() (src/lib/actions/watch-dashboard.ts) and every real
// Watch page (via requireWatchPage()) call for this exact account shape.

test("REQUIRED: a fresh zero-Panel, zero-entitlement account resolves hasProductAccess=false safely (never throws, never fabricates access)", async () => {
  const admin = fakeAdmin({ products: [WATCH_PRODUCT_ROW] });
  const entitled = await hasProductAccess(admin, "fresh-acct", WATCH_PRODUCT_SLUG);
  assert.equal(entitled, false);
});

test("REQUIRED: listAccountProjects returns an empty array (not an error) for a fresh account with zero Projects", async () => {
  const admin = fakeAdmin({});
  const rows = await listAccountProjects(admin, "fresh-acct");
  assert.deepEqual(rows, []);
});
