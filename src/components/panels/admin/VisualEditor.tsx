"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  X, Save, UploadCloud, Monitor, Tablet, Smartphone, ArrowUp, ArrowDown, Trash2, Plus,
  RotateCcw, CheckCircle2, AlertTriangle, Lock, Layers,
} from "lucide-react";
import { DesignRenderer } from "@/src/components/design/DesignRenderer";
import {
  makeSection, editorToPackage, SECTION_LABELS, EDITOR_SECTION_KINDS,
  EDITOR_DEFAULT_TOKENS, type EditorDesign, type EditorSectionKind,
} from "@/src/lib/design/editor";
import type { DesignSection } from "@/src/lib/design/schema";
import {
  getCustomDesign, saveCustomDesignDraft, publishCustomDesign, unpublishCustomDesign, resetCustomDesign,
} from "@/src/lib/actions/design";

/* =========================================================
   VISUAL EDITOR (Phase 1) — a config-driven interface editor for the panel's
   landing. Owners compose from an approved component library, reorder, edit copy
   and set global colours; a live canvas renders the SAME DesignRenderer the
   storefront uses. Presentation only — functional sections stay backend-wired.
   ========================================================= */

type Device = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "834px", mobile: "390px" };

// String fields we expose per section type in the settings panel.
const TEXT_FIELDS: Partial<Record<DesignSection["type"], Array<{ key: string; label: string; area?: boolean }>>> = {
  hero: [
    { key: "eyebrow", label: "Eyebrow" },
    { key: "headline", label: "Headline" },
    { key: "headlineAccent", label: "Headline accent" },
    { key: "sub", label: "Subtext", area: true },
  ],
  stats: [{ key: "heading", label: "Heading" }],
  services: [{ key: "heading", label: "Heading" }, { key: "sub", label: "Subtext", area: true }],
  platforms: [{ key: "heading", label: "Heading" }, { key: "sub", label: "Subtext", area: true }],
  steps: [{ key: "heading", label: "Heading" }],
  features: [{ key: "heading", label: "Heading" }, { key: "sub", label: "Subtext", area: true }],
  testimonials: [{ key: "heading", label: "Heading" }],
  faq: [{ key: "heading", label: "Heading" }],
  cta: [{ key: "heading", label: "Heading" }, { key: "sub", label: "Subtext", area: true }],
  content: [{ key: "heading", label: "Heading" }, { key: "body", label: "Body", area: true }],
  functional: [{ key: "heading", label: "Heading" }, { key: "sub", label: "Subtext", area: true }],
};

const LIST_SECTIONS = new Set<DesignSection["type"]>(["steps", "features", "testimonials", "faq"]);

