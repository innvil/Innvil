"use server";

/**
 * Watcher Presence Scheduling (Phase 4.U) — owner-facing CRUD, community +
 * deployment scoped. Ownership resolved via listAccountCommunities (the
 * SAME canonical, cross-account-isolated Community list every other Watch
 * action already reuses) — never a raw unscoped query.
 *
 * These actions NEVER write deployment_presence_state or send a Telegram
 * message themselves — only the cron sweep (presence-runtime.ts) does that,
 * on its own next tick, reading whatever deployment_presence_config now
 * says. Editing config here can never itself trigger an announcement.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { listAccountCommunities, getAccountCapacity } from "@/src/lib/products/watch-runtime";
import { presenceSchedulingEligible } from "@/src/lib/products/watch-plans";
import { computeRecommendedSchedule, DEFAULT_STAGGER_MINUTES } from "@/src/lib/moderator/presence-schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ctxCommunity(communityId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const community = (await listAccountCommunities(admin, user.id)).find((c) => c.id === communityId);
  if (!community) return null;
  return { admin, accountId: user.id, community };
}

async function requireEligible(admin: SupabaseClient, accountId: string): Promise<Result<null> | null> {
  const capacity = await getAccountCapacity(admin, accountId);
  if (!presenceSchedulingEligible(capacity?.tier ?? null)) {
    return { ok: false, error: "Watcher Presence Scheduling isn't included on your current plan." };
  }
  return null;
}

export interface DeploymentPresenceRow {
  deploymentId: string;
  watcherId: string;
  watcherName: string;
  presenceEnabled: boolean;
  orderIndex: number;
  anchorUtc: string | null;
  activeMinutes: number | null;
  cycleMinutes: number | null;
  state: "active" | "away" | null;
  lastTransitionAt: string | null;
}

export interface CommunityPresenceSchedule {
  eligible: boolean;
  mode: "recommended" | "custom";
  staggerMinutes: number;
  coverageStartMinutes: number | null;
  coverageEndMinutes: number | null;
  announceStart: boolean;
  announceReturn: boolean;
  announceEnd: boolean;
  deployments: DeploymentPresenceRow[];
}

interface SettingsRow {
  mode: "recommended" | "custom";
  stagger_minutes: number;
  reference_utc: string | null;
  coverage_start_minutes: number | null;
  coverage_end_minutes: number | null;
  announce_start: boolean;
  announce_return: boolean;
  announce_end: boolean;
}

async function loadSettings(admin: SupabaseClient, communityId: string): Promise<SettingsRow> {
  const { data } = await admin
    .from("community_presence_settings")
    .select("mode, stagger_minutes, reference_utc, coverage_start_minutes, coverage_end_minutes, announce_start, announce_return, announce_end")
    .eq("community_id", communityId)
    .maybeSingle();
  if (data) return data as SettingsRow;
  return {
    mode: "recommended",
    stagger_minutes: DEFAULT_STAGGER_MINUTES,
    reference_utc: null,
    coverage_start_minutes: null,
    coverage_end_minutes: null,
    announce_start: true,
    announce_return: true,
    announce_end: true,
  };
}

export async function getCommunityPresenceSchedule(communityId: string): Promise<Result<CommunityPresenceSchedule>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const capacity = await getAccountCapacity(ctx.admin, ctx.accountId);
  const eligible = presenceSchedulingEligible(capacity?.tier ?? null);
  const settings = await loadSettings(ctx.admin, communityId);

  const deploymentIds = ctx.community.watchers.map((w) => w.deploymentId);
  const [{ data: configRows }, { data: stateRows }] = deploymentIds.length
    ? await Promise.all([
        ctx.admin.from("deployment_presence_config").select("deployment_id, enabled, order_index, anchor_utc, active_minutes, cycle_minutes").in("deployment_id", deploymentIds),
        ctx.admin.from("deployment_presence_state").select("deployment_id, state, last_transition_at").in("deployment_id", deploymentIds),
      ])
    : [{ data: [] as Array<Record<string, unknown>> }, { data: [] as Array<Record<string, unknown>> }];

  const configByDeployment = new Map((configRows ?? []).map((r) => [r.deployment_id as string, r]));
  const stateByDeployment = new Map((stateRows ?? []).map((r) => [r.deployment_id as string, r]));

  const deployments: DeploymentPresenceRow[] = ctx.community.watchers.map((w, idx) => {
    const cfg = configByDeployment.get(w.deploymentId);
    const st = stateByDeployment.get(w.deploymentId);
    return {
      deploymentId: w.deploymentId,
      watcherId: w.watcherId,
      watcherName: w.watcherName,
      presenceEnabled: !!cfg?.enabled,
      orderIndex: (cfg?.order_index as number | undefined) ?? idx,
      anchorUtc: (cfg?.anchor_utc as string | null | undefined) ?? null,
      activeMinutes: (cfg?.active_minutes as number | null | undefined) ?? null,
      cycleMinutes: (cfg?.cycle_minutes as number | null | undefined) ?? null,
      state: (st?.state as "active" | "away" | undefined) ?? null,
      lastTransitionAt: (st?.last_transition_at as string | null | undefined) ?? null,
    };
  });

  return {
    ok: true,
    data: {
      eligible,
      mode: settings.mode,
      staggerMinutes: settings.stagger_minutes,
      coverageStartMinutes: settings.coverage_start_minutes,
      coverageEndMinutes: settings.coverage_end_minutes,
      announceStart: settings.announce_start,
      announceReturn: settings.announce_return,
      announceEnd: settings.announce_end,
      deployments,
    },
  };
}

/** Recomputes {anchorUtc, activeMinutes, cycleMinutes} for every currently
 *  presence-ENABLED deployment in this community, using the Recommended
 *  formula and a fresh `referenceUtc` (this is the ONE place `reference_utc`
 *  is recomputed — never implicitly on an unrelated save). Sets
 *  mode='recommended'. A no-op (still persists mode/stagger) when nothing
 *  is enabled yet — nothing to compute a schedule for. */
