"use client";

import Link from "next/link";
import { CreditCard, Receipt, ShieldCheck, Clock } from "lucide-react";
import useSWR from "swr";
import { getBillingPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { watchPlanOptions, watchAccessLabel, watchPlanDisplayName, formatSlotLimit } from "@/src/lib/products/watch-plans";
import { annualCreditPriceUsd, annualDirectPriceUsd } from "@/src/lib/products/innvil-credit-pricing";
import { COMMUNITY_EXPANSION_MONTHLY_PRICE, isCommunityExpansionEligibleTier, type ModeratorPlanTier } from "@/src/lib/money";
import { WatchShell } from "./WatchShell";
import { SectionHeader } from "./WatchUI";
import { RenewWatchButton } from "./RenewWatchButton";
import { InnvilCreditSection } from "./InnvilCreditSection";
import { trialTimeRemainingLabel } from "@/src/lib/products/watch-trial-format";
import { TableSkeleton } from "./DashboardSkeletons";

const GATEWAY_LABEL: Record<string, string> = { cryptomus: "Cryptomus", nowpayments: "NOWPayments", binance_pay: "Binance Pay" };
const STATUS_LABEL: Record<string, string> = { pending: "Pending", completed: "Paid", failed: "Failed", expired: "Expired", cancelled: "Cancelled" };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Cache-first `/billing`. Every derived price (combinedPrice/annual totals)
 *  is computed here client-side, exactly as the original Server Component
 *  did, since the pricing helpers involved are plain/client-safe (already
 *  used inside WatchCheckout, a "use client" component). */
export function BillingPageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.billing, getBillingPageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="billing" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return (
      <WatchShell active="billing" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { capacity, attentionCount, trial, paidPlan, history, availableGateways, pending, creditBalance, creditActivity, expansionActive, expansionCancelAtPeriodEnd } = data;

  const options = watchPlanOptions();
  const isPaidActive = capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise";
  const isTrialActive = capacity?.tier === "trial";
  const isEnterpriseActive = capacity?.tier === "enterprise";
  const price = isPaidActive && capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" ? options.find((o) => o.tier === (capacity.tier as ModeratorPlanTier))?.price : null;
  const expansionActiveNotCancelled = expansionActive && !expansionCancelAtPeriodEnd
    && capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" && isCommunityExpansionEligibleTier(capacity.tier)
    ? COMMUNITY_EXPANSION_MONTHLY_PRICE[capacity.tier]
    : null;
  const combinedPrice = price != null ? price + (expansionActiveNotCancelled ?? 0) : null;
  const annualDirectTotal = price != null
    ? annualDirectPriceUsd(price) + (expansionActiveNotCancelled != null ? annualCreditPriceUsd(expansionActiveNotCancelled) : 0)
    : null;
  const annualCreditTotal = price != null
    ? annualCreditPriceUsd(price) + (expansionActiveNotCancelled != null ? annualCreditPriceUsd(expansionActiveNotCancelled) : 0)
    : null;

  return (
    <WatchShell active="billing" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Billing</h1>
          <p className="text-sm w-text-dim">Your current subscription, payment method, Innvil Credit, and payment history.</p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={ShieldCheck} title="Current subscription" />
          {isPaidActive && capacity && capacity.tier !== "trial" && capacity.tier !== "enterprise" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="w-display text-lg w-teal">{watchAccessLabel(capacity.tier)}</p>
                  <p className="text-xs w-text-faint mt-0.5">
                    {capacity.billingInterval === "annual" ? (
                      annualDirectTotal != null && <>${annualDirectTotal.toFixed(2)}/year</>
                    ) : (
                      combinedPrice != null && <>${combinedPrice.toFixed(2)}/mo</>
                    )}
                    {expansionActiveNotCancelled != null && <span className="w-text-faint"> (incl. Community Expansion)</span>}
                  </p>
                  {capacity.billingInterval === "annual" && annualCreditTotal != null && (
                    <p className="text-[11px] w-teal mt-0.5">Save more — ${annualCreditTotal.toFixed(2)}/year with Innvil Credit</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
                  <span className="w-pill w-surface-raised w-text-faint text-[11px] capitalize">{capacity.billingInterval}</span>
                  {expansionActiveNotCancelled != null && <span className="w-pill w-surface-raised w-text-faint text-[11px]">+ Community Expansion</span>}
                </div>
              </div>
              {capacity.paidThrough ? (
                <p className="text-xs w-text-dim">
                  {capacity.billingInterval === "annual" ? "Paid through" : "Current period ends"}{" "}
                  <span className="w-text font-medium">{formatDate(capacity.paidThrough)}</span>
                </p>
              ) : (
                <p className="text-xs w-text-faint">No tracked billing period on this subscription yet — it stays active until your next renewal or plan change.</p>
              )}
              <p className="text-xs w-text-faint">
                Renewal: manual crypto payment, or Innvil Credit. Innvil Watch does not currently auto-charge a recurring payment.
              </p>
              {pending ? (
                <PendingPaymentNote pending={pending} />
              ) : (
                <RenewWatchButton tier={capacity.tier} label="Pay renewal" billingInterval={capacity.billingInterval} />
              )}
            </div>
          ) : isEnterpriseActive && capacity ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <p className="w-display text-lg w-teal">{watchAccessLabel(capacity.tier, { apiSourceMode: capacity.apiSourceMode ?? "managed", slots: capacity.enterpriseSlots })}</p>
                  <p className="text-xs w-text-faint mt-0.5">{formatSlotLimit(capacity.slotsTotal)} Watcher slots · {capacity.communitiesTotal} Communities included</p>
                </div>
                <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
              </div>
              {capacity.paidThrough ? (
                <p className="text-xs w-text-dim">Current period ends <span className="w-text font-medium">{formatDate(capacity.paidThrough)}</span></p>
              ) : (
                <p className="text-xs w-text-faint">No tracked billing period on this subscription yet — it stays active until your next renewal.</p>
              )}
              <p className="text-xs w-text-faint">
                {capacity.apiSourceMode === "byo"
                  ? "Enterprise capacity and billing are provisioned and renewed manually by the Innvil Enterprise team — contact support for changes or renewal. Your own AI provider usage is billed separately by your provider."
                  : "Managed Enterprise capacity and billing are provisioned and renewed manually by the Innvil Enterprise team — contact support for changes or renewal."}
              </p>
              <Link href="/support" className="text-xs w-teal hover:underline">Contact support</Link>
            </div>
          ) : paidPlan && paidPlan.expired ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <p className="w-display text-lg w-text">{watchPlanDisplayName(paidPlan.tier)}</p>
                <div className="flex flex-col items-end gap-1">
                  <span className="w-pill w-surface-raised w-text-faint text-[11px]">Expired</span>
                  <span className="w-pill w-surface-raised w-text-faint text-[11px] capitalize">{paidPlan.billingInterval}</span>
                </div>
              </div>
              {paidPlan.currentPeriodEnd && <p className="text-xs w-text-dim">Paid through {formatDate(paidPlan.currentPeriodEnd)}</p>}
              <p className="text-sm w-text-dim">Your Watch setup is still saved.</p>
              {pending ? (
                <PendingPaymentNote pending={pending} />
              ) : (
                <div className="flex items-center gap-2">
                  <RenewWatchButton tier={paidPlan.tier} label="Renew" billingInterval={paidPlan.billingInterval} />
                  <Link href="/plans" className="text-xs w-teal hover:underline">View plans</Link>
                </div>
              )}
            </div>
          ) : isTrialActive && trial.endsAt ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <p className="w-display text-lg w-teal">Free Trial</p>
                <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
              </div>
              <p className="text-xs w-text-faint">{trialTimeRemainingLabel(trial.endsAt)}</p>
              <p className="text-sm w-text-dim">Paid subscription: None · Payment required: No</p>
              <Link href="/plans" className="text-xs w-teal hover:underline">View plans</Link>
            </div>
          ) : (
            <div>
              <p className="text-sm w-text mb-1">No active subscription</p>
              <p className="text-xs w-text-faint mb-3">Choose a plan to activate Watch, or start the Free Trial if you haven't yet.</p>
              <Link href="/plans" className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg inline-block">View plans</Link>
            </div>
          )}
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={CreditCard} title="Payment method" />
          <p className="text-sm w-text-dim mb-1">Innvil Watch is billed with <span className="w-text font-medium">crypto payments only</span>, plus Innvil Credit as a discounted second option.</p>
          {availableGateways.length > 0 ? (
            <p className="text-xs w-text-faint">Available: {availableGateways.map((g) => GATEWAY_LABEL[g] ?? g).join(", ")}.</p>
          ) : (
            <p className="text-xs w-text-faint">No payment gateway is configured right now — contact support.</p>
          )}
        </div>

        <InnvilCreditSection initialBalance={creditBalance} initialActivity={creditActivity} />

        <div className="w-card p-5">
          <SectionHeader icon={Receipt} title="Payments" />
          {history.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm w-text mb-1">No payments yet</p>
              <p className="text-xs w-text-faint mb-4">
                {isTrialActive
                  ? "You're currently using the Innvil Watch Free Trial. When you choose a paid plan, your crypto payments will appear here."
                  : "When you choose a paid plan, your crypto payments will appear here."}
              </p>
              <Link href="/plans" className="w-teal text-xs hover:underline">View plans</Link>
            </div>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide w-text-faint">
                    <th className="font-semibold pb-2 px-1">Date</th>
                    <th className="font-semibold pb-2 px-1">Plan</th>
                    <th className="font-semibold pb-2 px-1">Provider</th>
                    <th className="font-semibold pb-2 px-1">Amount</th>
                    <th className="font-semibold pb-2 px-1">Status</th>
                    <th className="font-semibold pb-2 px-1">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => (
                    <tr key={p.id} className="border-t w-line-soft">
                      <td className="py-2.5 px-1 w-text-dim whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td className="py-2.5 px-1 w-text capitalize">
                        {p.plan ? watchPlanDisplayName(p.plan as ModeratorPlanTier) : "—"}
                        {p.purpose === "watch_addon_purchase" && <span className="w-text-faint"> · Community Expansion</span>}
                      </td>
                      <td className="py-2.5 px-1 w-text-dim">{GATEWAY_LABEL[p.gateway] ?? p.gateway}</td>
                      <td className="py-2.5 px-1 w-text-dim whitespace-nowrap">{p.amount.toFixed(2)} {p.currency}</td>
                      <td className="py-2.5 px-1">
                        <span className={`w-pill text-[10px] ${p.status === "completed" ? "w-teal-soft-bg w-teal" : p.status === "pending" ? "w-amber-soft-bg w-amber" : "w-surface-raised w-text-faint"}`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-1 w-text-faint text-xs break-all max-w-[160px]">{p.reference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </WatchShell>
  );
}

function PendingPaymentNote({ pending }: { pending: { gateway: string; amount: number; currency: string; createdAt: string } }) {
  return (
    <div className="w-surface-raised border w-amber-border rounded-lg p-3 text-xs">
      <p className="w-text flex items-center gap-1.5 font-medium mb-1"><Clock size={13} className="w-amber" /> Payment pending</p>
      <p className="w-text-dim">Provider: {GATEWAY_LABEL[pending.gateway] ?? pending.gateway} · Amount: {pending.amount.toFixed(2)} {pending.currency}</p>
      <p className="w-text-faint mt-1">Complete your existing payment before starting another.</p>
    </div>
  );
}
