"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { WatchCheckout } from "./WatchCheckout";
import type { WatchPlanOption, WatchPlanDisplayName } from "@/src/lib/products/watch-plans";

type Plan = Exclude<WatchPlanDisplayName, "Enterprise">;

const PLAN_BLURBS: Record<Plan, string> = {
  Bronze: "For a single community getting started with AI moderation.",
  Silver: "For growing communities that need more coverage.",
  Gold: "For established projects running multiple communities.",
  Platinum: "For teams running Watch at scale.",
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
      <p className="text-xs fp-mono uppercase fp-gold tracking-wider text-center mb-2">Pricing</p>
      <h2 className="fp-display text-3xl text-center mb-3">Choose your Watch plan</h2>
      <p className="fp-text-dim text-center max-w-lg mx-auto mb-12">Simple monthly pricing. Cancel anytime.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {options.map((opt) => (
          <div key={opt.tier} className="fp-panel border fp-line-soft rounded-2xl p-5 flex flex-col">
            <p className="fp-display text-lg">{opt.displayName}</p>
            <p className="text-xs fp-text-faint mb-4">{PLAN_BLURBS[opt.displayName as Plan]}</p>
            <p className="text-2xl fp-display mb-1">${opt.price.toFixed(2)}<span className="text-sm fp-text-faint">/mo</span></p>
            <button
              onClick={() => subscribe(opt.displayName as Plan)}
              className="mt-4 fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Subscribe
            </button>
          </div>
        ))}

        <div className="fp-panel border fp-line-soft rounded-2xl p-5 flex flex-col">
          <p className="fp-display text-lg">Enterprise</p>
          <p className="text-xs fp-text-faint mb-4">For large-scale deployments — custom pricing.</p>
          <p className="text-2xl fp-display mb-1 flex items-center gap-1"><CheckCircle2 size={18} className="fp-gold" /> Custom</p>
          <a href="/signup" className="mt-4 text-sm px-4 py-2 rounded-lg border fp-line-soft fp-panel-raised text-center hover:fp-text">
            Contact us
          </a>
        </div>
      </div>

      {checkoutPlan && <WatchCheckout plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />}
    </section>
  );
}
