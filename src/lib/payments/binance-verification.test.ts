import assert from "node:assert/strict";
import test from "node:test";
import {
  validateTx,
  matchesTransactionId,
  normalizeEnteredTransactionId,
  creditMatch,
  type PendingIntent,
  type BinanceTx,
} from "./binance-match";
import { getPayTransactions, BinanceApiError } from "./binance";
import { collectTransactionsForWindow } from "./binance-sync";

function makeIntent(overrides: Partial<PendingIntent> = {}): PendingIntent {
  return {
    id: "pay_1",
    customer_id: "cust_1",
    amount: "100.0000",
    binance_payable: "100.1234",
    created_at: "2026-08-06T10:00:00.000Z",
    ...overrides,
  };
}

function makeTx(overrides: Partial<BinanceTx> = {}): BinanceTx {
  return {
    transaction_id: "M_P_71505104267788288",
    order_type: "C2C",
    transaction_time: "2026-08-06T10:06:00.000Z",
    amount: "100.1234",
    currency: "USDT",
    receiver_binance_id: "12345678",
    ...overrides,
  };
}

test("valid incoming C2C payment passes validation", () => {
  const intent = makeIntent();
  const tx = makeTx();
  const fail = validateTx(tx, intent, {
    expectedUid: "12345678",
    requirePayableMatch: true,
    windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
    windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
  });
  assert.equal(fail, null);
});

test("outgoing negative C2C transaction is rejected", () => {
  const fail = validateTx(
    makeTx({ amount: "-100.1234" }),
    makeIntent(),
    {
      expectedUid: "12345678",
      requirePayableMatch: true,
      windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
      windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
    }
  );
  assert.equal(fail?.code, "NOT_INCOMING");
});

test("wrong transactionId is not treated as a match", () => {
  assert.equal(matchesTransactionId("M_P_71505104267788288", "M_P_71505104267788288"), true);
  assert.equal(matchesTransactionId("M_P_71505104267788289", "M_P_71505104267788288"), false);
});

test("transaction IDs keep M_P_ prefix and case", () => {
  const normalized = normalizeEnteredTransactionId("  M_P_71505104267788288  ");
  assert.equal(normalized, "M_P_71505104267788288");
});

test("wrong amount returns AMOUNT_MISMATCH", () => {
  const fail = validateTx(
    makeTx({ amount: "100.1235" }),
    makeIntent({ binance_payable: "100.1234" }),
    {
      expectedUid: "12345678",
      requirePayableMatch: true,
      windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
      windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
    }
  );
  assert.equal(fail?.code, "AMOUNT_MISMATCH");
});

test("wrong currency returns CURRENCY_MISMATCH", () => {
  const fail = validateTx(
    makeTx({ currency: "BTC" }),
    makeIntent(),
    {
      expectedUid: "12345678",
      requirePayableMatch: true,
      windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
      windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
    }
  );
  assert.equal(fail?.code, "CURRENCY_MISMATCH");
});

test("wrong receiver returns WRONG_RECEIVER", () => {
  const fail = validateTx(
    makeTx({ receiver_binance_id: "99999999" }),
    makeIntent(),
    {
      expectedUid: "12345678",
      requirePayableMatch: true,
      windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
      windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
    }
  );
  assert.equal(fail?.code, "WRONG_RECEIVER");
});

test("transaction outside time window returns TRANSACTION_OUTSIDE_TIME_WINDOW", () => {
  const fail = validateTx(
    makeTx({ transaction_time: "2026-08-06T11:00:00.000Z" }),
    makeIntent(),
    {
      expectedUid: "12345678",
      requirePayableMatch: true,
      windowStartMs: Date.parse("2026-08-06T09:55:00.000Z"),
      windowEndMs: Date.parse("2026-08-06T10:15:00.000Z"),
    }
  );
  assert.equal(fail?.code, "TRANSACTION_OUTSIDE_TIME_WINDOW");
});

test("duplicate transaction maps to TRANSACTION_ALREADY_USED", async () => {
  const fakeAdmin = {
    rpc: async () => ({ data: "TRANSACTION_ALREADY_USED", error: null }),
  } as any;
  const out = await creditMatch(fakeAdmin, makeIntent(), makeTx(), { discountPct: "0" });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "TRANSACTION_ALREADY_USED");
});

test("malformed Binance response is rejected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "000000", message: "success", data: {} }), { status: 200 });
  await assert.rejects(
    () => getPayTransactions({ apiKey: "abc123", apiSecret: "def456" }, { startTime: 1, endTime: 2, limit: 10 }),
    (err: unknown) => err instanceof BinanceApiError && err.kind === "parse"
  );
  globalThis.fetch = originalFetch;
});

test("Binance authentication failure is classified", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: -2015, message: "Invalid API-key, IP, or permissions for action." }), { status: 401 });
  await assert.rejects(
    () => getPayTransactions({ apiKey: "abc123", apiSecret: "def456" }, { startTime: 1, endTime: 2, limit: 10 }),
    (err: unknown) => err instanceof BinanceApiError && err.kind === "auth"
  );
  globalThis.fetch = originalFetch;
});

test("Binance API failure is classified", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ code: "-1003", message: "Too many requests" }), { status: 429 });
  await assert.rejects(
    () => getPayTransactions({ apiKey: "abc123", apiSecret: "def456" }, { startTime: 1, endTime: 2, limit: 10 }),
    (err: unknown) => err instanceof BinanceApiError && err.kind === "api"
  );
  globalThis.fetch = originalFetch;
});

test("pagination stops when transaction is found", async () => {
  let calls = 0;
  const bigPage = Array.from({ length: 100 }, (_, i) => ({
    transactionId: `TX_${i}`,
    orderType: "C2C",
    transactionTime: 400 - i,
    amount: "1",
    currency: "USDT",
  }));
  const fetchPage = async () => {
    calls += 1;
    if (calls === 1) {
      return bigPage as any;
    }
    return [
      { transactionId: "M_P_71505104267788288", orderType: "C2C", transactionTime: 150, amount: "1", currency: "USDT" },
      ...bigPage.slice(0, 99),
    ] as any;
  };

  const out = await collectTransactionsForWindow(fetchPage, {
    startTime: 100,
    endTime: 400,
    maxPages: 5,
    stopWhenTransactionId: "M_P_71505104267788288",
  });
  assert.equal(out.foundTarget, true);
  assert.equal(out.pages, 2);
});

test("pagination stops once it moves before allowed startTime", async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls += 1;
    if (calls === 1) {
      return [
        { transactionId: "A", orderType: "C2C", transactionTime: 150, amount: "1", currency: "USDT" },
        { transactionId: "B", orderType: "C2C", transactionTime: 90, amount: "1", currency: "USDT" },
      ] as any;
    }
    return [] as any;
  };

  const out = await collectTransactionsForWindow(fetchPage, {
    startTime: 100,
    endTime: 400,
    maxPages: 5,
  });
  assert.equal(out.pages, 1);
});

test("pagination stops on repeated page boundary safeguard", async () => {
  let calls = 0;
  const page = Array.from({ length: 100 }, (_, i) => ({
    transactionId: `R_${i}`,
    orderType: "C2C",
    transactionTime: 300 - i,
    amount: "1",
    currency: "USDT",
  })) as any;

  const out = await collectTransactionsForWindow(async () => {
    calls += 1;
    return page;
  }, {
    startTime: 100,
    endTime: 400,
    maxPages: 5,
  });

  assert.equal(out.pages, 2);
  assert.ok(calls >= 2);
});
