"use client";

import React, { useState } from "react";
import { Search, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  findAccountByEmail, getAccountDevOpsSubscription, setAccountDevOpsSubscription, clearAccountDevOpsSubscription,
  type AccountDevOpsSubscriptionState,
} from "@/src/lib/actions/superadmin-watch-devops";
import type { ModeratorPlanTier } from "@/src/lib/money";

const TIERS: Array<{ value: ModeratorPlanTier; label: string }> = [
  { value: "basic", label: "Bronze (Basic)" },
  { value: "standard", label: "Silver (Standard)" },
  { value: "premium", label: "Gold (Premium)" },
  { value: "pro", label: "Platinum (Pro)" },
];

/** Superadmin-only control for manually granting a Watch subscription tier
 *  to an account, for live QA — e.g. testing a Watcher against a real
 *  Standard/Premium/Pro entitlement without a real payment. The MUTATING
 *  actions (set/clear) are hard-gated server-side to Vercel's Preview
 *  environment only (superadmin-watch-devops.ts) — this UI has no client-
 *  side way to know which environment it's running in, so it always shows
 *  the controls and surfaces the server's own rejection plainly if used
 *  outside Preview, rather than trying to guess and hide them. */
export function WatchDevOpsAdmin() {
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ accountId: string; email: string } | null>(null);
  const [state, setState] = useState<AccountDevOpsSubscriptionState | null>(null);
  const [tier, setTier] = useState<ModeratorPlanTier>("standard");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    setActionError(null);
    setActionOk(null);
    const res = await findAccountByEmail(email);
    if (!res.ok) {
      setSearching(false);
      setSearchError(res.error);
      setAccount(null);
      setState(null);
      return;
    }
    setAccount(res.data);
    const sub = await getAccountDevOpsSubscription(res.data.accountId);
    setSearching(false);
    if (sub.ok) setState(sub.data);
  };

  const refreshState = async (accountId: string) => {
    const sub = await getAccountDevOpsSubscription(accountId);
    if (sub.ok) setState(sub.data);
  };

  const grant = async () => {
    if (!account) return;
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    const res = await setAccountDevOpsSubscription(account.accountId, tier);
    setBusy(false);
    if (!res.ok) { setActionError(res.error); return; }
    setActionOk(`Devops ${tier} subscription set.`);
    await refreshState(account.accountId);
  };

  const clear = async () => {
    if (!account) return;
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    const res = await clearAccountDevOpsSubscription(account.accountId);
    setBusy(false);
    if (!res.ok) { setActionError(res.error); return; }
    setActionOk("Devops subscription cleared.");
    await refreshState(account.accountId);
  };

  return (
    <Card title="Watch devops subscription" icon={ShieldCheck}>
      <p className="fp-text-dim text-sm mb-4">
        Manually grant a Watch subscription tier to an account for live QA — bypasses payment entirely. Reuses the
        exact same entitlement activation every real purchase uses, tagged distinctly so it's never confused with a
        real paid subscription. <span className="fp-gold">Granting/clearing only works in the Preview environment</span> —
        the server rejects it in Production even if attempted here.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
          placeholder="Account email"
          className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
        />
        <button
          onClick={() => void search()}
          disabled={searching || !email.trim()}
          className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
        >
          <Search size={14} /> {searching ? "Searching…" : "Find"}
        </button>
      </div>
      {searchError && (
        <p className="text-xs text-red-400 flex items-center gap-1.5 mb-4"><AlertTriangle size={12} /> {searchError}</p>
      )}

      {account && state && (
        <div className="fp-panel-raised border fp-line-soft rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-sm fp-text">{account.email}</p>
              <p className="text-[11px] fp-text-faint w-mono">{account.accountId}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide fp-text-faint font-semibold">Current entitlement</p>
              <p className="text-sm fp-text">
                {state.tier ? TIERS.find((t) => t.value === state.tier)?.label ?? state.tier : "None"}
                {state.isDevOps && <span className="fp-gold-soft-bg fp-gold text-[10px] px-1.5 py-0.5 rounded-full ml-2">devops</span>}
              </p>
              {state.status && <p className="text-[11px] fp-text-faint">{state.status}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as ModeratorPlanTier)}
              className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
            >
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button onClick={() => void grant()} disabled={busy} className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">
              {busy ? "Working…" : "Set devops subscription"}
            </button>
            {state.isDevOps && (
              <button onClick={() => void clear()} disabled={busy} className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
                <XCircle size={14} /> Clear devops subscription
              </button>
            )}
          </div>

          {actionError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {actionError}</p>}
          {actionOk && <p className="text-xs text-emerald-400">{actionOk}</p>}
        </div>
      )}
    </Card>
  );
}
