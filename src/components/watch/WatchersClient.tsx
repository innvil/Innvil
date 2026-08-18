"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot, Plus, X, Loader2 } from "lucide-react";
import { createWatcher } from "@/src/lib/actions/watch-dashboard";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import type { AccountProjectRow } from "@/src/lib/products/ownership";
import { StatusDot, EmptyRow } from "./WatchUI";
import { WatcherConnectModal } from "./WatcherConnectModal";

interface DeploymentInfo { watcherId: string; communityTitle: string; enabled: boolean }

type WatcherFilter = "all" | "active" | "paused" | "unassigned";
const FILTERS: Array<{ value: WatcherFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "unassigned", label: "Unassigned" },
];

/** Full Watchers list — create, connect, and a status table. Owns its own
 *  interactive state (create/connect modals); the server page only supplies
 *  the initial real data. */
export function WatchersListClient({
  watchers: initialWatchers, deployments, projects,
}: {
  watchers: AccountWatcherRow[];
  deployments: DeploymentInfo[];
  projects: AccountProjectRow[];
}) {
  const [watchers, setWatchers] = useState(initialWatchers);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<AccountWatcherRow | null>(null);
  const [filter, setFilter] = useState<WatcherFilter>("all");

  const statusOf = (watcherId: string): WatcherFilter => {
    const deployed = deployments.filter((d) => d.watcherId === watcherId);
    if (deployed.length === 0) return "unassigned";
    return deployed.some((d) => d.enabled) ? "active" : "paused";
  };
  const filtered = filter === "all" ? watchers : watchers.filter((w) => statusOf(w.id) === filter);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="w-display text-xl mb-1">Watchers</h1>
          <p className="text-sm w-text-dim">The AI moderators you can deploy into a Community.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border ${filter === f.value ? "w-teal-border w-teal" : "w-line-soft w-text-dim hover:w-text"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button onClick={() => { setCreating(true); setName(""); setError(null); }} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
            <Plus size={14} /> New Watcher
          </button>
        </div>
      </div>

      {watchers.length === 0 ? (
        <div className="w-card p-10 text-center">
          <Bot size={28} className="w-teal mx-auto mb-3" />
          <EmptyRow text="No Watchers yet — create one, then connect it to a Telegram community." />
        </div>
      ) : filtered.length === 0 ? (
        <div className="w-card p-10 text-center"><EmptyRow text="No Watchers match this filter." /></div>
      ) : (
        <div className="w-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                  <th className="font-semibold py-3 px-4">Watcher</th>
                  <th className="font-semibold py-3 px-4">Deployed to</th>
                  <th className="font-semibold py-3 px-4">Status</th>
                  <th className="font-semibold py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w) => {
                  const deployed = deployments.filter((d) => d.watcherId === w.id);
                  const anyEnabled = deployed.some((d) => d.enabled);
                  return (
                    <tr key={w.id} className="border-t w-line-soft">
                      <td className="py-3 px-4"><Link href={`/watchers/${w.id}`} className="w-text hover:w-teal font-medium flex items-center gap-2"><Bot size={13} className="w-teal shrink-0" /> {w.name}</Link></td>
                      <td className="py-3 px-4 w-text-dim">{deployed.length === 0 ? "Not deployed" : deployed.map((d) => d.communityTitle).join(", ")}</td>
                      <td className="py-3 px-4">{deployed.length === 0 ? <span className="text-xs w-text-faint">Idle</span> : <StatusDot on={anyEnabled} />}</td>
                      <td className="py-3 px-4 text-right">
                        {deployed.length === 0 && (
                          <button onClick={() => setConnecting(w)} className="text-xs w-teal hover:underline">
                            {w.provisioningStatus === "active" || w.provisioningStatus === "bot_ready" || w.provisioningStatus === "community_setup_required" ? "Connect community" : "Connect"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Create a Watcher">
          <div className="absolute inset-0 bg-black/60" onClick={() => setCreating(false)} aria-hidden="true" />
          <div className="relative w-full max-w-sm w-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="w-display text-base">Create a Watcher</h3>
              <button onClick={() => setCreating(false)} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
            </div>
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
          </div>
        </div>
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
