import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, providerKeySecret } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { virtualModContentGeneration } from "./plan";
import { normalizeModeratorPersona, type ModeratorPersona } from "./domain";
import {
  localDateKeyInTimezone, isWindowPastForToday, scheduleWithSpacing,
  isTooSimilarToRecent, validateGeneratedPost, type AutoPostOccurrenceStatus,
} from "./autopost";
import { generateAutoPostContent } from "./autopost-generate";
import { retrieveRelevantKnowledge, combineKnowledgeRetrieval, type KnowledgeSource, type KnowledgeScopeType } from "./knowledge";

/* =========================================================
   AI Telegram Auto-Posting — the cron-driven sweep (Phase 4.N part B). Each
   pass: (1) ensure today's occurrence exists for every enabled window whose
   window hasn't already passed, (2) execute any DUE occurrence (generate ->
   validate -> publish, or retry a publish-only failure) via the ASSIGNED
   moderator's OWN managed-bot credential -- never TELEGRAM_MANAGER_BOT_TOKEN
   (spec §14/§20 of the update section). Idempotent: every state transition
   is a conditional UPDATE keyed on the row's CURRENT status, so two
   concurrent sweeps (cron retry, etc.) can't double-generate or
   double-publish the same occurrence (spec §6/§35).
   ========================================================= */

const RECENT_DUPLICATE_WINDOW_DAYS = 3;
const MAX_KNOWLEDGE_ENTRIES = 8;
const SPACING_MIN_GAP_MINUTES = 10;

interface WindowRow {
  id: string;
  panel_id: string;
  community_id: string;
  moderator_deployment_id: string;
  start_local_time: string;
  end_local_time: string;
}

async function claimStatus(admin: SupabaseClient, table: string, id: string, from: AutoPostOccurrenceStatus, to: AutoPostOccurrenceStatus, patch: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await admin.from(table).update({ status: to, ...patch }).eq("id", id).eq("status", from).select("id");
  if (error) { console.error(`[autopost] claim ${from}->${to} failed`, error); return false; }
  return (data?.length ?? 0) > 0;
}

async function ensureTodaysOccurrences(admin: SupabaseClient, now: Date) {
  const { data: windows } = await admin
    .from("auto_post_windows")
    .select("id, panel_id, community_id, moderator_deployment_id, start_local_time, end_local_time")
    .eq("enabled", true);
  if (!windows || windows.length === 0) return;

  // Communities + their timezone, batched.
  const communityIds = Array.from(new Set(windows.map((w: WindowRow) => w.community_id)));
  const { data: communities } = await admin.from("communities").select("id, timezone, panel_id").in("id", communityIds);
  const timezoneByCommunity = new Map((communities ?? []).map((c: { id: string; timezone: string; panel_id: string }) => [c.id, c.timezone || "UTC"]));
  const panelByCommunity = new Map((communities ?? []).map((c: { id: string; timezone: string; panel_id: string }) => [c.id, c.panel_id]));

  // Panel entitlement, batched.
  const panelIds = Array.from(new Set(windows.map((w: WindowRow) => w.panel_id)));
  const { data: panels } = await admin.from("panels").select("id, settings").in("id", panelIds);
  const settingsByPanel = new Map((panels ?? []).map((p: { id: string; settings: unknown }) => [p.id, p.settings]));

  // Deployment must still be active.
  const deploymentIds = Array.from(new Set(windows.map((w: WindowRow) => w.moderator_deployment_id)));
  const { data: deployments } = await admin.from("moderator_deployments").select("id, enabled").in("id", deploymentIds);
  const activeDeployment = new Map((deployments ?? []).map((d: { id: string; enabled: boolean }) => [d.id, d.enabled]));

  for (const w of windows as WindowRow[]) {
    if (!activeDeployment.get(w.moderator_deployment_id)) continue; // spec §19 -- deployment must be active
    if (!virtualModContentGeneration(settingsByPanel.get(panelByCommunity.get(w.community_id) ?? w.panel_id))) continue; // spec §26/§27 -- entitlement gate
    const timezone = timezoneByCommunity.get(w.community_id) ?? "UTC";
    const localDate = localDateKeyInTimezone(now, timezone);

    const { data: existing } = await admin.from("auto_post_occurrences").select("id").eq("auto_post_window_id", w.id).eq("local_date", localDate).maybeSingle();
    if (existing) continue; // already created (idempotent -- unique(window,day) also guards this at the DB level)
    if (isWindowPastForToday(localDate, w.end_local_time, timezone, now)) continue; // too late to bother scheduling today

    // Spacing (spec §9) -- against OTHER windows' occurrences already scheduled today in the SAME community.
    const { data: sameDayInCommunity } = await admin
      .from("auto_post_occurrences")
      .select("scheduled_for, auto_post_windows!inner(community_id)")
      .eq("local_date", localDate)
      .eq("auto_post_windows.community_id", w.community_id);
    const otherTimes = (sameDayInCommunity ?? []).map((r: { scheduled_for: string }) => new Date(r.scheduled_for));

    const scheduledFor = scheduleWithSpacing(localDate, w.start_local_time, w.end_local_time, timezone, otherTimes, Math.random, SPACING_MIN_GAP_MINUTES);
    const { error } = await admin.from("auto_post_occurrences").insert({
      auto_post_window_id: w.id, local_date: localDate, scheduled_for: scheduledFor.toISOString(), status: "scheduled",
    });
    if (error && error.code !== "23505") console.error("[autopost] failed to create occurrence", error); // 23505 = unique race, harmless
  }
}

