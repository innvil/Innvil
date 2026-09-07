"use client";

import Link from "next/link";
import { CreditCard, ShieldCheck, LifeBuoy } from "lucide-react";
import useSWR from "swr";
import { getPlansPageData } from "@/src/lib/actions/watch-dashboard";
import { WATCH_SWR_KEYS } from "@/src/lib/watch-swr-keys";
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/products/watch-trial";
import { watchPlanOptions, watchAccessLabel, formatSlotLimit } from "@/src/lib/products/watch-plans";
import { WatchShell } from "./WatchShell";
import { SectionHeader } from "./WatchUI";
import { BillingPlanPicker } from "./BillingPlanPicker";
import { EnterpriseModeCards } from "./EnterpriseModeCards";
import { FreeTrialCard } from "./FreeTrialCard";
import { TableSkeleton } from "./DashboardSkeletons";

/** Cache-first `/plans`. The plan option list / current display name /
 *  Enterprise inquiry body are all pure derivations of the fetched data --
 *  computed here client-side exactly as the original Server Component did,
 *  since watchPlanOptions()/watchAccessLabel() are plain, client-safe
 *  functions (no server-only import). */
export function PlansPageClient() {
  const { data, isLoading } = useSWR(WATCH_SWR_KEYS.plans, getPlansPageData, {
    revalidateOnFocus: true,
  });

  if (isLoading || !data) {
    return (
      <WatchShell active="plans" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  if (!data.authenticated) {
    if (typeof window !== "undefined") window.location.href = "/";
    return (
      <WatchShell active="plans" capacity={null} attentionCount={0}>
        <TableSkeleton />
      </WatchShell>
    );
  }

  const { capacity, attentionCount, trial, mediaAddonState } = data;
  const options = watchPlanOptions();
  const currentDisplayName = capacity
    ? watchAccessLabel(capacity.tier, { apiSourceMode: capacity.apiSourceMode ?? "managed", slots: capacity.enterpriseSlots })
    : null;
  const platinum = options.find((o) => o.displayName === "Platinum")!;
  const enterpriseInquiryBody = capacity
    ? `Current plan: ${currentDisplayName}\nWatcher slots used: ${capacity.activeDeploymentCount}/${formatSlotLimit(capacity.slotsTotal)}\nCommunities used: ${capacity.communitiesUsed}/${capacity.communitiesTotal}\n\n`
    : "";

  return (
    <WatchShell active="plans" capacity={capacity} attentionCount={attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Plans</h1>
          <p className="text-sm w-text-dim">What Watch access you can have — the Free Trial, Bronze through Platinum, and Enterprise.</p>
          {capacity && (
            <p className="text-xs w-text-faint mt-1">
              Current access: <span className="w-teal font-medium">{currentDisplayName}</span>
            </p>
          )}
        </div>

        <FreeTrialCard
          initial={trial}
          capacity={capacity}
          durationDays={TRIAL_DURATION_DAYS}
          slots={TRIAL_CAPACITY.maxActiveSlots}
          communitiesAllowed={TRIAL_CAPACITY.maxCommunities}
        />

        <div id="paid-plans" className="w-card p-5 scroll-mt-20">
          <SectionHeader icon={CreditCard} title="Bronze, Silver, Gold, Platinum, BYO 20" />
          <BillingPlanPicker
            options={options}
            currentDisplayName={capacity?.tier !== "trial" ? currentDisplayName : null}
            currentBillingInterval={capacity && capacity.tier !== "trial" ? capacity.billingInterval : "monthly"}
          />
        </div>

        <div id="enterprise" className="w-card-raised p-5 border w-teal-border scroll-mt-24">
          <SectionHeader icon={ShieldCheck} title="Enterprise" />
          <p className="text-sm w-text-dim mb-1">Innvil Watch Enterprise — for operations beyond Platinum.</p>
          <p className="text-xs w-text-faint mb-5">
            Need more than Platinum's {platinum.slots} Watcher slots or {platinum.communitiesMax} Communities? Choose the Enterprise model that fits how you operate — both use the same Watch CRM, Projects, Communities, and Watchers. Provisioning is still finalized with us; pricing below is real, not a placeholder.
          </p>
          <EnterpriseModeCards baseBody={enterpriseInquiryBody} />
        </div>

        <div className="w-card p-4 flex items-center justify-between gap-3">
          <p className="text-sm w-text-dim flex items-center gap-2">
            <LifeBuoy size={15} className="w-teal" /> Watcher slots, Community allowances, and Enterprise are explained in the Help Center.
          </p>
          <Link href="/support/plans-billing" className="w-teal hover:underline text-sm font-medium shrink-0">Visit Help Center →</Link>
        </div>
      </div>
    </WatchShell>
  );
}
