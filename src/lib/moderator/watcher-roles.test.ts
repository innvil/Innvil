import { test } from "node:test";
import assert from "node:assert/strict";
import {
  domainsForIndex,
  roleLabelFor,
  chatterWindowIndex,
  chatterPairIndices,
  assignWatcherRoles,
  deploymentForDomain,
  activeChatterDeploymentIds,
  resolveModerationEnforcer,
  reconcileAmbientPick,
  CHATTER_ROTATION_WINDOW_SECONDS,
  MAX_ACTIVE_CHATTERS,
  type RoleableDeployment,
  type WatcherRoleAssignment,
} from "./watcher-roles";

function dep(id: string, createdAt: string, enabled = true): RoleableDeployment {
  return { deploymentId: id, createdAt, enabled };
}

/* -------------------------------------------------- domain tables (1-5) --- */

test("REQUIRED: count 1 -- single Watcher holds every domain", () => {
  assert.deepEqual(domainsForIndex(0, 1), ["host", "knowledge", "spam_scam", "media_safety", "rules_conduct"]);
});

test("REQUIRED: count 2 -- exact spec split", () => {
  assert.deepEqual(domainsForIndex(0, 2), ["host", "knowledge", "spam_scam"]);
  assert.deepEqual(domainsForIndex(1, 2), ["host", "media_safety", "rules_conduct"]);
});

test("REQUIRED: count 3 -- exact spec split", () => {
  assert.deepEqual(domainsForIndex(0, 3), ["host", "knowledge"]);
  assert.deepEqual(domainsForIndex(1, 3), ["spam_scam"]);
  assert.deepEqual(domainsForIndex(2, 3), ["media_safety", "rules_conduct"]);
});

test("REQUIRED: count 4 -- exact spec split", () => {
  assert.deepEqual(domainsForIndex(0, 4), ["host", "knowledge"]);
  assert.deepEqual(domainsForIndex(1, 4), ["spam_scam"]);
  assert.deepEqual(domainsForIndex(2, 4), ["media_safety"]);
  assert.deepEqual(domainsForIndex(3, 4), ["rules_conduct"]);
});

test("REQUIRED: count 5 -- one domain each, exact spec order", () => {
  assert.deepEqual(domainsForIndex(0, 5), ["host"]);
  assert.deepEqual(domainsForIndex(1, 5), ["knowledge"]);
  assert.deepEqual(domainsForIndex(2, 5), ["spam_scam"]);
  assert.deepEqual(domainsForIndex(3, 5), ["media_safety"]);
  assert.deepEqual(domainsForIndex(4, 5), ["rules_conduct"]);
});

test("count 0 / out-of-range index returns no domains, never throws", () => {
  assert.deepEqual(domainsForIndex(0, 0), []);
  assert.deepEqual(domainsForIndex(-1, 3), []);
  assert.deepEqual(domainsForIndex(5, 3), []);
});

test("count > 5 defensively cycles rather than leaving a domain unassigned", () => {
  assert.deepEqual(domainsForIndex(5, 6), ["host"]);
});

test("roleLabelFor joins combined domains with the exact spec-style label text; empty = Disabled", () => {
  assert.equal(roleLabelFor(["host", "knowledge"]), "Community Host + Knowledge Moderator");
  assert.equal(roleLabelFor(["spam_scam"]), "Spam & Scam Moderator");
  assert.equal(roleLabelFor(["media_safety", "rules_conduct"]), "Media Safety Moderator + Rules & Conduct Moderator");
  assert.equal(roleLabelFor([]), "Disabled");
});

/* -------------------------------------------------------- chatter rotation - */

test("REQUIRED: count 1 -- the only Watcher is always the chatter, every window", () => {
  for (let w = 0; w < 10; w++) assert.deepEqual(chatterPairIndices(1, w), [0]);
});

test("REQUIRED: count 2 -- both are always chatter-capable, every window", () => {
  for (let w = 0; w < 10; w++) assert.deepEqual(chatterPairIndices(2, w), [0, 1]);
});

test("REQUIRED: count 3 -- rotates W1+W2, W2+W3, W3+W1, then repeats", () => {
  assert.deepEqual(chatterPairIndices(3, 0), [0, 1]);
  assert.deepEqual(chatterPairIndices(3, 1), [1, 2]);
  assert.deepEqual(chatterPairIndices(3, 2), [2, 0]);
  assert.deepEqual(chatterPairIndices(3, 3), [0, 1]); // repeats
});

