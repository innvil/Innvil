"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bot, Loader2, Plus } from "lucide-react";
import { createWatcher } from "@/src/lib/actions/watch-dashboard";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import type { AccountProjectRow } from "@/src/lib/products/ownership";
import { WatcherNavigator } from "./WatcherNavigator";
import { WatcherConnectModal } from "./WatcherConnectModal";
import { Modal } from "./WatchUI";

interface DeploymentInfo { watcherId: string; communityTitle: string; enabled: boolean }

/** The Watchers workspace shell — CRM-style master/detail: a narrow
 *  Watcher navigator (WatcherNavigator) alongside the selected Watcher's
 *  detail pane, both living inside the Watches app shell's own content
 *  area (never a second global sidebar, never a horizontal Watcher strip).
 *  Only one Watcher's detail is ever rendered at a time, driven entirely by
 *  the route: `app/watchers/page.tsx` renders this with `selectedId={null}`
 *  + `detail={null}` (the "nothing selected yet" state); `app/watchers/[id]
 *  /page.tsx` renders it with the real selected id + the server-rendered
 *  detail content for that ONE Watcher. Selection is never client-only
 *  state — every navigator row is a plain `<Link>`, so deep links and
 *  browser back/forward work exactly like any other route in this app.
 *
 *  Responsive: desktop always shows navigator + detail side by side.
 *  Mobile shows exactly one column at a time — the navigator (acting as the
 *  Watchers list "screen") when nothing is selected, or the detail pane
 *  (with a "Watchers" back link) once a Watcher is selected via its own
 *  route. */
export function WatchersWorkspaceClient({
  watchers: initialWatchers, deployments, projects, selectedId, detail,
}: {
  watchers: AccountWatcherRow[];
  deployments: DeploymentInfo[];
  projects: AccountProjectRow[];
  selectedId: string | null;
  detail: React.ReactNode;
}) {
  const [watchers, setWatchers] = useState(initialWatchers);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<AccountWatcherRow | null>(null);

  const openCreate = () => { setCreating(true); setName(""); setError(null); };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await createWatcher(name.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setWatchers((prev) => [...prev, res.data]);
    setCreating(false);
  };

  const hasSelection = selectedId !== null;

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <WatcherNavigator
        watchers={watchers}
        deployments={deployments}
        selectedId={selectedId}
        onCreate={openCreate}
        onConnect={setConnecting}
        className={hasSelection ? "hidden lg:block" : "block"}
      />

      <div className={`flex-1 min-w-0 ${hasSelection ? "block" : "hidden lg:block"}`}>
        {hasSelection ? (
          <div>
            <Link href="/watchers" className="lg:hidden inline-flex items-center gap-1.5 text-xs w-text-faint hover:w-text mb-4">
              <ArrowLeft size={13} /> Watchers
            </Link>
            {detail}
          </div>
        ) : (
          <div className="w-card p-10 text-center">
            <Bot size={26} className="w-teal mx-auto mb-3" />
            <p className="text-sm w-text mb-1">{watchers.length === 0 ? "Create your first Watcher" : "Select a Watcher"}</p>
            <p className="text-xs w-text-faint mb-4">
              {watchers.length === 0
                ? "A Watcher is your AI-powered Virtual Moderator — create one, then connect it to a Telegram community."
                : "Choose a Watcher from the list to view its details."}
            </p>
            <button onClick={openCreate} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-1.5">
              <Plus size={14} /> New Watcher
            </button>
          </div>
        )}
      </div>

      {creating && (
        <Modal title="Create a Watcher" onClose={() => setCreating(false)}>
          <p className="text-sm w-text-dim mb-3">Name your Watcher — you can configure its persona once it's created.</p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Watcher name"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
          />
          {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
          <button onClick={submit} disabled={busy || !name.trim()} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg flex items-center justify-center gap-1.5 disabled:opacity-60">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {busy ? "Creating…" : "Create"}
          </button>
        </Modal>
      )}

      {connecting && (
        <WatcherConnectModal
          watcher={connecting}
          projects={projects}
          onClose={() => setConnecting(null)}
          onConnected={() => window.location.reload()}
        />
      )}
    </div>
  );
}
