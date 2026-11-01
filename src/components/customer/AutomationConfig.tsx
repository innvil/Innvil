"use client";

import React, { useEffect, useState } from "react";
import { Plus, Trash2, Save, X, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { getAutomationProfile, saveAutomationProfile, type AutomationProfileInfo, type ConfigService } from "@/src/lib/actions/automation-profile";
import { makeSlot, type AutomationProfile, type AutomationSlot } from "@/src/lib/automation/profile";

/* The customer's keyword→service→quantity configuration. Hidden by default; opened by
   a "Configure" button in the Campaign surface, collapses on Save. */

export function AutomationConfig({ panelId, onClose }: { panelId: string; onClose: () => void }) {
  const [info, setInfo] = useState<AutomationProfileInfo | null>(null);
  const [profile, setProfile] = useState<AutomationProfile>({ platforms: {} });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    getAutomationProfile(panelId).then((i) => {
      if (!i) return;
      setInfo(i);
      setProfile(i.profile);
    }).catch(() => {});
  }, [panelId]);

  const platforms = info ? Object.keys(info.servicesByPlatform).sort() : [];

  const slotsOf = (p: string): AutomationSlot[] => profile.platforms[p] ?? [];
  const setSlots = (p: string, slots: AutomationSlot[]) =>
    setProfile((prev) => ({ platforms: { ...prev.platforms, [p]: slots } }));
  const updateSlot = (p: string, id: string, patch: Partial<AutomationSlot>) =>
    setSlots(p, slotsOf(p).map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await saveAutomationProfile(panelId, profile);
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    onClose();
  };

  const inputCls = "fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-2 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="fp-panel border fp-line rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Configure your automation</p>
          <p className="fp-text-faint text-[11px] mt-0.5">Per platform, add the services to auto-order. Add keywords to fire a slot only when the link contains them; leave keywords empty for a default.</p>
        </div>
        <button onClick={onClose} className="fp-panel-raised border fp-line-soft rounded-lg p-2 fp-text-dim hover:fp-text"><X size={15} /></button>
      </div>

      {!info ? (
        <p className="fp-text-faint text-sm py-4 text-center flex items-center justify-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : platforms.length === 0 ? (
        <p className="fp-text-faint text-sm py-4">No services are available to automate on your current plan platforms yet.</p>
      ) : (
        <div className="space-y-4">
          {platforms.map((p) => {
            const services = info.servicesByPlatform[p];
            const slots = slotsOf(p);
            return (
              <div key={p} className="fp-panel-raised border fp-line-soft rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium capitalize">{p}</p>
                  <button onClick={() => setSlots(p, [...slots, makeSlot(services[0]?.id ?? "", services[0]?.min || 100)])} className="text-[11px] fp-text-dim border fp-line-soft rounded-lg px-2 py-1 hover:fp-text flex items-center gap-1"><Plus size={11} /> Add service</button>
                </div>
                {slots.length === 0 ? (
                  <p className="fp-text-faint text-[11px]">No services yet — add one to automate {p} links.</p>
                ) : (
                  <div className="space-y-2">
                    {slots.map((s) => (
                      <div key={s.id} className="grid grid-cols-1 sm:grid-cols-[1fr_90px_1fr_auto] gap-2 items-center">
                        <select value={s.serviceId} onChange={(e) => updateSlot(p, s.id, { serviceId: e.target.value })} className={inputCls}>
                          {services.map((sv: ConfigService) => <option key={sv.id} value={sv.id}>{sv.name}</option>)}
                        </select>
                        <input type="number" min={1} value={s.quantity || ""} onChange={(e) => updateSlot(p, s.id, { quantity: Number(e.target.value) })} placeholder="Qty" className={inputCls} />
                        <input value={s.keywords.join(", ")} onChange={(e) => updateSlot(p, s.id, { keywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean) })} placeholder="keywords (e.g. reel, video)" className={inputCls} />
                        <button onClick={() => setSlots(p, slots.filter((x) => x.id !== s.id))} className="fp-text-faint hover:text-red-400 p-1.5"><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && <p className={`text-xs flex items-center gap-1.5 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</p>}

      <div className="flex justify-end">
        <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-60 flex items-center gap-2">
          {busy ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Save size={15} /> Save configuration</>}
        </button>
      </div>
    </div>
  );
}
