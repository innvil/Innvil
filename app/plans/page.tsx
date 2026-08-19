import type { Metadata } from "next";
import { CreditCard, ShieldCheck, Layers } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountCapacity } from "@/src/lib/products/watch-runtime";
import { getWatchTrialState, TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/products/watch-trial";
import { watchPlanOptions, watchAccessLabel, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/products/watch-plans";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader, EmptyRow } from "@/src/components/watch/WatchUI";
import { BillingPlanPicker } from "@/src/components/watch/BillingPlanPicker";
import { SlotDiagram } from "@/src/components/watch/SlotDiagram";
import { EnterpriseModeCards } from "@/src/components/watch/EnterpriseModeCards";
import { FreeTrialCard } from "@/src/components/watch/FreeTrialCard";

export const metadata: Metadata = { title: "Plans — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

const FAQ: Array<{ q: string; a: string }> = [
  { q: "What is a Watcher slot?", a: "One slot is consumed by one Watcher actively deployed to one Community. Slots are the unit your plan's Watcher allowance is measured in." },
  { q: "Does creating a Watcher use a slot?", a: "No. A Watcher profile is a reusable identity — creating one doesn't consume a slot by itself. A slot is only used once that Watcher is deployed to a Community." },
  { q: "Can one Watcher work in multiple Communities?", a: "Yes. The same Watcher profile can be deployed to more than one Community — each deployment is a separate active relationship." },
  { q: "If one Watcher is in two Communities, how many slots does it use?", a: "Two. Slot usage counts active deployments, not distinct Watcher profiles." },
  { q: "Can multiple Watchers work in the same Community?", a: `Yes, up to ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watcher deployments per Community.` },
  { q: "Are Watcher slots and Community limits the same?", a: "No — they're two separate allowances. Your plan has a total Watcher slot allowance and a separate Community allowance; a Community's own deployment limit is a third, independent cap." },
  { q: "What happens when I use all my slots?", a: "You won't be able to deploy another Watcher until you free a slot (pause or remove an existing deployment) or upgrade your plan." },
  { q: "Does removing a deployment free a slot?", a: "Yes — removing an active deployment immediately frees the slot it was using." },
  { q: "Does pausing a deployment free a slot?", a: "Yes — a paused deployment is not active, so it does not count toward your slot usage." },
  { q: "What is the per-Community Watcher limit?", a: `Regardless of your plan's total slot allowance, any single Community can have at most ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watcher deployments.` },
  { q: "Can I get more Communities than my plan includes?", a: "Gold and Platinum can be expanded beyond their included Community allowance, up to that plan's maximum — contact us to add capacity. Bronze and Silver are fixed and don't expand." },
  { q: "What happens if I need more than Platinum's maximum?", a: "That's what Enterprise is for — Managed Enterprise scales per Watcher slot beyond Platinum (from $379.99/mo, +$15/slot for 21–50, +$13/slot for 51+), or choose Bring Your Own Provider from $599/mo." },
  { q: "What is Managed Enterprise?", a: "Innvil supplies and manages the supported provider capacity your Watchers run on — you don't manage any provider credentials yourself. Priced from the Platinum base ($379.99/mo) plus a per-slot rate beyond Platinum's 20 included slots." },
  { q: "What is Bring Your Own Provider?", a: "You supply your own supported AI/provider credentials and use the same Innvil Watch Community Operations platform — Projects, Communities, Watchers, deployments, and the CRM are all identical to Managed Enterprise." },
  { q: "Why can BYO be cheaper?", a: "With BYO, you pay your provider usage directly to your own provider account, so Innvil's platform fee doesn't need to include that cost. This lowers what you pay Innvil — it does not guarantee your total spend (Innvil fee + your provider's usage cost) is lower overall." },
  { q: "Do I still use the same Innvil Watch dashboard with BYO?", a: "Yes — Managed and BYO are two commercial modes of the same Innvil Watch product, on the same watch.innvil.cloud domain, using the same CRM, Projects, Communities, and Watchers." },
  { q: "Who pays for provider usage with BYO?", a: "You do, directly through your own provider account. Innvil's fee covers the Watch platform only." },
  { q: "What is the Free Trial?", a: `A one-time, ${TRIAL_DURATION_DAYS}-day trial of Innvil Watch — ${TRIAL_CAPACITY.maxActiveSlots} Watcher slot and ${TRIAL_CAPACITY.maxCommunities} Community, no payment required. It requires a verified Telegram account and can only be claimed once per Innvil account and per Telegram identity.` },
  { q: "What happens to my data when the trial ends?", a: "Nothing is deleted. Your Projects, Communities, and Watchers stay exactly as they are — choosing a paid plan resumes active Watch operations." },
];

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
          <BillingPlanPicker options={options} currentDisplayName={capacity?.tier !== "trial" ? currentDisplayName : null} />
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={Layers} title="Understanding Watcher slots" />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5 text-xs">
            <div className="w-surface-raised border w-line-soft rounded-lg p-3">
              <p className="w-text font-semibold mb-1">Watcher profile</p>
              <p className="w-text-dim">The reusable Watcher identity/persona you create. Creating one doesn't use a slot.</p>
            </div>
            <div className="w-surface-raised border w-line-soft rounded-lg p-3">
              <p className="w-text font-semibold mb-1">Watcher slot</p>
              <p className="w-text-dim">One active Watcher-to-Community deployment. This is what your plan's slot allowance counts.</p>
            </div>
            <div className="w-surface-raised border w-line-soft rounded-lg p-3">
              <p className="w-text font-semibold mb-1">Community allowance</p>
              <p className="w-text-dim">How many Telegram Communities your plan allows you to connect — a separate limit from slots.</p>
            </div>
          </div>

          <p className="text-sm w-text-dim mb-4">
            A Watcher's profile is reusable — deploying the SAME Watcher to a second Community uses a SECOND slot, since a slot
            is counted per active deployment, not per Watcher.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            <SlotDiagram caption="One Watcher, one Community" watchers={["Aegis"]} communities={["Community A"]} connections={[[0, 0]]} />
            <SlotDiagram caption="One Watcher, two Communities" watchers={["Aegis"]} communities={["Community A", "Community B"]} connections={[[0, 0], [0, 1]]} />
            <SlotDiagram caption="Two Watchers, one Community" watchers={["Aegis", "Sentinel"]} communities={["Community A"]} connections={[[0, 0], [1, 0]]} />
            <SlotDiagram
              caption="Two Watchers, each in two Communities"
              watchers={["Aegis", "Sentinel"]}
              communities={["Community A", "Community B"]}
              connections={[[0, 0], [0, 1], [1, 0], [1, 1]]}
            />
          </div>

          <div className="w-surface-raised border w-line-soft rounded-lg p-3 text-xs w-text-dim mb-4">
            <p className="w-text font-semibold mb-1">Example — slots and Communities are independent limits</p>
            <p>A plan with 10 Watcher slots and a 3-Community allowance could distribute those slots however you like across your Communities — for example 3 in one, 4 in another, 3 in a third: still 10 slots used, 3 Communities connected. This is a worked example, not your current usage.</p>
          </div>

          <div className="w-surface-raised border w-line-soft rounded-lg p-3 text-xs w-text-dim">
            <p className="w-text font-semibold mb-1">Per-Community limit</p>
            <p>Your subscription may include more total Watcher slots than a single Community can use. Regardless of your plan's total slot allowance, any one Community can have at most {MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watcher deployments.</p>
          </div>
        </div>

        <div className="w-card-raised p-5 border w-teal-border">
          <SectionHeader icon={ShieldCheck} title="Enterprise" />
          <p className="text-sm w-text-dim mb-1">Innvil Watch Enterprise — for operations beyond Platinum.</p>
          <p className="text-xs w-text-faint mb-5">
            Need more than Platinum's {platinum.slots} Watcher slots or {platinum.communitiesMax} Communities? Choose the Enterprise model that fits how you operate — both use the same Watch CRM, Projects, Communities, and Watchers. Provisioning is still finalized with us; pricing below is real, not a placeholder.
          </p>
          <EnterpriseModeCards baseBody={enterpriseInquiryBody} />
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={ShieldCheck} title="Frequently asked questions" />
          {FAQ.length === 0 ? (
            <EmptyRow text="No questions yet." />
          ) : (
            <div className="space-y-3">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="text-sm w-text cursor-pointer list-none flex items-center justify-between gap-2">
                    {item.q}
                    <span className="w-text-faint text-xs group-open:rotate-180 transition-transform">▾</span>
                  </summary>
                  <p className="text-xs w-text-dim mt-1.5">{item.a}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </WatchShell>
  );
}
