"use client";

import React, { useState } from "react";
import { Search, ShieldCheck, AlertTriangle, XCircle } from "lucide-react";
import { Card } from "@/src/components/ui";
import {
  findAccountByEmail, getAccountDevOpsSubscription, setAccountDevOpsSubscription, setAccountDevOpsEnterprise,
  clearAccountDevOpsSubscription, clearAccountDevOpsByoCredential,
  type AccountDevOpsSubscriptionState, type DevOpsGrantableTier,
} from "@/src/lib/actions/superadmin-watch-devops";
import {
  MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS, managedEnterprisePrice, enterpriseMediaAddon, resolveEnterpriseMediaAddonKey,
} from "@/src/lib/products/watch-enterprise";
import {
  getEnterpriseIncludedCommunities, getEnterpriseCommunityExpansionOptions, getEnterpriseCommunityExpansionPrice,
  validateEnterpriseCommunityCapacity, communityModeFor, type EnterpriseCommunityMode,
} from "@/src/lib/products/watch-enterprise-community";
import type { WatchBillingInterval } from "@/src/lib/products/watch-billing-period";
import type { ModeratorPlanTier } from "@/src/lib/money";

const TIERS: Array<{ value: DevOpsGrantableTier; label: string }> = [
  { value: "basic", label: "Bronze (Basic)" },
  { value: "standard", label: "Silver (Standard)" },
  { value: "premium", label: "Gold (Premium)" },
  { value: "pro", label: "Platinum (Pro)" },
  { value: "enterprise", label: "Enterprise" },
];

/** Superadmin-only control for manually granting a Watch subscription/
 *  Enterprise entitlement to an account. Works in every real environment
 *  (not just Preview) as of 2026-08-25 -- there is no self-serve checkout
 *  for Enterprise anywhere in this codebase, so this IS the real
 *  onboarding path for a live Enterprise customer, not just a QA
 *  convenience. requireSuperAdmin() is the real security boundary. */
