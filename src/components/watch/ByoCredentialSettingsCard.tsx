"use client";

import React, { useEffect, useState } from "react";
import {
  getWatchByoCredentialState, setWatchByoCredential, clearWatchByoCredential, getWatchByoProviderHealth,
  type WatchByoCredentialState,
} from "@/src/lib/actions/watch-byo-settings";
import type { WatchByoProvider } from "@/src/lib/products/watch-byo";
import type { ByoProviderHealth } from "@/src/lib/products/watch-byo-usage";
import { SettingsRow } from "./SettingsRow";
import { relTime } from "./WatchUI";

/** Self-serve BYO Enterprise credential management (Phase 2, 2026-08-24) --
 *  lets an already-provisioned BYO account manage its OWN stored AI
 *  provider credential without emailing support to rotate a key. Reuses
 *  the exact same watch-byo.ts storage the devops grant tool writes to --
 *  no second credential-storage mechanism. Every action is server-side
 *  gated on the signed-in account's own real entitlement (see
 *  watch-byo-settings.ts) -- this component never decides who can use it,
 *  only whether to render (app/settings/page.tsx only mounts it for a
 *  BYO-flagged account in the first place). The decrypted key is never
 *  fetched back from the server after storage -- only its presence/
 *  provider/base URL/model. */
export function ByoCredentialSettingsCard({ initial }: { initial: WatchByoCredentialState }) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState(!initial.hasCredential);

  const [provider, setProvider] = useState<WatchByoProvider>(initial.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? "");
  const [model, setModel] = useState(initial.model ?? "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Provider health/observability (Phase 4.V.1) -- real last-success/last-
  // error/recent-volume, fetched once alongside the credential state. Never
  // fabricates a status; a fetch failure just leaves it null (rendered as
  // "No data yet" below), never a fake "healthy".
  const [health, setHealth] = useState<ByoProviderHealth | null>(null);
  useEffect(() => {
    if (!state.hasCredential) return;
    let cancelled = false;
    getWatchByoProviderHealth().then((res) => { if (!cancelled && res.ok) setHealth(res.data); });
    return () => { cancelled = true; };
  }, [state.hasCredential]);

  const refresh = async () => {
    const res = await getWatchByoCredentialState();
    if (res.ok) {
      setState(res.data);
      setProvider(res.data.provider ?? "anthropic");
      setBaseUrl(res.data.baseUrl ?? "");
      setModel(res.data.model ?? "");
    }
  };

  const save = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    const res = await setWatchByoCredential(provider, apiKey, baseUrl.trim() || undefined, model.trim() || undefined);
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setApiKey("");
    setMessage("Credential saved.");
    setEditing(false);
    await refresh();
  };

  const clear = async () => {
    setError(null);
    setMessage(null);
    setSaving(true);
    const res = await clearWatchByoCredential();
    setSaving(false);
    if (!res.ok) { setError(res.error); return; }
    setMessage("Credential cleared.");
    setEditing(true);
    setApiKey("");
    await refresh();
  };

  return (
    <div>
      <div>
        <SettingsRow
          label="Stored credential"
          description="The AI provider credential your Watchers use for every generation and moderation call on this account."
        >
          {state.hasCredential ? (
            <span className="text-xs w-green flex items-center gap-1.5">
              Configured — {state.provider}{state.model ? ` · ${state.model}` : ""}
            </span>
          ) : (
            <span className="text-xs w-amber">Not configured</span>
          )}
        </SettingsRow>
        {state.hasCredential && (
          <SettingsRow label="Provider health" description="Real observed activity for your stored credential — never a guess.">
            {health ? (
              <div className="text-xs w-text-dim text-right space-y-0.5">
                <p>
                  Last success: {health.lastSuccessAt ? <span className="w-green">{relTime(health.lastSuccessAt)}</span> : <span className="w-text-faint">none yet</span>}
                </p>
                <p>
                  Last error: {health.lastErrorAt ? <span className="w-amber" title={health.lastError ?? undefined}>{relTime(health.lastErrorAt)}</span> : <span className="w-text-faint">none</span>}
                </p>
                <p className="w-text-faint">{health.callsLast7Days.toLocaleString()} call{health.callsLast7Days === 1 ? "" : "s"} in the last 7 days</p>
              </div>
            ) : (
              <span className="text-xs w-text-faint">Loading…</span>
            )}
          </SettingsRow>
        )}
      </div>

      {!editing && state.hasCredential && (
        <div className="flex items-center gap-3 mt-3">
          <button type="button" onClick={() => setEditing(true)} className="text-xs w-teal hover:underline px-3 py-1.5 rounded-lg border w-line-soft">
            Replace credential
          </button>
          <button type="button" onClick={() => void clear()} disabled={saving} className="text-xs w-text-faint hover:w-text disabled:opacity-60">
            {saving ? "Working…" : "Clear credential"}
          </button>
        </div>
      )}

      {editing && (
        <div className="w-surface-raised border w-line-soft rounded-lg p-4 mt-3">
          <p className="text-xs w-text-faint mb-3">
            Stored encrypted. Never displayed again once saved — replacing it overwrites the previous credential entirely.
          </p>
          <div className="space-y-3">
            <div>
              <label htmlFor="byo-provider" className="text-xs w-text-dim block mb-1.5">Provider</label>
              <select
                id="byo-provider"
                value={provider}
                onChange={(e) => setProvider(e.target.value as WatchByoProvider)}
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI-compatible</option>
              </select>
            </div>
            <div>
              <label htmlFor="byo-api-key" className="text-xs w-text-dim block mb-1.5">API key</label>
              <input
                id="byo-api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={state.hasCredential ? "Enter a new key to replace the stored one" : "sk-…"}
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
              />
            </div>
            <div>
              <label htmlFor="byo-model" className="text-xs w-text-dim block mb-1.5">Model</label>
              <input
                id="byo-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="e.g. claude-sonnet-5"
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
              />
              <p className="text-[11px] w-text-faint mt-1">Required — Watchers won't generate replies without a configured model.</p>
            </div>
            <div>
              <label htmlFor="byo-base-url" className="text-xs w-text-dim block mb-1.5">Base URL (optional)</label>
              <input
                id="byo-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Leave blank to use the provider's default endpoint"
                className="w-full w-surface border w-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:w-teal-border"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !apiKey.trim()}
              className="w-btn-primary text-xs font-semibold px-3.5 py-2 rounded-lg disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save credential"}
            </button>
            {state.hasCredential && (
              <button type="button" onClick={() => setEditing(false)} className="text-xs w-text-faint hover:w-text">Cancel</button>
            )}
          </div>
        </div>
      )}

      {message && <p className="text-xs w-green mt-3">{message}</p>}
      {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
    </div>
  );
}
