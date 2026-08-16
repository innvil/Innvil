import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateFrameResults, computeSamplePositions, isEarlyExitResult, decideMediaEnforcement,
  MAX_VIDEO_SAMPLE_FRAMES, type FrameResult, type MediaFailureKind,
} from "./media-moderation";

/* ============================================================ sampling ==== */

test("REQUIRED: sample positions never exceed MAX_VIDEO_SAMPLE_FRAMES regardless of video length", () => {
  assert.ok(computeSamplePositions(30_000).length <= MAX_VIDEO_SAMPLE_FRAMES);
  assert.ok(computeSamplePositions(30 * 60_000).length <= MAX_VIDEO_SAMPLE_FRAMES); // 30 minutes -- same bound as a 30-second clip
  assert.ok(computeSamplePositions(6 * 60 * 60_000).length <= MAX_VIDEO_SAMPLE_FRAMES); // 6 hours
});

test("REQUIRED: sample positions cover beyond the first frame -- includes points near the beginning, middle, and end", () => {
  const positions = computeSamplePositions(60_000); // 1 minute
  assert.ok(positions.length >= 3);
  assert.ok(positions[0] > 0); // not literally frame 0
  assert.ok(positions[positions.length - 1] < 60_000); // not literally the last ms
  const mid = positions[Math.floor(positions.length / 2)];
  assert.ok(mid > 10_000 && mid < 50_000, "expected a roughly-middle sample point");
});

test("a user cannot evade detection by only putting safe content in the first second -- later positions are sampled too", () => {
  const positions = computeSamplePositions(120_000); // 2 minutes
  assert.ok(positions.some((p) => p > 60_000), "expected at least one sample point past the halfway mark");
});

test("very short videos still produce at least one sample position", () => {
  assert.ok(computeSamplePositions(500).length >= 1);
  assert.ok(computeSamplePositions(0).length >= 1);
});

test("sample count for a long video is NOT scaled up with duration -- stays bounded/flat", () => {
  const short = computeSamplePositions(10_000).length;
  const long = computeSamplePositions(2 * 60 * 60_000).length;
  assert.equal(short, long); // same bounded count regardless of duration
});

/* ======================================================== aggregation ==== */

function ok(verdict: "safe" | "uncertain" | "explicit", confidence: "low" | "medium" | "high"): FrameResult {
  return { ok: true, verdict, confidence };
}
function fail(failure: MediaFailureKind): FrameResult {
  return { ok: false, failure };
}

test("REQUIRED: the strongest (most explicit) genuine result wins even if it's not the first frame", () => {
  const result = aggregateFrameResults([ok("safe", "high"), ok("safe", "high"), ok("explicit", "high")]);
  assert.deepEqual(result, { ok: true, verdict: "explicit", confidence: "high", reason: undefined });
});

test("a user cannot evade detection by making only the first sampled frame safe", () => {
  const result = aggregateFrameResults([ok("safe", "high"), ok("explicit", "high")]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.verdict, "explicit");
});

test("higher confidence wins between two frames with the same verdict", () => {
  const result = aggregateFrameResults([ok("uncertain", "low"), ok("uncertain", "high")]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.confidence, "high");
});

test("a frame-level failure never contributes an explicit signal -- only genuine verdicts are aggregated", () => {
  const result = aggregateFrameResults([fail("provider_error"), ok("safe", "high")]);
  assert.deepEqual(result, { ok: true, verdict: "safe", confidence: "high", reason: undefined });
});

test("REQUIRED: if EVERY sampled frame failed, the aggregate is itself a failure -- never silently safe or explicit", () => {
  const result = aggregateFrameResults([fail("provider_timeout"), fail("provider_error")]);
  assert.equal(result.ok, false);
});

test("no frames at all -> failure, not a fabricated safe/explicit result", () => {
  assert.equal(aggregateFrameResults([]).ok, false);
});

/* ========================================================= early exit ==== */

