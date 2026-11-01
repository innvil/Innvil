"use client";

import { useEffect, useState } from "react";
import { getCommunityPendingReplyDelay, setCommunityPendingReplyDelay } from "@/src/lib/actions/watch-dashboard";

/** Owner control for the per-community human-priority reply delay (gap 1's
 *  "wait before responding" window) -- default 45s, configurable 15-120s.
 *  Never lets an admin/mod's own message bypass this; only how LONG a
 *  normal user's question waits for a human to answer first. */
export function PendingReplyDelayControl({ communityId }: { communityId: string }) {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommunityPendingReplyDelay(communityId).then((v) => {
      if (!cancelled) setSeconds(v ?? 45);
    });
    return () => {
      cancelled = true;
    };
  }, [communityId]);

  if (seconds === null) return null;

  const onSave = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await setCommunityPendingReplyDelay(communityId, seconds);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSeconds(res.data.delaySeconds);
    setSaved(true);
  };

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-white/80">Human-priority reply delay</p>
      <p className="text-[11px] text-white/50 mt-0.5">
        How long the Watcher waits before answering a normal question, giving a human admin/mod the first opportunity to respond. Cancelled the moment an admin/mod takes over that specific conversation. Allowed range: 15–120 seconds.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={15}
          max={120}
          step={1}
          value={seconds}
          onChange={(e) => {
            setSaved(false);
            setSeconds(Number(e.target.value));
          }}
          className="w-20 bg-black/30 text-xs text-white/80 rounded px-2 py-1.5 border border-white/10"
        />
        <span className="text-[11px] text-white/50">seconds</span>
        <button
          onClick={onSave}
          disabled={busy}
          className="text-xs px-2.5 py-1.5 rounded-md bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[11px] text-teal-300">Saved</span>}
      </div>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
