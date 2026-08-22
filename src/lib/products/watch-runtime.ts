import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModeratorPlanTier } from "@/src/lib/money";
import { MODERATOR_COMMUNITY_CAPACITY, isCommunityExpansionEligibleTier, moderatorEnterpriseIncludedCommunities } from "@/src/lib/money";
import { CAPACITY, communityCountExceeded, checkDeploymentSlotCaps, deploymentSlotCheckErrorMessage } from "@/src/lib/moderator/plan";
import { hasActiveCommunityExpansion } from "./watch-community-expansion";
import { normalizeModeratorPersona, DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "@/src/lib/moderator/domain";
import { projectBelongsToAccount, listAccountProjects } from "./ownership";
import { WATCH_PRODUCT_SLUG } from "./watch";
import { hasActiveWatchTrial, getWatchTrialState, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS } from "./watch-trial";
import { periodHasExpired, type WatchBillingInterval } from "./watch-billing-period";

/**
 * Neutral ownership/creation layer for Communities, Watchers
 * (`virtual_moderators`), and Deployments (`moderator_deployments`) — the
 * next step past `ownership.ts`'s `createStandaloneProject` (which
 * deliberately stopped at Project). A direct Watch account with an active
 * entitlement and NO Panel can create/own all of these directly, per
 * migration 0069.
 *
 * Also the home for the small bridge into the LIVE Telegram runtime
 * (`community-runtime.ts`'s `handleCommunityUpdate`): `virtualMod*(settings)`
 * capability gates throughout `moderator/plan.ts` only ever read
 * `settings.addons.moderator.{tier,commercialMode,trial,...}` (confirmed by
 * reading every one of them, not assumed) — never anything else in
 * `panels.settings`. `buildStandaloneModeratorSettings`/
 * `resolveStandaloneModeratorSettings` synthesize that exact same shape from
 * a direct account's real entitlement, so the ENTIRE existing capability-
 * gating/moderation/chatter/knowledge system runs completely unmodified for
 * a standalone deployment — no second settings/config model was invented.
 *
 * Reuses the EXISTING pure capacity/cap-checking functions from
 * moderator/plan.ts (`CAPACITY`, `TRIAL_CAPACITY`, `communityCountExceeded`,
 * `checkDeploymentSlotCaps`) — never a second capacity model. Direct Watch
 * checkout itself is still paid-only (see watch-checkout.ts) -- there is no
 * $0 checkout flow -- but an account may ALSO hold a free trial entitlement
 * (see watch-trial.ts), resolved through the SAME requireAccountWatchContext
 * every capacity/creation function in this file goes through.
 */

export interface AccountWatchContext {
  ok: true;
  accountId: string;
  /** "trial" and "enterprise" are both real, distinct entitlement SOURCES,
   *  never ModeratorPlanTier values -- "trial" mirrors moderator/plan.ts's
   *  ModeratorEntitlementSource; "enterprise" is Managed Enterprise, a
   *  manually-provisioned, variable-slot entitlement that deliberately
   *  never flows through the fixed CAPACITY/MODERATOR_COMMUNITY_CAPACITY
   *  lookup tables (which have no "enterprise" row) or any self-serve
   *  pricing/discount path (moderatorPlanPrice, Innvil Credit discounts,
   *  Community Expansion) -- those all stay keyed strictly by
   *  ModeratorPlanTier, resolved separately via resolveAccountWatchTier. */
  tier: ModeratorPlanTier | "trial" | "enterprise";
  maxCommunities: number;
  maxActiveSlots: number;
  /** Max SAVED Watcher identities -- distinct from maxActiveSlots (a
   *  Watcher can be saved without being deployed). For trial this is the
   *  canonical TRIAL_MAX_SAVED_MODERATORS (1), not the slot count. */
  maxSavedModerators: number;
}
export type AccountWatchContextResult = AccountWatchContext | { ok: false; error: string };

function parseEntitlementTier(subscriptionRef: string | null): ModeratorPlanTier | null {
  const tier = (subscriptionRef ?? "").split(":")[0];
  if (tier === "basic" || tier === "standard" || tier === "premium" || tier === "pro") return tier;
  return null;
}

/** The account's current paid Watch tier, parsed from `product_entitlements
 *  .subscription_ref` (format `"<tier>:<depositId>"`, set by
 *  `activateWatchEntitlement`). Returns null if the account has no active
 *  direct Watch subscription OR its real billing period (migration 0080)
 *  has ended with no confirmed renewal — never guesses/defaults a tier. A
 *  NULL `current_period_end` (every paid row created before migration
 *  0080) is treated as never-expiring — the deliberate grandfather
 *  compatibility state so no existing paid customer is silently cut off by
 *  this migration; real period enforcement begins on that account's next
 *  successful payment. */
export async function resolveAccountWatchTier(admin: SupabaseClient, accountId: string): Promise<ModeratorPlanTier | null> {
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return null;
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("status, subscription_ref, current_period_end")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  if (!entitlement || entitlement.status !== "active") return null;
  if (periodHasExpired((entitlement.current_period_end as string | null) ?? null)) return null;
  return parseEntitlementTier((entitlement.subscription_ref as string | null) ?? null);
}

export interface AccountEnterpriseEntitlement {
  slots: number;
  currentPeriodEnd: string | null;
  billingInterval: WatchBillingInterval;
}

/** The account's active Managed Enterprise entitlement, if any -- a
 *  SEPARATE resolver from resolveAccountWatchTier (never returned by it;
 *  "enterprise" is not, and must never become, a ModeratorPlanTier value).
 *  Reads the manually-provisioned `enterprise_slots` column (migration
 *  0086) directly rather than encoding the slot count into
 *  `subscription_ref`, so the existing `"<tier>:<ref>"` parsing every
 *  self-serve tier already relies on (parseEntitlementTier) never needs to
 *  change. Same expiry discipline as resolveAccountWatchTier (a NULL
 *  `current_period_end` is grandfathered as never-expiring; a real expired
 *  period returns null, never a stale entitlement). */
async function resolveAccountEnterpriseEntitlement(admin: SupabaseClient, accountId: string): Promise<AccountEnterpriseEntitlement | null> {
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return null;
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("status, subscription_ref, current_period_end, enterprise_slots, billing_interval")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  if (!entitlement || entitlement.status !== "active") return null;
  const refTier = ((entitlement.subscription_ref as string | null) ?? "").split(":")[0];
  if (refTier !== "enterprise") return null;
  const currentPeriodEnd = (entitlement.current_period_end as string | null) ?? null;
  if (periodHasExpired(currentPeriodEnd)) return null;
  const slots = entitlement.enterprise_slots as number | null;
  if (!slots || slots < 1) return null; // a provisioning inconsistency -- never a fabricated slot count
  const billingInterval: WatchBillingInterval = entitlement.billing_interval === "annual" ? "annual" : "monthly";
  return { slots, currentPeriodEnd, billingInterval };
}

export interface AccountPaidPlan {
  tier: ModeratorPlanTier;
  currentPeriodEnd: string | null;
  expired: boolean;
  billingInterval: WatchBillingInterval;
}

/** The account's most-recently-held paid tier, REGARDLESS of whether its
 *  billing period has expired — the counterpart resolver renewal/Billing
 *  surfaces need (resolveAccountWatchTier above intentionally returns null
 *  once expired, which is correct for entitlement/capacity but useless for
 *  "what plan should the Renew button charge for?"). Returns null only
 *  when the account has genuinely never held a direct Watch subscription
 *  at all (no product_entitlements row, or a non-paid subscription_ref). */
export async function getAccountPaidPlan(admin: SupabaseClient, accountId: string): Promise<AccountPaidPlan | null> {
  const { data: product } = await admin.from("products").select("id").eq("slug", WATCH_PRODUCT_SLUG).maybeSingle();
  if (!product) return null;
  const { data: entitlement } = await admin
    .from("product_entitlements")
    .select("subscription_ref, current_period_end, billing_interval")
    .eq("account_id", accountId)
    .eq("product_id", product.id)
    .maybeSingle();
  if (!entitlement) return null;
  const tier = parseEntitlementTier((entitlement.subscription_ref as string | null) ?? null);
  if (!tier) return null;
  const currentPeriodEnd = (entitlement.current_period_end as string | null) ?? null;
  const billingInterval: WatchBillingInterval = entitlement.billing_interval === "annual" ? "annual" : "monthly";
  return { tier, currentPeriodEnd, expired: periodHasExpired(currentPeriodEnd), billingInterval };
}

/** Synthesizes a `panels.settings`-shaped value carrying JUST the Virtual
 *  Moderator entitlement fields `moderator/plan.ts`'s `readModeratorAddon`
 *  actually parses (`settings.addons.moderator.{tier,commercialMode,
 *  since,lastChargeAt,nextChargeAt,lapsed,trial}`) -- every `virtualMod*`
 *  capability check in that file is ultimately a function of this shape
 *  alone. A PAID direct-Watch tier always synthesizes trial: off (a paid
 *  entitlement, never a trial, per moderatorEntitlementSource's own "a paid
 *  tier always supersedes an active trial" rule). */
export function buildStandaloneModeratorSettings(tier: ModeratorPlanTier): unknown {
  return {
    addons: {
      moderator: {
        tier,
        commercialMode: "commission",
        since: null,
        lastChargeAt: null,
        nextChargeAt: null,
        lapsed: false,
        trial: { active: false, startedAt: null, endsAt: null },
      },
    },
  };
}

/** Synthesizes the SAME settings shape for an active direct-Watch trial --
 *  `tier: null` so `moderatorEntitlementSource` resolves to "trial" (not a
 *  paid tier), with the real, DB-sourced start/end timestamps from
 *  watch-trial.ts's `watch_trial_claims`. This is what makes a trial
 *  account's live-deployed Watcher actually process Telegram messages --
 *  the ENTIRE existing trial capability-gating machinery in moderator/plan.ts
 *  (TRIAL_CAPACITY, TRIAL_REACTIVE_DAILY_LIMIT, content-generation exclusion,
 *  etc.) runs completely unmodified, exactly as it already does for the
 *  Panel-distributed trial -- never a second trial-capability implementation. */
function buildStandaloneTrialModeratorSettings(trial: { startedAt: string; endsAt: string }): unknown {
  return {
    addons: {
      moderator: {
        tier: null,
        commercialMode: "commission",
        since: null,
        lastChargeAt: null,
        nextChargeAt: null,
        lapsed: false,
        trial: { active: true, startedAt: trial.startedAt, endsAt: trial.endsAt },
      },
    },
  };
}

/** The account_id owning a Watcher (`virtual_moderators.account_id`), or
 *  null if this Watcher is Panel-owned (or doesn't exist). */
export async function resolveWatcherAccountId(admin: SupabaseClient, virtualModeratorId: string): Promise<string | null> {
  const { data } = await admin.from("virtual_moderators").select("account_id").eq("id", virtualModeratorId).maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

/** Resolves the moderator-capability "settings" blob for a standalone
 *  (Panel-less) integration/deployment -- the standalone counterpart to
 *  reading `panels.settings` for a Panel-backed one. Returns null if the
 *  account has no active Watch entitlement (never fabricates a tier). */
export async function resolveStandaloneModeratorSettings(admin: SupabaseClient, virtualModeratorId: string): Promise<unknown> {
  const accountId = await resolveWatcherAccountId(admin, virtualModeratorId);
  if (!accountId) return null;
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (tier) return buildStandaloneModeratorSettings(tier);
  const trial = await getWatchTrialState(admin, accountId);
  if (trial.status === "active" && trial.startedAt && trial.endsAt) {
    return buildStandaloneTrialModeratorSettings({ startedAt: trial.startedAt, endsAt: trial.endsAt });
  }
  return null;
}

/** Paid entitlement always wins when both exist (a trial customer who
 *  upgrades transitions cleanly to paid capacity -- see resolveAccountWatchTier's
 *  own doc comment and activateWatchEntitlement, which is what makes a paid
 *  tier actually resolve here in the first place). Falls back to an active
 *  trial claim (watch-trial.ts) only when there's no paid tier -- the SAME
 *  canonical resolver every Watcher/Community/Deployment creation path and
 *  getAccountCapacity() below both go through, never a second capacity
 *  model for trial vs. paid. */
async function requireAccountWatchContext(admin: SupabaseClient, accountId: string): Promise<AccountWatchContextResult> {
  const tier = await resolveAccountWatchTier(admin, accountId);
  if (tier) {
    // Community Expansion (Gold/Platinum only, migration 0083) raises
    // effective Community capacity from the included count to the SAME
    // canonical maxWithAddons ceiling already shown on Plans -- never a
    // second/duplicated number, and never checked for an ineligible tier
    // (isCommunityExpansionEligibleTier short-circuits before the DB read).
    const expanded = isCommunityExpansionEligibleTier(tier) && (await hasActiveCommunityExpansion(admin, accountId));
    const maxCommunities = expanded ? MODERATOR_COMMUNITY_CAPACITY[tier].maxWithAddons : CAPACITY[tier].maxCommunities;
    return { ok: true, accountId, tier, maxCommunities, maxActiveSlots: CAPACITY[tier].maxActiveSlots, maxSavedModerators: CAPACITY[tier].maxActiveSlots };
  }
  // Managed Enterprise -- checked before trial (a manually-provisioned
  // Enterprise entitlement is a real paid state, same precedence tier as
  // the self-serve check just above). Never touches CAPACITY/
  // MODERATOR_COMMUNITY_CAPACITY or Community Expansion eligibility --
  // Enterprise capacity is entirely the provisioned slot count + the SAME
  // canonical moderatorEnterpriseIncludedCommunities formula the Plans-page
  // calculator and Panel-side Enterprise sale already use, never a second
  // capacity model.
  const enterprise = await resolveAccountEnterpriseEntitlement(admin, accountId);
  if (enterprise) {
    return {
      ok: true, accountId, tier: "enterprise",
      maxCommunities: moderatorEnterpriseIncludedCommunities(enterprise.slots),
      maxActiveSlots: enterprise.slots,
      maxSavedModerators: enterprise.slots,
    };
  }
  if (await hasActiveWatchTrial(admin, accountId)) {
    return { ok: true, accountId, tier: "trial", maxCommunities: TRIAL_CAPACITY.maxCommunities, maxActiveSlots: TRIAL_CAPACITY.maxActiveSlots, maxSavedModerators: TRIAL_MAX_SAVED_MODERATORS };
  }
  return { ok: false, error: "This account doesn't have an active Innvil Watch subscription." };
}

async function loadOwnedProject(admin: SupabaseClient, accountId: string, projectId: string): Promise<{ id: string; accountId: string } | null> {
  const { data } = await admin.from("projects").select("id, account_id").eq("id", projectId).maybeSingle();
  if (!data) return null;
  const project = { id: data.id as string, accountId: data.account_id as string };
  return projectBelongsToAccount(project, accountId) ? project : null;
}

export interface AccountWatcherRow {
  id: string;
  name: string;
  accountId: string;
  provisioningStatus: string;
  persona: ModeratorPersona;
}
export type CreateResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Creates a Watcher (`virtual_moderators` row) owned directly by the
 *  account -- `panel_id: null`, `account_id` set. A Watcher is owned by the
 *  account directly (not scoped to a specific Project — `virtual_moderators`
 *  has no `project_id`, matching the existing Panel-backed shape where a
 *  moderator belongs to the panel/owner, not to one Project either).
 *  Enforces the SAME saved-moderator ceiling every other Watch surface uses
 *  (`CAPACITY[tier].maxActiveSlots`, matching `moderatorMaxSavedModerators`'s
 *  own paid-tier logic — direct Watch has no trial, so trial's separate
 *  lower ceiling never applies here). */
export async function createAccountWatcher(admin: SupabaseClient, accountId: string, name: string): Promise<CreateResult<AccountWatcherRow>> {
  const ctx = await requireAccountWatchContext(admin, accountId);
  if (!ctx.ok) return ctx;

  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return { ok: false, error: "Give this Watcher a name." };

  const maxSaved = ctx.maxSavedModerators;
  const { count: existingCount } = await admin
    .from("virtual_moderators")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  if ((existingCount ?? 0) >= maxSaved) {
    return { ok: false, error: `You've reached the limit of ${maxSaved} Watcher(s) for your current plan.` };
  }

  // Per explicit product decision, a new Watcher's persona is NEVER
  // silently inherited from the account's configured Moderation Defaults
  // (Settings -> Moderation) -- it starts genuinely unassigned (the plain
  // platform DEFAULT_MODERATOR_PERSONA) and must be explicitly assigned per
  // Watcher (moderatorPersonaIsAssigned in domain.ts is what "assigned"
  // means, and is what the onboarding guide's own assign_moderation stage
  // gates on). Settings -> Moderation Defaults still exists as a suggested
  // starting point offered during that explicit assignment step, but is
  // never auto-applied at creation time.
  const { data, error } = await admin
    .from("virtual_moderators")
    .insert({ account_id: accountId, panel_id: null, name: trimmed, status: "active", persona: DEFAULT_MODERATOR_PERSONA })
    .select("id, name, account_id, provisioning_status, persona")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the Watcher." };
  return { ok: true, data: toWatcherRow(data) };
}

function toWatcherRow(r: Record<string, unknown>): AccountWatcherRow {
  return {
    id: r.id as string,
    name: r.name as string,
    accountId: r.account_id as string,
    provisioningStatus: r.provisioning_status as string,
    persona: normalizeModeratorPersona(r.persona),
  };
}

const WATCHER_ROW_COLUMNS = "id, name, account_id, provisioning_status, persona, created_at";

/** Every Watcher this account can see: directly-owned (`account_id =
 *  accountId`, a native Watch profile) UNION every Watcher reachable via a
 *  deployment into one of this account's own Communities, even when that
 *  Watcher's own row has no `account_id` set (e.g. a Panel-distributed
 *  Watcher -- `account_id` null, `panel_id` set -- deployed into a Community
 *  whose Project now resolves to this account, the "existing Panel-owner
 *  Watch distribution channel" `ownership.ts`'s `hasProductAccess` already
 *  treats as entitled).
 *
 *  `listAccountCommunities` already trusts this exact deployment ->
 *  community -> project -> account chain for every OTHER Watch metric
 *  (capacity, slot breakdown, activity, attention) -- this brings the
 *  Watchers list/detail/count into agreement with those, rather than the
 *  previous narrower "the row's own account_id column must literally match"
 *  filter, which caused a real, live discrepancy: the Watchers page showed
 *  "No Watchers yet" while Overview/Communities/Usage all showed 2 real
 *  deployed Watchers for the same account. */
export async function listAccountWatchers(admin: SupabaseClient, accountId: string): Promise<AccountWatcherRow[]> {
  const [{ data: direct }, communities] = await Promise.all([
    admin.from("virtual_moderators").select(WATCHER_ROW_COLUMNS).eq("account_id", accountId),
    listAccountCommunities(admin, accountId),
  ]);
  const directRows = (direct ?? []) as Array<Record<string, unknown>>;
  const directIds = new Set(directRows.map((r) => r.id as string));
  const reachableIds = new Set(communities.flatMap((c) => c.watchers.map((w) => w.watcherId)));
  const missingIds = Array.from(reachableIds).filter((id) => !directIds.has(id));
  const { data: extra } = missingIds.length
    ? await admin.from("virtual_moderators").select(WATCHER_ROW_COLUMNS).in("id", missingIds)
    : { data: [] as Array<Record<string, unknown>> };
  const merged = [...directRows, ...((extra ?? []) as Array<Record<string, unknown>>)];
  merged.sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  return merged.map((r) => toWatcherRow(r));
}

export interface AccountCommunityInput {
  platform: string;
  chatId: string;
  handle?: string | null;
  title?: string | null;
  chatType?: string | null;
}

/** The only Telegram chat/resource types a Watch Community may represent.
 *  Deliberately excludes "private" -- a private 1:1 chat with a Telegram
 *  USER (including the account holder's own conversation with a Watcher's
 *  bot) is a PERSON, not a Community a Watcher operates in, and must never
 *  become a `communities` row. Checked only when `chatType` is actually
 *  known (never guessed from chat_id sign/shape/username presence, per
 *  explicit instruction) -- the real creation path (`connectAccountCommunity`
 *  in watch-moderator.ts) always supplies Telegram's own trusted `chat.type`
 *  from a verified `getChat` call. */
const SUPPORTED_TELEGRAM_COMMUNITY_CHAT_TYPES = new Set(["group", "supergroup", "channel"]);
export interface AccountCommunityRow {
  id: string;
  projectId: string;
  platform: string;
  chatId: string;
  title: string | null;
}

/** Creates a Community (`communities` row) under a standalone Project --
 *  `panel_id: null`. Takes an already-resolved chat identity (this function
 *  is the DB/ownership layer, not the live Telegram membership-verification
 *  step -- mirrors how `finalizeCommunityConnection` receives an
 *  already-fetched `ChatMembershipResult` rather than calling Telegram
 *  itself). Enforces the same community-count cap every Watch surface uses. */
export async function createAccountCommunity(admin: SupabaseClient, accountId: string, projectId: string, input: AccountCommunityInput): Promise<CreateResult<AccountCommunityRow>> {
  const ctx = await requireAccountWatchContext(admin, accountId);
  if (!ctx.ok) return ctx;
  const project = await loadOwnedProject(admin, accountId, projectId);
  if (!project) return { ok: false, error: "Project not found." };

  const chatId = input.chatId.trim();
  if (!chatId) return { ok: false, error: "Missing chat identity." };

  if (input.platform === "telegram" && input.chatType && !SUPPORTED_TELEGRAM_COMMUNITY_CHAT_TYPES.has(input.chatType)) {
    return { ok: false, error: "This is a personal Telegram account, not a group or channel. Add the Watcher's bot to a Telegram group, supergroup, or channel instead." };
  }

  const maxCommunities = ctx.maxCommunities;
  const { data: existingForChat } = await admin
    .from("communities")
    .select("id, project_id")
    .eq("platform", input.platform)
    .eq("chat_id", chatId)
    .is("panel_id", null)
    .maybeSingle();
  if (existingForChat && existingForChat.project_id !== projectId) {
    return { ok: false, error: "This community is already connected to a different Project." };
  }
  if (!existingForChat) {
    const { data: accountProjects } = await admin.from("projects").select("id").eq("account_id", accountId);
    const projectIds = (accountProjects ?? []).map((p: Record<string, unknown>) => p.id as string);
    // Counts in application code (not a head:true exact count) so a private
    // Telegram chat row never inflates the plan's community cap -- matches
    // listAccountCommunities' own exclusion, kept consistent rather than
    // letting the cap-check drift from what the Communities list actually
    // shows.
    const { data: existingCommunityRows } = projectIds.length
      ? await admin.from("communities").select("id, chat_type").in("project_id", projectIds)
      : { data: [] as Array<{ id: string; chat_type: string | null }> };
    const existingCommunityCount = (existingCommunityRows ?? []).filter((r: { chat_type: string | null }) => r.chat_type !== "private").length;
    if (communityCountExceeded(true, existingCommunityCount, maxCommunities)) {
      return { ok: false, error: `Your plan supports up to ${maxCommunities} communit${maxCommunities === 1 ? "y" : "ies"}. Upgrade your plan to connect another Community.` };
    }
  }

  // NOT an upsert with onConflict -- the only unique constraint that could
  // match (platform, chat_id) for a standalone row is the PARTIAL index
  // idx_communities_standalone_chat (`where panel_id is null`, migration
  // 0069). Postgres requires an ON CONFLICT target to match a partial
  // index's WHERE predicate exactly to use it for inference, and PostgREST's
  // upsert() has no way to express that predicate -- every call here failed
  // with "there is no unique or exclusion constraint matching the ON
  // CONFLICT specification". `existingForChat` (already resolved above,
  // same platform+chat_id+panel_id-is-null scope) is reused directly instead:
  // update by id when it exists, else a plain insert.
  let data: Record<string, unknown> | null = null;
  let error: { message: string; code?: string } | null = null;
  if (existingForChat) {
    const res = await admin
      .from("communities")
      .update({ handle: input.handle ?? null, title: input.title ?? null, chat_type: input.chatType ?? null })
      .eq("id", existingForChat.id)
      .select("id, project_id, platform, chat_id, title")
      .single();
    data = res.data as Record<string, unknown> | null;
    error = res.error;
  } else {
    const res = await admin
      .from("communities")
      .insert({ panel_id: null, project_id: projectId, platform: input.platform, chat_id: chatId, handle: input.handle ?? null, title: input.title ?? null, chat_type: input.chatType ?? null })
      .select("id, project_id, platform, chat_id, title")
      .single();
    data = res.data as Record<string, unknown> | null;
    error = res.error;
    if (error?.code === "23505") {
      // Lost a genuine concurrent-insert race for the same chat -- return the
      // row the winner just created instead of surfacing a raw DB error.
      const retry = await admin
        .from("communities")
        .select("id, project_id, platform, chat_id, title")
        .eq("platform", input.platform)
        .eq("chat_id", chatId)
        .is("panel_id", null)
        .maybeSingle();
      if (retry.data) { data = retry.data as Record<string, unknown>; error = null; }
    }
  }
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the community." };
  return { ok: true, data: { id: data.id as string, projectId: data.project_id as string, platform: data.platform as string, chatId: data.chat_id as string, title: (data.title as string | null) ?? null } };
}

export interface AccountDeploymentRow {
  id: string;
  moderatorId: string;
  communityId: string;
}

/** Deploys a Watcher into a Community — creates/re-enables a
 *  `moderator_deployments` row, `panel_id: null`. Reuses the EXISTING pure
 *  `checkDeploymentSlotCaps` (active-slot limit AND the flat 5-per-community
 *  cap, checked independently) -- the same two-limit logic every other
 *  Watch deployment surface already enforces, not a second copy. */
export async function deployAccountWatcher(admin: SupabaseClient, accountId: string, moderatorId: string, communityId: string, health: Record<string, unknown> = {}): Promise<CreateResult<AccountDeploymentRow>> {
  const ctx = await requireAccountWatchContext(admin, accountId);
  if (!ctx.ok) return ctx;

  const { data: moderator } = await admin.from("virtual_moderators").select("id, account_id").eq("id", moderatorId).maybeSingle();
  if (!moderator || moderator.account_id !== accountId) return { ok: false, error: "Watcher not found." };

  const { data: community } = await admin.from("communities").select("id, project_id, chat_type").eq("id", communityId).maybeSingle();
  if (!community) return { ok: false, error: "Community not found." };
  // A deployment target must be a real Community, never a Telegram person
  // that slipped into `communities` (defense in depth -- createAccountCommunity
  // already blocks this at creation, but this is the second, independent
  // place anything could attempt to target one, so it's checked here too).
  if (community.chat_type === "private") return { ok: false, error: "Community not found." };
  const project = await loadOwnedProject(admin, accountId, community.project_id as string);
  if (!project) return { ok: false, error: "Community not found." };

  const { data: existingDeployment } = await admin
    .from("moderator_deployments")
    .select("id, enabled")
    .eq("moderator_id", moderatorId)
    .eq("community_id", communityId)
    .maybeSingle();

  const maxActiveSlots = ctx.maxActiveSlots;
  const { data: accountModerators } = await admin.from("virtual_moderators").select("id").eq("account_id", accountId);
  const moderatorIds = (accountModerators ?? []).map((m: Record<string, unknown>) => m.id as string);
  const { count: activeSlotCount } = moderatorIds.length
    ? await admin.from("moderator_deployments").select("id", { count: "exact", head: true }).in("moderator_id", moderatorIds).eq("enabled", true)
    : { count: 0 };
  const { count: communityDeploymentCount } = await admin
    .from("moderator_deployments")
    .select("id", { count: "exact", head: true })
    .eq("community_id", communityId)
    .eq("enabled", true);

  const check = checkDeploymentSlotCaps({
    isExistingDeployment: Boolean(existingDeployment?.enabled),
    activeSlotCount: activeSlotCount ?? 0,
    maxActiveSlots,
    communityDeploymentCount: communityDeploymentCount ?? 0,
  });
  if (!check.ok) return { ok: false, error: deploymentSlotCheckErrorMessage(check, maxActiveSlots) };

  const { data, error } = existingDeployment
    ? await admin.from("moderator_deployments").update({ enabled: true, health }).eq("id", existingDeployment.id).select("id, moderator_id, community_id").single()
    : await admin.from("moderator_deployments").insert({ panel_id: null, moderator_id: moderatorId, community_id: communityId, enabled: true, health }).select("id, moderator_id, community_id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not deploy the Watcher." };
  return { ok: true, data: { id: data.id as string, moderatorId: data.moderator_id as string, communityId: data.community_id as string } };
}

export interface DeploymentTenant {
  deploymentId: string;
  moderatorId: string;
  communityId: string;
  projectId: string;
  accountId: string;
  panelId: null;
}

/** Proves the full ownership chain resolves without a Panel: deployment ->
 *  community -> project -> account. Returns null if the deployment (or any
 *  link in the chain) doesn't exist, or if it's actually Panel-backed
 *  (this resolver is specifically for the standalone runtime-context proof
 *  -- a Panel-backed deployment resolves through the existing
 *  panel-scoped path instead, unchanged). */
export async function resolveDeploymentTenant(admin: SupabaseClient, deploymentId: string): Promise<DeploymentTenant | null> {
  const { data: deployment } = await admin.from("moderator_deployments").select("id, moderator_id, community_id, panel_id").eq("id", deploymentId).maybeSingle();
  if (!deployment || deployment.panel_id !== null) return null;

  const { data: community } = await admin.from("communities").select("id, project_id").eq("id", deployment.community_id).maybeSingle();
  if (!community) return null;

  const { data: project } = await admin.from("projects").select("id, account_id").eq("id", community.project_id).maybeSingle();
  if (!project) return null;

  return {
    deploymentId: deployment.id as string,
    moderatorId: deployment.moderator_id as string,
    communityId: deployment.community_id as string,
    projectId: project.id as string,
    accountId: project.account_id as string,
    panelId: null,
  };
}

/* ============================================================
   Dashboard read models — everything the CRM-style Overview needs, built
   entirely from REAL data (no fabricated metrics). Kept in this file since
   it's the same account-scoped ownership boundary as the rest of the
   module — never a second data-access layer.
   ============================================================ */

export interface AccountCommunitySummary {
  id: string;
  projectId: string;
  projectName: string;
  platform: string;
  chatId: string;
  title: string | null;
  watchers: Array<{ deploymentId: string; watcherId: string; watcherName: string; enabled: boolean }>;
}

/** Every Community owned (via Project) by this account, with its assigned
 *  Watchers. Cross-account isolation: only ever queries by this account's
 *  OWN project ids, resolved server-side. */
export async function listAccountCommunities(admin: SupabaseClient, accountId: string): Promise<AccountCommunitySummary[]> {
  const { data: projects } = await admin.from("projects").select("id, name").eq("account_id", accountId);
  const projectRows = (projects ?? []) as Array<{ id: string; name: string }>;
  const projectIds = projectRows.map((p) => p.id);
  const projectNameById = new Map(projectRows.map((p) => [p.id, p.name]));
  if (!projectIds.length) return [];

  const { data: communities } = await admin
    .from("communities")
    .select("id, project_id, platform, chat_id, title, chat_type")
    .in("project_id", projectIds)
    .order("created_at", { ascending: true });
  const allRows = (communities ?? []) as Array<{ id: string; project_id: string; platform: string; chat_id: string; title: string | null; chat_type: string | null }>;
  // Excludes any row deterministically known to be a private Telegram 1:1
  // chat (a PERSON, not a Community) rather than filtering in the UI --
  // this is the single canonical Community query every other metric/table
  // (count, health, needs-attention, entitlement usage, deployment
  // targeting) already builds on, so the fix propagates everywhere at once.
  // Filtered in application code, not `.neq("chat_type", "private")`, since
  // Postgres's three-valued NULL logic would make that DB-level filter
  // silently exclude every NULL-chat_type row too (rows created before this
  // field existed) -- there's no trustworthy signal to classify those either
  // way, and hiding them could destroy a real, valid pre-existing Community.
  const communityRows = allRows.filter((c) => c.chat_type !== "private");
  if (!communityRows.length) return [];

  const communityIds = communityRows.map((c) => c.id);
  const { data: deployments } = await admin
    .from("moderator_deployments")
    .select("id, moderator_id, community_id, enabled")
    .in("community_id", communityIds);
  const deploymentRows = (deployments ?? []) as Array<{ id: string; moderator_id: string; community_id: string; enabled: boolean }>;
  const moderatorIds = Array.from(new Set(deploymentRows.map((d) => d.moderator_id)));
  const { data: moderators } = moderatorIds.length
    ? await admin.from("virtual_moderators").select("id, name").in("id", moderatorIds)
    : { data: [] as Array<{ id: string; name: string }> };
  const moderatorNameById = new Map(((moderators ?? []) as Array<{ id: string; name: string }>).map((m) => [m.id, m.name]));

  return communityRows.map((c) => ({
    id: c.id,
    projectId: c.project_id,
    projectName: projectNameById.get(c.project_id) ?? "Project",
    platform: c.platform,
    chatId: c.chat_id,
    title: c.title,
    watchers: deploymentRows
      .filter((d) => d.community_id === c.id)
      .map((d) => ({ deploymentId: d.id, watcherId: d.moderator_id, watcherName: moderatorNameById.get(d.moderator_id) ?? "Watcher", enabled: d.enabled })),
  }));
}

/** Canonical Watch capacity vocabulary (matches the backend's own
 *  enforcement in checkDeploymentSlotCaps/deployAccountWatcher, never a
 *  separately-invented UI definition):
 *
 *  WATCHER PROFILE  — a reusable Watcher identity/persona (`virtual_
 *                      moderators` row). Creating one does NOT by itself
 *                      consume a Watcher slot.
 *  DEPLOYMENT       — one Watcher assigned to one Community
 *                      (`moderator_deployments` row).
 *  WATCHER SLOT     — one ACTIVE (enabled=true) deployment. The plan's
 *                      slot allowance (`CAPACITY[tier].maxActiveSlots`) is
 *                      checked against the raw count of enabled deployments
 *                      across the account -- NOT the count of distinct
 *                      Watcher profiles -- so the SAME Watcher deployed to
 *                      two Communities consumes TWO slots. A paused
 *                      (enabled=false) deployment consumes zero slots.
 *
 *  Previously `watchersUsed` here was the SAVED WATCHER PROFILE count
 *  compared against the SLOT total -- two different units treated as one
 *  ratio (a real bug: 3 saved profiles with only 1 actually deployed showed
 *  as "3/5" used against a 5-slot plan, when only 1 slot was truly
 *  consumed). `activeDeploymentCount` now matches the backend's own
 *  `activeSlotCount` computation exactly. */
export interface AccountCapacity {
  tier: ModeratorPlanTier | "trial" | "enterprise";
  /** Only set when tier === "trial" -- the real, server-authoritative
   *  expiry every trial UI surface (Plans/Overview/Usage/sidebar) reads for
   *  "time remaining", never a client-computed/decrementing value. */
  trialEndsAt: string | null;
  /** Only set when tier === "trial" -- the real trial start timestamp
   *  (watch_trial_claims.started_at), so a Usage surface can show the real
   *  "Aug 20 – Aug 27" period instead of only a countdown. */
  trialStartedAt: string | null;
  /** Only set for a paid tier -- the real, server-authoritative
   *  current_period_end (migration 0080). Null for a legacy grandfathered
   *  paid row (see resolveAccountWatchTier's own doc comment) -- a genuine
   *  never-expiring state, not a missing value to paper over. */
  paidThrough: string | null;
  /** Only meaningful for a paid tier -- "monthly" for trial/no-entitlement. */
  billingInterval: WatchBillingInterval;
  watcherProfileCount: number;
  activeDeploymentCount: number;
  slotsTotal: number;
  communitiesUsed: number;
  communitiesTotal: number;
  /** True only for a Gold/Platinum tier with an active Community Expansion
   *  add-on -- i.e. `communitiesTotal` already reflects the expanded max. */
  communityExpansionActive: boolean;
  /** Whether the CURRENT tier could even purchase Community Expansion at
   *  all (Gold/Platinum only) -- lets UI show/hide the purchase CTA
   *  without re-deriving eligibility itself. */
  communityExpansionEligible: boolean;
}

/** Real capacity/usage against the account's actual entitlement -- paid tier
 *  (canonical CAPACITY table) OR an active trial (canonical TRIAL_CAPACITY),
 *  resolved through the SAME requireAccountWatchContext every Watcher/
 *  Community/Deployment creation path already uses, never a second/duplicated
 *  capacity model for trial vs. paid. Returns null when there's no active
 *  entitlement at all (nothing to show a capacity panel for). */
export async function getAccountCapacity(admin: SupabaseClient, accountId: string): Promise<AccountCapacity | null> {
  const ctx = await requireAccountWatchContext(admin, accountId);
  if (!ctx.ok) return null;
  const isSelfServeTier = ctx.tier !== "trial" && ctx.tier !== "enterprise";
  const [watchers, communities, trial, paidPlan, enterprise] = await Promise.all([
    listAccountWatchers(admin, accountId),
    listAccountCommunities(admin, accountId),
    ctx.tier === "trial" ? getWatchTrialState(admin, accountId) : Promise.resolve(null),
    isSelfServeTier ? getAccountPaidPlan(admin, accountId) : Promise.resolve(null),
    // A small extra query, mirroring the existing tier/getAccountPaidPlan
    // split above -- requireAccountWatchContext already resolved enough to
    // know it's "enterprise", but not the real period/billing-interval
    // detail, which only this richer resolver carries.
    ctx.tier === "enterprise" ? resolveAccountEnterpriseEntitlement(admin, accountId) : Promise.resolve(null),
  ]);
  // Community Expansion is a self-serve Gold/Platinum add-on ONLY --
  // structurally excluded for both trial and enterprise (isCommunity
  // ExpansionEligibleTier only accepts a real ModeratorPlanTier, so this
  // guard is what makes that a compile-time guarantee, not just a runtime
  // one -- neither "trial" nor "enterprise" can reach it even by accident).
  const eligible = ctx.tier !== "trial" && ctx.tier !== "enterprise" && isCommunityExpansionEligibleTier(ctx.tier);
  // Derived without a second DB read: requireAccountWatchContext already
  // resolved maxCommunities against the expanded ceiling when the add-on is
  // active -- if it differs from the tier's plain included count, expansion
  // is on. (Never true for trial/enterprise/ineligible tiers, whose
  // included count IS their ceiling.)
  const communityExpansionActive =
    eligible && ctx.tier !== "trial" && ctx.tier !== "enterprise" && ctx.maxCommunities > CAPACITY[ctx.tier].maxCommunities;
  return {
    tier: ctx.tier,
    trialEndsAt: trial?.endsAt ?? null,
    trialStartedAt: trial?.startedAt ?? null,
    paidThrough: paidPlan?.currentPeriodEnd ?? enterprise?.currentPeriodEnd ?? null,
    billingInterval: paidPlan?.billingInterval ?? enterprise?.billingInterval ?? "monthly",
    watcherProfileCount: watchers.length,
    activeDeploymentCount: communities.flatMap((c) => c.watchers.filter((w) => w.enabled)).length,
    slotsTotal: ctx.maxActiveSlots,
    communitiesUsed: communities.length,
    communitiesTotal: ctx.maxCommunities,
    communityExpansionActive,
    communityExpansionEligible: eligible,
  };
}

/** Pure decision: what a Watcher's provisioning_status should resolve to
 *  once it has a live Telegram credential again (initial connect OR a
 *  reconnect after disconnect) -- "active" when it already has real
 *  `moderator_deployments` records (those existing deployments are what
 *  becomes operational again, never a new one), "bot_ready" when it has
 *  none yet. Kept here (not inline in the "use server" watch-moderator.ts
 *  action file, whose every export must be async) so it's directly
 *  unit-testable. */
export function nextProvisioningStatusAfterConnect(deploymentCount: number): "active" | "bot_ready" {
  return deploymentCount > 0 ? "active" : "bot_ready";
}

export interface SlotBreakdownByWatcher {
  watcherId: string;
  watcherName: string;
  deployments: number;
  slots: number;
}
export interface SlotBreakdownByCommunity {
  communityId: string;
  communityTitle: string;
  deployments: number;
  slots: number;
}
export interface AccountSlotBreakdown {
  byWatcher: SlotBreakdownByWatcher[];
  byCommunity: SlotBreakdownByCommunity[];
}

/** "Which Watchers/Communities are actually consuming Watcher slots?" --
 *  built from the SAME `listAccountCommunities` data every other capacity
 *  metric already reads (never a second query shape). Deployments and slots
 *  are the same number here (one active deployment = one slot, per the
 *  canonical definition above) -- both are exposed so the Usage page can
 *  show either label without the caller needing to know they're identical.
 *  Only ENABLED deployments count -- a paused deployment consumes zero
 *  slots, matching the backend's own enforcement exactly. */
export async function getAccountSlotBreakdown(admin: SupabaseClient, accountId: string): Promise<AccountSlotBreakdown> {
  const communities = await listAccountCommunities(admin, accountId);
  const byWatcher = new Map<string, SlotBreakdownByWatcher>();
  const byCommunity: SlotBreakdownByCommunity[] = [];
  for (const c of communities) {
    const activeHere = c.watchers.filter((w) => w.enabled);
    if (activeHere.length > 0) {
      byCommunity.push({ communityId: c.id, communityTitle: c.title ?? c.chatId, deployments: activeHere.length, slots: activeHere.length });
    }
    for (const w of activeHere) {
      const existing = byWatcher.get(w.watcherId);
      if (existing) { existing.deployments += 1; existing.slots += 1; }
      else byWatcher.set(w.watcherId, { watcherId: w.watcherId, watcherName: w.watcherName, deployments: 1, slots: 1 });
    }
  }
  return { byWatcher: Array.from(byWatcher.values()), byCommunity };
}

export interface AccountActivityItem {
  id: string;
  createdAt: string;
  communityId: string;
  communityTitle: string;
  watcherId: string | null;
  watcherName: string | null;
  description: string;
  kind: "moderation" | "media" | "info";
}

const DECISION_DESCRIPTIONS: Record<string, { text: string; kind: AccountActivityItem["kind"] }> = {
  DELETE_WARN: { text: "warned a member for a policy violation", kind: "moderation" },
  DELETE_BAN: { text: "removed a member for a policy violation", kind: "moderation" },
  DELETE_KICK: { text: "removed a repeat offender", kind: "moderation" },
};

/** Recent, customer-facing-translated activity across every Community this
 *  account owns — sourced from `moderator_activity_log`, scoped by THIS
 *  account's own community ids (never a client-supplied filter). Only
 *  surfaces genuinely meaningful moderation events (never raw internal
 *  event/decision codes like "human_message"/"SILENCE"/"GENERATION_STARTED"),
 *  per the explicit "translate into operational descriptions" requirement —
 *  everything else (routine silence/generation bookkeeping) is intentionally
 *  omitted, not because it's hidden, but because it's not a customer-facing
 *  operational event. */
export interface ListAccountActivityOptions {
  limit?: number;
  /** Restrict to a single Community (Community detail's own Activity/Moderation tab). */
  communityId?: string;
  /** Restrict to a single Project (Project detail's own Activity tab). */
  projectId?: string;
  /** Restrict to a single Watcher's own deployments across every Community. */
  watcherId?: string;
  /** Restrict to one activity kind (e.g. the Activity explorer's kind filter). */
  kind?: AccountActivityItem["kind"];
  /** Only events at/after this ISO timestamp (e.g. a "last 7 days" filter). */
  since?: string;
}

export async function listAccountActivity(admin: SupabaseClient, accountId: string, opts: ListAccountActivityOptions = {}): Promise<AccountActivityItem[]> {
  const limit = opts.limit ?? 15;
  const communities = await listAccountCommunities(admin, accountId);
  if (!communities.length) return [];
  let scoped = communities;
  if (opts.communityId) scoped = scoped.filter((c) => c.id === opts.communityId);
  if (opts.projectId) scoped = scoped.filter((c) => c.projectId === opts.projectId);
  if (opts.watcherId) scoped = scoped.filter((c) => c.watchers.some((w) => w.watcherId === opts.watcherId));
  if (!scoped.length) return [];
  const communityIds = scoped.map((c) => c.id);
  const communityById = new Map(scoped.map((c) => [c.id, c]));
  const deploymentIdsForWatcher = opts.watcherId
    ? new Set(scoped.flatMap((c) => c.watchers.filter((w) => w.watcherId === opts.watcherId).map((w) => w.deploymentId)))
    : null;

  let query = admin
    .from("moderator_activity_log")
    .select("id, community_id, deployment_id, event_type, decision, created_at")
    .in("community_id", communityIds)
    .in("event_type", ["link_moderation", "media_moderation"])
    .order("created_at", { ascending: false })
    .limit(limit * 3); // over-fetch since most rows get filtered out below (ALLOW/SKIPPED aren't shown)
  if (opts.since) query = query.gte("created_at", opts.since);
  const { data: rows } = await query;

  const items: AccountActivityItem[] = [];
  for (const r of (rows ?? []) as Array<{ id: string; community_id: string; deployment_id: string | null; event_type: string; decision: string; created_at: string }>) {
    const known = DECISION_DESCRIPTIONS[r.decision];
    if (!known) continue; // ALLOW / SKIPPED / etc. -- not a customer-facing operational event
    if (opts.kind && known.kind !== opts.kind) continue;
    if (deploymentIdsForWatcher && !deploymentIdsForWatcher.has(r.deployment_id ?? "")) continue;
    const community = communityById.get(r.community_id);
    const watcher = community?.watchers.find((w) => w.deploymentId === r.deployment_id);
    items.push({
      id: String(r.id),
      createdAt: r.created_at,
      communityId: r.community_id,
      communityTitle: community?.title ?? "Community",
      watcherId: watcher?.watcherId ?? null,
      watcherName: watcher?.watcherName ?? null,
      description: known.text,
      kind: known.kind,
    });
    if (items.length >= limit) break;
  }
  return items;
}

export interface ActivityTrendPoint {
  /** UTC calendar date, "YYYY-MM-DD" -- matches this codebase's existing
   *  UTC-day bucketing convention (e.g. community_reactive_quota). */
  date: string;
  count: number;
}

export interface ActivityTrendOptions {
  /** Number of daily buckets ending today (UTC), inclusive. */
  days: number;
  communityId?: string;
  projectId?: string;
  watcherId?: string;
}

/** Daily-bucketed count of the SAME real, persisted moderation events
 *  `listAccountActivity` surfaces -- built from the identical scoping model
 *  (community/project/watcher filters resolved via `listAccountCommunities`,
 *  never a second incompatible query shape) so the Activity graph can never
 *  disagree with the Activity event list it sits above. Every requested day
 *  is present in the result, including zero-count days -- a real gap in
 *  activity is genuine information, never silently omitted. */
export async function getAccountActivityTrend(admin: SupabaseClient, accountId: string, opts: ActivityTrendOptions): Promise<ActivityTrendPoint[]> {
  const days = Math.max(1, Math.floor(opts.days));
  const communities = await listAccountCommunities(admin, accountId);
  let scoped = communities;
  if (opts.communityId) scoped = scoped.filter((c) => c.id === opts.communityId);
  if (opts.projectId) scoped = scoped.filter((c) => c.projectId === opts.projectId);
  if (opts.watcherId) scoped = scoped.filter((c) => c.watchers.some((w) => w.watcherId === opts.watcherId));

  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  startDate.setUTCHours(0, 0, 0, 0);

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  if (!scoped.length) return Array.from(buckets, ([date, count]) => ({ date, count }));

  const communityIds = scoped.map((c) => c.id);
  const deploymentIdsForWatcher = opts.watcherId
    ? new Set(scoped.flatMap((c) => c.watchers.filter((w) => w.watcherId === opts.watcherId).map((w) => w.deploymentId)))
    : null;

  const { data: rows } = await admin
    .from("moderator_activity_log")
    .select("community_id, deployment_id, decision, created_at")
    .in("community_id", communityIds)
    .in("decision", Object.keys(DECISION_DESCRIPTIONS))
    .gte("created_at", startDate.toISOString());

  for (const r of (rows ?? []) as Array<{ community_id: string; deployment_id: string | null; decision: string; created_at: string }>) {
    if (deploymentIdsForWatcher && !deploymentIdsForWatcher.has(r.deployment_id ?? "")) continue;
    const day = r.created_at.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return Array.from(buckets, ([date, count]) => ({ date, count }));
}

/** True count of meaningful moderation actions (the same DELETE_WARN/
 *  DELETE_BAN/DELETE_KICK events `listAccountActivity` translates) in the
 *  last 7 days, across every Community this account owns -- a real
 *  `count: "exact"` query, not derived from the (possibly-truncated)
 *  activity feed list, so the stat card number is always accurate even
 *  when there's more history than the feed displays. */
export async function countRecentModerationActions(admin: SupabaseClient, accountId: string, days = 7): Promise<number> {
  const communities = await listAccountCommunities(admin, accountId);
  if (!communities.length) return 0;
  const communityIds = communities.map((c) => c.id);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("moderator_activity_log")
    .select("id", { count: "exact", head: true })
    .in("community_id", communityIds)
    .in("decision", Object.keys(DECISION_DESCRIPTIONS))
    .gte("created_at", since);
  return count ?? 0;
}

// communityOperationalStatus/CommunityOperationalStatus live in the
// client-safe watch-status.ts (this module has `import "server-only"` and
// can't be imported from a "use client" component) -- re-exported here so
// existing server-side imports from watch-runtime.ts keep working unchanged.
export { communityOperationalStatus, type CommunityOperationalStatus } from "./watch-status";

export interface CommunityOperationalStats {
  lastActivityAt: string | null;
  moderationCount24h: number;
}

/** Per-Community "last activity" + "moderation actions in the last 24h" for
 *  the Community Health table -- ONE grouped query over the same
 *  `moderator_activity_log` table `listAccountActivity`/
 *  `countRecentModerationActions` already read, reduced client-side per
 *  community rather than N per-community queries. "Last activity" is the
 *  most recent recorded MODERATION event (the only event stream this
 *  codebase persists today) -- honestly reflects what's actually tracked,
 *  never a fabricated "online since" signal. */
export async function getCommunityOperationalStats(admin: SupabaseClient, accountId: string): Promise<Map<string, CommunityOperationalStats>> {
  const communities = await listAccountCommunities(admin, accountId);
  const stats = new Map<string, CommunityOperationalStats>();
  if (!communities.length) return stats;
  const communityIds = communities.map((c) => c.id);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows } = await admin
    .from("moderator_activity_log")
    .select("community_id, decision, created_at")
    .in("community_id", communityIds)
    .in("decision", Object.keys(DECISION_DESCRIPTIONS))
    .order("created_at", { ascending: false })
    .limit(2000);

  for (const c of communities) stats.set(c.id, { lastActivityAt: null, moderationCount24h: 0 });
  for (const r of (rows ?? []) as Array<{ community_id: string; decision: string; created_at: string }>) {
    const entry = stats.get(r.community_id);
    if (!entry) continue;
    if (!entry.lastActivityAt || r.created_at > entry.lastActivityAt) entry.lastActivityAt = r.created_at;
    if (r.created_at >= since) entry.moderationCount24h += 1;
  }
  return stats;
}

/* ============================================================
   Detail-page read models — Projects/Communities/Watchers world. Each
   reuses the SAME list functions above (never a second query shape), just
   scoped down to one resource, so a detail page can never disagree with
   its own list page about what's real.
   ============================================================ */

export interface AccountProjectDetail {
  id: string;
  name: string;
  panelId: string | null;
  communities: AccountCommunitySummary[];
  watcherCount: number;
}

/** A single Project this account owns, with its Communities -- null if it
 *  doesn't exist or belongs to a different account (never trusts a
 *  client-supplied id beyond using it as a lookup key). */
export async function getAccountProjectDetail(admin: SupabaseClient, accountId: string, projectId: string): Promise<AccountProjectDetail | null> {
  const projects = await listAccountProjects(admin, accountId);
  const project = projects.find((p) => p.id === projectId);
  if (!project) return null;
  const communities = (await listAccountCommunities(admin, accountId)).filter((c) => c.projectId === projectId);
  const watcherCount = new Set(communities.flatMap((c) => c.watchers.map((w) => w.watcherId))).size;
  return { id: project.id, name: project.name, panelId: project.panelId, communities, watcherCount };
}

export interface AccountCommunityDetail extends AccountCommunitySummary {
  activity: AccountActivityItem[];
}

/** A single Community this account owns (via its Project), with recent
 *  activity scoped to just this Community. */
export async function getAccountCommunityDetail(admin: SupabaseClient, accountId: string, communityId: string): Promise<AccountCommunityDetail | null> {
  const community = (await listAccountCommunities(admin, accountId)).find((c) => c.id === communityId);
  if (!community) return null;
  const activity = await listAccountActivity(admin, accountId, { communityId, limit: 30 });
  return { ...community, activity };
}

export interface AccountWatcherDetail extends AccountWatcherRow {
  deployments: Array<{ deploymentId: string; communityId: string; communityTitle: string; projectName: string; enabled: boolean }>;
  activity: AccountActivityItem[];
}

/** A single Watcher this account owns directly, with every Community it's
 *  deployed to and its own recent activity. */
export async function getAccountWatcherDetail(admin: SupabaseClient, accountId: string, watcherId: string): Promise<AccountWatcherDetail | null> {
  const watcher = (await listAccountWatchers(admin, accountId)).find((w) => w.id === watcherId);
  if (!watcher) return null;
  const communities = await listAccountCommunities(admin, accountId);
  const deployments = communities.flatMap((c) =>
    c.watchers.filter((w) => w.watcherId === watcherId).map((w) => ({ deploymentId: w.deploymentId, communityId: c.id, communityTitle: c.title ?? c.chatId, projectName: c.projectName, enabled: w.enabled }))
  );
  const activity = await listAccountActivity(admin, accountId, { watcherId, limit: 30 });
  return { ...watcher, deployments, activity };
}

export type AttentionSeverity = "high" | "medium" | "low";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  text: string;
  href: string;
  actionLabel: string;
}

/** Being AT full plan capacity (used === total) is a normal, healthy, fully
 *  expected state -- a customer using everything they paid for is not a
 *  problem, and treating it as one reads as an upsell nudge dressed up as an
 *  operational warning (explicit product decision, 2026-08-20). The only
 *  capacity-related condition that's genuinely attention-worthy is usage
 *  EXCEEDING the current entitlement's limit -- a real inconsistency (e.g. a
 *  downgrade left more Communities connected than the new plan allows;
 *  resources are never deleted on downgrade, see watch-runtime.ts's existing
 *  "preserve resources" convention), never a normal outcome of server-side
 *  enforcement, which already caps creation at the limit
 *  (`checkDeploymentSlotCaps`/`communityCountExceeded`). Plan-agnostic by
 *  construction -- a plain `used > total` comparison, no plan-name branches. */
function capacityExceedsLimit(used: number, total: number): boolean {
  return total > 0 && used > total;
}

/** A genuinely actionable "needs attention" list -- every item is computed
 *  from real, already-queryable state (no stored notification system, no
 *  invented health scores) and carries a real destination + action label so
 *  it's a worklist, not a passive warning. Severity is a fixed, deterministic
 *  mapping per condition (never a fabricated composite score):
 *
 *  HIGH   — a Community has no ACTIVE Watcher at all (nothing is moderating it)
 *  MEDIUM — Watcher or Community usage EXCEEDS the plan's limit (a genuine
 *           inconsistency, e.g. post-downgrade) -- never merely AT/near the
 *           limit, which is a normal, healthy, fully-utilized state
 *  LOW    — a Watcher is deployed but every one of its deployments is paused,
 *           or a Watcher exists but isn't deployed anywhere yet
 *
 *  Conditions NOT included because this codebase doesn't persist the
 *  underlying signal yet (documented, not silently faked): Telegram
 *  connection/permission failures (`moderator_deployments.health` is
 *  recorded at connect-time but not re-checked live), failed Auto-Posts (no
 *  account-scoped Auto-Posting exists), media-allowance nearing limit (no
 *  media-usage metering exists), and payment/entitlement issues beyond "no
 *  active plan" (this list is only ever reached by an already-entitled
 *  account, since the whole dashboard is gated on that). */
export async function listAccountAttentionItems(admin: SupabaseClient, accountId: string): Promise<AttentionItem[]> {
  const [communities, watchers, capacity] = await Promise.all([
    listAccountCommunities(admin, accountId),
    listAccountWatchers(admin, accountId),
    getAccountCapacity(admin, accountId),
  ]);
  const items: AttentionItem[] = [];

  for (const c of communities) {
    if (!c.watchers.some((w) => w.enabled)) {
      items.push({
        id: `community-${c.id}`,
        severity: "high",
        text: `${c.title ?? c.chatId} has no active Watcher`,
        href: `/communities/${c.id}`,
        actionLabel: "Deploy a Watcher",
      });
    }
  }

  if (capacity) {
    if (capacityExceedsLimit(capacity.activeDeploymentCount, capacity.slotsTotal)) {
      items.push({
        id: "capacity-watchers",
        severity: "medium",
        text: `Watcher slot usage (${capacity.activeDeploymentCount}) exceeds your current plan's limit (${capacity.slotsTotal})`,
        href: "/usage",
        actionLabel: "Review usage",
      });
    }
    if (capacityExceedsLimit(capacity.communitiesUsed, capacity.communitiesTotal)) {
      items.push({
        id: "capacity-communities",
        severity: "medium",
        text: `Community usage (${capacity.communitiesUsed}) exceeds your current plan's limit (${capacity.communitiesTotal})`,
        href: "/usage",
        actionLabel: "Review usage",
      });
    }
  }

  const deployedAnyWatcherIds = new Set(communities.flatMap((c) => c.watchers.map((w) => w.watcherId)));
  const deployedActiveWatcherIds = new Set(communities.flatMap((c) => c.watchers.filter((w) => w.enabled).map((w) => w.watcherId)));
  for (const w of watchers) {
    if (!deployedAnyWatcherIds.has(w.id)) {
      items.push({
        id: `watcher-undeployed-${w.id}`,
        severity: "low",
        text: `${w.name} isn't deployed to a community yet`,
        href: `/watchers/${w.id}`,
        actionLabel: "Connect a community",
      });
    } else if (!deployedActiveWatcherIds.has(w.id)) {
      items.push({
        id: `watcher-paused-${w.id}`,
        severity: "low",
        text: `${w.name} is paused`,
        href: `/watchers/${w.id}`,
        actionLabel: "Review Watcher",
      });
    }
  }

  const rank: Record<AttentionSeverity, number> = { high: 0, medium: 1, low: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
