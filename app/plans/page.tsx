import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard, ShieldCheck, LifeBuoy } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountCapacity } from "@/src/lib/products/watch-runtime";
import { getWatchTrialState, TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/products/watch-trial";
import { watchPlanOptions, watchAccessLabel } from "@/src/lib/products/watch-plans";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { BillingPlanPicker } from "@/src/components/watch/BillingPlanPicker";
import { EnterpriseModeCards } from "@/src/components/watch/EnterpriseModeCards";
import { FreeTrialCard } from "@/src/components/watch/FreeTrialCard";

export const metadata: Metadata = { title: "Plans — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

// The detailed Watcher-slot/Community-allowance education (diagrams, worked
// examples) and the FAQ that used to live directly on this page have both
// moved to the Help Center (/support/watchers/watcher-profiles-deployments-
// slots, /support/plans-billing/plans-and-billing, /support/plans-billing/
// innvil-watch-enterprise, /support/plans-billing/community-expansion) --
// each plan card's own SlotInfoPopover/CommunityExpansionInfoPopover already
// links straight to the relevant article. This page stays focused on
// choosing a plan.

export default async function PlansPage() {
  const { accountId, admin } = await requireWatchPage();
  const [capacity, trial, shell] = await Promise.all([
    getAccountCapacity(admin, accountId),
    getWatchTrialState(admin, accountId),
    getWatchShellContext(admin, accountId),
  ]);

  const options = watchPlanOptions();
  const currentDisplayName = capacity ? watchAccessLabel(capacity.tier) : null;
  const platinum = options.find((o) => o.displayName === "Platinum")!;
  const enterpriseInquiryBody = capacity
    ? `Current plan: ${currentDisplayName}\nWatcher slots used: ${capacity.activeDeploymentCount}/${capacity.slotsTotal}\nCommunities used: ${capacity.communitiesUsed}/${capacity.communitiesTotal}\n\n`
    : "";

  return (
    <WatchShell active="plans" capacity={shell.capacity} attentionCount={shell.attentionCount}>
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
          <SectionHeader icon={CreditCard} title="Bronze, Silver, Gold, Platinum" />
          <BillingPlanPicker
            options={options}
            currentDisplayName={capacity?.tier !== "trial" ? currentDisplayName : null}
            currentBillingInterval={capacity && capacity.tier !== "trial" ? capacity.billingInterval : "monthly"}
          />
        </div>

        <div className="w-card-raised p-5 border w-teal-border">
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
