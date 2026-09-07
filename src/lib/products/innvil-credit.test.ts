import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getInnvilCreditBalance, listInnvilCreditActivity, creditInnvilCreditTopUp, purchaseWatchWithCredit,
  cancelPendingWatchDowngrade,
  purchaseCommunityExpansionWithCredit, scheduleCommunityExpansionRemoval,
  purchaseMediaModerationAddonWithCredit, scheduleMediaModerationAddonRemoval,
  purchaseMediaModerationExpansion,
} from "./innvil-credit";
import { getMediaModerationExpansionUnits } from "./watch-media-moderation-expansion";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { getAccountCapacity } from "./watch-runtime";

type Row = Record<string, unknown>;

/**
 * Fake admin covering exactly what innvil-credit.ts (and, transitively,
 * ownership.ts's activateWatchEntitlement + watch-runtime.ts's
 * getAccountPaidPlan/resolveAccountWatchTier) touch. The `apply_innvil_
 * credit_change` RPC simulation mirrors the REAL Postgres function's
 * invariants exactly: row-locked (synchronous, no `await` between read and
 * write, which correctly serializes concurrent JS calls the same way a
 * Postgres row lock would), rejects a negative balance without partially
 * applying, and a duplicate `payment_ref` raises the SAME 23505 shape a
 * real unique-index violation would.
 */
function fakeAdmin(seed: {
  innvil_credit_accounts?: Row[]; innvil_credit_transactions?: Row[];
  products?: Row[]; product_entitlements?: Row[]; watch_subscription_addons?: Row[];
  projects?: Row[]; communities?: Row[]; virtual_moderators?: Row[]; moderator_deployments?: Row[];
}) {
  const store: Record<string, Row[]> = {
    innvil_credit_accounts: seed.innvil_credit_accounts ?? [],
    innvil_credit_transactions: seed.innvil_credit_transactions ?? [],
    products: seed.products ?? [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: seed.product_entitlements ?? [],
    watch_subscription_addons: seed.watch_subscription_addons ?? [],
    projects: seed.projects ?? [],
    communities: seed.communities ?? [],
    virtual_moderators: seed.virtual_moderators ?? [],
    moderator_deployments: seed.moderator_deployments ?? [],
  };
  let idCounter = 0;

  return {
    __store: store,
    async rpc(fn: string, params: Record<string, unknown>) {
      if (fn !== "apply_innvil_credit_change") return { data: null, error: { message: "unknown function" } };
      const accountId = params.p_account as string;
      const amountCents = params.p_amount_cents as number;
      const type = params.p_type as string;
      const paymentRef = (params.p_payment_ref as string | null) ?? null;

      if (paymentRef) {
        const dup = (store.innvil_credit_transactions ?? []).some((t) => t.payment_ref === paymentRef);
        if (dup) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }

      let account = store.innvil_credit_accounts.find((a) => a.account_id === accountId);
      if (!account) {
        account = { account_id: accountId, balance_cents: 0 };
        store.innvil_credit_accounts.push(account);
      }
      const newBalance = (account.balance_cents as number) + amountCents;
      if (newBalance < 0) return { data: null, error: { message: "insufficient_credit" } };

      account.balance_cents = newBalance;
      idCounter += 1;
      const row = {
        id: `tx-${idCounter}`,
        account_id: accountId,
        type,
        amount_cents: amountCents,
        balance_after_cents: newBalance,
        product_id: (params.p_product as string | null) ?? null,
        payment_ref: paymentRef,
        description: (params.p_description as string | null) ?? null,
        created_at: new Date().toISOString(),
      };
      store.innvil_credit_transactions.push(row);
      return { data: row, error: null };
    },
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
        in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const rows = rowsMatching();
          const sorted = [...rows].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
          return { data: sorted[0] ?? null, error: null };
        },
        upsert(row: Row, opts: { onConflict: string }) {
          const keys = opts.onConflict.split(",");
          const idx = (store[table] ?? []).findIndex((r) => keys.every((k) => r[k] === row[k]));
          if (idx >= 0) { store[table][idx] = { ...store[table][idx], ...row }; return Promise.resolve({ data: null, error: null }); }
          store[table] = [...(store[table] ?? []), { ...row }];
          return Promise.resolve({ data: null, error: null });
        },
        async insert(row: Row) {
          // Simulates the real partial unique index on (account_id, addon_type)
          // where status='active' for watch_subscription_addons -- a second
          // concurrent active-row insert for the same account fails 23505.
          if (table === "watch_subscription_addons" && row.status !== "removed") {
            const conflict = (store[table] ?? []).some((r) => r.account_id === row.account_id && r.addon_type === row.addon_type && r.status === "active");
            if (conflict) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
          }
          idCounter += 1;
          const newRow = { id: `gen-${table}-${idCounter}`, ...row };
          store[table] = [...(store[table] ?? []), newRow];
          return { data: newRow, error: null };
        },
        update(patch: Row) {
          const updateFilters: Array<(r: Row) => boolean> = [...filters];
          const updateBuilder: Record<string, unknown> = {
            eq(col: string, val: unknown) { updateFilters.push((r) => r[col] === val); return updateBuilder; },
            then(resolve: (v: { data: null; error: null }) => void) {
              store[table] = (store[table] ?? []).map((r) => (updateFilters.every((f) => f(r)) ? { ...r, ...patch } : r));
              resolve({ data: null, error: null });
            },
          };
          return updateBuilder;
        },
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          const sorted = [...rowsMatching()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
          resolve({ data: sorted, error: null });
        },
      };
      return builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/* ------------------------------------------------------------------ reads ---- */

test("REQUIRED: a fresh account has a zero balance, no row required", async () => {
  const admin = fakeAdmin({});
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.deepEqual(balance, { balanceCents: 0, balanceUsd: 0 });
});

test("listInnvilCreditActivity returns newest-first", async () => {
  const admin = fakeAdmin({
    innvil_credit_transactions: [
      { id: "t1", account_id: "acct-1", type: "crypto_top_up", amount_cents: 10000, balance_after_cents: 10000, description: null, created_at: "2026-01-01T00:00:00Z" },
      { id: "t2", account_id: "acct-1", type: "subscription_purchase", amount_cents: -12349, balance_after_cents: -2349, description: null, created_at: "2026-01-02T00:00:00Z" },
    ],
  });
  const activity = await listInnvilCreditActivity(admin, "acct-1");
  assert.equal(activity[0].id, "t2");
});

/* --------------------------------------------------------------- top-up ---- */

test("REQUIRED: a confirmed crypto top-up credits the exact amount once", async () => {
  const admin = fakeAdmin({});
  await creditInnvilCreditTopUp(admin, "acct-1", 50000, "deposit-1");
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 50000);
});

