"use client";

import React, { useMemo, useState } from "react";
import {
  Zap, ShieldCheck, Wallet, Clock, ChevronDown, Headphones,
  BarChart3, ArrowRight,
} from "lucide-react";
import { PLATFORMS, PlatformKey, customerServices } from "@/src/data/constants";
import { PlatformGlyph, PlatformButton } from "./PlatformIcons";
import { DefaultLogo } from "@/src/components/ui/BrandMark";

/* =========================================================
   PANEL CUSTOMER LANDING — white-label, per panel
   Focused on Create Account / Log In only.
  No Innvil branding anywhere.
   ========================================================= */

const FAQS = [
  {
    q: "How fast do orders start?",
    a: "Most services start within minutes of payment. Each service shows its estimated start time and completion speed before you order.",
  },
  {
    q: "Do I need to share my account password?",
    a: "Never. We only need a public link or username — no service on this panel will ever ask for your password.",
  },
  {
    q: "What payment methods can I use?",
    a: "Crypto (USDT, BTC, ETH and more), with card and PayPal on the way. Deposits credit your wallet instantly.",
  },
  {
    q: "What does the refill guarantee cover?",
    a: "On services marked with refill, any drop within the guarantee window is topped back up for free — automatically or with one click.",
  },
  {
    q: "Can I spread delivery over time?",
    a: "Yes. Services that support drip feed let you split your order into smaller runs at the interval you choose.",
  },
];

