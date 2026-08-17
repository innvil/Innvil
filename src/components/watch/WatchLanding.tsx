import React from "react";
import Link from "next/link";
import { ShieldCheck, MessageSquare, Sparkles, Bot, ArrowRight, ScrollText } from "lucide-react";
import { InnvilBrandMark } from "@/src/components/ui/BrandMark";
import { WatchPricingSection } from "./WatchPricingSection";
import { watchPlanOptions } from "@/src/lib/products/watch-plans";

/**
 * Innvil Watch's own public, standalone landing page — served on
 * watch.innvil.cloud (app/page.tsx branches on host). Deliberately NOT a
 * clone of PublicLanding.tsx (the Forge/SMM-panel marketing page); it never
 * mentions "create your panel" or panel-specific copy. Reuses the shared
 * fp-* visual language + InnvilBrandMark so it reads as the SAME Innvil
 * ecosystem, not a different product.
 */
function WatchNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0B0F]/80 border-b fp-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5 shrink-0">
          <div className="w-10 h-10 rounded-[9px] bg-[#C9A574] flex items-center justify-center">
            <InnvilBrandMark className="w-[109%] h-[107%] -translate-x-[1px] text-[#0E1522]" />
          </div>
          <div className="leading-tight">
            <span className="fp-display text-lg tracking-wide block">Innvil Watch</span>
            <span className="text-[10px] fp-text-faint">Part of Innvil</span>
          </div>
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm fp-text-dim">
          <a href="#features" className="hover:fp-text">Features</a>
          <a href="#how" className="hover:fp-text">How it works</a>
          <a href="#pricing" className="hover:fp-text">Pricing</a>
          <a href="https://innvil.cloud" className="hover:fp-text">innvil.cloud</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm fp-text-dim">Log in</Link>
          <Link href="/signup" className="fp-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
            Get Started <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

const FEATURES = [
  { icon: MessageSquare, title: "Natural conversation", body: "Watchers chat naturally in your community, in their own configured persona — not a generic support bot." },
  { icon: ShieldCheck, title: "Spam & scam moderation", body: "Automatic detection and graduated enforcement for unsolicited promotion, link spam, and phishing/scam links." },
  { icon: Bot, title: "AI-powered Virtual Moderators", body: "Each Watcher is an AI-powered Virtual Moderator deployed into your Telegram community — answering questions and keeping order." },
  { icon: Sparkles, title: "Auto-Posting", body: "Schedule per-Watcher posting windows so your community stays active, grounded in your own project knowledge." },
  { icon: ScrollText, title: "Project Knowledge", body: "Ground every answer in facts you provide — Watchers never invent claims about your project." },
];

export function WatchLanding({ authenticated }: { authenticated: boolean }) {
  const options = watchPlanOptions();
  return (
    <div id="top" className="fp-root min-h-screen">
      <WatchNav />

      <section className="max-w-4xl mx-auto px-6 pt-24 pb-16 text-center">
        <p className="text-xs fp-mono uppercase fp-gold tracking-wider mb-4">Innvil Watch</p>
        <h1 className="fp-display text-4xl sm:text-5xl leading-tight mb-6">
          AI-powered Watchers<br />for modern communities.
        </h1>
        <p className="fp-text-dim text-lg max-w-xl mx-auto mb-8">
          Deploy a Watcher — an AI-powered Virtual Moderator — into your Telegram community. It chats naturally, answers
          questions grounded in your own project knowledge, and keeps spam and scams out.
        </p>
        <div className="flex items-center justify-center gap-3">
          <a href="#pricing" className="fp-btn-primary text-sm font-semibold px-5 py-3 rounded-lg flex items-center gap-1.5">
            Start with Watch <ArrowRight size={14} />
          </a>
          <a href="#how" className="text-sm px-5 py-3 rounded-lg border fp-line-soft fp-panel-raised fp-text-dim hover:fp-text">
            How it works
          </a>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="fp-display text-2xl text-center mb-10">What a Watcher does</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="fp-panel border fp-line-soft rounded-2xl p-5">
              <f.icon size={18} className="fp-gold mb-3" />
              <p className="fp-display text-base mb-1.5">{f.title}</p>
              <p className="text-sm fp-text-dim">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="fp-display text-2xl text-center mb-10">How it works</h2>
        <ol className="space-y-4 text-sm fp-text-dim max-w-md mx-auto">
          <li className="flex gap-3"><span className="fp-gold fp-mono">01</span> Create an Innvil account and choose a Watch plan.</li>
          <li className="flex gap-3"><span className="fp-gold fp-mono">02</span> Add your Watcher to your Telegram community.</li>
          <li className="flex gap-3"><span className="fp-gold fp-mono">03</span> Configure its persona and knowledge — then let it moderate and chat.</li>
        </ol>
      </section>

      <WatchPricingSection options={options} authenticated={authenticated} />

      <footer className="border-t fp-line-soft py-10 text-center text-xs fp-text-faint">
        <p>Innvil Watch — part of the Innvil ecosystem.</p>
        <a href="https://innvil.cloud" className="fp-gold hover:underline">innvil.cloud</a>
      </footer>
    </div>
  );
}