test("REQUIRED: a duplicate webhook for the SAME deposit id does not double-credit", async () => {
  const admin = fakeAdmin({});
  await creditInnvilCreditTopUp(admin, "acct-1", 50000, "deposit-1");
  await creditInnvilCreditTopUp(admin, "acct-1", 50000, "deposit-1");
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 50000, "the second call must be a no-op, never a second +50000");
});

test("REQUIRED: balance never goes negative -- a debit larger than the balance is rejected without partial application", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 5000 }] });
  const { error } = await admin.rpc("apply_innvil_credit_change", { p_account: "acct-1", p_amount_cents: -6000, p_type: "adjustment" });
  assert.ok(error);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 5000, "balance must be unchanged after a rejected debit");
});

test("REQUIRED: concurrent debits cannot double-spend past the available balance", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 15000 }] });
  const [a, b] = await Promise.all([
    admin.rpc("apply_innvil_credit_change", { p_account: "acct-1", p_amount_cents: -12349, p_type: "adjustment" }),
    admin.rpc("apply_innvil_credit_change", { p_account: "acct-1", p_amount_cents: -12349, p_type: "adjustment" }),
  ]);
  const succeeded = [a, b].filter((r) => !r.error);
  assert.equal(succeeded.length, 1, "only one of the two concurrent $123.49 debits against a $150 balance may succeed");
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.ok(balance.balanceCents >= 0);
});

test("account A cannot spend account B's credit -- balances are fully isolated", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-a", balance_cents: 10000 }] });
  const { error } = await admin.rpc("apply_innvil_credit_change", { p_account: "acct-b", p_amount_cents: -5000, p_type: "adjustment" });
  assert.ok(error, "acct-b has no balance of its own, spending must fail rather than draw from acct-a");
});

/* --------------------------------------------------- purchase with credit ---- */

test("REQUIRED: sufficient credit purchases Silver, debits the exact discounted amount, and activates the subscription exactly once", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 20000 }] });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 20000 - 5699); // Silver $59.99 -> $56.99 with Innvil Credit (5%)
  assert.ok(result.paidThrough);
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.status, "active");
  assert.match(String(entitlement?.subscription_ref), /^standard:credit:/);
});

