import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveSearchMatches,
  deriveArchiveRenderState,
  filterPaymentArchiveRows,
  normalizeArchiveSearch,
  shouldReloadAfterBulkMutation,
  shouldReloadForPanelChange,
  shouldReloadForViewChange,
  sortRowsNewestFirst,
  type PaymentArchiveViewRow,
} from "./payment-archive-view";

function row(partial: Partial<PaymentArchiveViewRow> & Pick<PaymentArchiveViewRow, "id">): PaymentArchiveViewRow {
  return {
    id: partial.id,
    panelId: partial.panelId ?? "panel_a",
    maskedPaymentId: partial.maskedPaymentId ?? `${partial.id.slice(0, 4)}...${partial.id.slice(-3)}`,
    customerId: partial.customerId ?? "cust_a",
    customerUsername: partial.customerUsername ?? "alice",
    customerEmail: partial.customerEmail ?? "alice@example.com",
    gateway: partial.gateway ?? "binance_pay",
    panelName: partial.panelName ?? "Panel A",
    status: partial.status ?? "pending",
    createdAt: partial.createdAt ?? "2026-08-01T00:00:00.000Z",
  };
}

test("normalizeArchiveSearch unifies spaces, underscores, and hyphens", () => {
  assert.equal(normalizeArchiveSearch(" Binance Pay "), "binancepay");
  assert.equal(normalizeArchiveSearch("binance_pay"), "binancepay");
  assert.equal(normalizeArchiveSearch("binance-pay"), "binancepay");
});

test("binance search variants match binance_pay", () => {
  const r = row({ id: "pay_001", gateway: "binance_pay" });
  assert.equal(archiveSearchMatches(r, "binance"), true);
  assert.equal(archiveSearchMatches(r, "Binance Pay"), true);
  assert.equal(archiveSearchMatches(r, "binance_pay"), true);
  assert.equal(archiveSearchMatches(r, "binance-pay"), true);
});

test("selected panel shows only its own rows", () => {
  const rows = [
    row({ id: "pay_1", panelId: "panel_a" }),
    row({ id: "pay_2", panelId: "panel_b" }),
    row({ id: "pay_3", panelId: "panel_a" }),
  ];
  const out = filterPaymentArchiveRows(rows, { panelId: "panel_a", status: "all", search: "" });
  assert.equal(out.length, 2);
  assert.equal(out.every((r) => r.panelId === "panel_a"), true);
});

test("default status all includes all statuses", () => {
  const rows = [
    row({ id: "pay_a", status: "pending" }),
    row({ id: "pay_b", status: "approved" }),
    row({ id: "pay_c", status: "rejected" }),
    row({ id: "pay_d", status: "completed" }),
  ];
  const out = filterPaymentArchiveRows(rows, { panelId: "panel_a", status: "all", search: "" });
  assert.equal(out.length, 4);
});

test("pending status filter returns only pending", () => {
  const rows = [
    row({ id: "pay_a", status: "pending" }),
    row({ id: "pay_b", status: "approved" }),
    row({ id: "pay_c", status: "pending" }),
  ];
  const out = filterPaymentArchiveRows(rows, { panelId: "panel_a", status: "pending", search: "" });
  assert.equal(out.length, 2);
  assert.equal(out.every((r) => r.status === "pending"), true);
});

test("records older than former global top-300 still appear in panel-scoped filtering", () => {
  const rows: PaymentArchiveViewRow[] = [];
  for (let i = 0; i < 350; i += 1) {
    rows.push(
      row({
        id: `pay_${i}`,
        panelId: "panel_a",
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })
    );
  }
  const out = filterPaymentArchiveRows(rows, { panelId: "panel_a", status: "all", search: "" });
  assert.equal(out.length, 350);
});

test("newest rows appear first", () => {
  const rows = [
    row({ id: "pay_old", createdAt: "2026-07-01T10:00:00.000Z" }),
    row({ id: "pay_new", createdAt: "2026-08-01T10:00:00.000Z" }),
    row({ id: "pay_mid", createdAt: "2026-07-15T10:00:00.000Z" }),
  ];
  const out = sortRowsNewestFirst(rows);
  assert.deepEqual(out.map((r) => r.id), ["pay_new", "pay_mid", "pay_old"]);
});

test("render states are distinct for no-panel, loading, empty, no-match, and failure", () => {
  assert.equal(
    deriveArchiveRenderState({ panelId: "", loading: false, loadFailed: false, panelTotalCount: 0, filteredCount: 0 }),
    "no-panel"
  );
  assert.equal(
    deriveArchiveRenderState({ panelId: "panel_a", loading: true, loadFailed: false, panelTotalCount: 0, filteredCount: 0 }),
    "loading"
  );
  assert.equal(
    deriveArchiveRenderState({ panelId: "panel_a", loading: false, loadFailed: true, panelTotalCount: 10, filteredCount: 10 }),
    "load-failed"
  );
  assert.equal(
    deriveArchiveRenderState({ panelId: "panel_a", loading: false, loadFailed: false, panelTotalCount: 0, filteredCount: 0 }),
    "panel-empty"
  );
  assert.equal(
    deriveArchiveRenderState({ panelId: "panel_a", loading: false, loadFailed: false, panelTotalCount: 8, filteredCount: 0 }),
    "filter-empty"
  );
  assert.equal(
    deriveArchiveRenderState({ panelId: "panel_a", loading: false, loadFailed: false, panelTotalCount: 8, filteredCount: 3 }),
    "has-rows"
  );
});

test("panel and view changes trigger reload intent", () => {
  assert.equal(shouldReloadForPanelChange("panel_a", "panel_b"), true);
  assert.equal(shouldReloadForPanelChange("panel_a", "panel_a"), false);
  assert.equal(shouldReloadForViewChange("active", "archived"), true);
  assert.equal(shouldReloadForViewChange("archived", "archived"), false);
});

test("archive/restore success trigger reload intent", () => {
  assert.equal(shouldReloadAfterBulkMutation(true), true);
  assert.equal(shouldReloadAfterBulkMutation(false), false);
});
