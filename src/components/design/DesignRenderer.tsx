"use client";

import React from "react";
import { PlatformGlyph } from "@/src/components/customer/PlatformIcons";
import {
  tokensToCssVars, personalizeTokens, getPage,
  type DesignPackage, type DesignPage, type DesignPageId, type DesignSection, type DesignCta, type DesignTokens,
  type PreviewPersonalization, type HeroSection, type StatsSection, type ServicesSection,
  type PlatformsSection, type StepsSection, type FeaturesSection, type TestimonialsSection,
  type FaqSection, type CtaSection, type FunctionalSection, type ContentSection,
} from "@/src/lib/design/schema";

/* =========================================================
   DESIGN RENDERER — the single, shared renderer behind BOTH the marketplace's full
   live previews AND (after purchase) the real storefront landing. The same config +
   the same renderer, so a preview is never an approximation of the product.

   Presentation only. Functional pieces are injected as `slots` by the caller, so the
   real auth/service/payment components keep their existing backend wiring and this
   file never touches orders, payments, or auth logic.
   ========================================================= */

export type FunctionalSlot = FunctionalSection["component"];

export interface DesignRenderData {
  panelName: string;
  logoUrl?: string;
  services: Array<{ name: string; platform: string; price: string; min: string }>;
  categories: string[];
  currencySymbol?: string;
  /** Live-derived stat values (fall back to the design's static values). */
  liveStats?: { services?: string; platforms?: string; from?: string };
  /** Single-platform focus (e.g. "telegram") → hero shows one flying platform icon. */
  focusPlatform?: string;
}

/** Where the design's CTAs point. A storefront must pass its OWN auth routes —
 *  otherwise customers would be sent to Innvil's owner signup. */
export interface DesignHrefs {
  signup?: string;
  login?: string;
  services?: string;
}

export interface DesignRendererProps {
  pkg: DesignPackage;
  page?: DesignPageId;
  data: DesignRenderData;
  personalization?: PreviewPersonalization;
  /** Real backend-wired components (auth card, service list…). Missing slot = demo visual. */
  slots?: Partial<Record<FunctionalSlot, React.ReactNode>>;
  /** CTA destinations (defaults are Innvil's, correct only for previews). */
  hrefs?: DesignHrefs;
  /** Owner recolouring — e.g. a free colour theme applied to a purchased design.
   *  Colours only; the design keeps its own layout, type, radii and animation. */
  tokenOverrides?: Partial<DesignTokens>;
  /** Preview mode: links/buttons don't navigate. */
  inert?: boolean;
}

/* ------------------------------------------------------------------ styles ---- */

