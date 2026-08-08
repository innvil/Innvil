import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyProviderStatusReconciliation,
  isOrderEligibleForProviderStatusSync,
} from "./sync";

test("CASE 1: historical pending + provider Completed -> completed", () => {
  const out = classifyProviderStatusReconciliation("pending", { status: "Completed" });
  assert.equal(out.kind, "update");
  if (out.kind !== "update") return;
  assert.equal(out.nextStatus, "completed");
});

test("CASE 2: historical pending + provider Processing -> processing", () => {
  const out = classifyProviderStatusReconciliation("pending", { status: "Processing" });
  assert.equal(out.kind, "update");
  if (out.kind !== "update") return;
  assert.equal(out.nextStatus, "processing");
});

test("CASE 3: pending + provider pending -> remains pending", () => {
  const out = classifyProviderStatusReconciliation("pending", { status: "pending" });
  assert.equal(out.kind, "unchanged");
});

test("CASE 4: historical pending row with provider_order_id is still eligible (no date cut-off)", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "pending",
    provider_order_id: "12345",
    provider_response: null,
  });
  assert.equal(eligible, true);

  const out = classifyProviderStatusReconciliation("pending", { status: "completed" });
  assert.equal(out.kind, "update");
  if (out.kind !== "update") return;
  assert.equal(out.nextStatus, "completed");
});

test("CASE 5: local completed is not selected by pending-only reconciliation", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "completed",
    provider_order_id: "12345",
    provider_response: null,
  });
  assert.equal(eligible, false);
});

test("CASE 6: local processing is not selected by pending-only reconciliation", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "processing",
    provider_order_id: "12345",
    provider_response: null,
  });
  assert.equal(eligible, false);
});

test("CASE 7: local partial is not selected by pending-only reconciliation", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "partial",
    provider_order_id: "12345",
    provider_response: null,
  });
  assert.equal(eligible, false);
});

test("CASE 8: local failed is not selected by pending-only reconciliation", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "failed",
    provider_order_id: "12345",
    provider_response: null,
  });
  assert.equal(eligible, false);
});

test("CASE 9: held pending with no provider_order_id is not status-sync candidate", () => {
  const eligible = isOrderEligibleForProviderStatusSync({
    status: "pending",
    provider_order_id: null,
    provider_response: { held: true },
  });
  assert.equal(eligible, false);
});

test("CASE 10: pending + provider status API error -> remain pending (unchanged)", () => {
  const out = classifyProviderStatusReconciliation("pending", { error: "Temporary API error" });
  assert.equal(out.kind, "unchanged");
});

test("CASE 11: pending + unknown provider status -> remain pending (unchanged)", () => {
  const out = classifyProviderStatusReconciliation("pending", { status: "mystery-state" });
  assert.equal(out.kind, "unchanged");
});
