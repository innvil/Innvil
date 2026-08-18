"use client";

import React, { useState } from "react";
import { managedEnterprisePrice, managedEnterpriseCommunities } from "@/src/lib/products/watch-enterprise";
import { MODERATOR_ENTERPRISE_MIN_SLOTS } from "@/src/lib/products/watch-plans";

const SLOT_OPTIONS = [25, 30, 40, 50, 75, 100, 150];

/** Managed Enterprise pricing calculator — every number is computed live
 *  via the SAME canonical formula (`moderatorEnterpriseSlotPrice`/
 *  `moderatorEnterpriseIncludedCommunities` in money.ts) the Panel-side
 *  Enterprise sale already uses, never a second frontend-only pricing
 *  engine. Purely client-side math (no server round-trip needed — these are
 *  pure functions), so the price updates instantly as the slot count
 *  changes. */
export function ManagedEnterpriseCalculator() {
  const [slots, setSlots] = useState(50);
  const price = managedEnterprisePrice(slots);
  const communities = managedEnterpriseCommunities(slots);

  return (
    <div className="w-surface-raised border w-line-soft rounded-lg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <label htmlFor="managed-slots" className="text-xs w-text-dim">Watcher slots</label>
        <select
          id="managed-slots"
          value={slots}
          onChange={(e) => setSlots(Number(e.target.value))}
          className="text-sm w-surface border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border"
        >
          {SLOT_OPTIONS.map((n) => <option key={n} value={n}>{n} slots</option>)}
        </select>
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
      </p>
    </div>
  );
}
