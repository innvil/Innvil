import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveSelectedRecords,
  restoreSelectedRecords,
  visiblePaymentHistory,
  type PaymentArchiveRecord,
} from "./payment-archive-core";

function makeRows(): PaymentArchiveRecord[] {
  return [
    {
      id: "pay_completed_a",
      panelId: "panel_a",
      customerId: "cust_a",
      status: "completed",
      amount: 10,
      walletBalanceAfter: 500,
      ledgerCount: 4,
      binanceOrderId: "ord-a",
      binanceTxId: "tx-a",
      duplicateGuardKey: "dup-a",
      reconciliationRef: "rec-a",
      auditRef: "audit-a",
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
    {
      id: "pay_rejected_a",
      panelId: "panel_a",
      customerId: "cust_b",
      status: "rejected",
      amount: 12,
      walletBalanceAfter: 700,
      ledgerCount: 7,
      binanceOrderId: "ord-b",
      binanceTxId: "tx-b",
      duplicateGuardKey: "dup-b",
      reconciliationRef: "rec-b",
      auditRef: "audit-b",
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
    {
      id: "pay_pending_a",
      panelId: "panel_a",
      customerId: "cust_c",
      status: "pending",
      amount: 13,
      walletBalanceAfter: 900,
      ledgerCount: 9,
      binanceOrderId: "ord-c",
      binanceTxId: "tx-c",
      duplicateGuardKey: "dup-c",
      reconciliationRef: "rec-c",
      auditRef: "audit-c",
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
    {
      id: "pay_approved_a",
      panelId: "panel_a",
      customerId: "cust_d",
      status: "approved",
      amount: 14,
      walletBalanceAfter: 800,
      ledgerCount: 8,
      binanceOrderId: "ord-d",
      binanceTxId: "tx-d",
      duplicateGuardKey: "dup-d",
      reconciliationRef: "rec-d",
      auditRef: "audit-d",
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
    {
      id: "pay_completed_b",
      panelId: "panel_b",
      customerId: "cust_e",
      status: "completed",
      amount: 21,
      walletBalanceAfter: 300,
      ledgerCount: 3,
      binanceOrderId: "ord-e",
      binanceTxId: "tx-e",
      duplicateGuardKey: "dup-e",
      reconciliationRef: "rec-e",
      auditRef: "audit-e",
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
  ];
}

test("selecting one pending payment archives only that payment", () => {
  const rows = makeRows();
  const out = archiveSelectedRecords(rows, "panel_a", ["pay_pending_a"], "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  assert.equal(out.archivedCount, 1);
  assert.ok(rows[2].superadminHiddenAt);
  assert.equal(rows[0].superadminHiddenAt, null);
  assert.equal(rows[1].superadminHiddenAt, null);
});

test("selecting completed and pending together archives both", () => {
  const rows = makeRows();
  const out = archiveSelectedRecords(rows, "panel_a", ["pay_completed_a", "pay_pending_a"], "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  assert.equal(out.archivedCount, 2);
  assert.ok(rows[0].superadminHiddenAt);
  assert.ok(rows[2].superadminHiddenAt);
});

test("select all includes all statuses", () => {
  const rows = makeRows();
  const ids = rows.filter((r) => r.panelId === "panel_a").map((r) => r.id);
  const out = archiveSelectedRecords(rows, "panel_a", ids, "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  assert.equal(out.archivedCount, 4);
  assert.equal(rows[0].superadminHiddenAt !== null, true);
  assert.equal(rows[1].superadminHiddenAt !== null, true);
  assert.equal(rows[2].superadminHiddenAt !== null, true);
  assert.equal(rows[3].superadminHiddenAt !== null, true);
});

test("selected IDs from another panel are rejected", () => {
  const rows = makeRows();
  const out = archiveSelectedRecords(rows, "panel_a", ["pay_completed_a", "pay_completed_b"], "super_1", "cleanup", true);
  assert.equal(out.ok, false);
  assert.equal(out.error, "CROSS_PANEL_SELECTION");
  assert.equal(rows[0].superadminHiddenAt, null);
  assert.equal(rows[4].superadminHiddenAt, null);
});

test("archive preserves original status", () => {
  const rows = makeRows();
  const original = new Map(rows.map((r) => [r.id, r.status]));
  const out = archiveSelectedRecords(rows, "panel_a", ["pay_completed_a", "pay_pending_a"], "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  for (const row of rows) {
    assert.equal(row.status, original.get(row.id));
  }
});

test("archive does not change wallet, ledger, binance ids, or references", () => {
  const rows = makeRows();
  const before = rows.map((r) => ({
    id: r.id,
    walletBalanceAfter: r.walletBalanceAfter,
    ledgerCount: r.ledgerCount,
    binanceOrderId: r.binanceOrderId,
    binanceTxId: r.binanceTxId,
    duplicateGuardKey: r.duplicateGuardKey,
    reconciliationRef: r.reconciliationRef,
    auditRef: r.auditRef,
  }));
  const out = archiveSelectedRecords(rows, "panel_a", ["pay_completed_a", "pay_pending_a"], "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  for (const item of before) {
    const row = rows.find((r) => r.id === item.id)!;
    assert.equal(row.walletBalanceAfter, item.walletBalanceAfter);
    assert.equal(row.ledgerCount, item.ledgerCount);
    assert.equal(row.binanceOrderId, item.binanceOrderId);
    assert.equal(row.binanceTxId, item.binanceTxId);
    assert.equal(row.duplicateGuardKey, item.duplicateGuardKey);
    assert.equal(row.reconciliationRef, item.reconciliationRef);
    assert.equal(row.auditRef, item.auditRef);
  }
});

test("archived rows remain in the database", () => {
  const rows = makeRows();
  archiveSelectedRecords(rows, "panel_a", ["pay_completed_a"], "super_1", "cleanup", true);
  assert.equal(rows.some((r) => r.id === "pay_completed_a"), true);
});

test("customer and owner visible history hide archived rows", () => {
  const rows = makeRows();
  archiveSelectedRecords(rows, "panel_a", ["pay_rejected_a"], "super_1", "cleanup", true);
  const visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_rejected_a"), false);
});

test("restore makes the payment visible again", () => {
  const rows = makeRows();
  archiveSelectedRecords(rows, "panel_a", ["pay_completed_a"], "super_1", "cleanup", true);
  let visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_completed_a"), false);

  const restored = restoreSelectedRecords(rows, "panel_a", ["pay_completed_a"], true);
  assert.equal(restored.ok, true);
  assert.equal(restored.restoredCount, 1);
  assert.equal(rows[0].status, "completed");
  visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_completed_a"), true);
});

test("non-superadmin requests return FORBIDDEN", () => {
  const rows = makeRows();
  const a = archiveSelectedRecords(rows, "panel_a", ["pay_pending_a"], "u1", "cleanup", false);
  assert.equal(a.ok, false);
  assert.equal(a.error, "FORBIDDEN");
  const r = restoreSelectedRecords(rows, "panel_a", ["pay_pending_a"], false);
  assert.equal(r.ok, false);
  assert.equal(r.error, "FORBIDDEN");
});
