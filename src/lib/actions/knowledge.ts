"use server";

/**
 * Organization + Project + Community Knowledge — owner-facing CRUD
 * (Phase 4.N parts A + C, corrected to the Panel -> Project -> Community
 * hierarchy). See src/lib/moderator/knowledge.ts's file header for the full
 * scope/precedence rationale.
 *
 * Ownership chain enforced on every write: panel owner -> owns project ->
 * project owns community. Every query filters by panel_id (and project_id/
 * community_id where relevant) rather than trusting a client-supplied id in
 * isolation, so a cross-panel or cross-project write is structurally
 * impossible, not just prompted against.
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

/** Project must both exist AND belong to a panel this user owns. */
async function ownedProject(panelId: string, projectId: string) {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const { data: project } = await ctx.admin.from("projects").select("id, panel_id, name").eq("id", projectId).eq("panel_id", panelId).maybeSingle();
  if (!project) return null;
  return { ...ctx, project };
}

/** Community must both exist AND belong to a panel this user owns — never
 *  trusts a client-supplied communityId without this check (spec §8: strict
 *  isolation enforced in data queries, never by prompting alone). Also
 *  resolves the community's project (every community belongs to exactly
 *  one), since Community Knowledge writes/reads need that context too. */
async function ownedCommunity(panelId: string, communityId: string) {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const { data: community } = await ctx.admin
    .from("communities")
    .select("id, panel_id, project_id, title, handle, chat_id, projects(id, name)")
    .eq("id", communityId)
    .eq("panel_id", panelId)
    .maybeSingle();
  if (!community) return null;
  const project = Array.isArray(community.projects) ? community.projects[0] : community.projects;
  return { ...ctx, community, project: project as { id: string; name: string } | null };
}

function toRow(r: Record<string, unknown>): KnowledgeSource {
  return {
    id: r.id as string,
    panelId: r.panel_id as string,
    scopeType: r.scope_type as KnowledgeSource["scopeType"],
    projectId: (r.project_id as string) ?? null,
    communityId: (r.community_id as string) ?? null,
    kind: r.kind as KnowledgeSourceKind,
    title: (r.title as string) ?? "",
    content: (r.content as string) ?? "",
    active: r.active !== false,
  };
}

const KNOWLEDGE_SELECT = "id, panel_id, scope_type, project_id, community_id, kind, title, content, active";

/* ------------------------------------------------------------- projects ---- */

export interface PanelProjectOption {
  id: string;
  name: string;
}

export async function listPanelProjects(panelId: string): Promise<Result<PanelProjectOption[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin.from("projects").select("id, name").eq("panel_id", panelId).order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load projects." };
  return { ok: true, data: (data ?? []).map((r) => ({ id: r.id, name: r.name })) };
}

export async function createProject(panelId: string, name: string): Promise<Result<PanelProjectOption>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const trimmed = name.trim().slice(0, 200);
  if (!trimmed) return { ok: false, error: "Project name can't be empty." };
  const { data, error } = await ctx.admin.from("projects").insert({ panel_id: panelId, account_id: ctx.user.id, name: trimmed }).select("id, name").single();
  if (error || !data) return { ok: false, error: "Couldn't create the project." };
  return { ok: true, data: { id: data.id, name: data.name } };
}

/* -------------------------------------------------------- project knowledge ---- */

export async function listProjectKnowledge(panelId: string, projectId: string): Promise<Result<KnowledgeSource[]>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .select(KNOWLEDGE_SELECT)
    .eq("project_id", projectId)
    .eq("scope_type", "PROJECT")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load project knowledge." };
  return { ok: true, data: (data ?? []).map(toRow) };
}

export async function createProjectKnowledgeEntry(
  panelId: string,
  projectId: string,
  input: { kind: KnowledgeSourceKind; title: string; content: string }
): Promise<Result<KnowledgeSource>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  if (!KNOWLEDGE_KINDS.includes(input.kind)) return { ok: false, error: "Invalid knowledge kind." };
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, 4000);
  if (!content) return { ok: false, error: "Content can't be empty." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .insert({ panel_id: panelId, scope_type: "PROJECT", project_id: projectId, kind: input.kind, title, content, active: true })
    .select(KNOWLEDGE_SELECT)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that entry." };
  return { ok: true, data: toRow(data) };
}

export async function updateProjectKnowledgeEntry(
  panelId: string,
  projectId: string,
  id: string,
  input: { title?: string; content?: string; active?: boolean }
): Promise<Result<null>> {
  const ctx = await ownedProject(panelId, projectId);
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
  const { error } = await ctx.admin.from("knowledge_sources").update(patch).eq("id", id).eq("project_id", projectId).eq("scope_type", "PROJECT");
  if (error) return { ok: false, error: "Couldn't update that entry." };
  return { ok: true, data: null };
}

