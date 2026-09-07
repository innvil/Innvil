import { test } from "node:test";
import assert from "node:assert/strict";
import { communityOperationalStatus, watcherOperationalStatus, deploymentSummaries } from "./watch-status";

/* --------------------------------------------------------- communityOperationalStatus ---- */

test("communityOperationalStatus: no Watchers deployed -> needs_attention", () => {
  assert.equal(communityOperationalStatus({ watchers: [] }), "needs_attention");
});

test("communityOperationalStatus: at least one enabled deployment -> healthy", () => {
  assert.equal(communityOperationalStatus({ watchers: [{ enabled: false }, { enabled: true }] }), "healthy");
});

test("communityOperationalStatus: deployed but every deployment disabled -> paused", () => {
  assert.equal(communityOperationalStatus({ watchers: [{ enabled: false }, { enabled: false }] }), "paused");
});

/* --------------------------------------------------------- watcherOperationalStatus ---- */
/* Backs the Watcher navigator's compact per-row status (WatcherNavigator.tsx)
   and its filter chips -- must agree with the same real deployment data the
   rest of the Watch dashboard already reads. */

test("REQUIRED: a Watcher with no deployments at all is unassigned", () => {
  assert.equal(watcherOperationalStatus("w1", []), "unassigned");
  assert.equal(watcherOperationalStatus("w1", [{ watcherId: "w2", enabled: true }]), "unassigned");
});

test("REQUIRED: a Watcher with at least one enabled deployment is active", () => {
  const deployments = [{ watcherId: "w1", enabled: false }, { watcherId: "w1", enabled: true }];
  assert.equal(watcherOperationalStatus("w1", deployments), "active");
});

test("REQUIRED: a Watcher deployed but every deployment disabled is paused", () => {
  const deployments = [{ watcherId: "w1", enabled: false }, { watcherId: "w1", enabled: false }];
  assert.equal(watcherOperationalStatus("w1", deployments), "paused");
});

test("watcherOperationalStatus never cross-contaminates between two different Watchers' deployments", () => {
  const deployments = [{ watcherId: "w1", enabled: false }, { watcherId: "w2", enabled: true }];
  assert.equal(watcherOperationalStatus("w1", deployments), "paused");
  assert.equal(watcherOperationalStatus("w2", deployments), "active");
});

/* --------------------------------------------------------- deploymentSummaries ---- */

test("REQUIRED: deploymentSummaries flattens per-Community watcher lists into one deployment-per-row list", () => {
  const communities = [
    { id: "c1", title: "Alpha", watchers: [{ watcherId: "w1", enabled: true }, { watcherId: "w2", enabled: false }] },
    { id: "c2", title: "Beta", watchers: [{ watcherId: "w1", enabled: true }] },
  ];
  const rows = deploymentSummaries(communities);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.filter((r) => r.watcherId === "w1").map((r) => r.communityTitle).sort(), ["Alpha", "Beta"]);
});

test("deploymentSummaries falls back to chatId when a Community has no title", () => {
  const communities = [{ id: "c1", chatId: "-100123", watchers: [{ watcherId: "w1", enabled: true }] }];
  const rows = deploymentSummaries(communities);
  assert.equal(rows[0].communityTitle, "-100123");
});

test("deploymentSummaries returns an empty list for an account with no Communities", () => {
  assert.deepEqual(deploymentSummaries([]), []);
});

test("watcherOperationalStatus composes correctly with deploymentSummaries -- the exact real data shape the navigator consumes end to end", () => {
  const communities = [
    { id: "c1", title: "Alpha", watchers: [{ watcherId: "w1", enabled: true }] },
    { id: "c2", title: "Beta", watchers: [{ watcherId: "w2", enabled: false }] },
  ];
  const rows = deploymentSummaries(communities);
  assert.equal(watcherOperationalStatus("w1", rows), "active");
  assert.equal(watcherOperationalStatus("w2", rows), "paused");
  assert.equal(watcherOperationalStatus("w3", rows), "unassigned");
});