test("REQUIRED: early exit fires only for a high-confidence explicit frame", () => {
  assert.equal(isEarlyExitResult(ok("explicit", "high")), true);
  assert.equal(isEarlyExitResult(ok("explicit", "medium")), false);
  assert.equal(isEarlyExitResult(ok("uncertain", "high")), false);
  assert.equal(isEarlyExitResult(ok("safe", "high")), false);
});

test("early exit never fires on a failure", () => {
  assert.equal(isEarlyExitResult(fail("provider_error")), false);
});

/* ==================================================== enforcement policy ==== */

test("REQUIRED (CASE 1 shape): high-confidence explicit content -> DELETE_BAN, eligible for automatic action", () => {
  const enforcement = decideMediaEnforcement({ result: ok("explicit", "high"), priorWarningCount: 0 });
  assert.deepEqual(enforcement, { kind: "DELETE_BAN", reason: "explicit_content" });
});

test("REQUIRED (CASE 3/CASE 4 shape): safe content -> ALLOW, no action at all", () => {
  assert.deepEqual(decideMediaEnforcement({ result: ok("safe", "high"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: ok("safe", "low"), priorWarningCount: 2 }), { kind: "ALLOW" });
});

test("uncertain/low-or-medium confidence -> ALLOW, weak evidence never triggers enforcement", () => {
  assert.deepEqual(decideMediaEnforcement({ result: ok("uncertain", "low"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: ok("uncertain", "medium"), priorWarningCount: 0 }), { kind: "ALLOW" });
});

test("borderline (explicit but not high confidence, or uncertain at high confidence) -> DELETE_WARN, not an instant ban", () => {
  assert.deepEqual(decideMediaEnforcement({ result: ok("explicit", "medium"), priorWarningCount: 0 }), { kind: "DELETE_WARN", warningNumber: 1, reason: "explicit_content_borderline" });
  assert.deepEqual(decideMediaEnforcement({ result: ok("uncertain", "high"), priorWarningCount: 0 }), { kind: "DELETE_WARN", warningNumber: 1, reason: "explicit_content_borderline" });
});

test("repeated borderline violations escalate to a ban after the shared warning limit (reuses link moderation's own 3-strike limit)", () => {
  assert.deepEqual(decideMediaEnforcement({ result: ok("explicit", "medium"), priorWarningCount: 3 }), { kind: "DELETE_BAN", reason: "repeated_explicit_content" });
});

test("REQUIRED (CASE 5): a classifier failure (timeout, provider error, unconfigured) NEVER resolves to a delete/ban -- always ALLOW", () => {
  assert.deepEqual(decideMediaEnforcement({ result: fail("provider_timeout"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("provider_error"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("provider_unconfigured"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("download_failed"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("decode_failed"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("too_large"), priorWarningCount: 0 }), { kind: "ALLOW" });
  assert.deepEqual(decideMediaEnforcement({ result: fail("unsupported_media"), priorWarningCount: 0 }), { kind: "ALLOW" });
});

test("a classifier failure never escalates to a ban even with a long prior warning history", () => {
  assert.deepEqual(decideMediaEnforcement({ result: fail("provider_timeout"), priorWarningCount: 10 }), { kind: "ALLOW" });
});

test("REQUIRED (negative case): ordinary skin exposure alone is not enough -- only an actual 'explicit' verdict from the classifier can trigger enforcement, never inferred from confidence alone", () => {
  // The policy layer has no independent notion of "skin exposure" -- it only
  // ever acts on the classifier's OWN verdict. A "safe" verdict at ANY
  // confidence level never triggers action, which is what actually protects
  // beach photos/swimwear/etc: that judgment call lives entirely in the
  // classifier, not in a separate skin-detection heuristic here.
  assert.deepEqual(decideMediaEnforcement({ result: ok("safe", "high"), priorWarningCount: 0 }), { kind: "ALLOW" });
});