test("REQUIRED: insufficient credit activates nothing and debits nothing", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 1000 }] });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver");
  assert.equal(result.ok, false);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 1000, "balance must be untouched on a rejected purchase");
  assert.equal(admin.__store.product_entitlements.length, 0, "no entitlement may be created without a successful debit");
});

test("a later renewal via credit uses the SAME canonical period-extension rule (extends from the existing end)", async () => {
  const admin = fakeAdmin({
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 50000 }],
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "standard:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
  });
  const before = admin.__store.product_entitlements[0].current_period_end as string;
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.paidThrough, before, "the period must have been extended, not left unchanged");
});

test("REQUIRED: paid capacity remains canonical -- a Silver credit purchase resolves the real Silver tier afterward", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 20000 }] });
  await purchaseWatchWithCredit(admin, "acct-1", "Silver");
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.match(String(entitlement?.subscription_ref), /^standard:/);
});

/* ------------------------------------------------------- annual billing ---- */

test("REQUIRED (test 1): sufficient credit buys an annual Silver subscription, debits the exact annual price once, and persists billing_interval='annual'", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 200000 }] });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 200000 - 64789); // Silver $59.99 annual -> $647.89
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.billing_interval, "annual");
  assert.equal(entitlement?.renewal_mode, "innvil_credit", "annual must force Innvil-Credit-only renewal");
  assert.match(String(entitlement?.subscription_ref), /^standard:credit:/);
});

test("REQUIRED (test 3): the annual purchase creates a real one-year service period", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 200000 }] });
  const before = new Date(Date.now() + 300 * 24 * 60 * 60 * 1000); // ~10 months out, definitely NOT one month
  await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.ok(new Date(entitlement?.current_period_end as string).getTime() > before.getTime(), "the period must span a full year, not one month");
});

test("REQUIRED (tests 6-7): insufficient credit for an annual purchase debits nothing and activates nothing", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 50000 }] });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(result.ok, false);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 50000);
  assert.equal(admin.__store.product_entitlements.length, 0);
});

test("REQUIRED (test 8): a zero-Panel account can buy annual -- no Panel table touched or required", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 200000 }] });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(result.ok, true);
  assert.ok(!("panels" in admin.__store) || (admin.__store.panels ?? []).length === 0);
});

test("REQUIRED: race safety -- two concurrent annual purchase attempts against a balance that can fund only one succeed exactly once", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 70000 }] }); // enough for one $647.89 (Silver annual) purchase, not two
  const [a, b] = await Promise.all([
    purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual"),
    purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual"),
  ]);
  const succeeded = [a, b].filter((r) => r.ok);
  assert.equal(succeeded.length, 1, "only one of the two concurrent annual purchases may succeed");
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.ok(balance.balanceCents >= 0, "balance must never go negative");
});

test("REQUIRED: an annual renewal extends the period by exactly one additional year, not two", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 500000 }] });
  const first = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const firstEnd = new Date(first.paidThrough as string);
  const secondEnd = new Date(second.paidThrough as string);
  const yearsApart = Math.round((secondEnd.getTime() - firstEnd.getTime()) / (365 * 24 * 60 * 60 * 1000));
  assert.equal(yearsApart, 1, "the second successful annual payment must extend by one more year, never two");
});

test("REQUIRED (trial -> annual): a trial customer can upgrade directly to an annual paid subscription", async () => {
  const admin = fakeAdmin({
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 200000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver", "annual");
  assert.equal(result.ok, true);
  // This test's fake admin has no watch_trial_claims table -- trial-consumption
  // durability itself is covered by watch-trial.test.ts; this proves the
  // annual purchase path itself doesn't require or touch trial state.
});

/* ---------------------------------------------- community expansion add-on ---- */

const GOLD_ENTITLEMENT = { id: "e-gold", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "premium:dep-1" };
const PLATINUM_ENTITLEMENT = { id: "e-plat", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "pro:dep-1" };
const SILVER_ENTITLEMENT = { id: "e-silver", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "standard:dep-1" };
const BASIC_ENTITLEMENT = { id: "e-basic", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "basic:dep-1" };

test("REQUIRED (eligibility): Bronze cannot purchase Community Expansion -- rejected server-side, not just hidden in UI", async () => {
  const admin = fakeAdmin({ product_entitlements: [BASIC_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, false);
  assert.equal(admin.__store.watch_subscription_addons.length, 0);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 100000, "nothing may be debited for a rejected purchase");
});

test("REQUIRED (eligibility): Silver cannot purchase Community Expansion", async () => {
  const admin = fakeAdmin({ product_entitlements: [SILVER_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, false);
  assert.equal(admin.__store.watch_subscription_addons.length, 0);
});

test("REQUIRED (eligibility): an account with no active paid Watch subscription (trial or none) cannot purchase Community Expansion", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, false);
});

test("REQUIRED (eligibility): Gold can purchase Community Expansion", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
});

test("REQUIRED (eligibility): Platinum can purchase Community Expansion", async () => {
  const admin = fakeAdmin({ product_entitlements: [PLATINUM_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
});

test("REQUIRED (pricing): Gold Community Expansion debits the exact discounted price ($9.49 -- the existing 5% monthly credit rule) once, and grants real capacity", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 100000 - 949);
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 5, "Gold's expanded max");
  assert.equal(capacity?.communityExpansionActive, true);
});

test("REQUIRED (pricing): Platinum Community Expansion debits the exact discounted price ($14.24 -- the existing 5% monthly credit rule)", async () => {
  const admin = fakeAdmin({ product_entitlements: [PLATINUM_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 100000 - 1424);
});

test("REQUIRED (pricing): an annual Gold subscriber pays the annual Community Expansion price ($107.89), not the monthly one", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{ ...GOLD_ENTITLEMENT, billing_interval: "annual" }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 100000 - 10789);
});

test("REQUIRED (payment): insufficient credit activates nothing and debits nothing", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 500 }] });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, false);
  assert.equal(admin.__store.watch_subscription_addons.length, 0);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 500);
});

