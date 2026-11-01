import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transitionKindFor, localMinutesOfDay, claimPresenceTransition } from "./presence-runtime";

/**
 * Watcher Presence Scheduling (Phase 4.U) — the exported pure/near-pure
 * pieces of the sweep. `sweepPresenceSchedules` itself is a full DB-mocked
 * orchestrator verified via typecheck + build + code review only,
 * consistent with this codebase's own established convention for
 * comparably complex orchestrators (runAutoPostSweep, handleCommunityUpdate
 * — neither has a full-mock test either); resolveDeploymentTenant/
 * getAccountCapacity, the two functions the sweep leans on for ownership
 * and plan-gating, are already fully covered in watch-runtime.test.ts.
 */

/* ---------------------------------------- online/offline scope lock (Watcher
   Role Separation) -------------------------------------------------------- */

// REQUIRED regression lock: Presence Scheduling's "active"/"away" state (the
// only online/offline-shaped state machine anywhere in this codebase) must
// NEVER be wired into moderation or chatter selection -- it exists solely
// to flavor scheduled arrival/departure ANNOUNCEMENT messages. Watcher Role
// Separation (chatter duty ACTIVE_CHATTER/SPECIALIST_ONLY/DISABLED) is a
// completely separate, additional concept; this test guards against a
// future change accidentally coupling the two by re-checking, structurally,
// that this file never imports any moderation/chatter symbol. A behavioral
// (not just doc-comment) guarantee is impractical to test any other way
// without a full DB/Telegram-mocked orchestrator (this file has none, by
// this codebase's own established convention -- see the header comment) --
// a source-level import check is a real, low-risk, zero-flake way to lock
// in an architectural boundary, not a substitute for one.
test("REQUIRED: presence-runtime.ts never imports or calls moderation/chatter selection -- structurally cannot gate specialist availability", () => {
  const source = readFileSync(join(__dirname, "presence-runtime.ts"), "utf-8");
  // Strip comments first -- the file's own doc comment DELIBERATELY names
  // these functions to document the boundary this test enforces ("has zero
  // effect on core safety/scam/phishing moderation
  // (runLinkModeration/runMediaModeration)..."); mentioning them in prose is
  // the documentation this test locks in, not a violation of it. What must
  // never appear is a real IMPORT or a real CALL.
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["runLinkModeration", "runMediaModeration", "findChatterDeployments", "selectChatterAction", "chatter-coordinator"]) {
    assert.ok(!withoutComments.includes(forbidden), `presence-runtime.ts must never import or call "${forbidden}" outside of documentation comments`);
  }
});

/* -------------------------------------------------------- transitionKindFor ---- */

test("REQUIRED: no state change is a guaranteed no-op (returns null)", () => {
  assert.equal(transitionKindFor("active", "active"), null);
  assert.equal(transitionKindFor("away", "away"), null);
});

test("REQUIRED: a brand-new deployment (no prior row) going active is presence_started, never presence_resumed", () => {
  assert.equal(transitionKindFor(null, "active"), "presence_started");
});

test("REQUIRED: a brand-new deployment (no prior row) computing away is a no-op, never presence_ending", () => {
  // No row yet already represents "away" by convention -- a freshly-enabled
  // deployment that happens to compute "away" right now has never been
  // active, so there's nothing to end. Caught a real bug during
  // implementation (this returned "presence_ending" before the fix).
  assert.equal(transitionKindFor(null, "away"), null);
});

test("REQUIRED: away -> active on an EXISTING row is presence_resumed, not presence_started", () => {
  assert.equal(transitionKindFor("away", "active"), "presence_resumed");
});

test("REQUIRED: active -> away is always presence_ending", () => {
  assert.equal(transitionKindFor("active", "away"), "presence_ending");
});

/* ------------------------------------------------------- localMinutesOfDay ---- */

test("localMinutesOfDay resolves the real local minute-of-day for a known timezone", () => {
  // 2026-08-25T10:30:00Z in Asia/Manila (UTC+8) is 18:30 local -> 1110 minutes.
  const now = new Date("2026-08-25T10:30:00.000Z");
  assert.equal(localMinutesOfDay(now, "Asia/Manila"), 18 * 60 + 30);
});

test("localMinutesOfDay handles UTC directly", () => {
  const now = new Date("2026-08-25T05:15:00.000Z");
  assert.equal(localMinutesOfDay(now, "UTC"), 5 * 60 + 15);
});

