"use client";

import { useEffect, useId, useRef, useState } from "react";
import { setCommunityRemoveExternalBotMessages } from "@/src/lib/actions/watch-dashboard";
import { SettingsRow, SettingsSwitch } from "./SettingsRow";

export function ExternalBotCleanupToggle({ communityId, initialEnabled }: { communityId: string; initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [pendingEnable, setPendingEnable] = useState(false);
  const instructionsId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (showInstructions) headingRef.current?.focus(); }, [showInstructions]);

  async function save(next: boolean) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await setCommunityRemoveExternalBotMessages(communityId, next);
      if (result.ok) { setEnabled(next); setPendingEnable(false); } else setError(result.error);
    } catch { setError("Could not save bot-message cleanup. Please retry."); }
    finally { setBusy(false); }
  }
  function toggle() {
    if (busy) return;
    if (enabled) { void save(false); return; }
    setError(null);
    setPendingEnable(true);
    setShowInstructions(true);
    // Showing setup instructions must not enable deletion before confirmation.
  }
  return <div className="mt-3">
    <SettingsRow label="Silently remove third-party bot messages" description="Deletes all new third-party bot posts, including ads and useful posts from bot admins. No warnings, strikes, mutes or kicks. Innvil Watchers and human/admin channel identities are excluded. Off by default.">
      <SettingsSwitch checked={enabled} onChange={toggle} label="Silently remove third-party bot messages" disabled={busy} />
    </SettingsRow>
    <button type="button" aria-expanded={showInstructions} aria-controls={instructionsId} disabled={busy || pendingEnable}
      onClick={() => setShowInstructions(!showInstructions)} className="text-xs w-teal underline mt-2 disabled:opacity-60">
      {showInstructions ? "Hide setup instructions" : "View setup instructions"}
    </button>
    {showInstructions && <section id={instructionsId} aria-labelledby={`${instructionsId}-title`} className="mt-3 rounded-lg border w-line-soft w-surface-raised p-4">
      <h3 id={`${instructionsId}-title`} ref={headingRef} tabIndex={-1} className="text-sm font-semibold w-text">
        {pendingEnable ? "Before enabling bot-message cleanup" : "Bot-message cleanup setup"}
      </h3>
      <ol className="list-decimal pl-5 mt-3 space-y-2 text-xs w-text-dim">
        <li>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="w-teal underline">@BotFather</a>, select your Watcher bot, and enable <strong>Bot-to-Bot Communication Mode</strong> in its settings. Configure the Watcher that receives messages, not the third-party bot you want to clean up. If you cannot access these settings, ask the bot owner or contact Innvil support.</li>
        <li>In your Telegram group, make the Watcher an administrator and allow <strong>Delete messages</strong>. Repeat this setup for each active Watcher in the community. Admin status provides group-message visibility; disabling privacy mode alone does not grant deletion rights.</li>
        <li>Return here and choose <strong>Enable silent cleanup</strong>. Then check Activity after the next naturally occurring third-party bot post. A saved toggle is not proof that Telegram permissions or bot-to-bot delivery are working.</li>
      </ol>
      <p className="text-xs w-text-dim mt-3"><strong>All third-party bot posts are included</strong>, even useful updates and posts from bot admins. Cleanup sends no warnings and applies no strikes, mutes or kicks. Innvil Watchers and human/admin channel identities remain protected.</p>
      <p className="text-xs w-text-dim mt-2">Only new messages delivered by Telegram can be removed; existing history is not swept. Turning this toggle off stops future cleanup but cannot restore deleted posts or change BotFather settings. No bot token is needed here.</p>
      <a href="https://core.telegram.org/bots/features#bot-to-bot-communication" target="_blank" rel="noopener noreferrer" className="inline-block text-xs w-teal underline mt-2">Telegram setup documentation</a>
      {pendingEnable && <div className="flex flex-wrap gap-3 mt-4">
        <button type="button" disabled={busy} onClick={() => void save(true)} className="w-btn-primary rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60">{busy ? "Saving…" : "Enable silent cleanup"}</button>
        <button type="button" disabled={busy} onClick={() => { setPendingEnable(false); setShowInstructions(false); setError(null); }} className="text-xs w-text-dim disabled:opacity-60">Cancel</button>
      </div>}
      {enabled && <p role="status" className="text-xs w-teal mt-3">Cleanup is enabled. Telegram setup must also be complete.</p>}
    </section>}
    {error && <p role="alert" className="text-xs text-red-400 mt-1">{error}</p>}
  </div>;
}
