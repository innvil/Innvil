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
  setAccountCommunityAllowSolicitation, setAccountCommunityAcknowledgeAdminMod,
  listAccountCommunityTopics, setAccountCommunityTopicPolicy, setAccountCommunityTopicName, type AccountCommunityTopicRow,
  getAccountCommunityPendingReplyDelay, setAccountCommunityPendingReplyDelay,
  getAccountCommunityPromotionChannel, setAccountCommunityPromotionChannel, type PromotionChannelFallback,
  listAccountCommunities, getAccountCapacity, listAccountActivity, countRecentModerationActions,
  listAccountAttentionItems, getCommunityOperationalStats, getAccountSlotBreakdown, getAccountActivityTrend,
  getAccountProjectDetail, getAccountWatcherDetail, getAccountPaidPlan,
  type AccountWatcherRow, type AccountCommunityInput, type AccountCommunityRow, type AccountDeploymentRow,
  type AccountCommunitySummary, type AccountCapacity, type AccountActivityItem, type AttentionItem,
  type CommunityOperationalStats, type AccountSlotBreakdown,
} from "@/src/lib/products/watch-runtime";
import { communityOperationalStatus, DEPLOYABLE_PROVISIONING_STATUSES } from "@/src/lib/products/watch-status";
import { getAccountTelegramIdentity, getPendingTelegramVerification, type AccountTelegramIdentity } from "@/src/lib/products/watch-abuse";
import { getWatchTrialState, type WatchTrialStatus } from "@/src/lib/products/watch-trial";
import { resolveOnboardingStage, type OnboardingStage } from "@/src/lib/products/watch-onboarding-state";
import { moderatorPersonaIsAssigned } from "@/src/lib/moderator/domain";
import { getCommunityExpansionState } from "@/src/lib/products/watch-community-expansion";
import { listAvailableDirectWatchGateways, listWatchPaymentHistory, getPendingWatchPayment } from "@/src/lib/products/watch-checkout";
import { getAccountPreferences } from "@/src/lib/products/watch-account-preferences";
import { resolveAccountBillingPeriod, getWatchAiGenerationUsage, aiGenerationPoolLimit } from "@/src/lib/products/watch-ai-usage";
import { getWatchMediaModerationUsage } from "@/src/lib/products/watch-media-moderation-usage";
import { getByoUsageSummary } from "@/src/lib/products/watch-byo-usage";
import { getByoUsageStatus } from "@/src/lib/products/watch-byo-usage-policy";
import { getMediaModerationAddonState } from "@/src/lib/products/watch-media-moderation-addon";
import { MANAGED_ENTERPRISE_50, resolveEnterpriseMediaAddonKey } from "@/src/lib/products/watch-enterprise";
import { reactiveQuotaDay, getCommunityReactiveQuotaUsage } from "@/src/lib/moderator/community-runtime";
import { getInnvilCreditBalance, listInnvilCreditActivity } from "@/src/lib/products/innvil-credit";
import { getNotificationPreferences } from "@/src/lib/products/watch-notifications";
import { getWatchByoCredentialState } from "@/src/lib/actions/watch-byo-settings";
import { getAccountProjectProfile } from "@/src/lib/actions/watch-project-profile";
import { listProjectEscalations, listProjectModerationReports } from "@/src/lib/actions/watch-escalations";
import { getCommunityPresenceSchedule } from "@/src/lib/actions/watch-presence";
import { getAutoPostingEligibility } from "@/src/lib/actions/watch-autopost";
import { AUTO_POSTING_ENABLED } from "@/src/lib/moderator/plan";
import { MODERATOR_COMMUNITY_CAPACITY, ENTERPRISE_MEDIA_ADDON, type ModeratorPlanTier } from "@/src/lib/money";

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

export async function setCommunityAllowSolicitation(communityId: string, allow: boolean): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityAllowSolicitation(admin, user.id, communityId, allow);
}

export async function setCommunityAcknowledgeAdminMod(communityId: string, acknowledge: boolean): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityAcknowledgeAdminMod(admin, user.id, communityId, acknowledge);
}

