"use client";

import React from "react";
import { managedEnterprisePrice, managedEnterpriseCommunities } from "@/src/lib/products/watch-enterprise";
import { MODERATOR_ENTERPRISE_MIN_SLOTS } from "@/src/lib/products/watch-plans";

/** Managed Enterprise pricing calculator — every number is computed live
 *  via the SAME canonical formula (`moderatorEnterpriseSlotPrice`/
 *  `moderatorEnterpriseIncludedCommunities` in money.ts) the Panel-side
 *  Enterprise sale already uses, never a second frontend-only pricing
 *  engine. Purely client-side math (no server round-trip needed — these are
 *  pure functions), so the price updates instantly as the slot count
 *  changes.
 *
 *  Controlled by the parent (`slots`/`onSlotsChange`) rather than owning
 *  its own state, so the SAME configured slot count that's shown here can
 *  also be threaded into the actual submitted Enterprise inquiry
 *  (EnterpriseModeCards) — previously this component's selection was local
 *  and never reached the request, a real "configure X, submit Y" gap.
 *
 *  A plain numeric input, not a fixed dropdown of preset options — the
 *  canonical formula has no real step size and no maximum
 *  (moderatorEnterpriseSlotPrice accepts any integer >= MODERATOR_
 *  ENTERPRISE_MIN_SLOTS), so a preset list would either omit real values
 *  (the old list started at 25, skipping the true minimum 21-24) or invent
 *  a limit that doesn't exist. */
export function ManagedEnterpriseCalculator({ slots, onSlotsChange }: { slots: number; onSlotsChange: (slots: number) => void }) {
  const price = managedEnterprisePrice(slots);
  const communities = managedEnterpriseCommunities(slots);

  return (
    <div className="w-surface-raised border w-line-soft rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <label htmlFor="managed-slots" className="text-xs w-text-dim">Watcher slots</label>
        <input
          id="managed-slots"
          type="number"
          min={MODERATOR_ENTERPRISE_MIN_SLOTS}
          step={1}
          value={slots}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onSlotsChange(Math.max(MODERATOR_ENTERPRISE_MIN_SLOTS, Math.round(n)));
          }}
          className="w-24 text-sm w-surface border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border text-right"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-0.5">Monthly Innvil fee</p>
          <p className="w-display text-xl w-teal">${price.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-0.5">Communities included</p>
          <p className="w-display text-xl w-text">{communities}</p>
        </div>
      </div>
      <p className="text-[11px] w-text-faint mt-3">
        Platinum base ($379.99) + $15/slot for slots {MODERATOR_ENTERPRISE_MIN_SLOTS}–50, +$13/slot for slots 51+.
        Minimum {MODERATOR_ENTERPRISE_MIN_SLOTS} slots — this is where Enterprise starts (20 slots is Platinum's own included capacity).
      </p>
    </div>
  );
}
