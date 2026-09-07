"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  CheckCircle2, AlertCircle, Info, Clock, ArrowRight, Zap, ShieldCheck,
  Bot, MessageSquare, Gauge, ScrollText, Send, Radio, Activity, Users,
} from "lucide-react";
import { watchOnboardingSteps, watchPlanCapacityTable, type OnboardingCallout } from "@/src/lib/products/watch-onboarding";
import { MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";

const CALLOUT_STYLE: Record<OnboardingCallout["kind"], { icon: typeof Info; className: string; label: string }> = {
  "plan-limit": { icon: Info, className: "w-teal-soft-bg w-teal", label: "Plan limit" },
  "community-limit": { icon: Info, className: "w-amber-soft-bg w-amber", label: "Community limit" },
  "good-to-know": { icon: CheckCircle2, className: "w-surface-raised w-text-dim", label: "Good to know" },
  "required": { icon: AlertCircle, className: "w-red-soft-bg w-red", label: "Required" },
  "in-progress": { icon: Clock, className: "w-amber-soft-bg w-amber", label: "Rolling out" },
};

function Callout({ callout }: { callout: OnboardingCallout }) {
  const style = CALLOUT_STYLE[callout.kind];
  return (
    <div className={`rounded-lg p-3 flex items-start gap-2.5 ${style.className}`}>
      <style.icon size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 opacity-80">{style.label}</p>
        <p className="text-xs leading-relaxed">{callout.text}</p>
      </div>
    </div>
  );
}

/** The flowing "signal path" between two step cards — exits from the side
 *  where the previous step's stat card sat, curves to the opposite side for
 *  the next. Brightens for segments already reached while scrolling;
 *  degrades gracefully with motion disabled (static geometry, no JS layout
 *  math). */
function SignalConnector({ flip, active }: { flip: boolean; active: boolean }) {
  // Always a clearly visible teal line end-to-end -- "active" (already
  // scrolled past) only nudges a segment slightly brighter, a subtle
  // gradient rather than a stark on/off jump. No blinking/pulse here --
  // that language is reserved for "online" status dots elsewhere, not an
  // ambient connecting line.
  const stroke = "#2DD4BF";
  const path = flip ? "M24,4 C24,34 116,26 116,56" : "M116,4 C116,34 24,26 24,56";
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <svg width="140" height="60" viewBox="0 0 140 60" className="overflow-visible">
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" opacity={active ? 0.7 : 0.5} />
        <circle cx={flip ? 24 : 116} cy="4" r="3.5" fill={stroke} opacity={active ? 0.9 : 0.6} />
        <circle cx={flip ? 116 : 24} cy="56" r="3.5" fill={stroke} opacity={active ? 0.9 : 0.6} />
      </svg>
    </div>
  );
}

/** A short internal connector tying two related concepts together inside a
 *  stat card (Project → Community → Watcher) — the same curved-signal
 *  language as the between-step connector, never a plain arrow/rule. */
function InlineLink() {
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden="true" className="shrink-0">
      <path d="M0,7 C13,2 27,12 40,7" fill="none" stroke="#2DD4BF" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

function CardTag({ children }: { children: React.ReactNode }) {
  return <span className="text-[9px] uppercase tracking-wide w-text-faint font-semibold">{children}</span>;
}

function StatCardShell({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="w-card-raised border w-line-soft rounded-xl p-5 h-full flex flex-col justify-center min-h-[220px]">
      <div className="mb-3"><CardTag>{tag}</CardTag></div>
      {children}
    </div>
  );
}

function GuideSide({
  title, n, summary, body, callouts, cta,
}: {
  title: string; n: string; summary: string; body: string[]; callouts: OnboardingCallout[];
  cta?: { label: string; href: string };
}) {
  return (
    <div>
      <div className="w-mono text-xl w-teal mb-1">{n}</div>
      <h3 className="w-display text-xl mb-2">{title}</h3>
      <p className="text-sm w-text-dim mb-4">{summary}</p>
      <div className="space-y-2 mb-4">
        {body.map((p, i) => <p key={i} className="text-sm w-text leading-relaxed">{p}</p>)}
      </div>
      {callouts.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] uppercase tracking-wide w-text-faint font-semibold mb-2">Good to know</p>
          <div className="space-y-2">
            {callouts.map((c, i) => <Callout key={i} callout={c} />)}
          </div>
        </div>
      )}
      {cta && (
        <a href={cta.href} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-1.5">
          {cta.label} <ArrowRight size={14} />
        </a>
      )}
    </div>
  );
}

