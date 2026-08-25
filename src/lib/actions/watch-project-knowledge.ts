"use server";

/**
 * Real Project Knowledge ingestion — account-scoped (mirrors
 * `watch-project-profile.ts`'s exact `projects.account_id === user.id`
 * ownership check, never `ownedPanel`), zero-Panel. Extends the SAME
 * `knowledge_sources` table `community-runtime.ts`'s `loadRelevantKnowledge`
 * already reads for PROJECT scope — that query has no `panel_id` filter at
 * all for the PROJECT branch, so a row written here (`panel_id: null`) is
 * retrievable by a deployed Watcher with ZERO runtime changes needed.
 *
 * A URL/PDF source becomes N `knowledge_sources` CHUNK rows sharing one
 * `ingestion_id` (see migration 0106) — the EXISTING per-row relevance
 * scorer (`retrieveRelevantKnowledge`, knowledge.ts, unmodified) already
 * ranks/retrieves individual rows, so chunking a long document into several
 * rows needs no retrieval-layer change; the chunks simply compete for
 * relevance like any other Fact/FAQ row.
 */

import { randomUUID, createHash } from "node:crypto";
import { getAuthedAdmin } from "@/src/lib/auth";
import { KNOWLEDGE_KINDS, type KnowledgeSourceKind } from "@/src/lib/moderator/knowledge";
import { validateIngestUrl, chunkText } from "@/src/lib/moderator/knowledge-ingestion";
import { fetchAndExtractUrl } from "@/src/lib/moderator/knowledge-fetch";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function ownedProject(accountId: string, projectId: string, admin: Awaited<ReturnType<typeof getAuthedAdmin>>["admin"]) {
  const { data: project } = await admin.from("projects").select("id, account_id").eq("id", projectId).maybeSingle();
  if (!project || project.account_id !== accountId) return null;
  return project;
}

export interface ProjectKnowledgeSourceSummary {
  /** Stable identifier this UI/actions use to refer to ONE logical source
   *  (a manual text entry = "row:<id>"; a URL/PDF ingestion, however many
   *  chunk rows it expanded into = "ing:<ingestion_id>") -- never the raw
   *  chunk row id, which is an implementation detail. */
  key: string;
  sourceType: "text" | "url" | "pdf";
  title: string;
  status: "pending" | "ready" | "failed";
  error: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
  chunkCount: number;
  active: boolean;
}

const KNOWLEDGE_SELECT = "id, kind, title, content, active, source_type, source_url, storage_path, status, error, content_hash, fetched_at, ingestion_id, chunk_index, created_at";

/** Lists Project Knowledge SOURCES (one row per logical source, not per
 *  chunk) -- a URL ingestion that expanded into 12 chunk rows shows as a
 *  single "Website" card here, matching the UI's own "source state must be
 *  understandable" requirement. */