test("an invalid/unresolvable timezone returns null rather than throwing", () => {
  const now = new Date("2026-08-25T05:15:00.000Z");
  assert.equal(localMinutesOfDay(now, "Not/A_Real_Zone"), null);
});

/* --------------------------------------------------- claimPresenceTransition ---- */

function fakeStateTable(existing: Record<string, { state: string }>) {
  const store: Record<string, { deployment_id: string; state: string; current_interval_key?: string }> = {};
  for (const [id, v] of Object.entries(existing)) store[id] = { deployment_id: id, state: v.state };
  const admin = {
    from(table: string) {
      if (table !== "deployment_presence_state") throw new Error(`unexpected table: ${table}`);
      let updateFilters: Record<string, unknown> = {};
      let pendingUpdate: Record<string, unknown> | null = null;
      const api = {
        async insert(row: Record<string, unknown>) {
          const id = row.deployment_id as string;
          if (store[id]) return { error: { message: "duplicate key" } }; // real PK conflict
          store[id] = { deployment_id: id, state: row.state as string, current_interval_key: row.current_interval_key as string };
          return { error: null };
        },
        update(patch: Record<string, unknown>) {
          pendingUpdate = patch;
          return api;
        },
        eq(col: string, val: unknown) {
          updateFilters[col] = val;
          return api;
        },
        select() {
          return api;
        },
        async maybeSingle() {
          const id = updateFilters.deployment_id as string;
          const row = store[id];
          if (!row) return { data: null, error: null };
          if (updateFilters.state !== undefined && row.state !== updateFilters.state) return { data: null, error: null };
          if (pendingUpdate) {
            store[id] = { ...row, state: pendingUpdate.state as string, current_interval_key: pendingUpdate.current_interval_key as string };
          }
          updateFilters = {};
          pendingUpdate = null;
          return { data: { deployment_id: id }, error: null };
        },
      };
      return api;
    },
  };
  return { admin, store };
}

test("REQUIRED: a new deployment's first claim (priorState null) inserts and succeeds", async () => {
  const fake = fakeStateTable({});
  const claimed = await claimPresenceTransition(fake.admin as never, "dep-1", null, "active", "2026-08-25T08:00:00.000Z");
  assert.equal(claimed, true);
  assert.equal(fake.store["dep-1"].state, "active");
});

test("REQUIRED: a duplicate/concurrent claim for the SAME already-recorded transition loses the race (insert path)", async () => {
  const fake = fakeStateTable({ "dep-1": { state: "active" } }); // simulates a prior invocation already having inserted
  const claimed = await claimPresenceTransition(fake.admin as never, "dep-1", null, "active", "2026-08-25T08:00:00.000Z");
  assert.equal(claimed, false, "a real PK conflict must lose, not silently double-apply");
});

test("REQUIRED: a valid compare-and-swap (existing row, matching priorState) succeeds", async () => {
  const fake = fakeStateTable({ "dep-1": { state: "away" } });
  const claimed = await claimPresenceTransition(fake.admin as never, "dep-1", "away", "active", "2026-08-25T10:00:00.000Z");
  assert.equal(claimed, true);
  assert.equal(fake.store["dep-1"].state, "active");
});

test("REQUIRED: a stale compare-and-swap (priorState no longer matches, e.g. a concurrent sweep already moved it) loses the race", async () => {
  const fake = fakeStateTable({ "dep-1": { state: "active" } }); // a concurrent sweep already advanced it to 'active'
  const claimed = await claimPresenceTransition(fake.admin as never, "dep-1", "away", "active", "2026-08-25T10:00:00.000Z");
  assert.equal(claimed, false, "the stale reader's own claim must lose once state has already moved on");
  assert.equal(fake.store["dep-1"].state, "active", "state must be untouched by the losing claim");
});

test("two concurrent claims for the SAME real transition: exactly one succeeds", async () => {
  const fake = fakeStateTable({ "dep-1": { state: "away" } });
  const [a, b] = await Promise.all([
    claimPresenceTransition(fake.admin as never, "dep-1", "away", "active", "2026-08-25T10:00:00.000Z"),
    claimPresenceTransition(fake.admin as never, "dep-1", "away", "active", "2026-08-25T10:00:00.000Z"),
  ]);
  // The fake's synchronous store makes this deterministic (no real
  // interleaving), but it still proves the compare-and-swap SHAPE: the
  // second call to reach maybeSingle() always finds state already changed.
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one of two concurrent claims for the same transition must win");
});
