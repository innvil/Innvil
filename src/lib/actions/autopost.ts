"use server";

/**
 * AI Telegram Auto-Posting — owner-facing CRUD (Phase 4.N part B). Windows
 * are community + moderator-deployment scoped (spec: "the user is explicitly
 * assigning moderator + time window"). Entitlement (paid tier, not trial) is
 * enforced on create — see plan.ts's virtualModContentGeneration.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { validateWindow, type AutoPostOccurrence } from "@/src/lib/moderator/autopost";
import { virtualModContentGeneration } from "@/src/lib/moderator/plan";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

export interface AutoPostWindowRow {
  id: string;
  communityId: string;
  moderatorDeploymentId: string;
  moderatorName: string;
  startLocalTime: string;
  endLocalTime: string;
  enabled: boolean;
}

export async function getCommunityTimezone(panelId: string, communityId: string): Promise<Result<string>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data } = await ctx.admin.from("communities").select("timezone").eq("id", communityId).eq("panel_id", panelId).maybeSingle();
  if (!data) return { ok: false, error: "Community not found." };
  return { ok: true, data: data.timezone || "UTC" };
}

export async function setCommunityTimezone(panelId: string, communityId: string, timezone: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { ok: false, error: "Invalid timezone (use an IANA name, e.g. Asia/Manila)." };
  }
  const { error } = await ctx.admin.from("communities").update({ timezone }).eq("id", communityId).eq("panel_id", panelId);
  if (error) return { ok: false, error: "Couldn't update timezone." };
  return { ok: true, data: null };
}

export interface CommunityDeploymentOption {
  deploymentId: string;
  moderatorName: string;
}

/** Moderators actively deployed in this community — powers the window
 *  creation form's moderator selector (spec §27: never allow assigning a
 *  moderator that isn't actually deployed there). */
export async function listCommunityDeployments(panelId: string, communityId: string): Promise<Result<CommunityDeploymentOption[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("moderator_deployments")
    .select("id, virtual_moderators(name)")
    .eq("panel_id", panelId)
    .eq("community_id", communityId)
    .eq("enabled", true);
  if (error) return { ok: false, error: "Couldn't load deployed moderators." };
  const rows = (data ?? []).map((r: any) => {
    const mod = Array.isArray(r.virtual_moderators) ? r.virtual_moderators[0] : r.virtual_moderators;
    return { deploymentId: r.id, moderatorName: mod?.name ?? "Moderator" };
  });
  return { ok: true, data: rows };
}

export async function listAutoPostWindows(panelId: string, communityId: string): Promise<Result<AutoPostWindowRow[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("auto_post_windows")
    .select("id, community_id, moderator_deployment_id, start_local_time, end_local_time, enabled, moderator_deployments(moderator_id, virtual_moderators(name))")
    .eq("panel_id", panelId)
    .eq("community_id", communityId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load posting windows." };
  const rows = (data ?? []).map((r: any) => {
    const dep = Array.isArray(r.moderator_deployments) ? r.moderator_deployments[0] : r.moderator_deployments;
    const mod = dep ? (Array.isArray(dep.virtual_moderators) ? dep.virtual_moderators[0] : dep.virtual_moderators) : null;
    return {
      id: r.id, communityId: r.community_id, moderatorDeploymentId: r.moderator_deployment_id,
      moderatorName: mod?.name ?? "Moderator", startLocalTime: r.start_local_time, endLocalTime: r.end_local_time, enabled: r.enabled,
    };
  });
  return { ok: true, data: rows };
}

export async function createAutoPostWindow(
  panelId: string,
  communityId: string,
  moderatorDeploymentId: string,
  startLocalTime: string,
  endLocalTime: string
): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  if (!virtualModContentGeneration(ctx.panel.settings)) return { ok: false, error: "Auto-Posting isn't available on the current plan (paid tier required — not included in the free trial)." };

  const validity = validateWindow(startLocalTime, endLocalTime);
  if (!validity.ok) return { ok: false, error: validity.error };

  const { data: deployment } = await ctx.admin.from("moderator_deployments").select("id, community_id, enabled").eq("id", moderatorDeploymentId).eq("panel_id", panelId).maybeSingle();
  if (!deployment) return { ok: false, error: "Moderator deployment not found." };
  if (deployment.community_id !== communityId) return { ok: false, error: "That moderator isn't deployed in this community." };
  if (!deployment.enabled) return { ok: false, error: "That moderator deployment is currently paused." };

  const { error } = await ctx.admin.from("auto_post_windows").insert({
    panel_id: panelId, community_id: communityId, moderator_deployment_id: moderatorDeploymentId,
    start_local_time: startLocalTime, end_local_time: endLocalTime, enabled: true,
  });
  if (error) return { ok: false, error: "Couldn't create the posting window." };
  return { ok: true, data: null };
}

export async function setAutoPostWindowEnabled(panelId: string, id: string, enabled: boolean): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("auto_post_windows").update({ enabled }).eq("id", id).eq("panel_id", panelId);
  if (error) return { ok: false, error: "Couldn't update the posting window." };
  return { ok: true, data: null };
}

export async function deleteAutoPostWindow(panelId: string, id: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("auto_post_windows").delete().eq("id", id).eq("panel_id", panelId);
  if (error) return { ok: false, error: "Couldn't delete the posting window." };
  return { ok: true, data: null };
}

export interface AutoPostOccurrenceRow {
  id: string;
  localDate: string;
  scheduledFor: string;
  status: AutoPostOccurrence["status"];
  generatedTitle: string | null;
  generatedContent: string | null;
  publishedAt: string | null;
  error: string | null;
}

/** Recent occurrences across every window in a community — owner visibility
 *  into what's scheduled/published/missed (spec §26's "optional preview",
 *  kept minimal per its own "don't overbuild" note). */
export async function listRecentAutoPosts(panelId: string, communityId: string, limit = 20): Promise<Result<AutoPostOccurrenceRow[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("auto_post_occurrences")
    .select("id, local_date, scheduled_for, status, generated_title, generated_content, published_at, error, auto_post_windows!inner(community_id, panel_id)")
    .eq("auto_post_windows.community_id", communityId)
    .eq("auto_post_windows.panel_id", panelId)
    .order("scheduled_for", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: "Couldn't load recent posts." };
  const rows = (data ?? []).map((r: any) => ({
    id: r.id, localDate: r.local_date, scheduledFor: r.scheduled_for, status: r.status,
    generatedTitle: r.generated_title, generatedContent: r.generated_content, publishedAt: r.published_at, error: r.error,
  }));
  return { ok: true, data: rows };
}
