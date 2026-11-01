import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOnboardingStage, onboardingChecklist, type OnboardingStateInput } from "./watch-onboarding-state";

const FRESH: OnboardingStateInput = {
  telegramVerified: false, hasEntitlement: false, projectCount: 0, watcherCount: 0, watcherPersonaAssigned: false, activeDeploymentCount: 0,
};

test("REQUIRED (1): a brand-new zero-Panel account with no Telegram identity resolves to connect_telegram first", () => {
  assert.equal(resolveOnboardingStage(FRESH), "connect_telegram");
});

test("REQUIRED (3/5): unverified account never shows try_watch as the stage -- Telegram always wins first, even with entitlement/resources already present", () => {
  // A hypothetical inconsistent state (entitled but somehow unverified) --
  // Telegram identity must still resolve first, no exceptions.
  assert.equal(resolveOnboardingStage({ ...FRESH, hasEntitlement: true, projectCount: 1 }), "connect_telegram");
});

test("REQUIRED (4/5): Telegram verification advances the state to try_watch (Start Free Trial next)", () => {
  assert.equal(resolveOnboardingStage({ ...FRESH, telegramVerified: true }), "try_watch");
});

test("REQUIRED (6/7): trial-consumed and freshly-verified-but-not-yet-entitled both resolve identically to try_watch -- the state machine itself does not distinguish eligible vs expired (that's a CTA-copy decision, made from the real trial status separately, never a second stage)", () => {
  assert.equal(resolveOnboardingStage({ ...FRESH, telegramVerified: true, hasEntitlement: false }), "try_watch");
});

test("REQUIRED (8/9): a paid/entitled account with no Project skips straight to create_project -- never forced through try_watch again", () => {
  assert.equal(resolveOnboardingStage({ ...FRESH, telegramVerified: true, hasEntitlement: true }), "create_project");
});

test("REQUIRED (9): entitled + Project exists but no Watcher -> create_watcher", () => {
  assert.equal(resolveOnboardingStage({ ...FRESH, telegramVerified: true, hasEntitlement: true, projectCount: 1 }), "create_watcher");
});

test("a Watcher exists but its persona was never explicitly assigned -> assign_moderation, never skipped straight to connect_watcher", () => {
  assert.equal(
    resolveOnboardingStage({ ...FRESH, telegramVerified: true, hasEntitlement: true, projectCount: 1, watcherCount: 1 }),
    "assign_moderation"
  );
});

test("REQUIRED (11/12): Watcher exists, persona explicitly assigned, but no active deployment -> connect_watcher (bundles Community connection + deployment, matching the real WatcherConnectModal flow)", () => {
  assert.equal(
    resolveOnboardingStage({ telegramVerified: true, hasEntitlement: true, projectCount: 1, watcherCount: 1, watcherPersonaAssigned: true, activeDeploymentCount: 0 }),
    "connect_watcher"
  );
});

test("REQUIRED (13): a real active deployment transitions to operational -- the normal Overview, not another onboarding stage", () => {
  assert.equal(
    resolveOnboardingStage({ telegramVerified: true, hasEntitlement: true, projectCount: 1, watcherCount: 1, watcherPersonaAssigned: true, activeDeploymentCount: 1 }),
    "operational"
  );
});

/* ------------------------------------------------------------- checklist ---- */

test("REQUIRED: the checklist's done flags exactly match what the resolver itself checked -- can never disagree", () => {
  const input: OnboardingStateInput = { ...FRESH, telegramVerified: true, hasEntitlement: true, projectCount: 1 };
  const checklist = onboardingChecklist(input);
  assert.deepEqual(checklist.map((c) => c.done), [true, true, true, false, false, false]);
  assert.equal(resolveOnboardingStage(input), "create_watcher");
});

test("checklist has exactly 6 items, in dependency order, never including 'operational'", () => {
  const checklist = onboardingChecklist(FRESH);
  assert.deepEqual(checklist.map((c) => c.key), [
    "connect_telegram", "try_watch", "create_project", "create_watcher", "assign_moderation", "connect_watcher",
  ]);
});

test("a fully-complete checklist is all done", () => {
  const checklist = onboardingChecklist({
    telegramVerified: true, hasEntitlement: true, projectCount: 2, watcherCount: 1, watcherPersonaAssigned: true, activeDeploymentCount: 1,
  });
  assert.ok(checklist.every((c) => c.done));
});

test("assign_moderation checklist item is done only once watcherPersonaAssigned is true, independent of every other flag", () => {
  const base = { telegramVerified: true, hasEntitlement: true, projectCount: 1, watcherCount: 1, activeDeploymentCount: 0 };
  const notAssigned = onboardingChecklist({ ...base, watcherPersonaAssigned: false }).find((c) => c.key === "assign_moderation");
  const assigned = onboardingChecklist({ ...base, watcherPersonaAssigned: true }).find((c) => c.key === "assign_moderation");
  assert.equal(notAssigned?.done, false);
  assert.equal(assigned?.done, true);
});
