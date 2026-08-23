import { test } from "node:test";
import assert from "node:assert/strict";
import { presenceAt, applyCoverageWindow, computeRecommendedSchedule, DEFAULT_STAGGER_MINUTES, type PresenceConfig } from "./presence-schedule";

/**
 * Watcher Presence Scheduling (Phase 4.U) — the pure scheduling algorithm.
 * Mirrors the spec's own explicit Testing section: N=1..5 deterministic
 * formula, the exact worked example, intervalKey stability/advancement,
 * coverage window, and the before-the-anchor edge case.
 */

test("DEFAULT_STAGGER_MINUTES is the spec's stated default (2 hours)", () => {
  assert.equal(DEFAULT_STAGGER_MINUTES, 120);
});

/* ------------------------------------------------------------ presenceAt ---- */

test("REQUIRED: presenceAt reports present within the active window, away outside it", () => {
  const config: PresenceConfig = { anchorUtc: "2026-08-25T08:00:00.000Z", activeMinutes: 180, cycleMinutes: 240 };
  assert.equal(presenceAt(config, new Date("2026-08-25T08:00:00.000Z")).present, true); // exactly at anchor
  assert.equal(presenceAt(config, new Date("2026-08-25T10:59:00.000Z")).present, true); // just before window ends
  assert.equal(presenceAt(config, new Date("2026-08-25T11:00:00.000Z")).present, false); // exactly at window end
  assert.equal(presenceAt(config, new Date("2026-08-25T11:30:00.000Z")).present, false); // in the away gap
  assert.equal(presenceAt(config, new Date("2026-08-25T12:00:00.000Z")).present, true); // next cycle starts
});

test("REQUIRED: intervalKey is stable within one interval and advances exactly once crossing into the next", () => {
  const config: PresenceConfig = { anchorUtc: "2026-08-25T08:00:00.000Z", activeMinutes: 180, cycleMinutes: 240 };
  const a = presenceAt(config, new Date("2026-08-25T08:05:00.000Z"));
  const b = presenceAt(config, new Date("2026-08-25T09:59:00.000Z"));
  const c = presenceAt(config, new Date("2026-08-25T11:59:00.000Z")); // still within the SAME 4h cycle (away phase)
  const d = presenceAt(config, new Date("2026-08-25T12:00:01.000Z")); // next cycle
  assert.equal(a.intervalKey, "2026-08-25T08:00:00.000Z");
  assert.equal(b.intervalKey, a.intervalKey, "polling repeatedly within the same interval must never change the key");
  assert.equal(c.intervalKey, a.intervalKey, "the away phase of the SAME cycle shares the cycle's interval key");
  assert.equal(d.intervalKey, "2026-08-25T12:00:00.000Z");
  assert.notEqual(d.intervalKey, a.intervalKey);
});

test("`now` before the anchor is handled safely (no negative-phase bug)", () => {
  const config: PresenceConfig = { anchorUtc: "2026-08-25T08:00:00.000Z", activeMinutes: 60, cycleMinutes: 120 };
  // 30 minutes BEFORE the anchor -- this is really the tail end of the
  // PRIOR cycle's away phase (a cycle ending at 08:00, having gone away at 07:00).
  const result = presenceAt(config, new Date("2026-08-25T07:30:00.000Z"));
  assert.equal(result.present, false);
  assert.equal(result.intervalKey, "2026-08-25T06:00:00.000Z", "resolves to the prior cycle's own start instant, not garbage");
});

test("REQUIRED: N=1 naturally resolves to always-present (activeMinutes clamped to cycleMinutes)", () => {
  // computeRecommendedSchedule would produce activeMinutes=180 (1.5x stagger)
  // clamped by presenceAt's own min() against a 120min cycle -- verify the
  // clamp directly here too, since it's the actual safety net.
  const config: PresenceConfig = { anchorUtc: "2026-08-25T08:00:00.000Z", activeMinutes: 180, cycleMinutes: 120 };
  for (const offset of [0, 30, 59, 119, 121, 500, -50]) {
    const now = new Date(new Date(config.anchorUtc).getTime() + offset * 60_000);
    assert.equal(presenceAt(config, now).present, true, `offset ${offset}min should still be present`);
  }
});

/* --------------------------------------------------------- applyCoverageWindow ---- */

test("applyCoverageWindow is a no-op when no window is configured", () => {
  const result = { present: true, intervalKey: "k" };
  assert.deepEqual(applyCoverageWindow(result, 600, null, null), result);
  assert.deepEqual(applyCoverageWindow(result, null, 480, 1380), result);
});

test("REQUIRED: applyCoverageWindow forces present:false outside the window, preserving intervalKey", () => {
  const present = { present: true, intervalKey: "k" };
  // window 08:00 (480) - 23:00 (1380); "now" at 02:00 (120min) is outside it.
  const forced = applyCoverageWindow(present, 120, 480, 1380);
  assert.equal(forced.present, false);
  assert.equal(forced.intervalKey, "k", "intervalKey is preserved so a caller can still detect the transition");
});

test("applyCoverageWindow leaves present:true untouched when inside the window", () => {
  const present = { present: true, intervalKey: "k" };
  const result = applyCoverageWindow(present, 600, 480, 1380); // 10:00, inside 08:00-23:00
  assert.equal(result.present, true);
});

test("applyCoverageWindow never turns an already-false result true", () => {
  const away = { present: false, intervalKey: "k" };
  assert.equal(applyCoverageWindow(away, 600, 480, 1380).present, false);
});

