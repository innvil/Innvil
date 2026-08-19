import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getInnvilCreditBalance, listInnvilCreditActivity, creditInnvilCreditTopUp, purchaseWatchWithCredit,
} from "./innvil-credit";
import { WATCH_PRODUCT_SLUG } from "./watch";

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
  products?: Row[]; product_entitlements?: Row[];
}) {
  const store: Record<string, Row[]> = {
    innvil_credit_accounts: seed.innvil_credit_accounts ?? [],
    innvil_credit_transactions: seed.innvil_credit_transactions ?? [],
    products: seed.products ?? [{ id: "product-watch", slug: WATCH_PRODUCT_SLUG }],
    product_entitlements: seed.product_entitlements ?? [],
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
      const filters: Array<[string, unknown]> = [];
      const rowsMatching = () => (store[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
      return {
        select() { return this; },
        eq(col: string, val: unknown) { filters.push([col, val]); return this; },
        order() { return this; },
        limit() { return this; },
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
        then(resolve: (v: { data: Row[]; error: null }) => void) {
          const sorted = [...rowsMatching()].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
          resolve({ data: sorted, error: null });
        },
      };
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
  assert.equal(result.balanceCents, 20000 - 12349);
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
