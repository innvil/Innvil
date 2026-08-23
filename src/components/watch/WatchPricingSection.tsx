"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock } from "lucide-react";
import { WatchCheckout } from "./WatchCheckout";
import type { WatchPlanOption, WatchPlanDisplayName } from "@/src/lib/products/watch-plans";
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/moderator/plan";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";

type Plan = Exclude<WatchPlanDisplayName, "Enterprise">;

const PLAN_BLURBS: Record<Plan, string> = {
  Bronze: "For a single community getting started with AI moderation.",
  Silver: "For growing communities that need more coverage.",
  Gold: "For established projects running multiple communities.",
  Platinum: "For teams running Watch at scale.",
};

// Subtle rank accent per tier — never literal metallic gradients, just a
// small badge color cue so the hierarchy reads at a glance.
const RANK_ACCENT: Record<Plan, string> = {
  Bronze: "#B08D57",
  Silver: "#B8C2CC",
  Gold: "#D9B44A",
  Platinum: "#8FE3D6",
};

export function WatchPricingSection({ options, authenticated }: { options: WatchPlanOption[]; authenticated: boolean }) {
  const router = useRouter();
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);

  const subscribe = (plan: Plan) => {
    if (!authenticated) { router.push("/signup"); return; }
    setCheckoutPlan(plan);
  };

  return (
    <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
      <p className="text-xs w-mono uppercase w-teal tracking-wider text-center mb-2">Pricing</p>
      <h2 className="w-display text-3xl text-center mb-3">Try free, then choose your Watch plan</h2>
      <p className="w-text-dim text-center max-w-lg mx-auto mb-12">Start with a {TRIAL_DURATION_DAYS}-day Free Trial — no payment required. Simple monthly pricing after that. Cancel anytime.</p>

      <div id="free-trial" className="max-w-md mx-auto mb-6 scroll-mt-24">
        <div className="w-card-raised border w-teal-border p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-2 w-teal-soft-bg w-teal">
              <Clock size={10} /> Free Trial
            </span>
            <p className="text-2xl w-display mb-1">$0 <span className="text-sm w-text-faint font-normal">for {TRIAL_DURATION_DAYS} days</span></p>
            <p className="text-[11px] w-text-dim">{TRIAL_CAPACITY.maxActiveSlots} Watcher slot · {TRIAL_CAPACITY.maxCommunities} Community · No payment required</p>
          </div>
          <Link href="/signup" className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg text-center shrink-0">
            Start Free Trial
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {options.map((opt) => {
          const plan = opt.displayName as Plan;
          return (
            <div key={opt.tier} className="w-card p-5 flex flex-col">
              <span
                className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-3"
                style={{ color: RANK_ACCENT[plan], background: `${RANK_ACCENT[plan]}1F`, border: `1px solid ${RANK_ACCENT[plan]}55` }}
              >
                {plan}
              </span>
              <p className="text-xs w-text-faint mb-4">{PLAN_BLURBS[plan]}</p>
              <p className="text-2xl w-display mb-1">${opt.price.toFixed(2)}<span className="text-sm w-text-faint">/mo</span></p>
              <div className="text-[11px] w-text-dim space-y-0.5 mb-3">
                <p>{opt.slots} Watcher slots</p>
                <p>
                  {opt.communitiesIncluded} communit{opt.communitiesIncluded === 1 ? "y" : "ies"}
                  {opt.communitiesMax > opt.communitiesIncluded && <span> (up to {opt.communitiesMax})</span>}
                </p>
              </div>
              <button
                onClick={() => subscribe(plan)}
                className="mt-4 w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg"
              >
                Subscribe
              </button>
            </div>
          );
        })}

        <div className="w-card-raised p-5 flex flex-col border w-teal-border">
          <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full mb-3 w-teal-soft-bg w-teal">
            Enterprise
          </span>
          <p className="text-xs w-text-faint mb-2">For large-scale deployments — two real ways to run it.</p>
          <p className="text-2xl w-display mb-1 flex items-center gap-1">
            <CheckCircle2 size={18} className="w-teal" /> from ${WATCH_ENTERPRISE_BYO_TIERS[0].price.toFixed(0)}<span className="text-sm w-text-faint">/mo</span>
          </p>
          <div className="text-[11px] w-text-dim space-y-1 mb-3">
            <p>Managed — Innvil runs everything, from ${MANAGED_ENTERPRISE_50.price.toFixed(0)}/mo.</p>
            <p>
              BYO — bring your own AI provider credential and pay less (from ${WATCH_ENTERPRISE_BYO_TIERS[0].price.toFixed(0)}/mo); your
              own provider usage is billed separately, not covered by Innvil.
            </p>
          </div>
          <Link href="/plans#enterprise" className="mt-4 text-sm px-4 py-2 rounded-lg border w-line-soft w-surface text-center hover:w-text">
            Compare Managed vs. BYO
          </Link>
        </div>
      </div>

      {checkoutPlan && <WatchCheckout plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />}
    </section>
  );
}
