"use client";

import { useState } from "react";
import { setCommunityAcknowledgeAdminMod } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

/** The Community-level "Acknowledge admins/mods" override (see
 *  chatter-coordinator.ts's suppressAcknowledgementForSender +
 *  communities.acknowledge_admin_mod). Defaults OFF (communities
 *  .acknowledge_admin_mod defaults false at the DB level) -- when OFF, a
 *  real Telegram admin/creator's trivial message ("thanks", "got it",
 *  "lol") gets no lightweight acknowledgement (no reaction, no short
 *  reply) the way an ordinary member's does. When ON, admins/mods are
 *  acknowledged the same way. A substantive question or statement from an
 *  admin/mod always still gets a real reply either way -- this only ever
 *  gates the casual "got it 👍"-style acknowledgement. Independent of
 *  bot-to-bot acknowledgement (a fellow Watcher is never acknowledged
 *  unless that separate setting is turned on). Reuses the shared
 *  SettingsRow/SettingsSwitch instead of a bespoke control. */
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
        label="Acknowledge admins/mods"
        description={
          on
            ? "Admins/mods get the same casual reaction/acknowledgement an ordinary member does for trivial messages (\"thanks\", \"got it\")."
            : "Only ordinary members get a casual reaction/acknowledgement for trivial messages — a real Telegram admin/creator's trivial remarks get no reaction. Real questions or statements from an admin/mod are always answered either way."
        }
      >
        <SettingsSwitch checked={on} onChange={toggle} label="Acknowledge admins/mods" disabled={busy} />
      </SettingsRow>
      {error && <p className="text-[11px] text-red-400 mt-1">{error}</p>}
    </div>
  );
}
