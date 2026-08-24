"use client";

import React, { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import {
  getByoUsagePolicyStatus, saveByoUsagePolicy, removeByoUsagePolicy, type ByoUsagePolicyStatus,
} from "@/src/lib/actions/watch-byo-usage-settings";
import type { UsagePolicyScope } from "@/src/lib/products/watch-byo-usage-policy";
import { SectionHeader } from "./WatchUI";

const ACCOUNT_LABEL = "Whole account";

/** BYO Usage Controls (Phase 4.V, extended in 4.V.1 item 2 with a real
 *  per-Watcher-deployment scope) -- customer-owned, self-configured spend
 *  ceilings on top of an already-provisioned BYO credential. Distinct from
 *  the read-only "BYO calls" telemetry card above it: this is where the
 *  customer actually SETS a limit. Never rendered for a non-BYO account
 *  (gated by the caller, app/usage/page.tsx, on capacity.apiSourceMode). */
type Kind = "reactive" | "proactive";

const KIND_LABEL: Record<Kind, string> = { reactive: "Reactive replies", proactive: "Proactive (scheduled)" };
const KIND_HINT: Record<Kind, string> = {
  reactive: "Real replies to human messages — chatter/Q&A.",
  proactive: "Unprompted scheduled messages — currently Watcher Presence Scheduling only.",
};

export interface ByoDeploymentOption {
  deploymentId: string;
  watcherName: string;
  communityTitle: string;
}

/** Compound dropdown value <-> real scope object -- the UI needs one flat
 *  option list (account / every Community / every Watcher deployment), the
 *  action layer needs the real discriminated UsagePolicyScope. */
function scopeToKey(scope: UsagePolicyScope): string {
  if (scope.type === "account") return "account:";
  if (scope.type === "community") return `community:${scope.communityId}`;
  return `deployment:${scope.deploymentId}`;
}
function keyToScope(key: string): UsagePolicyScope {
  const [type, id] = key.split(":");
  if (type === "community") return { type: "community", communityId: id };
  if (type === "deployment") return { type: "deployment", deploymentId: id };
  return { type: "account" };
}

export function ByoUsagePolicyCard({
  initial, communities, deployments,
}: {
  initial: ByoUsagePolicyStatus[];
  communities: Array<{ id: string; title: string }>;
  deployments: ByoDeploymentOption[];
}) {
  const [policies, setPolicies] = useState(initial);
  const [scopeKey, setScopeKey] = useState<string>("account:");
  const [kind, setKind] = useState<Kind>("reactive");
  const [period, setPeriod] = useState<"daily" | "monthly">("monthly");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await getByoUsagePolicyStatus();
    if (res.ok) setPolicies(res.data);
  };

  const scopeLabel = (scope: UsagePolicyScope): string => {
    if (scope.type === "account") return ACCOUNT_LABEL;
    if (scope.type === "community") return communities.find((c) => c.id === scope.communityId)?.title ?? "A Community";
    const d = deployments.find((x) => x.deploymentId === scope.deploymentId);
    return d ? `${d.watcherName} — ${d.communityTitle}` : "A Watcher deployment";
  };
  const rowKey = (p: ByoUsagePolicyStatus) => `${scopeToKey(p.scope)}:${p.kind}`;

  const submit = async () => {
    setError(null);
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive number of requests.");
      return;
    }
    setBusy("save");
    const res = await saveByoUsagePolicy(keyToScope(scopeKey), kind, period, n);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLimit("");
    await refresh();
  };

  const remove = async (scope: UsagePolicyScope, k: Kind) => {
    setBusy(`${scopeToKey(scope)}:${k}`);
    await removeByoUsagePolicy(scope, k);
    setBusy(null);
    await refresh();
  };

  return (
    <div className="w-card p-5">
      <SectionHeader icon={Gauge} title="BYO usage controls" />
      <p className="text-xs w-text-faint -mt-2 mb-4">
        Cap how much your own AI provider credential is allowed to generate per period — a limit YOU set, to control your own provider spend.
        Innvil's plan/pricing is unaffected either way. Reactive (replies to messages) and proactive (scheduled, unprompted) usage are capped
        independently — the tightest configured limit for each (account-wide, per-Community, or per-Watcher) always applies.
      </p>

      {policies.length > 0 && (
        <div className="space-y-2 mb-4">
          {policies.map((p) => (
            <div key={rowKey(p)} className="flex items-center justify-between gap-3 border w-line-soft rounded-lg p-3 text-sm">
              <div>
                <p className="w-text">{scopeLabel(p.scope)} · <span className="w-text-faint">{KIND_LABEL[p.kind]}</span></p>
                <p className="text-xs w-text-faint">
                  {p.used.toLocaleString()} / {p.requestLimit.toLocaleString()} requests · resets {p.period === "daily" ? "daily" : "monthly"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === rowKey(p)}
                onClick={() => remove(p.scope, p.kind)}
                className="text-xs w-red hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 flex-wrap">
        <div>
          <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Scope</label>
          <select value={scopeKey} onChange={(e) => setScopeKey(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border max-w-[220px]">
            <option value="account:">{ACCOUNT_LABEL}</option>
            {communities.length > 0 && (
              <optgroup label="Communities">
                {communities.map((c) => <option key={c.id} value={`community:${c.id}`}>{c.title}</option>)}
              </optgroup>
            )}
            {deployments.length > 0 && (
              <optgroup label="Watcher deployments">
                {deployments.map((d) => (
                  <option key={d.deploymentId} value={`deployment:${d.deploymentId}`}>{d.watcherName} — {d.communityTitle}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} title={KIND_HINT[kind]} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border">
            <option value="reactive">{KIND_LABEL.reactive}</option>
            <option value="proactive">{KIND_LABEL.proactive}</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Resets</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value as "daily" | "monthly")} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border">
            <option value="daily">Daily</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wide w-text-faint font-semibold block mb-1">Request limit</label>
          <input
            type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="e.g. 5000"
            className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border w-28"
          />
        </div>
        <button type="button" disabled={busy === "save"} onClick={submit} className="text-xs w-teal hover:underline px-3 py-1.5 rounded-lg border w-line-soft disabled:opacity-50 flex items-center gap-1.5">
          {busy === "save" && <Loader2 size={12} className="animate-spin" />} Save limit
        </button>
      </div>
      <p className="text-[11px] w-text-faint mt-1.5">{KIND_HINT[kind]}</p>
      {error && <p className="text-xs w-red mt-2">{error}</p>}
    </div>
  );
}
