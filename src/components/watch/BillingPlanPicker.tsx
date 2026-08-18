"use client";

import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { WatchPlanOption, WatchPlanDisplayName } from "@/src/lib/products/watch-plans";
import { WatchCheckout } from "./WatchCheckout";
import { SlotInfoPopover, CommunityExpansionInfoPopover } from "./SlotInfoPopover";

type SelfServePlan = Exclude<WatchPlanDisplayName, "Enterprise">;

/** Plan grid + checkout trigger for the Billing page — reuses the SAME
 *  `WatchCheckout` component the pre-authenticated pricing page already uses
 *  (real gateways only, never a fabricated "success" state), so upgrading/
 *  switching an existing plan goes through the identical, already-verified
 *  payment path as a brand-new subscription. Entitlement rows (slots,
 *  Communities) read straight from `watchPlanOptions()` -- the same
 *  canonical CAPACITY/MODERATOR_COMMUNITY_CAPACITY tables
 *  `deployAccountWatcher`/`createAccountCommunity` enforce against, never a
 *  second hand-typed number. No "Media Moderation Units" row -- no such
 *  metering exists anywhere in this codebase yet (Phase 4.S, documented as
 *  a future plan, not built), so nothing is shown rather than a fabricated
 *  allowance. Gold/Platinum show BOTH the included Community allowance and
 *  the plan's expansion ceiling -- Bronze/Silver are hard-capped
 *  (included === max), so the "Up to N" line is only shown where expansion
 *  is actually possible, never fabricated for a tier that can't expand. */
export function BillingPlanPicker({ options, currentDisplayName }: { options: WatchPlanOption[]; currentDisplayName: string | null }) {
  const [checkoutPlan, setCheckoutPlan] = useState<SelfServePlan | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {options.map((o) => {
          const isCurrent = o.displayName === currentDisplayName;
          const expandable = o.communitiesMax > o.communitiesIncluded;
          return (
            <div key={o.tier} className={`w-card p-4 flex flex-col ${isCurrent ? "border w-teal-border" : ""}`}>
              <p className="w-display text-sm mb-1">{o.displayName}</p>
              <p className="w-display text-xl w-teal mb-3">${o.price.toFixed(2)}<span className="text-xs w-text-faint font-normal">/mo</span></p>
              <div className="space-y-1.5 mb-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="w-text-dim flex items-center gap-1">Watcher slots <SlotInfoPopover /></span>
                  <span className="w-text font-medium">{o.slots}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="w-text-dim flex items-center gap-1">
                    Communities
                    {expandable && <CommunityExpansionInfoPopover included={o.communitiesIncluded} max={o.communitiesMax} />}
                  </span>
                  <span className="w-text font-medium text-right">
                    {o.communitiesIncluded} included
                    {expandable && <span className="block w-text-faint font-normal">Up to {o.communitiesMax}</span>}
                  </span>
                </div>
              </div>
              {isCurrent ? (
                <span className="mt-auto text-xs w-teal flex items-center gap-1"><CheckCircle2 size={13} /> Current plan</span>
              ) : (
                <button onClick={() => setCheckoutPlan(o.displayName as SelfServePlan)} className="mt-auto w-btn-primary text-xs font-semibold py-2 rounded-lg">
                  {currentDisplayName ? "Switch to this plan" : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {checkoutPlan && <WatchCheckout plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />}
    </>
  );
}
