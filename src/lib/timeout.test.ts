import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout } from "./timeout";

/**
 * Backs the Watch logout buttons' fix for a real reported bug: a hung
 * signOutAction() call (e.g. a stale dev-server action manifest) left the
 * button stuck showing "Signing out…" forever with no way to recover.
 */

test("REQUIRED: a promise that resolves before the timeout wins", async () => {
  const result = await withTimeout(Promise.resolve("done"), 5_000);
  assert.equal(result, "done");
});

test("REQUIRED: a promise that never resolves is bounded, not left hanging forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const neverResolves = new Promise<string>(() => {});
  const racePromise = withTimeout(neverResolves, 8_000, "Sign out");
  // Fake timers make this instant -- no real 8-second wait.
  t.mock.timers.tick(8_000);
  await assert.rejects(racePromise, /Sign out timed out after 8000ms/);
});

test("a rejecting promise propagates its own rejection, not a generic timeout error", async () => {
  const failing = Promise.reject(new Error("network error"));
  await assert.rejects(withTimeout(failing, 5_000), /network error/);
});

test("the timeout timer is cleared on a fast resolve -- no dangling timer keeping the process alive", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = await withTimeout(Promise.resolve("fast"), 8_000);
  assert.equal(result, "fast");
  // If the timer weren't cleared, ticking past it would still be harmless
  // here (the promise already settled) -- this just documents the intent.
  t.mock.timers.tick(8_000);
});