test("REQUIRED (payment): a second purchase attempt while already active never double-charges -- safe, idempotent no-op", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const first = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(first.ok, true);
  const second = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.balanceCents, first.ok ? first.balanceCents : -1, "the second call must not debit anything further");
  assert.equal(admin.__store.watch_subscription_addons.filter((r: Row) => r.status === "active").length, 1, "never two active add-on rows");
});

test("REQUIRED (payment): race safety -- two concurrent purchase attempts (ample balance for both debits) still activate the add-on exactly once, via the DB-level partial-unique-index guard", async () => {
  // Balance covers TWO debits, so the race is exercised at the INSERT step
  // (the real partial unique index on account_id+addon_type+status='active')
  // rather than the debit step -- the loser's charge is reversed and it
  // reports the already-active state, never a hard failure or a double
  // charge left standing.
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const [a, b] = await Promise.all([
    purchaseCommunityExpansionWithCredit(admin, "acct-1"),
    purchaseCommunityExpansionWithCredit(admin, "acct-1"),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, "the loser of the DB-level race gets refunded and reports the already-active state, never a hard failure");
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 100000 - 949, "exactly ONE net charge survives -- the loser's debit was fully reversed");
  assert.equal(admin.__store.watch_subscription_addons.filter((r: Row) => r.status === "active").length, 1, "exactly one active add-on, never a double-charge or double-activation");
});

test("REQUIRED (renewal): a renewal of the SAME tier with an active add-on folds the add-on price into ONE combined debit and ONE period extension", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const before = admin.__store.product_entitlements[0].current_period_end as string;
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Gold");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Gold base credit price ($94.99) + Gold expansion credit price ($9.49) = $104.48, ONE debit.
  assert.equal(result.balanceCents, 100000 - (9499 + 949));
  assert.notEqual(result.paidThrough, before, "the period must have been extended");
  const txs = admin.__store.innvil_credit_transactions.filter((t: Row) => t.type === "subscription_renewal");
  assert.equal(txs.length, 1, "must be exactly ONE combined debit, never two separate charges");
});

test("a renewal of a DIFFERENT tier (plan change) does not fold in the add-on price -- addon pricing only applies to a same-tier renewal", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Platinum");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // An UPGRADE (Gold $99.99 -> Platinum $149.99) charges only the
  // DIFFERENCE between the two tiers' own credit prices ($142.49 -
  // $94.99 = $47.50), never Platinum's full price on top of what this
  // period already cost -- no addon fold on a tier change either way.
  assert.equal(result.balanceCents, 100000 - 4750, "only the upgrade PRICE DIFFERENCE -- no addon fold on a tier change");
});

test("REQUIRED (renewal): a removal-pending add-on is NOT charged on the next renewal, and is finalized (removed) by it", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: true }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Gold");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 100000 - 9499, "base Gold price only -- the removal-pending addon must never be charged for one more period");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, false, "the addon must be finalized to 'removed' by this renewal");
  assert.equal(capacity?.communitiesTotal, 3, "capacity reverts to Gold's included cap once the addon is finalized as removed");
});

/* --------------------------------------------------------------- removal ---- */

