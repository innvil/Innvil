import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { normalizeModeratorPersona, type ModeratorPersona } from "./domain";
import { presenceAt, applyCoverageWindow, type PresenceConfig } from "./presence-schedule";
import { generatePresenceMessage, type PresenceTransitionKind } from "./presence-generate";
import { resolveDeploymentTenant, getAccountCapacity, resolveAccountAiRouting } from "@/src/lib/products/watch-runtime";
import { presenceSchedulingEligible } from "@/src/lib/products/watch-plans";

/**
 * Watcher Presence Scheduling (Phase 4.U) — the cron-driven sweep. Every
 * enabled deployment's resolved {anchorUtc, activeMinutes, cycleMinutes} is
 * evaluated against `now` via the pure presenceAt()/applyCoverageWindow()
 * functions; a genuine active<->away flip (compared against the PERSISTED
 * state, never re-derived from intervalKey alone) is a real transition —
 * claimed via a compare-and-swap so two concurrent sweep invocations can
 * never both announce the same transition. A delayed/missed sweep
 * reconciles straight to the CURRENT computed state (presenceAt is a pure
 * function of `now`, not of historical progression), never replaying every
 * intermediate transition it missed.
 *
 * TESTING: the pure scheduling math (presenceAt/computeRecommendedSchedule)
 * lives in presence-schedule.ts and is directly, thoroughly unit-tested
 * there. `transitionKindFor`/`localMinutesOfDay`/`claimPresenceTransition`
 * are exported and directly tested (presence-runtime.test.ts) — the last
 * one specifically proves the hard idempotency/compare-and-swap
 * requirement. `sweepPresenceSchedules` itself is a full DB-mocked
 * orchestrator of comparable complexity to `runAutoPostSweep`/
 * `handleCommunityUpdate`, both of which this codebase already verifies
 * via typecheck + build + code review only (no full DB-mocked orchestrator
 * test exists for either) — the same established convention applies here,
 * since resolveDeploymentTenant/getAccountCapacity are themselves already
 * fully covered in watch-runtime.test.ts.
 *
 * HARD SCOPE BOUNDARY (explicit product decision, see the spec/plan): this
 * sweep controls ONLY the scheduled arrival/departure announcement
 * messages. It has zero effect on core safety/scam/phishing moderation
 * (runLinkModeration/runMediaModeration) or on Natural Chatter's reactive
 * candidate selection (findChatterDeployments) — neither of those is
 * imported or touched anywhere in this file.
 */

interface PresenceConfigRow {
  deployment_id: string;
  anchor_utc: string | null;
  active_minutes: number | null;
  cycle_minutes: number | null;
}

interface CommunitySettingsRow {
  community_id: string;
  coverage_start_minutes: number | null;
  coverage_end_minutes: number | null;
  announce_start: boolean;
  announce_return: boolean;
  announce_end: boolean;
}

const DEFAULT_SETTINGS: Omit<CommunitySettingsRow, "community_id"> = {
  coverage_start_minutes: null,
  coverage_end_minutes: null,
  announce_start: true,
  announce_return: true,
  announce_end: true,
};

async function loadModeratorBotToken(
  admin: SupabaseClient,
  deploymentId: string
): Promise<{ token: string; chatId: string; moderatorName: string; persona: ModeratorPersona } | null> {
  const { data: deployment } = await admin.from("moderator_deployments").select("id, moderator_id, community_id, enabled").eq("id", deploymentId).maybeSingle();
  if (!deployment || !deployment.enabled) return null;
  const { data: moderator } = await admin.from("virtual_moderators").select("id, name, persona").eq("id", deployment.moderator_id).maybeSingle();
  if (!moderator) return null;
  const { data: community } = await admin.from("communities").select("chat_id").eq("id", deployment.community_id).maybeSingle();
  if (!community) return null;
  const { data: integration } = await admin.from("telegram_bot_integrations").select("id").eq("virtual_moderator_id", moderator.id).maybeSingle();
  if (!integration) return null;
  const { data: tokenData } = await admin.rpc("get_telegram_bot_key", { p_row: integration.id, p_secret: providerKeySecret() });
  const token = tokenData as string | null;
  if (!token) return null;
  return { token, chatId: community.chat_id as string, moderatorName: moderator.name as string, persona: normalizeModeratorPersona(moderator.persona) };
}

/** Local minutes-of-day for `now` in a given IANA timezone (0-1439), or
 *  null for an unresolvable timezone — matches autopost.ts's own hour-24
 *  normalization (some ICU implementations report midnight as hour "24"). */
export function localMinutesOfDay(now: Date, timezone: string): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour12: false, hour: "2-digit", minute: "2-digit" });
    const parts = fmt.formatToParts(now).reduce((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);
    const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
    return hour * 60 + Number(parts.minute);
  } catch {
    return null;
  }
}

export function transitionKindFor(priorState: "active" | "away" | null, nextState: "active" | "away"): PresenceTransitionKind | null {
  if (priorState === nextState) return null;
  if (priorState === null) {
    // No persisted row yet -- "no row" already represents "away" by
    // convention (a row is only ever lazily created on the FIRST genuine
    // transition to active, see claimPresenceTransition). A brand-new
    // deployment computing "away" right now has never been active, so
    // there's nothing to end -- correctly a no-op, not presence_ending.
    return nextState === "active" ? "presence_started" : null;
  }
  return nextState === "away" ? "presence_ending" : "presence_resumed";
}