export async function getCommunityTopics(communityId: string): Promise<AccountCommunityTopicRow[]> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return [];
  return listAccountCommunityTopics(admin, user.id, communityId);
}

export async function setCommunityTopicPolicy(
  communityId: string, messageThreadId: number, policy: AccountCommunityTopicRow["policy"]
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityTopicPolicy(admin, user.id, communityId, messageThreadId, policy);
}

export async function setCommunityTopicName(
  communityId: string, messageThreadId: number, customName: string | null
): Promise<{ ok: true; data: null } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityTopicName(admin, user.id, communityId, messageThreadId, customName);
}

export async function getCommunityPendingReplyDelay(communityId: string): Promise<number | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  return getAccountCommunityPendingReplyDelay(admin, user.id, communityId);
}

export async function setCommunityPendingReplyDelay(
  communityId: string, delaySeconds: number
): Promise<{ ok: true; data: { delaySeconds: number } } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityPendingReplyDelay(admin, user.id, communityId, delaySeconds);
}

export async function getCommunityPromotionChannel(communityId: string): Promise<PromotionChannelFallback | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  return getAccountCommunityPromotionChannel(admin, user.id, communityId);
}

export async function setCommunityPromotionChannel(
  communityId: string, name: string | null, link: string | null
): Promise<{ ok: true; data: PromotionChannelFallback } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountCommunityPromotionChannel(admin, user.id, communityId, name, link);
}

/* ============================================================
   Cache-first page-data actions -- one per SWR-driven page, each a thin
   "use server" wrapper reusing the SAME already-optimized watch-runtime.ts
   functions every server-rendered page already relies on. Called directly
   as a Client Component's SWR fetcher (Server Actions are callable from
   Client Components as ordinary async functions) -- no new data-fetching
   logic, just a callable shape for the client to invoke on demand instead of
   the page's own Server Component blocking on it before rendering anything.
   ============================================================ */

export interface WatchersPageData {
  watchers: AccountWatcherRow[];
  communities: AccountCommunitySummary[];
  projects: AccountProjectRow[];
  capacity: AccountCapacity | null;
  attentionCount: number;
}

const EMPTY_WATCHERS_PAGE: WatchersPageData = { watchers: [], communities: [], projects: [], capacity: null, attentionCount: 0 };

export async function getWatchersPageData(): Promise<WatchersPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_WATCHERS_PAGE;
  // Same fetch-once-then-share staging as getWatchShellContext/
  // getWatchAccessState -- communities -> watchers (reusing communities) ->
  // capacity (reusing both) -> attentionItems (reusing all three), never a
  // second independent re-fetch of the same data.
  const [communities, projects] = await Promise.all([
    listAccountCommunities(admin, user.id),
    listAccountProjects(admin, user.id),
  ]);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const attentionItems = await listAccountAttentionItems(admin, user.id, { communities, watchers, capacity });
  return { watchers, communities, projects, capacity, attentionCount: attentionItems.length };
}

export interface CommunitiesPageData {
  communities: AccountCommunitySummary[];
  capacity: AccountCapacity | null;
  attentionCount: number;
  /** Keyed by community id -- a plain object (not a Map), same reason
   *  WatchAccessState.communityStats already is: it crosses the server ->
   *  client action boundary and must stay serializable. */
  communityStats: Record<string, CommunityOperationalStats>;
  expansionActive: boolean;
  expansionCancelAtPeriodEnd: boolean;
  gateways: string[];
  /** The account's own Projects (for the "+ Add Community" project picker,
   *  see CommunitiesPageClient) and the subset of Watchers that are
   *  actually bot-ready enough to verify a new Telegram connection --
   *  identical shape/filter to the one the Project detail page's own
   *  ProjectAddCommunityCta already uses, so this list-page "Add Community"
   *  reuses that exact same connect flow rather than a second one. */
  projects: AccountProjectRow[];
  deployableWatchers: AccountWatcherRow[];
}

