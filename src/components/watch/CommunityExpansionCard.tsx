"use client";

import React, { useState } from "react";
import { CheckCircle2, Layers } from "lucide-react";
import { COMMUNITY_EXPANSION_MONTHLY_PRICE, type CommunityExpansionEligibleTier } from "@/src/lib/money";
import { watchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import { creditPriceUsd, annualCreditPriceUsd } from "@/src/lib/products/innvil-credit-pricing";
import { purchaseCommunityExpansionWithCreditAction, scheduleCommunityExpansionRemovalAction } from "@/src/lib/actions/innvil-credit";
import { createCommunityExpansionCheckout } from "@/src/lib/products/watch-checkout";

/**
 * Usage-page purchase/management surface for the Gold/Platinum-only
 * Community Expansion add-on (a fixed package, never a per-Community
 * quantity selector). Only ever rendered for an eligible tier -- the caller
 * (Usage page) already gates on `capacity.communityExpansionEligible`.
 * Innvil Credit is the primary path here (immediate, atomic, no redirect);
 * direct crypto is offered as a secondary option for monthly billing only
 * (annual is Innvil-Credit-only, server-enforced, so no crypto option is
 * ever shown when `billingInterval === "annual"`).
 */
export function CommunityExpansionCard({
  tier, billingInterval, active, cancelAtPeriodEnd, included, max, used, availableGateways,
}: {
  tier: CommunityExpansionEligibleTier;
  billingInterval: WatchBillingInterval;
  active: boolean;
  cancelAtPeriodEnd: boolean;
  included: number;
  max: number;
  used: number;
  availableGateways: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [localActive, setLocalActive] = useState(active);
  const [localCancelPending, setLocalCancelPending] = useState(cancelAtPeriodEnd);

  const planName = watchPlanDisplayName(tier);
  const regular = COMMUNITY_EXPANSION_MONTHLY_PRICE[tier];
  const creditPrice = billingInterval === "annual" ? annualCreditPriceUsd(regular) : creditPriceUsd(regular, tier);

  const purchase = async () => {
    setBusy(true);
    setError(null);
    const res = await purchaseCommunityExpansionWithCreditAction();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setLocalActive(true);
    setLocalCancelPending(false);
  };

  const payWithCrypto = async (gateway: string) => {
    setBusy(true);
    setError(null);
    const res = await createCommunityExpansionCheckout(gateway);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setRedirecting(true);
    window.location.href = res.data.url;
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const res = await scheduleCommunityExpansionRemovalAction();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setLocalCancelPending(true);
  };

  if (localActive) {
    return (
      <div className="w-card p-5">
        <div className="flex items-center gap-2 mb-2">
          <Layers size={16} className="w-teal" />
          <p className="w-display text-sm">Community Expansion — {planName}</p>
          <span className="w-pill w-teal-soft-bg w-teal text-[11px] ml-auto">Active</span>
        </div>
        <p className="text-xs w-text-dim mb-1">
          {included} included + Community Expansion = up to {max} Communities. Currently using {used} of {max}.
        </p>
        {localCancelPending ? (
          <p className="text-xs w-amber mt-2">
            Scheduled to end at your next renewal — your expanded capacity (up to {max}) stays available until then. No refund is issued for the remaining period.
          </p>
        ) : (
          <>
            <p className="text-xs w-text-faint mt-1">Renews together with your {planName} subscription — no separate billing date.</p>
            <button onClick={remove} disabled={busy} className="text-xs w-text-faint hover:text-red-400 mt-3 disabled:opacity-60">
              Remove Community Expansion
            </button>
          </>
        )}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="w-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Layers size={16} className="w-teal" />
        <p className="w-display text-sm">Community Expansion</p>
      </div>
      <p className="text-xs w-text-dim mb-3">
        {planName} includes {included} Communities. Add Community Expansion to raise your capacity to {max} — never changes your Watcher slot allowance.
      </p>
      <div className="w-surface-raised border w-line-soft rounded-lg p-3 mb-3 text-sm">
        <p className="w-text">
          ${regular.toFixed(2)}{billingInterval === "annual" ? "/mo equivalent" : "/mo"}
          {" "}<span className="text-xs w-text-faint font-normal">regular</span>
        </p>
        <p className="text-xs w-teal mt-0.5">
          ${creditPrice.toFixed(2)}{billingInterval === "annual" ? "/year" : "/mo"} with Innvil Credit
          {billingInterval === "annual" && <span className="w-text-faint"> (Innvil Credit only)</span>}
        </p>
      </div>
      {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={purchase} disabled={busy} className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60 flex items-center gap-1.5">
          {busy && !redirecting ? "Adding…" : <><CheckCircle2 size={13} /> Add with Innvil Credit</>}
        </button>
        {billingInterval !== "annual" && availableGateways.map((g) => (
          <button
            key={g}
            onClick={() => payWithCrypto(g)}
            disabled={busy}
            className="text-xs px-4 py-2 rounded-lg border w-line-soft w-surface-raised w-text-dim hover:w-teal-border disabled:opacity-60"
          >
            {redirecting ? "Redirecting…" : `Pay with ${g === "cryptomus" ? "Cryptomus" : g === "nowpayments" ? "NOWPayments" : g}`}
          </button>
        ))}
      </div>
    </div>
  );
}
