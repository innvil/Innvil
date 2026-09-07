"use client";

import React, { useState } from "react";
import { Plus, Trash2, Save, X, AlertTriangle } from "lucide-react";
import { updatePostBody, type AdminBlogPost } from "@/src/lib/actions/blog-admin";
import type { BlogBlock, BlogSection } from "@/src/data/blog-posts";

/* Edit the article BODY — lead intro, sections (h2 + blocks: paragraph / sub-heading /
   bullet / numbered / quote), and the closing CTA. Super-admin only (gated server-side). */

const BLOCK_KINDS: Array<{ kind: BlogBlock["kind"]; label: string }> = [
  { kind: "p", label: "Paragraph" },
  { kind: "h3", label: "Sub-heading" },
  { kind: "ul", label: "Bullet list" },
  { kind: "ol", label: "Numbered list" },
  { kind: "quote", label: "Quote" },
];

function newBlock(kind: BlogBlock["kind"]): BlogBlock {
  return kind === "ul" || kind === "ol" ? { kind, items: [""] } : { kind, text: "" };
}

export function BlogBodyEditor({ post, onClose, onSaved }: { post: AdminBlogPost; onClose: () => void; onSaved: () => void }) {
  const [intro, setIntro] = useState(post.intro ?? "");
  const [sections, setSections] = useState<BlogSection[]>(() => JSON.parse(JSON.stringify(post.sections ?? [])));
  const [ctaHeading, setCtaHeading] = useState(post.cta?.heading ?? "");
  const [ctaText, setCtaText] = useState(post.cta?.text ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-2.5 py-2 text-sm outline-none focus:fp-gold-border";

  const patchSection = (i: number, patch: Partial<BlogSection>) =>
    setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, ...patch } : sec)));
  const patchBlock = (si: number, bi: number, block: BlogBlock) =>
    setSections((s) => s.map((sec, idx) => (idx === si ? { ...sec, blocks: sec.blocks.map((b, j) => (j === bi ? block : b)) } : sec)));
  const removeBlock = (si: number, bi: number) =>
    setSections((s) => s.map((sec, idx) => (idx === si ? { ...sec, blocks: sec.blocks.filter((_, j) => j !== bi) } : sec)));
  const addBlock = (si: number, kind: BlogBlock["kind"]) =>
    setSections((s) => s.map((sec, idx) => (idx === si ? { ...sec, blocks: [...sec.blocks, newBlock(kind)] } : sec)));

  const save = async () => {
    setBusy(true); setErr(null);
    const res = await updatePostBody(post.id, {
      intro,
      sections,
      cta: ctaHeading.trim() ? { heading: ctaHeading, text: ctaText } : null,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    onSaved();
  };

  return (
    <div className="fp-panel border fp-gold-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Edit body — {post.title}</p>
        <button onClick={onClose} className="fp-panel-raised border fp-line-soft rounded-lg p-1.5 fp-text-dim hover:fp-text"><X size={15} /></button>
      </div>

      <label className="block">
        <span className="fp-text-dim text-[11px]">Intro (lead paragraph)</span>
        <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} className={`${inputCls} mt-1`} />
      </label>

      <div className="space-y-3">
        {sections.map((sec, si) => (
          <div key={si} className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={sec.h2} onChange={(e) => patchSection(si, { h2: e.target.value })} placeholder="Section heading (H2)" className={`${inputCls} font-medium`} />
              <button onClick={() => setSections((s) => s.filter((_, i) => i !== si))} className="fp-text-faint hover:text-red-400 p-1.5 shrink-0"><Trash2 size={14} /></button>
            </div>

            {sec.blocks.map((b, bi) => (
              <div key={bi} className="flex items-start gap-2">
                <span className="fp-text-faint text-[10px] fp-mono uppercase w-14 shrink-0 pt-2">{b.kind}</span>
                {b.kind === "ul" || b.kind === "ol" ? (
                  <textarea
                    value={(b.items ?? []).join("\n")}
                    onChange={(e) => patchBlock(si, bi, { kind: b.kind, items: e.target.value.split("\n") })}
                    rows={Math.max(2, (b.items ?? []).length)}
                    placeholder="One item per line"
                    className={`${inputCls} font-mono`}
                  />
                ) : (
                  <textarea
                    value={(b as { text: string }).text}
                    onChange={(e) => patchBlock(si, bi, { kind: b.kind, text: e.target.value } as BlogBlock)}
                    rows={b.kind === "h3" ? 1 : 2}
                    className={inputCls}
                  />
                )}
                <button onClick={() => removeBlock(si, bi)} className="fp-text-faint hover:text-red-400 p-1.5 shrink-0"><Trash2 size={13} /></button>
              </div>
            ))}

            <div className="flex flex-wrap gap-1.5">
              {BLOCK_KINDS.map((k) => (
                <button key={k.kind} onClick={() => addBlock(si, k.kind)} className="text-[11px] fp-text-dim border fp-line-soft rounded-lg px-2 py-1 hover:fp-text flex items-center gap-1"><Plus size={10} /> {k.label}</button>
              ))}
            </div>
          </div>
        ))}
        <button onClick={() => setSections((s) => [...s, { h2: "", blocks: [] }])} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 hover:fp-text flex items-center gap-1.5"><Plus size={13} /> Add section</button>
      </div>

      <div className="fp-panel-raised border fp-line-soft rounded-xl p-3 space-y-2">
        <p className="fp-text-faint text-[11px] fp-mono uppercase">Closing CTA (optional)</p>
        <input value={ctaHeading} onChange={(e) => setCtaHeading(e.target.value)} placeholder="CTA heading" className={inputCls} />
        <textarea value={ctaText} onChange={(e) => setCtaText(e.target.value)} rows={2} placeholder="CTA text" className={inputCls} />
      </div>

      {err && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="text-sm fp-text-dim border fp-line-soft rounded-lg px-4 py-2 hover:fp-text">Cancel</button>
        <button onClick={save} disabled={busy} className="fp-btn-primary text-sm font-semibold px-5 py-2 rounded-lg disabled:opacity-60 flex items-center gap-2"><Save size={15} /> {busy ? "Saving…" : "Save body"}</button>
      </div>
    </div>
  );
}
