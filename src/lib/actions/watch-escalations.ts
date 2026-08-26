"use server";

/**
 * Shared Escalation Group (Phase 1) — owner-facing dashboard actions. Lists
 * a Project's escalations and lets the owner promote an admin's answer to
 * permanent Project Knowledge (with an optional expiration date), matching
 * the spec's own "save-to-knowledge is a dashboard action" decision (no
 * Telegram inline-button/callback-query handling exists anywhere in this
 * codebase — see the plan's architecture decision 5).
 */

import { getAuthedAdmin } from "@/src/lib/auth";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface AccountEscalationRow {
  id: string;
  sourceCommunityId: string;
  sourceCommunityTitle: string | null;
  watcherId: string;
  watcherName: string;
  askerDisplayName: string | null;
  questionText: string;
  status: "open" | "answered" | "closed";
  answerText: string | null;
  answeredAt: string | null;
  knowledgeSourceId: string | null;
  createdAt: string;
}

async function ownedProject(accountId: string, projectId: string, admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"]) {
  const { data: project } = await admin.from("projects").select("id, account_id").eq("id", projectId).maybeSingle();
  if (!project || project.account_id !== accountId) return null;
  return project;
}

/** Every escalation ever raised for this Project, newest first — never
 *  trusts a client-supplied project id without the ownership check above. */
export async function listProjectEscalations(projectId: string): Promise<Result<AccountEscalationRow[]>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  const { data, error } = await admin
    .from("watch_escalations")
    .select("id, source_community_id, watcher_id, asker_display_name, question_text, status, answer_text, answered_at, knowledge_source_id, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { ok: false, error: "Couldn't load escalations." };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { ok: true, data: [] };

  const communityIds = Array.from(new Set(rows.map((r) => r.source_community_id as string)));
  const watcherIds = Array.from(new Set(rows.map((r) => r.watcher_id as string)));
  const [{ data: communities }, { data: watchers }] = await Promise.all([
    admin.from("communities").select("id, title").in("id", communityIds),
    admin.from("virtual_moderators").select("id, name").in("id", watcherIds),
  ]);
  const communityTitleById = new Map(((communities ?? []) as Array<{ id: string; title: string | null }>).map((c) => [c.id, c.title]));
  const watcherNameById = new Map(((watchers ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]));

  return {
    ok: true,
    data: rows.map((r) => ({
      id: r.id as string,
      sourceCommunityId: r.source_community_id as string,
      sourceCommunityTitle: communityTitleById.get(r.source_community_id as string) ?? null,
      watcherId: r.watcher_id as string,
      watcherName: watcherNameById.get(r.watcher_id as string) ?? "Deleted Watcher",
      askerDisplayName: (r.asker_display_name as string | null) ?? null,
      questionText: r.question_text as string,
      status: r.status as AccountEscalationRow["status"],
      answerText: (r.answer_text as string | null) ?? null,
      answeredAt: (r.answered_at as string | null) ?? null,
      knowledgeSourceId: (r.knowledge_source_id as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  };
}

/** Promotes an already-answered escalation's approved answer to permanent
 *  Project Knowledge — a new PROJECT-scope `knowledge_sources` row
 *  (kind: 'escalation_answer'), flowing through the EXISTING retrieval
 *  pipeline for free. `expiresAt` is optional (null = never expires) for a
 *  time-sensitive fact (e.g. a launch date) — an expired row is excluded at
 *  retrieval time (knowledge.ts's retrieveRelevantKnowledge), never
 *  presented as current. Idempotent: an already-promoted escalation
 *  (knowledge_source_id already set) is rejected rather than creating a
 *  duplicate entry. */
export async function promoteEscalationToKnowledge(escalationId: string, expiresAt?: string | null): Promise<Result<{ knowledgeSourceId: string }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data: escalation } = await admin
    .from("watch_escalations")
    .select("id, project_id, question_text, answer_text, status, knowledge_source_id")
    .eq("id", escalationId)
    .maybeSingle();
  if (!escalation) return { ok: false, error: "Escalation not found." };
  const project = await ownedProject(user.id, escalation.project_id as string, admin);
  if (!project) return { ok: false, error: "Not authorized." };
  if (escalation.status !== "answered") return { ok: false, error: "This escalation hasn't been answered yet." };
  if (escalation.knowledge_source_id) return { ok: false, error: "This answer was already saved to Project Knowledge." };
  const answer = (escalation.answer_text as string | null)?.trim();
  if (!answer) return { ok: false, error: "This escalation has no answer to save." };

  const { data: row, error: insertError } = await admin
    .from("knowledge_sources")
    .insert({
      scope_type: "PROJECT",
      project_id: escalation.project_id,
      kind: "escalation_answer",
      title: (escalation.question_text as string).slice(0, 200),
      content: answer,
      active: true,
      expires_at: expiresAt ?? null,
    })
    .select("id")
    .single();
  if (insertError || !row) return { ok: false, error: "Couldn't save that as Project Knowledge." };

  const { error: updateError } = await admin.from("watch_escalations").update({ knowledge_source_id: row.id, status: "closed" }).eq("id", escalationId);
  if (updateError) {
    // Roll back the just-inserted row rather than leaving a phantom
    // knowledge entry the escalation itself doesn't know it created.
    await admin.from("knowledge_sources").delete().eq("id", row.id);
    return { ok: false, error: "Couldn't finalize saving that answer." };
  }
  return { ok: true, data: { knowledgeSourceId: row.id as string } };
}