const DESIGN_CSS = `
.dz-root { background: var(--d-bg); color: var(--d-text); font-family: var(--d-font-body); position: relative; overflow-x: hidden; }
.dz-root *, .dz-root *::before, .dz-root *::after { box-sizing: border-box; }
.dz-backdrop { position: absolute; inset: 0 0 auto 0; height: 900px; background: var(--d-backdrop); pointer-events: none; }
.dz-display { font-family: var(--d-font-display); font-weight: 700; letter-spacing: -0.02em; line-height: 1.05; }
.dz-wrap { max-width: 1100px; margin: 0 auto; padding-left: 1.5rem; padding-right: 1.5rem; position: relative; }
.dz-section { padding-top: var(--d-section-y); padding-bottom: var(--d-section-y); }
.dz-card { background: var(--d-surface); border: 1px solid var(--d-border); border-radius: var(--d-radius-lg); backdrop-filter: blur(12px); }
.dz-accent { color: var(--d-accent); }
.dz-dim { color: var(--d-text-dim); }
.dz-faint { color: var(--d-text-faint); }
.dz-btn { display: inline-flex; align-items: center; gap: .5rem; border-radius: 999px; padding: .8rem 1.5rem; font-weight: 600; font-size: .95rem; border: 1px solid transparent; cursor: pointer; text-decoration: none; transition: transform .18s ease, filter .18s ease; }
.dz-btn:hover { transform: translateY(-2px); filter: brightness(1.08); }
.dz-btn-primary { background: linear-gradient(120deg, var(--d-accent), var(--d-accent-alt)); color: #0B0614; box-shadow: var(--d-shadow); }
.dz-btn-ghost { background: var(--d-surface); border-color: var(--d-border); color: var(--d-text); }
.dz-grid { display: grid; gap: 1rem; }
@keyframes dzFadeUp { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes dzFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes dzFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
@keyframes dzSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.dz-spin { animation: dzSpin 26s linear infinite; }
.dz-spin-rev { animation: dzSpin 34s linear infinite reverse; }
/* Single icon ORBITING the growth card: an arm rotates around the centre while the icon
   counter-rotates to stay upright; a nested element adds a soft scale/glow pulse. */
@keyframes dzOrbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes dzOrbitCounter { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
/* 5s cycle: visible ~2s, then a gentle ~3s "lights-out" pulse — fades away then reappears
   (opacity out/in + a slight shrink), while it keeps orbiting. Not a brighten. */
@keyframes dzOrbitPulse {
  0%, 40%, 100% { opacity: 1; transform: scale(1); }
  70%           { opacity: 0; transform: scale(.7); }
}
/* Relaxed revolution — NOT synced to the 5s pulse (16s ≠ 5s). */
.dz-orbit-arm { animation: dzOrbit 16s linear infinite; }
.dz-orbit-item { animation: dzOrbitCounter 16s linear infinite; }
.dz-orbit-pulse { animation: dzOrbitPulse 5s ease-in-out infinite; }
.dz-anim-fade-up { animation: dzFadeUp .7s cubic-bezier(.2,.7,.3,1) both; }
.dz-anim-fade-in { animation: dzFadeIn .8s ease both; }
.dz-float { animation: dzFloat 5s ease-in-out infinite; }
.dz-hero { display: grid; grid-template-columns: 1.05fr .95fr; gap: 3rem; align-items: center; }
.dz-phone { width: 260px; border-radius: 34px; border: 1px solid var(--d-border); background: var(--d-surface-alt); padding: .75rem; box-shadow: var(--d-shadow); margin-left: auto; }
.dz-feedrow { display: flex; align-items: center; gap: .6rem; padding: .6rem; border-radius: var(--d-radius); background: var(--d-surface); margin-bottom: .5rem; }
.dz-chip { display: inline-flex; align-items: center; gap: .4rem; padding: .55rem .85rem; border-radius: 999px; background: var(--d-surface); border: 1px solid var(--d-border); font-size: .8rem; }
.dz-floatcard { position: absolute; display: flex; align-items: center; gap: .55rem; padding: .6rem .85rem; border-radius: var(--d-radius); background: var(--d-surface-alt); border: 1px solid var(--d-border); backdrop-filter: blur(10px); font-size: .78rem; white-space: nowrap; box-shadow: 0 12px 30px -12px rgba(0,0,0,.55); }
.dz-stat { text-align: center; padding: 1.4rem 1rem; }
.dz-stat-v { font-size: 2rem; }
.dz-svc { padding: 1.1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; transition: transform .2s ease, border-color .2s ease; }
.dz-svc:hover { transform: translateY(-3px); border-color: var(--d-accent); }
.dz-details summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 1rem; font-weight: 600; }
.dz-details summary::-webkit-details-marker { display: none; }
.dz-details[open] summary .dz-caret { transform: rotate(180deg); }
.dz-caret { transition: transform .2s ease; }
@media (max-width: 900px) {
  .dz-hero { grid-template-columns: 1fr; gap: 2.5rem; }
  .dz-phone { margin: 0 auto; }
  .dz-hide-tablet { display: none !important; }
}
@media (max-width: 620px) {
  .dz-wrap { padding-left: 1.1rem; padding-right: 1.1rem; }
  .dz-hide-mobile { display: none !important; }
}
`;

/* ------------------------------------------------------------------ helpers ---- */

function ctaHref(cta: DesignCta, hrefs?: DesignHrefs): string {
  switch (cta.action) {
    case "signup": return hrefs?.signup ?? "/signup";
    case "login": return hrefs?.login ?? "/login";
    case "services": return hrefs?.services ?? "#services";
    default: return cta.href || "#";
  }
}

/** CTA destinations for the current render (storefronts override Innvil's defaults). */
const HrefContext = React.createContext<DesignHrefs | undefined>(undefined);

function CtaRow({ ctas, inert }: { ctas?: DesignCta[]; inert?: boolean }) {
  const hrefs = React.useContext(HrefContext);
  if (!ctas?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: ".75rem", marginTop: "1.75rem" }}>
      {ctas.map((c, i) => (
        <a
          key={i}
          href={inert ? undefined : ctaHref(c, hrefs)}
          onClick={inert ? (e) => e.preventDefault() : undefined}
          className={`dz-btn ${i === 0 ? "dz-btn-primary" : "dz-btn-ghost"}`}
        >
          {c.label}
        </a>
      ))}
    </div>
  );
}