export function VisualEditor({
  panel,
  onClose,
}: {
  panel: { id: string; name: string; subdomain: string; currency?: string };
  onClose: () => void;
}) {
  const [design, setDesign] = useState<EditorDesign | null>(null);
  const [entitled, setEntitled] = useState<boolean | null>(null);
  const [hasPublished, setHasPublished] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const [busy, setBusy] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    getCustomDesign(panel.id)
      .then((info) => {
        if (!info) { setEntitled(false); return; }
        setEntitled(info.hasDesignTools);
        setDesign(info.draft);
        setHasPublished(info.hasPublished);
        setSelectedId(info.draft.page.sections[0]?.id ?? null);
      })
      .catch(() => setEntitled(false));
  }, [panel.id]);

  const sections = design?.page.sections ?? [];
  const selected = sections.find((s) => s.id === selectedId) ?? null;

  const patchDesign = (fn: (d: EditorDesign) => EditorDesign) => setDesign((d) => (d ? fn(d) : d));
  const setSections = (next: DesignSection[]) =>
    patchDesign((d) => ({ ...d, page: { ...d.page, sections: next } }));

  const updateSection = (id: string, patch: Record<string, unknown>) =>
    setSections(sections.map((s) => (s.id === id ? ({ ...s, ...patch } as unknown as DesignSection) : s)));

  const moveSection = (id: string, dir: -1 | 1) => {
    const i = sections.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sections.length) return;
    const next = sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };

  const removeSection = (id: string) => {
    const next = sections.filter((s) => s.id !== id);
    setSections(next);
    if (selectedId === id) setSelectedId(next[0]?.id ?? null);
  };

  const addSection = (kind: EditorSectionKind) => {
    const s = makeSection(kind);
    setSections([...sections, s]);
    setSelectedId(s.id);
    setAddOpen(false);
  };

  const setToken = (key: "accent" | "bg", value: string) =>
    patchDesign((d) => ({ ...d, tokens: { ...d.tokens, [key]: value } }));

  const save = async () => {
    if (!design) return;
    setBusy("save"); setMsg(null);
    const res = await saveCustomDesignDraft(panel.id, design);
    setBusy(null);
    setMsg(res.ok ? { text: "Draft saved." } : { text: res.error, error: true });
  };

  const publish = async () => {
    if (!design) return;
    setBusy("publish"); setMsg(null);
    // Save the latest draft first so publish snapshots exactly what's on screen.
    const saved = await saveCustomDesignDraft(panel.id, design);
    if (!saved.ok) { setBusy(null); setMsg({ text: saved.error, error: true }); return; }
    const res = await publishCustomDesign(panel.id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setHasPublished(true);
    setMsg({ text: "Published — your storefront now shows this design." });
  };

  const unpublish = async () => {
    setBusy("unpublish"); setMsg(null);
    const res = await unpublishCustomDesign(panel.id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setHasPublished(false);
    setMsg({ text: "Unpublished — the storefront reverts to its previous landing." });
  };

  const reset = async () => {
    setBusy("reset"); setMsg(null);
    const res = await resetCustomDesign(panel.id);
    setBusy(null);
    if (!res.ok) { setMsg({ text: res.error, error: true }); return; }
    setDesign(res.data);
    setSelectedId(res.data.page.sections[0]?.id ?? null);
    setMsg({ text: "Reset to a fresh starter design." });
  };

  const pkg = useMemo(() => (design ? editorToPackage(design, panel.name) : null), [design, panel.name]);

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-2 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="fixed inset-0 z-[60] fp-root flex flex-col" style={{ background: "var(--void)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b fp-line-soft shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-8 h-8 rounded-lg fp-gold-soft-bg fp-gold flex items-center justify-center shrink-0"><Layers size={16} /></span>
          <div className="min-w-0">
            <p className="fp-display text-lg leading-none">Visual editor</p>
            <p className="fp-text-faint text-xs truncate">{panel.name} · landing page</p>
          </div>
        </div>

        <div className="flex items-center gap-1 fp-panel-raised border fp-line-soft rounded-lg p-1 shrink-0">
          {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([k, Icon]) => (
            <button key={k} onClick={() => setDevice(k)} aria-label={k}
              className={`p-1.5 rounded ${device === k ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}>
              <Icon size={15} />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {msg && <span className={`text-xs hidden sm:inline ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.text}</span>}
          {entitled && (
            <>
              <button onClick={save} disabled={busy !== null} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-xs fp-text-dim hover:fp-text disabled:opacity-50 flex items-center gap-1.5">
                <Save size={13} /> {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              {hasPublished ? (
                <button onClick={unpublish} disabled={busy !== null} className="fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-xs fp-text-dim hover:fp-text disabled:opacity-50">
                  {busy === "unpublish" ? "…" : "Unpublish"}
                </button>
              ) : null}
              <button onClick={publish} disabled={busy !== null} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 flex items-center gap-1.5">
                <UploadCloud size={13} /> {busy === "publish" ? "Publishing…" : "Publish"}
              </button>
            </>
          )}
          <button onClick={onClose} className="fp-panel-raised border fp-line-soft rounded-lg p-2 fp-text-dim hover:fp-text"><X size={16} /></button>
        </div>
      </div>

      {entitled === null ? (
        <div className="flex-1 grid place-items-center"><p className="fp-text-faint text-sm">Loading…</p></div>
      ) : !entitled ? (
        <div className="flex-1 grid place-items-center px-6">
          <div className="text-center max-w-md">
            <span className="w-12 h-12 rounded-xl fp-gold-soft-bg fp-gold grid place-items-center mx-auto mb-4"><Lock size={20} /></span>
            <h2 className="fp-display text-xl mb-2">The visual editor is a Business feature</h2>
            <p className="fp-text-dim text-sm">Design your own landing page — drag in sections, edit copy, set colours, publish. Included with the <span className="fp-gold">Innvil Business</span> plan. <span className="fp-text">Plans are coming soon.</span></p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid lg:grid-cols-[340px_1fr]">
          {/* Left: layers + library + settings */}
          <div className="overflow-y-auto border-r fp-line-soft p-4 space-y-5">
            {/* Layers */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="fp-text-faint text-xs fp-mono uppercase">Sections</p>
                <div className="relative">
                  <button onClick={() => setAddOpen((o) => !o)} className="fp-panel-raised border fp-line-soft rounded-lg px-2 py-1 text-xs fp-text-dim hover:fp-text flex items-center gap-1"><Plus size={12} /> Add</button>
                  {addOpen && (
                    <div className="absolute right-0 mt-1 z-10 w-44 fp-panel border fp-line rounded-lg shadow-2xl p-1 max-h-72 overflow-y-auto">
                      {EDITOR_SECTION_KINDS.map((k) => (
                        <button key={k} onClick={() => addSection(k)} className="w-full text-left text-xs px-2.5 py-1.5 rounded-md fp-text-dim hover:fp-text hover:fp-gold-soft-bg">
                          {SECTION_LABELS[k]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                {sections.map((s, i) => (
                  <div key={s.id}
                    className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 ${selectedId === s.id ? "fp-gold-border fp-gold-soft-bg" : "fp-line-soft fp-panel-raised"}`}>
                    <button onClick={() => setSelectedId(s.id)} className="flex-1 text-left text-xs truncate">
                      {SECTION_LABELS[s.type as EditorSectionKind] ?? s.type}
                    </button>
                    <button onClick={() => moveSection(s.id, -1)} disabled={i === 0} className="fp-text-faint hover:fp-text disabled:opacity-30 p-0.5"><ArrowUp size={13} /></button>
                    <button onClick={() => moveSection(s.id, 1)} disabled={i === sections.length - 1} className="fp-text-faint hover:fp-text disabled:opacity-30 p-0.5"><ArrowDown size={13} /></button>
                    <button onClick={() => removeSection(s.id)} className="fp-text-faint hover:text-red-400 p-0.5"><Trash2 size={12} /></button>
                  </div>
                ))}
                {sections.length === 0 && <p className="fp-text-faint text-[11px]">No sections — add one above.</p>}
              </div>
            </section>

            {/* Selected section settings */}
            {selected && (
              <section>
                <p className="fp-text-faint text-xs fp-mono uppercase mb-2">
                  {SECTION_LABELS[selected.type as EditorSectionKind] ?? selected.type} settings
                </p>
                <div className="space-y-2.5">
                  {(TEXT_FIELDS[selected.type] ?? []).map((f) => {
                    const val = String((selected as unknown as Record<string, unknown>)[f.key] ?? "");
                    return (
                      <label key={f.key} className="block">
                        <span className="fp-text-dim text-[11px]">{f.label}</span>
                        {f.area ? (
                          <textarea value={val} rows={2} onChange={(e) => updateSection(selected.id, { [f.key]: e.target.value })} className={`${inputCls} mt-1`} />
                        ) : (
                          <input value={val} onChange={(e) => updateSection(selected.id, { [f.key]: e.target.value })} className={`${inputCls} mt-1`} />
                        )}
                      </label>
                    );
                  })}
                  {selected.type === "services" && (
                    <label className="flex items-center gap-2 text-xs fp-text-dim">
                      <input type="checkbox" checked={(selected as { showPrices?: boolean }).showPrices !== false}
                        onChange={(e) => updateSection(selected.id, { showPrices: e.target.checked })} />
                      Show prices
                    </label>
                  )}
                  {LIST_SECTIONS.has(selected.type) && (
                    <p className="fp-text-faint text-[11px] leading-relaxed">Editing individual items (steps, features, reviews, questions) comes next — for now this section uses its default items.</p>
                  )}
                </div>
              </section>
            )}

            {/* Global colours */}
            <section>
              <p className="fp-text-faint text-xs fp-mono uppercase mb-2">Colours</p>
              {([["accent", "Accent"], ["bg", "Background"]] as const).map(([key, label]) => {
                const current = design?.tokens[key] ?? EDITOR_DEFAULT_TOKENS[key];
                return (
                  <label key={key} className="flex items-center gap-2 mb-2">
                    <input type="color" value={/^#[0-9a-f]{6}$/i.test(current) ? current : (key === "accent" ? "#C9A574" : "#0A0B0F")}
                      onChange={(e) => setToken(key, e.target.value)} className="w-8 h-8 rounded-lg bg-transparent border fp-line-soft cursor-pointer p-0.5 shrink-0" />
                    <span className="fp-text-dim text-xs w-24">{label}</span>
                    <input value={current} onChange={(e) => setToken(key, e.target.value)} className={`${inputCls} fp-mono`} />
                  </label>
                );
              })}
              <button onClick={reset} disabled={busy !== null} className="mt-2 text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-1.5 hover:fp-text flex items-center gap-1.5 disabled:opacity-50">
                <RotateCcw size={12} /> Reset design
              </button>
            </section>

            <p className="fp-text-faint text-[11px] leading-relaxed border-t fp-line-soft pt-3">
              {msg && <span className={`flex items-center gap-1.5 mb-2 ${msg.error ? "text-red-400" : "fp-safe"}`}>{msg.error ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />} {msg.text}</span>}
              Functional blocks (sign-up, service list) stay wired to your real backend — the editor only changes how they look and where they sit.
            </p>
          </div>

          {/* Right: live canvas */}
          <div className="overflow-auto p-6" style={{ background: "var(--void-2)" }}>
            {pkg && (
              <div className="mx-auto transition-all rounded-2xl overflow-hidden border fp-line shadow-2xl"
                style={{ width: WIDTHS[device], maxWidth: "100%" }}>
                <DesignRenderer
                  pkg={pkg}
                  page="landing"
                  data={{
                    panelName: panel.name,
                    services: pkg.preview.services,
                    categories: pkg.preview.categories,
                    currencySymbol: "$",
                    liveStats: {
                      services: String(pkg.preview.services.length * 40),
                      platforms: String(new Set(pkg.preview.services.map((s) => s.platform)).size),
                      from: `$${Math.min(...pkg.preview.services.map((s) => Number(s.price) || 99)).toFixed(2)}`,
                    },
                  }}
                  inert
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
