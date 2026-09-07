"use server";

/**
 * Account-scoped Project Profile CRUD — mirrors `actions/project-profile.ts`
 * exactly (same `projects.description/website/docs_url/overview/contacts`
 * columns, same `ProjectProfile`/`ProjectContacts` shapes from
 * `moderator/project-profile.ts`), scoped by `projects.account_id` instead
 * of panel ownership. This is the "Knowledge" world for a standalone Watch
 * Project.
 *
 * IMPORTANT DISTINCTION (a real gap this pass fixes, not always true):
 * `description`/`website`/`docs_url` are plain metadata columns on
 * `projects` — the live Telegram runtime's own `loadProjectProfileRow`
 * (`community-runtime.ts`) only ever reads `overview`/`contacts` from that
 * row, NEVER `website`/`docs_url`. Saving a URL into "Website" or
 * "Documentation" alone does NOT ground a Watcher's answers by itself — a
 * Watcher answering "what's your project link?" with no knowledge of that
 * URL is the exact live-reported symptom of this gap.
 *
 * Fixed here: `updateAccountProjectProfile` now, on every save where a
 * Website/Documentation URL is present but not already successfully
 * ingested for its current value, runs it through the SAME real ingestion
 * pipeline the "Add URL" Knowledge Source flow uses
 * (`ingestUrlIntoProject`, `watch-project-knowledge.ts`) — fetch, extract,
 * chunk, persist as real PROJECT-scope `knowledge_sources` rows, which
 * `loadRelevantKnowledge` already retrieves with zero further runtime
 * changes. A cleared field removes its prior ingestion; an unreachable URL
 * persists a real 'failed' row + a reported error, never a silent no-op.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { CONTACT_KINDS, type ContactKind, type ProjectContacts, type ProjectProfile } from "@/src/lib/moderator/project-profile";
import { normalizeProfileUrl } from "@/src/lib/moderator/knowledge-ingestion";
import { ingestUrlIntoProject, type ProjectAdminClient } from "@/src/lib/actions/watch-project-knowledge";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface ProfileFieldIngestion {
  status: "ready" | "failed" | "cleared" | "unchanged";
  error?: string;
}

export interface ProfileUpdateOutcome {
  websiteIngestion?: ProfileFieldIngestion;
  docsIngestion?: ProfileFieldIngestion;
}

const PROFILE_FIELD_TITLE = { website: "Project website", docs_url: "Project documentation" } as const;

/** Keeps a Website/Documentation field's REAL ingested knowledge in sync
 *  with whatever URL is currently saved on it -- self-healing, not just
 *  change-triggered: an EXISTING project (saved before this fix shipped,
 *  or whose prior ingestion was manually removed) gets ingested on its
 *  very next profile save even if the visible field text itself didn't
 *  change, since eligibility is "is there already a real, matching, ready
 *  row?" rather than "did this specific save touch this field?". */
export async function syncProfileUrlKnowledge(admin: ProjectAdminClient, projectId: string, field: keyof typeof PROFILE_FIELD_TITLE, rawUrl: string): Promise<ProfileFieldIngestion> {
  const titleMarker = PROFILE_FIELD_TITLE[field];
  const { data: existingRows } = await admin
    .from("knowledge_sources")
    .select("source_url, status")
    .eq("project_id", projectId).eq("scope_type", "PROJECT").eq("source_type", "url")
    .ilike("title", `${titleMarker}%`)
    .limit(1);
  const existing = (existingRows ?? [])[0] as { source_url: string | null; status: string } | undefined;

  if (!rawUrl.trim()) {
    if (existing) await admin.from("knowledge_sources").delete().eq("project_id", projectId).eq("scope_type", "PROJECT").eq("source_type", "url").ilike("title", `${titleMarker}%`);
    return { status: "cleared" };
  }

  const normalized = normalizeProfileUrl(rawUrl);
  if (existing && existing.status === "ready" && existing.source_url === normalized) {
    return { status: "unchanged" };
  }

  await admin.from("knowledge_sources").delete().eq("project_id", projectId).eq("scope_type", "PROJECT").eq("source_type", "url").ilike("title", `${titleMarker}%`);
  const outcome = await ingestUrlIntoProject(admin, projectId, titleMarker, normalized);
  return outcome.ok ? { status: "ready" } : { status: "failed", error: outcome.error };
}

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
): Promise<Result<ProfileUpdateOutcome>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  const patch: Record<string, unknown> = {};
  if (input.description !== undefined) patch.description = input.description.trim().slice(0, 500);
  if (input.website !== undefined) patch.website = input.website.trim().slice(0, 300);
  if (input.docsUrl !== undefined) patch.docs_url = input.docsUrl.trim().slice(0, 300);
  if (input.overview !== undefined) patch.overview = input.overview.trim().slice(0, 6000);

  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from("projects").update(patch).eq("id", projectId);
    if (error) return { ok: false, error: "Couldn't update the Project profile." };
  }

  // Real ingestion runs AFTER the metadata save succeeds, so a slow/failed
  // fetch never blocks the rest of the profile from saving -- both fields
  // are checked on every save (self-healing, see syncProfileUrlKnowledge's
  // own doc comment), not just when their own input changed this time.
  const outcome: ProfileUpdateOutcome = {};
  if (input.website !== undefined) outcome.websiteIngestion = await syncProfileUrlKnowledge(admin, projectId, "website", input.website);
  if (input.docsUrl !== undefined) outcome.docsIngestion = await syncProfileUrlKnowledge(admin, projectId, "docs_url", input.docsUrl);

  return { ok: true, data: outcome };
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