test("REQUIRED: count 4 -- rotates W1+W2, W2+W3, W3+W4, W4+W1, then repeats", () => {
  assert.deepEqual(chatterPairIndices(4, 0), [0, 1]);
  assert.deepEqual(chatterPairIndices(4, 1), [1, 2]);
  assert.deepEqual(chatterPairIndices(4, 2), [2, 3]);
  assert.deepEqual(chatterPairIndices(4, 3), [3, 0]);
  assert.deepEqual(chatterPairIndices(4, 4), [0, 1]); // repeats
});

test("REQUIRED: count 5 -- exact worked table from the spec (W1+W2 .. W5+W1, then repeats)", () => {
  assert.deepEqual(chatterPairIndices(5, 0), [0, 1]);
  assert.deepEqual(chatterPairIndices(5, 1), [1, 2]);
  assert.deepEqual(chatterPairIndices(5, 2), [2, 3]);
  assert.deepEqual(chatterPairIndices(5, 3), [3, 4]);
  assert.deepEqual(chatterPairIndices(5, 4), [4, 0]);
  assert.deepEqual(chatterPairIndices(5, 5), [0, 1]); // repeats
});

test("REQUIRED: one chatter always carries over between adjacent windows (continuity), never both replaced at once", () => {
  for (const count of [3, 4, 5]) {
    for (let w = 0; w < count; w++) {
      const cur = new Set(chatterPairIndices(count, w));
      const next = new Set(chatterPairIndices(count, w + 1));
      const overlap = [...cur].filter((i) => next.has(i));
      assert.equal(overlap.length, 1, `count=${count} window=${w}->${w + 1} should overlap by exactly 1`);
    }
  }
});

test("REQUIRED: MAX_ACTIVE_CHATTERS is never exceeded for any count, any window", () => {
  assert.equal(MAX_ACTIVE_CHATTERS, 2);
  for (let count = 0; count <= 8; count++) {
    for (let w = 0; w < 12; w++) {
      assert.ok(chatterPairIndices(count, w).length <= MAX_ACTIVE_CHATTERS);
    }
  }
});

test("chatterWindowIndex is a pure, restart-safe function of wall-clock time (3-hour buckets)", () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  assert.equal(chatterWindowIndex(base), chatterWindowIndex(base + 1000)); // same window a second later
  assert.equal(chatterWindowIndex(base + CHATTER_ROTATION_WINDOW_SECONDS * 1000), chatterWindowIndex(base) + 1); // next window exactly 3h later
});

test("negative windowIndex never crashes chatterPairIndices (defensive modulo)", () => {
  assert.deepEqual(chatterPairIndices(3, -1), chatterPairIndices(3, 2));
});

/* ------------------------------------------------------- assignWatcherRoles - */

test("REQUIRED: assignWatcherRoles is stable under reordering the SAME input set -- no restart reshuffle", () => {
  const deployments = [dep("a", "2026-01-01T00:00:00Z"), dep("b", "2026-01-01T00:00:01Z"), dep("c", "2026-01-01T00:00:02Z")];
  const now = new Date("2026-01-01T05:00:00Z");
  const first = assignWatcherRoles(deployments, { now });
  const shuffled = [deployments[2], deployments[0], deployments[1]];
  const second = assignWatcherRoles(shuffled, { now });
  const byId = (list: WatcherRoleAssignment[]) => new Map(list.map((r) => [r.deploymentId, r]));
  const m1 = byId(first);
  const m2 = byId(second);
  for (const id of ["a", "b", "c"]) {
    assert.deepEqual(m1.get(id)?.domains, m2.get(id)?.domains, `domains for ${id} must match regardless of array order`);
    assert.equal(m1.get(id)?.chatterDuty, m2.get(id)?.chatterDuty);
  }
});

test("assignWatcherRoles orders strictly by createdAt ascending -- earliest deployment is always index 0", () => {
  const deployments = [dep("late", "2026-01-02T00:00:00Z"), dep("early", "2026-01-01T00:00:00Z")];
  const now = new Date("2026-01-05T00:00:00Z");
  const result = assignWatcherRoles(deployments, { now });
  const early = result.find((r) => r.deploymentId === "early")!;
  assert.deepEqual(early.domains, ["host", "knowledge", "spam_scam"]); // index 0 of count-2 table
});