export async function resetToRecommendedSchedule(communityId: string, staggerMinutes?: number): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const gate = await requireEligible(ctx.admin, ctx.accountId);
  if (gate) return gate;

  const stagger = staggerMinutes && staggerMinutes > 0 ? Math.round(staggerMinutes) : (await loadSettings(ctx.admin, communityId)).stagger_minutes;
  const referenceUtc = new Date().toISOString();

  const deploymentIds = ctx.community.watchers.map((w) => w.deploymentId);
  const { data: configRows } = deploymentIds.length
    ? await ctx.admin.from("deployment_presence_config").select("deployment_id, enabled, order_index").in("deployment_id", deploymentIds)
    : { data: [] as Array<Record<string, unknown>> };
  const enabledIds = new Set((configRows ?? []).filter((r) => r.enabled).map((r) => r.deployment_id as string));
  const orderById = new Map((configRows ?? []).map((r) => [r.deployment_id as string, r.order_index as number]));

  const participating = ctx.community.watchers.filter((w) => enabledIds.has(w.deploymentId));
  if (participating.length) {
    const schedules = computeRecommendedSchedule(
      participating.map((w, idx) => ({ deploymentId: w.deploymentId, orderIndex: orderById.get(w.deploymentId) ?? idx })),
      stagger,
      referenceUtc
    );
    for (const [deploymentId, cfg] of schedules) {
      await ctx.admin
        .from("deployment_presence_config")
        .update({ anchor_utc: cfg.anchorUtc, active_minutes: cfg.activeMinutes, cycle_minutes: cfg.cycleMinutes, updated_at: new Date().toISOString() })
        .eq("deployment_id", deploymentId);
    }
  }

  await ctx.admin.from("community_presence_settings").upsert(
    { community_id: communityId, mode: "recommended", stagger_minutes: stagger, reference_utc: referenceUtc, updated_at: new Date().toISOString() },
    { onConflict: "community_id" }
  );
  return { ok: true, data: null };
}

/** Enable/disable a single deployment's participation in presence
 *  scheduling. Enabling gives it a real starting schedule immediately
 *  (recomputed alongside every other already-enabled deployment in this
 *  community, via the same Recommended formula, reusing the community's
 *  existing reference_utc when one exists) — never left with a null
 *  config the sweep can't act on. Disabling only flips the flag; every
 *  other stored value is preserved so re-enabling later doesn't lose a
 *  custom configuration. */
