"use client";

import { useState } from "react";
import { setCommunityAllowSolicitation } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

/** The Community-level "Allow Solicitation / Allow Promotion" override
 *  (see link-moderation.ts's decideLinkEnforcement + communities
 *  .allow_solicitation). Defaults OFF (communities.allow_solicitation
 *  defaults false at the DB level) -- when OFF, ordinary unsolicited
 *  promotion is deleted and escalated like any other spam. When ON,
 *  ordinary unsolicited promotion is never deleted or warned for merely
 *  being promotional -- every other moderation check (spam-flood, scam/
 *  phishing, explicit content) stays fully independent and unaffected,
 *  regardless of this setting. Reuses the shared SettingsRow/SettingsSwitch
 *  (Settings page's own accessible toggle) instead of a bespoke control. */
export function CommunitySolicitationToggle({ communityId, allowSolicitation }: { communityId: string; allowSolicitation: boolean }) {
  const [on, setOn] = useState(allowSolicitation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = await setCommunityAllowSolicitation(communityId, !on);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOn(!on);
  };

  return (
    <div>
      <SettingsRow
        label="Allow solicitation / promotion"
        description={
          on
            ? "Ordinary promotional links and posts are allowed here — turn this off if you'd rather this Watcher enforce against them like spam. Scam links, phishing, and explicit content are always moderated, regardless of this setting."
            : "Unsolicited promotion is deleted and escalated per your moderation policy, same as spam."
        }
      >
        <SettingsSwitch checked={on} onChange={toggle} label="Allow solicitation / promotion" disabled={busy} />
      </SettingsRow>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
