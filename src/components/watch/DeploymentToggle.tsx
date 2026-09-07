"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { setCustomerDeploymentEnabled } from "@/src/lib/actions/watch-moderator";

/** Pause/resume a single deployment — used on both the Community detail page
 *  (one row per deployed Watcher) and the Watcher detail page (one row per
 *  Community it's deployed to). Reuses the SAME action either way, since a
 *  deployment is deployment regardless of which detail page you're looking
 *  at it from. */
export function DeploymentToggle({ moderatorId, deploymentId, enabled }: { moderatorId: string; deploymentId: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = await setCustomerDeploymentEnabled(moderatorId, deploymentId, !on);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOn(!on);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={busy}
        className={`text-xs px-2.5 py-1 rounded-md border disabled:opacity-60 ${on ? "w-line-soft w-text-dim hover:w-text" : "w-teal-border w-teal"}`}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : on ? "Pause" : "Resume"}
      </button>
      {error && <p className="text-[10px] text-red-400 max-w-[160px] text-right">{error}</p>}
    </div>
  );
}
