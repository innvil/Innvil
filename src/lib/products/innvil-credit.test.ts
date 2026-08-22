import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getInnvilCreditBalance, listInnvilCreditActivity, creditInnvilCreditTopUp, purchaseWatchWithCredit,
  purchaseCommunityExpansionWithCredit, scheduleCommunityExpansionRemoval,
} from "./innvil-credit";
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
  assert.equal(result.balanceCents, 100000 - 18905, "only Platinum's own credit price -- no addon fold on a tier change");
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
  assert.equal(result.balanceCents, 100000 - 18905, "only Platinum's own base price -- the Gold-priced add-on is never carried over/re-charged");
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

test("REQUIRED (plan change / downgrade safety): the SAME Platinum+expansion -> Gold downgrade succeeds once usage is reduced within Gold's included cap", async () => {
  const communities = [
    { id: "c0", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-0" },
    { id: "c1", panel_id: null, project_id: "proj-1", platform: "telegram", chat_id: "-1" },
  ]; // 2 connected -- fits Gold's included cap of 3
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
  assert.equal(result.balanceCents, 100000 - 9499, "Gold's own base price only");
  const capacity = await getAccountCapacity(admin, "acct-1");
  assert.equal(capacity?.communityExpansionActive, false, "the Platinum-priced add-on must be finalized, not silently kept active under Gold");
  assert.equal(capacity?.communitiesTotal, 3, "Gold's plain included cap");
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
  assert.equal(result.balanceCents, 100000 - 18905);
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
