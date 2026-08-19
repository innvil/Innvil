"use server";

/**
 * Thin auth wrappers around the session-less core in
 * src/lib/products/ownership.ts — resolves the authenticated account, then
 * delegates. Mirrors the established "action = thin auth wrapper over a
 * plain lib function" pattern already used elsewhere in this codebase
 * (e.g. orders/place.ts's placeOrderForAccount).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { hasProductAccess, createStandaloneProject, listAccountProjects, type AccountProjectRow } from "@/src/lib/products/ownership";
import { WATCH_PRODUCT_SLUG } from "@/src/lib/products/watch";
import {
  createAccountWatcher, listAccountWatchers, createAccountCommunity, deployAccountWatcher,
  listAccountCommunities, getAccountCapacity, listAccountActivity, countRecentModerationActions,
  listAccountAttentionItems, getCommunityOperationalStats,
  type AccountWatcherRow, type AccountCommunityInput, type AccountCommunityRow, type AccountDeploymentRow,
  type AccountCommunitySummary, type AccountCapacity, type AccountActivityItem, type AttentionItem,
  type CommunityOperationalStats,
} from "@/src/lib/products/watch-runtime";

export interface WatchAccessState {
  authenticated: boolean;
  entitled: boolean;
  projects: AccountProjectRow[];
  watchers: AccountWatcherRow[];
  communities: AccountCommunitySummary[];
  capacity: AccountCapacity | null;
  activity: AccountActivityItem[];
  moderationActionsLast7Days: number;
  attentionItems: AttentionItem[];
  /** Per-community operational stats, keyed by community id -- a plain
   *  object (not a Map) since this crosses the server->client component
   *  boundary and Maps aren't serializable as React props. */
  communityStats: Record<string, CommunityOperationalStats>;
}

const EMPTY_ACCESS: WatchAccessState = {
  authenticated: false, entitled: false, projects: [], watchers: [], communities: [], capacity: null, activity: [], moderationActionsLast7Days: 0, attentionItems: [], communityStats: {},
};

/** Resolves what the current visitor should see on the Watch domain:
 *  unauthenticated (show the marketing landing) vs. authenticated (show the
 *  real Watch dashboard shell, regardless of entitlement).
 *
 *  AUTHENTICATION != ENTITLEMENT. `entitled` is still resolved and returned
 *  (WatchDashboard/WatchShell use it to decide what to show, e.g. which
 *  onboarding step comes first), but it is no longer a gate on whether the
 *  dashboard itself renders — a brand-new account with zero Panels, zero
 *  Projects, and no trial/subscription yet must still land inside the real
 *  dashboard shell (real, empty Projects/Watchers/Communities/activity, and
 *  `capacity: null`, which every consumer of this already renders as a
 *  genuine empty/upsell state) rather than being bounced back to the
 *  marketing landing on every visit. */
export async function getWatchAccessState(): Promise<WatchAccessState> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_ACCESS;

  const entitled = await hasProductAccess(admin, user.id, WATCH_PRODUCT_SLUG);

  const [projects, watchers, communities, capacity, activity, moderationActionsLast7Days, attentionItems, statsMap] = await Promise.all([
    listAccountProjects(admin, user.id),
    listAccountWatchers(admin, user.id),
    listAccountCommunities(admin, user.id),
    getAccountCapacity(admin, user.id),
    listAccountActivity(admin, user.id),
    countRecentModerationActions(admin, user.id),
    listAccountAttentionItems(admin, user.id),
    getCommunityOperationalStats(admin, user.id),
  ]);
  const communityStats = Object.fromEntries(statsMap);
  return { authenticated: true, entitled, projects, watchers, communities, capacity, activity, moderationActionsLast7Days, attentionItems, communityStats };
}

export async function createWatchProject(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const result = await createStandaloneProject(admin, user.id, name);
  if (!result.ok) return { ok: false, error: result.error ?? "Could not create the project." };
  return { ok: true };
}

/**
 * Thin auth wrappers over watch-runtime.ts's neutral Community/Watcher/
 * Deployment ownership layer — every export re-derives the account from the
 * authenticated session, never a client-supplied id (same established
 * pattern as createWatchProject above).
 */

export async function createWatcher(name: string): Promise<{ ok: true; data: AccountWatcherRow } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return createAccountWatcher(admin, user.id, name);
}

export async function getWatchers(): Promise<AccountWatcherRow[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  return listAccountWatchers(admin, user.id);
}

export async function createCommunity(projectId: string, input: AccountCommunityInput): Promise<{ ok: true; data: AccountCommunityRow } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return createAccountCommunity(admin, user.id, projectId, input);
}

export async function deployWatcher(moderatorId: string, communityId: string): Promise<{ ok: true; data: AccountDeploymentRow } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return deployAccountWatcher(admin, user.id, moderatorId, communityId);
}
