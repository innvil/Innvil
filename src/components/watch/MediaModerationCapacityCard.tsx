"use client";

import React, { useState } from "react";
import { ShieldCheck, Plus, AlertTriangle } from "lucide-react";
import { MEDIA_MODERATION_EXPANSION_PACKS } from "@/src/lib/money";
import { purchaseMediaModerationExpansionAction } from "@/src/lib/actions/innvil-credit";

/**
 * Real, unified Media Moderation capacity display -- REVISED model
 * (2026-08-27). Replaces the two separate old "Media Moderation +" cards
 * (self-serve fixed-block add-on / Enterprise devops-granted add-on) with
 * one surface reflecting the current real model: every plan gets a
 * controlled, unconditionally-included base allowance, and any plan may
 * stack optional expansion packs on top of it for the current billing
 * period. `base`/`expansion`/`used` are all real numbers already resolved
 * by the caller (Usage page) -- this component only presents them and
 * drives the purchase flow.
 */
export function MediaModerationCapacityCard({
  base, expansion: initialExpansion, used,
}: {
  base: number;
  expansion: number;
  used: number;
}) {
  const [expansion, setExpansion] = useState(initialExpansion);
  const [picking, setPicking] = useState(false);
  const [busyUnits, setBusyUnits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<number | null>(null);

  const total = base + expansion;
  const available = Math.max(0, total - used);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const limitReached = used >= total;
  const nearLimit = !limitReached && pct >= 90;
  const approachingLimit = !limitReached && !nearLimit && pct >= 75;

  const purchase = async (units: number) => {
    setBusyUnits(units);
    setError(null);
    const res = await purchaseMediaModerationExpansionAction(units);
    setBusyUnits(null);
    if (!res.ok) { setError(res.error); return; }
    setExpansion(res.totalExpansionThisPeriod);
    setJustAdded(res.unitsAdded);
    setPicking(false);
  };

  return (
    <div className="w-card p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="w-teal" />
          <p className="w-display text-sm w-text">Media Moderation</p>
        </div>
        {!picking && (
          <button
            onClick={() => { setPicking(true); setError(null); setJustAdded(null); }}
            className="text-xs w-teal hover:underline font-medium flex items-center gap-1"
          >
            <Plus size={13} /> Add Media Capacity
          </button>
        )}
      </div>

      {expansion > 0 ? (
        <div className="text-sm space-y-1 mb-2">
          <div className="flex items-center justify-between"><span className="w-text-dim">Base allowance</span><span className="w-text">{base.toLocaleString()}</span></div>
          <div className="flex items-center justify-between"><span className="w-text-dim">Expansion</span><span className="w-text">+{expansion.toLocaleString()}</span></div>
          <div className="flex items-center justify-between font-medium"><span className="w-text-dim">Total available</span><span className="w-text">{total.toLocaleString()}</span></div>
          <div className="flex items-center justify-between"><span className="w-text-dim">Used</span><span className="w-text">{used.toLocaleString()}</span></div>
          <div className="flex items-center justify-between"><span className="w-text-dim">Remaining</span><span className="w-text">{available.toLocaleString()}</span></div>
        </div>
      ) : (
        <p className="text-sm w-text-dim mb-2">
          {used.toLocaleString()} / {base.toLocaleString()} units used this period.
        </p>
      )}

      <div className="w-full h-1.5 rounded-full w-surface-raised overflow-hidden mb-2">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: limitReached ? "var(--w-red)" : nearLimit ? "var(--w-amber)" : "var(--w-teal)" }}
        />
      </div>

      {limitReached && (
        <p className="text-xs text-red-400 flex items-start gap-1.5 mb-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          Media Moderation capacity used up for this period — new photos/videos won't be scanned for explicit content until you add more capacity
          or your plan renews. Everything else (moderation, chat, and your Watchers) keeps working normally.
        </p>
      )}
      {!limitReached && nearLimit && (
        <p className="text-xs w-amber mb-2">You're close to your Media Moderation capacity for this period ({Math.round(pct)}% used).</p>
      )}
      {!limitReached && approachingLimit && (
        <p className="text-xs w-text-faint mb-2">You've used {Math.round(pct)}% of your Media Moderation capacity this period.</p>
      )}

      <p className="text-[11px] w-text-faint">
        A classified photo uses 1 unit; a video uses a few units for the representative frames actually checked — never one unit per video.
      </p>

      {justAdded != null && !error && (
        <p className="text-xs w-teal mt-2">+{justAdded.toLocaleString()} units added for this period.</p>
      )}

      {picking && (
        <div className="mt-3 pt-3 border-t w-line-soft">
          <p className="text-xs w-text-faint mb-2">Choose a capacity pack (added instantly, via Innvil Credit):</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MEDIA_MODERATION_EXPANSION_PACKS.map((p) => (
              <button
                key={p.units}
                onClick={() => purchase(p.units)}
                disabled={busyUnits != null}
                className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-2 hover:w-teal-border disabled:opacity-60 text-left"
              >
                <span className="block w-text font-medium">+{p.units.toLocaleString()}</span>
                <span className="block w-text-faint">${p.price.toFixed(2)}</span>
              </button>
            ))}
          </div>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          <button onClick={() => setPicking(false)} className="text-xs w-text-faint hover:w-text mt-2">Cancel</button>
        </div>
      )}
    </div>
  );
}