test("REQUIRED: an overnight coverage window (wraps past midnight) is handled", () => {
  const present = { present: true, intervalKey: "k" };
  // window 20:00 (1200) - 06:00 (360)
  assert.equal(applyCoverageWindow(present, 22 * 60, 1200, 360).present, true, "22:00 is inside an overnight 20:00-06:00 window");
  assert.equal(applyCoverageWindow(present, 3 * 60, 1200, 360).present, true, "03:00 is inside an overnight 20:00-06:00 window");
  assert.equal(applyCoverageWindow(present, 12 * 60, 1200, 360).present, false, "noon is outside an overnight 20:00-06:00 window");
});

/* --------------------------------------------------- computeRecommendedSchedule ---- */

test("REQUIRED (spec's own worked example, N=2, stagger=120): produces exact overlap/rotate-out/resume timing", () => {
  const schedules = computeRecommendedSchedule(
    [{ deploymentId: "kwan", orderIndex: 0 }, { deploymentId: "test", orderIndex: 1 }],
    120,
    "2026-08-25T08:00:00.000Z"
  );
  const kwan = schedules.get("kwan")!;
  const testCfg = schedules.get("test")!;
  assert.equal(kwan.anchorUtc, "2026-08-25T08:00:00.000Z");
  assert.equal(testCfg.anchorUtc, "2026-08-25T10:00:00.000Z", "Test starts exactly 2h after Kwan, per the spec's example");
  assert.equal(kwan.cycleMinutes, 240);
  assert.equal(kwan.activeMinutes, 180);

  // Kwan: active 08:00-11:00, away 11:00-12:00, active again 12:00-15:00.
  assert.equal(presenceAt(kwan, new Date("2026-08-25T09:00:00.000Z")).present, true);
  assert.equal(presenceAt(kwan, new Date("2026-08-25T11:30:00.000Z")).present, false, "Kwan rotates out at 11:00");
  assert.equal(presenceAt(kwan, new Date("2026-08-25T12:30:00.000Z")).present, true, "Kwan resumes at 12:00");

  // Test: active 10:00-13:00.
  assert.equal(presenceAt(testCfg, new Date("2026-08-25T09:30:00.000Z")).present, false, "Test hasn't started yet");
  assert.equal(presenceAt(testCfg, new Date("2026-08-25T10:30:00.000Z")).present, true);

  // Genuine overlap: 10:00-11:00 both present.
  const overlapMoment = new Date("2026-08-25T10:30:00.000Z");
  assert.equal(presenceAt(kwan, overlapMoment).present, true);
  assert.equal(presenceAt(testCfg, overlapMoment).present, true);

  // Second overlap: 12:00-13:00, both present again (Kwan resumed, Test still up).
  const secondOverlap = new Date("2026-08-25T12:30:00.000Z");
  assert.equal(presenceAt(kwan, secondOverlap).present, true);
  assert.equal(presenceAt(testCfg, secondOverlap).present, true);
});

test("REQUIRED: N=1 through N=5 all produce a valid, deterministic schedule (spec's own tested range)", () => {
  for (let n = 1; n <= 5; n++) {
    const deployments = Array.from({ length: n }, (_, i) => ({ deploymentId: `dep-${i}`, orderIndex: i }));
    const schedules = computeRecommendedSchedule(deployments, 120, "2026-08-25T00:00:00.000Z");
    assert.equal(schedules.size, n);
    for (const [, cfg] of schedules) {
      assert.equal(cfg.cycleMinutes, 120 * n);
      assert.ok(cfg.activeMinutes > 0);
      assert.ok(cfg.activeMinutes <= cfg.cycleMinutes);
    }
  }
});

test("computeRecommendedSchedule is deterministic -- calling it twice with the same input produces byte-identical output", () => {
  const deployments = [{ deploymentId: "a", orderIndex: 0 }, { deploymentId: "b", orderIndex: 1 }, { deploymentId: "c", orderIndex: 2 }];
  const first = computeRecommendedSchedule(deployments, 120, "2026-08-25T00:00:00.000Z");
  const second = computeRecommendedSchedule(deployments, 120, "2026-08-25T00:00:00.000Z");
  assert.deepEqual([...first.entries()], [...second.entries()]);
});

test("REQUIRED: N=1's formula-derived config resolves to always-present via computeRecommendedSchedule end-to-end", () => {
  const schedules = computeRecommendedSchedule([{ deploymentId: "solo", orderIndex: 0 }], 120, "2026-08-25T00:00:00.000Z");
  const cfg = schedules.get("solo")!;
  assert.equal(cfg.activeMinutes, cfg.cycleMinutes, "clamped to the full cycle -- always present");
  for (const offset of [0, 60, 119, 1000]) {
    assert.equal(presenceAt(cfg, new Date(new Date(cfg.anchorUtc).getTime() + offset * 60_000)).present, true);
  }
});

test("computeRecommendedSchedule never mutates its input array/objects", () => {
  const deployments = [{ deploymentId: "a", orderIndex: 0 }];
  const snapshot = JSON.stringify(deployments);
  computeRecommendedSchedule(deployments, 120, "2026-08-25T00:00:00.000Z");
  assert.equal(JSON.stringify(deployments), snapshot);
});

test("an empty deployment list never throws (defensive floor at N=1 internally, but produces zero schedules)", () => {
  const schedules = computeRecommendedSchedule([], 120, "2026-08-25T00:00:00.000Z");
  assert.equal(schedules.size, 0);
});
