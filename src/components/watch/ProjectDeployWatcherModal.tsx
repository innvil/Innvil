"use client";

import React, { useState } from "react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { connectAccountCommunity, deployExistingWatcherToCommunity } from "@/src/lib/actions/watch-moderator";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";

export interface ProjectCommunityOption {
  id: string;
  title: string | null;
  chatId: string;
}

/** Project-centric "Add Watcher" flow — the canonical composition surface
 *  per the product decision (2026-08-25): a Watcher Profile is created in
 *  Watchers FIRST; this modal only VALIDATES/SELECTS an already-existing,
 *  already-bot-ready Watcher and deploys it into THIS Project — the Project
 *  id is fixed page context, never re-asked, never guessed. Deliberately
 *  does NOT offer a "create a new Watcher" form here (that would duplicate
 *  the Watchers area's own creation flow) — an account with no deployable
 *  Watcher yet is pointed at /watchers instead.
 *
 *  Two paths, both reusing EXISTING deployment machinery verbatim:
 *   - This Project already has a Community -> pick one + deploy directly
 *     (deployExistingWatcherToCommunity, no new Telegram verification
 *     needed — that already happened when the Community was first
 *     connected).
 *   - No existing Community (or the owner wants a NEW one) -> enter a
 *     Telegram chat/@handle, verified fresh via connectAccountCommunity
 *     (the SAME function the Watchers-page flow already uses), with
 *     projectId passed as this fixed page's own id. */
export function ProjectDeployWatcherModal({
  projectId, deployableWatchers, communities, onClose, onDeployed,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
  communities: ProjectCommunityOption[];
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [watcherId, setWatcherId] = useState(deployableWatchers[0]?.id ?? "");
  const [mode, setMode] = useState<"existing" | "new">(communities.length > 0 ? "existing" : "new");
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneTitle, setDoneTitle] = useState<string | null>(null);

  const deploy = async () => {
    if (!watcherId) return;
    setBusy(true);
    setError(null);
    const res =
      mode === "existing" && communityId
        ? await deployExistingWatcherToCommunity(watcherId, communityId)
        : await connectAccountCommunity(watcherId, projectId, chatInput.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDoneTitle(res.data.title ?? res.data.chatId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add Watcher to this Project">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md w-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="w-display text-base">Add Watcher</h3>
          <button onClick={onClose} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
        </div>

        {doneTitle ? (
          <div className="text-center py-4">
            <CheckCircle2 size={32} className="w-green mx-auto mb-3" />
            <p className="text-sm w-text mb-1">Deployed and live in</p>
            <p className="text-sm w-teal font-medium mb-5">{doneTitle}</p>
            <button onClick={() => { onDeployed(); onClose(); }} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg">Done</button>
          </div>
        ) : deployableWatchers.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm w-text-dim mb-4">No connected Watcher Profiles yet. Create and connect one from Watchers first.</p>
            <a href="/watchers" className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg inline-block">Go to Watchers</a>
          </div>
        ) : (
          <div>
            <label className="text-xs w-text-dim block mb-1">Watcher Profile</label>
            <select value={watcherId} onChange={(e) => setWatcherId(e.target.value)} className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3">
              {deployableWatchers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            {communities.length > 0 && (
              <div className="flex items-center gap-3 mb-3 text-sm w-text">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="mode" checked={mode === "existing"} onChange={() => setMode("existing")} />
                  Existing Community
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} />
                  New Community
                </label>
              </div>
            )}

            {mode === "existing" && communities.length > 0 ? (
              <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3">
                {communities.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.chatId}</option>)}
              </select>
            ) : (
              <>
                <label className="text-xs w-text-dim block mb-1">Telegram chat ID or @handle</label>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="@yourcommunity or -1001234567890"
                  className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
                />
              </>
            )}

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button
              onClick={deploy}
              disabled={busy || !watcherId || (mode === "existing" ? !communityId : !chatInput.trim())}
              className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Deploy"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
