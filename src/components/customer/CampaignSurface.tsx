"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Rocket, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { formatMoney } from "@/src/lib/money";
import { analyzeCampaign } from "@/src/lib/automation/links";
import { runCampaign, listCampaigns, type CampaignVM, type RunCampaignResult } from "@/src/lib/actions/campaigns";

/* Customer-facing Campaign Automation surface: paste many post links, we detect the
   platform per link and fan out one order per service the owner configured. */

export function CampaignSurface({ panelId, currency = "USD" }: { panelId?: string; currency?: string }) {
  const [links, setLinks] = useState("");
  const [tier, setTier] = useState<"regular" | "priority">("regular");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunCampaignResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<CampaignVM[]>([]);

  const analysis = useMemo(() => analyzeCampaign(links), [links]);
  const fmt = (n: number) => formatMoney(n, currency);

  const loadRecent = () => { if (panelId) listCampaigns(panelId).then(setRecent).catch(() => {}); };
  useEffect(loadRecent, [panelId]);

  const run = async () => {
    if (!panelId || analysis.total === 0) return;
    setBusy(true); setError(null); setResult(null);
    const res = await runCampaign({ panelId, links, tier });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setResult(res.data);
    setLinks("");
    loadRecent();
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><Rocket size={18} className="fp-violet" /> Campaign</h2>
        <p className="fp-text-dim text-sm mt-1">Paste many post links — we detect each platform and place your usual services on all of them at once.</p>
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-4">
        <textarea
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          rows={7}
          placeholder={"Paste post links — one per line, or separated by commas/spaces.\nhttps://instagram.com/p/…\nhttps://tiktok.com/@user/video/…"}
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border resize-y"
        />

        {/* Live analysis */}
        {analysis.total > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <span className="fp-text-dim">{analysis.total} link{analysis.total === 1 ? "" : "s"} ·</span>
            {Object.entries(analysis.byPlatform).map(([p, n]) => (
              <span key={p} className="fp-panel-raised border fp-line-soft rounded-full px-2.5 py-1 capitalize">{p} · {n}</span>
            ))}
            {analysis.unknown > 0 && (
              <span className="text-amber-400/90 flex items-center gap-1"><AlertTriangle size={12} /> {analysis.unknown} unrecognized</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <div className="flex items-center gap-1 fp-panel-raised border fp-line-soft rounded-lg p-1">
            {(["regular", "priority"] as const).map((t) => (
              <button key={t} onClick={() => setTier(t)} className={`text-xs px-3 py-1.5 rounded-md capitalize ${tier === t ? "fp-violet-soft-bg fp-violet" : "fp-text-dim hover:fp-text"}`}>{t}</button>
            ))}
          </div>
          <button onClick={run} disabled={busy || analysis.total === 0} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {busy ? <><Loader2 size={15} className="animate-spin" /> Running…</> : <>Run campaign ({analysis.total})</>}
          </button>
        </div>
        {error && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}
      </div>

      {/* Result */}
      {result && (
        <div className="fp-panel border fp-line rounded-2xl p-4">
          <p className="text-sm font-medium flex items-center gap-1.5 mb-3">
            <CheckCircle2 size={15} className="fp-safe" /> {result.ordersPlaced} order{result.ordersPlaced === 1 ? "" : "s"} placed · {fmt(result.totalCharge)}
            {result.skipped > 0 && <span className="fp-text-faint"> · {result.skipped} skipped</span>}
            {result.failed > 0 && <span className="text-red-400"> · {result.failed} failed</span>}
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {result.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2">
                <span className="truncate fp-text-dim">{it.link}</span>
                <span className="shrink-0 flex items-center gap-2">
                  <span className="capitalize fp-text-faint">{it.platform ?? "unknown"}</span>
                  <span className={it.status === "ordered" ? "fp-safe" : it.status === "failed" ? "text-red-400" : "fp-text-faint"}>
                    {it.status === "ordered" ? `${it.orders} order${it.orders === 1 ? "" : "s"}` : it.error || it.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent */}
      {recent.length > 0 && (
        <div>
          <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Recent campaigns</p>
          <div className="space-y-1.5">
            {recent.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-xs fp-panel border fp-line rounded-lg px-3 py-2.5">
                <span className="fp-text-dim">{new Date(c.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {c.totalLinks} links · {c.tier}</span>
                <span className="flex items-center gap-2">
                  <span className="fp-mono">{fmt(c.totalCharge)}</span>
                  <span className={c.status === "completed" ? "fp-safe" : c.status === "failed" ? "text-red-400" : "fp-text-faint"}>{c.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