export function WatchDevOpsAdmin() {
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [account, setAccount] = useState<{ accountId: string; email: string } | null>(null);
  const [state, setState] = useState<AccountDevOpsSubscriptionState | null>(null);
  const [tier, setTier] = useState<DevOpsGrantableTier>("standard");
  const [enterpriseSlots, setEnterpriseSlots] = useState(String(MANAGED_ENTERPRISE_50.slots));
  const [byoTierId, setByoTierId] = useState<(typeof WATCH_ENTERPRISE_BYO_TIERS)[number]["id"]>(WATCH_ENTERPRISE_BYO_TIERS[0].id);
  const [enterpriseCapacity, setEnterpriseCapacity] = useState(String(getEnterpriseIncludedCommunities("managed")));
  const [apiSourceMode, setApiSourceMode] = useState<"managed" | "byo">("managed");
  const [mediaAddon, setMediaAddon] = useState(false);
  const [billingInterval, setBillingInterval] = useState<WatchBillingInterval>("monthly");
  // The real Community-capacity mode for whatever's CURRENTLY selected in
  // the grant form -- drives the base/options shown in the select below, and
  // is recomputed on every apiSourceMode/byoTierId change.
  const formByoTier = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === byoTierId)!;
  const formCommunityMode: EnterpriseCommunityMode = communityModeFor(apiSourceMode, apiSourceMode === "byo" ? formByoTier.maxSlots : null);
  const formCommunityBase = getEnterpriseIncludedCommunities(formCommunityMode);
  const formCommunityCapacityNum = Number(enterpriseCapacity) || formCommunityBase;
  const formCommunityCapacityValid = validateEnterpriseCommunityCapacity(formCommunityMode, formCommunityCapacityNum);
  // Reference pricing only -- Enterprise is entirely manual/negotiated (no
  // self-serve checkout exists for it anywhere), so this never drives an
  // actual charge; it's purely informational for whoever's filling out this
  // form. Annual = 12x the real computed monthly total, no discount claimed
  // (no canonical Enterprise annual discount rate exists anywhere in this
  // codebase, unlike the self-serve tiers' own real 5%/10% annual rates --
  // inventing one here would be a fabricated number, not a reference).
  const formManagedSlots = Number(enterpriseSlots) || MANAGED_ENTERPRISE_50.slots;
  const formBasePrice = apiSourceMode === "byo" ? formByoTier.price : managedEnterprisePrice(formManagedSlots);
  const formMediaAddonKey = resolveEnterpriseMediaAddonKey(apiSourceMode, apiSourceMode === "byo" ? formByoTier.maxSlots : formManagedSlots);
  const formCommunityExpansionPrice = formCommunityCapacityValid ? (getEnterpriseCommunityExpansionPrice(formCommunityMode, formCommunityCapacityNum) ?? 0) : 0;
  const formMonthlyTotal = formBasePrice + formCommunityExpansionPrice + (mediaAddon ? enterpriseMediaAddon(formMediaAddonKey).price : 0);
  const formAnnualReference = Math.round(formMonthlyTotal * 12 * 100) / 100;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);

  // BYO credential -- status + revoke ONLY. There is deliberately no
  // "enter a credential" control here: a customer's API key is their own
  // sensitive secret, and an Innvil admin must never type/receive/relay it.
  // The customer stores it themselves via their own Settings -> AI Provider
  // tab. This tool can flip apiSourceMode and can revoke a stored
  // credential (an admin possesses nothing secret to do either), never set one.
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
      setBillingInterval(sub.data.billingInterval);
      if (sub.data.tier === "enterprise") {
        setApiSourceMode(sub.data.apiSourceMode);
        if (sub.data.apiSourceMode === "byo") {
          const matched = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.maxSlots === sub.data.enterpriseSlots);
          setByoTierId((matched ?? WATCH_ENTERPRISE_BYO_TIERS[0]).id);
        } else {
          setEnterpriseSlots(String(sub.data.enterpriseSlots ?? MANAGED_ENTERPRISE_50.slots));
        }
        // Derived from the account's REAL apiSourceMode/enterpriseSlots, not
        // React state -- setApiSourceMode above hasn't taken effect yet
        // within this same synchronous block, so reading the mode back off
        // component state here would still reflect the PREVIOUS search.
        const realCommunityMode = communityModeFor(sub.data.apiSourceMode, sub.data.enterpriseSlots);
        setEnterpriseCapacity(String(sub.data.enterpriseCommunityCapacity ?? getEnterpriseIncludedCommunities(realCommunityMode)));
        setMediaAddon(sub.data.mediaAddonActive);
      }
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
    if (tier === "enterprise" && enterpriseCapacity.trim() && !formCommunityCapacityValid) {
      setActionError(`${enterpriseCapacity} isn't a real Community capacity for ${formCommunityMode === "managed" ? "Managed Enterprise" : formCommunityMode === "byo50" ? "BYO Enterprise 50" : "BYO Enterprise Unlimited"} -- see the valid values note above the field.`);
      return;
    }
    setBusy(true);
    setActionError(null);
    setActionOk(null);
    const byoTier = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === byoTierId)!;
    const slots = apiSourceMode === "byo" ? byoTier.maxSlots : Number(enterpriseSlots);
    const res =
      tier === "enterprise"
        ? await setAccountDevOpsEnterprise(
            account.accountId,
            slots,
            enterpriseCapacity.trim() ? Number(enterpriseCapacity) : undefined,
            apiSourceMode,
            mediaAddon,
            billingInterval
          )
        : await setAccountDevOpsSubscription(account.accountId, tier as ModeratorPlanTier);
    setBusy(false);
    if (!res.ok) { setActionError(res.error); return; }
    setActionOk(
      tier === "enterprise"
        ? `Devops Enterprise entitlement set (${apiSourceMode === "byo" ? byoTier.label : `Managed, ${enterpriseSlots} slots`}, ${billingInterval}, media +${mediaAddon ? " on" : " off"}).`
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
        Manually grant a Watch subscription or Enterprise entitlement to an account — bypasses payment entirely.
        Reuses the exact same entitlement activation every real purchase uses, tagged distinctly so it's never
        confused with a real paid subscription. Enterprise has no self-serve checkout of any kind, so this is the
        real onboarding path for a live Enterprise customer, not just a QA tool — works in every environment.
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
                  {state.apiSourceMode === "byo" ? (state.enterpriseSlots ?? "Unlimited") : (state.enterpriseSlots ?? "?")} slots ·{" "}
                  {state.enterpriseCommunityCapacity ?? getEnterpriseIncludedCommunities(communityModeFor(state.apiSourceMode, state.enterpriseSlots))} Communities ·{" "}
                  {state.apiSourceMode === "byo" ? "BYO" : "Managed"} · {state.billingInterval} · Media +{state.mediaAddonActive ? " on" : " off"}
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
                <div className="flex items-center gap-3 text-sm fp-text">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio" name="apiSourceMode" checked={apiSourceMode === "managed"}
                      onChange={() => { setApiSourceMode("managed"); setEnterpriseCapacity(String(getEnterpriseIncludedCommunities("managed"))); }}
                    />
                    Managed
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio" name="apiSourceMode" checked={apiSourceMode === "byo"}
                      onChange={() => { setApiSourceMode("byo"); setEnterpriseCapacity(String(getEnterpriseIncludedCommunities(communityModeFor("byo", formByoTier.maxSlots)))); }}
                    />
                    BYO
                  </label>
                </div>
                {apiSourceMode === "byo" ? (
                  <select
                    value={byoTierId}
                    onChange={(e) => {
                      const nextId = e.target.value as typeof byoTierId;
                      setByoTierId(nextId);
                      const nextTier = WATCH_ENTERPRISE_BYO_TIERS.find((t) => t.id === nextId)!;
                      setEnterpriseCapacity(String(getEnterpriseIncludedCommunities(communityModeFor("byo", nextTier.maxSlots))));
                    }}
                    className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                  >
                    {WATCH_ENTERPRISE_BYO_TIERS.map((t) => (
                      <option key={t.id} value={t.id}>{t.label} (${t.price.toFixed(2)}/mo{t.maxSlots ? `, ${t.maxSlots} slots` : ", unlimited slots"})</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={1}
                    value={enterpriseSlots}
                    onChange={(e) => setEnterpriseSlots(e.target.value)}
                    placeholder="Watcher slots"
                    className="w-28 fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                  />
                )}
                {/* BYO Unlimited genuinely has NO fixed maximum -- it can add
                    as many Communities as wanted, in real +10 blocks past its
                    two starting packages (10 base, then 15, 25, 35, 45, ...).
                    A closed <select> is the wrong control for an unbounded
                    range, so it gets a real free-form number input instead --
                    Managed and BYO 50 both have a real, small, fixed 4-value
                    package menu (base/10 or 8/15/25), so a select stays
                    correct for those two. */}
                {formCommunityMode === "byoUnlimited" ? (
                  <div className="flex flex-col gap-1">
                    <input
                      type="number"
                      min={formCommunityBase}
                      step={1}
                      value={enterpriseCapacity}
                      onChange={(e) => setEnterpriseCapacity(e.target.value)}
                      placeholder="Communities"
                      className={`w-32 fp-panel border rounded-lg px-3 py-2 text-sm fp-text outline-none ${formCommunityCapacityValid ? "fp-line-soft" : "border-red-500/60"}`}
                    />
                    <p className="text-[10px] fp-text-faint">
                      No fixed max — {formCommunityBase} base, then 15, 25, then +10 per block (35, 45, 55…)
                      {!formCommunityCapacityValid && enterpriseCapacity.trim() && <span className="text-red-400"> — not a valid value</span>}
                    </p>
                  </div>
                ) : (
                  <select
                    value={enterpriseCapacity}
                    onChange={(e) => setEnterpriseCapacity(e.target.value)}
                    className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none"
                  >
                    <option value={formCommunityBase}>{formCommunityBase} Communities (base)</option>
                    {getEnterpriseCommunityExpansionOptions(formCommunityMode).map((o) => (
                      <option key={o.capacity} value={o.capacity}>{o.capacity} Communities (+${o.price.toFixed(2)}/mo)</option>
                    ))}
                  </select>
                )}
                <label className="flex items-center gap-1.5 cursor-pointer text-sm fp-text">
                  <input type="checkbox" checked={mediaAddon} onChange={(e) => setMediaAddon(e.target.checked)} />
                  Media Moderation +
                </label>
                <div className="flex items-center gap-3 text-sm fp-text">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="billingInterval" checked={billingInterval === "monthly"} onChange={() => setBillingInterval("monthly")} />
                    Monthly
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="billingInterval" checked={billingInterval === "annual"} onChange={() => setBillingInterval("annual")} />
                    Annual
                  </label>
                </div>
                {/* Reference only -- Enterprise billing is manual/negotiated
                    outside this tool (no self-serve checkout exists for it),
                    so nothing here is ever actually charged; this just shows
                    what the currently-configured selection prices out to. */}
                <p className="text-[11px] fp-text-faint w-full">
                  Reference price: ${formMonthlyTotal.toFixed(2)}/mo{billingInterval === "annual" && <> · ${formAnnualReference.toFixed(2)}/year (12× monthly, no discount applied — finalized manually)</>}
                </p>
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
                The customer enters their own API key themselves, from their own Settings → AI Provider tab — an Innvil
                admin never sees, types, or handles it. This tool can only show whether a credential is currently stored
                and revoke it (e.g. if the customer reports it compromised).
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-2.5 py-1.5 rounded-lg fp-panel border fp-line-soft ${state.hasByoCredential ? "text-emerald-400" : "text-amber-400"}`}>
                  {state.hasByoCredential ? "Credential stored" : "No credential stored"}
                </span>
                {state.hasByoCredential && (
                  <button
                    onClick={() => void clearByoCredential()}
                    disabled={byoBusy}
                    className="fp-panel border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text-dim hover:fp-text flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <XCircle size={14} /> {byoBusy ? "Working…" : "Revoke credential"}
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
