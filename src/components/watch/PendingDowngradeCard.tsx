"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { cancelPendingWatchDowngradeAction } from "@/src/lib/actions/innvil-credit";

/** Shown on Billing whenever the account has a downgrade scheduled
 *  (product_entitlements.pending_tier, migration 0111) -- the current
 *  (higher) tier keeps running unchanged until `effectiveDate`, at which
 *  point the pending tier takes over automatically at its own price.
 *  "Cancel" simply un-schedules it -- the account keeps renewing at its
 *  current tier going forward, same as if the downgrade were never
 *  requested; nothing is charged either way by this control. */
export function PendingDowngradeCard({ pendingPlanLabel, effectiveDate }: { pendingPlanLabel: string; effectiveDate: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  if (cancelled) return null;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    const res = await cancelPendingWatchDowngradeAction();
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setCancelled(true);
    router.refresh();
  };

  return (
    <div className="w-surface-raised border w-amber-border rounded-lg p-3 text-xs space-y-1.5">
      <p className="w-text flex items-center gap-1.5 font-medium"><Clock size={13} className="w-amber" /> Downgrade scheduled</p>
      <p className="w-text-dim">
        Your plan will switch to <span className="w-text font-medium">{pendingPlanLabel}</span>
        {effectiveDate ? <> at your next renewal on <span className="w-text font-medium">{new Date(effectiveDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span></> : " at your next renewal"}.
        Your current plan and capacity stay active until then — nothing changes today.
      </p>
      <button onClick={cancel} disabled={busy} className="w-teal hover:underline text-[11px] font-medium disabled:opacity-60">
        {busy ? "Cancelling…" : "Cancel scheduled downgrade"}
      </button>
      {error && <p className="w-red text-[11px]">{error}</p>}
    </div>
  );
}
