/**
 * Pure, client-safe status helpers split out of `watch-runtime.ts` (which
 * has `import "server-only"` and can't be imported from a "use client"
 * component — Next's build rejects the whole bundle if it is, since
 * `watch-runtime.ts` transitively imports `src/lib/supabase/admin.ts`).
 * `communityOperationalStatus` has no I/O at all, so it belongs here
 * instead, importable from both server pages and client components
 * (Overview, Community Health tables, badges).
 */

/** A Watcher whose Telegram bot credential is already connected -- eligible
 *  to be selected for deployment (from Watchers, or from a Project's own
 *  "Add Watcher" flow) without walking through bot creation again. Lives
 *  here (client-safe, no I/O) rather than in watch-runtime.ts specifically
 *  so client components (WatcherConnectModal.tsx) can import it without
 *  pulling that file's whole server-only module graph into the browser
 *  bundle -- and never in a `"use server"` action file, since exporting a
 *  plain Set from one silently breaks the ENTIRE server-actions bundle at
 *  build time (the exact incident this codebase has already hit twice; see
 *  CLAUDE.md's v1.23.4 entry). */
export const DEPLOYABLE_PROVISIONING_STATUSES = new Set(["bot_ready", "community_setup_required", "active"]);

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

export type WatcherOperationalStatus = "active" | "paused" | "unassigned";

export interface WatcherDeploymentLike { watcherId: string; enabled: boolean }

/** Deterministic per-Watcher operational status from the same real
 *  deployment data every other Watcher surface already reads -- "active"
 *  (at least one enabled deployment), "paused" (deployed, but every
 *  deployment disabled), or "unassigned" (not deployed to a Community at
 *  all). Reused by the Watcher navigator (compact row status) and the
 *  Watchers list's own filter chips, so the two can never disagree about
 *  what "active"/"paused" means for a Watcher. */
export function watcherOperationalStatus(watcherId: string, deployments: WatcherDeploymentLike[]): WatcherOperationalStatus {
  const own = deployments.filter((d) => d.watcherId === watcherId);
  if (own.length === 0) return "unassigned";
  return own.some((d) => d.enabled) ? "active" : "paused";
}

export interface CommunityWithWatcherDeployments {
  id: string;
  title?: string | null;
  chatId?: string;
  watchers: Array<{ watcherId: string; enabled: boolean }>;
}

/** Flattens the per-Community watcher-deployment lists (as returned by
 *  `listAccountCommunities`) into one flat per-deployment list keyed by
 *  Watcher id -- the exact shape the Watcher navigator and the Watchers
 *  list page both need, computed once from the same source data rather
 *  than re-derived independently in each route. */
export function deploymentSummaries(communities: CommunityWithWatcherDeployments[]): Array<{ watcherId: string; communityTitle: string; enabled: boolean }> {
  return communities.flatMap((c) =>
    c.watchers.map((w) => ({ watcherId: w.watcherId, communityTitle: c.title ?? c.chatId ?? "", enabled: w.enabled }))
  );
}