test("REQUIRED (removal): scheduling removal is blocked when current Community usage exceeds the plan's INCLUDED cap", async () => {
  const communities = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: `-${i}` }));
  const admin = fakeAdmin({
    product_entitlements: [PLATINUM_ENTITLEMENT], // Platinum included=5, expanded=10; 8 connected exceeds included
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  const result = await scheduleCommunityExpansionRemoval(admin, "acct-1");
  assert.equal(result.ok, false);
  const row = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.cancel_at_period_end, false, "removal must not be scheduled while usage exceeds the included cap");
});

test("REQUIRED (removal): scheduling removal succeeds when usage is within the included cap -- capacity stays expanded until the next renewal finalizes it (no immediate cut, no refund)", async () => {
  const communities = [
    { id: "c0", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-0" },
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1" },
  ];
  const admin = fakeAdmin({
    product_entitlements: [GOLD_ENTITLEMENT], // Gold included=3 -- 2 connected is within it
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  const result = await scheduleCommunityExpansionRemoval(admin, "acct-1");
  assert.equal(result.ok, true);
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communitiesTotal, 5, "still the expanded max -- already paid for, remains available until the period actually ends");
  assert.equal(capacity?.communityExpansionActive, true, "still active (scheduled, not yet finalized)");
});

test("scheduling removal with no active add-on at all is rejected", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT] });
  const result = await scheduleCommunityExpansionRemoval(admin, "acct-1");
  assert.equal(result.ok, false);
});

test("scheduling removal a second time is a safe idempotent no-op", async () => {
  const admin = fakeAdmin({
    product_entitlements: [GOLD_ENTITLEMENT],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: true }],
  });
  const result = await scheduleCommunityExpansionRemoval(admin, "acct-1");
  assert.equal(result.ok, true);
});

/* --------------------------------------------------- plan-change transitions ---- */

test("REQUIRED (plan change): Gold+expansion -> Platinum finalizes (removes) the add-on -- never carries a Gold-priced add-on into Platinum for free", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities: [{ id: "c0", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-0" }], // 1 community -- fits Platinum's included cap of 5
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Platinum");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Upgrade delta ($142.49 - $94.99 = $47.50), never Platinum's full price
  // stacked on top -- the Gold-priced add-on is never carried over/re-charged.
  assert.equal(result.balanceCents, 100000 - 4750, "only the upgrade price difference -- the Gold-priced add-on is never carried over/re-charged");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, false, "the add-on must be finalized (removed) on the tier change");
  assert.equal(capacity?.communitiesTotal, 5, "Platinum's own included cap -- no expansion carried over");
});

test("REQUIRED (plan change / downgrade safety): Platinum+expansion (10 cap, 8 connected) -> Gold (max 5 even expanded) is BLOCKED until usage is reduced", async () => {
  const communities = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: `-${i}` }));
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "pro:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Gold");
  assert.equal(result.ok, false);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 100000, "a blocked plan change must debit nothing");
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.subscription_ref, "pro:dep-1", "the account must remain on Platinum -- the change never took effect");
  const row = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.status, "active", "the add-on must remain untouched -- never finalized for a change that was itself blocked");
});

test("REQUIRED (downgrade deferral): a Platinum -> Gold downgrade request is SCHEDULED, not activated immediately -- no charge, current Platinum tier/capacity/addon all stay exactly as they are", async () => {
  const communities = [
    { id: "c0", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-0" },
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1" },
  ]; // 2 connected -- fits Gold's included cap of 3, so scheduling is allowed
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "pro:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Gold");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.scheduled, true, "a downgrade is scheduled, never activated on the spot");
  assert.equal(result.balanceCents, 100000, "scheduling a downgrade charges nothing right now");
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.subscription_ref, "pro:dep-1", "the account stays on Platinum until the scheduled downgrade actually applies");
  assert.equal(entitlement?.pending_tier, "premium", "the downgrade to Gold is recorded as pending");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, true, "the Platinum-tier add-on stays fully active -- nothing is finalized until the downgrade actually applies");
  assert.equal(capacity?.communitiesTotal, 10, "still Platinum's own expanded capacity -- unchanged today");
});