const EMPTY_COMMUNITIES_PAGE: CommunitiesPageData = {
  communities: [], capacity: null, attentionCount: 0, communityStats: {}, expansionActive: false, expansionCancelAtPeriodEnd: false, gateways: [],
  projects: [], deployableWatchers: [],
};

export async function getCommunitiesPageData(): Promise<CommunitiesPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_COMMUNITIES_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const [watchers, projects] = await Promise.all([
    listAccountWatchers(admin, user.id, communities),
    listAccountProjects(admin, user.id),
  ]);
  const [capacity, expansion, gateways, statsMap] = await Promise.all([
    getAccountCapacity(admin, user.id, { communities, watchers }),
    getCommunityExpansionState(admin, user.id),
    listAvailableDirectWatchGateways(),
    getCommunityOperationalStats(admin, user.id, communities),
  ]);
  const attentionItems = await listAccountAttentionItems(admin, user.id, { communities, watchers, capacity });
  return {
    communities, capacity, attentionCount: attentionItems.length,
    communityStats: Object.fromEntries(statsMap),
    expansionActive: expansion != null,
    expansionCancelAtPeriodEnd: expansion?.cancelAtPeriodEnd ?? false,
    gateways,
    projects,
    deployableWatchers: watchers.filter((w) => DEPLOYABLE_PROVISIONING_STATUSES.has(w.provisioningStatus)),
  };
}

/* ============================================================
   More cache-first page-data actions -- same pattern, extended to every
   remaining Watch dashboard page: Projects, Activity, Deployments, Profile,
   Usage, Plans, Billing, Settings, and the three [id] detail routes. Every
   fetch reuses the SAME already-optimized watch-runtime.ts/actions
   functions the pages themselves used to call server-side -- no new data-
   fetching logic, just a callable shape for a Client Component's SWR
   fetcher to invoke on demand.
   ============================================================ */

export interface ProjectsPageData {
  authenticated: boolean;
  projects: AccountProjectRow[];
  communities: AccountCommunitySummary[];
  capacity: AccountCapacity | null;
  attentionCount: number;
}

const EMPTY_PROJECTS_PAGE: ProjectsPageData = { authenticated: false, projects: [], communities: [], capacity: null, attentionCount: 0 };

export async function getProjectsPageData(): Promise<ProjectsPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_PROJECTS_PAGE;
  const [projects, communities] = await Promise.all([
    listAccountProjects(admin, user.id),
    listAccountCommunities(admin, user.id),
  ]);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const attentionItems = await listAccountAttentionItems(admin, user.id, { communities, watchers, capacity });
  return { authenticated: true, projects, communities, capacity, attentionCount: attentionItems.length };
}

export interface ActivityPageData {
  authenticated: boolean;
  communities: AccountCommunitySummary[];
  watchers: AccountWatcherRow[];
  activity: AccountActivityItem[];
  trend: Awaited<ReturnType<typeof getAccountActivityTrend>>;
  capacity: AccountCapacity | null;
  attentionCount: number;
}

const EMPTY_ACTIVITY_PAGE: ActivityPageData = { authenticated: false, communities: [], watchers: [], activity: [], trend: [], capacity: null, attentionCount: 0 };

/** Array-key SWR fetcher: called as `getActivityPageData(...key)` -- the
 *  first positional argument is the plain namespace string in the SWR key
 *  (unused here), followed by the real filter values (empty string = "no
 *  filter", mirroring the URL's own absent-param convention). */
export async function getActivityPageData(_ns: string, communityId: string, watcherId: string, daysStr: string): Promise<ActivityPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_ACTIVITY_PAGE;
  const daysNum = Number(daysStr) || 30;
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [activity, trend, attentionItems] = await Promise.all([
    listAccountActivity(admin, user.id, { limit: 100, communityId: communityId || undefined, watcherId: watcherId || undefined, since }, communities),
    getAccountActivityTrend(admin, user.id, { days: daysNum, communityId: communityId || undefined, watcherId: watcherId || undefined }, communities),
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
  ]);
  return { authenticated: true, communities, watchers, activity, trend, capacity, attentionCount: attentionItems.length };
}

