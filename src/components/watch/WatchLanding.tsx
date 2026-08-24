import React from "react";
import Link from "next/link";
import {
  ShieldCheck, MessageSquare, Gauge, Bot, ArrowRight, ScrollText, Activity,
  Radio, Zap, Users, Clock, Rocket, Server, KeyRound,
} from "lucide-react";
import { WatchPricingSection } from "./WatchPricingSection";
import { WatchOnboardingGuide } from "./WatchOnboardingGuide";
import { WatchLogoutButton } from "./WatchLogoutButton";
import { watchPlanOptions } from "@/src/lib/products/watch-plans";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";
// Client-safe canonical trial constants -- watch-trial.ts itself is
// server-only (full of DB functions); moderator/plan.ts is the plain,
// client-safe module those constants actually originate from, and is
// already used this way by WatchPricingSection.tsx (a client component
// rendered on this same page).
import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY } from "@/src/lib/moderator/plan";

/**
 * Innvil Watch's own public, standalone landing page — served on
 * watch.innvil.cloud (app/page.tsx branches on host). Deliberately its own
 * visual product: `.watch-root`/`w-*` design tokens (cool teal, modern
 * sans-serif, operational/monitoring language) — NOT the parent site's
 * `fp-root`/`fp-*` gold-editorial system, and NOT a copy of
 * PublicLanding.tsx's structure. Still visibly "by Innvil" via the shared
 * brand mark + explicit ecosystem links in the nav/footer.
 */
function WatchNav({ authenticated }: { authenticated: boolean }) {
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
          <a href="#what-is-a-watcher" className="hover:w-text">What&apos;s a Watcher?</a>
          <a href="#features" className="hover:w-text">Features</a>
          <a href="#how" className="hover:w-text">How it works</a>
          <a href="#pricing" className="hover:w-text">Pricing</a>
          <a href="#free-trial" className="hover:w-text">Free Trial</a>
          <a href="#faq" className="hover:w-text">FAQ</a>
          <a href="https://innvil.cloud" className="hover:w-text flex items-center gap-1">← Innvil</a>
        </nav>
        {authenticated ? (
          <WatchLogoutButton />
        ) : (
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm w-text-dim">Log in</Link>
            <Link href="/signup" className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5">
              Start Free Trial <ArrowRight size={14} />
            </Link>
          </div>
        )}
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
      { icon: Gauge, title: "Auto-Posting", body: "Schedule per-Watcher posting windows so your community stays active." },
      { icon: Activity, title: "Activity & status", body: "See what your Watcher is doing — always on, always watching." },
    ],
  },
];

const STEPS = [
  { n: "01", title: "Connect Telegram", body: "Verify your Telegram account, then try Watch with a Free Trial or a paid plan." },
  { n: "02", title: "Create a Watcher", body: "Configure its persona and knowledge base." },
  { n: "03", title: "Deploy it", body: "Connect your Watcher's bot to your Telegram Community." },
  { n: "04", title: "Let it operate", body: "Your Watcher moderates, answers, and posts on schedule." },
];

function StepCard({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <div className="w-card p-4 w-44">
      <span className="w-mono text-xs w-teal">{step.n}</span>
      <p className="w-display text-sm mt-2 mb-1">{step.title}</p>
      <p className="text-xs w-text-dim">{step.body}</p>
    </div>
  );
}

// Desktop floating-waveform composition: cards sit at independent vertical
// offsets around a horizontal center line (01 slightly up, 02 down, 03
// higher than 01, 04 back near center) rather than a downward staircase.
// Percentages position the cards; the same coordinates (x10, viewBox 1000
// wide) drive the connecting curve so the two stay in sync.
const HOW_X_PCT = [10, 34, 60, 84];
const HOW_Y_OFFSET = [-28, 35, -45, 5]; // px from the vertical center line
const HOW_FLOW_HEIGHT = 340;
const HOW_CENTER_Y = HOW_FLOW_HEIGHT / 2;

