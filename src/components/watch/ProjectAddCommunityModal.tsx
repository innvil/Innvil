"use client";

import React, { useState } from "react";
import { X, Loader2, CheckCircle2 } from "lucide-react";
import { connectAccountCommunity } from "@/src/lib/actions/watch-moderator";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";

/** Project-centric "Add Community" -- the FIRST step in the required
 *  Project -> Add Community -> Add Watcher sequence, kept as its own
 *  dedicated modal rather than folded into the Watcher-deployment one
 *  (that conflation was the actual gap reported: the Communities tab only
 *  ever offered an "Add Watcher" button, with no distinct way to connect a
 *  brand-new Telegram chat to this Project at all).
 *
 *  Connecting a NEW Telegram community structurally requires an already
 *  bot-ready Watcher's own credential to verify membership (Telegram has
 *  no anonymous "does this chat exist" check) -- so this modal has the
 *  customer pick WHICH already-connected Watcher's bot to use for that
 *  verification, then reuses `connectAccountCommunity` verbatim (the exact
 *  same function the Watchers-page connect flow already calls) with THIS
 *  fixed `projectId`, never re-asked, never guessed. */
export function ProjectAddCommunityModal({
  projectId, deployableWatchers, onClose, onConnected,
}: {
  projectId: string;
  deployableWatchers: AccountWatcherRow[];
  onClose: () => void;
  onConnected: () => void;
}) {
  const [watcherId, setWatcherId] = useState(deployableWatchers[0]?.id ?? "");
  const [chatInput, setChatInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneTitle, setDoneTitle] = useState<string | null>(null);

  const connect = async () => {
    if (!watcherId || !chatInput.trim()) return;
    setBusy(true);
    setError(null);
    const res = await connectAccountCommunity(watcherId, projectId, chatInput.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDoneTitle(res.data.title ?? res.data.chatId);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Add Community to this Project">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md w-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="w-display text-base">Add Community</h3>
          <button onClick={onClose} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
        </div>

        {doneTitle ? (
          <div className="text-center py-4">
            <CheckCircle2 size={32} className="w-green mx-auto mb-3" />
            <p className="text-sm w-text mb-1">Connected and live in</p>
            <p className="text-sm w-teal font-medium mb-5">{doneTitle}</p>
            <button onClick={() => { onConnected(); onClose(); }} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg">Done</button>
          </div>
        ) : deployableWatchers.length === 0 ? (
          <div className="text-center py-4">
            <p className="text-sm w-text-dim mb-4">Connecting a Community verifies real Telegram membership through one of your Watcher bots -- create and connect a Watcher Profile first.</p>
            <a href="/watchers" className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg inline-block">Go to Watchers</a>
          </div>
        ) : (
          <div>
            <p className="text-sm w-text-dim mb-3">Add the Watcher's bot to your Telegram group/channel, then verify the connection here.</p>
            <label className="text-xs w-text-dim block mb-1">Verify using Watcher</label>
            <select value={watcherId} onChange={(e) => setWatcherId(e.target.value)} className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3">
              {deployableWatchers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label className="text-xs w-text-dim block mb-1">Telegram chat ID or @handle</label>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="@yourcommunity or -1001234567890"
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button
              onClick={connect}
              disabled={busy || !watcherId || !chatInput.trim()}
              className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Connect community"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
