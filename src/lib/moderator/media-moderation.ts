/* =========================================================
   Direct photo/video moderation — pure logic, no I/O, no AI/vision calls.

   Extends the SAME moderation abstraction link-moderation.ts already
   established, rather than creating a parallel engine: `ModerationEnforcement`
   (ALLOW / DELETE_WARN / DELETE_BAN) is reused verbatim. Media violations map
   onto the same "explicit_content" severity link-moderation.ts already has
   for text/EXPLICIT_CONTENT links -- explicit media is a safety question,
   never role-exempt, same as an explicit link.

   This is a SEPARATE decision from Natural Chatter and from link moderation
   (same principle as link-moderation.ts's own header): it runs independent
   of chat routing, never invokes DeepSeek/Claude conversational paths, and
   never depends on classification alone for anything irreversible.
   ========================================================= */

import { PROMOTION_WARNING_LIMIT, type ModerationEnforcement } from "./link-moderation";

export type MediaKind = "photo" | "video" | "animation";

/** A verdict the visual-safety classifier actually returned. */
export type MediaSafetyVerdict = "safe" | "uncertain" | "explicit";
export type MediaSafetyConfidence = "low" | "medium" | "high";

/** A classifier/pipeline FAILURE — structurally distinct from a verdict, so
 *  "the provider timed out" can never be silently treated as "explicit"
 *  (spec: classifier/provider failure must NOT be silently interpreted as
 *  "porn detected"). */
export type MediaFailureKind =
  | "provider_unconfigured"
  | "provider_error"
  | "provider_timeout"
  | "download_failed"
  | "unsupported_media"
  | "too_large"
  | "duration_exceeded"
  | "decode_failed";

export type MediaClassificationResult =
  | { ok: true; verdict: MediaSafetyVerdict; confidence: MediaSafetyConfidence; reason?: string }
  | { ok: false; failure: MediaFailureKind };

/** One representative frame's classification, used when aggregating a
 *  video's sampled frames into a single media-level result. */
export type FrameResult = MediaClassificationResult;

/** Aggregates multiple sampled frame results into ONE media-level verdict.
 *  The strongest (most explicit / highest-confidence) genuine verdict wins —
 *  a user cannot evade detection by making only the FIRST sampled frame
 *  safe while a later one is explicit. A frame-level FAILURE never
 *  contributes an "explicit" signal; if every frame failed, the aggregate
 *  is itself a failure (never silently treated as safe OR explicit). */
export function aggregateFrameResults(results: FrameResult[]): MediaClassificationResult {
  if (results.length === 0) return { ok: false, failure: "unsupported_media" };

  const verdictRank: Record<MediaSafetyVerdict, number> = { safe: 0, uncertain: 1, explicit: 2 };
  const confidenceRank: Record<MediaSafetyConfidence, number> = { low: 0, medium: 1, high: 2 };

  let best: { verdict: MediaSafetyVerdict; confidence: MediaSafetyConfidence; reason?: string } | null = null;
  for (const r of results) {
    if (!r.ok) continue;
    if (
      !best ||
      verdictRank[r.verdict] > verdictRank[best.verdict] ||
      (verdictRank[r.verdict] === verdictRank[best.verdict] && confidenceRank[r.confidence] > confidenceRank[best.confidence])
    ) {
      best = { verdict: r.verdict, confidence: r.confidence, reason: r.reason };
    }
  }
  if (!best) return { ok: false, failure: "provider_error" }; // every sampled frame failed
  return { ok: true, ...best };
}

/** Bounded frame-sampling positions (milliseconds into the video), chosen
 *  so a user can't evade detection by placing safe content only at the
 *  start: always includes a point near the beginning, middle, and end for
 *  short clips; for longer videos, a bounded number of evenly-spaced
 *  interior points are added instead of scaling sample count with duration
 *  (which is what "bounded" means here — cost stays flat regardless of how
 *  long the video is). Deliberately NOT scaled to a fixed per-second rate,
 *  since that would make a 10-minute video cost 10x a 1-minute one and
 *  reopen exactly the "one call per frame of a long video" problem this
 *  function exists to prevent. */
export const MAX_VIDEO_SAMPLE_FRAMES = 5;
const MIN_EDGE_MARGIN_MS = 300; // never sample literally frame 0 / the last ms -- a hair inside each edge

export function computeSamplePositions(durationMs: number, maxFrames: number = MAX_VIDEO_SAMPLE_FRAMES): number[] {
  if (durationMs <= 0) return [0];
  const margin = Math.min(MIN_EDGE_MARGIN_MS, durationMs / 4);
  const start = margin;
  const end = Math.max(start, durationMs - margin);
  if (maxFrames <= 1 || end <= start) return [Math.floor(durationMs / 2)];

  const positions: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const t = start + ((end - start) * i) / (maxFrames - 1);
    positions.push(Math.floor(t));
  }
  return positions;
}

/** True once an aggregate-so-far is confident enough that sampling
 *  additional frames can stop early (spec: "stop processing early when a
 *  sufficiently high-confidence explicit result makes additional sampling
 *  unnecessary"). Never short-circuits on "safe" — every position is worth
 *  checking for a positive result, but there's no reason to keep spending
 *  frames once one is unambiguously explicit. */
export function isEarlyExitResult(result: FrameResult): boolean {
  return result.ok && result.verdict === "explicit" && result.confidence === "high";
}

/** The deterministic policy layer (mirrors link-moderation.ts's
 *  decideLinkEnforcement exactly in shape/severity treatment). Classifier
 *  FAILURE of any kind always resolves to ALLOW — never converted into an
 *  enforcement action, matching "provider failure must not be silently
 *  interpreted as porn detected" and "do not auto-delete because the
 *  classifier failed". Explicit/high-confidence is NOT admin/trusted-role
 *  exempt (same principle as link-moderation.ts's severity branches — a
 *  safety question, not a self-promotion allowance). */
export function decideMediaEnforcement(input: {
  result: MediaClassificationResult;
  priorWarningCount: number;
}): ModerationEnforcement {
  if (!input.result.ok) return { kind: "ALLOW" };

  const { verdict, confidence } = input.result;
  if (verdict === "explicit" && confidence === "high") return { kind: "DELETE_BAN", reason: "explicit_content" };

  // Borderline: explicit-but-not-high-confidence, or uncertain-but-high-
  // confidence -- eligible for the SAME warn/escalate path link moderation
  // already uses, rather than an instant ban on weaker evidence.
  const borderline = (verdict === "explicit" && confidence !== "high") || (verdict === "uncertain" && confidence === "high");
  if (!borderline) return { kind: "ALLOW" }; // safe, or uncertain at low/medium confidence

  const nextCount = input.priorWarningCount + 1;
  if (nextCount > PROMOTION_WARNING_LIMIT) return { kind: "DELETE_BAN", reason: "repeated_explicit_content" };
  return { kind: "DELETE_WARN", warningNumber: nextCount, reason: "explicit_content_borderline" };
}
