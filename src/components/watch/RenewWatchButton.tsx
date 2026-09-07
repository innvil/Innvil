"use client";

import React, { useState } from "react";
import { watchPlanDisplayName, type WatchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { ModeratorPlanTier } from "@/src/lib/money";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import { WatchCheckout } from "./WatchCheckout";

type SelfServePlan = Exclude<WatchPlanDisplayName, "Enterprise">;

/** Opens the SAME `WatchCheckout` modal (crypto or Innvil Credit) used for
 *  a brand-new subscription -- a renewal is not a special/reduced flow,
 *  since `activateWatchEntitlement`/`purchaseWatchWithCredit` already
 *  derive purchase-vs-renewal timing from the account's own current
 *  entitlement state at settlement time. `billingInterval` defaults to
 *  "monthly" and should be passed as the account's OWN current interval
 *  (never a client guess) so a renewal never silently switches a customer
 *  from annual to monthly or vice versa. */
export function RenewWatchButton({ tier, label, disabled, billingInterval = "monthly" }: { tier: ModeratorPlanTier; label: string; disabled?: boolean; billingInterval?: WatchBillingInterval }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={disabled} className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
        {label}
      </button>
      {open && <WatchCheckout plan={watchPlanDisplayName(tier) as SelfServePlan} billingInterval={billingInterval} onClose={() => setOpen(false)} />}
    </>
  );
}
