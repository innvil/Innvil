"use client";

import React, { useState } from "react";
import { X, Save, Type, Sparkles, Lock, Plus, Trash2 } from "lucide-react";
import { THEMES, themeVars } from "@/src/data/themes";
import { updatePanelBranding, type LandingSection } from "@/src/lib/actions/panels";
import { formatMoney } from "@/src/lib/money";

/* =========================================================
   DESIGN STUDIO — full-screen "world" for editing a panel's
   look with a LIVE preview (updates as you type). Free designs
   stay within the Innvil system; premium designs (Design Shop)
   restyle the whole panel — coming soon.
   ========================================================= */

export interface StudioValues {
  name: string;
  theme: string;
  logoUrl: string;
  accent: string;
  headline: string;
  description: string;
  favicon: string;
  sections: LandingSection[];
}

let SECTION_SEQ = 0;
const newSection = (): LandingSection => ({ id: `s${Date.now()}_${SECTION_SEQ++}`, title: "", body: "", ctaLabel: "", ctaHref: "" });

const PREMIUM_DESIGNS = [
  { id: "aurora", label: "Aurora", note: "Gradient glass · animated hero" },
  { id: "carbon", label: "Carbon Pro", note: "Ultra-dark · sharp monospace" },
  { id: "luxe", label: "Luxe", note: "Editorial serif · gold foil" },
];