export function CustomerLanding({
  onAuthed,
  inactive = false,
}: {
  onAuthed: () => void;
  inactive?: boolean;
}) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [showcase, setShowcase] = useState<PlatformKey>("instagram");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const showcaseServices = useMemo(
    () => customerServices.filter((s) => s.platform === showcase).slice(0, 4),
    [showcase]
  );

  const goSignup = (m: "register" | "login") => {
    setMode(m);
    document.getElementById("nb-auth")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="fp-root min-h-screen fp-grid-bg fp-noise">
      {/* Header — panel brand only */}
      <header className="border-b fp-line-soft bg-[#0A0B0F]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <DefaultLogo className="w-8 h-8 rounded-lg" iconSize={16} />
            <span className="fp-display text-xl">NovaBoost</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goSignup("login")}
              className={`text-sm px-4 py-2 rounded-lg transition-colors ${
                mode === "login" ? "fp-violet-soft-bg fp-violet" : "fp-text-dim hover:fp-text"
              }`}
            >
              Log in
            </button>
            <button
              onClick={() => goSignup("register")}
              className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Create account
            </button>
          </div>
        </div>
      </header>

      {inactive && (
        <div className="fp-gold-soft-bg border-b border-[rgba(201,165,116,0.2)] px-6 py-2.5 text-center">
          <p className="fp-gold text-sm flex items-center justify-center gap-2">
            <Clock size={13} />
            New orders are temporarily paused. Accounts, deposits, and order history remain available.
          </p>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12 md:py-20 grid md:grid-cols-2 gap-12 items-center">
        {/* Left — value prop */}
        <div>
          <h1 className="fp-display text-4xl md:text-5xl leading-tight mb-5">
            Grow every platform from one wallet.
          </h1>
          <p className="fp-text-dim text-lg mb-8 leading-relaxed">
            Instant delivery, transparent pricing, and one balance for all your social growth.
          </p>

          {/* Platform strip — monochrome glyphs in rounded cards */}
          <div className="flex gap-3 flex-wrap mb-10">
            {PLATFORMS.map((p) => (
              <span
                key={p.key}
                className="w-11 h-11 rounded-xl fp-panel-raised border border-[#262A35] flex items-center justify-center fp-text-dim"
                title={p.label}
              >
                <PlatformGlyph platform={p.key} size={18} />
              </span>
            ))}
          </div>

          <div className="space-y-4">
            {[
              { icon: Zap, title: "Instant start", sub: "Most orders begin within minutes of payment." },
              { icon: Wallet, title: "One wallet", sub: "Top up once, order across every platform." },
              { icon: ShieldCheck, title: "Refill guarantee", sub: "Eligible services include automatic refill." },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg fp-violet-soft-bg fp-violet flex items-center justify-center shrink-0 mt-0.5">
                  <f.icon size={16} />
                </span>
                <div>
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="text-sm fp-text-dim">{f.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — auth card */}
        <div id="nb-auth" className="fp-panel border fp-line rounded-2xl p-7 max-w-md w-full md:justify-self-end">
          <div className="flex gap-1 fp-panel-raised rounded-xl p-1 mb-6">
            {(
              [
                { k: "register", label: "Create account" },
                { k: "login", label: "Log in" },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                onClick={() => setMode(t.k)}
                className={`flex-1 text-sm py-2 rounded-lg transition-colors ${
                  mode === t.k ? "fp-panel fp-text font-medium border fp-line" : "fp-text-dim"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h2 className="fp-display text-2xl mb-5">
            {mode === "register" ? "Start growing today" : "Welcome back"}
          </h2>

          {mode === "register" && (
            <input
              placeholder="Username"
              className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]"
            />
          )}
          <input
            placeholder="Email"
            type="email"
            className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm mb-3 outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]"
          />
          <input
            placeholder="Password"
            type="password"
            className="w-full bg-[#1B1E27] border border-[#1E212A] rounded-lg px-3 py-2.5 text-sm mb-5 outline-none focus:border-[rgba(139,127,255,0.35)] text-[#EDEAE2]"
          />
          <button
            onClick={onAuthed}
            className="fp-btn-primary font-semibold w-full py-3 rounded-lg text-sm"
          >
            {mode === "register" ? "Create account" : "Log in"}
          </button>
          <p className="fp-text-faint text-xs text-center mt-4">
            {mode === "register" ? (
              <>Already have an account?{" "}
                <button onClick={() => setMode("login")} className="fp-violet">Log in</button>
              </>
            ) : (
              <>New here?{" "}
                <button onClick={() => setMode("register")} className="fp-violet">Create account</button>
              </>
            )}
          </p>
        </div>
      </main>

      {/* Stats strip */}
      <section className="border-y fp-line-soft bg-[#0D0F14]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { v: "1.2M+", l: "Orders delivered" },
            { v: "480+", l: "Active services" },
            { v: "~2 min", l: "Average start time" },
            { v: "99.9%", l: "Uptime" },
          ].map((s) => (
            <div key={s.l} className="text-center">
              <p className="fp-display text-3xl fp-grad-text">{s.v}</p>
              <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide mt-1.5">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Services showcase — platform glyph tabs */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20">
        <div className="text-center mb-10">
          <h2 className="fp-display text-3xl md:text-4xl mb-3">Services for every platform</h2>
          <p className="fp-text-dim max-w-xl mx-auto">
            Pick a platform to see what&apos;s waiting inside — followers, views, likes,
            and more, all from one wallet.
          </p>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 md:justify-center md:flex-wrap md:overflow-visible mb-8">
          {PLATFORMS.map((p) => (
            <PlatformButton
              key={p.key}
              platform={p.key}
              label={p.label}
              active={showcase === p.key}
              onClick={() => setShowcase(p.key)}
            />
          ))}
        </div>
        <div className="max-w-2xl mx-auto fp-panel border fp-line rounded-2xl p-3 sm:p-5">
          {showcaseServices.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 border-b fp-line-soft last:border-0 py-3.5 px-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{s.name}</p>
                <p className="text-xs fp-text-faint fp-mono mt-0.5">
                  {s.category} · min {s.min.toLocaleString()} · start {s.startTime}
                </p>
              </div>
              <span className="fp-mono text-sm fp-gold shrink-0">
                ${s.price.toFixed(2)}/{s.unit}
              </span>
            </div>
          ))}
          <button
            onClick={() => goSignup("register")}
            className="w-full mt-3 mb-1 text-sm fp-violet border border-[rgba(139,127,255,0.35)] rounded-lg py-2.5 hover:fp-violet-soft-bg transition-colors flex items-center justify-center gap-1.5"
          >
            Create an account to see all services <ArrowRight size={14} />
          </button>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-t fp-line-soft bg-[#0D0F14]/40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20">
          <div className="text-center mb-10">
            <h2 className="fp-display text-3xl md:text-4xl mb-3">Why order here</h2>
            <p className="fp-text-dim max-w-xl mx-auto">
              Built for people who order again and again — fast, transparent, and safe.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: ShieldCheck, t: "Secure payments", d: "Instant wallet credit over encrypted checkout — crypto today, cards soon." },
              { icon: Zap, t: "Fast delivery", d: "Most orders begin within minutes, with live progress on every order." },
              { icon: BarChart3, t: "Real-time tracking", d: "Start counts, remains, and status straight from the source — no guessing." },
              { icon: Headphones, t: "24/7 support", d: "Tickets answered around the clock, with refill and cancel built in." },
            ].map((b) => (
              <div key={b.t} className="fp-panel border fp-line rounded-2xl p-6">
                <span className="w-10 h-10 rounded-xl fp-violet-soft-bg fp-violet flex items-center justify-center mb-4">
                  <b.icon size={18} />
                </span>
                <p className="fp-display text-lg mb-2">{b.t}</p>
                <p className="text-sm fp-text-dim leading-relaxed">{b.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 md:py-20">
        <div className="text-center mb-10">
          <h2 className="fp-display text-3xl md:text-4xl mb-3">Frequently asked questions</h2>
        </div>
        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <div key={f.q} className="fp-panel border fp-line rounded-2xl overflow-hidden">
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left"
                aria-expanded={openFaq === i}
              >
                <span className="text-sm font-medium">{f.q}</span>
                <ChevronDown
                  size={16}
                  className={`fp-text-faint shrink-0 transition-transform ${openFaq === i ? "rotate-180" : ""}`}
                />
              </button>
              {openFaq === i && (
                <p className="px-6 pb-5 text-sm fp-text-dim leading-relaxed">{f.a}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t fp-line-soft fp-noise">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 md:py-20 text-center">
          <h2 className="fp-display text-3xl md:text-4xl mb-4">Ready to grow?</h2>
          <p className="fp-text-dim max-w-md mx-auto mb-8">
            Create your free account, top up your wallet, and place your first order in
            under a minute.
          </p>
          <button
            onClick={() => goSignup("register")}
            className="fp-btn-primary font-semibold px-8 py-3.5 rounded-lg inline-flex items-center gap-2"
          >
            Create your account <ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer className="border-t fp-line-soft py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs fp-text-faint">
          <span>© 2026 NovaBoost</span>
          <div className="flex gap-6">
            <span className="hover:fp-text cursor-pointer">Terms</span>
            <span className="hover:fp-text cursor-pointer">Contact</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
