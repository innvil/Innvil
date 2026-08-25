"use client";

import React, { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, RefreshCw, Trash2, Globe, FileText, Link as LinkIcon } from "lucide-react";
import { updateAccountProjectProfile, setAccountProjectContact, type ProfileFieldIngestion } from "@/src/lib/actions/watch-project-profile";
import { CONTACT_KINDS, CONTACT_LABELS, type ProjectProfile, type ContactKind } from "@/src/lib/moderator/project-profile";
import {
  listAccountProjectKnowledgeSources, addAccountProjectTextKnowledge, addAccountProjectUrlKnowledge,
  refreshAccountProjectKnowledgeSource, deleteAccountProjectKnowledgeSource, type ProjectKnowledgeSourceSummary,
} from "@/src/lib/actions/watch-project-knowledge";

/** Real Project intelligence editor. Description/Overview/Contacts write
 *  plain `projects` columns the live Telegram runtime reads directly
 *  (community-runtime.ts's loadProjectProfileRow) -- no further wiring
 *  needed for those. Website/Documentation are DIFFERENT: they're only a
 *  starting URL -- saving one triggers real server-side ingestion (fetch,
 *  extract, chunk) into the SAME retrievable Knowledge Sources a Watcher's
 *  Q&A answers draw from, via `updateAccountProjectProfile`'s returned
 *  ingestion status shown inline below each field, never a silent no-op. */
export function ProjectKnowledgeTab({ projectId, profile }: { projectId: string; profile: ProjectProfile }) {
  const [description, setDescription] = useState(profile.description);
  const [website, setWebsite] = useState(profile.website);
  const [docsUrl, setDocsUrl] = useState(profile.docsUrl);
  const [overview, setOverview] = useState(profile.overview);
  const [contacts, setContacts] = useState(profile.contacts);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [websiteIngestion, setWebsiteIngestion] = useState<ProfileFieldIngestion | null>(null);
  const [docsIngestion, setDocsIngestion] = useState<ProfileFieldIngestion | null>(null);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    const res = await updateAccountProjectProfile(projectId, { description, website, docsUrl, overview });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setSavedAt(Date.now());
    setWebsiteIngestion(res.data.websiteIngestion ?? null);
    setDocsIngestion(res.data.docsIngestion ?? null);
  };

  const saveContact = async (kind: ContactKind, value: string) => {
    setContacts((prev) => ({ ...prev, [kind]: value || undefined }));
    await setAccountProjectContact(projectId, kind, value);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="w-card p-5 space-y-4">
        <div>
          <label className="text-xs w-text-dim block mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A one-line description of this Project"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs w-text-dim block mb-1">Website</label>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="yourproject.com" className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border" />
            <IngestionStatus result={websiteIngestion} />
          </div>
          <div>
            <label className="text-xs w-text-dim block mb-1">Documentation</label>
            <input value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} placeholder="docs.yourproject.com" className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border" />
            <IngestionStatus result={docsIngestion} />
          </div>
        </div>
        <p className="text-[11px] w-text-faint -mt-2">Saving a Website/Documentation URL fetches and indexes its content for real -- Watchers can then answer questions from what's actually on the page, not just the link itself.</p>
        <div>
          <label className="text-xs w-text-dim block mb-1">Project overview</label>
          <p className="text-[11px] w-text-faint mb-1.5">The main fact base your Watchers draw from when answering questions in a Community.</p>
          <textarea
            value={overview}
            onChange={(e) => setOverview(e.target.value)}
            rows={8}
            placeholder="What is this Project? What should Watchers know when answering questions about it?"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-y"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex items-center gap-3">
          <button onClick={saveProfile} disabled={saving} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
          </button>
          {savedAt && <span className="text-xs w-teal flex items-center gap-1"><CheckCircle2 size={13} /> Saved</span>}
        </div>
      </div>

      <div className="w-card p-5">
        <h3 className="w-display text-sm mb-1">Contact presets</h3>
        <p className="text-xs w-text-faint mb-4">Authoritative answers for common contact questions — checked before general knowledge.</p>
        <div className="space-y-3">
          {CONTACT_KINDS.map((kind) => (
            <div key={kind}>
              <label className="text-xs w-text-dim block mb-1">{CONTACT_LABELS[kind]}</label>
              <input
                defaultValue={contacts[kind] ?? ""}
                onBlur={(e) => saveContact(kind, e.target.value)}
                placeholder="e.g. @yourhandle or support@yourproject.com"
                className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
              />
            </div>
          ))}
        </div>
      </div>

      <KnowledgeSourcesCard projectId={projectId} />
    </div>
  );
}

/** Inline feedback right under the Website/Documentation fields -- real
 *  ingestion outcome from the most recent save, never a fabricated
 *  success. `cleared`/`unchanged` render nothing (a no-op isn't news). */
function IngestionStatus({ result }: { result: ProfileFieldIngestion | null }) {
  if (!result || result.status === "cleared" || result.status === "unchanged") return null;
  if (result.status === "ready") {
    return <p className="text-[11px] w-teal flex items-center gap-1 mt-1"><CheckCircle2 size={11} /> Content fetched and indexed</p>;
  }
  return <p className="text-[11px] text-red-400 flex items-center gap-1 mt-1"><AlertTriangle size={11} /> Couldn't fetch: {result.error ?? "unknown error"}</p>;
}

