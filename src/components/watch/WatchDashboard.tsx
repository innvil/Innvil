"use client";

import React, { useState } from "react";
import { LayoutGrid, Plus, FolderKanban } from "lucide-react";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import { createWatchProject } from "@/src/lib/actions/watch-dashboard";
import type { AccountProjectRow } from "@/src/lib/products/ownership";

/**
 * Minimal Watch-specific customer dashboard shell for an entitled,
 * standalone (Panel-less) account. Deliberately excludes every SMM-panel
 * commerce surface (New Order/Orders/Services/Providers/storefront) — a
 * Watch-only customer never needs those. Community/Watcher setup for a
 * standalone (panel_id: null) Project isn't wired yet (still Panel-scoped
 * throughout the Telegram runtime) — stated honestly below rather than
 * faking a working "connect Telegram" control here.
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
    <div className="fp-root min-h-screen">
      <header className="border-b fp-line-soft px-6 py-4 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
          <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
        </div>
        <div className="leading-tight">
          <span className="fp-display text-base block">Innvil Watch</span>
          <span className="text-[10px] fp-text-faint">Part of Innvil</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center gap-2 mb-6">
          <LayoutGrid size={18} className="fp-gold" />
          <h1 className="fp-display text-xl">Your Projects</h1>
        </div>

        <div className="fp-panel border fp-line-soft rounded-2xl p-5 mb-6">
          <p className="text-sm fp-text-dim mb-3">Create a new Project — no commercial Panel required.</p>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
            />
            <button onClick={create} disabled={busy || !name.trim()} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-60">
              <Plus size={14} /> {busy ? "Creating…" : "Create"}
            </button>
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>

        <div className="space-y-2">
          {projects.length === 0 ? (
            <p className="text-sm fp-text-faint">No Projects yet — create one above to get started.</p>
          ) : projects.map((p) => (
            <div key={p.id} className="fp-panel-raised border fp-line-soft rounded-lg px-4 py-3 flex items-center gap-3">
              <FolderKanban size={16} className="fp-gold" />
              <div>
                <p className="text-sm fp-text">{p.name}</p>
                <p className="text-[11px] fp-text-faint">{p.panelId ? "Distributed through a Panel" : "Standalone"}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs fp-text-faint mt-8">
          Connecting a Telegram community and deploying a Watcher into a standalone Project isn&apos;t available here
          yet — that part of Watch still requires a Panel today. This is the next piece being built.
        </p>
      </main>
    </div>
  );
}
