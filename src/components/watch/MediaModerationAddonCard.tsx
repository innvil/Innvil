"use client";

import React, { useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { MODERATOR_MEDIA_ADDON, type ModeratorPlanTier } from "@/src/lib/money";
import { watchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import { creditPriceUsd, annualCreditPriceUsd } from "@/src/lib/products/innvil-credit-pricing";
import { purchaseMediaModerationAddonWithCreditAction, scheduleMediaModerationAddonRemovalAction } from "@/src/lib/actions/innvil-credit";

/**
 * Real Add/Manage/Remove surface for the self-serve Media Moderation +
 * add-on -- available on ALL FOUR self-serve tiers (unlike Community
 * Expansion's Gold/Platinum-only restriction), so this card renders for any
 * active self-serve subscription. Innvil Credit ONLY for now -- there is no
 * direct-crypto checkout path for this add-on yet, a real, documented gap
 * (see CommunityExpansionCard.tsx for the pattern this would follow once a
 * checkout path exists) -- never faked here.
 */
export function MediaModerationAddonCard({
  tier, billingInterval, active, cancelAtPeriodEnd, units,
}: {
  tier: ModeratorPlanTier;
  billingInterval: WatchBillingInterval;
  active: boolean;
  cancelAtPeriodEnd: boolean;
  units: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localActive, setLocalActive] = useState(active);
  const [localCancelPending, setLocalCancelPending] = useState(cancelAtPeriodEnd);
  const [localUnits, setLocalUnits] = useState(units);

  const planName = watchPlanDisplayName(tier);
  const regular = MODERATOR_MEDIA_ADDON[tier].price;
  const creditPrice = billingInterval === "annual" ? annualCreditPriceUsd(regular) : creditPriceUsd(regular, tier);

  const purchase = async () => {
    setBusy(true);
    setError(null);
    const res = await purchaseMediaModerationAddonWithCreditAction();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setLocalActive(true);
    setLocalCancelPending(false);
    setLocalUnits(res.units);
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await scheduleMediaModerationAddonRemovalAction();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setLocalCancelPending(true);
  };

  if (localActive) {
    return (
      <div className="w-surface-raised border w-teal-border rounded-lg p-3">
        <div className="flex items-center justify-between mb-1">
          <p className="w-display text-xs w-teal flex items-center gap-1.5"><ShieldCheck size={13} /> Media Moderation +</p>
          <span className="w-pill w-teal-soft-bg w-teal text-[10px]">Active</span>
        </div>
        <p className="text-[11px] w-text-faint mb-2">{localUnits.toLocaleString()} Media Moderation Units this period</p>
        {localCancelPending ? (
          <p className="text-[11px] w-amber">Scheduled to end at your next renewal — no refund for the remaining period.</p>
        ) : (
          <button onClick={remove} disabled={busy} className="text-[11px] w-text-faint hover:text-red-400 disabled:opacity-60">
            Remove add-on
          </button>
        )}
        {error && <p className="text-[11px] text-red-400 mt-1.5">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-surface-raised border w-teal-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="w-display text-xs w-teal">Media Moderation +</p>
        <span className="w-pill w-teal-soft-bg w-teal text-[10px]">Optional add-on</span>
      </div>
      <p className="text-[11px] w-text-faint mb-2">Photo & video media safety — {MODERATOR_MEDIA_ADDON[tier].units.toLocaleString()} Media Moderation Units/mo</p>
      <p className="w-display text-base w-text mb-1">
        +${regular.toFixed(2)}<span className="text-[11px] w-text-faint font-normal">/mo</span>
      </p>
      <p className="text-[11px] w-teal mb-2">${creditPrice.toFixed(2)}/mo with Innvil Credit</p>
      {error && <p className="text-[11px] text-red-400 mb-2">{error}</p>}
      <button onClick={purchase} disabled={busy} className="w-btn-primary text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 flex items-center gap-1.5">
        {busy ? "Adding…" : <><CheckCircle2 size={12} /> Add Media Moderation + ({planName})</>}
      </button>
    </div>
  );
}
