"use client";

import React, { useState } from "react";
import { setWatchAccountPreferences } from "@/src/lib/actions/watch-account-preferences";
import { COMMON_TIMEZONES, timezoneLabel, currentTimeExample, type AccountPreferences } from "@/src/lib/products/watch-datetime";

/** Real General preferences — timezone + 12h/24h display format. Used
 *  wherever this account views an absolute timestamp (starts with
 *  Profile's "Connected on" date for the linked Telegram identity — see
 *  ConnectTelegramCard.tsx). Timezone is a dropdown over a curated common
 *  list (COMMON_TIMEZONES) — if the account's currently-saved timezone
 *  isn't in that list (e.g. set directly some other way), it's still
 *  included as its own option so the dropdown never silently discards a
 *  real, valid, already-saved value. */
export function GeneralSettingsCard({ initial }: { initial: AccountPreferences }) {
  const timezoneOptions = COMMON_TIMEZONES.includes(initial.timezone)
    ? COMMON_TIMEZONES
    : [initial.timezone, ...COMMON_TIMEZONES];
  const [timezone, setTimezone] = useState(initial.timezone);
  const [timeFormat, setTimeFormat] = useState<AccountPreferences["timeFormat"]>(initial.timeFormat);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await setWatchAccountPreferences(timezone, timeFormat);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-lg space-y-4">
      <div>
        <label htmlFor="general-timezone" className="text-xs w-text-dim block mb-1.5">Timezone</label>
        <select
          id="general-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
        >
          {timezoneOptions.map((tz) => (
            <option key={tz} value={tz}>{timezoneLabel(tz)}</option>
          ))}
        </select>
        <p className="text-xs w-text-faint mt-1">An IANA timezone name. Used to format dates/times you view — separate from any Community's own posting-schedule timezone.</p>
      </div>

      <div>
        <label htmlFor="general-time-format" className="text-xs w-text-dim block mb-1.5">Time format</label>
        <select
          id="general-time-format"
          value={timeFormat}
          onChange={(e) => setTimeFormat(e.target.value as AccountPreferences["timeFormat"])}
          className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
        >
          <option value="24h">24-hour ({currentTimeExample(timezone, "24h")})</option>
          <option value="12h">12-hour ({currentTimeExample(timezone, "12h")})</option>
        </select>
        <p className="text-xs w-text-faint mt-1">Example shown for the timezone selected above.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="w-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && <span className="text-xs w-green">Saved</span>}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
