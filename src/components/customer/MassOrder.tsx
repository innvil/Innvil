"use client";

import React, { useState } from "react";
import { ClipboardList, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { formatMoney } from "@/src/lib/money";
import { runMassOrder, type MassOrderResult } from "@/src/lib/actions/campaigns";

/* Manual mass order — always available (free, no subscription). One line per order:
   serviceId | link | quantity. Its own surface, separate from Campaign Automation. */

export function MassOrder({ panelId, currency = "USD" }: { panelId?: string; currency?: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MassOrderResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fmt = (n: number) => formatMoney(n, currency);

  const submit = async () => {
    if (!panelId || !text.trim()) return;
    setBusy(true); setErr(null); setRes(null);
    const r = await runMassOrder({ panelId, text });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setRes(r.data);
    if (r.data.failed === 0) setText("");
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2"><ClipboardList size={18} className="fp-gold" /> Mass order</h2>
        <p className="fp-text-dim text-sm mt-1">Place many orders at once — free, no subscription. One order per line: <span className="fp-mono">serviceId | link | quantity</span>.</p>
      </div>

      <div className="fp-panel border fp-line rounded-2xl p-4 space-y-3">
        <p className="fp-text-faint text-[11px]">The service id is its number in the catalog. Use a pipe <span className="fp-mono">|</span> or spaces between fields.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={7}
          placeholder={"12 | https://instagram.com/p/… | 1000\n7 | https://tiktok.com/@user/video/… | 500"}
          className="w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border font-mono resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="fp-text-faint text-[11px]">Charged to your wallet, like any order.</span>
          <button onClick={submit} disabled={busy || !text.trim()} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60 flex items-center gap-2">
            {busy ? <><Loader2 size={14} className="animate-spin" /> Placing…</> : "Place orders"}
          </button>
        </div>
        {err && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
        {res && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium flex items-center gap-1.5"><CheckCircle2 size={13} className="fp-safe" /> {res.placed} placed · {fmt(res.totalCharge)}{res.failed > 0 && <span className="text-red-400"> · {res.failed} failed</span>}</p>
            {res.items.filter((i) => !i.ok).map((i, idx) => (
              <p key={idx} className="text-[11px] text-red-400/90 fp-mono truncate">✕ {i.raw} — {i.error}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
