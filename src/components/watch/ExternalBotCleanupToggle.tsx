"use client";

import { useState } from "react";
import { setCommunityRemoveExternalBotMessages } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

export function ExternalBotCleanupToggle({ communityId, initialEnabled }: { communityId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true); setError(null);
    try {
      const result = await setCommunityRemoveExternalBotMessages(communityId, !enabled);
      if (result.ok) setEnabled(!enabled); else setError(result.error);
    } catch { setError("Could not save bot-message cleanup. Please retry."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3">
    <SettingsRow label="Silently remove third-party bot messages" description="Deletes all new third-party bot posts, including ads and useful posts from bot admins. No warnings, strikes, mutes or kicks. Innvil Watchers and human/admin channel identities are excluded. Off by default.">
      <SettingsSwitch checked={enabled} onChange={toggle} label="Silently remove third-party bot messages" disabled={busy} />
    </SettingsRow>
    <p className="text-xs w-text-dim mt-2">Requires Bot-to-Bot Communication Mode in BotFather and a Watcher with Telegram delete-message permission. Only messages Telegram delivers can be removed; existing history is not swept.</p>
    {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
  </div>;
}
