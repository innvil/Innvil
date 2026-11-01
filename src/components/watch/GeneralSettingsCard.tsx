"use client";

import React, { useState } from "react";
import { setWatchAccountPreferences } from "@/src/lib/actions/watch-account-preferences";
import { COMMON_TIMEZONES, timezoneLabel, currentTimeExample, type AccountPreferences } from "@/src/lib/products/watch-datetime";
import { SettingsRow } from "./SettingsRow";

/** Real General preferences — timezone + 12h/24h display format. Used
 *  wherever this account views an absolute timestamp (Profile's "Connected
 *  on" date for the linked Telegram identity — see ConnectTelegramCard.tsx).
 *  Timezone is a dropdown over a curated common list (COMMON_TIMEZONES) —
 *  if the account's currently-saved timezone isn't in that list, it's still
 *  included as its own option so the dropdown never silently discards a
 *  real, valid, already-saved value. Save is disabled until either value
 *  actually differs from what's persisted — this account has exactly two
 *  General fields, both saved together via one existing action, so a single
 *  section-level Save (rather than a per-row one) matches the real backend
 *  shape. */
export function GeneralSettingsCard({ initial }: { initial: AccountPreferences }) {
  const timezoneOptions = COMMON_TIMEZONES.includes(initial.timezone)
    ? COMMON_TIMEZONES
    : [initial.timezone, ...COMMON_TIMEZONES];
  const [timezone, setTimezone] = useState(initial.timezone);
  const [timeFormat, setTimeFormat] = useState<AccountPreferences["timeFormat"]>(initial.timeFormat);
  // The last-PERSISTED baseline -- separate from `initial` (a prop, never
  // mutated) so "dirty" correctly re-evaluates to false the instant a save
  // succeeds, without needing the parent Server Component to re-render.
  const [savedTimezone, setSavedTimezone] = useState(initial.timezone);
  const [savedTimeFormat, setSavedTimeFormat] = useState(initial.timeFormat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = timezone !== savedTimezone || timeFormat !== savedTimeFormat;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    const res = await setWatchAccountPreferences(timezone, timeFormat);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setSavedTimezone(timezone);
    setSavedTimeFormat(timeFormat);
    setSavedAt(new Date());
  };

  return (
    <div className="max-w-md">
      <div>
        <SettingsRow label="Timezone" description="Dates and times you view are displayed using this timezone.">
          <select
            id="general-timezone"
            aria-label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-52 w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 text-sm outline-none focus:w-teal-border"
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>{timezoneLabel(tz)}</option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow label="Time format" description={`Controls how times are displayed — e.g. ${currentTimeExample(timezone, timeFormat)}.`}>
          <select
            id="general-time-format"
            aria-label="Time format"
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as AccountPreferences["timeFormat"])}
            className="w-52 w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 text-sm outline-none focus:w-teal-border"
          >
            <option value="24h">24-hour ({currentTimeExample(timezone, "24h")})</option>
            <option value="12h">12-hour ({currentTimeExample(timezone, "12h")})</option>
          </select>
        </SettingsRow>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="w-btn-primary text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {!dirty && savedAt && (
          <span className="text-xs w-green">
            Saved at {savedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
