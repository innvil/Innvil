import { test } from "node:test";
import assert from "node:assert/strict";
import { watchPlanDisplayName, watchTierFromDisplayName, watchPlanOptions } from "./watch-plans";
import { moderatorPlanPrice } from "@/src/lib/money";

/**
 * Customer-facing Watch plan rename: Basic->Bronze, Standard->Silver,
 * Premium->Gold, Pro->Platinum. Display-name layer only -- the stable
 * internal ModeratorPlanTier ("basic"/"standard"/"premium"/"pro") and every
 * price/entitlement constant in money.ts are untouched by this file.
 */

test("REQUIRED: Basic maps to Bronze", () => {
  assert.equal(watchPlanDisplayName("basic"), "Bronze");
});
test("REQUIRED: Standard maps to Silver", () => {
  assert.equal(watchPlanDisplayName("standard"), "Silver");
});
test("REQUIRED: Premium maps to Gold", () => {
  assert.equal(watchPlanDisplayName("premium"), "Gold");
});
test("REQUIRED: Pro maps to Platinum", () => {
  assert.equal(watchPlanDisplayName("pro"), "Platinum");
});

test("REQUIRED: display name -> internal tier round-trips exactly", () => {
  for (const [display, tier] of [["Bronze", "basic"], ["Silver", "standard"], ["Gold", "premium"], ["Platinum", "pro"]] as const) {
    assert.equal(watchTierFromDisplayName(display), tier);
    assert.equal(watchPlanDisplayName(tier), display);
  }
});

test("watchPlanOptions reads live prices straight from money.ts, never a hardcoded duplicate", () => {
  const options = watchPlanOptions();
  for (const opt of options) {
    assert.equal(opt.price, moderatorPlanPrice(opt.tier));
  }
});

test("watchPlanOptions returns exactly the 4 self-serve tiers, in ascending order, Enterprise excluded", () => {
  const options = watchPlanOptions();
  assert.deepEqual(options.map((o) => o.displayName), ["Bronze", "Silver", "Gold", "Platinum"]);
  for (let i = 1; i < options.length; i++) assert.ok(options[i].price > options[i - 1].price, "prices should ascend Bronze -> Platinum");
});