export function DesignStudio({
  panel,
  initial,
  onClose,
  onSaved,
}: {
  panel: { id: string; name: string; subdomain: string; currency?: string };
  initial: StudioValues;
  onClose: () => void;
  onSaved: (v: StudioValues) => void;
}) {
  const [v, setV] = useState<StudioValues>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const set = (patch: Partial<StudioValues>) => setV((s) => ({ ...s, ...patch }));
  const setSection = (id: string, patch: Partial<LandingSection>) =>
    setV((s) => ({ ...s, sections: s.sections.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const addSection = () => setV((s) => ({ ...s, sections: [...s.sections, newSection()] }));
  const removeSection = (id: string) => setV((s) => ({ ...s, sections: s.sections.filter((x) => x.id !== id) }));
  const currency = panel.currency || "USD";
  const preview = themeVars(v.theme, v.accent) as React.CSSProperties;
  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5 text-sm outline-none focus:fp-gold-border";

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await updatePanelBranding(panel.id, {
      name: v.name, theme: v.theme, logoUrl: v.logoUrl, accent: v.accent,
      headline: v.headline, description: v.description, favicon: v.favicon,
      sections: v.sections,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Saved — your live panel now reflects this." });
    onSaved(v);
  };

  return (
    <div className="fixed inset-0 z-[60] fp-root flex flex-col" style={{ background: "var(--void)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b fp-line-soft shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center shrink-0"><Type size={16} /></span>
          <div className="min-w-0">
            <p className="fp-display text-lg leading-none">Design Studio</p>
            <p className="fp-text-faint text-xs truncate">{panel.name} · {panel.subdomain}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {msg && <span className={`text-xs hidden sm:inline ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</span>}
          <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-1.5">
            <Save size={14} /> {busy ? "Saving…" : "Save & apply"}
          </button>
          <button onClick={onClose} className="fp-panel-raised border fp-line-soft rounded-lg p-2 fp-text-dim hover:fp-text"><X size={16} /></button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-[380px_1fr]">
        {/* Controls */}
        <div className="overflow-y-auto border-r fp-line-soft p-5 space-y-6">
          <section>
            <p className="fp-text-faint text-xs fp-mono uppercase mb-3">Identity</p>
            <label className="fp-text-dim text-xs">Display name</label>
            <input value={v.name} onChange={(e) => set({ name: e.target.value })} className={`${inputCls} mt-1 mb-3`} />
            <label className="fp-text-dim text-xs">Logo URL</label>
            <input value={v.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…/logo.png" className={`${inputCls} mt-1 mb-3 fp-mono`} />
            <label className="fp-text-dim text-xs flex items-center gap-2">
              Favicon URL
              {(v.favicon || v.logoUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.favicon || v.logoUrl} alt="" className="w-4 h-4 rounded object-cover" />
              )}
            </label>
            <input value={v.favicon} onChange={(e) => set({ favicon: e.target.value })} placeholder="https://…/favicon.png (blank = use logo)" className={`${inputCls} mt-1 fp-mono`} />
          </section>

          <section>
            <p className="fp-text-faint text-xs fp-mono uppercase mb-3">Landing page</p>
            <label className="fp-text-dim text-xs">Headline</label>
            <input value={v.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Grow every platform from one wallet." className={`${inputCls} mt-1 mb-3`} />
            <label className="fp-text-dim text-xs">Description</label>
            <textarea value={v.description} onChange={(e) => set({ description: e.target.value })} rows={3} placeholder="Instant delivery, transparent pricing…" className={`${inputCls} mt-1`} />
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <p className="fp-text-faint text-xs fp-mono uppercase">Landing sections · your ads</p>
              <button onClick={addSection} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1 text-xs fp-text-dim hover:fp-text flex items-center gap-1"><Plus size={12} /> Add</button>
            </div>
            {v.sections.length === 0 && <p className="fp-text-faint text-[11px] mb-2">Add promo blocks (offers, reviews, guarantees…) below the default landing content.</p>}
            <div className="space-y-3">
              {v.sections.map((sec, i) => (
                <div key={sec.id} className="fp-panel-raised border fp-line-soft rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="fp-text-faint text-[11px] fp-mono">Section {i + 1}</span>
                    <button onClick={() => removeSection(sec.id)} className="fp-text-faint hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                  <input value={sec.title} onChange={(e) => setSection(sec.id, { title: e.target.value })} placeholder="Heading" className={`${inputCls} mb-2`} />
                  <textarea value={sec.body} onChange={(e) => setSection(sec.id, { body: e.target.value })} rows={2} placeholder="Body text…" className={`${inputCls} mb-2`} />
                  <div className="flex gap-2">
                    <input value={sec.ctaLabel} onChange={(e) => setSection(sec.id, { ctaLabel: e.target.value })} placeholder="Button (optional)" className={`${inputCls} flex-1`} />
                    <input value={sec.ctaHref} onChange={(e) => setSection(sec.id, { ctaHref: e.target.value })} placeholder="Link (blank = sign up)" className={`${inputCls} flex-1 fp-mono`} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="fp-text-faint text-xs fp-mono uppercase mb-3">Free designs (within Innvil)</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((t) => (
                <button key={t.id} onClick={() => set({ theme: t.id })} className={`text-left rounded-lg border p-2.5 transition-colors ${v.theme === t.id ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised hover:fp-gold-border"}`}>
                  <div className="flex gap-1 mb-1.5">
                    <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: t.a }} />
                    <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: t.b }} />
                  </div>
                  <p className="text-xs">{t.label}</p>
                </button>
              ))}
            </div>
            <label className="fp-text-dim text-xs mt-3 block">Custom accent</label>
            <div className="flex items-center gap-2 mt-1">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(v.accent) ? v.accent : "#C9A574"} onChange={(e) => set({ accent: e.target.value })} className="w-9 h-9 rounded-lg bg-transparent border fp-line-soft cursor-pointer p-0.5" />
              <input value={v.accent} onChange={(e) => set({ accent: e.target.value })} placeholder="#hex (blank = theme)" className={`${inputCls} fp-mono flex-1`} />
              {v.accent && <button onClick={() => set({ accent: "" })} className="text-xs fp-text-dim hover:fp-text">Reset</button>}
            </div>
          </section>

          <section>
            <p className="fp-text-faint text-xs fp-mono uppercase mb-1">Design Shop · premium</p>
            <p className="fp-text-faint text-[11px] mb-3">Advanced designs that restyle your landing AND dashboard — coming soon.</p>
            <div className="space-y-2">
              {PREMIUM_DESIGNS.map((d) => (
                <div key={d.id} className="flex items-center justify-between fp-panel-raised border fp-line-soft rounded-lg px-3 py-2.5">
                  <div><p className="text-sm">{d.label}</p><p className="fp-text-faint text-[11px]">{d.note}</p></div>
                  <span className="text-[10px] fp-text-faint flex items-center gap-1"><Lock size={10} /> Soon</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Live preview */}
        <div className="overflow-y-auto p-6" style={{ background: "var(--void-2)" }}>
          <p className="fp-text-faint text-xs fp-mono uppercase mb-3 text-center">Live preview</p>
          <div style={preview} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border fp-line shadow-2xl">
            {/* Landing hero */}
            <div className="fp-root p-6" style={{ background: "var(--void)" }}>
              <div className="flex items-center gap-2 mb-6">
                {v.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                ) : (
                  <span className="w-8 h-8 rounded-lg fp-violet-bg flex items-center justify-center"><Sparkles size={15} color="#0A0B0F" /></span>
                )}
                <span className="fp-display text-lg">{v.name || "Your panel"}</span>
              </div>
              <h1 className="fp-display text-2xl mb-2 leading-tight">{v.headline || "Grow every platform from one wallet."}</h1>
              <p className="fp-text-dim text-sm mb-4">{v.description || "Instant delivery, transparent pricing, and one balance for all your social growth."}</p>
              <button className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg">Create account</button>
              <div className="fp-panel border fp-line rounded-xl p-3 mt-5 flex items-center justify-between">
                <div><p className="text-sm font-medium">Instagram Followers — HQ</p><p className="fp-text-faint text-xs fp-mono">Followers · min 100</p></div>
                <span className="fp-mono text-sm fp-gold">{formatMoney(1.35, currency)}/1k</span>
              </div>
              {v.sections.filter((s) => s.title || s.body).map((s) => (
                <div key={s.id} className="border-t fp-line-soft mt-5 pt-5 text-center">
                  {s.title && <p className="fp-display text-lg mb-1">{s.title}</p>}
                  {s.body && <p className="fp-text-dim text-sm whitespace-pre-line">{s.body}</p>}
                  {s.ctaLabel && <span className="fp-btn-primary text-xs font-semibold px-3 py-1.5 rounded-lg inline-block mt-3">{s.ctaLabel}</span>}
                </div>
              ))}
            </div>
            {/* Dashboard header */}
            <div className="fp-root border-t fp-line-soft p-4 flex items-center justify-between" style={{ background: "var(--void-2)" }}>
              <div className="flex items-center gap-2">
                {v.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v.logoUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
                ) : (
                  <span className="w-7 h-7 rounded-md fp-violet-bg flex items-center justify-center"><Sparkles size={13} color="#0A0B0F" /></span>
                )}
                <span className="fp-display">{v.name || "Your panel"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="fp-mono text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2"><span className="fp-gold">{formatMoney(24.6, currency)}</span></span>
                <button className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg">Add Funds</button>
              </div>
            </div>
          </div>
          <p className="fp-text-faint text-[11px] text-center mt-3">Free designs stay within the Innvil system. Premium designs (Design Shop) will restyle the whole dashboard.</p>
        </div>
      </div>
    </div>
  );
}
