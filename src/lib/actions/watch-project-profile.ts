"use server";

/**
 * Account-scoped Project Profile CRUD — mirrors `actions/project-profile.ts`
 * exactly (same `projects.description/website/docs_url/overview/contacts`
 * columns, same `ProjectProfile`/`ProjectContacts` shapes from
 * `moderator/project-profile.ts`), scoped by `projects.account_id` instead
 * of panel ownership. This is the "Knowledge" world for a standalone Watch
 * Project — real, not a placeholder: the live Telegram runtime's own
 * `loadProjectProfileRow` (`community-runtime.ts`) already reads `projects
 * .overview`/`contacts` by project id with NO panel filter at all, so
 * whatever's saved here is already grounding a deployed Watcher's Q&A
 * answers end-to-end, with zero runtime changes needed.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { CONTACT_KINDS, type ContactKind, type ProjectContacts, type ProjectProfile } from "@/src/lib/moderator/project-profile";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function ownedProject(accountId: string, projectId: string, admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"]) {
  const { data: project } = await admin.from("projects").select("id, account_id").eq("id", projectId).maybeSingle();
  if (!project || project.account_id !== accountId) return null;
  return project;
}

function toProfile(r: Record<string, unknown>): ProjectProfile {
  const rawContacts = (r.contacts as ProjectContacts) ?? {};
  const contacts: ProjectContacts = {};
  for (const k of CONTACT_KINDS) if (rawContacts[k]) contacts[k] = rawContacts[k];
  return {
    id: r.id as string,
    panelId: (r.panel_id as string | null) ?? "",
    name: (r.name as string) ?? "",
    description: (r.description as string) ?? "",
    website: (r.website as string) ?? "",
    docsUrl: (r.docs_url as string) ?? "",
    overview: (r.overview as string) ?? "",
    contacts,
  };
}

export async function getAccountProjectProfile(projectId: string): Promise<Result<ProjectProfile>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };
  const { data, error } = await admin.from("projects").select("id, panel_id, name, description, website, docs_url, overview, contacts").eq("id", projectId).single();
  if (error || !data) return { ok: false, error: "Couldn't load the Project profile." };
  return { ok: true, data: toProfile(data) };
}

export async function updateAccountProjectProfile(
  projectId: string,
  input: { description?: string; website?: string; docsUrl?: string; overview?: string }
): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500);
  if (input.website !== undefined) patch.website = input.website.trim().slice(0, 300);
  if (input.docsUrl !== undefined) patch.docs_url = input.docsUrl.trim().slice(0, 300);
  if (input.overview !== undefined) patch.overview = input.overview.trim().slice(0, 6000);
  if (Object.keys(patch).length === 0) return { ok: true, data: null };

  const { error } = await admin.from("projects").update(patch).eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't update the Project profile." };
  return { ok: true, data: null };
}

export async function setAccountProjectContact(projectId: string, kind: ContactKind, value: string): Promise<Result> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };
  if (!CONTACT_KINDS.includes(kind)) return { ok: false, error: "Invalid contact kind." };

  const { data: current } = await admin.from("projects").select("contacts").eq("id", projectId).maybeSingle();
  const existing = (current?.contacts as ProjectContacts) ?? {};
  const trimmed = value.trim().slice(0, 200);
  const next: ProjectContacts = { ...existing };
  if (trimmed) next[kind] = trimmed;
  else delete next[kind];

  const { error } = await admin.from("projects").update({ contacts: next }).eq("id", projectId);
  if (error) return { ok: false, error: "Couldn't save that contact." };
  return { ok: true, data: null };
}