test("a disabled deployment is DISABLED, holds no domains, and never counts toward chatter rotation math", () => {
  const now = new Date("2026-01-01T05:00:00Z");
  const deployments = [dep("a", "2026-01-01T00:00:00Z"), dep("b", "2026-01-01T00:00:01Z", false), dep("c", "2026-01-01T00:00:02Z")];
  const result = assignWatcherRoles(deployments, { now });
  const disabled = result.find((r) => r.deploymentId === "b")!;
  assert.deepEqual(disabled.domains, []);
  assert.equal(disabled.chatterDuty, "DISABLED");
  assert.equal(disabled.roleLabel, "Disabled");
  // only "a" and "c" are active -- must resolve as a real count-2 split, not count-3
  const a = result.find((r) => r.deploymentId === "a")!;
  const c = result.find((r) => r.deploymentId === "c")!;
  assert.deepEqual(a.domains, ["host", "knowledge", "spam_scam"]);
  assert.deepEqual(c.domains, ["host", "media_safety", "rules_conduct"]);
});

test("REQUIRED: a wasLastSpeaker/recentlyParticipated deployment stays ACTIVE_CHATTER for continuity, even outside its rotation window", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  // 5 deployments -- pick an index NOT in the real rotation pair for this
  // timestamp (computed, never assumed, since window index depends on real
  // elapsed time since the epoch, not just the date looking "round").
  const deployments = ["a", "b", "c", "d", "e"].map((id, i) => dep(id, `2026-01-01T00:00:0${i}Z`));
  const windowIndex = chatterWindowIndex(now.getTime());
  const rotationPair = chatterPairIndices(5, windowIndex);
  const nonRotationIndex = [0, 1, 2, 3, 4].find((i) => !rotationPair.includes(i))!;
  const nonRotationId = deployments[nonRotationIndex].deploymentId;

  const withoutContinuity = assignWatcherRoles(deployments, { now });
  assert.equal(withoutContinuity.find((r) => r.deploymentId === nonRotationId)!.chatterDuty, "SPECIALIST_ONLY");

  const withContinuity = assignWatcherRoles(deployments, { now, continuityDeploymentIds: new Set([nonRotationId]) });
  assert.equal(withContinuity.find((r) => r.deploymentId === nonRotationId)!.chatterDuty, "ACTIVE_CHATTER");
  // continuity never demotes the real rotation pair
  for (const idx of rotationPair) {
    assert.equal(withContinuity.find((r) => r.deploymentId === deployments[idx].deploymentId)!.chatterDuty, "ACTIVE_CHATTER");
  }
});

test("deploymentForDomain resolves the exact deployment holding a domain, or null if somehow none does", () => {
  const assignments: WatcherRoleAssignment[] = [
    { deploymentId: "x", domains: ["host", "knowledge"], roleLabel: "", chatterDuty: "ACTIVE_CHATTER" },
    { deploymentId: "y", domains: ["spam_scam"], roleLabel: "", chatterDuty: "SPECIALIST_ONLY" },
  ];
  assert.equal(deploymentForDomain(assignments, "knowledge"), "x");
  assert.equal(deploymentForDomain(assignments, "spam_scam"), "y");
  assert.equal(deploymentForDomain(assignments, "media_safety"), null);
});

test("activeChatterDeploymentIds returns exactly the ACTIVE_CHATTER set", () => {
  const assignments: WatcherRoleAssignment[] = [
    { deploymentId: "x", domains: [], roleLabel: "", chatterDuty: "ACTIVE_CHATTER" },
    { deploymentId: "y", domains: [], roleLabel: "", chatterDuty: "SPECIALIST_ONLY" },
    { deploymentId: "z", domains: [], roleLabel: "", chatterDuty: "DISABLED" },
  ];
  assert.deepEqual(activeChatterDeploymentIds(assignments), ["x"]);
});

/* ---------------------------------------------- resolveModerationEnforcer -- */

function moderationDeployment(id: string, createdAt: string) {
  return { deploymentId: id, createdAt };
}

test("REQUIRED (TEST 2 shape): Spam & Scam Moderator owns link/phishing moderation across every Watcher count", () => {
  for (let count = 1; count <= 5; count++) {
    const now = new Date("2026-01-01T05:00:00Z");
    const roleable = Array.from({ length: count }, (_, i) => dep(`w${i}`, `2026-01-01T00:00:0${i}Z`));
    const deployments = roleable.map((r) => moderationDeployment(r.deploymentId, r.createdAt));
    const assignments = assignWatcherRoles(roleable, { now });
    const enforcer = resolveModerationEnforcer(deployments, assignments, "spam_scam");
    const expectedId = deploymentForDomain(assignments, "spam_scam");
    assert.equal(enforcer.deploymentId, expectedId, `count=${count}`);
  }
});