test("REQUIRED (downgrade deferral): renewing at the account's own current tier while a downgrade is pending APPLIES it -- charged the pending tier's own price, addon finalized, tier switches", async () => {
  const communities = [
    { id: "c0", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-0" },
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1" },
  ];
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "pro:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      pending_tier: "premium",
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  // RenewWatchButton always passes the account's own CURRENT tier
  // (Platinum) -- exactly what a real "Renew" click sends.
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Platinum");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.notEqual(result.scheduled, true, "applying an already-scheduled downgrade is a real activation, not a second scheduling step");
  assert.equal(result.balanceCents, 100000 - 9499, "charged the PENDING tier's (Gold) own full price, not a delta off Platinum");
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.subscription_ref?.startsWith("premium:"), true, "the account has actually switched to Gold now");
  assert.equal(entitlement?.pending_tier, null, "the scheduled downgrade is cleared once applied");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, false, "the Platinum-priced add-on is finalized once the downgrade actually takes effect");
  assert.equal(capacity?.communitiesTotal, 3, "Gold's plain included cap, now in effect");
});

test("REQUIRED (downgrade deferral): a downgrade request is blocked (never scheduled) when current Community usage exceeds the target tier's included cap", async () => {
  const communities = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: `-${i}` }));
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "pro:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", panel_id: null, name: "Mine" }],
    communities,
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Gold");
  assert.equal(result.ok, false);
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.pending_tier ?? null, null, "nothing is scheduled when the downgrade request itself is rejected");
});

test("REQUIRED: a customer can cancel an already-scheduled downgrade -- the account simply keeps renewing at its current tier", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "pro:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      pending_tier: "premium",
    }],
  });
  const result = await cancelPendingWatchDowngrade(admin, "acct-1");
  assert.equal(result.ok, true);
  const entitlement = admin.__store.product_entitlements.find((r: Row) => r.account_id === "acct-1");
  assert.equal(entitlement?.pending_tier, null);
});

test("a plan change with NO active add-on at all is completely unaffected by any of this logic", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "premium:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Platinum");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Upgrade delta (Platinum $142.49 - Gold $94.99 = $47.50).
  assert.equal(result.balanceCents, 100000 - 4750);
});

test("REQUIRED: un-cancelling a removal-pending add-on via a fresh purchase call never re-charges the customer", async () => {
  const admin = fakeAdmin({
    product_entitlements: [GOLD_ENTITLEMENT],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "community_expansion", status: "active", cancel_at_period_end: true }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.balanceCents, 100000, "no charge for un-cancelling an already-paid-for add-on");
  const row = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-1");
  assert.equal(row?.cancel_at_period_end, false, "removal must be un-scheduled");
});

/* ===================================== media moderation + (2026-08-22) ==== */
// Real self-serve purchase pipeline -- mirrors the Community Expansion tests
// above structurally, but Media Moderation + is available on ALL FOUR
// self-serve tiers (never Gold/Platinum-only), so a Bronze fixture is used
// specifically to prove the eligibility difference.

const BRONZE_ENTITLEMENT = { id: "e-bronze3", account_id: "acct-1", product_id: "product-watch", status: "active", subscription_ref: "basic:dep-1" };

test("REQUIRED: Bronze CAN purchase Media Moderation + (unlike Community Expansion, no tier restriction)", async () => {
  const admin = fakeAdmin({ product_entitlements: [BRONZE_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  const result = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.units, 1000, "Bronze's real unit allowance");
  assert.equal(result.balanceCents, 10000 - 999, "Bronze has 0% Innvil Credit discount, so $9.99 debits exactly");
});

test("REQUIRED: Gold Media Moderation + debits the exact discounted price ($18.99) and activates 3,000 units", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  const result = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.units, 3000);
  assert.equal(result.balanceCents, 10000 - 1899);
});

test("REQUIRED: no active paid subscription -> Media Moderation + purchase is rejected", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  const result = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(result.ok, false);
});

