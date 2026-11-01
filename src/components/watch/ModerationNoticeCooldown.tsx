"use client";
import { useState } from "react";
import { setCommunityModerationNoticeCooldown } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow } from "./SettingsRow";

export function ModerationNoticeCooldown({ communityId, initialMinutes }: { communityId: string; initialMinutes: 30 | 60 }) {
  const [minutes, setMinutes] = useState(initialMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function change(next: 30 | 60) {
    setBusy(true); setError(null);
    try {
      const result = await setCommunityModerationNoticeCooldown(communityId, next);
      if (result.ok) setMinutes(next); else setError(result.error);
    } catch { setError("Could not save warning cooldown. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <SettingsRow label="Quiet moderation window" description="Similar spam in the same topic is deleted quietly after a reminder. Repeat-offender mutes continue; final warnings are preserved. All watchers share a limit of three ordinary public warnings per ten minutes.">
      <select aria-label="Quiet moderation window" disabled={busy} value={minutes} onChange={e => void change(Number(e.target.value) as 30 | 60)} className="fp-panel-raised border fp-line-soft rounded-lg p-2 text-sm disabled:opacity-50">
        <option value={30}>30 minutes</option><option value={60}>60 minutes</option>
      </select>
    </SettingsRow>
    {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
  </div>;
}
