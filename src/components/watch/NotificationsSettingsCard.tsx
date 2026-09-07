"use client";

import React, { useState } from "react";
import { Mail } from "lucide-react";
import { setWatchNotificationCategory, sendWatchTestNotification } from "@/src/lib/actions/watch-notifications";
import type { NotificationPreferences } from "@/src/lib/products/watch-notifications";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

type Category = "noActiveWatcher" | "capacityWarning" | "watcherStatus";

interface Row {
  category: Category;
  group: string;
  label: string;
  description: string;
}

/** Real Notifications preferences — three categories, one per real
 *  severity `listAccountAttentionItems` already computes (never an
 *  invented taxonomy). No "failed Auto-Post"/"billing notice" row exists —
 *  neither has a real trigger anywhere in this codebase yet. Each toggle
 *  saves instantly (matches the existing atomic per-category persistence —
 *  no section-level Save button, since there's nothing batched to submit). */
const ROWS: Row[] = [
  { category: "noActiveWatcher", group: "Communities", label: "No active Watcher", description: "Alert me when a Community has zero active Watcher deployments." },
  { category: "capacityWarning", group: "Capacity", label: "Nearing plan limit", description: "Alert me when Watcher slot or Community capacity reaches 90% or more." },
  { category: "watcherStatus", group: "Watchers", label: "Watcher needs attention", description: "Alert me when a Watcher is paused, or not deployed to any Community." },
];

const GROUPS = Array.from(new Set(ROWS.map((r) => r.group)));

export function NotificationsSettingsCard({ initial }: { initial: NotificationPreferences }) {
  const [prefs, setPrefs] = useState<Record<Category, boolean>>({
    noActiveWatcher: initial.noActiveWatcherEnabled,
    capacityWarning: initial.capacityWarningEnabled,
    watcherStatus: initial.watcherStatusEnabled,
  });
  const [saving, setSaving] = useState<Category | null>(null);
  const [testState, setTestState] = useState<"idle" | "sending" | { ok: true; sentTo: string } | { ok: false; error: string }>("idle");

  const toggle = async (category: Category) => {
    const next = !prefs[category];
    setPrefs((p) => ({ ...p, [category]: next })); // optimistic
    setSaving(category);
    const res = await setWatchNotificationCategory(category, next);
    setSaving(null);
    if (!res.ok) setPrefs((p) => ({ ...p, [category]: !next })); // roll back on failure
  };

  const sendTest = async () => {
    setTestState("sending");
    const res = await sendWatchTestNotification();
    setTestState(res);
  };

  return (
    <div className="max-w-md">
      <p className="text-xs w-text-faint mb-4">Delivered by email, at most once per day per category, only when there's something real to report.</p>

      <div className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group}>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">{group}</p>
            <div>
              {ROWS.filter((r) => r.group === group).map((row) => (
                <SettingsRow key={row.category} label={row.label} description={row.description}>
                  <SettingsSwitch checked={prefs[row.category]} onChange={() => toggle(row.category)} disabled={saving === row.category} label={row.label} />
                </SettingsRow>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t w-line-soft">
        <SettingsRow label="Delivery" description="The channel used for every notification above.">
          <span className="text-xs w-text-dim flex items-center gap-1.5"><Mail size={13} /> Email</span>
        </SettingsRow>
        <div className="flex items-center gap-3 mt-3">
          <button
            type="button"
            onClick={sendTest}
            disabled={testState === "sending"}
            className="text-xs w-text-dim hover:w-text px-3 py-1.5 rounded-lg border w-line-soft disabled:opacity-60"
          >
            {testState === "sending" ? "Sending…" : "Send test email"}
          </button>
          {typeof testState === "object" && testState.ok && <span className="text-xs w-green">Sent to {testState.sentTo}</span>}
          {typeof testState === "object" && !testState.ok && <span className="text-xs text-red-400">{testState.error}</span>}
        </div>
      </div>
    </div>
  );
}
