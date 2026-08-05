"use client";

import React, { useState } from "react";
import { X, Save, Type, Gem, Plus, Trash2, Monitor, LayoutDashboard, Layers } from "lucide-react";
import { DefaultLogo } from "@/src/components/ui/BrandMark";
import { THEMES, themeVars } from "@/src/data/themes";
import { updatePanelBranding, type LandingSection } from "@/src/lib/actions/panels";
import { PLATFORM_FOCUS_OPTIONS, normalizePlatformFocus } from "@/src/lib/platform-focus";
import { applyPlatformContent, getPlatformContentPack } from "@/src/lib/design/platform-content";
import { formatMoney, currencySymbol } from "@/src/lib/money";
import { DashboardLayoutBuilder, DashboardHomePreview } from "./DashboardLayoutBuilder";
import { DesignRenderer } from "@/src/components/design/DesignRenderer";
import { getDesignPackage } from "@/src/data/designs";
import { getDesignLibrary, getDashboardDesign } from "@/src/lib/actions/design";
import { themeToDesignTokens, designToThemeVars } from "@/src/lib/design/theme-bridge";
import { DesignLibraryPanel } from "./DesignLibraryPanel";
import { VisualEditor } from "./VisualEditor";
import type { DashboardWidget } from "@/src/lib/dashboard-layout";

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
  platformFocus: string | null;
}

let SECTION_SEQ = 0;
const newSection = (): LandingSection => ({ id: `s${Date.now()}_${SECTION_SEQ++}`, title: "", body: "", ctaLabel: "", ctaHref: "" });

