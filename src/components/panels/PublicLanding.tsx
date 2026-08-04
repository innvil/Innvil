"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight, ChevronRight, ChevronDown, Circle, Gauge, PlayCircle, Rocket, Wifi,
  Palette, Tag, Percent, RefreshCw, ListOrdered, Sliders, ShieldCheck, Globe, Trash2,
  Wallet, MessageSquare, FileText, Copy, Activity, PiggyBank, KeyRound, Lock, LayoutGrid, Gift,
  Bot, Zap, CheckCircle2,
} from "lucide-react";
import { Pill, FloorLedger } from "@/src/components/ui";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import { getLandingVideo } from "@/src/lib/actions/platform-settings";
import { toVideoEmbed } from "@/src/lib/video";
import { LANDING_FAQ } from "@/src/data/landing-faq";
import type { TopupDiscountRule } from "@/src/lib/actions/platform-payments";

/* =========================================================
   INNVIL PUBLIC LANDING PAGE
   Extracted into its own module so the server-rendered marketing page (app/page.tsx)
   ships only this + its deps — never the big owner-app bundle (InnvilApp). Helps
   Core Web Vitals on the primary SEO surface.
   ========================================================= */

function TopNav({ setWorld }: { world?: string; setWorld?: (w: string) => void }) {
  void setWorld; // vestigial — the landing navigates via real <Link> routes
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0B0F]/80 border-b fp-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#top" aria-label="Innvil — back to top" className="flex items-center gap-2.5 shrink-0">
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
          </div>
          <span className="fp-display text-lg tracking-wide">Innvil</span>
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm fp-text-dim">
          <a href="#how" className="hover:fp-text">How it works</a>
          <a href="#automation" className="hover:fp-text">Automation</a>
          <a href="#features" className="hover:fp-text">Features</a>
          <a href="#pricing" className="hover:fp-text">Pricing</a>
          <Link href="/design-shop" className="hover:fp-text">Designs</Link>
          <Link href="/blog" className="hover:fp-text">Guides</Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm fp-text-dim">Log in</Link>
          <Link href="/signup" className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
            Create your panel <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PublicLanding({ setWorld, topupTiers = [] }: { setWorld?: (w: string) => void; topupTiers?: TopupDiscountRule[] }) {
  const [videoUrl, setVideoUrl] = useState("");
  useEffect(() => {
    let alive = true;
    getLandingVideo().then((v) => { if (alive) setVideoUrl(v.url); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const video = toVideoEmbed(videoUrl);

  return (
    <div id="top">
      <TopNav world="public" setWorld={setWorld} />
      <section className="relative fp-noise fp-grid-bg overflow-hidden">
        <div className="max-w-6xl mx-auto px-6 pt-20 pb-24 grid md:grid-cols-2 gap-14 items-center">
          <div>
            <Pill tone="violet" icon={Gauge}>SMM panel making &amp; managing — made easy</Pill>
            <p className="fp-text-faint text-xs fp-mono mt-3">Almost fully automated · minimal human touch · 0% rent, 5% only</p>
            <h1 className="fp-display text-5xl md:text-6xl leading-[1.05] mt-6">
              Your own SMM panel,<br />
              <span className="fp-grad-text">built and run for you.</span>
            </h1>
            <p className="fp-text-dim text-base mt-6 max-w-md leading-relaxed">
              Innvil is the no-code SMM panel builder that does the heavy lifting. Spin up unlimited
              white-label panels — each with its own subdomain, storefront, wallet and customer
              dashboard — then let Innvil automate the busywork: catalog import, pricing, order
              routing, status sync, refunds and deposits all run on their own. You brand, price, and grow.
            </p>
            <div className="flex items-center gap-4 mt-8">
              <Link href="/signup" className="fp-btn-primary font-semibold px-6 py-3 rounded-lg flex items-center gap-2">
                Create your panel <ArrowRight size={16} />
              </Link>
              <a href="#how" className="fp-text-dim text-sm flex items-center gap-1 hover:fp-text">
                See how it works <ChevronRight size={14} />
              </a>
            </div>
            <div className="flex items-center gap-6 mt-10 fp-text-faint text-xs fp-mono">
              <span>Keep 95% of every order</span>
              <Circle size={3} fill="currentColor" />
              <span>Subdomain live in minutes</span>
            </div>
          </div>
          <FloorLedger />
        </div>
      </section>

      {/* By the numbers — honest facts about the offer (not fabricated usage stats) */}
      <section className="max-w-6xl mx-auto px-6 pt-2 pb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { v: "5% → 1%", l: "Commission drops as your sales grow" },
            { v: "$0", l: "Monthly rent & setup fees" },
            { v: "∞", l: "Panels per account" },
            { v: "Minutes", l: "To a live subdomain" },
          ].map((s) => (
            <div key={s.l} className="fp-panel border fp-line rounded-2xl p-5 text-center">
              <p className="fp-display text-3xl fp-gold">{s.v}</p>
              <p className="fp-text-faint text-xs mt-1.5 leading-snug">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {video.kind !== "none" && (
        <section id="walkthrough" className="max-w-5xl mx-auto px-6 py-20 border-t fp-line-soft">
          <div className="text-center mb-10">
            <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3 flex items-center justify-center gap-1.5">
              <PlayCircle size={13} /> Watch
            </p>
            <h2 className="fp-display text-3xl">See how easy it is to launch a panel.</h2>
            <p className="fp-text-dim text-sm mt-3">A quick walkthrough — from sign-up to a live storefront.</p>
          </div>
          <div className="fp-panel border fp-line rounded-2xl overflow-hidden aspect-video">
            {video.kind === "file" ? (
              <video src={video.src} controls playsInline className="w-full h-full object-contain bg-black" />
            ) : (
              <iframe
                src={video.src}
                title="Innvil walkthrough"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            )}
          </div>
        </section>
      )}

      <section id="how" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">How it works</p>
        <h2 className="fp-display text-3xl mb-12">How to start your own SMM panel.</h2>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { n: "01", t: "Create a panel", d: "Name it, pick a subdomain, choose a theme. Ready in minutes.", icon: Rocket },
            { n: "02", t: "Connect your provider", d: "Bring your own SMM provider via API. We never sell you services.", icon: Wifi },
            { n: "03", t: "Brand & price it", d: "Custom domain, your colors, your markup above the provider floor.", icon: Palette },
            { n: "04", t: "You control the status", d: "Set each panel to draft, live, inactive, or maintenance yourself — anytime. Going live is one switch, and every change is reversible.", icon: Gauge },
          ].map((s) => (
            <div key={s.n} className="fp-panel border fp-line rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <span className="fp-mono text-xs fp-text-faint">{s.n}</span>
                <s.icon size={18} className="fp-gold" />
              </div>
              <h3 className="fp-display text-lg mb-2">{s.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="automation" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3 flex items-center gap-1.5">
          <Zap size={13} className="fp-gold" /> Almost fully automated
        </p>
        <h2 className="fp-display text-3xl mb-4">Built to run itself. Minimal human touch.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          Running an SMM panel is mostly repetitive busywork. Innvil automates it end to end, so you
          spend minutes managing what used to take hours — and your customers get a fast, hands-off experience.
        </p>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
          {[
            "Provider catalog imported & auto-categorized",
            "Your markup priced onto every service automatically",
            "Orders routed to your provider the moment they're placed",
            "Order status synced from your provider every 10 minutes",
            "Unfilled or canceled portions auto-refunded to the customer",
            "Crypto deposits auto-credit the wallet on confirmation",
            "Commission settled automatically on completed orders",
            "Held orders auto-resend once your provider is topped up",
            "Provider spend auto-logged (net of refunds) for clean books",
          ].map((t) => (
            <div key={t} className="fp-panel border fp-line rounded-xl px-4 py-3 flex items-start gap-2.5">
              <CheckCircle2 size={16} className="fp-gold shrink-0 mt-0.5" />
              <span className="fp-text-dim text-sm leading-snug">{t}</span>
            </div>
          ))}
        </div>
        <p className="fp-text-faint text-xs mt-6">The only things that need you: connecting your provider, setting your prices, and choosing when to go live.</p>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Provider automation</p>
        <h2 className="fp-display text-3xl mb-4">Import a thousand services in one click.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          Connect your SMM provider and Innvil pulls the entire catalog, prices it with your
          markup, and organizes it for you — the busywork that eats a launch, done in seconds.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Wifi, t: "One-click catalog import", d: "Pull your provider's full service list over their API — select all, or cherry-pick." },
            { icon: Tag, t: "Auto-categorization", d: "Services are sorted into platform categories and sub-categories (Instagram → Followers, Views…) automatically." },
            { icon: Percent, t: "Markup your way", d: "Percentage, multiplier, or fixed markup above the provider floor — set once, edit any service anytime." },
            { icon: RefreshCw, t: "One-click sync", d: "Refresh prices, min/max limits, and availability from your provider whenever they change." },
            { icon: ListOrdered, t: "Batch API orders", d: "Accept up to 100 API orders in one request with per-row success/error results for fast retries and automation workflows." },
            { icon: Sliders, t: "Full catalog control", d: "Rename, describe, re-price, enable or disable any service — a clean tree, not a spreadsheet." },
            { icon: ShieldCheck, t: "Keys never exposed", d: "Provider API keys are encrypted and only ever used server-side. They never touch the browser." },
          ].map((f) => (
            <div key={f.t} className="fp-panel border fp-line rounded-2xl p-6">
              <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center mb-4">
                <f.icon size={18} />
              </span>
              <h3 className="fp-display text-lg mb-2">{f.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="platform" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">SMM panel features</p>
        <h2 className="fp-display text-3xl mb-4">Everything to run your SMM panel — not just take orders.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          Wallets, payments, support, receipts, and safety tooling ship with every panel.
          The parts most SMM panels charge extra for — or don&apos;t have at all — are already here.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Globe, t: "Custom domains, reversible", d: "Connect your own domain with automatic SSL. Disconnect anytime and your storefront falls back to the included subdomain — no lock-in." },
            { icon: Trash2, t: "Create & delete freely", d: "Spin up test panels to experiment, then delete unwanted ones in one guarded step — the whole panel and its data removed cleanly. No clutter, no lock-in." },
            { icon: Wallet, t: "Wallets + crypto deposits", d: "Every panel has a customer wallet. Take deposits via Cryptomus, NOWPayments (300+ coins), Stripe, Razorpay or Binance Pay — funds credit automatically on confirmation." },
            { icon: Zap, t: "Accept USDT via Binance Pay", d: "Connect your own Binance account and take USDT straight to it. Each deposit gets a unique amount so payments reconcile and credit automatically — no merchant account needed — with optional tiered top-up bonuses." },
            { icon: MessageSquare, t: "Support tickets, both sides", d: "Customers open and reply to tickets in their dashboard; you answer from the panel's Support inbox, with unread badges and email notices." },
            { icon: FileText, t: "Earnings & downloadable receipts", d: "See top-ups minus provider cost as real profit, and export a self-contained receipt for any date range." },
            { icon: Copy, t: "Duplicate detection + mass cancel", d: "Repeat orders on the same link land in a Duplicate slot instead of your provider. Cancel in bulk — every owner cancel auto-refunds the customer." },
            { icon: Activity, t: "Provider balance in view", d: "Fetch and cache each connected provider's balance so you never run dry mid-fulfilment." },
            { icon: PiggyBank, t: "Provider spend tracker", d: "Innvil auto-logs the top-ups you add to your providers — netting out refunds — into an exportable weekly/monthly cost record, so spend vs. earnings is always clear." },
            { icon: Rocket, t: "Refresh & resend held orders", d: "An order held because your provider's balance ran low doesn't fail — top the provider up and one tap resends every held order the moment its cost is covered." },
            { icon: RefreshCw, t: "Automatic order-status sync", d: "Orders track your provider automatically — completed, partial, canceled — and refund the unfilled portion. No manual chasing." },
            { icon: KeyRound, t: "Customer-facing API", d: "Every customer gets an API key and the full v2 endpoints, including batch ordering up to 100 rows for automation workflows." },
            { icon: Gauge, t: "Fast, mobile-first UX", d: "Owner and customer experiences are built mobile-first and feel like a modern SaaS product, not a legacy panel." },
            { icon: Palette, t: "Design Shop", d: "Give your storefront a professionally designed landing — buy a complete design once and own it forever, and recolor it with free themes. A no-code visual editor is coming soon. Never look generic." },
            { icon: Bot, t: "Free AI assistant", d: "A built-in assistant helps you run your panel — connect a provider, import services, go live — free on every account, no setup." },
            { icon: MessageSquare, t: "AI customer support (add-on)", d: "Turn on an AI chat that answers your customers about services, orders and deposits — grounded in your own catalog — and opens a ticket when it can't help." },
          ].map((f) => (
            <div key={f.t} className="fp-panel border fp-line rounded-2xl p-6">
              <span className="w-10 h-10 rounded-xl fp-gold-soft-bg fp-gold flex items-center justify-center mb-4">
                <f.icon size={18} />
              </span>
              <h3 className="fp-display text-lg mb-2">{f.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="floor" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <div className="grid md:grid-cols-2 gap-14 items-center">
          <div>
            <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">The price floor</p>
            <h2 className="fp-display text-3xl mb-5">A floor, not a ceiling.</h2>
            <p className="fp-text-dim text-sm leading-relaxed mb-5">
              Every service on your panel inherits a minimum price equal to what your connected
              provider charges you. You price as high above it as the market allows — never below.
            </p>
            <p className="fp-text-dim text-sm leading-relaxed">
              Innvil doesn&apos;t sell SMM services or act as your provider — we build and host
              the panel. The floor simply travels with whatever price your own provider gives you.
            </p>
          </div>
          <FloorLedger compact />
        </div>
      </section>

      <section id="why" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Why Innvil</p>
        <h2 className="fp-display text-3xl mb-4">Built differently from a rented SMM panel.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          Most SMM panels rent you a storefront and bill you every month whether you sell or not.
          Innvil aligns with your growth — and hands you the parts they hold back.
        </p>
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Percent, t: "0% monthly rent", d: "5% on completed orders only — nothing until an order actually delivers. No monthly bill, no setup fee.", lead: true },
            { icon: Wifi, t: "Bring your own provider", d: "We never resell SMM services or mark up your provider. You keep 95% of every order and your margin is yours.", lead: false },
            { icon: Globe, t: "No domain lock-in", d: "Disconnect your custom domain anytime and the storefront reverts to your included subdomain. You're never held hostage.", lead: false },
            { icon: Lock, t: "Real customer-privacy boundary", d: "You can't log into customer accounts or reset their passwords — only adjust balances. A trust guarantee legacy panels don't give.", lead: false },
            { icon: LayoutGrid, t: "A business OS, not just a panel", d: "Wallet, tickets, receipts, duplicate tooling and a full Design Shop today; the Automator and Analytics land as opt-in add-ons next.", lead: false },
            { icon: Gift, t: "ANVIL rewards — coming soon", d: "Earn rewards on every top-up and unlock discounts on paid features as the platform grows.", lead: false },
          ].map((f) => (
            <div key={f.t} className={`fp-panel border rounded-2xl p-6 ${f.lead ? "fp-gold-border" : "fp-line"}`}>
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${f.lead ? "fp-gold-bg text-[#0A0B0F]" : "fp-gold-soft-bg fp-gold"}`}>
                <f.icon size={18} />
              </span>
              <h3 className="fp-display text-lg mb-2">{f.t}</h3>
              <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">SMM panel pricing</p>
        <h2 className="fp-display text-3xl mb-4">The fairest commission in SMM.</h2>
        <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-12">
          No monthly rent, no setup fee. Innvil takes a flat 5% — and only when an order actually
          completes. Cancel or refund it, and that order costs you nothing. Build and <span className="fp-text">preview
          your live storefront for free</span> — you only fund a panel when you&apos;re ready to take orders.
        </p>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Commission wheel — you keep 95%, Innvil 5% (completed only) */}
          <div className="flex items-center justify-center">
            <div className="relative">
              <svg width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="You keep 95%, Innvil takes 5%">
                <circle cx="120" cy="120" r="90" fill="none" stroke="#262A35" strokeWidth="26" />
                <circle
                  cx="120" cy="120" r="90" fill="none" stroke="#C9A574" strokeWidth="26" strokeLinecap="round"
                  strokeDasharray={`${0.95 * 2 * Math.PI * 90} ${2 * Math.PI * 90}`}
                  transform="rotate(-90 120 120)"
                />
                <circle
                  cx="120" cy="120" r="90" fill="none" stroke="#8B7FFF" strokeWidth="26" strokeLinecap="round"
                  strokeDasharray={`${0.05 * 2 * Math.PI * 90} ${2 * Math.PI * 90}`}
                  strokeDashoffset={`${-0.95 * 2 * Math.PI * 90}`}
                  transform="rotate(-90 120 120)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="fp-display text-5xl fp-gold">95%</p>
                <p className="fp-text-faint text-xs fp-mono uppercase tracking-wide">stays yours</p>
              </div>
            </div>
          </div>

          {/* The three numbers that make up the model */}
          <div>
            <div className="space-y-5 mb-8">
              {[
                { v: "5%", t: "On completed orders only", d: "0% on canceled or refunded orders — you're billed on real revenue you earned, never on rent." },
                { v: "$0", t: "Rent & setup fees", d: "No monthly bill, no onboarding cost. You only ever pay the 5% on what actually completes." },
                { v: "∞", t: "Panels per account", d: "Spin up unlimited white-label panels — subdomain included, custom domain optional." },
              ].map((f) => (
                <div key={f.t} className="flex gap-4">
                  <span className="fp-display text-2xl fp-gold w-14 shrink-0">{f.v}</span>
                  <div>
                    <p className="text-sm font-medium mb-0.5">{f.t}</p>
                    <p className="fp-text-dim text-sm leading-relaxed">{f.d}</p>
                  </div>
                </div>
              ))}
            </div>
            <Link href="/signup" className="fp-btn-primary font-semibold px-6 py-3 rounded-lg flex items-center gap-2 w-fit">
              Create your panel <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 mt-12 text-xs fp-text-dim">
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#C9A574]" /> You keep 95%</span>
          <span className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm bg-[#8B7FFF]" /> Innvil 5% — completed orders only</span>
        </div>

        <div className="fp-panel border fp-gold-border rounded-2xl p-6 md:p-8 mt-14">
          <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Volume discounts</p>
          <h3 className="fp-display text-2xl mb-3">5% isn&apos;t forever. It drops as you grow.</h3>
          <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-6">
            The more your panel sells, the less Innvil takes — all the way down to
            <span className="fp-gold"> 1%</span>. Doing 1,000+ completed orders a day? Contact support and
            we&apos;ll lower your rate. And we never take more than <span className="fp-text">$100 from one panel in a day.</span>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { d: "1,000 / day", r: "4%" },
              { d: "2,500 / day", r: "3%" },
              { d: "5,000 / day", r: "2%" },
              { d: "10,000 / day", r: "1%" },
            ].map((b) => (
              <div key={b.d} className="fp-panel-raised border fp-line-soft rounded-xl p-4 text-center">
                <p className="fp-display text-2xl fp-gold">{b.r}</p>
                <p className="fp-text-faint text-xs fp-mono mt-1">{b.d}</p>
              </div>
            ))}
          </div>
        </div>

        {topupTiers.length > 0 && (
          <div className="fp-panel border fp-line rounded-2xl p-6 md:p-8 mt-6">
            <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3">Top-up bonuses</p>
            <h3 className="fp-display text-2xl mb-3">Fund more, get more.</h3>
            <p className="fp-text-dim text-sm leading-relaxed max-w-2xl mb-6">
              Top up your Innvil balance and we add bonus credit on top — the bigger the top-up, the bigger
              the bonus, up to <span className="fp-safe">+{Math.max(...topupTiers.map((t) => t.discountPct))}%</span> free.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {topupTiers.map((t) => (
                <div key={t.minAmount} className="fp-panel-raised border fp-line-soft rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                  <span className="fp-text-dim text-sm fp-mono">≥ ${t.minAmount.toLocaleString()}</span>
                  <span className="fp-safe text-sm font-semibold">+{t.discountPct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section id="faq" className="max-w-3xl mx-auto px-6 py-20 border-t fp-line-soft">
        <p className="fp-mono text-xs fp-text-faint uppercase tracking-[0.14em] mb-3 text-center">FAQ</p>
        <h2 className="fp-display text-3xl mb-10 text-center">SMM panel questions, answered.</h2>
        <div className="space-y-2">
          {LANDING_FAQ.map((f) => (
            <details key={f.q} className="fp-panel border fp-line rounded-xl px-4 py-3 group">
              <summary className="cursor-pointer text-sm font-medium flex items-center justify-between list-none gap-3">
                {f.q}
                <ChevronDown size={15} className="fp-text-faint group-open:rotate-180 transition-transform shrink-0" />
              </summary>
              <p className="fp-text-dim text-sm mt-2 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t fp-line-soft">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 fp-text-faint text-xs">
          <span>© 2026 Innvil — the white-label SMM panel builder.</span>
          <div className="flex items-center gap-5">
            <a href="/terms" className="hover:fp-text">Terms</a>
            <a href="/privacy" className="hover:fp-text">Privacy</a>
            <span className="fp-mono fp-text-faint">5% commission · no rent</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
