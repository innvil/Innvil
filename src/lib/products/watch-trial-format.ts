/**
 * Pure, client-safe (no `server-only`) trial time-remaining formatting --
 * same extraction pattern as watch-datetime.ts/watch-status.ts, so a "use
 * client" Plans/Overview component can format a trial's real, server-sourced
 * `endsAt` without pulling watch-trial.ts's `server-only` module graph
 * (Supabase admin, etc.) into the client bundle.
 *
 * Deliberately a coarse, human duration ("6 days remaining" / "Ends today")
 * -- never a decrementing second-by-second countdown, which the product
 * spec explicitly calls anxiety-inducing. The VALUE itself always comes
 * from the real server `endsAt`; this only formats it for display.
 */
export function trialTimeRemainingLabel(endsAt: string, now = new Date()): string {
  const end = new Date(endsAt).getTime();
  const diffMs = end - now.getTime();
  if (diffMs <= 0) return "Trial ended";
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} remaining`;
  const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
  return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
}

export function formatTrialEndsAt(endsAt: string): string {
  return new Date(endsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
