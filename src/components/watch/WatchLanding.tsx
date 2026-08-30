import React from "react";
import Link from "next/link";
import {
  ShieldCheck, MessageSquare, Gauge, Bot, ArrowRight, ScrollText, Activity,
  Radio, Zap, Users, Clock, Rocket, Server, KeyRound, Star, Check,
  HeartHandshake, LifeBuoy, Send, Fingerprint, Puzzle, MessageCircleQuestion, X, ShieldAlert,
} from "lucide-react";
import { WatchPricingSection } from "./WatchPricingSection";
import { WatchOnboardingGuide } from "./WatchOnboardingGuide";
import { WatchLogoutButton } from "./WatchLogoutButton";
import { WatchFooter } from "./WatchFooter";
import { watchPlanOptions } from "@/src/lib/products/watch-plans";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";
import { MEDIA_MODERATION_BASE_ALLOWANCE } from "@/src/lib/money";
// Client-safe canonical trial constants -- watch-trial.ts itself is
// server-only (full of DB functions); moderator/plan.ts is the plain,
// client-safe module those constants actually originate from, and is
// already used this way by WatchPricingSection.tsx (a client component
// rendered on this same page).
import { TRIAL_DURATION_DAYS } from "@/src/lib/moderator/plan";

/**
 * Innvil Watch's own public, standalone landing page — served on
 * watch.innvil.cloud (app/page.tsx branches on host). Deliberately its own
 * visual product: `.watch-root`/`w-*` design tokens (cool teal, modern
 * sans-serif, operational/monitoring language) — NOT the parent site's
 * `fp-root`/`fp-*` gold-editorial system, and NOT a copy of
 * PublicLanding.tsx's structure. Still visibly "by Innvil" via the shared
 * brand mark + explicit ecosystem links in the nav/footer.
 *
 * POSITIONING (2026-08-27): the whole page is written around the product
 * category "Virtual Moderators for Telegram" rather than "a moderation
 * bot" — every capability described below is real, already-shipped
 * behavior (graduated moderation, persona, Project-Knowledge-grounded
 * Q&A, multi-Watcher coordination, Smart Escalation, natural
 * conversation understanding). Nothing here documents a capability that
 * doesn't exist — a real "notify + welcome a new member on join" event
 * handler was investigated and confirmed NOT to exist anywhere in the
 * runtime (grepped event-types.ts/community-runtime.ts for
 * new_chat_member/left_chat_member/chat_member — zero matches), so no
 * "welcomes new members" claim is made anywhere on this page.
 *
 * REVISED (2026-08-29) — sharpened the differentiator: social PRESENCE,
 * not Q&A. "Present in the room, not just on command" now appears right
 * after the hero (PresenceCallout) instead of being buried lower on the
 * page, and is repeated again with more detail in PersonaSection. Natural
 * conversation/participation and project-aware answers are kept as two
 * visibly separate capabilities throughout (comparison table, pillars,
 * feature groups) rather than conflating "answers questions" with
 * "talks/participates". BYO 20 moved out of the main narrative flow and
 * down next to pricing, where it belongs commercially. The inline FAQ
 * accordion was removed outright (real dedicated FAQ content already
 * exists in the Help Center, linked from WatchFooter) rather than kept in
 * parallel.
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
          <a href="#what-is-a-watcher" className="hover:w-text">Watchers</a>
          <a href="#why-watchers" className="hover:w-text">Why Watchers?</a>
          <a href="#features" className="hover:w-text">Features</a>
          <a href="#pricing" className="hover:w-text">Pricing</a>
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

      {/* A real chat example, not just activity metrics -- demonstrates
          presence/participation, the actual differentiator, rather than
          leaving the visual read as a support-ticket dashboard. */}
      <div className="w-surface-raised rounded-lg p-3 mb-4 space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-[11px] w-text-faint shrink-0 w-14">Member</span>
          <span className="text-xs w-text-dim">gm</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-[11px] w-teal shrink-0 w-14">Kwan</span>
          <span className="text-xs w-text">gm!! 👋 how&apos;s your morning going?</span>
        </div>
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
          <p className="text-[11px] w-text-faint flex items-center gap-1"><MessageSquare size={12} /> Member interactions</p>
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