export async function deleteProjectKnowledgeEntry(panelId: string, projectId: string, id: string): Promise<Result<null>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("knowledge_sources").delete().eq("id", id).eq("project_id", projectId).eq("scope_type", "PROJECT");
  if (error) return { ok: false, error: "Couldn't delete that entry." };
  return { ok: true, data: null };
}

/* --------------------------------------------------- organization knowledge ---- */
// Panel-wide, shared across every project the panel owns. Truly global facts
// only (company info, legal, shared policy) -- NEVER project-specific
// information (see knowledge.ts's file header).

export async function listOrganizationKnowledge(panelId: string): Promise<Result<KnowledgeSource[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .select(KNOWLEDGE_SELECT)
    .eq("panel_id", panelId)
    .eq("scope_type", "ORGANIZATION")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load organization knowledge." };
  return { ok: true, data: (data ?? []).map(toRow) };
}

export async function createOrganizationKnowledgeEntry(
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
    .insert({ panel_id: panelId, scope_type: "ORGANIZATION", kind: input.kind, title, content, active: true })
    .select(KNOWLEDGE_SELECT)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that entry." };
  return { ok: true, data: toRow(data) };
}

export async function updateOrganizationKnowledgeEntry(
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
  const { error } = await ctx.admin.from("knowledge_sources").update(patch).eq("id", id).eq("panel_id", panelId).eq("scope_type", "ORGANIZATION");
  if (error) return { ok: false, error: "Couldn't update that entry." };
  return { ok: true, data: null };
}

export async function deleteOrganizationKnowledgeEntry(panelId: string, id: string): Promise<Result<null>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("knowledge_sources").delete().eq("id", id).eq("panel_id", panelId).eq("scope_type", "ORGANIZATION");
  if (error) return { ok: false, error: "Couldn't delete that entry." };
  return { ok: true, data: null };
}

/* ---------------------------------------------------- community knowledge ---- */

export interface PanelCommunityOption {
  id: string;
  title: string | null;
  handle: string | null;
  chatId: string;
  projectId: string;
  projectName: string;
}

/** Every community connected to this panel, WITH its resolved project name
 *  — powers the community selector in the Community Knowledge editor, which
 *  must show "which project" a community belongs to (never a silent,
 *  ambiguous selection — see AdminTabs.tsx's CommunityKnowledgeCard). */
export async function listPanelCommunities(panelId: string): Promise<Result<PanelCommunityOption[]>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("communities")
    .select("id, title, handle, chat_id, project_id, projects(name)")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load communities." };
  const rows = (data ?? []).map((r: any) => {
    const project = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return { id: r.id, title: r.title, handle: r.handle, chatId: r.chat_id, projectId: r.project_id, projectName: project?.name ?? "Project" };
  });
  return { ok: true, data: rows };
}

export async function listCommunityKnowledge(panelId: string, communityId: string): Promise<Result<KnowledgeSource[]>> {
  const ctx = await ownedCommunity(panelId, communityId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .select(KNOWLEDGE_SELECT)
    .eq("community_id", communityId)
    .eq("scope_type", "COMMUNITY")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load community knowledge." };
  return { ok: true, data: (data ?? []).map(toRow) };
}

export async function createCommunityKnowledgeEntry(
  panelId: string,
  communityId: string,
  input: { kind: KnowledgeSourceKind; title: string; content: string }
): Promise<Result<KnowledgeSource>> {
  const ctx = await ownedCommunity(panelId, communityId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  if (!KNOWLEDGE_KINDS.includes(input.kind)) return { ok: false, error: "Invalid knowledge kind." };
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, 4000);
  if (!content) return { ok: false, error: "Content can't be empty." };
  const { data, error } = await ctx.admin
    .from("knowledge_sources")
    .insert({ panel_id: panelId, scope_type: "COMMUNITY", community_id: communityId, kind: input.kind, title, content, active: true })
    .select(KNOWLEDGE_SELECT)
    .single();
  if (error || !data) return { ok: false, error: "Couldn't save that entry." };
  return { ok: true, data: toRow(data) };
}

export async function updateCommunityKnowledgeEntry(
  panelId: string,
  communityId: string,
  id: string,
  input: { title?: string; content?: string; active?: boolean }
): Promise<Result<null>> {
  const ctx = await ownedCommunity(panelId, communityId);
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
  const { error } = await ctx.admin.from("knowledge_sources").update(patch).eq("id", id).eq("community_id", communityId).eq("scope_type", "COMMUNITY");
  if (error) return { ok: false, error: "Couldn't update that entry." };
  return { ok: true, data: null };
}

export async function deleteCommunityKnowledgeEntry(panelId: string, communityId: string, id: string): Promise<Result<null>> {
  const ctx = await ownedCommunity(panelId, communityId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { error } = await ctx.admin.from("knowledge_sources").delete().eq("id", id).eq("community_id", communityId).eq("scope_type", "COMMUNITY");
  if (error) return { ok: false, error: "Couldn't delete that entry." };
  return { ok: true, data: null };
}
