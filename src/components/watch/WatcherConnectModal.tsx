"use client";

import React, { useState } from "react";
import { X, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import {
  requestCustomerTelegramCreation, getCustomerModeratorProvisioning, cancelCustomerTelegramProvisioning,
  connectCustomerBotToken, connectAccountCommunity,
} from "@/src/lib/actions/watch-moderator";
import type { AccountWatcherRow } from "@/src/lib/products/watch-runtime";
import { DEPLOYABLE_PROVISIONING_STATUSES } from "@/src/lib/products/watch-status";
import type { AccountProjectRow } from "@/src/lib/products/ownership";

const RETRIABLE = new Set(["draft", "requires_retry", "cancelled", "username_unavailable", "telegram_creation_failed", "credential_setup_failed", "expired"]);
const DEPLOYABLE = DEPLOYABLE_PROVISIONING_STATUSES;

/** Self-serve Telegram connection flow for a single Watcher — mirrors the
 *  existing owner/storefront-customer UX shape (username → deep link →
 *  poll → connect community) via the new account-scoped actions in
 *  watch-moderator.ts. Never shows a live-looking control for anything not
 *  actually wired (the `/start` add-to-group deep link isn't supported for
 *  standalone accounts yet — see watch-moderator.ts's own doc comment). */
export function WatcherConnectModal({
  watcher, projects, onClose, onConnected,
}: {
  watcher: AccountWatcherRow;
  projects: AccountProjectRow[];
  onClose: () => void;
  onConnected: () => void;
}) {
  const [status, setStatus] = useState(watcher.provisioningStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState(watcher.name.toLowerCase().replace(/[^a-z0-9]/g, "") + "_bot");
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [useTokenFallback, setUseTokenFallback] = useState(false);
  const [token, setToken] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [chatInput, setChatInput] = useState("");
  const [connectedTitle, setConnectedTitle] = useState<string | null>(null);

  const requestBot = async () => {
    setBusy(true);
    setError(null);
    const res = await requestCustomerTelegramCreation(watcher.id, username);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setDeepLink(res.data.deepLink);
    setStatus("telegram_confirmation_pending");
  };

  const submitToken = async () => {
    setBusy(true);
    setError(null);
    const res = await connectCustomerBotToken(watcher.id, token);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setStatus("bot_ready");
  };

  const checkStatus = async () => {
    setBusy(true);
    setError(null);
    const info = await getCustomerModeratorProvisioning(watcher.id);
    setBusy(false);
    if (!info) { setError("Could not check status."); return; }
    if (info.lastError) setError(info.lastError);
    setStatus(info.provisioningStatus);
  };

  const cancelRequest = async () => {
    setBusy(true);
    await cancelCustomerTelegramProvisioning(watcher.id);
    setBusy(false);
    setStatus("draft");
    setDeepLink(null);
  };

  const connectCommunity = async () => {
    if (!projectId || !chatInput.trim()) return;
    setBusy(true);
    setError(null);
    const res = await connectAccountCommunity(watcher.id, projectId, chatInput.trim());
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setConnectedTitle(res.data.title ?? res.data.chatId);
    setStatus("active");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Connect ${watcher.name} to Telegram`}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-md w-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="w-display text-base">Connect {watcher.name}</h3>
          <button onClick={onClose} aria-label="Close" className="w-text-dim hover:w-text"><X size={16} /></button>
        </div>

        {connectedTitle ? (
          <div className="text-center py-4">
            <CheckCircle2 size={32} className="w-green mx-auto mb-3" />
            <p className="text-sm w-text mb-1">{watcher.name} is now connected and live in</p>
            <p className="text-sm w-teal font-medium mb-5">{connectedTitle}</p>
            <button onClick={() => { onConnected(); onClose(); }} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg">Done</button>
          </div>
        ) : DEPLOYABLE.has(status) ? (
          <div>
            <p className="text-sm w-text-dim mb-3">Your bot is connected to Telegram. Add it to a Telegram group/channel, then enter its chat ID or @handle here.</p>
            {/* ALWAYS shown, even with exactly one Project -- an account can
                hold multiple Projects, and silently defaulting to
                `projects[0]` (whichever a prior version of this modal hid
                the selector for) is exactly the ambiguous "which Project
                does this deployment belong to?" guess the CRM must never
                make. A single-Project account still sees, explicitly, which
                Project the new deployment is going into. */}
            <label className="text-xs w-text-dim block mb-1">Deploying into Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label className="text-xs w-text-dim block mb-1">Telegram chat ID or @handle</label>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="@yourcommunity or -1001234567890"
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={connectCommunity} disabled={busy || !chatInput.trim() || !projectId} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Connect community"}
            </button>
          </div>
        ) : status === "telegram_confirmation_pending" ? (
          <div>
            <p className="text-sm w-text-dim mb-3">Open this link and confirm bot creation in Telegram, then check status here.</p>
            {deepLink && (
              <a href={deepLink} target="_blank" rel="noreferrer" className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg flex items-center justify-center gap-1.5 mb-3">
                Open in Telegram <ExternalLink size={13} />
              </a>
            )}
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <div className="flex gap-2">
              <button onClick={checkStatus} disabled={busy} className="flex-1 text-sm w-surface-raised border w-line-soft rounded-lg py-2.5 w-text disabled:opacity-60">
                {busy ? "Checking…" : "Check status"}
              </button>
              <button onClick={cancelRequest} disabled={busy} className="text-sm w-text-faint px-3">Cancel</button>
            </div>
          </div>
        ) : RETRIABLE.has(status) && !useTokenFallback ? (
          <div>
            <p className="text-sm w-text-dim mb-3">Choose a Telegram username for this Watcher's bot.</p>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="my_watcher_bot"
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={requestBot} disabled={busy || !username.trim()} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60 mb-2">
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Create bot via Telegram"}
            </button>
            <button onClick={() => setUseTokenFallback(true)} className="text-xs w-text-faint hover:w-text-dim w-full text-center">
              Already have a bot? Paste its token instead
            </button>
          </div>
        ) : (
          <div>
            <p className="text-sm w-text-dim mb-3">Paste the bot token BotFather gave you.</p>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456:ABC-DEF..."
              className="w-full w-surface-raised border w-line-soft rounded-lg px-3 py-2 text-sm w-text outline-none focus:w-teal-border mb-3"
            />
            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
            <button onClick={submitToken} disabled={busy || !token.trim()} className="w-btn-primary text-sm font-semibold w-full py-2.5 rounded-lg disabled:opacity-60 mb-2">
              {busy ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Connect bot"}
            </button>
            <button onClick={() => setUseTokenFallback(false)} className="text-xs w-text-faint hover:w-text-dim w-full text-center">Back</button>
          </div>
        )}
      </div>
    </div>
  );
}