/** Auto-Posting sources from the SAME Project Profile as Q&A retrieval — no
 *  separate knowledge architecture. Priority order per the corrected
 *  product spec: Main Overview > website/docs > additional (free-form)
 *  knowledge > community context > legacy organization knowledge. Contact
 *  presets are NEVER included here -- they're for routing a human's
 *  question to a person, not post-topic inspiration for generated content. */
export async function loadKnowledgeForWindow(admin: SupabaseClient, panelId: string, communityId: string): Promise<{ scope: KnowledgeScopeType; title: string; content: string }[]> {
  const { data: communityRow } = await admin.from("communities").select("project_id").eq("id", communityId).maybeSingle();
  const projectId = communityRow?.project_id ?? null;

  const [communityRes, projectRes, organizationRes, profileRes] = await Promise.all([
    admin.from("knowledge_sources").select("id, panel_id, scope_type, project_id, community_id, kind, title, content, active").eq("community_id", communityId).eq("scope_type", "COMMUNITY").eq("active", true),
    projectId
      ? admin.from("knowledge_sources").select("id, panel_id, scope_type, project_id, community_id, kind, title, content, active").eq("project_id", projectId).eq("scope_type", "PROJECT").eq("active", true)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    admin.from("knowledge_sources").select("id, panel_id, scope_type, project_id, community_id, kind, title, content, active").eq("panel_id", panelId).eq("scope_type", "ORGANIZATION").eq("active", true),
    projectId
      ? admin.from("projects").select("name, overview, website, docs_url").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null as { name?: string; overview?: string; website?: string; docs_url?: string } | null, error: null }),
  ]);
  const toSources = (rows: Array<Record<string, unknown>> | null): KnowledgeSource[] =>
    (rows ?? []).map((r) => ({
      id: r.id as string, panelId: r.panel_id as string, scopeType: r.scope_type as KnowledgeSource["scopeType"],
      projectId: (r.project_id as string) ?? null, communityId: (r.community_id as string) ?? null, kind: r.kind as KnowledgeSource["kind"],
      title: (r.title as string) ?? "", content: (r.content as string) ?? "", active: r.active !== false,
    }));

  const entries: { scope: KnowledgeScopeType; title: string; content: string }[] = [];
  const profile = profileRes.data;
  if (profile?.overview) entries.push({ scope: "PROJECT", title: profile.name || "Overview", content: profile.overview });
  if (profile?.website) entries.push({ scope: "PROJECT", title: "Website", content: profile.website });
  if (profile?.docs_url) entries.push({ scope: "PROJECT", title: "Docs", content: profile.docs_url });

  // Additional (free-form) project knowledge, then community context, then
  // legacy organization knowledge -- same relative precedence Q&A retrieval
  // already uses, just without a query to score against (no specific
  // "question" for a generated post, so this just caps each scope's active
  // rows directly rather than relevance-scoring them).
  const project = toSources(projectRes.data).slice(0, MAX_KNOWLEDGE_ENTRIES);
  const community = toSources(communityRes.data).slice(0, MAX_KNOWLEDGE_ENTRIES);
  const organization = toSources(organizationRes.data).slice(0, MAX_KNOWLEDGE_ENTRIES);
  const combined = combineKnowledgeRetrieval(community, project, organization, MAX_KNOWLEDGE_ENTRIES);
  for (const s of combined) entries.push({ scope: s.scopeType, title: s.title, content: s.content });

  return entries.slice(0, MAX_KNOWLEDGE_ENTRIES);
}

