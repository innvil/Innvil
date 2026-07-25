"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Eye, Lock, CheckCircle2, Palette } from "lucide-react";
import type { DesignMeta, DesignStyleCategory } from "@/src/lib/design/schema";

/* Design Shop marketplace — browse complete landing designs. One design is finished
   and published at a time; the rest are honest "Available soon" teasers. */

const FILTERS: Array<{ k: DesignStyleCategory | "all"; label: string }> = [
  { k: "all", label: "All" },
  { k: "social-growth", label: "Social growth" },
  { k: "creator-economy", label: "Creator economy" },
  { k: "dark", label: "Dark" },
  { k: "minimal", label: "Minimal" },
  { k: "agency", label: "Agency" },
  { k: "futuristic", label: "Futuristic" },
  { k: "corporate", label: "Corporate" },
  { k: "colorful", label: "Colorful" },
  { k: "animated", label: "Animated" },
  { k: "conversion", label: "Conversion" },
];

export function DesignShop({ cards }: { cards: DesignMeta[] }) {
  const [filter, setFilter] = useState<DesignStyleCategory | "all">("all");
  const list = filter === "all" ? cards : cards.filter((c) => c.categories.includes(filter));

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <div className="mb-8">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3 flex items-center gap-1.5">
          <Palette size={12} className="fp-gold" /> Design Shop
        </p>
        <h1 className="fp-display text-3xl md:text-4xl">Complete landing designs for your panel.</h1>
        <p className="fp-text-dim text-sm mt-3 max-w-2xl leading-relaxed">
          Not colour presets — full landing experiences with their own layout, artwork, animation and
          responsive behaviour. Buy one once and it&apos;s yours forever: activate it, switch between the designs
          you own, and edit its text and permitted styles. Every published design has a complete live preview.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f.k ? "fp-gold-border fp-gold-soft-bg fp-gold" : "fp-line-soft fp-panel-raised fp-text-dim hover:fp-text"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="fp-text-faint text-sm py-16 text-center">No designs in this category yet — more are on the way.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {list.map((d) => {
            const soon = d.status === "coming_soon";
            return (
              <div key={d.id} className={`fp-panel border rounded-2xl overflow-hidden flex flex-col ${soon ? "fp-line" : "fp-gold-border"}`}>
                {/* Cover */}
                <div className="relative h-44" style={{ background: d.cover.background }}>
                  <div className="absolute inset-0 flex items-end justify-between p-4">
                    <span className="fp-display text-2xl text-white drop-shadow">{d.name}</span>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={soon ? { background: "rgba(0,0,0,.45)", color: "#fff" } : { background: d.cover.accent, color: "#0A0B0F" }}
                    >
                      {soon ? "Available soon" : `$${d.price} once`}
                    </span>
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col">
                  <p className="text-sm font-medium">{d.tagline}</p>
                  <p className="fp-text-dim text-sm mt-1.5 leading-relaxed flex-1">{d.description}</p>

                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {d.categories.slice(0, 4).map((c) => (
                      <span key={c} className="text-[10px] fp-text-faint fp-panel-raised border fp-line-soft rounded-full px-2 py-0.5">{c}</span>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-4 text-[11px] fp-text-faint fp-mono">
                    <span>Pages: {d.includedPages.length}</span>
                    <span>v{d.version}</span>
                    <span>{d.responsive ? "Responsive" : "Fixed"}</span>
                    <span>{d.animated ? "Animated" : "Static"}</span>
                  </div>

                  {d.features.length > 0 && (
                    <ul className="mt-4 space-y-1">
                      {d.features.slice(0, 3).map((f) => (
                        <li key={f} className="fp-text-dim text-xs flex items-center gap-1.5">
                          <CheckCircle2 size={11} className="fp-safe shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 mt-5">
                    {soon ? (
                      <>
                        <button disabled className="text-xs fp-text-faint border fp-line-soft rounded-lg px-3 py-2 flex items-center gap-1.5 cursor-not-allowed">
                          <Lock size={12} /> In the studio
                        </button>
                        <span className="fp-text-faint text-[11px]">Planned ${d.price}</span>
                      </>
                    ) : (
                      <>
                        <Link href={`/design-preview/${d.id}`} className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
                          <Eye size={13} /> Live preview
                        </Link>
                        <button disabled className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 cursor-not-allowed" title="Purchasing arrives with the Design Shop launch">
                          Buy ${d.price}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="fp-text-faint text-xs mt-10 text-center">
        We publish one design at a time — each gets a full build and a complete live preview before it goes on sale.
      </p>
    </div>
  );
}
