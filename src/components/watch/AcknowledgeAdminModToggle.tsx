"use client";

import { useState } from "react";
import { setCommunityAcknowledgeAdminMod } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

/** Controls text engagement toward admins, independently of emoji reactions,
 * official knowledge ingestion and moderation. */
export function AcknowledgeAdminModToggle({ communityId, acknowledgeAdminMod }: { communityId: string; acknowledgeAdminMod: boolean }) {
  const [on, setOn] = useState(acknowledgeAdminMod);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = await setCommunityAcknowledgeAdminMod(communityId, !on);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOn(!on);
  };

  return (
    <div className="mt-3">
      <SettingsRow
        label="Reply to admins/mods"
        description={
          on
            ? "Watchers may reply to admins/mods when the conversation calls for it."
            : "No text replies to admins/mods, including questions and direct mentions. Relevant announcements and congratulations may still receive emoji reactions. Official knowledge capture and safety moderation are separate."
        }
      >
        <SettingsSwitch checked={on} onChange={toggle} label="Reply to admins/mods" disabled={busy} />
      </SettingsRow>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
