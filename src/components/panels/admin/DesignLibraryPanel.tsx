"use client";

import React, { useEffect, useState } from "react";
import { Gem, Eye, CheckCircle2, AlertTriangle, Wallet, Lock } from "lucide-react";
import { getDesignLibrary, buyDesign, activateDesign, type DesignLibraryInfo } from "@/src/lib/actions/design";
import { designCards } from "@/src/data/designs";

/* Design Shop library for ONE panel: buy a design once (charged from the panel's
   Innvil balance), then activate / switch between the designs it owns. Owned designs
   are permanent — deactivating never revokes them. */

export function DesignLibraryPanel({ panelId }: { panelId: string }) {
  const [lib, setLib] = useState<DesignLibraryInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const cards = designCards();

  useEffect(() => {
    getDesignLibrary(panelId).then(setLib).catch(() => setLib(null));
  }, [panelId]);

  const buy = async (id: string, name: string) => {
    setBusy(id); setMsg(null);
    const res = await buyDesign(panelId, id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setLib(res.data);
    setMsg({ text: `${name} is yours — activate it to put it live.` });
  };

  const apply = async (id: string | null, name?: string) => {
    setBusy(id ?? "default"); setMsg(null);
    const res = await activateDesign(panelId, id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setLib(res.data);
    setMsg({ text: id ? `${name} is now live on your landing page.` : "Back to the default landing." });
  };

  if (!lib) return <p className="fp-text-faint text-xs py-2">Loading your design library…</p>;

  return (
    <div>
      <div className="flex items-center gap-2 text-[11px] fp-text-faint mb-3">
        <Wallet size={12} /> Innvil balance: <span className="fp-mono fp-text">${lib.ownerBalance.toFixed(2)}</span>
      </div>

      {msg && (
        <p className={`text-xs mb-3 flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}

      <div className="space-y-2">
        {/* Default (always available) */}
        <div className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${lib.active === null ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised"}`}>
          <div className="min-w-0">
            <p className="text-sm">Innvil default landing</p>
            <p className="fp-text-faint text-[11px]">Included — uses your theme &amp; branding</p>
          </div>
          {lib.active === null
            ? <span className="text-[10px] fp-gold shrink-0">Live</span>
            : <button onClick={() => apply(null)} disabled={busy !== null} className="text-[11px] fp-text-dim border fp-line-soft rounded-lg px-2.5 py-1.5 disabled:opacity-60 hover:fp-text shrink-0">Use</button>}
        </div>

        {cards.map((d) => {
          const owned = lib.owned.includes(d.id);
          const live = lib.active === d.id;
          const soon = d.status === "coming_soon";
          return (
            <div key={d.id} className={`rounded-lg border px-3 py-2.5 ${live ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised"}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg shrink-0" style={{ background: d.cover.background }} />
                  <div className="min-w-0">
                    <p className="text-sm truncate">{d.name}</p>
                    <p className="fp-text-faint text-[11px] truncate">
                      {soon ? "In the studio" : owned ? "Owned" : `$${d.price} one-time`} · {d.tagline}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!soon && (
                    <a href={`/design-preview/${d.id}`} target="_blank" rel="noreferrer" title="Live preview" className="text-[11px] fp-text-dim border fp-line-soft rounded-lg px-2 py-1.5 hover:fp-text flex items-center gap-1">
                      <Eye size={11} />
                    </a>
                  )}
                  {soon ? (
                    <span className="text-[10px] fp-text-faint flex items-center gap-1"><Lock size={10} /> Soon</span>
                  ) : live ? (
                    <span className="text-[10px] fp-gold">Live</span>
                  ) : owned ? (
                    <button onClick={() => apply(d.id, d.name)} disabled={busy !== null} className="text-[11px] fp-gold-soft-bg fp-gold rounded-lg px-2.5 py-1.5 disabled:opacity-60">
                      {busy === d.id ? "…" : "Activate"}
                    </button>
                  ) : (
                    <button onClick={() => buy(d.id, d.name)} disabled={busy !== null || lib.ownerBalance < d.price} className="fp-btn-primary text-[11px] font-semibold rounded-lg px-2.5 py-1.5 disabled:opacity-60">
                      {busy === d.id ? "…" : `Buy $${d.price}`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="fp-text-faint text-[10px] mt-3 flex items-center gap-1">
        <Gem size={10} className="fp-gold" /> Bought once, yours forever. Switching designs never removes one you own.
      </p>
    </div>
  );
}
