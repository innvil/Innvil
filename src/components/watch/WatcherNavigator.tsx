"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot, Plus, Search } from "lucide-react";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { watcherOperationalStatus, type WatcherOperationalStatus } from "@/src/lib/products/watch-status";

interface DeploymentInfo { watcherId: string; communityTitle: string; enabled: boolean }

type WatcherFilter = "all" | WatcherOperationalStatus;
const FILTERS: Array<{ value: WatcherFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "unassigned", label: "Unassigned" },
];

const STATUS_META: Record<WatcherOperationalStatus, { label: string; dotClass: string }> = {
  active: { label: "Active", dotClass: "w-green-bg" },
  paused: { label: "Paused", dotClass: "w-amber-bg" },
  unassigned: { label: "Not deployed", dotClass: "w-surface-raised border w-line-soft" },
};

/** The Watcher navigator — a compact, searchable/filterable master list
 *  living INSIDE the Watchers workspace (never added to the global
 *  WatchShell sidebar, never a horizontal strip). Selection is route-driven
 *  (`selectedId` comes straight from the server page's own `params.id`,
 *  never client-only state), so each row is a plain `<Link>` to
 *  `/watchers/[id]` — deep links, back/forward, and prefetching all work
 *  exactly like every other Watch list->detail pair in this app. Purely
 *  presentational otherwise: search/filter are local UI state, create/
 *  connect actions are reported up to the caller (WatchersWorkspaceClient),
 *  which owns the actual modals. */
export function WatcherNavigator({
  watchers, deployments, selectedId, onCreate, onConnect, className = "",
}: {
  watchers: AccountWatcherRow[];
  deployments: DeploymentInfo[];
  selectedId: string | null;
  onCreate: () => void;
  onConnect: (w: AccountWatcherRow) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WatcherFilter>("all");

  const q = query.trim().toLowerCase();
  const filtered = watchers.filter((w) => {
    if (q && !w.name.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    return watcherOperationalStatus(w.id, deployments) === filter;
  });

  return (
    <aside className={`lg:w-72 shrink-0 lg:border-r w-line-soft lg:pr-5 ${className}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="w-display text-sm flex items-center gap-1.5">
          Watchers <span className="w-pill w-surface-raised w-text-faint text-[10px]">{watchers.length}</span>
        </h2>
        <button
          onClick={onCreate}
          aria-label="New Watcher"
          title="New Watcher"
          className="w-btn-primary text-xs font-semibold p-1.5 rounded-lg flex items-center justify-center"
        >
          <Plus size={14} />
        </button>
      </div>

      {watchers.length > 3 && (
        <div className="relative mb-3">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 w-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Watchers…"
            className="w-full w-surface-raised border w-line-soft rounded-lg pl-8 pr-2.5 py-1.5 text-xs w-text outline-none focus:w-teal-border"
          />
        </div>
      )}

      {watchers.length > 3 && (
        <div className="flex items-center gap-1 mb-3 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`text-[11px] px-2 py-1 rounded-md border ${filter === f.value ? "w-teal-border w-teal" : "w-line-soft w-text-faint hover:w-text-dim"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {watchers.length === 0 ? (
        <div className="text-center py-8 px-2">
          <Bot size={22} className="w-teal mx-auto mb-2" />
          <p className="text-xs w-text-faint mb-3">No Watchers yet.</p>
          <button onClick={onCreate} className="w-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg">Create Watcher</button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs w-text-faint py-4 text-center">No Watchers match.</p>
      ) : (
        <ul className="space-y-1 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
          {filtered.map((w) => {
            const status = watcherOperationalStatus(w.id, deployments);
            const meta = STATUS_META[status];
            const active = w.id === selectedId;
            const deployedCount = deployments.filter((d) => d.watcherId === w.id).length;
            return (
              <li key={w.id}>
                <Link
                  href={`/watchers/${w.id}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                    active ? "w-teal-soft-bg w-teal-border border" : "hover:w-surface-raised border border-transparent"
                  }`}
                >
                  <Bot size={14} className={`shrink-0 ${active ? "w-teal" : "w-text-faint"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${active ? "w-teal font-medium" : "w-text"}`}>{w.name}</p>
                    <p className="text-[11px] w-text-faint flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dotClass}`} aria-hidden="true" />
                      {status === "unassigned" ? meta.label : `${meta.label} · ${deployedCount} communit${deployedCount === 1 ? "y" : "ies"}`}
                    </p>
                  </div>
                  {status === "unassigned" && (
                    <button
                      onClick={(e) => { e.preventDefault(); onConnect(w); }}
                      className="text-[11px] w-teal hover:underline shrink-0"
                    >
                      Connect
                    </button>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
