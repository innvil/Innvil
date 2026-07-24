"use client";

import React, { useEffect, useState } from "react";
import { MessageCircle, CheckCircle2, AlertTriangle, Wallet, Lock, Bot } from "lucide-react";
import { getSupportAddon, setSupportAddon, type SupportAddonInfo } from "@/src/lib/actions/ai-assistant";

/* AI Assistant tab (owner side). The owner's own assistant is the floating button in
   the corner (free). This tab manages the paid Customer AI Support add-on ($2.99/mo
   from the panel's Innvil balance) — the AI chat for the panel's STOREFRONT customers. */

const SUPPORT_ADDON_CACHE_PREFIX = "innvil-owner:support-addon";

function supportAddonCacheKey(panelId: string) {
  return `${SUPPORT_ADDON_CACHE_PREFIX}:${panelId}`;
}

function readSupportAddonCache(panelId: string): SupportAddonInfo | null {
  if (typeof window === "undefined") return null;
  const key = supportAddonCacheKey(panelId);
  try {
    const raw = window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SupportAddonInfo) : null;
  } catch {
    return null;
  }
}

function writeSupportAddonCache(panelId: string, value: SupportAddonInfo) {
  if (typeof window === "undefined") return;
  const key = supportAddonCacheKey(panelId);
  try {
    const raw = JSON.stringify(value);
    window.sessionStorage.setItem(key, raw);
    window.localStorage.setItem(key, raw);
  } catch {
    // ignore storage failures
  }
}

export function OwnerAssistantTab({ panelId }: { panelId: string; panelName?: string }) {
  const cached = readSupportAddonCache(panelId);
  const [addon, setAddon] = useState<SupportAddonInfo | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [syncing, setSyncing] = useState(Boolean(cached));
  const [actionBusy, setActionBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setSyncing(true);
    getSupportAddon(panelId)
      .then((a) => {
        setAddon(a);
        writeSupportAddonCache(panelId, a);
      })
      .finally(() => {
        setLoading(false);
        setSyncing(false);
      });
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [panelId]);

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

  const toggleAddon = async (enable: boolean) => {
    setActionBusy(true); setErr(null);
    const res = await setSupportAddon(panelId, enable);
    setActionBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    setAddon(res.data);
    writeSupportAddonCache(panelId, res.data);
  };

  if (loading) return <p className="fp-text-faint text-sm py-8 text-center">Loading…</p>;
  const configured = addon?.configured ?? false;
  const price = addon?.price ?? 2.99;
  const canAfford = (addon?.innvilBalance ?? 0) >= price;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 text-xs fp-text-dim flex items-center gap-2">
        <Bot size={14} className="fp-gold shrink-0" />
        <span>Your own AI assistant is the <span className="fp-text">floating button in the bottom-right corner</span> — free, ask it anything about running this panel.</span>
      </div>

      <div className="fp-panel border fp-gold-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center"><MessageCircle size={18} /></span>
          <div className="min-w-0">
            <p className="fp-display text-base">Customer AI Support <span className="text-[10px] fp-gold-soft-bg fp-gold px-1.5 py-0.5 rounded-full align-middle">Add-on</span></p>
            <p className="fp-text-faint text-[11px]">An AI support chat on your storefront that answers YOUR customers.{syncing ? " Syncing…" : ""}</p>
          </div>
        </div>

        <p className="fp-text-dim text-sm leading-relaxed mb-4">
          Give your customers instant answers about your services, their orders, deposits and how ordering works —
          grounded in your catalog and each customer&apos;s own account. It escalates to a ticket when it can&apos;t help,
          cutting your support load.
        </p>

        {addon?.enabled ? (
          <div className="flex items-center justify-between flex-wrap gap-2 fp-panel-raised border fp-line-soft rounded-xl p-3">
            <p className="text-xs fp-safe flex items-center gap-1.5"><CheckCircle2 size={13} /> Active on your storefront · renews {fmtDate(addon.nextChargeAt)} · ${price.toFixed(2)}/mo</p>
            <button onClick={() => toggleAddon(false)} disabled={actionBusy} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 disabled:opacity-60 hover:fp-text">
              {actionBusy ? "…" : "Turn off"}
            </button>
          </div>
        ) : (
          <>
            <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mb-3">
              <div className="flex items-baseline gap-1.5">
                <span className="fp-display text-2xl fp-gold">${price.toFixed(2)}</span>
                <span className="fp-text-dim text-sm">/ month</span>
              </div>
              <p className="fp-text-faint text-xs mt-1.5 leading-relaxed">
                Optional — <span className="fp-text">your panel stays 0% rent</span>. Billed from this panel&apos;s Innvil
                balance; cancel anytime. Covers the AI usage for your customers.
              </p>
            </div>
            {addon?.lapsed && (
              <p className="text-xs fp-gold flex items-center gap-1.5 mb-2"><AlertTriangle size={12} /> Paused because the Innvil balance ran low — top up and re-enable to resume.</p>
            )}
            <div className="flex items-center gap-2 text-xs fp-text-faint mb-3">
              <Wallet size={13} /> This panel&apos;s Innvil balance: <span className="fp-mono fp-text">${(addon?.innvilBalance ?? 0).toFixed(2)}</span>
            </div>
            {!configured ? (
              <p className="text-xs fp-text-faint flex items-center gap-1.5"><Lock size={12} /> Being set up on Innvil&apos;s side — check back shortly.</p>
            ) : (
              <>
                <button onClick={() => toggleAddon(true)} disabled={actionBusy || !canAfford} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60">
                  {actionBusy ? "Enabling…" : `Enable — $${price.toFixed(2)}/mo`}
                </button>
                {!canAfford && <p className="fp-text-faint text-xs mt-2">Add at least ${price.toFixed(2)} to this panel&apos;s Innvil balance (Billing → Add funds), then enable.</p>}
              </>
            )}
          </>
        )}
        {err && <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}
      </div>
    </div>
  );
}
