import { test } from "node:test";
import assert from "node:assert/strict";
import { watchOnboardingSteps, watchPlanCapacityTable } from "./watch-onboarding";
import { CAPACITY, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";
import { MODERATOR_COMMUNITY_CAPACITY } from "@/src/lib/money";
import { watchPlanOptions } from "./watch-plans";

/**
 * The landing page's "Getting Started" guide must never drift from actual
 * enforcement — these tests pin that every number shown traces back to the
 * SAME canonical constants the backend uses, not a second hardcoded copy.
 */

test("REQUIRED: watchPlanCapacityTable's Watcher-slot counts match the canonical CAPACITY table exactly", () => {
  const table = watchPlanCapacityTable();
  const options = watchPlanOptions();
  for (let i = 0; i < options.length; i++) {
    assert.equal(table[i].watcherSlots, CAPACITY[options[i].tier].maxActiveSlots);
  }
});

test("REQUIRED: watchPlanCapacityTable's community counts match MODERATOR_COMMUNITY_CAPACITY exactly", () => {
  const table = watchPlanCapacityTable();
  const options = watchPlanOptions();
  for (let i = 0; i < options.length; i++) {
    assert.equal(table[i].communities, MODERATOR_COMMUNITY_CAPACITY[options[i].tier].included);
  }
});

test("watchPlanCapacityTable has exactly the 4 self-serve tiers, Bronze through Platinum, ascending price", () => {
  const table = watchPlanCapacityTable();
  assert.deepEqual(table.map((t) => t.displayName), ["Bronze", "Silver", "Gold", "Platinum"]);
  for (let i = 1; i < table.length; i++) assert.ok(table[i].price > table[i - 1].price);
});

test("REQUIRED: watchOnboardingSteps has exactly 8 steps, numbered 01 through 08", () => {
  const steps = watchOnboardingSteps();
  assert.equal(steps.length, 8);
  assert.deepEqual(steps.map((s) => s.n), ["01", "02", "03", "04", "05", "06", "07", "08"]);
});

test("REQUIRED: the per-community deployment limit shown in the guide matches MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY", () => {
  const steps = watchOnboardingSteps();
  const deployStep = steps.find((s) => s.title.toLowerCase().includes("deploy"));
  assert.ok(deployStep);
  const communityCallout = deployStep!.callouts.find((c) => c.kind === "community-limit");
  assert.ok(communityCallout);
  assert.match(communityCallout!.text, new RegExp(String(MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY)));
});

test("REQUIRED: no step claims Forge/Panel ownership is required to use Watch directly", () => {
  const steps = watchOnboardingSteps();
  const allText = steps.flatMap((s) => [s.summary, ...s.body, ...s.callouts.map((c) => c.text)]).join(" ").toLowerCase();
  assert.ok(!/you (must|need to) (own|create|have) a panel/i.test(allText));
});

test("REQUIRED: normal Watch setup steps use plain product copy -- no Panel/Forge explanation, Watch reads as standalone by default", () => {
  const steps = watchOnboardingSteps();
  // Every step except the honest Telegram-connect limitation (04).
  const normalSteps = steps.filter((s) => s.n !== "04");
  const allText = normalSteps.flatMap((s) => [s.summary, ...s.body, ...s.callouts.map((c) => c.text)]).join(" ").toLowerCase();
  assert.ok(!allText.includes("panel"), "normal Watch setup copy should never mention Panel");
  assert.ok(!allText.includes("forge"), "normal Watch setup copy should never mention Forge");
});

test("the Telegram-connect step (04) honestly flags that self-serve connection is still rolling out, without explaining Panels", () => {
  const steps = watchOnboardingSteps();
  const telegramStep = steps.find((s) => s.title.toLowerCase().includes("telegram"));
  assert.ok(telegramStep);
  const inProgress = telegramStep!.callouts.find((c) => c.kind === "in-progress");
  assert.ok(inProgress, "expected an honest in-progress callout on the Telegram-connect step");
  assert.ok(!inProgress!.text.toLowerCase().includes("panel"), "the honest limitation must not be explained via Panel language");
});

test("every callout has a non-empty text field", () => {
  const steps = watchOnboardingSteps();
  for (const step of steps) {
    for (const callout of step.callouts) {
      assert.ok(callout.text.trim().length > 0);
    }
  }
});
