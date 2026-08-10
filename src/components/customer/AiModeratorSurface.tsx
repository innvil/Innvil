"use client";

import React, { useEffect, useState } from "react";
import { Bot, Sparkles, Wallet, CheckCircle2, AlertTriangle, Clock, ShieldCheck, LifeBuoy } from "lucide-react";
import { formatMoney } from "@/src/lib/money";
import {
  getModeratorEligibility, startCustomerModeratorTrial, subscribeCustomerModeratorPlan, cancelCustomerModeratorPlan,
  contactEnterpriseModeratorSales, listCustomerModerators, createCustomerModerator,
  type ModeratorEligibilityInfo, type CustomerModeratorRow,
} from "@/src/lib/actions/customer-moderator";
import type { ModeratorPlanTier } from "@/src/lib/money";

/* Storefront AI Moderator surface — the real customer-facing product (see
   CLAUDE.md Phase 4.M product-placement correction). Customer discovers
   eligibility, starts the free trial or subscribes, and manages their own
   saved moderators. Telegram connection (bot creation, community linking)
   reuses the existing owner-side provisioning pipeline and is a documented
   follow-up, not built in this pass — see the release note. */

const TIERS: Array<{ tier: ModeratorPlanTier; label: string; price: number; slots: number }> = [
  { tier: "basic", label: "Basic", price: 49.99, slots: 2 },
  { tier: "standard", label: "Standard", price: 99.99, slots: 5 },
  { tier: "premium", label: "Premium", price: 179.99, slots: 10 },
  { tier: "pro", label: "Pro", price: 299.99, slots: 20 },
];

function eligibilityCopy(info: ModeratorEligibilityInfo): string {
  if (info.wouldQualifyVia === "ESTABLISHED") {
    return "You're eligible for a free 7-day AI Moderator trial based on your account history and panel service spend.";
  }
  if (info.wouldQualifyVia === "HIGH_VALUE") {
    return "You're eligible for a free 7-day AI Moderator trial based on your panel service spend.";
  }
  if (info.wouldQualifyVia === "WALLET") {
    return "Keep at least $10 in your panel wallet during the 7-day trial. The $10 remains yours and can still be used for panel services.";
  }
  return "Add funds to reach a $10 wallet balance and unlock your free trial.";
}

