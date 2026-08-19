import { test } from "node:test";
import assert from "node:assert/strict";
import { creditPriceUsd, creditSavingsUsd, INNVIL_CREDIT_DISCOUNT, toCents } from "./innvil-credit-pricing";

/* --------------------------------------------------------------- discount ---- */

test("REQUIRED: Bronze (basic) has zero Innvil Credit discount", () => {
  assert.equal(INNVIL_CREDIT_DISCOUNT.basic, 0);
});
test("REQUIRED: Silver (standard) has a 5% discount", () => {
  assert.equal(INNVIL_CREDIT_DISCOUNT.standard, 0.05);
});
test("REQUIRED: Gold (premium) has a 5% discount", () => {
  assert.equal(INNVIL_CREDIT_DISCOUNT.premium, 0.05);
});
test("REQUIRED: Platinum (pro) has a 5% discount", () => {
  assert.equal(INNVIL_CREDIT_DISCOUNT.pro, 0.05);
});

/* ------------------------------------------------- exact spec worked examples ---- */

test("REQUIRED: Silver $129.99 -> $123.49 with Innvil Credit (exact spec worked example)", () => {
  assert.equal(creditPriceUsd(129.99, "standard"), 123.49);
});
test("REQUIRED: Gold $219.99 -> $208.99 with Innvil Credit (exact spec worked example)", () => {
  assert.equal(creditPriceUsd(219.99, "premium"), 208.99);
});
test("REQUIRED: Platinum $379.99 -> $360.99 with Innvil Credit (exact spec worked example)", () => {
  assert.equal(creditPriceUsd(379.99, "pro"), 360.99);
});
test("REQUIRED: Bronze $49.99 is unchanged (no discount)", () => {
  assert.equal(creditPriceUsd(49.99, "basic"), 49.99);
});

test("creditSavingsUsd matches the difference between regular and credit price exactly", () => {
  assert.equal(creditSavingsUsd(129.99, "standard"), 6.5);
  assert.equal(creditSavingsUsd(49.99, "basic"), 0);
});

test("REQUIRED: rounding is deterministic -- integer cent arithmetic, never float drift across repeated calls", () => {
  const a = creditPriceUsd(129.99, "standard");
  const b = creditPriceUsd(129.99, "standard");
  assert.equal(a, b);
  assert.equal(toCents(a), 12349);
});

test("toCents rounds a plain USD amount to the nearest cent", () => {
  assert.equal(toCents(129.99), 12999);
  assert.equal(toCents(10), 1000);
});