export interface DeploymentsPageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  communities: AccountCommunitySummary[];
  watchers: AccountWatcherRow[];
  breakdown: AccountSlotBreakdown;
  attentionCount: number;
}

const EMPTY_DEPLOYMENTS_PAGE: DeploymentsPageData = {
  authenticated: false, capacity: null, communities: [], watchers: [], breakdown: { byWatcher: [], byCommunity: [] }, attentionCount: 0,
};

export async function getDeploymentsPageData(): Promise<DeploymentsPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_DEPLOYMENTS_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [breakdown, attentionItems] = await Promise.all([
    getAccountSlotBreakdown(admin, user.id, communities),
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
  ]);
  return { authenticated: true, capacity, communities, watchers, breakdown, attentionCount: attentionItems.length };
}

export type ProfileTelegramState =
  | { status: "connected"; identity: AccountTelegramIdentity }
  | { status: "pending"; expiresAt: string }
  | { status: "not_connected" };

export interface ProfilePageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  attentionCount: number;
  email: string | null;
  telegramState: ProfileTelegramState;
  preferences: Awaited<ReturnType<typeof getAccountPreferences>> | null;
}

const EMPTY_PROFILE_PAGE: ProfilePageData = {
  authenticated: false, capacity: null, attentionCount: 0, email: null, telegramState: { status: "not_connected" }, preferences: null,
};

export async function getProfilePageData(): Promise<ProfilePageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_PROFILE_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [attentionItems, userRes, telegram, preferences] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    admin.auth.admin.getUserById(user.id),
    getAccountTelegramIdentity(admin, user.id),
    getAccountPreferences(admin, user.id),
  ]);
  const email = userRes.data.user?.email ?? null;
  let telegramState: ProfileTelegramState;
  if (telegram) {
    telegramState = { status: "connected", identity: telegram };
  } else {
    const pending = await getPendingTelegramVerification(admin, user.id);
    telegramState = pending ? { status: "pending", expiresAt: pending.expiresAt } : { status: "not_connected" };
  }
  return { authenticated: true, capacity, attentionCount: attentionItems.length, email, telegramState, preferences };
}

export interface UsagePageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  attentionCount: number;
  communities: AccountCommunitySummary[];
  watchers: AccountWatcherRow[];
  actions7d: number;
  actions30d: number;
  expansionActive: boolean;
  expansionCancelAtPeriodEnd: boolean;
  gateways: string[];
  aiPeriod: Awaited<ReturnType<typeof resolveAccountBillingPeriod>>;
  aiUsageLimit: number | null;
  aiUsageCount: number | null;
  byoUsage: Awaited<ReturnType<typeof getByoUsageSummary>> | null;
  byoPolicies: Awaited<ReturnType<typeof getByoUsageStatus>> | null;
  mediaUsageCount: number | null;
  enterpriseMediaAllowance: number | null;
  enterpriseMediaUsageCount: number | null;
  trialReactiveUsed: number | null;
}

const EMPTY_USAGE_PAGE: UsagePageData = {
  authenticated: false, capacity: null, attentionCount: 0, communities: [], watchers: [], actions7d: 0, actions30d: 0,
  expansionActive: false, expansionCancelAtPeriodEnd: false, gateways: [], aiPeriod: null, aiUsageLimit: null, aiUsageCount: null,
  byoUsage: null, byoPolicies: null, mediaUsageCount: null, enterpriseMediaAllowance: null, enterpriseMediaUsageCount: null, trialReactiveUsed: null,
};

