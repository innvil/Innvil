"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, Send, X, Loader2 } from "lucide-react";
import {
  getWatchTelegramState, startWatchTelegramVerification, cancelWatchTelegramVerification,
} from "@/src/lib/actions/watch-telegram-identity";
import { CopyIdButton } from "./CopyIdButton";
import { formatAccountDateTime, type AccountPreferences } from "@/src/lib/products/watch-datetime";

type State = Awaited<ReturnType<typeof getWatchTelegramState>>;

const POLL_INTERVAL_MS = 3000;

/** Profile's native (Panel-independent) Telegram identity connection card —
 *  drives the whole not-connected -> pending -> verified lifecycle from the
 *  authenticated Innvil account only. The numeric Telegram user id is never
 *  self-asserted by the browser; it only ever appears here after the
 *  server confirms a real Telegram `/start` verification (see
 *  bot-manager-runtime.ts's handleAccountVerificationStart). The "Connected
 *  on" date is the first real usage of Settings' new General timezone/
 *  time-format preference (migration 0076) — formatted per the account's
 *  own preference, never a hardcoded locale/timezone.
 *
 *  An already-connected account can also CHANGE which Telegram account is
 *  linked, via the exact same connect flow (startWatchTelegramVerification/
 *  the bot's `/start <token>` webhook already allow re-running this
 *  regardless of current connection state -- linkTelegramIdentity replaces
 *  the account's own prior link once the new one verifies). `changing`
 *  tracks ONLY which copy to show while a verification is pending -- it has
 *  no effect on eligibility/trial logic, which lives entirely server-side.
 *  Cancelling a change never touches the existing link, so cancel()
 *  re-reads the real current state instead of assuming "not connected". */
export function ConnectTelegramCard({ initial, preferences }: { initial: State; preferences: AccountPreferences }) {
  const [state, setState] = useState<State>(initial);
  const [connecting, setConnecting] = useState(false);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => stopPolling, []);

  const startPolling = () => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const next = await getWatchTelegramState();
      setState(next);
      if (next.status !== "pending") { stopPolling(); setDeepLink(null); setChanging(false); }
    }, POLL_INTERVAL_MS);
  };

  const connect = async (isChange: boolean) => {
    setConnecting(true);
    setError(null);
    setChanging(isChange);
    // Open a blank tab SYNCHRONOUSLY, inside the click handler -- popup
    // blockers generally only allow window.open() as a direct result of a
    // user gesture, not after an awaited server call. Opening blank now and
    // navigating it once the real deep link comes back keeps this to a
    // single click instead of "Connect" then a separate "Open Telegram".
    const popup = window.open("", "_blank");
    const res = await startWatchTelegramVerification();
    setConnecting(false);
    if (!res.ok) { setError(res.error); popup?.close(); return; }
    setDeepLink(res.deepLink);
    setState({ status: "pending", expiresAt: res.expiresAt });
    startPolling();
    if (popup && !popup.closed) popup.location.href = res.deepLink;
    else window.open(res.deepLink, "_blank", "noopener,noreferrer"); // fallback if the popup was blocked anyway
  };

  const cancel = async () => {
    stopPolling();
    setDeepLink(null);
    await cancelWatchTelegramVerification();
    // Cancelling a verification attempt never touches watch_telegram_links --
    // re-derive the real current state rather than assuming "not connected",
    // which would be wrong for a cancelled CHANGE on an already-connected
    // account (the original identity is still linked, untouched).
    setState(await getWatchTelegramState());
    setChanging(false);
  };

  if (state.status === "connected") {
    const { identity } = state;
    return (
      <div className="w-surface-raised border w-line-soft rounded-lg p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Telegram</p>
            <p className="w-text text-sm">{identity.telegramUsername ? `@${identity.telegramUsername}` : "Telegram account"}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs w-green">
            <CheckCircle2 size={13} /> Verified
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t w-line-soft">
          <div>
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-0.5">Telegram ID</p>
            <p className="w-mono text-xs w-text-dim break-all">{identity.telegramUserId}</p>
          </div>
          <CopyIdButton value={String(identity.telegramUserId)} label="Telegram ID" />
        </div>
        <p className="text-xs w-text-faint mt-3">Connected to your Innvil account on {formatAccountDateTime(identity.verifiedAt, preferences)}.</p>
        <div className="mt-3 pt-3 border-t w-line-soft">
          <button
            type="button"
            onClick={() => connect(true)}
            disabled={connecting}
            className="text-xs w-text-dim hover:w-text flex items-center gap-1.5 disabled:opacity-60"
          >
            <Send size={12} /> {connecting ? "Starting…" : "Change Telegram account"}
          </button>
          <p className="text-xs w-text-faint mt-1.5">
            Free trial eligibility follows your Innvil account, not which Telegram account is connected — changing it never
            starts a new trial, and this Telegram account can't be used to start one elsewhere later.
          </p>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      </div>
    );
  }

  if (state.status === "pending") {
    return (
      <div className="w-surface-raised border w-teal-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={14} className="w-teal animate-spin" />
          <p className="w-text text-sm font-medium">{changing ? "Waiting for your new Telegram account to verify" : "Waiting for Telegram verification"}</p>
        </div>
        <p className="text-xs w-text-faint mb-3">
          {changing
            ? "Open Telegram and tap Start with the account you'd like to connect instead — your current connection stays active until this one verifies."
            : "Open Telegram and tap Start in the chat that opened — this page updates automatically once you're verified."}
        </p>
        <div className="flex items-center gap-2">
          {deepLink && (
            <a
              href={deepLink}
              target="_blank"
              rel="noreferrer"
              className="w-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
            >
              <Send size={13} /> Open Telegram
            </a>
          )}
          <button
            type="button"
            onClick={cancel}
            className="text-xs w-text-faint hover:w-text flex items-center gap-1 px-3 py-2 rounded-lg border w-line-soft"
          >
            <X size={13} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-surface-raised border w-line-soft rounded-lg p-4">
      <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-1">Telegram</p>
      <p className="w-text text-sm mb-1">Not connected</p>
      <p className="text-xs w-text-faint mb-3">
        Connect your Telegram account to verify your identity and use Telegram-based Watch features.
      </p>
      <button
        type="button"
        onClick={() => connect(false)}
        disabled={connecting}
        className="w-btn-primary text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 disabled:opacity-60"
      >
        <Send size={13} /> {connecting ? "Starting…" : "Connect Telegram"}
      </button>
      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  );
}