/** Compare-and-swap claim on the persisted state — a duplicate/concurrent
 *  sweep invocation can only ever win this race once per real transition. */
export async function claimPresenceTransition(
  admin: SupabaseClient,
  deploymentId: string,
  priorState: "active" | "away" | null,
  nextState: "active" | "away",
  intervalKey: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  if (priorState === null) {
    const { error } = await admin.from("deployment_presence_state").insert({
      deployment_id: deploymentId,
      state: nextState,
      current_interval_key: intervalKey,
      last_transition_at: nowIso,
      updated_at: nowIso,
    });
    return !error;
  }
  const { data } = await admin
    .from("deployment_presence_state")
    .update({ state: nextState, current_interval_key: intervalKey, last_transition_at: nowIso, updated_at: nowIso })
    .eq("deployment_id", deploymentId)
    .eq("state", priorState)
    .select("deployment_id")
    .maybeSingle();
  return !!data;
}

async function logPresenceActivity(
  admin: SupabaseClient,
  communityId: string,
  deploymentId: string,
  decision: PresenceTransitionKind,
  meta: Record<string, unknown>
) {
  await admin.from("moderator_activity_log").insert({
    panel_id: null,
    community_id: communityId,
    deployment_id: deploymentId,
    event_type: "presence",
    decision,
    reason_code: "scheduled",
    meta: { scheduled: true, ...meta },
  });
}

export async function sweepPresenceSchedules(admin: SupabaseClient = createAdminClient(), now: Date = new Date()): Promise<{ ok: true }> {
  const { data: configRows } = await admin
    .from("deployment_presence_config")
    .select("deployment_id, anchor_utc, active_minutes, cycle_minutes")
    .eq("enabled", true);
  const configs = (configRows ?? []) as PresenceConfigRow[];
  if (!configs.length) return { ok: true };

  const settingsCache = new Map<string, CommunitySettingsRow>();
  const timezoneCache = new Map<string, string>();

  for (const row of configs) {
    if (!row.anchor_utc || row.active_minutes == null || row.cycle_minutes == null) continue;

    const { data: deployment } = await admin.from("moderator_deployments").select("id, community_id, enabled").eq("id", row.deployment_id).maybeSingle();
    if (!deployment || !deployment.enabled) continue;

    const tenant = await resolveDeploymentTenant(admin, row.deployment_id);
    if (!tenant) continue;

    const capacity = await getAccountCapacity(admin, tenant.accountId);
    if (!capacity || !presenceSchedulingEligible(capacity.tier)) continue;

    const communityId = deployment.community_id as string;
    let settings = settingsCache.get(communityId);
    if (!settings) {
      const { data: settingsRow } = await admin
        .from("community_presence_settings")
        .select("community_id, coverage_start_minutes, coverage_end_minutes, announce_start, announce_return, announce_end")
        .eq("community_id", communityId)
        .maybeSingle();
      settings = settingsRow ? (settingsRow as CommunitySettingsRow) : { community_id: communityId, ...DEFAULT_SETTINGS };
      settingsCache.set(communityId, settings);
    }

    let timezone = timezoneCache.get(communityId);
    if (!timezone) {
      const { data: communityRow } = await admin.from("communities").select("timezone").eq("id", communityId).maybeSingle();
      timezone = (communityRow?.timezone as string | null) || "UTC";
      timezoneCache.set(communityId, timezone);
    }

    const config: PresenceConfig = { anchorUtc: row.anchor_utc, activeMinutes: row.active_minutes, cycleMinutes: row.cycle_minutes };
    const raw = presenceAt(config, now);
    const local = localMinutesOfDay(now, timezone);
    const result = applyCoverageWindow(raw, local, settings.coverage_start_minutes, settings.coverage_end_minutes);
    const nextState: "active" | "away" = result.present ? "active" : "away";

    const { data: stateRow } = await admin
      .from("deployment_presence_state")
      .select("state, current_interval_key")
      .eq("deployment_id", row.deployment_id)
      .maybeSingle();
    const priorState = (stateRow?.state as "active" | "away" | undefined) ?? null;

    const kind = transitionKindFor(priorState, nextState);
    if (!kind) continue; // no real change -- guaranteed no-op

    const claimed = await claimPresenceTransition(admin, row.deployment_id, priorState, nextState, result.intervalKey);
    if (!claimed) continue; // lost the race to a concurrent sweep invocation

    const announceFlag =
      kind === "presence_started" ? settings.announce_start : kind === "presence_resumed" ? settings.announce_return : settings.announce_end;

    let sentText: string | null = null;
    if (announceFlag) {
      const bot = await loadModeratorBotToken(admin, row.deployment_id);
      if (bot) {
        const isEnterprise = capacity.tier === "enterprise";
        const aiRouting = await resolveAccountAiRouting(admin, tenant.accountId, isEnterprise);
        const text = await generatePresenceMessage(bot.moderatorName, bot.persona, kind, aiRouting);
        const sent = await telegramApiCall(bot.token, "sendMessage", { chat_id: bot.chatId, text });
        if (sent.ok) sentText = text;
        else console.error(`[presence] send failed for deployment ${row.deployment_id}: ${JSON.stringify(sent)}`);
      }
    }

    await logPresenceActivity(admin, communityId, row.deployment_id, kind, {
      intervalKey: result.intervalKey,
      announced: announceFlag,
      sent: sentText !== null,
    });
  }

  return { ok: true };
}
