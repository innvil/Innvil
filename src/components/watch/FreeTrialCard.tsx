"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Send, Loader2, X, Rocket } from "lucide-react";
import { getWatchTelegramState, startWatchTelegramVerification, cancelWatchTelegramVerification } from "@/src/lib/actions/watch-telegram-identity";
import { getWatchTrialStateAction, startWatchTrialAction } from "@/src/lib/actions/watch-trial";
import type { WatchTrialState } from "@/src/lib/products/watch-trial";
import { trialTimeRemainingLabel, formatTrialEndsAt } from "@/src/lib/products/watch-trial-format";
import type { AccountCapacity } from "@/src/lib/products/watch-runtime";
import { CapacityRow } from "./WatchUI";

const POLL_INTERVAL_MS = 3000;

/** Plans page's Free Trial surface -- a temporary, one-time entitlement,
 *  visually distinct (a single highlighted card, not another tier in the
 *  4-up grid) but part of the same plan family, never presented as a
 *  separate official Product Catalog product. Telegram verification reuses
 *  the EXACT SAME actions Profile's ConnectTelegramCard already uses (no
 *  second identity-linking implementation) -- this card just adds the
 *  "then start the trial" step once verification succeeds. */
export function FreeTrialCard({
  initial, capacity, durationDays, slots, communitiesAllowed,
}: {
  initial: WatchTrialState;
  capacity: AccountCapacity | null;
  durationDays: number;
  slots: number;
  communitiesAllowed: number;
}) {
  const [state, setState] = useState<WatchTrialState>(initial);
  const [connecting, setConnecting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };
  useEffect(() => stopPolling, []);

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const tg = await getWatchTelegramState();
      if (tg.status === "connected") {
        stopPolling();
        setDeepLink(null);
        setState(await getWatchTrialStateAction());
      }
    }, POLL_INTERVAL_MS);
  };

  const connectTelegram = async () => {
    setConnecting(true);
    setError(null);
    const res = await startWatchTelegramVerification();
    setConnecting(false);
    if (!res.ok) { setError(res.error); return; }
    setDeepLink(res.deepLink);
    startPolling();
  };

  const cancelConnect = async () => {
    stopPolling();
    setDeepLink(null);
    await cancelWatchTelegramVerification();
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    const res = await startWatchTrialAction();
    setStarting(false);
    if (!res.ok) { setError(res.error); return; }
    setState(res.state);
  };

  if (state.status === "telegram_required") {
    return (
      <div className="w-card-raised p-5 border w-teal-border">
        <FreeTrialHeader />
        <p className="text-sm w-text-dim mb-3">Verify your Telegram account to claim your one-time trial.</p>
        {deepLink ? (
          <div className="flex items-center gap-2">
            <a href={deepLink} target="_blank" rel="noreferrer" className="w-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5">
              <Send size={13} /> Open Telegram
            </a>
            <button type="button" onClick={cancelConnect} className="text-xs w-text-faint hover:w-text flex items-center gap-1 px-3 py-2 rounded-lg border w-line-soft">
              <X size={13} /> Cancel
            </button>
            <span className="text-xs w-text-faint inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Waiting…</span>
          </div>
        ) : (
          <button type="button" onClick={connectTelegram} disabled={connecting} className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
            {connecting ? "Starting…" : "Connect Telegram"}
          </button>
        )}
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        <p className="text-[11px] w-text-faint mt-3">Manage your connected identity anytime in <Link href="/profile" className="w-teal hover:underline">Profile</Link>.</p>
      </div>
    );
  }

  if (state.status === "eligible") {
    return (
      <div className="w-card-raised p-5 border w-teal-border">
        <FreeTrialHeader />
        <p className="text-sm w-text-dim mb-3">Try Innvil Watch before choosing a paid plan.</p>
        <ul className="text-xs w-text-dim space-y-1 mb-4">
          <li>{durationDays} days</li>
          <li>{slots} Watcher slot{slots === 1 ? "" : "s"}</li>
          <li>{communitiesAllowed} Communit{communitiesAllowed === 1 ? "y" : "ies"}</li>
          <li className="w-text-faint">No payment required</li>
        </ul>
        <button type="button" onClick={start} disabled={starting} className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
          {starting ? "Starting…" : "Start free trial"}
        </button>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    );
  }

  if (state.status === "active") {
    return (
      <div className="w-card-raised p-5 border w-teal-border">
        <div className="flex items-center justify-between mb-2">
          <FreeTrialHeader />
          <span className="w-pill w-teal-soft-bg w-teal text-[11px]">Active</span>
        </div>
        <p className="text-xs w-text-faint mb-1">Ends {state.endsAt ? formatTrialEndsAt(state.endsAt) : "—"}</p>
        <p className="text-sm w-text mb-4">{state.endsAt ? trialTimeRemainingLabel(state.endsAt) : ""}</p>
        {capacity && (
          <div className="space-y-2 mb-4 max-w-xs">
            <CapacityRow label="Watcher slots" used={capacity.activeDeploymentCount} total={capacity.slotsTotal} />
            <CapacityRow label="Communities" used={capacity.communitiesUsed} total={capacity.communitiesTotal} />
          </div>
        )}
        <a href="#paid-plans" className="text-xs w-teal hover:underline">Upgrade →</a>
      </div>
    );
  }

  // expired
  return (
    <div className="w-card p-5">
      <div className="flex items-center justify-between mb-2">
        <FreeTrialHeader />
        <span className="w-pill w-surface-raised w-text-faint text-[11px]">Expired</span>
      </div>
      <p className="text-sm w-text-dim mb-4">Your Projects, Communities, and Watchers are still here. Choose a plan to continue using Watch.</p>
      <a href="#paid-plans" className="w-btn-primary text-xs font-semibold px-4 py-2 rounded-lg inline-block">View paid plans</a>
    </div>
  );
}

function FreeTrialHeader() {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Rocket size={16} className="w-teal" />
      <h3 className="w-display text-base">Free Trial</h3>
    </div>
  );
}