/** The bot vs. human moderator vs. Watcher comparison. Every "Watcher"
 *  claim maps to a real, already-shipped capability (including the
 *  honestly-qualified "where supported" on escalation — that capability
 *  requires a project to actually have an Escalation Group configured, so
 *  it's never stated as unconditional). This is the landing's own
 *  comprehensive comparison -- REVISED (2026-08-30) to also compare
 *  against a human moderator, not just a traditional bot, and expanded
 *  from 8 to 12 rows per explicit product direction; no longer the
 *  "shorter" version relative to /why-watchers. Ordered so the biggest
 *  differentiator (presence) comes first, moderation-adjacent rows later
 *  -- a Watcher is not primarily a moderation bot with extra features.
 *  Positioning throughout: Watchers close the gap between rigid
 *  automation and needing a human moderator online at all times -- never
 *  framed as "better than" or a replacement for a human team. */
const COMPARISON: Array<{ topic: string; bot: string; human: string; watcher: string }> = [
  { topic: "Presence", bot: "Reacts to commands or individual triggers", human: "Present only when someone is available", watcher: "Follows the conversation and stays present continuously" },
  { topic: "Conversation", bot: "Uses commands, canned replies, or fixed flows", human: "Can hold natural conversations", watcher: "Talks naturally with members in its configured persona" },
  { topic: "Understanding", bot: "Matches keywords, commands, or predefined patterns", human: "Understands context and intent naturally", watcher: "Understands messages and conversations by intent" },
  { topic: "Project Knowledge", bot: "Relies on predefined answers or static commands", human: "Depends on what the moderator personally knows", watcher: "Answers from your configured Project Knowledge" },
  { topic: "Personality", bot: "One generic bot voice", human: "Has a natural individual personality", watcher: "Has a configurable persona, tone, style, and identity" },
  { topic: "Moderation judgment", bot: "Uses keyword, regex, or rigid rule matching", human: "Can judge context and intent", watcher: "Recognizes violations by context and intent" },
  { topic: "Availability", bot: "Always running, but only reacts to programmed triggers", human: "Limited by shifts, availability, and staffing", watcher: "Continuously available for moderation and community operations" },
  { topic: "Consistency", bot: "Consistent, but rigid", human: "Can vary by moderator or shift", watcher: "Applies configured behavior consistently while still using context" },
  { topic: "Working as a team", bot: "Each bot usually acts independently", human: "Requires coordination between team members", watcher: "Multiple Watchers coordinate roles and avoid duplicate replies" },
  { topic: "Specialization", bot: "Usually built around individual commands/features", human: "Responsibilities depend on staff assignments", watcher: "Can have dedicated specialist roles such as Host, Knowledge, Spam & Scam, Media Safety, and Rules & Conduct" },
  { topic: "When it doesn't know", bot: "Returns a canned fallback or fails", human: "Can ask another team member", watcher: "Can use Project Knowledge and escalate when a human is needed, where supported" },
  { topic: "Scale / coverage", bot: "Easy to run, but limited in judgment", human: "More coverage requires more people and shifts", watcher: "Adds coordinated moderation coverage without requiring a human moderator online at every moment" },
];

/** One capability's comparison, stacked as a card -- the responsive
 *  fallback for screens below `lg`, where a real 4-column grid table would
 *  force narrow, wrapping, or clipped text. Same three-tier visual
 *  treatment as the desktop table (bot subdued, human neutral, watcher
 *  emphasized), just laid out vertically per row instead of across
 *  columns. */
function ComparisonCard({ row }: { row: (typeof COMPARISON)[number] }) {
  return (
    <div className="w-card p-4 space-y-3">
      <p className="w-text font-semibold text-sm">{row.topic}</p>
      <div className="flex items-start gap-2 text-xs">
        <span className="w-text-faint shrink-0 w-28 flex items-center gap-1"><X size={11} /> Traditional Bot</span>
        <span className="w-text-faint">{row.bot}</span>
      </div>
      <div className="flex items-start gap-2 text-xs">
        <span className="w-text-dim shrink-0 w-28 flex items-center gap-1"><Users size={11} /> Human Moderator</span>
        <span className="w-text-dim">{row.human}</span>
      </div>
      <div className="flex items-start gap-2 text-xs rounded-lg w-teal-soft-bg p-2 -mx-2">
        <span className="w-teal shrink-0 w-28 flex items-center gap-1 font-medium"><Check size={11} /> Innvil Watcher</span>
        <span className="w-text font-medium">{row.watcher}</span>
      </div>
    </div>
  );
}

