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
import { getAccountTelegramIdentity } from "@/src/lib/products/watch-abuse";
import { getWatchTrialState, type WatchTrialStatus } from "@/src/lib/products/watch-trial";
import { resolveOnboardingStage, type OnboardingStage } from "@/src/lib/products/watch-onboarding-state";
import { moderatorPersonaIsAssigned } from "@/src/lib/moderator/domain";

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
  /** Real, server-resolved Telegram PERSON identity status -- never the
   *  Telegram Community connection. */
  telegramVerified: boolean;
  /** The real trial status (telegram_required/eligible/active/expired),
   *  used only for CTA COPY ("Start Free Trial" vs "Choose a plan") once
   *  `onboardingStage === "try_watch"` -- never a second entitlement gate. */
  trialStatus: WatchTrialStatus;
  /** The single first-run onboarding stage to show, resolved from all of
   *  the above via the pure state machine in watch-onboarding-state.ts.
   *  "operational" means the normal Overview should render instead of the
   *  welcome panel. */
  onboardingStage: OnboardingStage;
}

const EMPTY_ACCESS: WatchAccessState = {
  authenticated: false, entitled: false, projects: [], watchers: [], communities: [], capacity: null, activity: [], moderationActionsLast7Days: 0, attentionItems: [], communityStats: {},
  telegramVerified: false, trialStatus: "telegram_required", onboardingStage: "connect_telegram",
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

  // Communities/Watchers are fetched ONCE and threaded into every downstream
  // read below -- previously each of `getAccountCapacity`/`listAccountActivity`/
  // `countRecentModerationActions`/`listAccountAttentionItems`/
  // `getCommunityOperationalStats` independently re-ran `listAccountCommunities`'s
  // own 4-sequential-round-trip chain (and `listAccountAttentionItems` also
  // re-ran the entire `getAccountCapacity` computation a second time
  // internally), meaning a single Overview page load fired that one chain
  // roughly 8-10 times over. Live-reported as generalized app slowness
  // ("Overview or other menus takes forever"). Fixed by computing the shared
  // inputs once, not by adding any caching layer -- every value here is still
  // fetched fresh on every call.
  const [entitled, projects, communities, telegramIdentity, trial] = await Promise.all([
    hasProductAccess(admin, user.id, WATCH_PRODUCT_SLUG),
    listAccountProjects(admin, user.id),
    listAccountCommunities(admin, user.id),
    getAccountTelegramIdentity(admin, user.id),
    getWatchTrialState(admin, user.id),
  ]);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });

  const [activity, moderationActionsLast7Days, attentionItems, statsMap] = await Promise.all([
    listAccountActivity(admin, user.id, {}, communities),
    countRecentModerationActions(admin, user.id, 7, communities),
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    getCommunityOperationalStats(admin, user.id, communities),
  ]);
  const communityStats = Object.fromEntries(statsMap);
  const activeDeploymentCount = communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length;
  const onboardingStage = resolveOnboardingStage({
    telegramVerified: telegramIdentity != null,
    hasEntitlement: capacity != null,
    projectCount: projects.length,
    watcherCount: watchers.length,
    watcherPersonaAssigned: watchers.some((w) => moderatorPersonaIsAssigned(w.persona)),
    activeDeploymentCount,
  });
  return {
    authenticated: true, entitled, projects, watchers, communities, capacity, activity, moderationActionsLast7Days, attentionItems, communityStats,
    telegramVerified: telegramIdentity != null, trialStatus: trial.status, onboardingStage,
  };
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
