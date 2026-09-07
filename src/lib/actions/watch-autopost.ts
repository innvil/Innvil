"use server";

/**
 * AI Telegram Auto-Posting — standalone (Panel-less) account-facing CRUD
 * (Phase 4.N.1, extends part B's Panel-owner-only actions/autopost.ts to
 * the direct-Watch account model). Ownership resolved via
 * listAccountCommunities (the SAME canonical, cross-account-isolated
 * Community list every other Watch action already reuses) — never a raw
 * unscoped query. Every window created here is inserted with panel_id:
 * null; the runtime sweep (autopost-runtime.ts) already branches on that to
 * resolve entitlement via the account-scoped path instead of panels.settings.
 *
 * This is a SEPARATE file from actions/autopost.ts (never widened in
 * place) — matching this codebase's established convention (watch-
 * moderator.ts vs actions/moderator.ts, watch-presence.ts, etc.): every
 * account-scoped Watch feature gets its own dedicated action file, rather
 * than threading an optional panelId through the legacy Panel-owner one.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { listAccountCommunities, getAccountCapacity, type AccountCommunitySummary } from "@/src/lib/products/watch-runtime";
import { autoPostingEligible } from "@/src/lib/products/watch-plans";
import { validateWindow, type AutoPostOccurrence } from "@/src/lib/moderator/autopost";
import type { SupabaseClient } from "@supabase/supabase-js";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ctxCommunity(communityId: string): Promise<{ admin: SupabaseClient; accountId: string; community: AccountCommunitySummary } | null> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const community = (await listAccountCommunities(admin, user.id)).find((c) => c.id === communityId);
  if (!community) return null;
  return { admin, accountId: user.id, community };
}

async function requireEligible(admin: SupabaseClient, accountId: string): Promise<Result<null> | null> {
  const capacity = await getAccountCapacity(admin, accountId);
  if (!autoPostingEligible(capacity?.tier ?? null)) {
    return { ok: false, error: "Auto-Posting isn't available on the current plan (paid tier required — not included in the free trial)." };
  }
  return null;
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

export async function getCommunityTimezone(communityId: string): Promise<Result<string>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const { data } = await ctx.admin.from("communities").select("timezone").eq("id", communityId).maybeSingle();
  return { ok: true, data: data?.timezone || "UTC" };
}

export async function setCommunityTimezone(communityId: string, timezone: string): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { ok: false, error: "Invalid timezone (use an IANA name, e.g. Asia/Manila)." };
  }
  const { error } = await ctx.admin.from("communities").update({ timezone }).eq("id", communityId);
  if (error) return { ok: false, error: "Couldn't update timezone." };
  return { ok: true, data: null };
}

export interface CommunityDeploymentOption {
  deploymentId: string;
  moderatorName: string;
}

/** Watchers actively deployed in this community — powers the window
 *  creation form's selector (spec §27: never allow assigning a Watcher
 *  that isn't actually deployed there). Read straight from the already-
 *  resolved community summary — no second query needed. */
export async function listCommunityDeployments(communityId: string): Promise<Result<CommunityDeploymentOption[]>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  return { ok: true, data: ctx.community.watchers.filter((w) => w.enabled).map((w) => ({ deploymentId: w.deploymentId, moderatorName: w.watcherName })) };
}

export async function listAutoPostWindows(communityId: string): Promise<Result<AutoPostWindowRow[]>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const { data, error } = await ctx.admin
    .from("auto_post_windows")
    .select("id, moderator_deployment_id, start_local_time, end_local_time, enabled")
    .eq("community_id", communityId)
    .is("panel_id", null)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load posting windows." };
  const nameByDeployment = new Map(ctx.community.watchers.map((w) => [w.deploymentId, w.watcherName]));
  const rows = (data ?? []).map((r) => ({
    id: r.id as string, communityId, moderatorDeploymentId: r.moderator_deployment_id as string,
    moderatorName: nameByDeployment.get(r.moderator_deployment_id as string) ?? "Watcher",
    startLocalTime: r.start_local_time as string, endLocalTime: r.end_local_time as string, enabled: r.enabled as boolean,
  }));
  return { ok: true, data: rows };
}

export async function createAutoPostWindow(
  communityId: string, moderatorDeploymentId: string, startLocalTime: string, endLocalTime: string
): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const gate = await requireEligible(ctx.admin, ctx.accountId);
  if (gate) return gate;

  const validity = validateWindow(startLocalTime, endLocalTime);
  if (!validity.ok) return { ok: false, error: validity.error };

  const deployment = ctx.community.watchers.find((w) => w.deploymentId === moderatorDeploymentId);
  if (!deployment) return { ok: false, error: "That Watcher isn't deployed in this Community." };
  if (!deployment.enabled) return { ok: false, error: "That Watcher deployment is currently paused." };

  const { error } = await ctx.admin.from("auto_post_windows").insert({
    panel_id: null, community_id: communityId, moderator_deployment_id: moderatorDeploymentId,
    start_local_time: startLocalTime, end_local_time: endLocalTime, enabled: true,
  });
  if (error) return { ok: false, error: "Couldn't create the posting window." };
  return { ok: true, data: null };
}

export async function setAutoPostWindowEnabled(communityId: string, id: string, enabled: boolean): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const { error } = await ctx.admin.from("auto_post_windows").update({ enabled }).eq("id", id).eq("community_id", communityId);
  if (error) return { ok: false, error: "Couldn't update the posting window." };
  return { ok: true, data: null };
}

export async function deleteAutoPostWindow(communityId: string, id: string): Promise<Result<null>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const { error } = await ctx.admin.from("auto_post_windows").delete().eq("id", id).eq("community_id", communityId);
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
 *  into what's scheduled/published/missed (spec §26's "optional preview"). */
export async function listRecentAutoPosts(communityId: string, limit = 20): Promise<Result<AutoPostOccurrenceRow[]>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const { data, error } = await ctx.admin
    .from("auto_post_occurrences")
    .select("id, local_date, scheduled_for, status, generated_title, generated_content, published_at, error, auto_post_windows!inner(community_id)")
    .eq("auto_post_windows.community_id", communityId)
    .order("scheduled_for", { ascending: false })
    .limit(limit);
  if (error) return { ok: false, error: "Couldn't load recent posts." };
  const rows = (data ?? []).map((r) => ({
    id: r.id as string, localDate: r.local_date as string, scheduledFor: r.scheduled_for as string, status: r.status as AutoPostOccurrence["status"],
    generatedTitle: r.generated_title as string | null, generatedContent: r.generated_content as string | null,
    publishedAt: r.published_at as string | null, error: r.error as string | null,
  }));
  return { ok: true, data: rows };
}

/** Cheap eligibility-only check, for gating the Community detail page's
 *  Auto-Posting tab visibility without fetching the fuller window list. */
export async function getAutoPostingEligibility(communityId: string): Promise<Result<{ eligible: boolean; timezone: string }>> {
  const ctx = await ctxCommunity(communityId);
  if (!ctx) return { ok: false, error: "Community not found." };
  const capacity = await getAccountCapacity(ctx.admin, ctx.accountId);
  const { data } = await ctx.admin.from("communities").select("timezone").eq("id", communityId).maybeSingle();
  return { ok: true, data: { eligible: autoPostingEligible(capacity?.tier ?? null), timezone: data?.timezone || "UTC" } };
}