export async function getUsagePageData(): Promise<UsagePageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_USAGE_PAGE;
  const [communities, expansion, gateways, aiPeriod] = await Promise.all([
    listAccountCommunities(admin, user.id),
    getCommunityExpansionState(admin, user.id),
    listAvailableDirectWatchGateways(),
    resolveAccountBillingPeriod(admin, user.id),
  ]);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [actions7d, actions30d, attentionItems] = await Promise.all([
    countRecentModerationActions(admin, user.id, 7, communities),
    countRecentModerationActions(admin, user.id, 30, communities),
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
  ]);

  const paidTier: ModeratorPlanTier | null =
    capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" && capacity.tier !== "byo20" ? capacity.tier : null;
  const isEnterprise = capacity?.tier === "enterprise" && capacity.apiSourceMode !== "byo";
  const aiUsageLimit = paidTier ? aiGenerationPoolLimit(paidTier) : isEnterprise ? MANAGED_ENTERPRISE_50.aiGenerations : null;
  const aiUsageCount = (paidTier || isEnterprise) && aiPeriod ? await getWatchAiGenerationUsage(admin, user.id, aiPeriod.start) : null;

  const byoUsage = capacity?.apiSourceMode === "byo" ? await getByoUsageSummary(admin, user.id) : null;
  const byoPolicies = capacity?.apiSourceMode === "byo" ? await getByoUsageStatus(admin, user.id) : null;

  const mediaUsageCount =
    capacity?.mediaModerationAddonActive && aiPeriod ? await getWatchMediaModerationUsage(admin, user.id, aiPeriod.start) : null;

  const enterpriseMediaAllowance =
    capacity?.tier === "enterprise"
      ? ENTERPRISE_MEDIA_ADDON[resolveEnterpriseMediaAddonKey(capacity.apiSourceMode ?? "managed", capacity.enterpriseSlots)].units
      : null;
  const enterpriseMediaUsageCount =
    capacity?.tier === "enterprise" && capacity.enterpriseMediaAddonActive && aiPeriod
      ? await getWatchMediaModerationUsage(admin, user.id, aiPeriod.start)
      : null;

  const isTrial = capacity?.tier === "trial";
  const trialQuotaDay = isTrial ? reactiveQuotaDay(new Date()) : null;
  const trialReactiveUsed =
    isTrial && trialQuotaDay
      ? (await Promise.all(communities.map((c) => getCommunityReactiveQuotaUsage(admin, c.id, trialQuotaDay)))).reduce((a, b) => a + b, 0)
      : null;

  return {
    authenticated: true, capacity, attentionCount: attentionItems.length, communities, watchers, actions7d, actions30d,
    expansionActive: expansion != null, expansionCancelAtPeriodEnd: expansion?.cancelAtPeriodEnd ?? false, gateways,
    aiPeriod, aiUsageLimit, aiUsageCount, byoUsage, byoPolicies, mediaUsageCount, enterpriseMediaAllowance, enterpriseMediaUsageCount, trialReactiveUsed,
  };
}

const EMPTY_TRIAL_STATE: Awaited<ReturnType<typeof getWatchTrialState>> = { status: "telegram_required", startedAt: null, endsAt: null };

export interface PlansPageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  attentionCount: number;
  trial: Awaited<ReturnType<typeof getWatchTrialState>>;
  mediaAddonState: Awaited<ReturnType<typeof getMediaModerationAddonState>> | null;
}

const EMPTY_PLANS_PAGE: PlansPageData = { authenticated: false, capacity: null, attentionCount: 0, trial: EMPTY_TRIAL_STATE, mediaAddonState: null };

export async function getPlansPageData(): Promise<PlansPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_PLANS_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [attentionItems, trial] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    getWatchTrialState(admin, user.id),
  ]);
  const mediaAddonState =
    capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" && capacity.tier !== "byo20"
      ? await getMediaModerationAddonState(admin, user.id, capacity.tier)
      : null;
  return { authenticated: true, capacity, attentionCount: attentionItems.length, trial, mediaAddonState };
}

export interface BillingPageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  attentionCount: number;
  trial: Awaited<ReturnType<typeof getWatchTrialState>>;
  paidPlan: Awaited<ReturnType<typeof getAccountPaidPlan>>;
  history: Awaited<ReturnType<typeof listWatchPaymentHistory>>;
  availableGateways: string[];
  pending: Awaited<ReturnType<typeof getPendingWatchPayment>>;
  creditBalance: Awaited<ReturnType<typeof getInnvilCreditBalance>>;
  creditActivity: Awaited<ReturnType<typeof listInnvilCreditActivity>>;
  expansionActive: boolean;
  expansionCancelAtPeriodEnd: boolean;
}

