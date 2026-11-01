"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { listAvailableInnvilCreditGateways, createInnvilCreditTopUpCheckout } from "@/src/lib/products/innvil-credit-checkout";
import { INNVIL_CREDIT_MIN_TOPUP_USD, INNVIL_CREDIT_MAX_TOPUP_USD } from "@/src/lib/products/innvil-credit-pricing";

const GATEWAY_LABELS: Record<string, string> = { cryptomus: "Cryptomus", nowpayments: "NOWPayments" };

/** Real crypto top-up flow for Innvil Credit -- only ever offers gateways
 *  `listAvailableInnvilCreditGateways` actually reports as configured, and
 *  never claims a balance increase until the provider's webhook settles
 *  (this component only ever redirects to the gateway's hosted checkout;
 *  it never itself credits anything). */
export function AddCreditCard({ onClose }: { onClose: () => void }) {
  const [gateways, setGateways] = useState<string[] | null>(null);
  const [amount, setAmount] = useState("100");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAvailableInnvilCreditGateways().then(setGateways).catch(() => setGateways([]));
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    const res = await createInnvilCreditTopUpCheckout(Number(amount), selected);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setRedirecting(true);
    window.location.href = res.data.url;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Add Innvil Credit">
      <div className="w-surface border w-line rounded-2xl p-6 max-w-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <p className="w-display text-lg">Add Innvil Credit</p>
          <button onClick={onClose} className="text-sm w-text-dim hover:w-text">Close</button>
        </div>

        <label className="block text-xs w-text-faint mb-1" htmlFor="credit-amount">Amount (USD)</label>
        <input
          id="credit-amount"
          type="number"
          min={INNVIL_CREDIT_MIN_TOPUP_USD}
          max={INNVIL_CREDIT_MAX_TOPUP_USD}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
        />

        {gateways === null && (
          <p className="text-sm w-text-dim flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading payment options…</p>
        )}
        {gateways !== null && gateways.length === 0 && (
          <p className="text-sm text-red-400">Payments are temporarily unavailable. Please try again shortly.</p>
        )}
        {gateways !== null && gateways.length > 0 && (
          <div className="space-y-2 mb-3">
            {gateways.map((g) => (
              <button
                key={g}
                onClick={() => setSelected(g)}
                className={`w-full text-left text-sm w-surface-raised border rounded-lg px-4 py-3 ${selected === g ? "w-teal-border" : "w-line-soft hover:w-teal-border"}`}
              >
                {GATEWAY_LABELS[g] ?? g}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
        <button
          onClick={submit}
          disabled={busy || redirecting || !selected}
          className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg w-full disabled:opacity-60"
        >
          {redirecting ? "Redirecting…" : busy ? "Starting…" : "Continue"}
        </button>

        <p className="text-[11px] w-text-faint mt-3">
          Innvil Credit is prepaid service credit for eligible Innvil products. It is non-transferable and cannot be
          withdrawn as crypto. Purchases are generally non-refundable except where required by applicable law.
        </p>
      </div>
    </div>
  );
}