test("REQUIRED (TEST 3 shape): Media Safety Moderator owns media moderation across every Watcher count", () => {
  for (let count = 1; count <= 5; count++) {
    const now = new Date("2026-01-01T05:00:00Z");
    const roleable = Array.from({ length: count }, (_, i) => dep(`w${i}`, `2026-01-01T00:00:0${i}Z`));
    const deployments = roleable.map((r) => moderationDeployment(r.deploymentId, r.createdAt));
    const assignments = assignWatcherRoles(roleable, { now });
    const enforcer = resolveModerationEnforcer(deployments, assignments, "media_safety");
    const expectedId = deploymentForDomain(assignments, "media_safety");
    assert.equal(enforcer.deploymentId, expectedId, `count=${count}`);
  }
});

test("REQUIRED: at 4-5 Watcher counts, the spam_scam and media_safety enforcers are DISTINCT deployments (a real specialist split, not the same bot doing everything)", () => {
  for (const count of [4, 5]) {
    const now = new Date("2026-01-01T05:00:00Z");
    const roleable = Array.from({ length: count }, (_, i) => dep(`w${i}`, `2026-01-01T00:00:0${i}Z`));
    const deployments = roleable.map((r) => moderationDeployment(r.deploymentId, r.createdAt));
    const assignments = assignWatcherRoles(roleable, { now });
    const spamEnforcer = resolveModerationEnforcer(deployments, assignments, "spam_scam");
    const mediaEnforcer = resolveModerationEnforcer(deployments, assignments, "media_safety");
    assert.notEqual(spamEnforcer.deploymentId, mediaEnforcer.deploymentId, `count=${count}`);
  }
});

test("resolveModerationEnforcer never depends on chatter duty -- moderation runs the same regardless of who currently holds chatter duty", () => {
  const roleable = [dep("a", "2026-01-01T00:00:00Z"), dep("b", "2026-01-01T00:00:01Z"), dep("c", "2026-01-01T00:00:02Z")];
  const deployments = roleable.map((r) => moderationDeployment(r.deploymentId, r.createdAt));
  const withoutContinuity = assignWatcherRoles(roleable, { now: new Date("2026-01-01T05:00:00Z") });
  const withContinuity = assignWatcherRoles(roleable, { now: new Date("2026-01-01T05:00:00Z"), continuityDeploymentIds: new Set(["c"]) });
  assert.equal(
    resolveModerationEnforcer(deployments, withoutContinuity, "spam_scam").deploymentId,
    resolveModerationEnforcer(deployments, withContinuity, "spam_scam").deploymentId
  );
});

test("resolveModerationEnforcer defensively falls back to deployments[0] if role resolution comes back with no holder for the domain", () => {
  const deployments = [moderationDeployment("only", "2026-01-01T00:00:00Z")];
  assert.equal(resolveModerationEnforcer(deployments, [], "spam_scam").deploymentId, "only");
});

/* --------------------------------------------------- reconcileAmbientPick -- */

function candidate(id: string, opts: Partial<{ isDirectedAtBot: boolean; wasLastSpeaker: boolean; recentlyParticipated: boolean; lastSpokeAt: string | null }> = {}) {
  return {
    deploymentId: id,
    isDirectedAtBot: opts.isDirectedAtBot ?? false,
    wasLastSpeaker: opts.wasLastSpeaker ?? false,
    recentlyParticipated: opts.recentlyParticipated ?? false,
    pacing: { lastSpokeAt: opts.lastSpokeAt ?? null },
  };
}

function assignment(id: string, chatterDuty: ChatterDutyStateForTest, domains: import("./watcher-roles").ResponsibilityDomain[] = []): WatcherRoleAssignment {
  return { deploymentId: id, domains, roleLabel: "", chatterDuty };
}
type ChatterDutyStateForTest = "ACTIVE_CHATTER" | "SPECIALIST_ONLY" | "DISABLED";

test("REQUIRED (TEST 1 shape): a SPECIALIST_ONLY, non-continuity quietest-longest pick for CASUAL_CHAT is reassigned to the active chatter pool", () => {
  const candidates = [candidate("host-specialist"), candidate("chatter-a"), candidate("chatter-b")];
  const assignments = [
    assignment("host-specialist", "SPECIALIST_ONLY"),
    assignment("chatter-a", "ACTIVE_CHATTER"),
    assignment("chatter-b", "ACTIVE_CHATTER"),
  ];
  const action = { type: "CASUAL_CHAT" as const, deploymentId: "host-specialist", reasons: [] };
  const result = reconcileAmbientPick(action, candidates, assignments);
  assert.notEqual(result.deploymentId, "host-specialist");
  assert.ok(["chatter-a", "chatter-b"].includes(result.deploymentId!));
});