const EMPTY_BILLING_PAGE: BillingPageData = {
  authenticated: false, capacity: null, attentionCount: 0, trial: EMPTY_TRIAL_STATE, paidPlan: null, history: [], availableGateways: [],
  pending: null, creditBalance: { balanceCents: 0, balanceUsd: 0 }, creditActivity: [], expansionActive: false, expansionCancelAtPeriodEnd: false,
};

export async function getBillingPageData(): Promise<BillingPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_BILLING_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [attentionItems, trial, paidPlan, history, availableGateways, pending, creditBalance, creditActivity, expansion] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    getWatchTrialState(admin, user.id),
    getAccountPaidPlan(admin, user.id),
    listWatchPaymentHistory(),
    listAvailableDirectWatchGateways(),
    getPendingWatchPayment(),
    getInnvilCreditBalance(admin, user.id),
    listInnvilCreditActivity(admin, user.id),
    getCommunityExpansionState(admin, user.id),
  ]);
  return {
    authenticated: true, capacity, attentionCount: attentionItems.length, trial, paidPlan, history, availableGateways, pending,
    creditBalance, creditActivity, expansionActive: expansion != null, expansionCancelAtPeriodEnd: expansion?.cancelAtPeriodEnd ?? false,
  };
}

const EMPTY_NOTIFICATION_PREFS: Awaited<ReturnType<typeof getNotificationPreferences>> = {
  noActiveWatcherEnabled: true, capacityWarningEnabled: true, watcherStatusEnabled: true,
};
const EMPTY_GENERAL_PREFS: Awaited<ReturnType<typeof getAccountPreferences>> = { timezone: "UTC", timeFormat: "24h" };

export interface SettingsPageData {
  authenticated: boolean;
  capacity: AccountCapacity | null;
  attentionCount: number;
  notificationPrefs: Awaited<ReturnType<typeof getNotificationPreferences>>;
  generalPrefs: Awaited<ReturnType<typeof getAccountPreferences>>;
  emailVerified: boolean;
  byoCredentialState: Awaited<ReturnType<typeof getWatchByoCredentialState>> | null;
}

const EMPTY_SETTINGS_PAGE: SettingsPageData = {
  authenticated: false, capacity: null, attentionCount: 0, notificationPrefs: EMPTY_NOTIFICATION_PREFS, generalPrefs: EMPTY_GENERAL_PREFS,
  emailVerified: false, byoCredentialState: null,
};

export async function getSettingsPageData(): Promise<SettingsPageData> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return EMPTY_SETTINGS_PAGE;
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const [attentionItems, notificationPrefs, generalPrefs, userRes] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    getNotificationPreferences(admin, user.id),
    getAccountPreferences(admin, user.id),
    admin.auth.admin.getUserById(user.id),
  ]);
  const emailVerified = Boolean(userRes.data.user?.email_confirmed_at);
  const isByoAccount = (capacity?.tier === "enterprise" && capacity.apiSourceMode === "byo") || capacity?.tier === "byo20";
  const byoCredentialState = isByoAccount ? await getWatchByoCredentialState() : null;
  return { authenticated: true, capacity, attentionCount: attentionItems.length, notificationPrefs, generalPrefs, emailVerified, byoCredentialState };
}

/* ---- Detail-route page-data actions -- `authenticated: true` is a literal
   here (not `boolean`) so the union with `{authenticated:false}` below lets
   the client narrow with a plain `if (!data.authenticated)` check, same as
   every other page above just without a full-shape empty fallback (a detail
   route has nothing sensible to render for "no account" beyond redirecting
   immediately). ---- */

