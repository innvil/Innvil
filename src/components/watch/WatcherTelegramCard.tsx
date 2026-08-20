"use client";

import React, { useEffect, useState } from "react";
import { Bot, Loader2, AlertTriangle } from "lucide-react";
import {
  getWatcherTelegramIntegration, disconnectAccountModeratorBot, replaceAccountModeratorBotToken,
  type AccountModeratorTelegramIntegration,
} from "@/src/lib/actions/watch-moderator";
import { SectionHeader } from "./WatchUI";

/**
 * Telegram bot integration management, scoped strictly to the ONE bot
 * attached to THIS Watcher Profile — never a general Telegram identity
 * surface. Disconnect never deletes the Watcher/Communities/deployment
 * records/Activity; it only removes Innvil's own live credential for this
 * bot (see disconnectAccountModeratorBot's own doc comment). The token
 * itself is never fetched back from the server after it's been stored —
 * this component only ever WRITES a token, and clears it from local state
 * immediately after submitting, whether the call succeeds or fails.
 */
export function WatcherTelegramCard({ moderatorId }: { moderatorId: string }) {
  const [state, setState] = useState<AccountModeratorTelegramIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    const result = await getWatcherTelegramIntegration(moderatorId);
    setState(result);
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moderatorId]);

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    const res = await disconnectAccountModeratorBot(moderatorId);
    setBusy(false);
    setConfirmingDisconnect(false);
    if (!res.ok) { setError(res.error); return; }
    setNotice("Telegram bot disconnected.");
    await refresh();
  };

  const submitToken = async () => {
    const value = token.trim();
    // Cleared from local state immediately, regardless of outcome — this
    // component never re-displays or re-uses a submitted token.
    setToken("");
    if (!value) { setError("Paste the bot token from BotFather."); return; }
    setBusy(true);
    setError(null);
    const res = await replaceAccountModeratorBotToken(moderatorId, value);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setShowTokenInput(false);
    setNotice(state?.connected ? "Bot token replaced." : "Telegram bot connected.");
    await refresh();
  };

  if (loading) {
    return (
      <div className="w-card p-5 max-w-lg">
        <SectionHeader icon={Bot} title="Telegram bot" />
        <Loader2 size={16} className="animate-spin w-text-faint" />
      </div>
    );
  }
  if (!state) return null;

  return (
    <div className="w-card p-5 max-w-lg">
      <SectionHeader icon={Bot} title="Telegram bot" />

      {state.connected ? (
        <div className="flex items-center justify-between text-sm mb-4">
          <span className="w-text-dim">{state.username ? `@${state.username}` : "Connected"}</span>
          <span className="w-green">Connected</span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-sm mb-4">
          <span className="w-text-dim">{state.username ? `Previously @${state.username}` : "Telegram bot"}</span>
          <span className="w-text-faint">Not connected</span>
        </div>
      )}

      {showTokenInput ? (
        <div className="space-y-2 mb-2">
          <p className="text-xs w-text-faint">Paste the bot token from BotFather. It's validated against Telegram before anything is saved.</p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:AA…"
            autoComplete="off"
            className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border"
          />
          <div className="flex gap-2">
            <button onClick={() => void submitToken()} disabled={busy || !token.trim()} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : state.connected ? "Save new token" : "Connect"}
            </button>
            <button onClick={() => { setShowTokenInput(false); setToken(""); setError(null); }} disabled={busy} className="text-sm w-text-faint px-3">Cancel</button>
          </div>
        </div>
      ) : confirmingDisconnect ? (
        <div className="w-surface-raised border w-amber-border rounded-lg p-3 mb-2">
          <p className="text-xs w-text flex items-start gap-1.5 mb-3">
            <AlertTriangle size={14} className="w-amber shrink-0 mt-0.5" />
            {state.deploymentCount > 0
              ? `This Watcher is deployed to ${state.deploymentCount} ${state.deploymentCount === 1 ? "Community" : "Communities"}. Disconnecting its Telegram bot will stop Telegram activity for ${state.deploymentCount === 1 ? "that deployment" : "those deployments"} until a bot is reconnected.`
              : "This will disconnect Innvil Watch from this Watcher's Telegram bot. The bot itself isn't deleted, and you can reconnect it (or a different one) anytime."}
          </p>
          <div className="flex gap-2">
            <button onClick={() => void disconnect()} disabled={busy} className="text-sm font-semibold px-4 py-2 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/20 disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : "Yes, disconnect"}
            </button>
            <button onClick={() => setConfirmingDisconnect(false)} disabled={busy} className="text-sm w-text-faint px-3">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          {state.connected ? (
            <>
              <button onClick={() => { setShowTokenInput(true); setError(null); setNotice(null); }} className="text-sm w-surface-raised border w-line-soft rounded-lg px-3 py-2 w-text">
                Replace bot token
              </button>
              <button onClick={() => { setConfirmingDisconnect(true); setError(null); setNotice(null); }} className="text-sm w-surface-raised border w-line-soft rounded-lg px-3 py-2 w-text-dim hover:w-text">
                Disconnect bot
              </button>
            </>
          ) : (
            <button onClick={() => { setShowTokenInput(true); setError(null); setNotice(null); }} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">
              Connect Telegram bot
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      {notice && !error && <p className="text-xs w-green mt-3">{notice}</p>}
    </div>
  );
}