function WhyWatchersSection() {
  return (
    <section id="why-watchers" className="max-w-6xl mx-auto px-6 py-16 scroll-mt-24">
      <p className="text-xs w-mono uppercase w-teal tracking-wider text-center mb-2">Why Watchers?</p>
      <h2 className="w-display text-2xl sm:text-3xl text-center mb-3">
        Traditional moderation bots enforce rules.<br className="hidden sm:block" /> Watchers actually help run the community.
      </h2>
      <p className="w-text-dim text-center max-w-2xl mx-auto mb-10">
        A Watcher sits between a traditional bot and a human moderator — it stays available like software, but
        follows the conversation, talks with members, and moderates with context instead of reacting only to
        commands and keywords.
      </p>

      {/* Desktop/tablet: a real 4-column grid table, comfortable spacing --
          hidden below lg where 3 full sentence-columns would force narrow,
          wrapping, or clipped text. */}
      <div className="hidden lg:block w-card overflow-hidden">
        <div className="grid grid-cols-[150px_1fr_1fr_1fr] text-[11px] uppercase tracking-wide font-semibold w-text-faint border-b w-line-soft">
          <div className="p-4"></div>
          <div className="p-4 flex items-center gap-1.5"><X size={12} className="w-text-faint" /> Traditional Bot</div>
          <div className="p-4 flex items-center gap-1.5 w-text-dim"><Users size={12} /> Human Moderator</div>
          <div className="p-4 flex items-center gap-1.5 w-teal"><Check size={12} /> Innvil Watcher</div>
        </div>
        {COMPARISON.map((row, i) => (
          <div
            key={row.topic}
            className={`grid grid-cols-[150px_1fr_1fr_1fr] text-sm ${i < COMPARISON.length - 1 ? "border-b w-line-soft" : ""}`}
          >
            <div className="p-4 w-text font-medium">{row.topic}</div>
            <div className="p-4 w-text-faint">{row.bot}</div>
            <div className="p-4 w-text-dim">{row.human}</div>
            <div className="p-4 w-text font-medium w-teal-soft-bg">{row.watcher}</div>
          </div>
        ))}
      </div>

      {/* Below lg: stacked cards, one per capability -- keeps every
          sentence fully readable instead of squeezing 3 content columns
          into a narrow viewport. */}
      <div className="lg:hidden space-y-3">
        {COMPARISON.map((row) => (
          <ComparisonCard key={row.topic} row={row} />
        ))}
      </div>
    </section>
  );
}

/** The strongest differentiator, moved much higher on the page (was buried
 *  in PersonaSection further down, which still carries a fuller treatment
 *  of the same idea -- repeating it, not replacing it, per the product
 *  requirement to make this visible early and consistently). */
function PresenceCallout() {
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="w-card-raised p-6 sm:p-8 text-center max-w-3xl mx-auto">
        <p className="text-xs w-mono uppercase w-teal tracking-wider mb-2">Present in the room, not just on command</p>
        <p className="w-text-dim leading-relaxed">
          A Watcher follows the conversation and decides when a moderator should actually speak. It can respond
          to a &quot;gm,&quot; answer a member, step into a moderation issue, or stay quiet when nothing needs
          its attention.
        </p>
      </div>
    </section>
  );
}

/** The Four Pillars — a compact, quick-scan strip. Escalate references
 *  Smart Escalation, which is a real, currently-live capability (shipped
 *  as v1.47.73) -- stated plainly, not hedged as "coming soon". */
const PILLARS: Array<{ icon: typeof ShieldCheck; title: string; body: string }> = [
  { icon: ShieldCheck, title: "Protect", body: "Graduated moderation for spam, scam links, and unsafe media — enforced by intent, not just keywords." },
  { icon: HeartHandshake, title: "Engage", body: "Joins conversations naturally when appropriate, using the persona and voice you configure." },
  { icon: LifeBuoy, title: "Support", body: "Answers project-specific questions using the knowledge you provide, without inventing project facts." },
  { icon: Send, title: "Escalate", body: "When something needs a human, the Watcher can bring your team in — while keeping a structured record of its moderation actions." },
];

