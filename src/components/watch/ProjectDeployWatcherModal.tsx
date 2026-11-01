"use client";

import React, { useState } from "react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { deployExistingWatcherToCommunity } from "@/src/lib/actions/watch-moderator";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";

export interface ProjectCommunityOption {
  id: string;
  title: string | null;
  chatId: string;
}

/** Project-centric "Add Watcher" flow -- step 2 of the required
 *  Project -> Add Community -> Add Watcher sequence (step 1, connecting a
 *  brand-new Telegram chat, is ProjectAddCommunityModal's job now, kept as
 *  its own distinct action rather than folded in here). This modal only
 *  ever deploys an already-existing, already-bot-ready Watcher Profile into
 *  a Community that's already part of THIS Project -- the Project id is
 *  fixed page context, never re-asked, never guessed.
 *
 *  Deliberately does NOT offer a "create a new Watcher" form (that would
 *  duplicate the Watchers area's own creation flow -- an account with no
 *  deployable Watcher yet is pointed at /watchers instead), and no longer
 *  offers a raw Telegram-chat-input path either (a Project with zero
 *  Communities is told to Add Community first, matching the required
 *  sequence explicitly rather than silently letting this button skip it). */
export function ProjectDeployWatcherModal({
  deployableWatchers, communities, onClose, onDeployed,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
  communities: ProjectCommunityOption[];
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [watcherId, setWatcherId] = useState(deployableWatchers[0]?.id ?? "");
  const [communityId, setCommunityId] = useState(communities[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneTitle, setDoneTitle] = useState<string | null>(null);

  const deploy = async () => {
    if (!watcherId || !communityId) return;
    setBusy(true);
    setError(null);
    const res = await deployExistingWatcherToCommunity(watcherId, communityId);
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
        ) : communities.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm w-text-dim mb-1">This Project has no connected Communities yet.</p>
            <p className="text-xs w-text-faint">Use Add Community first, then come back to deploy a Watcher.</p>
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

            <label className="text-xs w-text-dim block mb-1">Community</label>
            <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3">
              {communities.map((c) => <option key={c.id} value={c.id}>{c.title ?? c.chatId}</option>)}
            </select>

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button
              onClick={deploy}
              disabled={busy || !watcherId || !communityId}
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
