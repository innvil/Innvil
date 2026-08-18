/**
 * Pure, client-safe status helpers split out of `watch-runtime.ts` (which
 * has `import "server-only"` and can't be imported from a "use client"
 * component — Next's build rejects the whole bundle if it is, since
 * `watch-runtime.ts` transitively imports `src/lib/supabase/admin.ts`).
 * `communityOperationalStatus` has no I/O at all, so it belongs here
 * instead, importable from both server pages and client components
 * (Overview, Community Health tables, badges).
 */

export type CommunityOperationalStatus = "healthy" | "needs_attention" | "paused";

export interface CommunityWatcherLike {
  enabled: boolean;
}

/** Deterministic operational status for a Community, from the same real
 *  deployment data the Watchers/Community Health tables already read --
 *  never an invented "health percentage". `needs_attention` (no Watcher
 *  deployed at all) takes precedence over `paused` (deployed but every
 *  deployment disabled) since it's the more urgent gap. */
export function communityOperationalStatus(community: { watchers: CommunityWatcherLike[] }): CommunityOperationalStatus {
  if (community.watchers.length === 0) return "needs_attention";
  if (community.watchers.some((w) => w.enabled)) return "healthy";
  return "paused";
}