export async function listAccountProjectKnowledgeSources(projectId: string): Promise<Result<ProjectKnowledgeSourceSummary[]>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  const { data, error } = await admin
    .from("knowledge_sources")
    .select(KNOWLEDGE_SELECT)
    .eq("project_id", projectId)
    .eq("scope_type", "PROJECT")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: "Couldn't load Project knowledge." };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const grouped = new Map<string, ProjectKnowledgeSourceSummary>();
  for (const r of rows) {
    const ingestionId = r.ingestion_id as string | null;
    const key = ingestionId ? `ing:${ingestionId}` : `row:${r.id as string}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.chunkCount += 1;
      // The first chunk (chunk_index 0) carries the canonical title/status/
      // error for the whole source -- later chunks never override it.
      continue;
    }
    grouped.set(key, {
      key,
      sourceType: (r.source_type as ProjectKnowledgeSourceSummary["sourceType"]) ?? "text",
      title: (r.title as string) ?? "",
      status: (r.status as ProjectKnowledgeSourceSummary["status"]) ?? "ready",
      error: (r.error as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      fetchedAt: (r.fetched_at as string | null) ?? null,
      chunkCount: 1,
      active: r.active !== false,
    });
  }
  return { ok: true, data: Array.from(grouped.values()) };
}

/** Plain manually-typed text entry -- source_type='text', a single
 *  ungrouped row (ingestion_id null), exactly the pre-existing behavior. */
export async function addAccountProjectTextKnowledge(
  projectId: string,
  input: { kind: KnowledgeSourceKind; title: string; content: string }
): Promise<Result<null>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };
  if (!KNOWLEDGE_KINDS.includes(input.kind)) return { ok: false, error: "Invalid knowledge kind." };
  const title = input.title.trim().slice(0, 200);
  const content = input.content.trim().slice(0, 4000);
  if (!content) return { ok: false, error: "Content can't be empty." };

  const { error } = await admin.from("knowledge_sources").insert({
    panel_id: null, scope_type: "PROJECT", project_id: projectId, kind: input.kind, title, content, active: true, source_type: "text",
  });
  if (error) return { ok: false, error: "Couldn't save that entry." };
  return { ok: true, data: null };
}

/** Real URL ingestion (spec §4/§5, the actual product correction this pass
 *  implements): validates, fetches server-side under SSRF-guarded
 *  conditions, extracts readable text, chunks it, and persists N rows
 *  sharing one ingestion_id -- a real, retrievable fact base, never a bare
 *  stored string. Failure never fabricates content: a failed fetch leaves
 *  a single 'failed' row (or none, on the very first attempt) with a real
 *  short error message, never a row claiming success with empty/guessed
 *  content. */
export async function addAccountProjectUrlKnowledge(projectId: string, title: string, url: string): Promise<Result<{ key: string; chunkCount: number }>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  const validated = validateIngestUrl(url);
  if (!validated.ok) return { ok: false, error: validated.error ?? "Invalid URL." };
  const trimmedTitle = title.trim().slice(0, 200) || url.trim().slice(0, 200);
  const ingestionId = randomUUID();

  const fetched = await fetchAndExtractUrl(url);
  if (!fetched.ok || !fetched.text) {
    await admin.from("knowledge_sources").insert({
      panel_id: null, scope_type: "PROJECT", project_id: projectId, kind: "link", title: trimmedTitle, content: "",
      active: true, source_type: "url", source_url: url.trim(), status: "failed", error: (fetched.error ?? "Ingestion failed.").slice(0, 300),
      ingestion_id: ingestionId, chunk_index: 0, fetched_at: new Date().toISOString(),
    });
    return { ok: false, error: fetched.error ?? "Couldn't fetch that URL." };
  }

  const chunks = chunkText(fetched.text);
  if (chunks.length === 0) {
    await admin.from("knowledge_sources").insert({
      panel_id: null, scope_type: "PROJECT", project_id: projectId, kind: "link", title: trimmedTitle, content: "",
      active: true, source_type: "url", source_url: url.trim(), status: "failed", error: "No readable content was found on that page.",
      ingestion_id: ingestionId, chunk_index: 0, fetched_at: new Date().toISOString(),
    });
    return { ok: false, error: "No readable content was found on that page." };
  }

  const contentHash = createHash("sha256").update(fetched.text).digest("hex");
  const fetchedAt = new Date().toISOString();
  const rows = chunks.map((c) => ({
    panel_id: null, scope_type: "PROJECT", project_id: projectId, kind: "link",
    title: chunks.length > 1 ? `${trimmedTitle} (part ${c.index + 1}/${chunks.length})` : trimmedTitle,
    content: c.content, active: true, source_type: "url", source_url: url.trim(), storage_path: null,
    status: "ready", error: null, content_hash: contentHash, fetched_at: fetchedAt, ingestion_id: ingestionId, chunk_index: c.index,
  }));
  const { error } = await admin.from("knowledge_sources").insert(rows);
  if (error) return { ok: false, error: "Fetched the page, but couldn't save it." };
  return { ok: true, data: { key: `ing:${ingestionId}`, chunkCount: chunks.length } };
}

/** Re-fetches a URL source's live content. If the extracted content is
 *  byte-identical to what's already stored (same sha256), this is a no-op
 *  that only bumps `fetched_at` -- never creates duplicate derived rows for
 *  an unchanged source. A genuine change atomically replaces every old
 *  chunk row with the freshly chunked content under the SAME ingestion_id. */
export async function refreshAccountProjectKnowledgeSource(projectId: string, key: string): Promise<Result<null>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };
  if (!key.startsWith("ing:")) return { ok: false, error: "Only URL sources can be refreshed." };
  const ingestionId = key.slice(4);

  const { data: existingRows } = await admin
    .from("knowledge_sources")
    .select("id, title, source_url, source_type, content_hash")
    .eq("project_id", projectId)
    .eq("scope_type", "PROJECT")
    .eq("ingestion_id", ingestionId)
    .order("chunk_index", { ascending: true });
  const first = (existingRows ?? [])[0] as Record<string, unknown> | undefined;
  if (!first || first.source_type !== "url" || !first.source_url) return { ok: false, error: "Source not found." };

  const baseTitle = (first.title as string).replace(/\s*\(part \d+\/\d+\)$/, "");
  const fetched = await fetchAndExtractUrl(first.source_url as string);
  if (!fetched.ok || !fetched.text) {
    await admin.from("knowledge_sources").update({ status: "failed", error: (fetched.error ?? "Refresh failed.").slice(0, 300), fetched_at: new Date().toISOString() }).eq("project_id", projectId).eq("ingestion_id", ingestionId).eq("chunk_index", 0);
    return { ok: false, error: fetched.error ?? "Couldn't refresh that URL." };
  }

  const contentHash = createHash("sha256").update(fetched.text).digest("hex");
  if (contentHash === (first.content_hash as string | null)) {
    await admin.from("knowledge_sources").update({ fetched_at: new Date().toISOString() }).eq("project_id", projectId).eq("ingestion_id", ingestionId);
    return { ok: true, data: null };
  }

  const chunks = chunkText(fetched.text);
  const fetchedAt = new Date().toISOString();
  await admin.from("knowledge_sources").delete().eq("project_id", projectId).eq("ingestion_id", ingestionId);
  const rows = chunks.map((c) => ({
    panel_id: null, scope_type: "PROJECT", project_id: projectId, kind: "link",
    title: chunks.length > 1 ? `${baseTitle} (part ${c.index + 1}/${chunks.length})` : baseTitle,
    content: c.content, active: true, source_type: "url", source_url: first.source_url, storage_path: null,
    status: "ready", error: null, content_hash: contentHash, fetched_at: fetchedAt, ingestion_id: ingestionId, chunk_index: c.index,
  }));
  if (rows.length) await admin.from("knowledge_sources").insert(rows);
  return { ok: true, data: null };
}

/** Deletes a logical source -- every chunk row sharing its ingestion_id
 *  (url/pdf), or the single manual row (text) -- always scoped by
 *  project_id, so a source can never be deleted by anything other than the
 *  Project that owns it. */
export async function deleteAccountProjectKnowledgeSource(projectId: string, key: string): Promise<Result<null>> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  const project = await ownedProject(user.id, projectId, admin);
  if (!project) return { ok: false, error: "Not authorized." };

  if (key.startsWith("ing:")) {
    const { error } = await admin.from("knowledge_sources").delete().eq("project_id", projectId).eq("ingestion_id", key.slice(4));
    if (error) return { ok: false, error: "Couldn't delete that source." };
  } else if (key.startsWith("row:")) {
    const { error } = await admin.from("knowledge_sources").delete().eq("project_id", projectId).eq("id", key.slice(4));
    if (error) return { ok: false, error: "Couldn't delete that source." };
  } else {
    return { ok: false, error: "Unknown source." };
  }
  return { ok: true, data: null };
}
