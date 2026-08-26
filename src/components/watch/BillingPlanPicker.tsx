"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { WatchPlanOption, WatchPlanDisplayName } from "@/src/lib/products/watch-plans";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import { WatchCheckout } from "./WatchCheckout";
import { SlotInfoPopover, CommunityExpansionInfoPopover } from "./SlotInfoPopover";
import { MediaModerationAddonCard } from "./MediaModerationAddonCard";
import {
  creditPriceUsd, creditSavingsUsd, INNVIL_CREDIT_DISCOUNT, annualCreditPriceUsd,
  annualDirectPriceUsd, annualDirectEquivalentMonthlyUsd, annualDirectSavingsUsd, annualCreditExtraSavingsUsd,
} from "@/src/lib/products/innvil-credit-pricing";
import { Coins } from "lucide-react";
import { COMMUNITY_EXPANSION_MONTHLY_PRICE, isCommunityExpansionEligibleTier, MODERATOR_AI_GENERATION_POOL, MODERATOR_MEDIA_ADDON } from "@/src/lib/money";

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
 *  is actually possible, never fabricated for a tier that can't expand.
 *
 *  Monthly/Annual is a BILLING INTERVAL on the same plan identity, never a
 *  second product ("Silver Annual") -- selecting Annual changes only the
 *  price shown + what WatchCheckout charges for, never the plan grid
 *  itself. Annual has TWO real offers as of 2026-08-25 -- 5% off via any
 *  direct payment option (crypto), or 10% off via Innvil Credit -- both
 *  reachable from WatchCheckout's own payment-method choice screen.
 *
 *  Every card also surfaces a real, visible "pay with Innvil Credit and
 *  save" callout (not just a small price line) -- the discount is real,
 *  computed from the same canonical creditPriceUsd/annualCreditPriceUsd
 *  functions Billing/WatchCheckout already use, never a duplicated number. */
