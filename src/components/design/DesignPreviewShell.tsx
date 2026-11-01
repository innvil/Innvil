"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Monitor, Tablet, Smartphone, ArrowLeft, Lock, Sliders } from "lucide-react";
import { DesignRenderer } from "./DesignRenderer";
import type { DesignPackage, PreviewPersonalization } from "@/src/lib/design/schema";

/* =========================================================
   FULL LIVE PREVIEW environment for a marketplace design.
   Renders the REAL design via the SAME renderer + config used after purchase (never a
   mockup or screenshot), with demo content, working desktop/tablet/mobile modes and
   optional temporary personalization. Purchase-guarded: interaction is allowed, but
   links are inert and nothing here activates, installs or exports the design.
   ========================================================= */

type Viewport = "desktop" | "tablet" | "mobile";
const WIDTHS: Record<Viewport, string> = { desktop: "100%", tablet: "834px", mobile: "390px" };

export function DesignPreviewShell({ pkg }: { pkg: DesignPackage }) {
  const [vp, setVp] = useState<Viewport>("desktop");
  const [panelOpen, setPanelOpen] = useState(false);
  const [p, setP] = useState<PreviewPersonalization>({});

  const data = {
    panelName: pkg.preview.panelName,
    services: pkg.preview.services,
    categories: pkg.preview.categories,
    currencySymbol: "$",
    liveStats: {
      services: String(pkg.preview.services.length * 40),
      platforms: String(new Set(pkg.preview.services.map((s) => s.platform)).size),
      from: `$${Math.min(...pkg.preview.services.map((s) => Number(s.price) || 99)).toFixed(2)}`,
    },
  };

  const inputCls = "w-full fp-panel-raised border fp-line-soft rounded-lg px-3 py-2 text-sm outline-none focus:fp-gold-border";

  return (
    <div className="fp-root min-h-screen flex flex-col">
      {/* Preview chrome (Innvil UI, not part of the design) */}
      <div className="border-b fp-line-soft px-4 py-3 flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/design-shop" className="fp-text-dim hover:fp-text flex items-center gap-1.5 text-sm shrink-0">
            <ArrowLeft size={15} /> Design Shop
          </Link>
          <div className="min-w-0">
            <p className="fp-display text-base leading-none truncate">{pkg.meta.name}</p>
            <p className="fp-text-faint text-[11px] truncate">{pkg.meta.tagline} · ${pkg.meta.price} one-time</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 fp-panel-raised border fp-line-soft rounded-lg p-1">
            {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([k, Icon]) => (
              <button
                key={k}
                onClick={() => setVp(k)}
                aria-label={k}
                className={`p-1.5 rounded ${vp === k ? "fp-gold-soft-bg fp-gold" : "fp-text-dim hover:fp-text"}`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className={`text-xs border fp-line-soft rounded-lg px-3 py-2 flex items-center gap-1.5 ${panelOpen ? "fp-gold" : "fp-text-dim hover:fp-text"}`}
          >
            <Sliders size={13} /> Try it with your brand
          </button>
          <button disabled className="fp-btn-primary text-xs font-semibold px-4 py-2 rounded-lg opacity-60 cursor-not-allowed flex items-center gap-1.5" title="Purchasing arrives with the Design Shop launch">
            <Lock size={12} /> Buy ${pkg.meta.price}
          </button>
        </div>
      </div>

      {/* Temporary personalization — preview only, never installs anything */}
      {panelOpen && (
        <div className="border-b fp-line-soft px-4 py-3 grid sm:grid-cols-4 gap-3 shrink-0">
          <label className="block">
            <span className="fp-text-faint text-[11px] fp-mono uppercase">Panel name</span>
            <input value={p.panelName ?? ""} onChange={(e) => setP((s) => ({ ...s, panelName: e.target.value }))} placeholder={pkg.preview.panelName} className={inputCls} />
          </label>
          <label className="block">
            <span className="fp-text-faint text-[11px] fp-mono uppercase">Logo URL</span>
            <input value={p.logoUrl ?? ""} onChange={(e) => setP((s) => ({ ...s, logoUrl: e.target.value }))} placeholder="https://…/logo.png" className={`${inputCls} fp-mono`} />
          </label>
          <label className="block">
            <span className="fp-text-faint text-[11px] fp-mono uppercase">Accent</span>
            <span className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(p.accent ?? "") ? p.accent : pkg.tokens.accent} onChange={(e) => setP((s) => ({ ...s, accent: e.target.value }))} className="w-9 h-9 rounded-lg bg-transparent border fp-line-soft cursor-pointer p-0.5 shrink-0" />
              <input value={p.accent ?? ""} onChange={(e) => setP((s) => ({ ...s, accent: e.target.value }))} placeholder={pkg.tokens.accent} className={`${inputCls} fp-mono`} />
            </span>
          </label>
          <div className="flex items-end">
            <button onClick={() => setP({})} className="text-xs fp-text-dim border fp-line-soft rounded-lg px-3 py-2 hover:fp-text">Reset preview</button>
          </div>
          <p className="fp-text-faint text-[11px] sm:col-span-4">These only change this preview — nothing is installed or unlocked.</p>
        </div>
      )}

      {/* The real design, at the chosen viewport */}
      <div className="flex-1 overflow-auto" style={{ background: "var(--void-2)" }}>
        <div
          className="mx-auto transition-all"
          style={{ width: WIDTHS[vp], maxWidth: "100%", boxShadow: vp === "desktop" ? undefined : "0 0 0 1px var(--line), 0 30px 80px -30px rgba(0,0,0,.7)" }}
        >
          <DesignRenderer pkg={pkg} page="landing" data={data} personalization={p} inert />
        </div>
      </div>

      <div className="border-t fp-line-soft px-4 py-2 shrink-0">
        <p className="fp-text-faint text-[11px] text-center">
          Live preview · demo content · buttons are disabled here. Version {pkg.meta.version} · {pkg.meta.publisher}
        </p>
      </div>
    </div>
  );
}
