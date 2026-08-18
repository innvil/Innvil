"use client";

import React, { useState } from "react";
import { Plus, X } from "lucide-react";
import { createWatchProject } from "@/src/lib/actions/watch-dashboard";

/** Small self-contained "New Project" modal trigger — reused by the Projects
 *  list page (and could be reused anywhere else a Project needs creating).
 *  On success it does a full reload so every server-fetched list on the page
 *  (Projects, and anything depending on capacity) stays in sync — same
 *  simplest-correct-refresh approach already used by the Overview page. */
export function CreateProjectButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createWatchProject(name.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    window.location.reload();
  };

  return (
    <>
      <button onClick={() => { setOpen(true); setName(""); setError(null); }} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
        <Plus size={14} /> New Project
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Create a Project">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm w-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="w-display text-base">Create a Project</h3>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
            </div>
            <p className="text-sm w-text-dim mb-3">Give your Project a name to get started.</p>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Project name"
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={submit} disabled={busy || !name.trim()} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60">
              <Plus size={14} /> {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