export interface ProjectDetailPageData {
  authenticated: true;
  capacity: AccountCapacity | null;
  attentionCount: number;
  allWatchers: AccountWatcherRow[];
  detail: Awaited<ReturnType<typeof getAccountProjectDetail>>;
  profileResult: Awaited<ReturnType<typeof getAccountProjectProfile>>;
  activity: AccountActivityItem[];
  escalationsResult: Awaited<ReturnType<typeof listProjectEscalations>>;
  moderationReportsResult: Awaited<ReturnType<typeof listProjectModerationReports>>;
}

export async function getProjectDetailPageData(projectId: string): Promise<ProjectDetailPageData | { authenticated: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { authenticated: false };
  const communities = await listAccountCommunities(admin, user.id);
  const allWatchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers: allWatchers });
  const [attentionItems, detail, profileResult, activity, escalationsResult, moderationReportsResult] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers: allWatchers, capacity }),
    getAccountProjectDetail(admin, user.id, projectId, communities),
    getAccountProjectProfile(projectId),
    listAccountActivity(admin, user.id, { projectId, limit: 20 }, communities),
    listProjectEscalations(projectId),
    listProjectModerationReports(projectId),
  ]);
  return {
    authenticated: true, capacity, attentionCount: attentionItems.length, allWatchers, detail, profileResult, activity,
    escalationsResult, moderationReportsResult,
  };
}

export interface CommunityDetailPageData {
  authenticated: true;
  capacity: AccountCapacity | null;
  attentionCount: number;
  community: AccountCommunitySummary | null;
  recentActivity: AccountActivityItem[];
  filteredModeration: AccountActivityItem[];
  presenceResult: Awaited<ReturnType<typeof getCommunityPresenceSchedule>>;
  autoPostEligibility: Awaited<ReturnType<typeof getAutoPostingEligibility>> | null;
}

export async function getCommunityDetailPageData(
  communityId: string, watcherId: string, daysStr: string,
): Promise<CommunityDetailPageData | { authenticated: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { authenticated: false };
  const daysNum = Number(daysStr) || 7;
  const since = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000).toISOString();
  const communities = await listAccountCommunities(admin, user.id);
  const watchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers });
  const community = communities.find((c) => c.id === communityId) ?? null;
  const [attentionItems, recentActivity, filteredModeration, presenceResult] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers, capacity }),
    listAccountActivity(admin, user.id, { communityId, limit: 8 }, communities),
    listAccountActivity(admin, user.id, { communityId, watcherId: watcherId || undefined, since, limit: 100 }, communities),
    getCommunityPresenceSchedule(communityId),
  ]);
  const autoPostEligibility = AUTO_POSTING_ENABLED ? await getAutoPostingEligibility(communityId) : null;
  return {
    authenticated: true, capacity, attentionCount: attentionItems.length, community, recentActivity, filteredModeration,
    presenceResult, autoPostEligibility,
  };
}

export interface WatcherDetailPageData {
  authenticated: true;
  capacity: AccountCapacity | null;
  attentionCount: number;
  communities: AccountCommunitySummary[];
  allWatchers: AccountWatcherRow[];
  projects: AccountProjectRow[];
  detail: Awaited<ReturnType<typeof getAccountWatcherDetail>>;
}

export async function getWatcherDetailPageData(watcherId: string): Promise<WatcherDetailPageData | { authenticated: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { authenticated: false };
  const [communities, projects] = await Promise.all([
    listAccountCommunities(admin, user.id),
    listAccountProjects(admin, user.id),
  ]);
  const allWatchers = await listAccountWatchers(admin, user.id, communities);
  const capacity = await getAccountCapacity(admin, user.id, { communities, watchers: allWatchers });
  const [attentionItems, detail] = await Promise.all([
    listAccountAttentionItems(admin, user.id, { communities, watchers: allWatchers, capacity }),
    getAccountWatcherDetail(admin, user.id, watcherId, { communities, watchers: allWatchers }),
  ]);
  return { authenticated: true, capacity, attentionCount: attentionItems.length, communities, allWatchers, projects, detail };
}