function PillarsSection() {
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {PILLARS.map((p) => (
          <div key={p.title} className="w-card p-4">
            <p.icon size={18} className="w-teal mb-2.5" />
            <p className="w-display text-sm mb-1">{p.title}</p>
            <p className="text-xs w-text-dim leading-relaxed">{p.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Knows the rules — and enforces them": grounds the existing graduated
 *  moderation system (real: unsolicited-promotion/link-spam get a
 *  warning-first escalation, phishing/scam and explicit content are
 *  enforced immediately at high confidence) as a proof point that a
 *  Watcher does what a human moderator would normally be expected to do. */
function ModerationResponsibilitySection() {
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="w-card-raised p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_1.05fr] gap-8 items-center">
        <div>
          <p className="text-xs w-mono uppercase w-teal tracking-wider mb-2">Knows the rules — and enforces them</p>
          <h2 className="w-display text-2xl mb-3">Judgment, not just a keyword filter.</h2>
          <p className="text-sm w-text-dim leading-relaxed mb-3">
            A Watcher can distinguish between behavior that deserves a warning and behavior that needs
            immediate action.
          </p>
          <p className="text-sm w-text-dim leading-relaxed mb-3">
            Unsolicited promotion and link spam get a real warning first — escalating only on repeat offenses.
            Phishing/scam links and explicit content, at high confidence, are treated as safety issues and acted
            on immediately.
          </p>
          <p className="text-sm w-text-dim leading-relaxed">
            Warnings are phrased naturally, in the Watcher&apos;s own configured voice — never a robotic
            &quot;Violation 2/3&quot; template repeated word-for-word.
          </p>
        </div>
        <div className="w-card p-5">
          <div className="flex items-start gap-2.5 mb-3">
            <div className="w-7 h-7 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center shrink-0">
              <Bot size={13} className="w-teal" />
            </div>
            <div className="w-surface-raised rounded-lg rounded-tl-sm p-3 text-xs w-text-dim leading-relaxed">
              Hey @newuser, that&apos;s the second promotional post I&apos;ve had to remove — please keep
              promotional links out of this community. Another one may result in further action.
            </div>
          </div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mt-4 mb-1">Example warning</p>
          <p className="text-[11px] w-text-faint">Graduated enforcement, phrased in the Watcher&apos;s own persona — not a canned message.</p>
        </div>
      </div>
    </section>
  );
}

/** "It speaks Telegram": crypto/Telegram shorthand understanding. Explicit
 *  safety caveat, per product requirement — understanding a question is
 *  never presented as license to invent an answer. */
function CryptoNativeSection() {
  const examples = ["ca?", "wen distro?", "socials?", "mc?"];
  const terms = ["TG", "CEX", "DEX", "TGE", "WL", "LP", "ATH", "FUD", "GM", "GN", "AMA", "tokenomics", "vesting", "claim"];
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="w-card-raised p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-8 items-center">
        <div className="w-card p-5 order-2 lg:order-1">
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-3">Shorthand a Watcher understands</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {examples.map((e) => (
              <span key={e} className="w-pill w-surface-raised w-text-dim font-mono text-xs">{e}</span>
            ))}
          </div>
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">Common terms</p>
          <div className="flex flex-wrap gap-1.5">
            {terms.map((t) => (
              <span key={t} className="text-[11px] px-2 py-0.5 rounded-full w-surface-raised w-text-faint">{t}</span>
            ))}
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <p className="text-xs w-mono uppercase w-teal tracking-wider mb-2 flex items-center gap-1.5">
            <MessageCircleQuestion size={13} /> It speaks Telegram
          </p>
          <h2 className="w-display text-2xl mb-3">Understands the shorthand your community actually uses.</h2>
          <p className="text-sm w-text-dim leading-relaxed mb-3">
            Members don&apos;t need to phrase things like support tickets. A Watcher understands the shorthand,
            slang, and abbreviated questions common in Telegram and crypto communities.
          </p>
          <p className="text-sm w-text-dim leading-relaxed">
            <strong className="w-text font-medium">Understanding what someone means isn&apos;t permission to
            invent an answer.</strong> Project-specific facts still come from the knowledge you provide.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Persona + natural participation, combined into one section. Example
 *  persona names ("Mr. Pres" / "Ms. VP") are illustrative sample data,
 *  same convention already used for "Kwan" in WatchOpsPanel above. */
function PersonaSection() {
  return (
    <section className="max-w-5xl mx-auto px-6 pb-16">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="w-card p-6">
          <Fingerprint size={18} className="w-teal mb-3" />
          <p className="w-display text-lg mb-1">A real persona, not one generic voice</p>
          <p className="text-sm w-text-dim leading-relaxed mb-3">
            Configure a Watcher&apos;s tone, formality, humor, and role from a curated preset, or write your own
            from scratch. &quot;Mr. Pres&quot; and &quot;Ms. VP&quot; can sound nothing alike — one calm and
            formal, the other playful and terse — while both stay grounded in the same rules and knowledge.
          </p>
          <p className="text-xs w-text-faint">A Watcher can acknowledge that it&apos;s AI without dropping the identity and personality you&apos;ve configured for it.</p>
        </div>
        <div className="w-card p-6">
          <Users size={18} className="w-teal mb-3" />
          <p className="w-display text-lg mb-1">Present in the room, not just on command</p>
          <p className="text-sm w-text-dim leading-relaxed mb-3">
            A Watcher responds naturally when addressed and participates more selectively in general
            conversation. It considers what has already been said, who has already replied, and whether its
            input is actually useful. Sometimes the right moderator response is no response at all.
          </p>
          <p className="text-xs w-text-faint">When multiple Watchers are present, they coordinate so the room doesn&apos;t fill with duplicate replies.</p>
        </div>
      </div>
    </section>
  );
}

/** Positions Watch as complementary to existing utility bots (e.g. Rose),
 *  never a required replacement — pure positioning, no technical
 *  dependency claim. */
function ComplementarySection() {
  return (
    <section className="max-w-4xl mx-auto px-6 pb-16">
      <div className="w-card p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
        <div className="w-11 h-11 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center shrink-0">
          <Puzzle size={19} className="w-teal" />
        </div>
        <div>
          <p className="w-display text-lg mb-1">Works alongside the tools you already use</p>
          <p className="text-sm w-text-dim leading-relaxed">
            Gatekeeping and utility bots like Rose handle rules, entry checks, commands, and utilities. Watchers
            handle the human side of community operations: conversation, context-aware moderation, member
            support, and presence.
          </p>
        </div>
      </div>
    </section>
  );
}

const FEATURE_GROUPS: Array<{ label: string; items: Array<{ icon: typeof ShieldCheck; title: string; body: string }> }> = [
  {
    label: "Protect",
    items: [
      { icon: ShieldCheck, title: "Spam & scam moderation", body: "Automatic detection and graduated enforcement for unsolicited promotion, link spam, and phishing/scam links." },
      { icon: Radio, title: "Media safety", body: "Photo and video moderation, so unsafe media doesn't sit in your community." },
    ],
  },
  {
    label: "Engage",
    items: [
      { icon: MessageSquare, title: "Natural participation", body: "Watchers follow the conversation and respond when appropriate — whether they're greeted, directly addressed, or have something useful to contribute." },
      { icon: ScrollText, title: "Project-aware answers", body: "When members ask about your project, answers are grounded in the knowledge you provide." },
    ],
  },
  {
    label: "Operate",
    items: [
      { icon: Gauge, title: "Auto-Posting", body: "Schedule per-Watcher posting windows so your community stays active." },
      { icon: Activity, title: "Activity & status", body: "Track your Watcher's status and activity from one place." },
      { icon: ShieldAlert, title: "Watcher Ops reports", body: "A private, structured record of every warning, mute, kick, and purge — who was actioned, why, and whether it succeeded." },
    ],
  },
];

const STEPS = [
  { n: "01", title: "Connect Telegram", body: "Verify your Telegram account, then try Watch with a Free Trial or a paid plan." },
  { n: "02", title: "Create a Watcher", body: "Give it a name, persona, role, and project knowledge." },
  { n: "03", title: "Deploy it", body: "Connect your Watcher's bot to your Telegram Community." },
  { n: "04", title: "Go live", body: "Your Watcher joins the community — participating, moderating, answering questions, and posting on schedule if enabled." },
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

export function WatchLanding({ authenticated }: { authenticated: boolean }) {
  const options = watchPlanOptions();
  const byo20 = options.find((o) => o.tier === "byo20")!;
  return (
    <div id="top" className="watch-root min-h-screen">
      <WatchNav authenticated={authenticated} />

      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span className="w-pill w-teal-soft-bg w-teal mb-5">
            <Zap size={12} /> Virtual Moderators for Telegram
          </span>
          <h1 className="w-display text-4xl sm:text-5xl leading-[1.08] mb-6">
            Watchers that do more than watch.
          </h1>
          <p className="w-text-dim text-lg mb-2 max-w-md">
            <strong className="w-text font-semibold">Watchers</strong> are virtual moderators that talk with
            members, moderate with judgment, answer from your Project Knowledge, and help keep your Telegram
            community running — even when your team is away.
          </p>
          <p className="w-text-dim text-lg mb-4 max-w-md">Each Watcher has its own persona, voice, and specialist role.</p>
          <p className="text-sm w-teal flex items-center gap-1.5 mb-8">
            <Clock size={14} /> Try a Watcher free for {TRIAL_DURATION_DAYS} days — no payment required.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/signup" className="w-btn-primary text-sm font-semibold px-5 py-3 rounded-lg flex items-center gap-1.5">
              Start Free Trial <ArrowRight size={14} />
            </Link>
            <a href="#why-watchers" className="text-sm px-5 py-3 rounded-lg border w-line-soft w-surface w-text-dim hover:w-text">
              See how Watchers work
            </a>
          </div>
        </div>
        <WatchOpsPanel />
      </section>

      <WhyWatchersSection />

      <PresenceCallout />

      <PillarsSection />

      <section id="what-is-a-watcher" className="max-w-6xl mx-auto px-6 pb-16">
        <div className="w-card-raised border w-teal-border p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-8 items-center">
          <div>
            <p className="text-xs w-mono uppercase w-teal tracking-wider mb-2">What is a Watcher?</p>
            <h2 className="w-display text-2xl mb-3">An AI-powered Virtual Moderator you deploy to your Community.</h2>
            <p className="text-sm w-text-dim leading-relaxed mb-3">
              A Watcher is a virtual moderator with its own identity, voice, knowledge, and behavior. Once
              deployed, it becomes an active presence in your Telegram community — participating in
              conversation, helping members, moderating when necessary, and operating according to the settings
              you choose.
            </p>
            <p className="text-sm w-text-dim leading-relaxed mb-4">
              A <strong className="w-text font-medium">Community</strong> is the actual Telegram group,
              supergroup, or channel you connect. Each Watcher can be deployed to one or more Communities, and
              every active Watcher-to-Community deployment uses one <strong className="w-text font-medium">Watcher slot</strong>.
            </p>
            <Link href="/why-watchers" className="text-sm w-teal font-semibold hover:underline inline-flex items-center gap-1">
              See the full Watcher vs. moderation-bot comparison <ArrowRight size={13} />
            </Link>
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

      <ModerationResponsibilitySection />

      <CryptoNativeSection />

      <PersonaSection />

      <ComplementarySection />

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

      <section className="max-w-5xl mx-auto px-6 pb-16">
        <h2 className="w-display text-xl text-center mb-8">Who is Watch for?</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          {[
            { title: "Crypto & Web3 communities", body: "Keep conversation active while handling spam, scams, repetitive questions, and member engagement." },
            { title: "Growing Telegram communities", body: "Add moderation coverage without relying on a human admin being online every hour." },
            { title: "Projects with active member support", body: "Let members get project-aware help while the Watcher still behaves like part of the community." },
            { title: "Teams running several communities", body: "Deploy distinct Watchers with different personas across multiple groups." },
          ].map((u) => (
            <div key={u.title} className="w-card p-4">
              <p className="w-display text-sm mb-1">{u.title}</p>
              <p className="text-xs w-text-dim leading-relaxed">{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="free-trial-cta" className="max-w-3xl mx-auto px-6 pb-16 text-center">
        <div className="w-card-raised border w-teal-border p-8">
          <Rocket size={22} className="w-teal mx-auto mb-3" />
          <h2 className="w-display text-xl mb-2">See what it feels like to have a Watcher in your community.</h2>
          <p className="w-text-dim text-sm mb-5">Deploy one free for {TRIAL_DURATION_DAYS} days. No payment required.</p>
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

      {/* The full 8-step setup walkthrough is real documentation depth, not
          primary sales copy -- collapsed by default (native <details>, no
          client-side state needed on this server component) so it stays
          available without competing with the sections above for
          attention. The short 4-step "How it works" above already sells
          the value; this explains the implementation. */}
      <details className="group">
        <summary className="cursor-pointer text-sm w-teal font-semibold text-center list-none flex items-center justify-center gap-1.5 py-4">
          See the full setup guide, step by step
          <span className="group-open:rotate-180 transition-transform">▾</span>
        </summary>
        <WatchOnboardingGuide />
      </details>

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

      {/* BYO 20 moved lower, into the pricing area -- it's a self-serve
          plan promotion, not a core product differentiator, so it no
          longer competes for attention with the earlier sections that
          explain what a Watcher actually does. */}
      <section id="byo20" className="max-w-5xl mx-auto px-6 pb-16 scroll-mt-24">
        <div className="w-card-raised border w-teal-border p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-8 items-center relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full w-teal-soft-bg blur-3xl opacity-40 -translate-y-1/2 translate-x-1/3" aria-hidden="true" />
          <div className="relative">
            <span className="inline-flex w-fit items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full mb-4 w-teal-soft-bg w-teal">
              <Star size={11} /> Best value plan
            </span>
            <h2 className="w-display text-2xl sm:text-3xl mb-3">
              BYO 20 — everything included. Bring your own AI.
            </h2>
            <p className="w-text-dim text-sm leading-relaxed mb-5 max-w-md">
              One flat price for the most Watch offers as a self-serve plan. Connect your own AI provider
              credential (Anthropic or an OpenAI-compatible provider) and Innvil never charges you for AI usage
              on top of the plan price — self-serve, purchase it right now, no sales call required.
            </p>
            <ul className="space-y-2 mb-6 text-sm w-text-dim">
              <li className="flex items-center gap-2"><Check size={15} className="w-teal shrink-0" /> {byo20.slots} Watcher slots</li>
              <li className="flex items-center gap-2"><Check size={15} className="w-teal shrink-0" /> {byo20.communitiesIncluded} Communities — already the max, nothing more to unlock</li>
              <li className="flex items-center gap-2"><Check size={15} className="w-teal shrink-0" /> {MEDIA_MODERATION_BASE_ALLOWANCE.byo20.toLocaleString()} Media Moderation units/mo included, plus optional capacity packs</li>
              <li className="flex items-center gap-2"><Check size={15} className="w-teal shrink-0" /> Same Innvil Credit discounts as every other plan</li>
            </ul>
            <a href="#pricing" className="w-btn-primary text-sm font-semibold px-5 py-3 rounded-lg inline-flex items-center gap-1.5">
              Get BYO 20 <ArrowRight size={14} />
            </a>
            <p className="text-xs w-text-faint mt-3">
              Not the same as Enterprise BYO — this is a self-serve plan; Enterprise BYO is manually provisioned for larger, custom deployments.
            </p>
          </div>
          <div className="relative w-card p-6 text-center">
            <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">BYO 20 · monthly</p>
            <p className="w-display text-4xl mb-1">
              ${byo20.price.toFixed(2)}<span className="text-base w-text-faint font-normal">/mo</span>
            </p>
            <p className="text-xs w-text-faint mb-5">Bring your own AI provider credential</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="w-surface-raised rounded-lg p-2.5">
                <p className="w-display text-lg w-teal">{byo20.slots}</p>
                <p className="text-[10px] w-text-faint">slots</p>
              </div>
              <div className="w-surface-raised rounded-lg p-2.5">
                <p className="w-display text-lg w-teal">{byo20.communitiesIncluded}</p>
                <p className="text-[10px] w-text-faint">communities</p>
              </div>
              <div className="w-surface-raised rounded-lg p-2.5">
                <p className="w-display text-lg w-teal">{(MEDIA_MODERATION_BASE_ALLOWANCE.byo20 / 1000).toFixed(1).replace(/\.0$/, "")}K</p>
                <p className="text-[10px] w-text-faint">media units</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <WatchPricingSection options={options} authenticated={authenticated} />

      <WatchFooter />
    </div>
  );
}
