"use client";

import React, { useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { updateAccountProjectProfile, setAccountProjectContact } from "@/src/lib/actions/watch-project-profile";
import { CONTACT_KINDS, CONTACT_LABELS, type ProjectProfile, type ContactKind } from "@/src/lib/moderator/project-profile";

/** Real Project intelligence editor — reads/writes the SAME `projects
 *  .description/website/docs_url/overview/contacts` columns the live
 *  Telegram runtime already grounds a Watcher's Q&A answers with
 *  (community-runtime.ts's loadProjectProfileRow, unchanged, no runtime
 *  wiring needed). Saving here takes effect on the next real Telegram
 *  message a deployed Watcher answers. */
export function ProjectKnowledgeTab({ projectId, profile }: { projectId: string; profile: ProjectProfile }) {
  const [description, setDescription] = useState(profile.description);
  const [website, setWebsite] = useState(profile.website);
  const [docsUrl, setDocsUrl] = useState(profile.docsUrl);
  const [overview, setOverview] = useState(profile.overview);
  const [contacts, setContacts] = useState(profile.contacts);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    const res = await updateAccountProjectProfile(projectId, { description, website, docsUrl, overview });
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setSavedAt(Date.now());
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
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border" />
          </div>
          <div>
            <label className="text-xs w-text-dim block mb-1">Documentation</label>
            <input value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} placeholder="https://…" className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border" />
          </div>
        </div>
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
    </div>
  );
}
