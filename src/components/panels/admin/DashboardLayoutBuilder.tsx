"use client";

import React, { useEffect, useState } from "react";
import { Eye, EyeOff, ArrowUp, ArrowDown, Save, Lock, RotateCcw, LayoutGrid, CheckCircle2, AlertTriangle } from "lucide-react";
import { getDashboardDesign, setDashboardHome, resetDashboardHome } from "@/src/lib/actions/design";
import { DASHBOARD_WIDGET_LABELS, type DashboardWidget } from "@/src/lib/dashboard-layout";

/* Design Tools — customer-dashboard layout builder. Rearrange/show-hide the home
   widgets with built-in controls (no code; the order/wallet functions are never
   touched). Included with the Business plan. */

export function DashboardLayoutBuilder({ panelId }: { panelId: string }) {
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [layout, setLayout] = useState<DashboardWidget[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    getDashboardDesign(panelId)
      .then((d) => { if (d) { setEntitled(d.hasDesignTools); setLayout(d.home); } else setEntitled(false); })
      .catch(() => setEntitled(false));
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
    setMsg(res.ok ? { text: "Saved — your customers' dashboard now uses this layout." } : { text: res.error, error: true });
  };
  const reset = async () => {
    setBusy(true); setMsg(null);
    const res = await resetDashboardHome(panelId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    const d = await getDashboardDesign(panelId).catch(() => null);
    if (d) setLayout(d.home);
    setMsg({ text: "Reset to the default layout." });
  };

  if (entitled === null) return <p className="fp-text-faint text-xs py-3">Loading…</p>;

  if (!entitled) {
    return (
      <div className="fp-panel-raised border fp-line-soft rounded-lg p-4">
        <p className="text-sm font-medium flex items-center gap-2"><Lock size={14} className="fp-gold" /> Dashboard layout builder</p>
        <p className="fp-text-faint text-xs mt-1.5 leading-relaxed">
          Rearrange and show/hide the widgets on your customers&apos; dashboard — a <span className="fp-text">Design Tools</span> feature,
          included with the <span className="fp-gold">Innvil Business</span> plan. Subscribe in Campaign Automation to unlock it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="fp-text-faint text-[11px] mb-3">Reorder and show/hide the widgets your customers see on their dashboard home. The order/wallet functions are never affected.</p>
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
