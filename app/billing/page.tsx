import Link from "next/link";
import type { Metadata } from "next";
import { CreditCard, Receipt, ShieldCheck } from "lucide-react";
import { requireWatchPage, getWatchShellContext } from "@/src/lib/watch-page";
import { getAccountCapacity } from "@/src/lib/products/watch-runtime";
import { getWatchTrialState } from "@/src/lib/products/watch-trial";
import { watchPlanOptions, watchAccessLabel } from "@/src/lib/products/watch-plans";
import { listWatchPaymentHistory, listAvailableDirectWatchGateways } from "@/src/lib/products/watch-checkout";
import { WatchShell } from "@/src/components/watch/WatchShell";
import { SectionHeader } from "@/src/components/watch/WatchUI";
import { trialTimeRemainingLabel } from "@/src/lib/products/watch-trial-format";

export const metadata: Metadata = { title: "Billing — Innvil Watch", robots: { index: false }, icons: { icon: "/watch/app-tile.svg" } };

const GATEWAY_LABEL: Record<string, string> = { cryptomus: "Cryptomus", nowpayments: "NOWPayments", binance_pay: "Binance Pay" };
const STATUS_LABEL: Record<string, string> = { pending: "Pending", completed: "Paid", failed: "Failed", expired: "Expired", cancelled: "Cancelled" };

/** Billing = "how am I paying, and what payments have happened" -- a real
 *  billing/account ledger, not a plan-comparison catalog (that's /plans).
 *  Crypto-only, per current product direction -- never fiat/card language.
 *  Payment history is real, account-scoped `platform_deposits` rows
 *  (purpose='watch_subscription'); nothing here is fabricated. */
export default async function BillingPage() {
  const { accountId, admin } = await requireWatchPage();
  const [capacity, trial, history, availableGateways, shell] = await Promise.all([
    getAccountCapacity(admin, accountId),
    getWatchTrialState(admin, accountId),
    listWatchPaymentHistory(),
    listAvailableDirectWatchGateways(),
    getWatchShellContext(admin, accountId),
  ]);

  const options = watchPlanOptions();
  const isPaid = capacity && capacity.tier !== "trial";
  const isTrialActive = capacity?.tier === "trial";
  const price = isPaid && capacity ? options.find((o) => o.tier === capacity.tier)?.price : null;

  return (
    <WatchShell active="billing" capacity={shell.capacity} attentionCount={shell.attentionCount}>
      <div className="space-y-6">
        <div>
          <h1 className="w-display text-xl mb-1">Billing</h1>
          <p className="text-sm w-text-dim">Your current subscription, payment method, and payment history.</p>
        </div>

        <div className="w-card p-5">
          <SectionHeader icon={ShieldCheck} title="Current access" />
          {isPaid && capacity ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="w-display text-lg w-teal">{watchAccessLabel(capacity.tier)}</p>
                {price != null && <p className="text-xs w-text-faint mt-0.5">${price.toFixed(2)}/mo</p>}
              </div>
              <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
            </div>
          ) : isTrialActive && trial.endsAt ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="w-display text-lg w-teal">Free Trial</p>
                <p className="text-xs w-text-faint mt-0.5">{trialTimeRemainingLabel(trial.endsAt)}</p>
              </div>
              <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
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
          <p className="text-sm w-text-dim mb-1">Innvil Watch is billed with <span className="w-text font-medium">crypto payments only</span>.</p>
          {availableGateways.length > 0 ? (
            <p className="text-xs w-text-faint">
              Available: {availableGateways.map((g) => GATEWAY_LABEL[g] ?? g).join(", ")}.
            </p>
          ) : (
            <p className="text-xs w-text-faint">No payment gateway is configured right now — contact support.</p>
          )}
          {isPaid && (
            <p className="text-xs w-text-faint mt-3 pt-3 border-t w-line-soft">
              Your subscription was activated by a confirmed crypto payment. Innvil Watch does not currently auto-charge a
              recurring crypto payment — there is no scheduled renewal to show.
            </p>
          )}
          {isTrialActive && <p className="text-xs w-text-faint mt-3 pt-3 border-t w-line-soft">Payment required: No. The Free Trial doesn't require any payment method.</p>}
        </div>

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
                      <td className="py-2.5 px-1 w-text capitalize">{p.plan ?? "—"}</td>
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
