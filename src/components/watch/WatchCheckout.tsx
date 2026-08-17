"use client";

import React, { useEffect, useState } from "react";
import { ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { listAvailableDirectWatchGateways, createDirectWatchCheckout } from "@/src/lib/products/watch-checkout";
import { createWatchBinanceDeposit, claimWatchBinancePayment, type WatchBinanceDepositInfo } from "@/src/lib/products/watch-binance";
import type { WatchPlanDisplayName } from "@/src/lib/products/watch-plans";

const GATEWAY_LABELS: Record<string, string> = {
  cryptomus: "Cryptomus",
  nowpayments: "NOWPayments",
  binance_pay: "Binance Pay",
};

type Plan = Exclude<WatchPlanDisplayName, "Enterprise">;

/**
 * Direct Watch checkout — wired to the REAL backend actions, no fabricated
 * states. Only ever displays gateways `listAvailableDirectWatchGateways`
 * actually reports as configured; never invents a "success" from client
 * state alone (Cryptomus/NOWPayments activate only once their webhook
 * confirms server-side; Binance Pay activates only once
 * `claimWatchBinancePayment` gets a real match back).
 */
export function WatchCheckout({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const [gateways, setGateways] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [binanceDeposit, setBinanceDeposit] = useState<WatchBinanceDepositInfo | null>(null);
  const [txInput, setTxInput] = useState("");
  const [claimStatus, setClaimStatus] = useState<"idle" | "checking" | "confirmed" | "failed">("idle");
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    listAvailableDirectWatchGateways().then(setGateways).catch(() => setGateways([]));
  }, []);

  const startHostedCheckout = async (gateway: "cryptomus" | "nowpayments") => {
    setBusy(true);
    setError(null);
    const res = await createDirectWatchCheckout(plan, gateway);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setRedirecting(true);
    window.location.href = res.data.url;
  };

  const startBinanceDeposit = async () => {
    setBusy(true);
    setError(null);
    const res = await createWatchBinanceDeposit(plan);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setBinanceDeposit(res.data);
  };

  const claimBinance = async () => {
    if (!binanceDeposit) return;
    setClaimStatus("checking");
    setClaimError(null);
    const res = await claimWatchBinancePayment(binanceDeposit.depositId, txInput);
    if (!res.ok) { setClaimStatus("failed"); setClaimError(res.error); return; }
    setClaimStatus("confirmed");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-surface border w-line rounded-2xl p-6 max-w-md w-full">
        <div className="flex items-center justify-between mb-4">
          <p className="w-display text-lg">Subscribe to {plan}</p>
          <button onClick={onClose} className="text-sm w-text-dim hover:w-text">Close</button>
        </div>

        {gateways === null && (
          <p className="text-sm w-text-dim flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading payment options…</p>
        )}

        {gateways !== null && gateways.length === 0 && (
          <p className="text-sm text-red-400">Payments are temporarily unavailable. Please try again shortly or contact support.</p>
        )}

        {gateways !== null && gateways.length > 0 && !selected && (
          <div className="space-y-2">
            <p className="text-xs w-text-faint mb-2">Choose a payment method</p>
            {gateways.map((g) => (
              <button
                key={g}
                onClick={() => setSelected(g)}
                className="w-full text-left text-sm w-surface-raised border w-line-soft rounded-lg px-4 py-3 hover:w-teal-border"
              >
                {GATEWAY_LABELS[g] ?? g}
              </button>
            ))}
          </div>
        )}

        {selected && (selected === "cryptomus" || selected === "nowpayments") && (
          <div className="space-y-3">
            <p className="text-sm w-text-dim">You&apos;ll be redirected to {GATEWAY_LABELS[selected]} to complete payment securely.</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setSelected(null)} disabled={busy || redirecting} className="text-xs px-3 py-2 rounded-lg border w-line-soft w-surface-raised w-text-dim disabled:opacity-60">
                Back
              </button>
              <button
                onClick={() => startHostedCheckout(selected as "cryptomus" | "nowpayments")}
                disabled={busy || redirecting}
                className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
              >
                {redirecting ? <>Redirecting… <ExternalLink size={14} /></> : busy ? "Starting…" : "Continue"}
              </button>
            </div>
          </div>
        )}

        {selected === "binance_pay" && !binanceDeposit && (
          <div className="space-y-3">
            <p className="text-sm w-text-dim">Pay Innvil directly via Binance Pay, then confirm with your transaction id.</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => setSelected(null)} disabled={busy} className="text-xs px-3 py-2 rounded-lg border w-line-soft w-surface-raised w-text-dim disabled:opacity-60">
                Back
              </button>
              <button onClick={startBinanceDeposit} disabled={busy} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
                {busy ? "Preparing…" : "Get payment details"}
              </button>
            </div>
          </div>
        )}

        {binanceDeposit && claimStatus !== "confirmed" && (
          <div className="space-y-3">
            <div className="w-surface-raised border w-line-soft rounded-lg p-3 text-sm">
              <p>Send <strong>{binanceDeposit.amount.toFixed(2)} USDT</strong> to Binance Pay ID:</p>
              <p className="w-mono w-teal text-base mt-1">{binanceDeposit.payId}</p>
              {binanceDeposit.qrImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={binanceDeposit.qrImage} alt="Binance Pay QR code" className="mt-3 w-32 h-32 rounded-lg" />
              )}
            </div>
            <p className="text-xs w-text-faint">USDT only. After paying, enter the transaction/order id from your Binance app to confirm.</p>
            <input
              value={txInput}
              onChange={(e) => setTxInput(e.target.value)}
              placeholder="Transaction / order id"
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
            />
            {claimStatus === "failed" && claimError && <p className="text-xs text-red-400 flex items-center gap-1.5"><XCircle size={14} /> {claimError}</p>}
            <button
              onClick={claimBinance}
              disabled={claimStatus === "checking" || !txInput.trim()}
              className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg w-full disabled:opacity-60"
            >
              {claimStatus === "checking" ? "Verifying…" : "I've paid — verify"}
            </button>
          </div>
        )}

        {claimStatus === "confirmed" && (
          <div className="text-center py-4 space-y-2">
            <CheckCircle2 size={32} className="mx-auto w-green" />
            <p className="text-sm w-text">Payment confirmed — your Watch subscription is now active.</p>
            <button onClick={() => window.location.reload()} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg mt-2">
              Continue to dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
