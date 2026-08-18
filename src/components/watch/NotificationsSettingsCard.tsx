"use client";

import React, { useState } from "react";
import { setWatchNotificationPreferences } from "@/src/lib/actions/watch-notifications";

/** Real Notifications preference — a single toggle for the ONE signal Watch
 *  can honestly compute today: Needs Attention (a Community with no active
 *  Watcher, or capacity nearing the plan limit). No other toggle is shown
 *  here — "failed Auto-Posts"/"billing notices" have no real trigger
 *  anywhere in this codebase yet, and a toggle with nothing behind it would
 *  misrepresent what Watch actually does. */
export function NotificationsSettingsCard({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next); // optimistic — this is a simple boolean preference, not a destructive action
    setSaving(true);
    const res = await setWatchNotificationPreferences(next);
    setSaving(false);
    if (!res.ok) setEnabled(!next); // roll back on failure
  };

  return (
    <div className="max-w-lg">
      <div className="flex items-center justify-between gap-4 w-surface-raised border w-line-soft rounded-lg p-4">
        <div>
          <p className="w-text text-sm font-medium">Needs Attention alerts</p>
          <p className="text-xs w-text-faint mt-1">
            Email me when a Community has no active Watcher, or Watcher/Community capacity is nearing my plan
            limit. At most one email per day.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Needs Attention alerts"
          onClick={toggle}
          disabled={saving}
          className={`shrink-0 w-10 h-6 rounded-full relative transition-colors disabled:opacity-60 ${enabled ? "w-teal-bg" : "w-surface border w-line-soft"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <p className="text-xs w-text-faint mt-3">
        More notification types (Auto-Posting status, billing) will be added here once those features have
        something real to report.
      </p>
    </div>
  );
}