const FREE_THEMES = THEMES.filter((t) => !t.premium);
const PREMIUM_THEMES = THEMES.filter((t) => t.premium);

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
  // Which "world" of the studio is active — the landing page or the customer dashboard.
  const [world, setWorld] = useState<"landing" | "dashboard">("landing");
  const [showEditor, setShowEditor] = useState(false);
  // Design Tools (Business) entitlement — gated features are HIDDEN, not upsold, for
  // owners without it, since there's no self-serve subscribe yet.
  const [hasTools, setHasTools] = useState(false);
  const [dashPreview, setDashPreview] = useState<DashboardWidget[] | null>(null);
  // The purchased design currently applied to this panel's landing (null = Innvil default).
  const [activeDesign, setActiveDesign] = useState<string | null>(null);
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

  // Which purchased design (if any) is live — so the preview shows the REAL landing.
  const loadActiveDesign = React.useCallback(() => {
    getDesignLibrary(panel.id).then((lib) => setActiveDesign(lib?.active ?? null)).catch(() => {});
  }, [panel.id]);
  React.useEffect(() => { loadActiveDesign(); }, [loadActiveDesign]);
  React.useEffect(() => {
    getDashboardDesign(panel.id)
      .then((d) => { setHasTools(!!d?.hasDesignTools); if (!d?.hasDesignTools) setWorld("landing"); })
      .catch(() => setHasTools(false));
  }, [panel.id]);
  const activePkg = activeDesign ? getDesignPackage(activeDesign) : undefined;
  // Preview reflects the platform focus live: overlay the platform copy onto the design,
  // and TG-flavour the default landing hero — matching what the live storefront renders.
  const focus = normalizePlatformFocus(v.platformFocus);
  const focusPack = getPlatformContentPack(focus);
  const previewPkg = activePkg ? applyPlatformContent(activePkg, focus) : undefined;

  const save = async () => {
    setBusy(true); setMsg(null);
    const res = await updatePanelBranding(panel.id, {
      name: v.name, theme: v.theme, logoUrl: v.logoUrl, accent: v.accent,
      headline: v.headline, description: v.description, favicon: v.favicon,
      sections: v.sections, platformFocus: v.platformFocus,
    });
    setBusy(false);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setMsg({ text: "Saved — your live panel now reflects this." });
    onSaved(v);
  };

  if (showEditor) {
    return <VisualEditor panel={panel} onClose={() => { setShowEditor(false); loadActiveDesign(); }} />;
  }

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
        {/* World switcher — only shown when Design Tools (Business) is available. */}
        {hasTools ? (
          <div className="flex items-center gap-1 fp-panel-raised border fp-line-soft rounded-lg p-1 shrink-0">
            <button
              onClick={() => setWorld("landing")}
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${world === "landing" ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
            >
              <Monitor size={13} /> Landing
            </button>
            <button
              onClick={() => setWorld("dashboard")}
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${world === "dashboard" ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
            >
              <LayoutDashboard size={13} /> Dashboard
            </button>
          </div>
        ) : (
          <span />
        )}

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
        <div className="overflow-y-auto border-r fp-line-soft p-5">
         {world === "landing" ? (
          <div className="space-y-6">
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
            <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Platform focus</p>
            <p className="fp-text-faint text-[11px] mb-2">Make this a single-platform panel — its landing + storefront theme for that platform and show only its services. Switch back to “All platforms” anytime.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => set({ platformFocus: null })} className={`text-xs px-3 py-1.5 rounded-lg border ${!v.platformFocus ? "fp-gold-border fp-gold-soft-bg fp-gold" : "fp-line-soft fp-panel-raised fp-text-dim hover:fp-text"}`}>All platforms</button>
              {PLATFORM_FOCUS_OPTIONS.map((o) => (
                <button key={o.key} type="button" onClick={() => set({ platformFocus: o.key })} className={`text-xs px-3 py-1.5 rounded-lg border ${v.platformFocus === o.key ? "fp-gold-border fp-gold-soft-bg fp-gold" : "fp-line-soft fp-panel-raised fp-text-dim hover:fp-text"}`}>{o.label} only</button>
              ))}
            </div>
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
              {FREE_THEMES.map((t) => (
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
            <p className="fp-text-faint text-xs fp-mono uppercase mb-1">More color themes · included</p>
            <p className="fp-text-faint text-[11px] mb-3">Extra palettes, free with every panel — click to apply (landing + dashboard).</p>
            <div className="space-y-2">
              {PREMIUM_THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => set({ theme: t.id })}
                  className={`w-full flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors ${v.theme === t.id ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised hover:fp-gold-border"}`}
                >
                  <span className="flex items-center gap-2.5 text-left min-w-0">
                    <span className="flex gap-1 shrink-0">
                      <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: t.a }} />
                      <span className="w-3.5 h-3.5 rounded-full border border-black/20" style={{ background: t.b }} />
                    </span>
                    <span className="min-w-0">
                      <span className="text-sm block">{t.label}</span>
                      <span className="fp-text-faint text-[11px] block truncate">{t.note}</span>
                    </span>
                  </span>
                  <span className={`text-[10px] shrink-0 ${v.theme === t.id ? "fp-gold" : "fp-text-faint"}`}>{v.theme === t.id ? "Applied" : "Apply"}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="fp-text-faint text-xs fp-mono uppercase mb-1 flex items-center gap-1.5"><Gem size={12} className="fp-gold" /> Design Shop</p>
            <p className="fp-text-faint text-[11px] leading-relaxed mb-3">
              A marketplace of <span className="fp-text">complete, professionally designed landing pages</span> — distinct layouts,
              artwork and animation, each with a full live preview, bought once and yours forever.
            </p>
            <a
              href="/design-shop"
              target="_blank"
              rel="noreferrer"
              className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1.5 mb-4"
            >
              <Gem size={13} /> Browse the Design Shop
            </a>
            <DesignLibraryPanel panelId={panel.id} onChanged={loadActiveDesign} />
          </section>

          {hasTools ? (
            <section>
              <p className="fp-text-faint text-xs fp-mono uppercase mb-1 flex items-center gap-1.5"><Layers size={12} className="fp-gold" /> Visual editor · design tools</p>
              <p className="fp-text-faint text-[11px] leading-relaxed mb-3">
                Build your <span className="fp-text">own</span> landing from scratch — add sections, edit copy, set
                colours, publish.
              </p>
              <button onClick={() => setShowEditor(true)} className="fp-panel-raised border fp-gold-border rounded-lg px-3 py-2 text-xs fp-gold inline-flex items-center gap-1.5">
                <Layers size={13} /> Open the visual editor
              </button>
            </section>
          ) : (
            <section>
              <p className="fp-text-faint text-xs fp-mono uppercase mb-1 flex items-center gap-1.5"><Layers size={12} className="fp-gold" /> Design tools · coming soon</p>
              <div className="fp-panel-raised border fp-line-soft rounded-lg p-3">
                <p className="fp-text-dim text-[11px] leading-relaxed">
                  A full no-code editor for your storefront is on the way — rearrange <span className="fp-text">navs
                  and sections</span>, switch to a hamburger/dropdown layout, place components, and design your own
                  landing. We&apos;re building it properly before release. For now, use the colour themes and the
                  Design Shop above.
                </p>
              </div>
            </section>
          )}
          </div>
         ) : (
          <div className="space-y-6">
            <section>
              <p className="fp-text-faint text-xs fp-mono uppercase mb-1">Dashboard layout · design tools</p>
              <p className="fp-text-faint text-[11px] leading-relaxed mb-3">
                Rearrange and show/hide the widgets on your customers&apos; dashboard home. Colours follow the theme
                you pick on the <span className="fp-text">Landing</span> tab — this world is about layout.
              </p>
              <DashboardLayoutBuilder panelId={panel.id} onLayoutChange={setDashPreview} />
            </section>
          </div>
         )}
        </div>

        {/* Live preview — its own view per world */}
        <div className="overflow-y-auto p-6" style={{ background: "var(--void-2)" }}>
          <p className="fp-text-faint text-xs fp-mono uppercase mb-3 text-center">
            {world === "landing" ? "Landing preview" : "Customer dashboard preview"}
          </p>

          {world === "landing" ? (
            <>
              <div style={preview} className="mx-auto max-w-3xl rounded-2xl overflow-hidden border fp-line shadow-2xl">
                {/* Landing — the ACTIVE purchased design when there is one, else the Innvil default. */}
                {previewPkg ? (
                  <DesignRenderer
                    pkg={previewPkg}
                    data={{
                      panelName: v.name || previewPkg.preview.panelName,
                      logoUrl: v.logoUrl || undefined,
                      services: previewPkg.preview.services,
                      categories: previewPkg.preview.categories,
                      currencySymbol: currencySymbol(currency),
                    }}
                    tokenOverrides={themeToDesignTokens(v.theme, v.accent)}
                    inert
                  />
                ) : (
                  <div className="fp-root p-6" style={{ background: "var(--void)" }}>
                    <div className="flex items-center gap-2 mb-6">
                      {v.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover" />
                      ) : (
                        <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={15} />
                      )}
                      <span className="fp-display text-lg">{v.name || "Your panel"}</span>
                    </div>
                    <h1 className="fp-display text-2xl mb-2 leading-tight">{v.headline || focusPack?.landing.headline || "Grow every platform from one wallet."}</h1>
                    <p className="fp-text-dim text-sm mb-4">{v.description || focusPack?.landing.description || "Instant delivery, transparent pricing, and one balance for all your social growth."}</p>
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
                )}
              </div>
              <p className="fp-text-faint text-[11px] text-center mt-3">
                {activePkg
                  ? `Shown with your active design (${activePkg.meta.name}). Pick a colour theme to recolour it — the design keeps its layout, type and animation.`
                  : "Colour themes style the landing + dashboard. Buy a Design Shop design to replace the landing entirely."}
              </p>
            </>
          ) : (
            <>
              {/* Customer dashboard — palette follows the active design (or the colour theme). */}
              <div
                style={activePkg ? (designToThemeVars(activePkg.tokens, themeToDesignTokens(v.theme, v.accent)) as React.CSSProperties) : preview}
                className="fp-root mx-auto max-w-3xl rounded-2xl overflow-hidden border fp-line shadow-2xl"
              >
                {/* Dashboard header */}
                <div className="p-4 flex items-center justify-between" style={{ background: "var(--void-2)" }}>
                  <div className="flex items-center gap-2">
                    {v.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.logoUrl} alt="" className="w-7 h-7 rounded-md object-cover" />
                    ) : (
                      <DefaultLogo className="w-7 h-7 rounded-md" iconSize={13} />
                    )}
                    <span className="fp-display">{v.name || "Your panel"}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="fp-mono text-xs fp-panel-raised border fp-line-soft rounded-lg px-3 py-2"><span className="fp-gold">{formatMoney(24.6, currency)}</span></span>
                    <button className="fp-btn-primary text-xs font-semibold px-3 py-2 rounded-lg">Add Funds</button>
                  </div>
                </div>
                {/* Customer-dashboard home — reflects the Dashboard layout builder live. */}
                <DashboardHomePreview layout={dashPreview} panelName={v.name} />
              </div>
              <p className="fp-text-faint text-[11px] text-center mt-3">
                This is your customers&apos; dashboard home. Rearrange the widgets on the left; colours follow your
                {activePkg ? " active design" : " colour theme"}.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