test("a directed (isDirectedAtBot) pick is NEVER reassigned, even if SPECIALIST_ONLY", () => {
  const candidates = [candidate("specialist", { isDirectedAtBot: true }), candidate("chatter-a")];
  const assignments = [assignment("specialist", "SPECIALIST_ONLY"), assignment("chatter-a", "ACTIVE_CHATTER")];
  const action = { type: "CASUAL_CHAT" as const, deploymentId: "specialist", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "specialist");
});

test("a wasLastSpeaker/continuity pick is never reassigned even if SPECIALIST_ONLY by rotation", () => {
  const candidates = [candidate("specialist", { wasLastSpeaker: true }), candidate("chatter-a")];
  const assignments = [assignment("specialist", "SPECIALIST_ONLY"), assignment("chatter-a", "ACTIVE_CHATTER")];
  const action = { type: "SHORT_ACK" as const, deploymentId: "specialist", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "specialist");
});

test("an already-ACTIVE_CHATTER pick for CASUAL_CHAT/SHORT_ACK is left completely unchanged", () => {
  const candidates = [candidate("chatter-a")];
  const assignments = [assignment("chatter-a", "ACTIVE_CHATTER")];
  const action = { type: "CASUAL_CHAT" as const, deploymentId: "chatter-a", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "chatter-a");
});

test("REQUIRED (TEST 5 shape): an undirected ANSWER is reassigned to the Knowledge-role deployment when a distinct one exists", () => {
  const candidates = [candidate("host"), candidate("knowledge-holder")];
  const assignments = [assignment("host", "ACTIVE_CHATTER", ["host"]), assignment("knowledge-holder", "SPECIALIST_ONLY", ["knowledge"])];
  const action = { type: "ANSWER" as const, deploymentId: "host", reasons: [] };
  const result = reconcileAmbientPick(action, candidates, assignments);
  assert.equal(result.deploymentId, "knowledge-holder");
});

test("a directed ANSWER is never reassigned to Knowledge, even if a different Knowledge holder exists", () => {
  const candidates = [candidate("enforcement-holder", { isDirectedAtBot: true }), candidate("knowledge-holder")];
  const assignments = [assignment("enforcement-holder", "SPECIALIST_ONLY", ["rules_conduct"]), assignment("knowledge-holder", "SPECIALIST_ONLY", ["knowledge"])];
  const action = { type: "ANSWER" as const, deploymentId: "enforcement-holder", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "enforcement-holder");
});

test("an ANSWER already picking the Knowledge holder is left unchanged", () => {
  const candidates = [candidate("knowledge-holder")];
  const assignments = [assignment("knowledge-holder", "SPECIALIST_ONLY", ["knowledge"])];
  const action = { type: "ANSWER" as const, deploymentId: "knowledge-holder", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "knowledge-holder");
});

test("ANSWER with no distinct Knowledge holder (e.g. count 1, or already the picked one) is left unchanged", () => {
  const candidates = [candidate("solo")];
  const assignments = [assignment("solo", "ACTIVE_CHATTER", ["host", "knowledge", "spam_scam", "media_safety", "rules_conduct"])];
  const action = { type: "ANSWER" as const, deploymentId: "solo", reasons: [] };
  assert.equal(reconcileAmbientPick(action, candidates, assignments).deploymentId, "solo");
});

test("REQUIRED: REACT and SILENCE always pass through completely unchanged", () => {
  const candidates = [candidate("a")];
  const assignments = [assignment("a", "SPECIALIST_ONLY")];
  const react = { type: "REACT" as const, deploymentId: "a", emoji: "👍", reasons: [] };
  assert.deepEqual(reconcileAmbientPick(react, candidates, assignments), react);
  const silence = { type: "SILENCE" as const, reasons: ["empty_message"] };
  assert.deepEqual(reconcileAmbientPick(silence, candidates, assignments), silence);
});

test("reconcileAmbientPick never throws when the picked deploymentId is missing from candidates (defensive)", () => {
  const action = { type: "ANSWER" as const, deploymentId: "ghost", reasons: [] };
  assert.deepEqual(reconcileAmbientPick(action, [], []), action);
});
