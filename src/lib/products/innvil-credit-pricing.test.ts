import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditPriceUsd, creditSavingsUsd, INNVIL_CREDIT_DISCOUNT, toCents,
  annualCreditPriceUsd, annualSavingsUsd, annualEquivalentMonthlyUsd, ANNUAL_CREDIT_DISCOUNT_BPS, ANNUAL_ELIGIBLE_TIERS,
} from "./innvil-credit-pricing";
import {
  COMMUNITY_EXPANSION_MONTHLY_PRICE,
  MODERATOR_BASIC_PRICE, MODERATOR_STANDARD_PRICE, MODERATOR_PREMIUM_PRICE, MODERATOR_PRO_PRICE,
} from "@/src/lib/money";

/* ---------------------------- 2026-08-22 repriced self-serve tiers ---- */
// The discount MATH itself (below) is input-agnostic and was already fully
// tested against arbitrary literal prices before this repricing -- these
// tests specifically prove the REAL, CURRENT canonical prices (money.ts)
// flow through it correctly, so a future price change is caught here too.

test("REQUIRED: repriced Bronze $29.99 -> $29.99 with Innvil Credit (0% discount, unchanged)", () => {
  assert.equal(creditPriceUsd(MODERATOR_BASIC_PRICE, "basic"), 29.99);
});
test("REQUIRED: repriced Silver $59.99 -> $56.99 with Innvil Credit (5% discount)", () => {
  assert.equal(creditPriceUsd(MODERATOR_STANDARD_PRICE, "standard"), 56.99);
});
test("REQUIRED: repriced Gold $99.99 -> $94.99 with Innvil Credit (5% discount)", () => {
  assert.equal(creditPriceUsd(MODERATOR_PREMIUM_PRICE, "premium"), 94.99);
});
test("REQUIRED: repriced Platinum $199.00 -> $189.05 with Innvil Credit (5% discount)", () => {
  assert.equal(creditPriceUsd(MODERATOR_PRO_PRICE, "pro"), 189.05);
});
test("REQUIRED: repriced annual prices -- 10% off 12x the new monthly regular price, never stacked with the monthly discount", () => {
  assert.equal(annualCreditPriceUsd(MODERATOR_BASIC_PRICE), 323.89);
  assert.equal(annualCreditPriceUsd(MODERATOR_STANDARD_PRICE), 647.89);
  assert.equal(annualCreditPriceUsd(MODERATOR_PREMIUM_PRICE), 1079.89);
  assert.equal(annualCreditPriceUsd(MODERATOR_PRO_PRICE), 2149.2);
});

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

/* --------------------------------------------------------- annual billing ---- */

test("REQUIRED: annual discount is exactly 10%", () => {
  assert.equal(ANNUAL_CREDIT_DISCOUNT_BPS, 1000);
});

test("REQUIRED: all four self-serve tiers, including Bronze, are annual-eligible", () => {
  assert.deepEqual(ANNUAL_ELIGIBLE_TIERS.sort(), ["basic", "premium", "pro", "standard"]);
});

test("REQUIRED (test 1): Bronze annual credit price = 10% off 12 x canonical monthly price -- $539.89", () => {
  assert.equal(annualCreditPriceUsd(49.99), 539.89);
});
test("REQUIRED (test 2): Silver annual credit price -- $1,403.89", () => {
  assert.equal(annualCreditPriceUsd(129.99), 1403.89);
});
test("REQUIRED (test 3): Gold annual credit price -- $2,375.89", () => {
  assert.equal(annualCreditPriceUsd(219.99), 2375.89);
});
test("REQUIRED (test 4): Platinum annual credit price -- $4,103.89", () => {
  assert.equal(annualCreditPriceUsd(379.99), 4103.89);
});

test("REQUIRED (test 6): the monthly 5% Innvil Credit discount is never stacked into the annual price -- annual is computed from the REGULAR monthly price, not the discounted monthly-credit price", () => {
  const viaRegular = annualCreditPriceUsd(129.99);
  const viaDiscountedMonthly = Math.round(creditPriceUsd(129.99, "standard") * 12 * 0.9 * 100) / 100;
  // These would be materially different numbers if annual pricing ever
  // accidentally started from the already-discounted monthly price.
  assert.notEqual(viaRegular, viaDiscountedMonthly);
  assert.equal(viaRegular, 1403.89);
});

test("REQUIRED (test 8): annual price rounding is deterministic across repeated calls", () => {
  assert.equal(annualCreditPriceUsd(129.99), annualCreditPriceUsd(129.99));
});

test("REQUIRED (test 9): equivalent-monthly display matches annual/12, rounded to the cent", () => {
  assert.equal(annualEquivalentMonthlyUsd(129.99), 116.99);
});

test("REQUIRED (test 10): savings is computed against 12x the REGULAR monthly price, matching the exact spec worked example", () => {
  assert.equal(annualSavingsUsd(129.99), 155.99);
});

test("annual pricing works for a tier with NO monthly credit discount (Bronze) -- the two discounts are independent", () => {
  assert.equal(INNVIL_CREDIT_DISCOUNT.basic, 0);
  assert.ok(annualSavingsUsd(49.99) > 0, "Bronze still gets the annual 10% discount even though its monthly credit discount is 0%");
});

/* ------------------------------------ Community Expansion add-on pricing ---- */
// The add-on reuses these SAME canonical creditPriceUsd/annualCreditPriceUsd
// functions applied to COMMUNITY_EXPANSION_MONTHLY_PRICE -- no separate
// pricing formula was written for it, so these tests double as regression
// coverage for that reuse.

test("REQUIRED: Gold monthly Community Expansion regular price is $12.99", () => {
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, 12.99);
});
test("REQUIRED: Platinum monthly Community Expansion regular price is $19.99", () => {
  assert.equal(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro, 19.99);
});

test("REQUIRED: Gold Community Expansion monthly Innvil Credit price uses the existing 5% monthly discount rule", () => {
  assert.equal(creditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, "premium"), 12.34);
});
test("Platinum Community Expansion monthly Innvil Credit price uses the existing 5% monthly discount rule", () => {
  assert.equal(creditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro, "pro"), 18.99);
});

test("REQUIRED: Gold annual Community Expansion = 10% off 12 x $12.99 -- matches the exact spec worked example ($140.29/year)", () => {
  assert.equal(annualCreditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium), 140.29);
});
test("REQUIRED: Platinum annual Community Expansion = 10% off 12 x $19.99 -- matches the exact spec worked example ($215.89/year)", () => {
  assert.equal(annualCreditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.pro), 215.89);
});

test("REQUIRED: the annual Community Expansion price never stacks the monthly 5% discount on top of the annual 10% -- it's computed from the REGULAR $12.99/$19.99, not the discounted monthly-credit price", () => {
  const viaRegular = annualCreditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium);
  const viaDiscountedMonthly = Math.round(creditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE.premium, "premium") * 12 * 0.9 * 100) / 100;
  assert.notEqual(viaRegular, viaDiscountedMonthly);
  assert.equal(viaRegular, 140.29);
});
