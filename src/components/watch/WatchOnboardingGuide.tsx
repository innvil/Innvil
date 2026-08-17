"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, Clock, ArrowRight } from "lucide-react";
import { watchOnboardingSteps, type OnboardingCallout } from "@/src/lib/products/watch-onboarding";

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
      <style.icon size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5 opacity-80">{style.label}</p>
        <p className="text-xs leading-relaxed">{callout.text}</p>
      </div>
    </div>
  );
}

/**
 * Scroll-driven "Getting Started" guide — one large step card per section,
 * a subtle sticky progress rail on desktop, plain vertical stacking on
 * mobile (no horizontal scroll, no accordion-only interaction — the guide
 * reads by scrolling). Content is data-driven from watch-onboarding.ts,
 * which itself derives every number from the same constants the backend
 * enforces.
 */
export function WatchOnboardingGuide() {
  const steps = watchOnboardingSteps();
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

  return (
    <section id="getting-started" aria-labelledby="getting-started-heading" className="max-w-5xl mx-auto px-6 py-20">
      <p className="text-xs w-mono uppercase w-teal tracking-wider text-center mb-2">Getting started</p>
      <h2 id="getting-started-heading" className="w-display text-3xl text-center mb-3">Set up your first Watcher</h2>
      <p className="w-text-dim text-center max-w-lg mx-auto mb-4">
        From account to a live Watcher in your community — what each step means, and what your plan controls along the way.
      </p>

      <nav
        aria-label="Setup steps"
        className="hidden lg:flex justify-center gap-1 mb-14 sticky top-[72px] z-20 py-2 backdrop-blur-sm"
        style={{ backgroundColor: "rgba(10,14,17,0.95)" }}
      >
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

      <ol className="space-y-8">
        {steps.map((step, i) => (
          <li
            key={step.n}
            id={`step-${step.n}`}
            ref={(el) => { refs.current[i] = el; }}
            className="w-card p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 scroll-mt-24"
          >
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="w-mono text-2xl w-teal">{step.n}</span>
                <h3 className="w-display text-xl">{step.title}</h3>
              </div>
              <p className="text-sm w-text-dim mb-4">{step.summary}</p>
              <div className="space-y-3">
                {step.body.map((p, pi) => (
                  <p key={pi} className="text-sm w-text leading-relaxed">{p}</p>
                ))}
              </div>
              {step.cta && (
                <a href={step.cta.href} className="w-btn-primary text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-1.5 mt-5">
                  {step.cta.label} <ArrowRight size={14} />
                </a>
              )}
            </div>
            <div className="space-y-3">
              {step.callouts.map((c, ci) => (
                <Callout key={ci} callout={c} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