function TierCard({ t, current, onSubscribe, busy }: { t: (typeof TIERS)[number]; current: ModeratorPlanTier | null; onSubscribe: (tier: ModeratorPlanTier) => void; busy: boolean }) {
  const active = current === t.tier;
  return (
    <div className={`fp-panel-raised border rounded-xl p-4 ${active ? "fp-gold-border" : "fp-line-soft"}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{t.label}</p>
        {active && <span className="text-[10px] fp-gold">Active</span>}
      </div>
      <p className="text-2xl font-bold mt-1">{formatMoney(t.price)}<span className="text-xs fp-text-faint font-normal">/mo</span></p>
      <p className="text-xs fp-text-dim mt-1">{t.slots} Active Moderator Slots</p>
      <button
        onClick={() => onSubscribe(t.tier)}
        disabled={busy || active}
        className="w-full mt-3 fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
      >
        {active ? "Current plan" : "Subscribe"}
      </button>
    </div>
  );
}

export function AiModeratorSurface({ panelId }: { panelId?: string }) {
  const [info, setInfo] = useState<ModeratorEligibilityInfo | null>(null);
  const [moderators, setModerators] = useState<CustomerModeratorRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [enterpriseNote, setEnterpriseNote] = useState("");

  const load = async () => {
    if (!panelId) return;
    const [e, m] = await Promise.all([getModeratorEligibility(panelId), listCustomerModerators(panelId)]);
    setInfo(e);
    setModerators(m);
    setLoaded(true);
  };

  useEffect(() => { load(); }, [panelId]);

  const startTrial = async () => {
    if (!panelId || busy) return;
    setBusy(true); setMsg(null);
    const res = await startCustomerModeratorTrial(panelId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setInfo(res.data);
    setMsg({ text: "Your 7-day free trial has started." });
  };

  const subscribe = async (tier: ModeratorPlanTier) => {
    if (!panelId || busy) return;
    setBusy(true); setMsg(null);
    const res = await subscribeCustomerModeratorPlan(panelId, tier);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setInfo(res.data);
    setMsg({ text: "Subscribed." });
  };

  const cancel = async () => {
    if (!panelId || busy) return;
    setBusy(true); setMsg(null);
    const res = await cancelCustomerModeratorPlan(panelId);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setInfo(res.data);
    setMsg({ text: "Plan canceled." });
  };

  const create = async () => {
    if (!panelId || busy || !newName.trim()) return;
    setBusy(true); setMsg(null);
    const res = await createCustomerModerator(panelId, newName);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setModerators((prev) => [...prev, res.data]);
    setNewName("");
    setMsg({ text: `${res.data.name} created.` });
  };

  const contactEnterprise = async () => {
    if (!panelId || busy) return;
    setBusy(true); setMsg(null);
    const res = await contactEnterpriseModeratorSales(panelId, enterpriseNote);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setEnterpriseNote("");
    setMsg({ text: "Sent — support will follow up about Enterprise." });
  };

  if (!loaded) return <p className="fp-text-faint text-sm py-4 text-center">Loading…</p>;
  if (!info) return <p className="fp-text-faint text-sm py-4 text-center">Sign in to view the AI Moderator.</p>;

  return (
    <div className="space-y-6">
      <div className="fp-panel-raised border fp-line-soft rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold grid place-items-center"><Bot size={16} /></span>
          <div>
            <p className="text-sm font-semibold">AI Moderator</p>
            <p className="text-xs fp-text-faint">An always-on community moderator for your Telegram groups.</p>
          </div>
        </div>

        {info.entitlementSource === "trial" && (
          <div className="mt-3 flex items-center gap-2 text-xs fp-gold">
            <Clock size={14} /> Free trial active — {info.maxActiveSlots} Active Moderator Slot{info.maxActiveSlots === 1 ? "" : "s"}, ends{" "}
            {info.trialEndsAt ? new Date(info.trialEndsAt).toLocaleDateString() : ""}.
          </div>
        )}
        {info.trialPausedForWallet && (
          <div className="mt-3 flex items-center gap-2 text-xs text-red-400">
            <AlertTriangle size={14} /> Your AI Moderator trial is paused because your wallet balance is below $10. Add funds to resume access before the trial expires.
          </div>
        )}
        {info.entitlementSource && typeof info.entitlementSource === "string" && info.entitlementSource !== "trial" && (
          <div className="mt-3 flex items-center gap-2 text-xs fp-safe">
            <CheckCircle2 size={14} /> Subscribed — {info.maxActiveSlots} Active Moderator Slots.
            <button onClick={cancel} disabled={busy} className="ml-2 underline fp-text-dim hover:fp-text">Cancel</button>
          </div>
        )}

        {!info.entitlementSource && !info.trialEverUsed && (
          <div className="mt-3">
            <p className="text-xs fp-text-dim">{eligibilityCopy(info)}</p>
            <button
              onClick={startTrial}
              disabled={busy || !info.canStartTrial}
              className="mt-2 fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60"
            >
              Start 7-day free trial
            </button>
          </div>
        )}
        {!info.entitlementSource && info.trialEverUsed && (
          <p className="mt-3 text-xs fp-text-faint">Your free trial has ended. Choose a plan below to continue.</p>
        )}

        {msg && <p className={`text-xs mt-2 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</p>}
        <p className="text-[11px] fp-text-faint mt-2 flex items-center gap-1"><Wallet size={12} /> Wallet balance: {formatMoney(info.walletBalance)}</p>
      </div>

      <div>
        <p className="text-xs fp-text-faint mb-2">Plans</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {TIERS.map((t) => (
            <TierCard key={t.tier} t={t} current={typeof info.entitlementSource === "string" && info.entitlementSource !== "trial" ? info.entitlementSource : null} onSubscribe={subscribe} busy={busy} />
          ))}
        </div>
        <div className="fp-panel-raised border fp-line-soft rounded-xl p-4 mt-3">
          <p className="text-sm font-semibold">Enterprise</p>
          <p className="text-xs fp-text-dim mt-1">20+ Active Moderator Slots</p>
          <p className="text-xs fp-text-faint mt-2">Need more than 20 active moderator slots? Contact us for Enterprise.</p>
          <div className="flex items-center gap-2 mt-2">
            <input
              value={enterpriseNote}
              onChange={(e) => setEnterpriseNote(e.target.value)}
              placeholder="Optional note (how many slots, use case)"
              className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
            />
            <button onClick={contactEnterprise} disabled={busy} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60 flex items-center gap-1">
              <LifeBuoy size={14} /> Contact us
            </button>
          </div>
        </div>
      </div>

      {info.entitlementSource && (
        <div>
          <p className="text-xs fp-text-faint mb-2 flex items-center gap-1"><Sparkles size={12} /> Your moderators</p>
          <div className="flex items-center gap-2 mb-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Moderator name, e.g. Mika"
              className="flex-1 fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm fp-text outline-none focus:fp-gold-border"
            />
            <button onClick={create} disabled={busy || !newName.trim()} className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-60">
              Create
            </button>
          </div>
          {moderators.length === 0 ? (
            <p className="text-xs fp-text-faint">No moderators yet — create one above.</p>
          ) : (
            <div className="space-y-2">
              {moderators.map((m) => (
                <div key={m.id} className="fp-panel-raised border fp-line-soft rounded-lg p-3 flex items-center justify-between">
                  <p className="text-sm">{m.name}</p>
                  <span className="text-[11px] fp-text-faint">{m.provisioningStatus.replaceAll("_", " ")}</span>
                </div>
              ))}
              <p className="text-[11px] fp-text-faint flex items-center gap-1 mt-1">
                <ShieldCheck size={12} /> Telegram connection is coming soon to this dashboard — contact support to connect a moderator today.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
