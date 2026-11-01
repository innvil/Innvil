import assert from "node:assert/strict";
import test from "node:test";
import {
  isBulkArchiveDisabled,
  isBulkRestoreDisabled,
  shouldClearSelection,
  type PaymentArchiveSelectionScope,
} from "./payment-archive-selection";

const base: PaymentArchiveSelectionScope = {
  panelId: "panel_a",
  search: "",
  status: "all",
  view: "active",
};

test("panel change clears selection", () => {
  const next: PaymentArchiveSelectionScope = { ...base, panelId: "panel_b" };
  assert.equal(shouldClearSelection(base, next), true);
});

test("search/status/view changes clear selection", () => {
  assert.equal(shouldClearSelection(base, { ...base, search: "abc" }), true);
  assert.equal(shouldClearSelection(base, { ...base, status: "pending" }), true);
  assert.equal(shouldClearSelection(base, { ...base, view: "archived" }), true);
});

test("unchanged scope does not clear selection", () => {
  assert.equal(shouldClearSelection(base, { ...base }), false);
});

test("no selection disables archive/restore actions", () => {
  assert.equal(isBulkArchiveDisabled({ selectedCount: 0, panelId: "panel_a", view: "active", busy: null }), true);
  assert.equal(isBulkRestoreDisabled({ selectedCount: 0, panelId: "panel_a", view: "archived", busy: null }), true);
});

test("view mismatch disables corresponding action", () => {
  assert.equal(isBulkArchiveDisabled({ selectedCount: 2, panelId: "panel_a", view: "archived", busy: null }), true);
  assert.equal(isBulkRestoreDisabled({ selectedCount: 2, panelId: "panel_a", view: "active", busy: null }), true);
});

test("valid selection enables correct action", () => {
  assert.equal(isBulkArchiveDisabled({ selectedCount: 2, panelId: "panel_a", view: "active", busy: null }), false);
  assert.equal(isBulkRestoreDisabled({ selectedCount: 2, panelId: "panel_a", view: "archived", busy: null }), false);
});