function HowItWorksFlow({ steps }: { steps: typeof STEPS }) {
  const anchors = HOW_X_PCT.map((xPct, i) => ({ x: xPct * 10, y: HOW_CENTER_Y + HOW_Y_OFFSET[i] }));
  const [a1, a2, a3, a4] = anchors;
  const path =
    `M${a1.x},${a1.y} C${a1.x + 80},${a1.y + 18} ${a2.x - 80},${a2.y - 15} ${a2.x},${a2.y} ` +
    `C${a2.x + 80},${a2.y + 15} ${a3.x - 120},${a3.y - 15} ${a3.x},${a3.y} ` +
    `C${a3.x + 80},${a3.y - 10} ${a4.x - 80},${a4.y - 15} ${a4.x},${a4.y}`;

  return (
    <div className="relative hidden lg:block" style={{ height: HOW_FLOW_HEIGHT }}>
      <svg viewBox={`0 0 1000 ${HOW_FLOW_HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <path d={path} fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
        {/* Small nodes along the visible arcs between cards -- the signal
            "moving through several nodes" the cards themselves sit on top of. */}
        {[
          { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 + 5 },
          { x: (a2.x + a3.x) / 2, y: (a2.y + a3.y) / 2 + 6 },
          { x: (a3.x + a4.x) / 2, y: (a3.y + a4.y) / 2 - 12 },
        ].map((n, i) => <circle key={i} cx={n.x} cy={n.y} r="4" fill="#2DD4BF" opacity="0.75" />)}
      </svg>
      {steps.map((s, i) => (
        <div
          key={s.n}
          className="absolute"
          style={{ left: `${HOW_X_PCT[i]}%`, top: `calc(50% + ${HOW_Y_OFFSET[i]}px)`, transform: "translate(-50%, -50%)" }}
        >
          <StepCard step={s} />
        </div>
      ))}
    </div>
  );
}

/** Mobile/tablet fallback -- four cards can't stay readable floating
 *  horizontally on a narrow viewport, so they stack, but still connected
 *  by the same flowing signal-path language (alternating curve direction)
 *  rather than a plain vertical line. */
function HowItWorksVerticalConnector({ flip }: { flip: boolean }) {
  const path = flip ? "M24,4 C24,26 96,20 96,44" : "M96,4 C96,26 24,20 24,44";
  return (
    <div className="flex justify-center py-1 lg:hidden" aria-hidden="true">
      <svg width="120" height="48" viewBox="0 0 120 48" className="overflow-visible">
        <path d={path} fill="none" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      </svg>
    </div>
  );
}

const FAQ: Array<{ q: string; a: string }> = [
  { q: "What is the Free Trial?", a: `A one-time, ${TRIAL_DURATION_DAYS}-day trial of Innvil Watch — ${TRIAL_CAPACITY.maxActiveSlots} Watcher slot and ${TRIAL_CAPACITY.maxCommunities} Community, no payment required. One-time Free Trial. Telegram verification required.` },
  { q: "Do I need to pay to start?", a: "No. No payment is required for the Free Trial." },
  { q: "Do I need Telegram?", a: "Yes. A verified Telegram account is required to activate the one-time Watch trial." },
  { q: "What happens when the trial ends?", a: "Your Watch setup remains saved — nothing is deleted. Choose a paid plan to continue active Watch operations." },
  { q: "How many Watchers can I deploy?", a: "Your plan sets a total Watcher-slot allowance shared across every community you connect. Each individual community also has its own cap of up to 5 active Watchers, independent of your plan's total." },
  { q: "Can I use Watch in more than one community?", a: "Yes, up to your plan's community allowance — Bronze includes 1, Silver 2, Gold 3, Platinum 5. Each community is a separate connection with its own Watcher deployments." },
  { q: "What happens if I reach my plan limit?", a: "Innvil tells you clearly and blocks the specific action (deploying another Watcher, connecting another community) rather than silently failing or bypassing the limit." },
  { q: "Can I change my plan later?", a: "Yes — subscribing to a different plan updates your entitlement; nothing about your existing Projects, communities, or Watcher configuration is deleted." },
  { q: "Does Watch work with my existing Innvil account?", a: "Yes. Every Innvil product you use lives on the same Innvil account — there's no separate Watch-only login." },
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
      <WatchNav authenticated={authenticated} />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="w-pill w-teal-soft-bg w-teal mb-5">
            <Zap size={12} /> Innvil Watch
          </span>
          <h1 className="w-display text-4xl sm:text-5xl leading-[1.08] mb-6">
            AI Virtual Moderators<br />for your Communities.
          </h1>
          <p className="w-text-dim text-lg mb-4 max-w-md">
            Deploy <strong className="w-text font-semibold">Watchers</strong> — AI-powered Virtual Moderators —
            into your Telegram Communities to moderate, protect, monitor, and help operate them, even when
            you&apos;re not online.
          </p>
          <p className="text-sm w-teal flex items-center gap-1.5 mb-8">
            <Clock size={14} /> Try it free for {TRIAL_DURATION_DAYS} days — no payment required.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/signup" className="w-btn-primary text-sm font-semibold px-5 py-3 rounded-lg flex items-center gap-1.5">
              Start Free Trial <ArrowRight size={14} />
            </Link>
            <a href="#what-is-a-watcher" className="text-sm px-5 py-3 rounded-lg border w-line-soft w-surface w-text-dim hover:w-text">
              See how Watchers work
            </a>
          </div>
        </div>
        <WatchOpsPanel />
      </section>

      <section id="what-is-a-watcher" className="max-w-6xl mx-auto px-6 pb-16">
        <div className="w-card-raised border w-teal-border p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-8 items-center">
          <div>
            <p className="text-xs w-mono uppercase w-teal tracking-wider mb-2">What is a Watcher?</p>
            <h2 className="w-display text-2xl mb-3">An AI-powered Virtual Moderator you deploy to your Community.</h2>
            <p className="text-sm w-text-dim leading-relaxed mb-3">
              Each Watcher has its own persona and settings, and can be deployed to one or more Communities.
              Every active Watcher-to-Community deployment uses one <strong className="w-text font-medium">Watcher slot</strong>.
            </p>
            <p className="text-sm w-text-dim leading-relaxed">
              A <strong className="w-text font-medium">Community</strong> is the actual Telegram group,
              supergroup, or channel you connect — connect your Telegram Community, then deploy Watchers into it.
            </p>
          </div>
          <div className="w-card p-5">
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Watcher slots, in practice</p>
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 text-sm">
                <span className="w-pill w-teal-soft-bg w-teal shrink-0"><Bot size={12} /> Aegis</span>
                <ArrowRight size={13} className="w-text-faint shrink-0" />
                <span className="w-pill w-surface-raised w-text-dim shrink-0">Community A</span>
                <span className="text-xs w-text-faint ml-auto shrink-0">= 1 slot</span>
              </div>
              <div className="flex items-center gap-2.5 text-sm flex-wrap">
                <span className="w-pill w-teal-soft-bg w-teal shrink-0"><Bot size={12} /> Aegis</span>
                <ArrowRight size={13} className="w-text-faint shrink-0" />
                <span className="w-pill w-surface-raised w-text-dim shrink-0">Community A</span>
                <span className="w-pill w-surface-raised w-text-dim shrink-0">+ Community B</span>
                <span className="text-xs w-text-faint ml-auto shrink-0">= 2 slots</span>
              </div>
            </div>
            <p className="text-xs w-text-faint mt-4">One Watcher profile, deployed to two Communities, uses two slots — slots count active deployments, not distinct Watchers.</p>
          </div>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="w-display text-2xl text-center mb-2">What can a Watcher do?</h2>
        <p className="w-text-dim text-center max-w-lg mx-auto mb-10">Real, opt-in capabilities — nothing here is on by default that you didn&apos;t configure.</p>
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

      <div className="max-w-4xl mx-auto px-6 pb-10 text-center">
        <a href="#enterprise" className="inline-flex items-center gap-1.5 text-sm w-teal hover:underline">
          Running your own AI stack? Explore BYO Enterprise <ArrowRight size={13} />
        </a>
      </div>

      <section className="max-w-4xl mx-auto px-6 pb-16">
        <h2 className="w-display text-xl text-center mb-8">Who is Watch for?</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          {[
            "Telegram Community owners", "Crypto & project communities", "Support communities",
            "Creator communities", "Membership groups", "Teams running multiple Communities",
          ].map((t) => (
            <div key={t} className="w-card p-3 text-center w-text-dim">{t}</div>
          ))}
        </div>
      </section>

      <section id="free-trial-cta" className="max-w-3xl mx-auto px-6 pb-16 text-center">
        <div className="w-card-raised border w-teal-border p-8">
          <Rocket size={22} className="w-teal mx-auto mb-3" />
          <h2 className="w-display text-xl mb-2">Ready to put a Watcher in your Community?</h2>
          <p className="w-text-dim text-sm mb-5">Start with a {TRIAL_DURATION_DAYS}-day Free Trial — no payment required.</p>
          <Link href="/signup" className="w-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-1.5">
            Start Free Trial <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <section id="how" className="max-w-4xl mx-auto px-6 py-16">
        <h2 className="w-display text-2xl text-center mb-10">How it works</h2>

        {/* Mobile/tablet: cards can't stay readable floating horizontally,
            so they stack -- but still tied together by the same flowing
            signal-path language, alternating curve direction. */}
        <div className="lg:hidden flex flex-col items-center">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.n}>
              <StepCard step={s} />
              {i < STEPS.length - 1 && <HowItWorksVerticalConnector flip={i % 2 === 0} />}
            </React.Fragment>
          ))}
        </div>

        {/* Desktop: a floating waveform -- cards sit above/below an
            imaginary center line, joined by one smooth signal path that
            weaves left to right instead of stepping downward. */}
        <HowItWorksFlow steps={STEPS} />
      </section>

      <WatchOnboardingGuide />

      <section id="enterprise" className="max-w-5xl mx-auto px-6 py-16 scroll-mt-24">
        <p className="text-xs w-mono uppercase w-teal tracking-wider text-center mb-2">Enterprise</p>
        <h2 className="w-display text-2xl text-center mb-3">Two broad ways to run Watch at scale.</h2>
        <p className="w-text-dim text-center max-w-lg mx-auto mb-10">
          Both are the same Innvil Watch product and dashboard — the difference is who pays for the AI provider calls.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="w-card p-6">
            <Server size={20} className="w-teal mb-3" />
            <p className="w-display text-lg mb-1">Managed</p>
            <p className="text-sm w-text-dim mb-3">Innvil runs everything, including your AI provider usage — one flat monthly price.</p>
            <p className="w-display text-xl">from ${MANAGED_ENTERPRISE_50.price.toFixed(0)}<span className="text-sm w-text-faint font-normal">/mo</span></p>
          </div>
          <div className="w-card p-6">
            <KeyRound size={20} className="w-teal mb-3" />
            <p className="w-display text-lg mb-1">Bring Your Own (BYO)</p>
            <p className="text-sm w-text-dim mb-3">
              Connect your own AI provider credential and pay less for the Innvil platform fee — your own
              provider usage is billed separately by your provider, not covered by Innvil.
            </p>
            <p className="w-display text-xl">from ${WATCH_ENTERPRISE_BYO_TIERS[0].price.toFixed(0)}<span className="text-sm w-text-faint font-normal">/mo</span></p>
          </div>
        </div>
        <p className="text-xs w-text-faint text-center max-w-xl mx-auto mt-6">
          Neither option guarantees lower total spend — BYO only lowers the Innvil platform fee itself.
          Provisioning for either mode is completed with our team.
        </p>
        <div className="text-center mt-6">
          <Link href="/plans#enterprise" className="text-sm px-4 py-2 rounded-lg border w-line-soft w-surface inline-block hover:w-text">
            Compare Managed vs. BYO in detail
          </Link>
        </div>
      </section>

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
