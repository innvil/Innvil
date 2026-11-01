"use client";

import React, { useEffect, useState } from "react";
import { Eye, EyeOff, ArrowUp, ArrowDown, Save, Lock, RotateCcw, LayoutGrid, CheckCircle2, AlertTriangle } from "lucide-react";
import { getDashboardDesign, setDashboardHome, resetDashboardHome } from "@/src/lib/actions/design";
import { DASHBOARD_WIDGET_LABELS, type DashboardWidget, type DashboardWidgetId } from "@/src/lib/dashboard-layout";

/* Design Tools — customer-dashboard layout builder. Rearrange/show-hide the home
   widgets with built-in controls (no code; the order/wallet functions are never
   touched). Included with the Business plan. */

const DESIGN_LAYOUT_CACHE_PREFIX = "innvil-owner:dashboard-layout";

function layoutCacheKey(panelId: string) {
  return `${DESIGN_LAYOUT_CACHE_PREFIX}:${panelId}`;
}

type LayoutCacheValue = { entitled: boolean; home: DashboardWidget[] };

function readLayoutCache(panelId: string): LayoutCacheValue | null {
  if (typeof window === "undefined") return null;
  const key = layoutCacheKey(panelId);
  try {
    const raw = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LayoutCacheValue) : null;
  } catch {
    return null;
  }
}

function writeLayoutCache(panelId: string, value: LayoutCacheValue) {
  if (typeof window === "undefined") return;
  const key = layoutCacheKey(panelId);
  try {
    const raw = JSON.stringify(value);
    window.sessionStorage.setItem(key, raw);
    window.localStorage.setItem(key, raw);
  } catch {
    // ignore storage failures
  }
}

/* Mini representative render of each customer-dashboard home widget. */
function miniWidget(id: DashboardWidgetId) {
  switch (id) {
    case "stats":
      return (
        <div className="grid grid-cols-3 gap-1.5">
          {["Balance", "Pending", "Done"].map((l) => (
            <div key={l} className="fp-panel border fp-line-soft rounded p-2">
              <p className="text-[8px] fp-text-faint uppercase leading-none">{l}</p>
              <p className="text-[11px] fp-gold leading-tight mt-1">—</p>
            </div>
          ))}
        </div>
      );
    case "favorites":
      return (
        <div className="fp-panel border fp-line-soft rounded p-2.5">
          <p className="text-[10px] fp-gold mb-1.5">★ Favorites · quick order</p>
          <div className="space-y-1">{[0, 1].map((i) => <div key={i} className="h-3.5 fp-panel-raised rounded" />)}</div>
        </div>
      );
    case "recent":
      return (
        <div className="fp-panel border fp-line-soft rounded p-2.5">
          <p className="text-[10px] fp-violet mb-1.5">Recently ordered</p>
          <div className="space-y-1">{[0, 1].map((i) => <div key={i} className="h-3.5 fp-panel-raised rounded" />)}</div>
        </div>
      );
    case "orders":
      return (
        <div className="fp-panel border fp-line-soft rounded p-2.5">
          <p className="text-[10px] mb-1.5">Recent orders</p>
          <div className="space-y-1">{[0, 1, 2].map((i) => <div key={i} className="h-3.5 fp-panel-raised rounded" />)}</div>
        </div>
      );
  }
}

/** Live preview of the customer dashboard home for a given layout. Rendered in the
 *  Design Studio's preview column (below the landing preview). */
export function DashboardHomePreview({ layout, panelName }: { layout: DashboardWidget[] | null; panelName?: string }) {
  if (!layout) return null;
  const visible = layout.filter((w) => w.visible);
  return (
    <div className="fp-root p-4 border-t fp-line-soft" style={{ background: "var(--void-2)" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5"><span className="w-5 h-5 rounded fp-gold-bg" /><span className="text-[10px]">{panelName || "Your panel"}</span></span>
        <span className="flex items-center gap-1.5">
          <span className="text-[9px] fp-gold fp-panel border fp-line-soft rounded px-2 py-1">$—</span>
          <span className="text-[9px] fp-gold-bg text-[#0A0B0F] rounded px-2 py-1">Add Funds</span>
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="fp-text-faint text-[10px] text-center py-4">All widgets hidden.</p>
      ) : (
        <div className="space-y-2">{visible.map((w) => <div key={w.id}>{miniWidget(w.id)}</div>)}</div>
      )}
    </div>
  );
}

