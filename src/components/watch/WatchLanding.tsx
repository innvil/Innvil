import React from "react";
import Link from "next/link";
import {
  ShieldCheck, MessageSquare, Sparkles, Bot, ArrowRight, ScrollText, Activity,
  Radio, Zap, Users, Clock,
} from "lucide-react";
import { WatchPricingSection } from "./WatchPricingSection";
import { WatchOnboardingGuide } from "./WatchOnboardingGuide";
import { watchPlanOptions } from "@/src/lib/products/watch-plans";

/**
 * Innvil Watch's own public, standalone landing page — served on
 * watch.innvil.cloud (app/page.tsx branches on host). Deliberately its own
 * visual product: `.watch-root`/`w-*` design tokens (cool teal, modern
 * sans-serif, operational/monitoring language) — NOT the parent site's
 * `fp-root`/`fp-*` gold-editorial system, and NOT a copy of
 * PublicLanding.tsx's structure. Still visibly "by Innvil" via the shared
 * brand mark + explicit ecosystem links in the nav/footer.
 */
function WatchNav() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-[#0A0E11]/85 border-b w-line-soft">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/watch/app-tile.svg" alt="" width={36} height={36} className="w-9 h-9 rounded-[9px]" />
          <div className="leading-tight">
            <span className="w-display text-base tracking-tight block">Innvil Watch</span>
            <span className="text-[10px] w-text-faint">by Innvil</span>
          </div>
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm w-text-dim">
          <a href="#features" className="hover:w-text">Features</a>
          <a href="#how" className="hover:w-text">How it works</a>
          <a href="#getting-started" className="hover:w-text">Getting started</a>
          <a href="#pricing" className="hover:w-text">Pricing</a>
          <a href="https://innvil.cloud" className="hover:w-text flex items-center gap-1">← Innvil</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm w-text-dim">Log in</Link>
          <Link href="/signup" className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
            Start Watching <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Hero product visualization — a realistic Watch operations panel using
 *  clearly-labeled sample data, not real customer metrics. */
function WatchOpsPanel() {
  return (
    <div className="w-card p-5 relative overflow-hidden">
      <div className="absolute top-3 right-3 text-[10px] w-text-faint font-medium">Sample data</div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center">
            <Bot size={16} className="w-teal" />
          </div>
          <div>
            <p className="text-sm font-semibold w-text">Kwan</p>
            <p className="text-[11px] w-text-faint">Watcher</p>
          </div>
        </div>
        <span className="w-pill w-green-soft-bg w-green">
          <span className="w-pulse-dot" /> Online
        </span>
      </div>

      <div className="w-line-soft border-t pt-4 mb-4">
        <p className="text-[11px] w-text-faint mb-1">Community</p>
        <p className="text-sm w-text flex items-center gap-1.5"><Users size={13} className="w-text-dim" /> @samplecommunity</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="w-surface-raised rounded-lg p-3">
          <p className="text-[11px] w-text-faint flex items-center gap-1"><ShieldCheck size={12} /> Spam blocked</p>
          <p className="text-lg w-display w-text">18</p>
        </div>
        <div className="w-surface-raised rounded-lg p-3">
          <p className="text-[11px] w-text-faint flex items-center gap-1"><Radio size={12} /> Scam links removed</p>
          <p className="text-lg w-display w-text">3</p>
        </div>
        <div className="w-surface-raised rounded-lg p-3">
          <p className="text-[11px] w-text-faint flex items-center gap-1"><MessageSquare size={12} /> Questions answered</p>
          <p className="text-lg w-display w-text">42</p>
        </div>
        <div className="w-surface-raised rounded-lg p-3">
          <p className="text-[11px] w-text-faint flex items-center gap-1"><Clock size={12} /> Next auto-post</p>
          <p className="text-lg w-display w-text">2h 14m</p>
        </div>
      </div>
    </div>
  );
}

const FEATURE_GROUPS: Array<{ label: string; items: Array<{ icon: typeof ShieldCheck; title: string; body: string }> }> = [
  {
    label: "Watch",
    items: [
      { icon: ShieldCheck, title: "Spam & scam moderation", body: "Automatic detection and graduated enforcement for unsolicited promotion, link spam, and phishing/scam links." },
      { icon: Radio, title: "Media safety", body: "Photo and video moderation, so unsafe media doesn't sit in your community." },
    ],
  },
  {
    label: "Engage",
    items: [
      { icon: MessageSquare, title: "Natural conversation", body: "Watchers chat naturally, in their own configured persona — not a generic support bot." },
      { icon: ScrollText, title: "Project knowledge", body: "Ground every answer in facts you provide — Watchers never invent claims about your project." },
    ],
  },
  {
    label: "Operate",
    items: [
      { icon: Sparkles, title: "Auto-Posting", body: "Schedule per-Watcher posting windows so your community stays active." },
      { icon: Activity, title: "Activity & status", body: "See what your Watcher is doing — always on, always watching." },
    ],
  },
];

const STEPS = [
  { n: "01", title: "Choose a plan", body: "Create your Innvil account and choose a Watch plan." },
  { n: "02", title: "Connect Telegram", body: "Add your Watcher to your Telegram community." },
  { n: "03", title: "Configure", body: "Set its persona and knowledge base." },
  { n: "04", title: "Let it operate", body: "Your Watcher moderates, answers, and posts on schedule." },
];

const FAQ: Array<{ q: string; a: string }> = [
  { q: "Do I need an SMM Panel to use Innvil Watch?", a: "No. Watch is an independently ownable Innvil product — you can subscribe and use it directly with just an Innvil account. Owning Innvil Forge (the SMM panel product) is one way to access Watch, never a requirement." },
  { q: "How many Watchers can I deploy?", a: "Your plan sets a total Watcher-slot allowance shared across every community you connect. Each individual community also has its own cap of up to 5 active Watchers, independent of your plan's total." },
  { q: "Can I use Watch in more than one community?", a: "Yes, up to your plan's community allowance — Bronze includes 1, Silver 2, Gold 3, Platinum 5. Each community is a separate connection with its own Watcher deployments." },
  { q: "What happens if I reach my plan limit?", a: "Innvil tells you clearly and blocks the specific action (deploying another Watcher, connecting another community) rather than silently failing or bypassing the limit." },
  { q: "Can I change my plan later?", a: "Yes — subscribing to a different plan updates your entitlement; nothing about your existing Projects, communities, or Watcher configuration is deleted." },
  { q: "Does Watch work with my existing Innvil account?", a: "Yes. Product entitlements (Forge, Watch, and future products) all live on the same Innvil account — there's no separate Watch-only login." },
  { q: "What's the difference between a Project, a Community, and a Watcher?", a: "A Project is your identity and knowledge base. A Community is a specific Telegram group or channel you connect. A Watcher is the AI-powered Virtual Moderator you deploy into a Community — one Project can have multiple Communities, and Watchers are deployed per Community." },
];

function WatchFaq() {
  return (
    <section id="faq" className="max-w-3xl mx-auto px-6 py-16">
      <h2 className="w-display text-2xl text-center mb-10">Frequently asked questions</h2>
      <div className="space-y-2.5">
        {FAQ.map((f) => (
          <details key={f.q} className="w-card px-4 py-3 group">
            <summary className="cursor-pointer text-sm font-medium w-text list-none flex items-center justify-between gap-3">
              {f.q}
              <span className="w-teal text-xs shrink-0 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <p className="text-sm w-text-dim mt-2 leading-relaxed">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function WatchLanding({ authenticated }: { authenticated: boolean }) {
  const options = watchPlanOptions();
  return (
    <div id="top" className="watch-root min-h-screen">
      <WatchNav />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="w-pill w-teal-soft-bg w-teal mb-5">
            <Zap size={12} /> Innvil Watch
          </span>
          <h1 className="w-display text-4xl sm:text-5xl leading-[1.08] mb-6">
            Your community doesn&apos;t sleep.<br />Neither does your Watch.
          </h1>
          <p className="w-text-dim text-lg mb-8 max-w-md">
            Deploy AI-powered Watchers that moderate, answer questions, detect abuse, and keep your Telegram
            community active — around the clock.
          </p>
          <div className="flex items-center gap-3">
            <a href="#pricing" className="w-btn-primary text-sm font-semibold px-5 py-3 rounded-lg flex items-center gap-1.5">
              Start Watching <ArrowRight size={14} />
            </a>
            <a href="#how" className="text-sm px-5 py-3 rounded-lg border w-line-soft w-surface w-text-dim hover:w-text">
              See how it works
            </a>
          </div>
        </div>
        <WatchOpsPanel />
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="w-display text-2xl text-center mb-10">What a Watcher does</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {FEATURE_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="text-xs w-mono uppercase tracking-wider w-teal mb-3">{group.label}</p>
              <div className="space-y-3">
                {group.items.map((f) => (
                  <div key={f.title} className="w-card p-4">
                    <f.icon size={16} className="w-teal mb-2" />
                    <p className="w-display text-sm mb-1">{f.title}</p>
                    <p className="text-xs w-text-dim">{f.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="w-display text-2xl text-center mb-10">How it works</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="w-card p-4">
              <span className="w-mono text-xs w-teal">{s.n}</span>
              <p className="w-display text-sm mt-2 mb-1">{s.title}</p>
              <p className="text-xs w-text-dim">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <WatchOnboardingGuide />

      <WatchPricingSection options={options} authenticated={authenticated} />

      <WatchFaq />

      <footer className="border-t w-line-soft py-10 text-center">
        <p className="w-display text-sm mb-1">Innvil Watch</p>
        <p className="text-xs w-text-faint mb-2">Part of the Innvil ecosystem.</p>
        <a href="https://innvil.cloud" className="text-xs w-teal hover:underline">innvil.cloud</a>
      </footer>
    </div>
  );
}
