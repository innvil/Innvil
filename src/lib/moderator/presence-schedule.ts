/**
 * Watcher Presence Scheduling (Phase 4.U) — the pure, deterministic
 * scheduling algorithm. No I/O, no Date.now() calls of its own (every
 * function takes `now` explicitly) — directly testable without mocking a
 * clock or a database.
 *
 * ARCHITECTURE: a continuous, anchor-based rotation, never a "reset at
 * local midnight every day" model. Each deployment resolves to exactly
 * three numbers — `{anchorUtc, activeMinutes, cycleMinutes}` — and
 * `presenceAt()` is plain elapsed-time-since-anchor arithmetic from there.
 * This is deliberately DST-safe and immune to `cycleMinutes` not evenly
 * dividing 1440: the anchor is a single fixed UTC instant (computed once,
 * via zonedTimeToUtc — see autopost.ts — at setup/reset time), and nothing
 * after that needs to re-localize `now` at all. "Store schedule data in a
 * representation that avoids timezone ambiguity" (spec) is satisfied by
 * storing the anchor as an absolute instant, not a recurring local-time
 * rule that would need re-resolving against a possibly-changed timezone
 * every single cron tick.
 *
 * `intervalKey` (returned by `presenceAt`) is the UTC ISO string of the
 * CURRENT interval's own start instant — stable for the whole interval,
 * advances exactly once when `now` crosses into the next interval,
 * regardless of how often the caller polls. This is the persisted
 * idempotency identity a runtime caller compares against to know whether a
 * REAL transition just occurred (spec's hard idempotency requirement).
 */

export interface PresenceConfig {
  /** ISO instant — the fixed reference point cycle position 0 is measured
   *  from. Computed once (setup or explicit "Reset to Recommended"), never
   *  implicitly recomputed on unrelated saves. */
  anchorUtc: string;
  /** How long, in minutes, this deployment is "present" per cycle. */
  activeMinutes: number;
  /** The full length, in minutes, of one repeat of the rotation. */
  cycleMinutes: number;
}

export interface PresenceResult {
  present: boolean;
  /** Stable identity of the current logical interval — the idempotency key. */
  intervalKey: string;
}

/** Default "Innvil Recommended" stagger/rotation cadence (spec: "default
 *  stagger/rotation cadence: every 2 hours" — a stagger interval, never a
 *  fixed 2-hour active duration). */
export const DEFAULT_STAGGER_MINUTES = 120;

/** Given `now` and a resolved PresenceConfig, decide whether this
 *  deployment should currently be "present" and what the current interval's
 *  stable identity is. Handles `now` before `anchorUtc` safely (a fresh
 *  deployment configured mid-cycle, or clock skew) via a floor-safe modulo. */
export function presenceAt(config: PresenceConfig, now: Date): PresenceResult {
  const anchorMs = new Date(config.anchorUtc).getTime();
  const cycleMs = config.cycleMinutes * 60_000;
  const activeMs = Math.min(config.activeMinutes, config.cycleMinutes) * 60_000;
  const elapsedMs = now.getTime() - anchorMs;
  // Floor-safe modulo -- (%) in JS can return a negative result for a
  // negative left-hand side, which would otherwise misclassify `now`
  // shortly before the anchor.
  const phaseMs = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
  const intervalStartMs = anchorMs + Math.floor(elapsedMs / cycleMs) * cycleMs;
  return {
    present: phaseMs < activeMs,
    intervalKey: new Date(intervalStartMs).toISOString(),
  };
}

/** Apply an optional community-wide coverage window (local-time-of-day
 *  minutes, e.g. 08:00 = 480) on top of an already-computed presence
 *  result -- outside the window, presence is forced OFF regardless of
 *  phase, but the intervalKey is still returned so the caller can still
 *  detect a genuine active->away transition happening because the window
 *  closed, not only because of the rotation's own phase. `localMinutesOfDay`
 *  is the caller's responsibility to derive from `now` + the community's
 *  timezone (autopost.ts already has the canonical zonedTimeToUtc/
 *  localDateKeyInTimezone helpers this reuses for that conversion). */
export function applyCoverageWindow(
  result: PresenceResult,
  localMinutesOfDay: number | null,
  coverageStartMinutes: number | null,
  coverageEndMinutes: number | null
): PresenceResult {
  if (coverageStartMinutes == null || coverageEndMinutes == null || localMinutesOfDay == null) return result;
  const inWindow =
    coverageStartMinutes <= coverageEndMinutes
      ? localMinutesOfDay >= coverageStartMinutes && localMinutesOfDay < coverageEndMinutes
      : // an overnight window (e.g. 20:00-06:00) -- wraps past midnight
        localMinutesOfDay >= coverageStartMinutes || localMinutesOfDay < coverageEndMinutes;
  if (inWindow) return result;
  return { present: false, intervalKey: result.intervalKey };
}

export interface RecommendedDeploymentInput {
  deploymentId: string;
  /** 0-based rotation order -- by moderator_deployments.created_at unless
   *  the owner reorders. */
  orderIndex: number;
}

/** Generates the "Innvil Recommended" schedule for every participating
 *  deployment in a community -- deterministic, no randomness, so owners get
 *  a predictable schedule (spec: "Avoid random schedule generation... Owners
 *  need predictable schedules"). Handles N=1..5+ uniformly, no hard-coded
 *  per-count branching.
 *
 *  Formula: cycleMinutes = staggerMinutes * N (N = deployment count);
 *  activeMinutes = min(staggerMinutes * 1.5, cycleMinutes) (creates real
 *  overlap between consecutive deployments' windows -- verified against the
 *  spec's own N=2 worked example: cycle=240min, active=180min produces
 *  exactly "Kwan starts, 2h later Test joins with 1h overlap, Kwan rotates
 *  out for 1h while Test alone covers, Kwan resumes with another 1h overlap
 *  before Test's own eventual rotation"); anchorUtc = referenceUtc +
 *  orderIndex * staggerMinutes.
 *
 *  N=1 naturally resolves to activeMinutes(staggerMinutes*1.5) clamped to
 *  cycleMinutes(staggerMinutes*1) -- i.e. always-present, which is the
 *  correct default for a lone Watcher with nothing to rotate with. */
export function computeRecommendedSchedule(
  deployments: RecommendedDeploymentInput[],
  staggerMinutes: number,
  referenceUtc: string
): Map<string, PresenceConfig> {
  const n = Math.max(1, deployments.length);
  const cycleMinutes = staggerMinutes * n;
  const activeMinutes = Math.min(staggerMinutes * 1.5, cycleMinutes);
  const referenceMs = new Date(referenceUtc).getTime();

  const result = new Map<string, PresenceConfig>();
  for (const d of deployments) {
    const anchorMs = referenceMs + d.orderIndex * staggerMinutes * 60_000;
    result.set(d.deploymentId, {
      anchorUtc: new Date(anchorMs).toISOString(),
      activeMinutes,
      cycleMinutes,
    });
  }
  return result;
}