test("REQUIRED: duplicate/idempotent activation -- purchasing again while already active is a safe no-op, never a second charge", async () => {
  const admin = fakeAdmin({ product_entitlements: [BRONZE_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  const first = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(first.ok, true);
  const second = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.balanceCents, first.ok ? first.balanceCents : -1, "second call must not debit again");
});

test("REQUIRED: race safety -- two concurrent purchase attempts activate the add-on exactly once", async () => {
  const admin = fakeAdmin({ product_entitlements: [BRONZE_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  const [a, b] = await Promise.all([
    purchaseMediaModerationAddonWithCredit(admin, "acct-1"),
    purchaseMediaModerationAddonWithCredit(admin, "acct-1"),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const balance = await getInnvilCreditBalance(admin, "acct-1");
  assert.equal(balance.balanceCents, 10000 - 999, "exactly ONE net charge survives");
  assert.equal(admin.__store.watch_subscription_addons.filter((r: Row) => r.addon_type === "media_moderation" && r.status === "active").length, 1);
});

test("REQUIRED: account isolation -- another account's balance/entitlement is never touched by this account's purchase", async () => {
  const admin = fakeAdmin({
    product_entitlements: [BRONZE_ENTITLEMENT, { ...BRONZE_ENTITLEMENT, id: "e-other", account_id: "acct-2" }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }, { account_id: "acct-2", balance_cents: 10000 }],
  });
  await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  const other = await getInnvilCreditBalance(admin, "acct-2");
  assert.equal(other.balanceCents, 10000, "account-2's balance must be completely unaffected");
  const otherRow = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-2");
  assert.equal(otherRow, undefined, "account-2 must have no addon row from account-1's purchase");
});

test("REQUIRED: removal -- scheduleMediaModerationAddonRemoval marks cancel_at_period_end, never an immediate cut", async () => {
  const admin = fakeAdmin({ product_entitlements: [BRONZE_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 10000 }] });
  await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  const result = await scheduleMediaModerationAddonRemoval(admin, "acct-1");
  assert.equal(result.ok, true);
  const row = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-1" && r.addon_type === "media_moderation");
  assert.equal(row?.cancel_at_period_end, true);
  assert.equal(row?.status, "active", "still active until the period actually ends");
});

test("REQUIRED (renewal): a same-tier renewal with an active Media Moderation + add-on folds its price into ONE combined debit", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "basic:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Bronze");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Bronze base credit price ($29.99, 0% discount) + Bronze media addon credit price ($9.99) = $39.98, ONE debit.
  assert.equal(result.balanceCents, 100000 - (2999 + 999));
  const txs = admin.__store.innvil_credit_transactions.filter((t: Row) => t.type === "subscription_renewal");
  assert.equal(txs.length, 1, "must be exactly ONE combined debit, never two separate charges");
});

test("REQUIRED: a plan CHANGE finalizes (removes) an active Media Moderation + add-on -- never carried across tiers for free", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e1", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "basic:dep-1", current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    }],
    watch_subscription_addons: [{ account_id: "acct-1", addon_type: "media_moderation", status: "active", cancel_at_period_end: false }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseWatchWithCredit(admin, "acct-1", "Silver");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  // Upgrade delta (Silver $56.99 - Bronze $29.99 = $27.00) -- the
  // Bronze-priced media add-on is never carried over/re-charged either way.
  assert.equal(result.balanceCents, 100000 - 2700);
  const row = admin.__store.watch_subscription_addons.find((r: Row) => r.account_id === "acct-1" && r.addon_type === "media_moderation");
  assert.equal(row?.status, "removed", "the addon must be finalized on the tier change");
});

test("REQUIRED: Community Expansion and Media Moderation + can BOTH be active on the SAME account simultaneously (independent addon types)", async () => {
  const admin = fakeAdmin({ product_entitlements: [GOLD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const expansion = await purchaseCommunityExpansionWithCredit(admin, "acct-1");
  const media = await purchaseMediaModerationAddonWithCredit(admin, "acct-1");
  assert.equal(expansion.ok, true);
  assert.equal(media.ok, true);
  const activeRows = admin.__store.watch_subscription_addons.filter((r: Row) => r.account_id === "acct-1" && r.status === "active");
  assert.equal(activeRows.length, 2, "both addon types coexist as two separate active rows");
});

/* ------------------------------------------------ Media Moderation capacity packs, REVISED model ---- */
// (2026-08-27) Real, stackable, CURRENT-PERIOD top-ups -- a genuinely
// separate table (watch_media_moderation_expansions, migration 0110) from
// the recurring watch_subscription_addons rows above, so these purchases
// never touch that table at all.

const PERIOD_ENTITLEMENT = {
  id: "e-period", account_id: "acct-1", product_id: "product-watch", status: "active",
  subscription_ref: "premium:dep-1",
  current_period_start: "2026-08-01T00:00:00Z",
  current_period_end: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
};

test("REQUIRED: an arbitrary unit count that isn't a real canonical pack size is rejected -- never partially honored", async () => {
  const admin = fakeAdmin({ product_entitlements: [PERIOD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 1234);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /valid/i);
  assert.equal(admin.__store.innvil_credit_accounts[0].balance_cents, 100000, "nothing charged for a rejected purchase");
});

test("REQUIRED: an account with no resolvable Watch billing period cannot purchase capacity", async () => {
  const admin = fakeAdmin({ innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 1000);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /active Watch subscription/i);
});

test("REQUIRED: a valid pack purchase debits the exact real price and returns the units added", async () => {
  const admin = fakeAdmin({ product_entitlements: [PERIOD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 5000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.unitsAdded, 5000);
  assert.equal(result.totalExpansionThisPeriod, 5000);
  assert.equal(result.balanceCents, 100000 - 2499, "debits the exact $24.99 pack price");
});

test("REQUIRED (10): multiple, differently-sized purchases in the same period stack -- reflected immediately via getMediaModerationExpansionUnits", async () => {
  const admin = fakeAdmin({ product_entitlements: [PERIOD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }] });
  await purchaseMediaModerationExpansion(admin, "acct-1", 1000);
  const second = await purchaseMediaModerationExpansion(admin, "acct-1", 20000);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.totalExpansionThisPeriod, 21000);
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_ENTITLEMENT.current_period_start), 21000);
});

test("REQUIRED: insufficient Innvil Credit rejects the purchase without adding any capacity", async () => {
  const admin = fakeAdmin({ product_entitlements: [PERIOD_ENTITLEMENT], innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 500 }] });
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 1000); // costs $9.99, more than the $5.00 balance
  assert.equal(result.ok, false);
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_ENTITLEMENT.current_period_start), 0);
  assert.equal(admin.__store.innvil_credit_accounts[0].balance_cents, 500, "balance untouched on a rejected purchase");
});