export async function setDeploymentPresenceEnabled(communityId: string, deploymentId: string, enabled: boolean): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const owns = ctx.community.watchers.some((w) => w.deploymentId === deploymentId);
  if (!owns) return { ok: false, error: "Deployment not found in this Community." };

  if (!enabled) {
    await ctx.admin.from("deployment_presence_config").upsert(
      { deployment_id: deploymentId, enabled: false, updated_at: new Date().toISOString() },
      { onConflict: "deployment_id" }
    );
    return { ok: true, data: null };
  }

  const gate = await requireEligible(ctx.admin, ctx.accountId);
  if (gate) return gate;

  const settings = await loadSettings(ctx.admin, communityId);
  const referenceUtc = settings.reference_utc ?? new Date().toISOString();

  const deploymentIds = ctx.community.watchers.map((w) => w.deploymentId);
  const { data: configRows } = await ctx.admin.from("deployment_presence_config").select("deployment_id, enabled, order_index").in("deployment_id", deploymentIds);
  const orderById = new Map((configRows ?? []).map((r) => [r.deployment_id as string, r.order_index as number]));
  const alreadyEnabledIds = new Set((configRows ?? []).filter((r) => r.enabled).map((r) => r.deployment_id as string));
  alreadyEnabledIds.add(deploymentId);

  const nextOrderIndex = orderById.has(deploymentId) ? orderById.get(deploymentId)! : ctx.community.watchers.findIndex((w) => w.deploymentId === deploymentId);
  const participating = ctx.community.watchers.filter((w) => alreadyEnabledIds.has(w.deploymentId));
  const schedules = computeRecommendedSchedule(
    participating.map((w) => ({ deploymentId: w.deploymentId, orderIndex: orderById.get(w.deploymentId) ?? nextOrderIndex })),
    settings.stagger_minutes,
    referenceUtc
  );

  for (const [depId, cfg] of schedules) {
    await ctx.admin.from("deployment_presence_config").upsert(
      {
        deployment_id: depId,
        enabled: true,
        order_index: orderById.get(depId) ?? (depId === deploymentId ? nextOrderIndex : 0),
        anchor_utc: cfg.anchorUtc,
        active_minutes: cfg.activeMinutes,
        cycle_minutes: cfg.cycleMinutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deployment_id" }
    );
  }

  await ctx.admin.from("community_presence_settings").upsert(
    { community_id: communityId, mode: settings.mode, stagger_minutes: settings.stagger_minutes, reference_utc: referenceUtc, updated_at: new Date().toISOString() },
    { onConflict: "community_id" }
  );

  return { ok: true, data: null };
}

/** Direct custom override for a single deployment's own schedule — sets
 *  the community's mode to 'custom' (editing one deployment's own timing
 *  IS the definition of leaving the Recommended formula). */
export async function setDeploymentPresenceConfig(
  communityId: string,
  deploymentId: string,
  input: { activeMinutes: number; cycleMinutes: number }
): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const owns = ctx.community.watchers.some((w) => w.deploymentId === deploymentId);
  if (!owns) return { ok: false, error: "Deployment not found in this Community." };
  const gate = await requireEligible(ctx.admin, ctx.accountId);
  if (gate) return gate;

  const activeMinutes = Math.round(input.activeMinutes);
  const cycleMinutes = Math.round(input.cycleMinutes);
  if (!(activeMinutes > 0) || !(cycleMinutes > 0)) return { ok: false, error: "Active and cycle minutes must be positive." };
  if (activeMinutes > cycleMinutes) return { ok: false, error: "Active minutes can't exceed the cycle length." };

  const { data: existing } = await ctx.admin.from("deployment_presence_config").select("anchor_utc").eq("deployment_id", deploymentId).maybeSingle();
  const anchorUtc = (existing?.anchor_utc as string | null) ?? new Date().toISOString();

  await ctx.admin.from("deployment_presence_config").upsert(
    { deployment_id: deploymentId, enabled: true, anchor_utc: anchorUtc, active_minutes: activeMinutes, cycle_minutes: cycleMinutes, updated_at: new Date().toISOString() },
    { onConflict: "deployment_id" }
  );
  await ctx.admin.from("community_presence_settings").upsert(
    { community_id: communityId, mode: "custom", updated_at: new Date().toISOString() },
    { onConflict: "community_id" }
  );
  return { ok: true, data: null };
}

export async function setCommunityPresenceSettings(
  communityId: string,
  input: {
    coverageStartMinutes?: number | null;
    coverageEndMinutes?: number | null;
    announceStart?: boolean;
    announceReturn?: boolean;
    announceEnd?: boolean;
  }
): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const gate = await requireEligible(ctx.admin, ctx.accountId);
  if (gate) return gate;

  const settings = await loadSettings(ctx.admin, communityId);
  await ctx.admin.from("community_presence_settings").upsert(
    {
      community_id: communityId,
      mode: settings.mode,
      stagger_minutes: settings.stagger_minutes,
      reference_utc: settings.reference_utc,
      coverage_start_minutes: input.coverageStartMinutes !== undefined ? input.coverageStartMinutes : settings.coverage_start_minutes,
      coverage_end_minutes: input.coverageEndMinutes !== undefined ? input.coverageEndMinutes : settings.coverage_end_minutes,
      announce_start: input.announceStart ?? settings.announce_start,
      announce_return: input.announceReturn ?? settings.announce_return,
      announce_end: input.announceEnd ?? settings.announce_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "community_id" }
  );
  return { ok: true, data: null };
}