async function loadRecentPostSummaries(admin: SupabaseClient, communityId: string, now: Date): Promise<string[]> {
  const since = new Date(now.getTime() - RECENT_DUPLICATE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("auto_post_occurrences")
    .select("generated_title, generated_content, published_at, auto_post_windows!inner(community_id)")
    .eq("status", "published")
    .eq("auto_post_windows.community_id", communityId)
    .gte("published_at", since)
    .order("published_at", { ascending: false })
    .limit(10);
  return (data ?? []).map((r: { generated_title: string | null; generated_content: string | null }) => r.generated_title || (r.generated_content ?? "").slice(0, 80)).filter(Boolean);
}

async function loadModeratorBotToken(admin: SupabaseClient, deploymentId: string): Promise<{ token: string; chatId: string; moderatorName: string; persona: ModeratorPersona } | null> {
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
  return { token, chatId: community.chat_id, moderatorName: moderator.name, persona: normalizeModeratorPersona(moderator.persona) };
}

async function publishOccurrence(admin: SupabaseClient, occurrenceId: string, windowId: string, fromStatus: "generated" | "publish_failed") {
  const { data: window } = await admin.from("auto_post_windows").select("moderator_deployment_id").eq("id", windowId).maybeSingle();
  if (!window) return;
  const { data: occ } = await admin.from("auto_post_occurrences").select("generated_content").eq("id", occurrenceId).maybeSingle();
  if (!occ?.generated_content) return;

  if (!(await claimStatus(admin, "auto_post_occurrences", occurrenceId, fromStatus, "publishing"))) return; // lost the race to another sweep

  const bot = await loadModeratorBotToken(admin, window.moderator_deployment_id);
  if (!bot) {
    await admin.from("auto_post_occurrences").update({ status: "publish_failed", error: "moderator/bot credential unavailable" }).eq("id", occurrenceId);
    return;
  }
  const res = await telegramApiCall<{ message_id: number }>(bot.token, "sendMessage", { chat_id: bot.chatId, text: occ.generated_content });
  if (res.ok) {
    await admin.from("auto_post_occurrences").update({ status: "published", published_message_id: String(res.result.message_id), published_at: new Date().toISOString() }).eq("id", occurrenceId);
  } else {
    // Spec §15/§36: retain the generated content, retry PUBLISH ONLY next sweep -- never regenerate a different post because publishing failed.
    await admin.from("auto_post_occurrences").update({ status: "publish_failed", error: res.error }).eq("id", occurrenceId);
  }
}

async function generateAndPublishOccurrence(admin: SupabaseClient, occ: { id: string; auto_post_window_id: string }, window: WindowRow, timezone: string, now: Date) {
  if (isWindowPastForToday(localDateKeyInTimezone(now, timezone), window.end_local_time, timezone, now)) {
    // System was down through the whole window -- spec §16: SKIP, never post late.
    await claimStatus(admin, "auto_post_occurrences", occ.id, "scheduled", "missed", { error: "window ended before generation ran" });
    return;
  }
  if (!(await claimStatus(admin, "auto_post_occurrences", occ.id, "scheduled", "generating"))) return; // another sweep already claimed it

  const bot = await loadModeratorBotToken(admin, window.moderator_deployment_id);
  if (!bot) {
    await admin.from("auto_post_occurrences").update({ status: "failed", error: "moderator/bot credential unavailable" }).eq("id", occ.id);
    return;
  }
  const knowledge = await loadKnowledgeForWindow(admin, window.panel_id, window.community_id);
  const recentPostSummaries = await loadRecentPostSummaries(admin, window.community_id, now);

  let result = await generateAutoPostContent({ moderatorName: bot.moderatorName, persona: bot.persona, knowledge, recentPostSummaries });
  if (!result.ok) {
    await admin.from("auto_post_occurrences").update({ status: "failed", error: result.error }).eq("id", occ.id);
    return;
  }
  if ("insufficientKnowledge" in result) {
    await admin.from("auto_post_occurrences").update({ status: "missed", error: "insufficient knowledge material" }).eq("id", occ.id);
    return;
  }

  // Defense in depth beyond the prompt's own "don't repeat" instruction --
  // one regeneration attempt if the heuristic still flags it as a near-duplicate.
  if (isTooSimilarToRecent(result.text, recentPostSummaries)) {
    const retry = await generateAutoPostContent({ moderatorName: bot.moderatorName, persona: bot.persona, knowledge, recentPostSummaries });
    if (retry.ok && !("insufficientKnowledge" in retry) && !isTooSimilarToRecent(retry.text, recentPostSummaries)) {
      result = retry;
    } else {
      await admin.from("auto_post_occurrences").update({ status: "missed", error: "too similar to a recent post" }).eq("id", occ.id);
      return;
    }
  }

  const validation = validateGeneratedPost(result.text);
  if (!validation.ok) {
    await admin.from("auto_post_occurrences").update({ status: "failed", error: validation.error }).eq("id", occ.id);
    return;
  }

  const claimed = await claimStatus(admin, "auto_post_occurrences", occ.id, "generating", "generated", { generated_title: result.title, generated_content: result.text });
  if (!claimed) return;
  await publishOccurrence(admin, occ.id, occ.auto_post_window_id, "generated");
}

async function executeDueOccurrences(admin: SupabaseClient, now: Date) {
  const { data: due } = await admin
    .from("auto_post_occurrences")
    .select("id, auto_post_window_id, status")
    .in("status", ["scheduled", "publish_failed"])
    .lte("scheduled_for", now.toISOString());
  if (!due || due.length === 0) return;

  const windowIds = Array.from(new Set(due.map((o: { auto_post_window_id: string }) => o.auto_post_window_id)));
  const { data: windows } = await admin.from("auto_post_windows").select("id, panel_id, community_id, moderator_deployment_id, start_local_time, end_local_time, enabled").in("id", windowIds);
  const windowById = new Map((windows ?? []).map((w: WindowRow & { enabled: boolean }) => [w.id, w]));
  const communityIds = Array.from(new Set((windows ?? []).map((w: WindowRow) => w.community_id)));
  const { data: communities } = await admin.from("communities").select("id, timezone").in("id", communityIds);
  const timezoneByCommunity = new Map((communities ?? []).map((c: { id: string; timezone: string }) => [c.id, c.timezone || "UTC"]));

  for (const occ of due as Array<{ id: string; auto_post_window_id: string; status: "scheduled" | "publish_failed" }>) {
    const window = windowById.get(occ.auto_post_window_id) as (WindowRow & { enabled: boolean }) | undefined;
    if (!window || !window.enabled) continue;
    const timezone = timezoneByCommunity.get(window.community_id) ?? "UTC";
    if (occ.status === "scheduled") {
      await generateAndPublishOccurrence(admin, occ, window, timezone, now);
    } else {
      await publishOccurrence(admin, occ.id, occ.auto_post_window_id, "publish_failed");
    }
  }
}

export async function runAutoPostSweep(admin: SupabaseClient = createAdminClient()): Promise<{ ok: true }> {
  const now = new Date();
  await ensureTodaysOccurrences(admin, now);
  await executeDueOccurrences(admin, now);
  return { ok: true };
}
