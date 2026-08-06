import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveOneRecord,
  archivePanelEligibleRecords,
  restoreOneRecord,
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
      superadminHiddenAt: null,
      superadminHiddenBy: null,
      superadminHiddenReason: null,
    },
  ];
}

test("superadmin archives completed payment", () => {
  const rows = makeRows();
  const beforeWallet = rows[0].walletBalanceAfter;
  const beforeLedger = rows[0].ledgerCount;
  const out = archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  assert.equal(out.affectedCount, 1);
  assert.ok(rows[0].superadminHiddenAt);
  assert.equal(rows[0].walletBalanceAfter, beforeWallet);
  assert.equal(rows[0].ledgerCount, beforeLedger);
});

test("superadmin archives rejected payment", () => {
  const rows = makeRows();
  const out = archiveOneRecord(rows, "pay_rejected_a", "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  assert.equal(out.affectedCount, 1);
  assert.ok(rows[1].superadminHiddenAt);
});

test("pending cannot be archived", () => {
  const rows = makeRows();
  const out = archiveOneRecord(rows, "pay_pending_a", "super_1", "cleanup", true);
  assert.equal(out.ok, false);
  assert.equal(out.error, "ONLY_COMPLETED_OR_REJECTED_ALLOWED");
  assert.equal(rows[2].superadminHiddenAt, null);
});

test("approved cannot be archived", () => {
  const rows = makeRows();
  const out = archiveOneRecord(rows, "pay_approved_a", "super_1", "cleanup", true);
  assert.equal(out.ok, false);
  assert.equal(out.error, "ONLY_COMPLETED_OR_REJECTED_ALLOWED");
  assert.equal(rows[3].superadminHiddenAt, null);
});

test("non-superadmin receives FORBIDDEN", () => {
  const rows = makeRows();
  const out = archiveOneRecord(rows, "pay_completed_a", "user_1", "cleanup", false);
  assert.equal(out.ok, false);
  assert.equal(out.error, "FORBIDDEN");
});

test("archived payment remains in database", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  assert.equal(rows.some((r) => r.id === "pay_completed_a"), true);
});

test("customer history hides archived payment", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  const visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_completed_a"), false);
});

test("owner history hides archived payment", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_rejected_a", "super_1", "cleanup", true);
  const visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_rejected_a"), false);
});

test("customer snapshot hides archived payment", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  const snapshotRows = visiblePaymentHistory(rows).map((r) => r.id);
  assert.equal(snapshotRows.includes("pay_completed_a"), false);
});

test("Binance reconciliation hides archived payment", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_rejected_a", "super_1", "cleanup", true);
  const reconciliationRows = visiblePaymentHistory(rows).map((r) => r.id);
  assert.equal(reconciliationRows.includes("pay_rejected_a"), false);
});

test("wallet and ledger remain unchanged", () => {
  const rows = makeRows();
  const before = rows.map((r) => ({ id: r.id, wallet: r.walletBalanceAfter, ledger: r.ledgerCount }));
  archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  restoreOneRecord(rows, "pay_completed_a", true);
  for (const item of before) {
    const row = rows.find((r) => r.id === item.id)!;
    assert.equal(row.walletBalanceAfter, item.wallet);
    assert.equal(row.ledgerCount, item.ledger);
  }
});

test("restore makes the payment visible again", () => {
  const rows = makeRows();
  archiveOneRecord(rows, "pay_completed_a", "super_1", "cleanup", true);
  let visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_completed_a"), false);

  const restored = restoreOneRecord(rows, "pay_completed_a", true);
  assert.equal(restored.ok, true);
  visible = visiblePaymentHistory(rows);
  assert.equal(visible.some((r) => r.id === "pay_completed_a"), true);
});

test("panel-scoped archive cannot affect another panel", () => {
  const rows = makeRows();
  const out = archivePanelEligibleRecords(rows, "panel_a", "super_1", "cleanup", true);
  assert.equal(out.ok, true);
  const panelAVisible = visiblePaymentHistory(rows).filter((r) => r.panelId === "panel_a");
  const panelBVisible = visiblePaymentHistory(rows).filter((r) => r.panelId === "panel_b");

  // eligible panel A rows archived; pending/approved remain visible
  assert.equal(panelAVisible.some((r) => r.id === "pay_completed_a"), false);
  assert.equal(panelAVisible.some((r) => r.id === "pay_rejected_a"), false);
  assert.equal(panelAVisible.some((r) => r.id === "pay_pending_a"), true);
  assert.equal(panelAVisible.some((r) => r.id === "pay_approved_a"), true);

  // panel B is untouched
  assert.equal(panelBVisible.some((r) => r.id === "pay_completed_b"), true);
});