function SectionHeading({ heading, sub, center = true }: { heading?: string; sub?: string; center?: boolean }) {
  if (!heading && !sub) return null;
  return (
    <div style={{ textAlign: center ? "center" : "left", marginBottom: "2.5rem" }}>
      {heading && <h2 className="dz-display" style={{ fontSize: "clamp(1.7rem, 3.2vw, 2.4rem)", margin: 0 }}>{heading}</h2>}
      {sub && <p className="dz-dim" style={{ marginTop: ".8rem", fontSize: "1rem", maxWidth: 620, marginInline: center ? "auto" : undefined }}>{sub}</p>}
    </div>
  );
}

const FLOAT_ICON: Record<string, string> = {
  like: "♥", heart: "♥", view: "▶", follower: "+", comment: "💬", share: "↗", notify: "✓",
};
const FLOAT_POS = [
  { top: "6%", left: "-4%" },
  { top: "26%", right: "-6%" },
  { bottom: "24%", left: "-2%" },
  { top: "52%", right: "2%" },
  { bottom: "4%", right: "-4%" },
];

/* ----------------------------------------------------------------- sections ---- */

function Hero({ s, data, inert }: { s: HeroSection; data: DesignRenderData; inert?: boolean }) {
  return (
    <section className="dz-section dz-wrap">
      <div className="dz-hero">
        <div>
          {s.eyebrow && (
            <span className="dz-chip dz-accent" style={{ marginBottom: "1.2rem" }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--d-accent)" }} /> {s.eyebrow}
            </span>
          )}
          <h1 className="dz-display" style={{ fontSize: "clamp(2.3rem, 5.2vw, 3.9rem)", margin: ".9rem 0 0" }}>
            {s.headline}
            {s.headlineAccent && (
              <>
                <br />
                <span style={{ background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  {s.headlineAccent}
                </span>
              </>
            )}
          </h1>
          {s.sub && <p className="dz-dim" style={{ fontSize: "1.08rem", lineHeight: 1.65, marginTop: "1.2rem", maxWidth: 520 }}>{s.sub}</p>}
          <CtaRow ctas={s.ctas} inert={inert} />
        </div>

        <div style={{ position: "relative" }}>
          {s.mockup === "phone-feed" && (
            <div className="dz-phone">
              <div style={{ height: 6, width: 54, borderRadius: 99, background: "var(--d-border)", margin: "0 auto .8rem" }} />
              <div className="dz-feedrow" style={{ justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  {data.logoUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.logoUrl} alt="" style={{ width: 24, height: 24, borderRadius: 8, objectFit: "cover" }} />
                    : <span style={{ width: 24, height: 24, borderRadius: 8, background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))" }} />}
                  <b style={{ fontSize: ".78rem" }}>{data.panelName}</b>
                </span>
                <span className="dz-faint" style={{ fontSize: ".7rem" }}>live</span>
              </div>
              {data.services.slice(0, 4).map((svc, i) => (
                <div key={i} className="dz-feedrow">
                  <span style={{ width: 28, height: 28, borderRadius: 9, background: "var(--d-surface-alt)", display: "grid", placeItems: "center", fontSize: ".7rem" }} className="dz-accent">
                    {svc.platform.slice(0, 1).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: ".72rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{svc.name}</span>
                    <span className="dz-faint" style={{ fontSize: ".64rem" }}>min {svc.min}</span>
                  </span>
                  <b className="dz-accent" style={{ fontSize: ".72rem" }}>{data.currencySymbol ?? "$"}{svc.price}</b>
                </div>
              ))}
            </div>
          )}

          {s.mockup === "dashboard-card" && (
            <div className="dz-card" style={{ padding: "1.2rem", maxWidth: 380, marginLeft: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
                <span style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                  {data.logoUrl
                    ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.logoUrl} alt="" style={{ width: 26, height: 26, borderRadius: 8, objectFit: "cover" }} />
                    : <span style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))" }} />}
                  <b style={{ fontSize: ".82rem" }}>Creator analytics</b>
                </span>
                <span className="dz-chip dz-accent" style={{ padding: ".3rem .6rem", fontSize: ".68rem" }}>▲ 32% mo</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: ".5rem", marginBottom: "1rem" }}>
                {[["Followers", "48.2K"], ["Views", "1.2M"], ["Revenue", `${data.currencySymbol ?? "$"}9.4K`]].map(([l, val]) => (
                  <div key={l} style={{ background: "var(--d-surface-alt)", border: "1px solid var(--d-border)", borderRadius: "var(--d-radius)", padding: ".55rem" }}>
                    <div className="dz-faint" style={{ fontSize: ".58rem", textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</div>
                    <div className="dz-accent" style={{ fontSize: ".95rem", fontWeight: 700, marginTop: ".15rem" }}>{val}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: ".35rem", height: 74 }}>
                {[38, 52, 45, 63, 58, 78, 92].map((h, i) => (
                  <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: "4px 4px 0 0", background: "linear-gradient(180deg, var(--d-accent), color-mix(in srgb, var(--d-accent-alt) 60%, transparent))" }} />
                ))}
              </div>
              <div className="dz-faint" style={{ fontSize: ".6rem", marginTop: ".5rem", textAlign: "center" }}>Last 7 days · growth</div>
            </div>
          )}

          {s.mockup === "collage" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", gridTemplateRows: "auto auto", gap: ".9rem" }}>
              {/* Big accent tile */}
              <div style={{ gridRow: "span 2", borderRadius: "var(--d-radius-lg)", padding: "1.4rem", minHeight: 260, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "linear-gradient(150deg, var(--d-accent), var(--d-accent-alt))", color: "#fff", boxShadow: "var(--d-shadow)" }}>
                <span style={{ fontSize: "2.6rem", lineHeight: 1 }}>🚀</span>
                <div>
                  <div style={{ fontSize: "1.05rem", fontWeight: 800, letterSpacing: "-0.01em" }}>#1 rated SMM panel</div>
                  <div style={{ fontSize: ".8rem", opacity: 0.85, marginTop: ".3rem" }}>Trusted by creators worldwide</div>
                </div>
              </div>
              {/* Trophy / best card */}
              <div className="dz-card" style={{ padding: "1.1rem", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: "2rem" }}>🏆</span>
                <div style={{ fontWeight: 800, fontSize: ".9rem", marginTop: ".5rem" }}>World-class quality</div>
              </div>
              {/* Platform card — single-platform focus shows ONE big tile; else the icon row. */}
              <div className="dz-card" style={{ padding: "1rem" }}>
                <div className="dz-faint" style={{ fontSize: ".62rem", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".6rem" }}>{data.focusPlatform ? "Built for" : "Every platform"}</div>
                {data.focusPlatform ? (
                  <div style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
                    <span style={{ width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(140deg, var(--d-accent), var(--d-accent-alt))", boxShadow: "var(--d-shadow)" }}>
                      <PlatformGlyph platform={data.focusPlatform} size={24} />
                    </span>
                    <span style={{ fontWeight: 800, fontSize: ".95rem", textTransform: "capitalize" }}>{data.focusPlatform}</span>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: ".45rem" }}>
                    {Array.from(new Set(data.services.map((x) => x.platform))).slice(0, 6).map((p) => (
                      <span key={p} style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(140deg, var(--d-accent), var(--d-accent-alt))" }}>
                        <PlatformGlyph platform={p} size={18} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {s.mockup === "orbit" && (
            <div style={{ position: "relative", width: 340, height: 340, maxWidth: "100%", margin: "0 auto" }}>
              {/* Concentric spinning rings */}
              <div className="dz-spin" style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px dashed var(--d-border)" }} />
              <div className="dz-spin-rev" style={{ position: "absolute", inset: 46, borderRadius: "50%", border: "1px dashed var(--d-border)" }} />
              <div style={{ position: "absolute", inset: 92, borderRadius: "50%", border: "1px solid var(--d-border)", background: "color-mix(in srgb, var(--d-accent) 6%, transparent)" }} />
              {/* Center node */}
              <div className="dz-card" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 132, padding: ".9rem", textAlign: "center" }}>
                <div style={{ fontSize: "1.5rem", lineHeight: 1 }}>⚡</div>
                <div className="dz-accent" style={{ fontWeight: 800, fontSize: "1.05rem", marginTop: ".35rem" }}>+18%</div>
                <div className="dz-faint" style={{ fontSize: ".58rem", textTransform: "uppercase", letterSpacing: ".08em" }}>Growth / wk</div>
              </div>
              {data.focusPlatform ? (
                /* Single-platform focus: ONE icon revolves around the growth card. The arm
                   rotates around centre; the item counter-rotates to stay upright; a nested
                   span pulses (scale + glow) every 5s. */
                <div className="dz-orbit-arm" style={{ position: "absolute", top: "50%", left: "50%", width: 0, height: 0, zIndex: 5, pointerEvents: "none" }}>
                  <div className="dz-orbit-item" style={{ position: "absolute", top: -159, left: -21, width: 42, height: 42 }}>
                    <span className="dz-orbit-pulse" style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 13, color: "#fff", background: "linear-gradient(140deg, var(--d-accent), var(--d-accent-alt))", boxShadow: "var(--d-shadow)" }}>
                      <PlatformGlyph platform={data.focusPlatform} size={22} />
                    </span>
                  </div>
                </div>
              ) : (
                /* Platform badges orbiting the node (upright) */
                Array.from(new Set(data.services.map((x) => x.platform))).slice(0, 6).map((p, i, arr) => {
                  const ang = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
                  const r = 138;
                  const x = 170 + r * Math.cos(ang) - 21;
                  const y = 170 + r * Math.sin(ang) - 21;
                  return (
                    <span key={p} className="dz-float dz-hide-mobile"
                      style={{ position: "absolute", top: y, left: x, width: 42, height: 42, borderRadius: 13, display: "grid", placeItems: "center", color: "#fff", background: "linear-gradient(140deg, var(--d-accent), var(--d-accent-alt))", boxShadow: "var(--d-shadow)", animationDelay: `${i * 0.5}s` }}>
                      <PlatformGlyph platform={p} size={22} />
                    </span>
                  );
                })
              )}
            </div>
          )}

          {s.floats?.slice(0, 5).map((f, i) => (
            <div key={i} className="dz-floatcard dz-float dz-hide-mobile" style={{ ...FLOAT_POS[i % FLOAT_POS.length], animationDelay: `${i * 0.6}s` }}>
              <span className="dz-accent" style={{ fontSize: ".95rem" }}>{FLOAT_ICON[f.kind] ?? "★"}</span>
              <span>
                {f.value && <b style={{ marginRight: ".35rem" }}>{f.value}</b>}
                <span className="dz-dim">{f.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stats({ s, data }: { s: StatsSection; data: DesignRenderData }) {
  const live = data.liveStats ?? {};
  const resolve = (label: string, value: string, source?: string) => {
    if (source !== "live") return value;
    const k = label.toLowerCase();
    if (k.includes("service")) return live.services ?? value;
    if (k.includes("platform")) return live.platforms ?? value;
    if (k.includes("from") || k.includes("price")) return live.from ?? value;
    return value;
  };
  return (
    <section className="dz-wrap" style={{ paddingBottom: "1rem" }}>
      <div className="dz-card dz-grid" style={{ gridTemplateColumns: `repeat(${Math.min(s.items.length, 4)}, 1fr)`, gap: 0, overflow: "hidden" }}>
        {s.items.map((it, i) => (
          <div key={i} className="dz-stat" style={{ borderLeft: i ? "1px solid var(--d-border)" : undefined }}>
            <div className="dz-display dz-stat-v dz-accent">{resolve(it.label, it.value, it.source)}</div>
            <div className="dz-faint" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".08em", marginTop: ".35rem" }}>{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Platforms({ s, data }: { s: PlatformsSection; data: DesignRenderData }) {
  const list = Array.from(new Set(data.services.map((x) => x.platform))).slice(0, 12);
  return (
    <section className="dz-section dz-wrap" id="platforms">
      <SectionHeading heading={s.heading} sub={s.sub} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: ".7rem", justifyContent: "center" }}>
        {list.map((p) => (
          <span key={p} className="dz-chip" style={{ textTransform: "capitalize" }}>
            <span className="dz-accent">●</span> {p}
          </span>
        ))}
        {data.categories.map((c) => <span key={c} className="dz-chip dz-dim">{c}</span>)}
      </div>
    </section>
  );
}

function Services({ s, data }: { s: ServicesSection; data: DesignRenderData }) {
  const list = s.limit ? data.services.slice(0, s.limit) : data.services;
  return (
    <section className="dz-section dz-wrap" id="services">
      <SectionHeading heading={s.heading} sub={s.sub} />
      <div className="dz-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))" }}>
        {list.map((svc, i) => (
          <div key={i} className="dz-card dz-svc">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: ".95rem" }}>{svc.name}</div>
              <div className="dz-faint" style={{ fontSize: ".76rem", marginTop: ".3rem", textTransform: "capitalize" }}>{svc.platform} · min {svc.min}</div>
            </div>
            {s.showPrices !== false && (
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div className="dz-accent" style={{ fontWeight: 700 }}>{data.currencySymbol ?? "$"}{svc.price}</div>
                <div className="dz-faint" style={{ fontSize: ".68rem" }}>per 1k</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Steps({ s }: { s: StepsSection }) {
  return (
    <section className="dz-section dz-wrap" id="steps">
      <SectionHeading heading={s.heading} />
      <div className="dz-grid" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))` }}>
        {s.steps.map((st, i) => (
          <div key={i} className="dz-card" style={{ padding: "1.6rem" }}>
            <div className="dz-display" style={{ fontSize: "2.2rem", background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
              {String(i + 1).padStart(2, "0")}
            </div>
            <h3 className="dz-display" style={{ fontSize: "1.1rem", margin: ".7rem 0 .5rem" }}>{st.title}</h3>
            <p className="dz-dim" style={{ fontSize: ".9rem", lineHeight: 1.6, margin: 0 }}>{st.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Features({ s }: { s: FeaturesSection }) {
  // Bold, playful variant: each card gets a full-bleed colour that cycles
  // dark → accent gradient → light, with an oversized emoji icon.
  if (s.variant === "color-cards") {
    const palettes = [
      { bg: "var(--d-text)", fg: "var(--d-bg)", dim: "color-mix(in srgb, var(--d-bg) 65%, var(--d-text))" },
      { bg: "linear-gradient(150deg, var(--d-accent), var(--d-accent-alt))", fg: "#ffffff", dim: "rgba(255,255,255,0.82)" },
      { bg: "var(--d-surface)", fg: "var(--d-text)", dim: "var(--d-text-dim)" },
    ];
    return (
      <section className="dz-section dz-wrap">
        <SectionHeading heading={s.heading} sub={s.sub} />
        <div className="dz-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {s.items.map((it, i) => {
            const p = palettes[i % palettes.length];
            return (
              <div key={i} style={{ background: p.bg, color: p.fg, border: "1px solid var(--d-border)", borderRadius: "var(--d-radius-lg)", padding: "1.6rem", boxShadow: "var(--d-shadow)" }}>
                <div style={{ fontSize: "2rem", lineHeight: 1 }}>{it.icon || "✨"}</div>
                <h3 className="dz-display" style={{ fontSize: "1.15rem", margin: "1rem 0 .5rem", color: p.fg }}>{it.title}</h3>
                <p style={{ fontSize: ".9rem", lineHeight: 1.6, margin: 0, color: p.dim }}>{it.body}</p>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <section className="dz-section dz-wrap">
      <SectionHeading heading={s.heading} sub={s.sub} />
      <div className="dz-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {s.items.map((it, i) => (
          <div key={i} className="dz-card" style={{ padding: "1.5rem" }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))", color: "#0B0614", fontWeight: 700 }}>
              {it.icon || it.title.slice(0, 1)}
            </div>
            <h3 className="dz-display" style={{ fontSize: "1.02rem", margin: ".9rem 0 .45rem" }}>{it.title}</h3>
            <p className="dz-dim" style={{ fontSize: ".88rem", lineHeight: 1.6, margin: 0 }}>{it.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonials({ s }: { s: TestimonialsSection }) {
  return (
    <section className="dz-section dz-wrap" id="testimonials">
      <SectionHeading heading={s.heading} />
      <div className="dz-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {s.items.map((t, i) => (
          <figure key={i} className="dz-card" style={{ padding: "1.5rem", margin: 0 }}>
            {t.rating && <div className="dz-accent" style={{ letterSpacing: ".15em", marginBottom: ".7rem" }}>{"★".repeat(t.rating)}</div>}
            <blockquote style={{ margin: 0, fontSize: ".95rem", lineHeight: 1.65 }}>“{t.quote}”</blockquote>
            <figcaption className="dz-faint" style={{ fontSize: ".8rem", marginTop: "1rem" }}>
              <b className="dz-dim">{t.name}</b>{t.role ? ` · ${t.role}` : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function Faq({ s }: { s: FaqSection }) {
  return (
    <section className="dz-section dz-wrap" id="faq" style={{ maxWidth: 760 }}>
      <SectionHeading heading={s.heading} />
      <div style={{ display: "grid", gap: ".65rem" }}>
        {s.items.map((f, i) => (
          <details key={i} className="dz-card dz-details" style={{ padding: "1.1rem 1.3rem" }}>
            <summary>{f.q}<span className="dz-caret dz-accent">⌄</span></summary>
            <p className="dz-dim" style={{ fontSize: ".92rem", lineHeight: 1.65, margin: ".8rem 0 0" }}>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function CtaBand({ s, inert }: { s: CtaSection; inert?: boolean }) {
  return (
    <section className="dz-section dz-wrap">
      <div className="dz-card" style={{ padding: "3rem 2rem", textAlign: "center", background: "linear-gradient(120deg, color-mix(in srgb, var(--d-accent) 22%, transparent), color-mix(in srgb, var(--d-accent-alt) 22%, transparent))" }}>
        <h2 className="dz-display" style={{ fontSize: "clamp(1.7rem, 3.4vw, 2.5rem)", margin: 0 }}>{s.heading}</h2>
        {s.sub && <p className="dz-dim" style={{ marginTop: ".9rem" }}>{s.sub}</p>}
        <div style={{ display: "flex", justifyContent: "center" }}><CtaRow ctas={s.ctas} inert={inert} /></div>
      </div>
    </section>
  );
}

function Functional({ s, slot, data, inert }: { s: FunctionalSection; slot?: React.ReactNode; data: DesignRenderData; inert?: boolean }) {
  return (
    <section className="dz-section dz-wrap" id={s.component} style={{ maxWidth: 560 }}>
      <SectionHeading heading={s.heading} sub={s.sub} />
      <div className="dz-card" style={{ padding: "1.8rem" }}>
        {slot ?? (
          /* Demo visual for previews — the real component is injected via `slots` on a
             live storefront, keeping all auth/order logic outside this renderer. */
          <div style={{ display: "grid", gap: ".7rem" }}>
            {(s.component === "auth-card" ? ["Email", "Username", "Password"] : ["Service", "Link", "Quantity"]).map((l) => (
              <label key={l} style={{ display: "grid", gap: ".35rem" }}>
                <span className="dz-faint" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".06em" }}>{l}</span>
                <span style={{ height: 42, borderRadius: "var(--d-radius)", background: "var(--d-surface-alt)", border: "1px solid var(--d-border)" }} />
              </label>
            ))}
            <button
              className="dz-btn dz-btn-primary"
              style={{ justifyContent: "center", marginTop: ".4rem" }}
              onClick={inert ? (e) => e.preventDefault() : undefined}
            >
              {s.component === "auth-card" ? `Join ${data.panelName}` : "Continue"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function Content({ s, inert }: { s: ContentSection; inert?: boolean }) {
  return (
    <section className="dz-section dz-wrap" style={{ maxWidth: 760, textAlign: "center" }}>
      {s.heading && <h2 className="dz-display" style={{ fontSize: "1.7rem", margin: 0 }}>{s.heading}</h2>}
      {s.body && <p className="dz-dim" style={{ marginTop: ".9rem", lineHeight: 1.7, whiteSpace: "pre-line" }}>{s.body}</p>}
      {s.cta && <div style={{ display: "flex", justifyContent: "center" }}><CtaRow ctas={[s.cta]} inert={inert} /></div>}
    </section>
  );
}

/* ------------------------------------------------------------------- chrome ---- */

function Header({ page, data, inert }: { page: DesignPage; data: DesignRenderData; inert?: boolean }) {
  const hrefs = React.useContext(HrefContext);
  const h = page.header;
  if (!h) return null;
  return (
    <header style={{ position: h.sticky ? "sticky" : "relative", top: 0, zIndex: 30, padding: "1rem 0", backdropFilter: "blur(14px)", background: "color-mix(in srgb, var(--d-bg) 78%, transparent)", borderBottom: "1px solid var(--d-border)" }}>
      <div className="dz-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem", minWidth: 0 }}>
          {data.logoUrl
            ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={data.logoUrl} alt="" style={{ width: 32, height: 32, borderRadius: 10, objectFit: "cover" }} />
            : <span style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(120deg, var(--d-accent), var(--d-accent-alt))" }} />}
          <b className="dz-display" style={{ fontSize: "1.05rem" }}>{data.panelName}</b>
        </span>
        <nav className="dz-hide-tablet" style={{ display: "flex", gap: "1.6rem", fontSize: ".9rem" }}>
          {h.links?.map((l) => (
            <a key={l.href} href={inert ? undefined : l.href} onClick={inert ? (e) => e.preventDefault() : undefined} className="dz-dim" style={{ textDecoration: "none" }}>{l.label}</a>
          ))}
        </nav>
        <span style={{ display: "flex", alignItems: "center", gap: ".6rem" }}>
          {h.ctas?.map((c, i) => (
            <a
              key={i}
              href={inert ? undefined : ctaHref(c, hrefs)}
              onClick={inert ? (e) => e.preventDefault() : undefined}
              className={i === (h.ctas!.length - 1) ? "dz-btn dz-btn-primary" : "dz-dim"}
              style={i === (h.ctas!.length - 1) ? { padding: ".55rem 1.1rem", fontSize: ".85rem" } : { textDecoration: "none", fontSize: ".9rem" }}
            >
              {c.label}
            </a>
          ))}
        </span>
      </div>
    </header>
  );
}

function Footer({ page, data, inert }: { page: DesignPage; data: DesignRenderData; inert?: boolean }) {
  const f = page.footer;
  if (!f) return null;
  return (
    <footer style={{ borderTop: "1px solid var(--d-border)", paddingTop: "3rem", paddingBottom: "3rem" }}>
      <div className="dz-wrap" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: "2rem" }}>
        <div>
          <b className="dz-display">{data.panelName}</b>
          {f.blurb && <p className="dz-faint" style={{ fontSize: ".85rem", lineHeight: 1.6, marginTop: ".6rem", maxWidth: 300 }}>{f.blurb}</p>}
        </div>
        {f.columns?.map((col) => (
          <div key={col.title}>
            <p className="dz-faint" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: ".7rem" }}>{col.title}</p>
            <div style={{ display: "grid", gap: ".45rem" }}>
              {col.links.map((l) => (
                <a key={l.href} href={inert ? undefined : l.href} onClick={inert ? (e) => e.preventDefault() : undefined} className="dz-dim" style={{ textDecoration: "none", fontSize: ".88rem" }}>{l.label}</a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ renderer ---- */

function renderSection(s: DesignSection, data: DesignRenderData, slots?: DesignRendererProps["slots"], inert?: boolean) {
  switch (s.type) {
    case "hero": return <Hero s={s} data={data} inert={inert} />;
    case "stats": return <Stats s={s} data={data} />;
    case "platforms": return <Platforms s={s} data={data} />;
    case "services": return <Services s={s} data={data} />;
    case "steps": return <Steps s={s} />;
    case "features": return <Features s={s} />;
    case "testimonials": return <Testimonials s={s} />;
    case "faq": return <Faq s={s} />;
    case "cta": return <CtaBand s={s} inert={inert} />;
    case "functional": return <Functional s={s} slot={slots?.[s.component]} data={data} inert={inert} />;
    case "content": return <Content s={s} inert={inert} />;
    default: return null;
  }
}

export function DesignRenderer({ pkg, page = "landing", data, personalization, slots, hrefs, tokenOverrides, inert }: DesignRendererProps) {
  const target = getPage(pkg, page) ?? pkg.pages[0];
  if (!target) return null;

  const tokens = personalizeTokens(pkg.tokens, personalization);
  const rootStyle = tokensToCssVars(tokens, tokenOverrides) as React.CSSProperties;
  const name = personalization?.panelName || data.panelName;
  const merged: DesignRenderData = { ...data, panelName: name, logoUrl: personalization?.logoUrl || data.logoUrl };

  return (
    <HrefContext.Provider value={hrefs}>
    <div className="dz-root" style={rootStyle}>
      <style dangerouslySetInnerHTML={{ __html: DESIGN_CSS }} />
      {(() => {
        // A theme override can switch the design's decorative backdrop off.
        const backdrop = tokenOverrides?.backdrop ?? tokens.backdrop;
        return backdrop && backdrop !== "none" ? <div className="dz-backdrop" /> : null;
      })()}
      <Header page={target} data={merged} inert={inert} />
      <main style={{ position: "relative" }}>
        {target.sections.map((s) => {
          const anim = s.animation && s.animation !== "none" && s.animation !== "float" && s.animation !== "count-up"
            ? `dz-anim-${s.animation}` : "";
          const hide = [
            s.responsive?.hideTablet ? "dz-hide-tablet" : "",
            s.responsive?.hideMobile ? "dz-hide-mobile" : "",
          ].filter(Boolean).join(" ");
          if (s.responsive?.hideDesktop) return null;
          const sectionTokens = s.tokens ? (tokensToCssVars(tokens, s.tokens) as React.CSSProperties) : undefined;
          return (
            <div key={s.id} className={`${anim} ${hide}`.trim()} style={sectionTokens}>
              {renderSection(s, merged, slots, inert)}
            </div>
          );
        })}
      </main>
      <Footer page={target} data={merged} inert={inert} />
    </div>
    </HrefContext.Provider>
  );
}
