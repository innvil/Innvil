"use client";

import React, { useState } from "react";
import { Search, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  findAccountByEmail, getAccountDevOpsSubscription, setAccountDevOpsSubscription, setAccountDevOpsEnterprise,
  clearAccountDevOpsSubscription, setAccountDevOpsByoCredential, clearAccountDevOpsByoCredential,
  type AccountDevOpsSubscriptionState, type DevOpsGrantableTier,
} from "@/src/lib/actions/superadmin-watch-devops";
import { MANAGED_ENTERPRISE_50 } from "@/src/lib/products/watch-enterprise";
import { getEnterpriseIncludedCommunities, getEnterpriseCommunityExpansionOptions } from "@/src/lib/products/watch-enterprise-community";
import type { ModeratorPlanTier } from "@/src/lib/money";
import type { WatchByoProvider } from "@/src/lib/products/watch-byo";

const TIERS: Array<{ value: DevOpsGrantableTier; label: string }> = [
  { value: "basic", label: "Bronze (Basic)" },
  { value: "standard", label: "Silver (Standard)" },
  { value: "premium", label: "Gold (Premium)" },
  { value: "pro", label: "Platinum (Pro)" },
  { value: "enterprise", label: "Enterprise (Managed)" },
];

const ENTERPRISE_COMMUNITY_BASE = getEnterpriseIncludedCommunities("managed");

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
  const [tier, setTier] = useState<DevOpsGrantableTier>("standard");
  const [enterpriseSlots, setEnterpriseSlots] = useState(String(MANAGED_ENTERPRISE_50.slots));
  const [enterpriseCapacity, setEnterpriseCapacity] = useState(String(ENTERPRISE_COMMUNITY_BASE));
  const [apiSourceMode, setApiSourceMode] = useState<"managed" | "byo">("managed");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  // BYO credential form -- deliberately separate from the grant/clear busy
  // state above (storing a credential is an independent action from
  // granting the entitlement itself, per the plan's "provider configuration
  // vs BYO usage policy are two distinct concepts" framing).
  const [byoProvider, setByoProvider] = useState<WatchByoProvider>("anthropic");
  const [byoApiKey, setByoApiKey] = useState("");
  const [byoBaseUrl, setByoBaseUrl] = useState("");
  const [byoModel, setByoModel] = useState("");
  const [byoBusy, setByoBusy] = useState(false);
  const [byoError, setByoError] = useState<string | null>(null);
  const [byoOk, setByoOk] = useState<string | null>(null);

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
    if (sub.ok) {
      setState(sub.data);
      // Pre-fill the grant form from the account's REAL current state, so
      // editing an already-Enterprise account starts from its actual
      // provisioned values instead of the hardcoded defaults -- an admin
      // adjusting an existing 75-slot/15-Community account should never
      // have to first discover, then hand-retype, numbers already shown
      // right above in "Current entitlement".
      if (sub.data.tier) setTier(sub.data.tier);
      if (sub.data.tier === "enterprise") {
        setEnterpriseSlots(String(sub.data.enterpriseSlots ?? MANAGED_ENTERPRISE_50.slots));
        setEnterpriseCapacity(String(sub.data.enterpriseCommunityCapacity ?? ENTERPRISE_COMMUNITY_BASE));
        setApiSourceMode(sub.data.apiSourceMode);
      }
      setByoApiKey("");
      setByoError(null);
      setByoOk(null);
    }
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
    const res =
      tier === "enterprise"
        ? await setAccountDevOpsEnterprise(
            account.accountId,
            Number(enterpriseSlots),
            enterpriseCapacity.trim() ? Number(enterpriseCapacity) : undefined,
            apiSourceMode
          )
        : await setAccountDevOpsSubscription(account.accountId, tier as ModeratorPlanTier);
    setBusy(false);
    if (!res.ok) { setActionError(res.error); return; }
    setActionOk(
      tier === "enterprise"
        ? `Devops Enterprise entitlement set (${enterpriseSlots} slots, ${apiSourceMode === "byo" ? "BYO" : "Managed"}).`
        : `Devops ${tier} subscription set.`
    );
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

  const saveByoCredential = async () => {
    if (!account) return;
    setByoBusy(true);
    setByoError(null);
    setByoOk(null);
    const res = await setAccountDevOpsByoCredential(
      account.accountId, byoProvider, byoApiKey, byoBaseUrl.trim() || undefined, byoModel.trim() || undefined
    );
    setByoBusy(false);
    if (!res.ok) { setByoError(res.error); return; }
    setByoApiKey("");
    setByoOk("BYO credential stored.");
    await refreshState(account.accountId);
  };

  const clearByoCredential = async () => {
    if (!account) return;
    setByoBusy(true);
    setByoError(null);
    setByoOk(null);
    const res = await clearAccountDevOpsByoCredential(account.accountId);
    setByoBusy(false);
    if (!res.ok) { setByoError(res.error); return; }
    setByoOk("BYO credential cleared.");
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
              {state.tier === "enterprise" && (
                <p className="text-[11px] fp-text-faint">
                  {state.enterpriseSlots ?? "?"} slots · {state.enterpriseCommunityCapacity ?? ENTERPRISE_COMMUNITY_BASE} Communities ·{" "}
                  {state.apiSourceMode === "byo" ? "BYO" : "Managed"}
                  {state.apiSourceMode === "byo" && (
                    <span className={state.hasByoCredential ? "text-emerald-400" : "text-amber-400"}>
                      {" "}({state.hasByoCredential ? "credential stored" : "no credential stored"})
                    </span>
                  )}
                </p>
              )}
              {state.status && <p className="text-[11px] fp-text-faint">{state.status}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as DevOpsGrantableTier)}
              className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
            >
              {TIERS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {tier === "enterprise" && (
              <>
                <input
                  type="number"
                  min={1}
                  value={enterpriseSlots}
                  onChange={(e) => setEnterpriseSlots(e.target.value)}
                  placeholder="Watcher slots"
                  className="w-28 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                />
                <select
                  value={enterpriseCapacity}
                  onChange={(e) => setEnterpriseCapacity(e.target.value)}
                  className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                >
                  <option value={ENTERPRISE_COMMUNITY_BASE}>{ENTERPRISE_COMMUNITY_BASE} Communities (base)</option>
                  {getEnterpriseCommunityExpansionOptions("managed").map((o) => (
                    <option key={o.capacity} value={o.capacity}>{o.capacity} Communities (+${o.price.toFixed(2)}/mo)</option>
                  ))}
                </select>
                <div className="flex items-center gap-3 text-sm fp-text">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="apiSourceMode" checked={apiSourceMode === "managed"} onChange={() => setApiSourceMode("managed")} />
                    Managed
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="apiSourceMode" checked={apiSourceMode === "byo"} onChange={() => setApiSourceMode("byo")} />
                    BYO
                  </label>
                </div>
              </>
            )}
            <button onClick={() => void grant()} disabled={busy} className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">
              {busy ? "Working…" : tier === "enterprise" ? "Set devops Enterprise entitlement" : "Set devops subscription"}
            </button>
            {state.isDevOps && (
              <button onClick={() => void clear()} disabled={busy} className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
                <XCircle size={14} /> Clear devops subscription
              </button>
            )}
          </div>

          {actionError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {actionError}</p>}
          {actionOk && <p className="text-xs text-emerald-400">{actionOk}</p>}

          {tier === "enterprise" && apiSourceMode === "byo" && (
            <div className="border-t fp-line-soft pt-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wide fp-text-faint font-semibold">BYO provider credential</p>
              <p className="fp-text-dim text-xs">
                Stored encrypted, provisioned manually alongside the entitlement above — never displayed once saved.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={byoProvider}
                  onChange={(e) => setByoProvider(e.target.value as WatchByoProvider)}
                  className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI-compatible</option>
                </select>
                <input
                  value={byoApiKey}
                  onChange={(e) => setByoApiKey(e.target.value)}
                  placeholder="API key"
                  type="password"
                  className="w-56 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                />
                <input
                  value={byoBaseUrl}
                  onChange={(e) => setByoBaseUrl(e.target.value)}
                  placeholder="Base URL (optional)"
                  className="w-48 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                />
                <input
                  value={byoModel}
                  onChange={(e) => setByoModel(e.target.value)}
                  placeholder="Model override (optional)"
                  className="w-48 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                />
                <button
                  onClick={() => void saveByoCredential()}
                  disabled={byoBusy || !byoApiKey.trim()}
                  className="fp-btn-primary rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  {byoBusy ? "Working…" : "Save credential"}
                </button>
                {state.hasByoCredential && (
                  <button
                    onClick={() => void clearByoCredential()}
                    disabled={byoBusy}
                    className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <XCircle size={14} /> Clear credential
                  </button>
                )}
              </div>
              {byoError && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {byoError}</p>}
              {byoOk && <p className="text-xs text-emerald-400">{byoOk}</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