const STATUS_LABEL: Record<ProjectKnowledgeSourceSummary["status"], string> = { pending: "Processing", ready: "Ready", failed: "Failed" };
const STATUS_CLASS: Record<ProjectKnowledgeSourceSummary["status"], string> = {
  pending: "w-amber-soft-bg w-amber", ready: "w-teal-soft-bg w-teal", failed: "bg-red-500/10 text-red-400",
};
const SOURCE_ICON: Record<ProjectKnowledgeSourceSummary["sourceType"], typeof Globe> = { text: FileText, url: Globe, pdf: FileText };

/** Real ingested knowledge sources -- plain text entries, and URL sources
 *  that were actually FETCHED server-side (never a bare stored string; see
 *  watch-project-knowledge.ts). Each source shows its real state (Ready /
 *  Processing / Failed) and, for a URL, a Refresh action to re-fetch it.
 *  Never renders a raw internal storage key -- only the owner-given title
 *  and (for URL sources) the source URL itself. */
function KnowledgeSourcesCard({ projectId }: { projectId: string }) {
  const [sources, setSources] = useState<ProjectKnowledgeSourceSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [addMode, setAddMode] = useState<"text" | "url">("url");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const res = await listAccountProjectKnowledgeSources(projectId);
    if (!res.ok) { setLoadError(res.error); return; }
    setLoadError(null);
    setSources(res.data);
  };

  useEffect(() => { void load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    setAdding(true);
    setActionError(null);
    const res =
      addMode === "text"
        ? await addAccountProjectTextKnowledge(projectId, { kind: "fact", title, content })
        : await addAccountProjectUrlKnowledge(projectId, title, url);
    setAdding(false);
    if (!res.ok) { setActionError(res.error); return; }
    setTitle(""); setContent(""); setUrl("");
    await load();
  };

  const refresh = async (key: string) => {
    setBusyKey(key);
    setActionError(null);
    const res = await refreshAccountProjectKnowledgeSource(projectId, key);
    setBusyKey(null);
    if (!res.ok) { setActionError(res.error); return; }
    await load();
  };

  const remove = async (key: string) => {
    setBusyKey(key);
    setActionError(null);
    const res = await deleteAccountProjectKnowledgeSource(projectId, key);
    setBusyKey(null);
    if (!res.ok) { setActionError(res.error); return; }
    await load();
  };

  return (
    <div className="w-card p-5">
      <h3 className="w-display text-sm mb-1">Knowledge sources</h3>
      <p className="text-xs w-text-faint mb-4">
        A website/docs URL is fetched and its real content becomes retrievable knowledge — never just the stored link.
      </p>

      {loadError ? (
        <p className="text-xs text-red-400">{loadError}</p>
      ) : sources === null ? (
        <p className="text-xs w-text-faint">Loading…</p>
      ) : (
        <div className="space-y-2 mb-4">
          {sources.length === 0 && <p className="text-xs w-text-faint">No sources added yet.</p>}
          {sources.map((s) => {
            const Icon = SOURCE_ICON[s.sourceType];
            return (
              <div key={s.key} className="flex items-center justify-between gap-3 w-surface-raised border w-line-soft rounded-lg px-3 py-2.5">
                <div className="min-w-0 flex items-start gap-2.5">
                  <Icon size={14} className="w-text-faint shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm w-text truncate">{s.title || "Untitled"}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`w-pill text-[10px] ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                      {s.chunkCount > 1 && <span className="text-[10px] w-text-faint">{s.chunkCount} sections</span>}
                      {s.sourceUrl && <span className="text-[10px] w-text-faint truncate max-w-[220px]">{s.sourceUrl}</span>}
                    </div>
                    {s.status === "failed" && s.error && (
                      <p className="text-[11px] text-red-400 flex items-center gap-1 mt-1"><AlertTriangle size={10} /> {s.error}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.sourceType === "url" && (
                    <button onClick={() => void refresh(s.key)} disabled={busyKey === s.key} title="Refresh" className="w-text-faint hover:w-text p-1 disabled:opacity-50">
                      {busyKey === s.key ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    </button>
                  )}
                  <button onClick={() => void remove(s.key)} disabled={busyKey === s.key} title="Remove" className="w-text-faint hover:text-red-400 p-1 disabled:opacity-50">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t w-line-soft pt-4">
        <div className="flex items-center gap-3 mb-3 text-sm w-text">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="addMode" checked={addMode === "url"} onChange={() => setAddMode("url")} />
            <LinkIcon size={12} /> Website / docs URL
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="addMode" checked={addMode === "text"} onChange={() => setAddMode("text")} />
            <FileText size={12} /> Plain text
          </label>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Documentation)"
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-2"
        />
        {addMode === "url" ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-2"
          />
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="Fact, note, or FAQ content"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border resize-y mb-2"
          />
        )}
        {actionError && <p className="text-xs text-red-400 mb-2">{actionError}</p>}
        <button
          onClick={add}
          disabled={adding || !title.trim() || (addMode === "url" ? !url.trim() : !content.trim())}
          className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60"
        >
          {adding ? <Loader2 size={13} className="animate-spin" /> : addMode === "url" ? "Fetch & add" : "Add"}
        </button>
      </div>
    </div>
  );
}
