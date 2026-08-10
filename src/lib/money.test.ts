import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODERATOR_BASIC_PRICE, MODERATOR_STANDARD_PRICE, MODERATOR_PREMIUM_PRICE, MODERATOR_PRO_PRICE,
  MODERATOR_ENTERPRISE_MIN_SLOTS, moderatorPlanPrice, type ModeratorPlanTier,
} from "./money";
import { CAPACITY, TRIAL_CAPACITY } from "./moderator/plan";

/* ---------------------------------------------------- canonical pricing ---- */
// Single source of truth: src/lib/money.ts. These assertions guard against
// the exact "scattered 49.99/99.99/179.99/299.99 through UI/actions/billing
// files" the update was explicit about avoiding -- everything should read
// through these constants, never redeclare the numbers.

test("REQUIRED: canonical AI Moderator prices match the approved pricing table", () => {
  assert.equal(MODERATOR_BASIC_PRICE, 49.99);
  assert.equal(MODERATOR_STANDARD_PRICE, 99.99);
  assert.equal(MODERATOR_PREMIUM_PRICE, 179.99);
  assert.equal(MODERATOR_PRO_PRICE, 299.99);
});

test("moderatorPlanPrice resolves each tier to its canonical price", () => {
  const cases: Array<[ModeratorPlanTier, number]> = [
    ["basic", 49.99],
    ["standard", 99.99],
    ["premium", 179.99],
    ["pro", 299.99],
  ];
  for (const [tier, price] of cases) assert.equal(moderatorPlanPrice(tier), price);
});

test("REQUIRED: slot counts per tier match the approved pricing table (Basic 2 / Standard 5 / Premium 10 / Pro 20)", () => {
  assert.equal(CAPACITY.basic.maxActiveSlots, 2);
  assert.equal(CAPACITY.standard.maxActiveSlots, 5);
  assert.equal(CAPACITY.premium.maxActiveSlots, 10);
  assert.equal(CAPACITY.pro.maxActiveSlots, 20);
});

/* -------------------------------------------------------------- enterprise ---- */

test("REQUIRED: Enterprise starts immediately after Pro's slot count (20+)", () => {
  assert.equal(MODERATOR_ENTERPRISE_MIN_SLOTS, CAPACITY.pro.maxActiveSlots + 1);
});

test('REQUIRED: Enterprise cannot flow into normal tier billing -- "enterprise" is not a valid ModeratorPlanTier at all', () => {
  // @ts-expect-error -- "enterprise" must not be assignable to ModeratorPlanTier;
  // this line failing to error (i.e. Enterprise silently becoming a real
  // billable tier) is exactly the regression this test exists to catch --
  // `tsc --noEmit` fails if this directive becomes unused.
  const attempted: ModeratorPlanTier = "enterprise";
  const validTiers: ModeratorPlanTier[] = ["basic", "standard", "premium", "pro"];
  assert.ok(!validTiers.includes(attempted));
});

test("trial capacity is unaffected by the pricing update (still 1 slot)", () => {
  assert.equal(TRIAL_CAPACITY.maxActiveSlots, 1);
});