test("REQUIRED (18, 19): a capacity-pack purchase never touches Watcher slots, Communities, or the base entitlement row -- it only ever writes to its own table", async () => {
  const admin = fakeAdmin({
    product_entitlements: [PERIOD_ENTITLEMENT],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
    projects: [{ id: "proj-1", account_id: "acct-1", name: "Proj" }],
    communities: [{ id: "comm-1", project_id: "proj-1", connection_type: "community" }],
    virtual_moderators: [{ id: "watcher-1", account_id: "acct-1" }],
    moderator_deployments: [{ id: "dep-1", moderator_id: "watcher-1", community_id: "comm-1", enabled: true }],
  });
  const before = {
    entitlement: { ...admin.__store.product_entitlements[0] },
    projects: admin.__store.projects.length,
    communities: admin.__store.communities.length,
    moderators: admin.__store.virtual_moderators.length,
    deployments: admin.__store.moderator_deployments.length,
  };
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 2000);
  assert.equal(result.ok, true);
  assert.deepEqual(admin.__store.product_entitlements[0], before.entitlement, "the base entitlement row is never touched");
  assert.equal(admin.__store.projects.length, before.projects);
  assert.equal(admin.__store.communities.length, before.communities);
  assert.equal(admin.__store.virtual_moderators.length, before.moderators);
  assert.equal(admin.__store.moderator_deployments.length, before.deployments, "Watcher slot/deployment count is unaffected by a media-capacity purchase");
});

test("REQUIRED (20): expansion purchases are isolated per account -- one account's purchase never appears in another's available capacity", async () => {
  const admin = fakeAdmin({
    product_entitlements: [
      PERIOD_ENTITLEMENT,
      { id: "e-2", account_id: "acct-2", product_id: "product-watch", status: "active", subscription_ref: "basic:dep-2", current_period_start: PERIOD_ENTITLEMENT.current_period_start, current_period_end: PERIOD_ENTITLEMENT.current_period_end },
    ],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }, { account_id: "acct-2", balance_cents: 100000 }],
  });
  await purchaseMediaModerationExpansion(admin, "acct-1", 20000);
  const acct2Purchase = await purchaseMediaModerationExpansion(admin, "acct-2", 1000);
  assert.equal(acct2Purchase.ok, true);
  if (!acct2Purchase.ok) return;
  assert.equal(acct2Purchase.totalExpansionThisPeriod, 1000, "acct-2's own purchase never includes acct-1's units");
  assert.equal(await getMediaModerationExpansionUnits(admin, "acct-1", PERIOD_ENTITLEMENT.current_period_start), 20000);
});

test("a capacity pack is purchasable for ANY resolvable Watch plan, including Enterprise -- never gated to a subset of self-serve tiers", async () => {
  const admin = fakeAdmin({
    product_entitlements: [{
      id: "e-ent", account_id: "acct-1", product_id: "product-watch", status: "active",
      subscription_ref: "enterprise:dep-1",
      current_period_start: PERIOD_ENTITLEMENT.current_period_start, current_period_end: PERIOD_ENTITLEMENT.current_period_end,
    }],
    innvil_credit_accounts: [{ account_id: "acct-1", balance_cents: 100000 }],
  });
  const result = await purchaseMediaModerationExpansion(admin, "acct-1", 10000);
  assert.equal(result.ok, true);
});
