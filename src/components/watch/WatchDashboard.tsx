"use client";

import React, { useState } from "react";
import { LayoutGrid, Plus, FolderKanban, Radio } from "lucide-react";
import { createWatchProject } from "@/src/lib/actions/watch-dashboard";
import type { AccountProjectRow } from "@/src/lib/products/ownership";

/**
 * Minimal Watch-specific customer dashboard shell for an entitled,
 * standalone (Panel-less) account. Deliberately excludes every SMM-panel
 * commerce surface (New Order/Orders/Services/Providers/storefront) — a
 * Watch-only customer never needs those. Community/Watcher setup for a
 * standalone (panel_id: null) Project isn't wired yet (still Panel-scoped
 * throughout the Telegram runtime) — stated honestly below rather than
 * faking a working "connect Telegram" control here. Uses the same
 * `.watch-root`/`w-*` design tokens as WatchLanding, so the public site and
 * this authenticated shell read as one continuous product.
 */
export function WatchDashboard({ projects: initialProjects }: { projects: AccountProjectRow[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const res = await createWatchProject(name.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setName("");
    window.location.reload();
  };

  return (
    <div className="watch-root min-h-screen">
      <header className="border-b w-line-soft px-6 py-4 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/watch/app-tile.svg" alt="" width={36} height={36} className="w-9 h-9 rounded-[9px]" />
        <div className="leading-tight">
          <span className="w-display text-base block">Innvil Watch</span>
          <span className="text-[10px] w-text-faint">Part of Innvil</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center gap-2 mb-6">
          <LayoutGrid size={18} className="w-teal" />
          <h1 className="w-display text-xl">Your Projects</h1>
        </div>

        <div className="w-card p-5 mb-6">
          <p className="text-sm w-text-dim mb-3">Create a new Project — no commercial Panel required.</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="flex-1 w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
            />
            <button onClick={create} disabled={busy || !name.trim()} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-60">
              <Plus size={14} /> {busy ? "Creating…" : "Create"}
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>

        <div className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm w-text-faint">No Projects yet — create one above to get started.</p>
          ) : projects.map((p) => (
            <div key={p.id} className="w-surface-raised border w-line-soft rounded-lg px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <FolderKanban size={16} className="w-teal" />
                <p className="text-sm w-text">{p.name}</p>
              </div>
              <span className="w-pill w-teal-soft-bg w-teal">
                <Radio size={10} /> {p.panelId ? "Panel-distributed" : "Standalone"}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs w-text-faint mt-8">
          Connecting a Telegram community and deploying a Watcher into a standalone Project isn&apos;t available here
          yet — that part of Watch still requires a Panel today. This is the next piece being built.
        </p>
      </main>
    </div>
  );
}
