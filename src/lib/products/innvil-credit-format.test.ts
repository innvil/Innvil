import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsd } from "./innvil-credit-format";

test("REQUIRED: zero balance formats as $0.00, never hidden/blank", () => {
  assert.equal(formatUsd(0), "$0.00");
});

test("REQUIRED: a positive balance uses canonical USD formatting with thousands separators", () => {
  assert.equal(formatUsd(12500), "$125.00");
  assert.equal(formatUsd(125050), "$1,250.50");
});

test("formatUsd never uses unsafe floating-point display (exact cent precision)", () => {
  assert.equal(formatUsd(12349), "$123.49");
  assert.equal(formatUsd(1), "$0.01");
});