export function BillingPlanPicker({
  options, currentDisplayName, currentBillingInterval = "monthly", mediaAddon,
}: {
  options: WatchPlanOption[];
  currentDisplayName: string | null;
  currentBillingInterval?: WatchBillingInterval;
  /** The account's REAL Media Moderation + state for its CURRENT self-serve
   *  tier (if any) -- only the current-plan card can offer a real Add/Manage
   *  action, since purchasing requires an active subscription on that exact
   *  tier already. Optional so existing callers (e.g. the pre-authenticated
   *  pricing preview, if any) don't need to supply it. */
  mediaAddon?: { active: boolean; cancelAtPeriodEnd: boolean; units: number };
}) {
  const [billingInterval, setBillingInterval] = useState<WatchBillingInterval>("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<SelfServePlan | null>(null);

  return (
    <>
      <div className="flex items-center gap-1 mb-4 w-surface-raised border w-line-soft rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setBillingInterval("monthly")}
          aria-pressed={billingInterval === "monthly"}
          className={`text-xs font-medium px-3 py-1.5 rounded-md ${billingInterval === "monthly" ? "w-teal-soft-bg w-teal" : "w-text-faint hover:w-text-dim"}`}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setBillingInterval("annual")}
          aria-pressed={billingInterval === "annual"}
          className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 ${billingInterval === "annual" ? "w-teal-soft-bg w-teal" : "w-text-faint hover:w-text-dim"}`}
        >
          Annual <span className="w-pill w-green-soft-bg w-green text-[10px]">Save up to 10%</span>
        </button>
      </div>
      {billingInterval === "annual" && (
        <p className="text-xs w-text-faint mb-4">
          Pay one year upfront and save — 5% off with any direct payment option (crypto), or 10% off with Innvil Credit.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {options.map((o) => {
          const isCurrentPlan = o.displayName === currentDisplayName;
          const isCurrent = isCurrentPlan && billingInterval === currentBillingInterval;
          const expandable = o.communitiesMax > o.communitiesIncluded;
          return (
            <div key={o.tier} className={`w-card p-4 flex flex-col ${isCurrent ? "border w-teal-border" : o.tier === "byo20" ? "border w-teal-border" : ""}`}>
              <div className="flex items-center gap-2 mb-1">
                <p className="w-display text-sm">{o.displayName}</p>
                {o.tier === "byo20" && <span className="w-pill w-teal-soft-bg w-teal text-[10px]">Best value</span>}
              </div>
              {billingInterval === "monthly" ? (
                <>
                  <p className="w-display text-xl w-teal mb-0.5">${o.price.toFixed(2)}<span className="text-xs w-text-faint font-normal">/mo</span></p>
                  {INNVIL_CREDIT_DISCOUNT[o.tier] > 0 ? (
                    <div className="w-surface-raised border w-teal-border rounded-lg px-2.5 py-1.5 mb-3 flex items-center gap-1.5">
                      <Coins size={12} className="w-teal shrink-0" />
                      <p className="text-[11px] w-text leading-tight">
                        Save {(INNVIL_CREDIT_DISCOUNT[o.tier] * 100).toFixed(0)}%? Pay with Innvil Credit —{" "}
                        <span className="w-teal font-semibold">${creditPriceUsd(o.price, o.tier).toFixed(2)}/mo</span>
                        <span className="w-text-faint"> (save ${creditSavingsUsd(o.price, o.tier).toFixed(2)})</span>
                      </p>
                    </div>
                  ) : (
                    <p className="mb-3" />
                  )}
                </>
              ) : (
                <>
                  <p className="w-display text-xl w-teal mb-0.5">${annualDirectPriceUsd(o.price).toFixed(2)}<span className="text-xs w-text-faint font-normal">/year</span></p>
                  <p className="text-[11px] w-text-faint">Equivalent to ${annualDirectEquivalentMonthlyUsd(o.price).toFixed(2)}/month</p>
                  <p className="text-[11px] w-green mb-2">Save ${annualDirectSavingsUsd(o.price).toFixed(2)}/year with any direct payment option</p>
                  <div className="w-surface-raised border w-teal-border rounded-lg px-2.5 py-1.5 mb-3 flex items-center gap-1.5">
                    <Coins size={12} className="w-teal shrink-0" />
                    <p className="text-[11px] w-text leading-tight">
                      Save 10%? Pay with Innvil Credit —{" "}
                      <span className="w-teal font-semibold">${annualCreditPriceUsd(o.price).toFixed(2)}/year</span>
                      <span className="w-text-faint"> (${annualCreditExtraSavingsUsd(o.price).toFixed(2)} more than crypto)</span>
                    </p>
                  </div>
                </>
              )}
              <div className="mb-4 border-t w-line-soft pt-3">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">Capacity</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="w-text-dim flex items-center gap-1">Watcher slots <SlotInfoPopover /></span>
                    <span className="w-text font-semibold">{o.slots}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="w-text-dim flex items-center gap-1">
                      Communities
                      {expandable && <CommunityExpansionInfoPopover included={o.communitiesIncluded} max={o.communitiesMax} />}
                    </span>
                    <span className="w-text font-semibold text-right">
                      {o.communitiesIncluded} included
                      {expandable && <span className="block w-text-faint font-normal">Up to {o.communitiesMax}</span>}
                    </span>
                  </div>
                  {expandable && isCommunityExpansionEligibleTier(o.tier) && (
                    <div className="text-right">
                      <p className="text-[11px] w-text-faint">
                        Community Expansion:{" "}
                        {billingInterval === "annual"
                          ? <>+${annualCreditPriceUsd(COMMUNITY_EXPANSION_MONTHLY_PRICE[o.tier]).toFixed(2)}/year <span className="w-teal">Innvil Credit only</span></>
                          : <>+${COMMUNITY_EXPANSION_MONTHLY_PRICE[o.tier].toFixed(2)}/mo</>}
                      </p>
                      <p className="text-[10px] w-text-faint">
                        <Link href="/usage" className="w-teal hover:underline">Manage from Usage</Link> after subscribing
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <div className="mb-3 border-t w-line-soft pt-3">
                <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1.5">AI & moderation</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="w-text-dim">AI Generations</span>
                    {o.tier === "byo20" ? (
                      <span className="w-text font-semibold">Your own AI provider</span>
                    ) : (
                      <span className="w-text font-semibold">{MODERATOR_AI_GENERATION_POOL[o.tier].toLocaleString()}/mo</span>
                    )}
                  </div>
                  {o.tier === "byo20" && (
                    <p className="text-[10px] w-text-faint leading-tight">
                      Requires your own AI provider credential (Anthropic or OpenAI-compatible) — add it in Settings after subscribing.
                    </p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="w-text-dim">Link & spam moderation</span>
                    <span className="w-text font-semibold">Included</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="w-text-dim">Casual Chat & Project Q&A</span>
                    <span className="w-text font-semibold">Included</span>
                  </div>
                  {/* Real tier gate, mirrored from moderator/plan.ts's virtualModProactiveMode
                      (Standard+/trial only) -- never shown for Basic/Bronze, which genuinely
                      doesn't have Proactive Mode/Community Memory. */}
                  {o.tier !== "basic" && (
                    <div className="flex items-center justify-between">
                      <span className="w-text-dim">Proactive Mode & Community Memory</span>
                      <span className="w-text font-semibold">Included</span>
                    </div>
                  )}
                </div>
              </div>

              {/* byo20's Media Moderation is BUNDLED into the base price -- never
                  a separate purchase, unlike the other 4 tiers' optional add-on.
                  No CTA at all here, just a plain "included" statement. */}
              {o.tier === "byo20" ? (
                <div className="mb-4 w-surface-raised border w-teal-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="w-display text-xs w-teal">Media Moderation +</p>
                    <span className="w-pill w-teal-soft-bg w-teal text-[10px]">Included</span>
                  </div>
                  <p className="text-[11px] w-text-faint">
                    Photo & video media safety — {MODERATOR_MEDIA_ADDON.byo20.units.toLocaleString()} Media Moderation Units/mo, bundled at no extra cost.
                  </p>
                </div>
              ) : isCurrentPlan && mediaAddon ? (
                <div className="mb-4">
                  <MediaModerationAddonCard
                    tier={o.tier}
                    billingInterval={billingInterval}
                    active={mediaAddon.active}
                    cancelAtPeriodEnd={mediaAddon.cancelAtPeriodEnd}
                    units={mediaAddon.units || MODERATOR_MEDIA_ADDON[o.tier].units}
                  />
                </div>
              ) : (
                <div className="mb-4 w-surface-raised border w-teal-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="w-display text-xs w-teal">Media Moderation +</p>
                    <span className="w-pill w-teal-soft-bg w-teal text-[10px]">Optional add-on</span>
                  </div>
                  <p className="text-[11px] w-text-faint mb-2">Photo & video media safety — {MODERATOR_MEDIA_ADDON[o.tier].units.toLocaleString()} Media Moderation Units/mo</p>
                  <p className="w-display text-base w-text">+${MODERATOR_MEDIA_ADDON[o.tier].price.toFixed(2)}<span className="text-[11px] w-text-faint font-normal">/mo</span></p>
                </div>
              )}
              {isCurrent ? (
                <span className="mt-auto text-xs w-teal flex items-center gap-1"><CheckCircle2 size={13} /> Current plan</span>
              ) : (
                <button onClick={() => setCheckoutPlan(o.displayName as SelfServePlan)} className="mt-auto w-btn-primary text-xs font-semibold py-2 rounded-lg">
                  {billingInterval === "annual" ? "Choose annual" : currentDisplayName ? "Switch to this plan" : "Subscribe"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {checkoutPlan && <WatchCheckout plan={checkoutPlan} billingInterval={billingInterval} onClose={() => setCheckoutPlan(null)} />}
    </>
  );
}
