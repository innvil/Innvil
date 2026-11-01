"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Tag } from "lucide-react";
import { designCards } from "@/src/data/designs";
import { getDesignPricing, setDesignPricing } from "@/src/lib/actions/platform-settings";
import type { DesignPricingMap, DesignPricingEntry } from "@/src/lib/design/pricing";

/* Super-admin design pricing + per-design first-purchase promos. Shared by the
   /superadmin route and the owner-app super-admin sidebar. Paints from cache first,
   then syncs in the background (like BlogReview). */

const CACHE_KEY = "innvil-superadmin:design-pricing";

function readCache(): DesignPricingMap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY) ?? window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DesignPricingMap) : null;
  } catch { return null; }
}
function writeCache(v: DesignPricingMap) {
  if (typeof window === "undefined") return;
  try {
    const raw = JSON.stringify(v);
    window.sessionStorage.setItem(CACHE_KEY, raw);
    window.localStorage.setItem(CACHE_KEY, raw);
  } catch { /* ignore */ }
}

// Local editable form state per design.
type Row = { price: string; promoActive: boolean; promoPrice: string; promoLabel: string };

function toRow(base: number, e?: DesignPricingEntry): Row {
  return {
    price: typeof e?.price === "number" ? String(e.price) : String(base),
    promoActive: !!e?.promoActive,
    promoPrice: typeof e?.promoPrice === "number" ? String(e.promoPrice) : "",
    promoLabel: e?.promoLabel ?? "",
  };
}

export function DesignPricingAdmin() {
  const cards = designCards();
  const cached = readCache();
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const init: Record<string, Row> = {};
    for (const c of cards) init[c.id] = toRow(c.price, cached?.[c.id]);
    return init;
  });
  const [syncing, setSyncing] = useState(Boolean(cached));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    setSyncing(true);
    getDesignPricing()
      .then((map) => {
        writeCache(map);
        setRows(() => {
          const next: Record<string, Row> = {};
          for (const c of cards) next[c.id] = toRow(c.price, map[c.id]);
          return next;
        });
      })
      .catch(() => {})
      .finally(() => setSyncing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setField = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  const save = async (id: string) => {
    setBusy(id); setMsg(null);
    const row = rows[id];
    const entry: DesignPricingEntry = {
      price: row.price.trim() === "" ? undefined : Number(row.price),
      promoActive: row.promoActive,
      promoPrice: row.promoPrice.trim() === "" ? undefined : Number(row.promoPrice),
      promoLabel: row.promoLabel,
    };
    const res = await setDesignPricing(id, entry);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    // Refresh cache so the change is reflected instantly elsewhere.
    const map = await getDesignPricing();
    writeCache(map);
    setMsg({ text: "Saved." });
  };

  const inputCls = "fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-2 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim">
        <span className="fp-text">Design pricing.</span> Override each design&apos;s one-time price and set a
        first-purchase promo (applied to a buyer&apos;s first design on a panel). Blank price = the design&apos;s
        default.{syncing && <span className="fp-text-faint"> Syncing…</span>}
      </div>

      {msg && (
        <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>
          {msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}
        </p>
      )}

      <div className="space-y-3">
        {cards.map((c) => {
          const row = rows[c.id];
          if (!row) return null;
          return (
            <div key={c.id} className="fp-panel border fp-line rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-8 h-8 rounded-lg shrink-0" style={{ background: c.cover.background }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <p className="fp-text-faint text-[11px]">Default ${c.price.toFixed(2)} · {c.status === "published" ? "published" : "coming soon"}</p>
                  </div>
                </div>
                <button onClick={() => save(c.id)} disabled={busy !== null} className="fp-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60">
                  {busy === c.id ? "Saving…" : "Save"}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="fp-text-dim text-[11px]">Price ($)</span>
                  <input value={row.price} onChange={(e) => setField(c.id, { price: e.target.value })} inputMode="decimal" placeholder={String(c.price)} className={`${inputCls} w-full mt-1`} />
                </label>
                <label className="flex items-center gap-2 sm:mt-6">
                  <input type="checkbox" checked={row.promoActive} onChange={(e) => setField(c.id, { promoActive: e.target.checked })} />
                  <span className="text-xs fp-text-dim flex items-center gap-1"><Tag size={12} className="fp-gold" /> First-purchase promo</span>
                </label>
              </div>

              {row.promoActive && (
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  <label className="block">
                    <span className="fp-text-dim text-[11px]">Promo price ($)</span>
                    <input value={row.promoPrice} onChange={(e) => setField(c.id, { promoPrice: e.target.value })} inputMode="decimal" placeholder="e.g. 6" className={`${inputCls} w-full mt-1`} />
                  </label>
                  <label className="block">
                    <span className="fp-text-dim text-[11px]">Badge label</span>
                    <input value={row.promoLabel} onChange={(e) => setField(c.id, { promoLabel: e.target.value })} placeholder="First purchase" className={`${inputCls} w-full mt-1`} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
