"use server";

/**
 * Project Knowledge — owner-facing CRUD (Phase 4.N, part A). Panel-scoped
 * (a panel is one project/brand — both legacy owner-created and the newer
 * customer-owned moderators, migration 0051, share the SAME project
 * knowledge, since "what the project is" doesn't vary by which moderator is
 * answering). Only ever writes PROJECT-scope rows (community_id null) — see
 * src/lib/moderator/knowledge.ts's file header for the scope-field rationale.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { KNOWLEDGE_KINDS, type KnowledgeSource, type KnowledgeSourceKind } from "@/src/lib/moderator/knowledge";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin };
}

function toRow(r: Record<string, unknown>): KnowledgeSource {
  return {
    id: r.id as string,
    panelId: r.panel_id as string,
    scopeType: r.scope_type as KnowledgeSource["scopeType"],
    communityId: (r.community_id as string) ?? null,
    kind: r.kind as KnowledgeSourceKind,
    title: (r.title as string) ?? "",
    content: (r.content as string) ?? "",
    active: r.active !== false,
  };
}

export async function listProjectKnowledge(panelId: string): Promise<Result<KnowledgeSource[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .select("id, panel_id, scope_type, community_id, kind, title, content, active")
    .eq("panel_id", panelId)
    .eq("scope_type", "PROJECT")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load project knowledge." };
  return { ok: true, data: (data ?? []).map(toRow) };
}

export async function createProjectKnowledgeEntry(
  panelId: string,
  input: { kind: KnowledgeSourceKind; title: string; content: string }
): Promise<Result<KnowledgeSource>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  if (!KNOWLEDGE_KINDS.includes(input.kind)) return { ok: false, error: "Invalid knowledge kind." };
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, 4000);
  if (!content) return { ok: false, error: "Content can't be empty." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .insert({ panel_id: panelId, scope_type: "PROJECT", kind: input.kind, title, content, active: true })
    .select("id, panel_id, scope_type, community_id, kind, title, content, active")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that entry." };
  return { ok: true, data: toRow(data) };
}

export async function updateProjectKnowledgeEntry(
  panelId: string,
  id: string,
  input: { title?: string; content?: string; active?: boolean }
): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 200);
  if (input.content !== undefined) {
    const content = input.content.trim().slice(0, 4000);
    if (!content) return { ok: false, error: "Content can't be empty." };
    patch.content = content;
  }
  if (input.active !== undefined) patch.active = input.active;
  if (Object.keys(patch).length === 0) return { ok: true, data: null };
  const { error } = await ctx.admin.from("knowledge_sources").update(patch).eq("id", id).eq("panel_id", panelId).eq("scope_type", "PROJECT");
  if (error) return { ok: false, error: "Couldn't update that entry." };
  return { ok: true, data: null };
}

export async function deleteProjectKnowledgeEntry(panelId: string, id: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("knowledge_sources").delete().eq("id", id).eq("panel_id", panelId).eq("scope_type", "PROJECT");
  if (error) return { ok: false, error: "Couldn't delete that entry." };
  return { ok: true, data: null };
}