/**
 * Scroll-driven "Getting Started" guide. Every step is a two-part
 * composition — a substantial visual/stat card + the real guide text —
 * alternating which side the stat card sits on, connected by a flowing
 * signal-path SVG instead of a plain line. Each stat card's INTERNAL layout
 * is distinct per concept (account checklist, plan numbers, project
 * profile mockup, connection diagram, Watcher identity, relationship
 * diagram, feature modules, mini status dashboard). All numbers come from
 * watch-onboarding.ts, which derives every limit from the same constants
 * the backend enforces — nothing here is user-specific for an
 * unauthenticated visitor, every stat card is explicitly labeled a preview
 * or example.
 */
export function WatchOnboardingGuide() {
  const steps = watchOnboardingSteps();
  const capacityTable = watchPlanCapacityTable();
  const exampleTier = capacityTable.find((p) => p.displayName === "Gold") ?? capacityTable[2];
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = refs.current.findIndex((el) => el === entry.target);
            if (idx !== -1) setActiveIndex(idx);
          }
        }
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0 }
    );
    for (const el of refs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const step = (i: number) => steps[i];
  // Stat card sits left on even (0-indexed) steps, right on odd ones —
  // the connector's exit side (below) tracks the same alternation.
  const statLeft = (i: number) => i % 2 === 0;

  const statCards: React.ReactNode[] = [
    // 01 — Account: status checklist
    <StatCardShell tag="Account status" key="s0">
      <p className="w-display text-lg w-teal mb-3">Ready</p>
      <div className="space-y-2 mb-4">
        {["Innvil Account", "Watch access", "Secure workspace"].map((t) => (
          <div key={t} className="flex items-center gap-2 text-sm w-text"><CheckCircle2 size={14} className="w-teal shrink-0" />{t}</div>
        ))}
      </div>
      <div className="border-t w-line-soft pt-3">
        <p className="text-[10px] w-text-faint uppercase tracking-wide mb-1">Product access</p>
        <p className="text-sm w-text flex items-center gap-1.5"><Zap size={13} className="w-teal" /> Innvil Watch</p>
      </div>
    </StatCardShell>,

    // 02 — Plan: 3-stat grid
    <StatCardShell tag={`Example: ${exampleTier.displayName}`} key="s1">
      <p className="w-display text-2xl mb-4">{exampleTier.displayName}</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div><p className="w-display text-2xl w-teal">{exampleTier.watcherSlots}</p><p className="text-[10px] w-text-faint uppercase">Watchers</p></div>
        <div><p className="w-display text-2xl w-teal">{exampleTier.communities}</p><p className="text-[10px] w-text-faint uppercase">Communities</p></div>
      </div>
      <div className="border-t w-line-soft pt-3">
        <p className="w-display text-lg">${exampleTier.price.toFixed(2)}<span className="text-xs w-text-faint font-normal"> / mo</span></p>
      </div>
    </StatCardShell>,

    // 03 — Project: profile mockup
    <StatCardShell tag="Project profile · preview" key="s2">
      <div className="space-y-2.5">
        <div><p className="text-[10px] w-text-faint uppercase mb-1">Name</p><div className="h-2.5 w-2/3 rounded" style={{ background: "var(--w-line)" }} /></div>
        <div><p className="text-[10px] w-text-faint uppercase mb-1">Description</p><div className="h-2.5 w-full rounded" style={{ background: "var(--w-line)" }} /></div>
        <div><p className="text-[10px] w-text-faint uppercase mb-1">Website</p><div className="h-2.5 w-1/2 rounded" style={{ background: "var(--w-line)" }} /></div>
      </div>
      <span className="w-pill w-teal-soft-bg w-teal mt-4 self-start">Knowledge isolated</span>
    </StatCardShell>,

    // 04 — Community: connection diagram
    <StatCardShell tag="Community connection · preview" key="s3">
      <div className="flex items-center justify-center gap-2 mb-4">
        <div className="w-11 h-11 rounded-full w-surface-raised border w-line-soft flex items-center justify-center"><Send size={16} className="w-text-dim" /></div>
        <InlineLink />
        <div className="w-11 h-11 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center"><Bot size={16} className="w-teal" /></div>
      </div>
      <p className="text-xs w-text-faint text-center mb-3">Not connected yet</p>
      <div className="space-y-1.5">
        {["Telegram group present", "Admin rights granted", "Verified by Innvil"].map((t) => (
          <div key={t} className="flex items-center gap-2 text-xs w-text-dim"><span className="w-1.5 h-1.5 rounded-full w-teal-bg shrink-0" />{t}</div>
        ))}
      </div>
    </StatCardShell>,

    // 05 — Watcher: identity + capacity
    <StatCardShell tag="Watcher profile · preview" key="s4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full w-teal-soft-bg border w-teal-border flex items-center justify-center shrink-0"><Bot size={20} className="w-teal" /></div>
        <div><p className="w-display text-sm w-text">Your Watcher</p><p className="text-xs w-text-faint">Unconfigured</p></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><p className="w-display text-xl w-teal">{exampleTier.watcherSlots}</p><p className="text-[10px] w-text-faint uppercase">Total slots ({exampleTier.displayName})</p></div>
        <div><p className="w-display text-xl w-teal">{MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY}</p><p className="text-[10px] w-text-faint uppercase">Per community</p></div>
      </div>
    </StatCardShell>,

    // 06 — Deploy: relationship diagram
    <StatCardShell tag="Deployment · preview" key="s5">
      <div className="flex flex-col items-center gap-1 mb-4">
        <span className="w-pill w-surface-raised w-text-dim">Project</span>
        <InlineLink />
        <span className="w-pill w-surface-raised w-text-dim">Community</span>
        <InlineLink />
        <span className="w-pill w-teal-soft-bg w-teal">Watcher</span>
      </div>
      <div className="border-t w-line-soft pt-3 text-center">
        <span className="w-pill w-green-soft-bg w-green"><span className="w-pulse-dot" /> Ready to deploy</span>
      </div>
    </StatCardShell>,

    // 07 — Configure: feature modules
    <StatCardShell tag="Behavior modules" key="s6">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="w-surface-raised rounded-lg p-3 text-center"><ShieldCheck size={16} className="w-teal mx-auto mb-1.5" /><p className="text-[11px] w-text">Moderation</p></div>
        <div className="w-surface-raised rounded-lg p-3 text-center"><Radio size={16} className="w-teal mx-auto mb-1.5" /><p className="text-[11px] w-text">Media safety</p></div>
        <div className="w-surface-raised rounded-lg p-3 text-center"><Gauge size={16} className="w-teal mx-auto mb-1.5" /><p className="text-[11px] w-text">Auto-Posting</p></div>
        <div className="w-surface-raised rounded-lg p-3 text-center"><ScrollText size={16} className="w-teal mx-auto mb-1.5" /><p className="text-[11px] w-text">Knowledge</p></div>
      </div>
    </StatCardShell>,

    // 08 — Live: mini status dashboard
    <StatCardShell tag="Example status" key="s7">
      <div className="flex items-center justify-between mb-3">
        <p className="w-display text-sm w-text">Kwan</p>
        <span className="w-pill w-green-soft-bg w-green"><span className="w-pulse-dot" /> Active</span>
      </div>
      <p className="text-xs w-text-dim flex items-center gap-1.5 mb-4"><Users size={12} /> @samplecommunity — Connected</p>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="w-surface-raised rounded-lg p-2.5"><p className="text-[10px] w-text-faint flex items-center gap-1"><ShieldCheck size={11} /> Spam blocked</p><p className="w-display text-base">18</p></div>
        <div className="w-surface-raised rounded-lg p-2.5"><p className="text-[10px] w-text-faint flex items-center gap-1"><Activity size={11} /> Answered</p><p className="w-display text-base">42</p></div>
      </div>
    </StatCardShell>,
  ];

  return (
    <section id="getting-started" aria-labelledby="getting-started-heading" className="max-w-5xl mx-auto px-6 py-20">
      <p className="text-xs w-mono uppercase w-teal tracking-wider text-center mb-2">Getting started</p>
      <h2 id="getting-started-heading" className="w-display text-3xl text-center mb-3">Set up your first Watcher</h2>
      <p className="w-text-dim text-center max-w-lg mx-auto mb-4">
        Follow the signal from account to a live Watcher in your community — scroll to move through each stage.
      </p>

      <nav aria-label="Setup steps" className="hidden lg:flex justify-center gap-1 mb-10 sticky top-[72px] z-20 py-2 backdrop-blur-sm" style={{ backgroundColor: "rgba(10,14,17,0.95)" }}>
        {steps.map((s, i) => (
          <a
            key={s.n}
            href={`#step-${s.n}`}
            aria-current={i === activeIndex ? "step" : undefined}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              i === activeIndex ? "w-teal-border w-teal-soft-bg w-teal" : "w-line-soft w-text-faint hover:w-text-dim"
            }`}
          >
            {s.n}
          </a>
        ))}
      </nav>

      <ol className="list-none">
        {steps.map((s, i) => (
          <React.Fragment key={s.n}>
            <li id={`step-${s.n}`} ref={(el) => { refs.current[i] = el; }} className="w-card p-6 sm:p-8 scroll-mt-24">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-6 items-center">
                <div className={`order-2 ${statLeft(i) ? "lg:order-1" : "lg:order-2"}`}>{statCards[i]}</div>
                <div className={`order-1 ${statLeft(i) ? "lg:order-2" : "lg:order-1"}`}>
                  <GuideSide title={s.title} n={s.n} summary={s.summary} body={s.body} callouts={s.callouts} cta={s.cta} />
                </div>
              </div>
            </li>
            {i < steps.length - 1 && <SignalConnector flip={!statLeft(i)} active={activeIndex >= i} />}
          </React.Fragment>
        ))}
      </ol>
    </section>
  );
}
