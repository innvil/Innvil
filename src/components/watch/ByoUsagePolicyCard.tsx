"use client";

import React, { useState } from "react";
import { Gauge, Loader2 } from "lucide-react";
import {
  getByoUsagePolicyStatus, saveByoUsagePolicy, removeByoUsagePolicy, type ByoUsagePolicyStatus,
} from "@/src/lib/actions/watch-byo-usage-settings";
import { SectionHeader } from "./WatchUI";

const ACCOUNT_LABEL = "Whole account";

/** BYO Usage Controls (Phase 4.V) -- customer-owned, self-configured spend
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

export function ByoUsagePolicyCard({ initial, communities }: { initial: ByoUsagePolicyStatus[]; communities: Array<{ id: string; title: string }> }) {
  const [policies, setPolicies] = useState(initial);
  const [scope, setScope] = useState<string>(""); // "" = account-wide
  const [kind, setKind] = useState<Kind>("reactive");
  const [period, setPeriod] = useState<"daily" | "monthly">("monthly");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const res = await getByoUsagePolicyStatus();
    if (res.ok) setPolicies(res.data);
  };

  const communityTitle = (id: string | null) => (id ? communities.find((c) => c.id === id)?.title ?? "A Community" : ACCOUNT_LABEL);
  const rowKey = (p: ByoUsagePolicyStatus) => `${p.communityId ?? "__account__"}:${p.kind}`;

  const submit = async () => {
    setError(null);
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter a positive number of requests.");
      return;
    }
    setBusy("save");
    const res = await saveByoUsagePolicy(scope || null, kind, period, n);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLimit("");
    await refresh();
  };

  const remove = async (communityId: string | null, k: Kind) => {
    const key = `${communityId ?? "__account__"}:${k}`;
    setBusy(key);
    await removeByoUsagePolicy(communityId, k);
    setBusy(null);
    await refresh();
  };

  return (
    <div className="w-card p-5">
      <SectionHeader icon={Gauge} title="BYO usage controls" />
      <p className="text-xs w-text-faint -mt-2 mb-4">
        Cap how much your own AI provider credential is allowed to generate per period — a limit YOU set, to control your own provider spend.
        Innvil's plan/pricing is unaffected either way. Reactive (replies to messages) and proactive (scheduled, unprompted) usage are capped
        independently — the tightest configured limit for each (account-wide or per-Community) always applies.
      </p>

      {policies.length > 0 && (
        <div className="space-y-2 mb-4">
          {policies.map((p) => (
            <div key={rowKey(p)} className="flex items-center justify-between gap-3 border w-line-soft rounded-lg p-3 text-sm">
              <div>
                <p className="w-text">{communityTitle(p.communityId)} · <span className="w-text-faint">{KIND_LABEL[p.kind]}</span></p>
                <p className="text-xs w-text-faint">
                  {p.used.toLocaleString()} / {p.requestLimit.toLocaleString()} requests · resets {p.period === "daily" ? "daily" : "monthly"}
                </p>
              </div>
              <button
                type="button"
                disabled={busy === rowKey(p)}
                onClick={() => remove(p.communityId, p.kind)}
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
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="text-xs w-surface-raised border w-line-soft rounded-lg px-2.5 py-1.5 w-text outline-none focus:w-teal-border">
            <option value="">{ACCOUNT_LABEL}</option>
            {communities.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
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