export function DashboardLayoutBuilder({ panelId, onLayoutChange }: { panelId: string; onLayoutChange?: (layout: DashboardWidget[] | null) => void }) {
  const cached = readLayoutCache(panelId);
  const [entitled, setEntitled] = useState<boolean | null>(cached ? cached.entitled : null);
  const [layout, setLayout] = useState<DashboardWidget[]>(cached?.home ?? []);
  const [syncing, setSyncing] = useState(Boolean(cached));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setSyncing(true);
    getDashboardDesign(panelId)
      .then((d) => {
        if (d) {
          setEntitled(d.hasDesignTools);
          setLayout(d.home);
          writeLayoutCache(panelId, { entitled: d.hasDesignTools, home: d.home });
        } else {
          setEntitled(false);
          writeLayoutCache(panelId, { entitled: false, home: [] });
        }
      })
      .catch(() => setEntitled((prev) => (prev === null ? false : prev)))
      .finally(() => setSyncing(false));
  }, [panelId]);

  const move = (i: number, dir: -1 | 1) => {
    setLayout((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const toggle = (i: number) => setLayout((prev) => prev.map((w, k) => (k === i ? { ...w, visible: !w.visible } : w)));

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await setDashboardHome(panelId, layout);
    setBusy(false);
    if (res.ok && entitled !== null) writeLayoutCache(panelId, { entitled, home: layout });
    setMsg(res.ok ? { text: "Saved — your customers' dashboard now uses this layout." } : { text: res.error, error: true });
  };
  const reset = async () => {
    setBusy(true); setMsg(null);
    const res = await resetDashboardHome(panelId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    const d = await getDashboardDesign(panelId).catch(() => null);
    if (d) {
      setEntitled(d.hasDesignTools);
      setLayout(d.home);
      writeLayoutCache(panelId, { entitled: d.hasDesignTools, home: d.home });
    }
    setMsg({ text: "Reset to the default layout." });
  };

  // Keep the Design Studio's preview column in sync with the working layout.
  useEffect(() => {
    onLayoutChange?.(entitled ? layout : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, entitled]);

  if (entitled === null) return <p className="fp-text-faint text-xs py-3">Loading…</p>;

  if (!entitled) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-lg p-4">
        <p className="text-sm font-medium flex items-center gap-2"><Lock size={14} className="fp-gold" /> Dashboard layout builder {syncing && <span className="text-[11px] fp-text-faint">Syncing…</span>}</p>
        <p className="fp-text-faint text-xs mt-1.5 leading-relaxed">
          Rearrange and show/hide the widgets on your customers&apos; dashboard — a <span className="fp-text">Design Tools</span> feature,
          included with the <span className="fp-gold">Innvil Business</span> plan. <span className="fp-text">Plans are coming soon.</span>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="fp-text-faint text-[11px] mb-3">Reorder and show/hide the widgets your customers see on their dashboard home. The order/wallet functions are never affected.{syncing ? " Syncing…" : ""}</p>
      <div className="space-y-2">
        {layout.map((w, i) => (
          <div key={w.id} className={`flex items-center justify-between fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 ${w.visible ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-2 min-w-0">
              <LayoutGrid size={13} className="fp-text-faint shrink-0" />
              <span className="text-xs truncate">{DASHBOARD_WIDGET_LABELS[w.id]}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => toggle(i)} title={w.visible ? "Hide" : "Show"} className="p-1 fp-text-dim hover:fp-text">
                {w.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="p-1 fp-text-dim hover:fp-text disabled:opacity-30"><ArrowUp size={14} /></button>
              <button onClick={() => move(i, 1)} disabled={i === layout.length - 1} title="Move down" className="p-1 fp-text-dim hover:fp-text disabled:opacity-30"><ArrowDown size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {msg && (
        <p className={`text-xs mt-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button onClick={save} disabled={busy} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60 flex items-center gap-1.5">
          <Save size={13} /> {busy ? "Saving…" : "Save layout"}
        </button>
        <button onClick={reset} disabled={busy} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 disabled:opacity-60 flex items-center gap-1.5 hover:fp-text">
          <RotateCcw size={12} /> Reset
        </button>
      </div>
    </div>
  );
}
