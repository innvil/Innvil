"use client";

import { useState } from "react";
import { setCommunityWelcomeNewMembers } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

export function MemberWelcomeToggle({ communityId, initialEnabled }: { communityId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await setCommunityWelcomeNewMembers(communityId, !enabled);
      if (result.ok) setEnabled(!enabled);
      else setError(result.error);
    } catch {
      setError("Could not save the welcome setting. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-3">
    <SettingsRow
      label="Welcome new members"
      description={enabled
        ? "Your Watcher gives future human joins one persona-led welcome using only your project profile, verified official links, and active community rules."
        : "Off by default. When enabled, your Watcher gives future human joins one persona-led welcome using only verified project knowledge and active rules."}
    >
      <SettingsSwitch checked={enabled} onChange={toggle} label="Welcome new members" disabled={busy} />
    </SettingsRow>
    <p className="text-[11px] w-text-faint mt-1.5">Only future human joins Telegram delivers are eligible. Existing members are never messaged, bots are skipped, and multiple Watchers cannot duplicate the same welcome.</p>
    {error && <p role="alert" className="text-[11px] text-red-400 mt-1">{error}</p>}
  </div>;
}
