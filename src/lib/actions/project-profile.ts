"use server";

/**
 * Project Profile — owner-facing CRUD for the structured project identity +
 * contact presets (Phase 4.N simplification). See
 * src/lib/moderator/project-profile.ts's file header for the product
 * rationale. Reuses the same panel/project ownership pattern as
 * src/lib/actions/knowledge.ts.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { CONTACT_KINDS, type ContactKind, type ProjectContacts, type ProjectProfile } from "@/src/lib/moderator/project-profile";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ownedProject(panelId: string, projectId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  const { data: project } = await admin.from("projects").select("id, panel_id").eq("id", projectId).eq("panel_id", panelId).maybeSingle();
  if (!project) return null;
  return { user, admin };
}

function toProfile(r: Record<string, unknown>): ProjectProfile {
  const rawContacts = (r.contacts as ProjectContacts) ?? {};
  const contacts: ProjectContacts = {};
  for (const k of CONTACT_KINDS) if (rawContacts[k]) contacts[k] = rawContacts[k];
  return {
    id: r.id as string,
    panelId: r.panel_id as string,
    name: (r.name as string) ?? "",
    description: (r.description as string) ?? "",
    website: (r.website as string) ?? "",
    docsUrl: (r.docs_url as string) ?? "",
    overview: (r.overview as string) ?? "",
    contacts,
  };
}

export async function getProjectProfile(panelId: string, projectId: string): Promise<Result<ProjectProfile>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const { data, error } = await ctx.admin.from("projects").select("id, panel_id, name, description, website, docs_url, overview, contacts").eq("id", projectId).single();
  if (error || !data) return { ok: false, error: "Couldn't load project profile." };
  return { ok: true, data: toProfile(data) };
}

export async function updateProjectProfile(
  panelId: string,
  projectId: string,
  input: { name?: string; description?: string; website?: string; docsUrl?: string; overview?: string }
): Promise<Result<null>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 200);
    if (!name) return { ok: false, error: "Project name can't be empty." };
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500);
  if (input.website !== undefined) patch.website = input.website.trim().slice(0, 300);
  if (input.docsUrl !== undefined) patch.docs_url = input.docsUrl.trim().slice(0, 300);
  if (input.overview !== undefined) patch.overview = input.overview.trim().slice(0, 6000);
  if (Object.keys(patch).length === 0) return { ok: true, data: null };
  const { error } = await ctx.admin.from("projects").update(patch).eq("id", projectId).eq("panel_id", panelId);
  if (error) return { ok: false, error: "Couldn't update the project profile." };
  return { ok: true, data: null };
}

export async function setProjectContact(panelId: string, projectId: string, kind: ContactKind, value: string): Promise<Result<null>> {
  const ctx = await ownedProject(panelId, projectId);
  if (!ctx) return { ok: false, error: "Not authorized." };
  if (!CONTACT_KINDS.includes(kind)) return { ok: false, error: "Invalid contact kind." };
  const { data: current } = await ctx.admin.from("projects").select("contacts").eq("id", projectId).maybeSingle();
  const existing = (current?.contacts as ProjectContacts) ?? {};
  const trimmed = value.trim().slice(0, 200);
  const next: ProjectContacts = { ...existing };
  if (trimmed) next[kind] = trimmed;
  else delete next[kind];
  const { error } = await ctx.admin.from("projects").update({ contacts: next }).eq("id", projectId).eq("panel_id", panelId);
  if (error) return { ok: false, error: "Couldn't save that contact." };
  return { ok: true, data: null };
}
