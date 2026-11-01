"use client";

import React from "react";
import { managedEnterprisePrice, managedEnterpriseCommunities, MANAGED_ENTERPRISE_50, ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE } from "@/src/lib/products/watch-enterprise";

/** Managed Enterprise pricing calculator for a slot count ABOVE the fixed,
 *  headline Managed Enterprise 50 package ($399/mo, 50 slots, 50,000 pooled
 *  AI Generations/mo — shown as its own static card elsewhere). The price
 *  shown here is the REAL, deterministic canonical price (base $399 +
 *  $8/slot above 50 -- managedEnterprisePrice in watch-enterprise.ts), the
 *  same continuation formula used everywhere else Managed pricing is shown
 *  -- never a fuzzy "custom quote" estimate. Only PROVISIONING (actually
 *  activating the extra capacity) is manual/contact-based; the price itself
 *  is not.
 *
 *  Controlled by the parent (`slots`/`onSlotsChange`) rather than owning
 *  its own state, so the SAME configured slot count that's shown here can
 *  also be threaded into the actual submitted Enterprise inquiry
 *  (EnterpriseModeCards).
 *
 *  A plain numeric input, not a fixed dropdown of preset options -- the
 *  canonical formula has no real step size or maximum above 50. */
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
          min={MANAGED_ENTERPRISE_50.slots + 1}
          step={1}
          value={slots}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onSlotsChange(Math.max(MANAGED_ENTERPRISE_50.slots + 1, Math.round(n)));
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
        Managed Enterprise includes {MANAGED_ENTERPRISE_50.slots} Watcher slots for ${MANAGED_ENTERPRISE_50.price.toFixed(2)}/mo.
        Additional Watcher capacity above {MANAGED_ENTERPRISE_50.slots} is ${ENTERPRISE_MANAGED_EXTRA_SLOT_PRICE}/slot/month —
        this is the real recurring Innvil fee, not an estimate. Provisioning the extra capacity is completed with Innvil support.
      </p>
    </div>
  );
}
