import assert from "node:assert/strict";
import test from "node:test";
import { findOrderById } from "./binance-pay";

type Row = Record<string, unknown>;
type Result = { data: Row | null; error: { code?: string; message: string } | null };

function makeAdminMock(opts: {
  primary: Result;
  compat: Result;
  repair: Result;
}) {
  const state = {
    selectClause: "",
    usedCompat: false,
    usedRepair: false,
    updatedOrderId: null as string | null,
  };

  function selectBuilder() {
    let isCompat = false;
    return {
      eq: (_col: string, _val: string) => selectBuilder(),
      filter: (col: string, _op: string, _val: string) => {
        if (col === "raw_payload->>orderId") isCompat = true;
        return selectBuilderCompat(isCompat);
      },
      maybeSingle: async () => {
        if (isCompat) {
          state.usedCompat = true;
          return opts.compat;
        }
        return opts.primary;
      },
    };
  }

  function selectBuilderCompat(isCompat: boolean) {
    return {
      eq: (_col: string, _val: string) => selectBuilderCompat(isCompat),
      filter: (_col: string, _op: string, _val: string) => selectBuilderCompat(true),
      maybeSingle: async () => {
        if (isCompat) {
          state.usedCompat = true;
          return opts.compat;
        }
        return opts.primary;
      },
    };
  }

  function updateBuilder() {
    return {
      eq: (_col: string, _val: string) => updateBuilder(),
      is: (_col: string, _val: null) => updateBuilder(),
      select: (_cols: string) => ({
        maybeSingle: async () => {
          state.usedRepair = true;
          return opts.repair;
        },
      }),
    };
  }

  const admin = {
    from: (_table: string) => ({
      select: (cols: string) => {
        state.selectClause = cols;
        return selectBuilder();
      },
      update: (payload: { order_id?: string }) => {
        state.updatedOrderId = payload.order_id ?? null;
        return updateBuilder();
      },
    }),
  } as any;

  return { admin, state };
}

test("post-sync lookup succeeds by panel_id + order_id", async () => {
  const { admin, state } = makeAdminMock({
    primary: {
      data: {
        transaction_id: "P_A23K5G55Q4N71114",
        order_id: "446987840056057856",
        order_type: "C2C",
        transaction_time: "2026-08-06T01:00:00.000Z",
        amount: "10.0003",
        currency: "USDT",
        receiver_binance_id: "869555064",
      },
      error: null,
    },
    compat: { data: null, error: null },
    repair: { data: null, error: null },
  });

  const out = await findOrderById(admin, "panel_1", "446987840056057856");
  assert.equal(out.kind, "found");
  assert.equal(state.usedCompat, false);
});

test("compat lookup works when order_id column is missing", async () => {
  const { admin, state } = makeAdminMock({
    primary: { data: null, error: { code: "42703", message: "column order_id does not exist" } },
    compat: {
      data: {
        transaction_id: "P_A23K5G55Q4N71114",
        order_type: "C2C",
        transaction_time: "2026-08-06T01:00:00.000Z",
        amount: "10.0003",
        currency: "USDT",
        receiver_binance_id: "869555064",
      },
      error: null,
    },
    repair: { data: null, error: { code: "42703", message: "column order_id does not exist" } },
  });

  const out = await findOrderById(admin, "panel_1", "446987840056057856");
  assert.equal(out.kind, "found");
  if (out.kind === "found") {
    assert.equal(out.tx.order_id, "446987840056057856");
  }
  assert.equal(state.usedCompat, true);
  assert.equal(state.updatedOrderId, "446987840056057856");
});

test("lookup returns not_found when neither order_id nor raw_payload match", async () => {
  const { admin } = makeAdminMock({
    primary: { data: null, error: null },
    compat: { data: null, error: null },
    repair: { data: null, error: null },
  });

  const out = await findOrderById(admin, "panel_1", "446987840056057856");
  assert.equal(out.kind, "not_found");
  if (out.kind === "not_found") {
    assert.equal(out.code, "ORDER_ID_NOT_IN_CACHE");
  }
});

test("primary db lookup errors are classified as DATABASE_LOOKUP_FAILURE", async () => {
  const { admin } = makeAdminMock({
    primary: { data: null, error: { code: "PGRST205", message: "schema cache miss" } },
    compat: { data: null, error: null },
    repair: { data: null, error: null },
  });

  const out = await findOrderById(admin, "panel_1", "446987840056057856");
  assert.equal(out.kind, "error");
  if (out.kind === "error") {
    assert.equal(out.code, "DATABASE_LOOKUP_FAILURE");
    assert.equal(out.dbCode, "PGRST205");
  }
});
