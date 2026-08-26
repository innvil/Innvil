import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ShieldCheck, MessageSquare, BookOpen, HelpCircle, Send, RotateCcw, BadgeCheck,
  History, UserCog, Users, Check, X, ArrowRight, LifeBuoy, Code2, Lock, Radio,
} from "lucide-react";
import { isWatchHost } from "@/src/lib/watch-host";
import { PublicDocsShell } from "@/src/components/watch/PublicDocsShell";

export const metadata: Metadata = {
  title: "Why Watchers? — Innvil Watch",
  description: "Traditional moderation bots react to commands and filters. Watchers behave more like virtual community staff.",
  icons: { icon: "/watch/app-tile.svg" },
};

const CAPABILITIES: Array<{ icon: typeof ShieldCheck; title: string; body: string }> = [
  { icon: ShieldCheck, title: "Moderate 24/7", body: "Detect spam, scams, prohibited promotions, NSFW content, and community-rule violations." },
  { icon: MessageSquare, title: "Talk like a real community moderator", body: "Respond naturally to members instead of behaving like a command-only bot." },
  { icon: BookOpen, title: "Answer from your project knowledge", body: "Give members useful answers based on your approved documentation, FAQs, and project information." },
  { icon: HelpCircle, title: "Know when not to guess", body: "When a verified answer is unavailable, Watchers can escalate the question instead of hallucinating." },
  { icon: Send, title: "Escalate directly to your team", body: "Unresolved questions can be sent to a private Watcher Ops group where authorized admins provide the answer — the same group also gets a real audit trail of every warning, mute, kick, and purge a Watcher takes." },
  { icon: RotateCcw, title: "Bring the answer back to the community", body: "Once your team responds, the Watcher can update the original conversation automatically." },
  { icon: BadgeCheck, title: "Learn approved answers", body: "Admin responses can become reusable project knowledge so the same question does not need to be answered repeatedly." },
  { icon: History, title: "Remember conversation context", body: "Watchers can use recent community context to understand follow-up questions and previous interactions." },
  { icon: UserCog, title: "Have their own role and personality", body: "Create different Watchers for community management, support, security, technical questions, or other responsibilities." },
  { icon: Users, title: "Work together in the same community", body: "Deploy multiple Watchers with different roles instead of relying on one generic moderation bot." },
];

const COMPARISON: Array<[string, string]> = [
  ["Filters keywords", "Understands message context"],
  ["Responds to commands", "Participates naturally"],
  ["Deletes spam", "Moderates and communicates"],
  ["Generic bot identity", "Configurable role and persona"],
  ["Basic FAQ responses", "Answers from project knowledge"],
  ["Stops when it does not know", "Escalates to your team"],
  ["Requires manual follow-up", "Returns verified answers automatically"],
  ["One generic function set", "Multiple specialized Watchers"],
  ["Mostly reactive", "Continuously active"],
];

const ROLES: Array<{ icon: typeof Users; title: string; body: string }> = [
  { icon: Users, title: "Community Watcher", body: "Welcomes members, answers questions, maintains engagement, and handles everyday moderation." },
  { icon: Lock, title: "Security Watcher", body: "Focuses on scams, impersonation, suspicious links, and high-risk activity." },
  { icon: LifeBuoy, title: "Support Watcher", body: "Handles FAQs, project questions, troubleshooting, and member support." },
  { icon: Code2, title: "Technical Watcher", body: "Answers technical questions using approved documentation and escalates anything requiring developer input." },
];

const PER_WATCHER_CONFIG = ["Name", "Persona", "Role", "Responsibilities", "Knowledge", "Moderation rules", "Permissions", "Community deployments"];

export default async function WhyWatchersPage() {
  if (!(await isWatchHost())) redirect("/");

  return (
    <PublicDocsShell eyebrow="Why Watchers?">
      <div className="space-y-20 pb-10">
        {/* ---------------------------------------------------------- hero ---- */}
        <section className="max-w-3xl mx-auto text-center pt-6">
          <p className="text-xs uppercase tracking-wide w-teal font-semibold mb-3">Why Watchers?</p>
          <h1 className="w-display text-3xl sm:text-4xl mb-4 leading-tight">More than moderation. Watchers actually work your community.</h1>
          <p className="text-sm w-text-dim leading-relaxed mb-2">
            Traditional moderation bots react to commands and filters. <span className="w-text font-medium">Watchers behave more like virtual community staff.</span>
          </p>
          <p className="text-sm w-text-dim leading-relaxed">
            They can moderate conversations, answer questions from your project knowledge, engage naturally with members, remember recent context, and escalate unresolved questions to your team.
          </p>
        </section>

        {/* --------------------------------------------------- capabilities ---- */}
        <section>
          <h2 className="w-display text-xl text-center mb-8">Watchers can</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="w-card p-5">
                <div className="w-9 h-9 rounded-lg w-teal-soft-bg border w-teal-border flex items-center justify-center mb-3">
                  <c.icon size={16} className="w-teal" />
                </div>
                <p className="text-sm font-semibold w-text mb-1">{c.title}</p>
                <p className="text-xs w-text-dim leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------- comparison ---- */}
        <section className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="w-display text-xl mb-1">A moderation bot waits for instructions.</h2>
            <h2 className="w-display text-xl w-teal">A Watcher does the job.</h2>
          </div>
          <div className="w-card p-0 overflow-hidden">
            <div className="grid grid-cols-2 text-[11px] uppercase tracking-wide w-text-faint font-semibold border-b w-line-soft">
              <div className="px-4 py-3 border-r w-line-soft">Traditional Moderation Bot</div>
              <div className="px-4 py-3">Innvil Watcher</div>
            </div>
            {COMPARISON.map(([bot, watcher], i) => (
              <div key={i} className="grid grid-cols-2 text-sm border-b w-line-soft last:border-0">
                <div className="px-4 py-3 border-r w-line-soft flex items-start gap-2 w-text-dim">
                  <X size={13} className="text-red-400 shrink-0 mt-0.5" /> {bot}
                </div>
                <div className="px-4 py-3 flex items-start gap-2 w-text">
                  <Check size={13} className="w-teal shrink-0 mt-0.5" /> {watcher}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------- flow ---- */}
        <section className="max-w-2xl mx-auto text-center">
          <h2 className="w-display text-xl mb-3">Your team only steps in when needed.</h2>
          <p className="text-sm w-text-dim leading-relaxed mb-2">
            Watchers handle routine community work continuously. When a question requires information or authority that only your team has, the Watcher sends it to the appropriate admins for clarification.
          </p>
          <p className="text-sm w-text-dim leading-relaxed mb-6">
            Your team provides the answer once. The Watcher handles the rest.
          </p>
          <div className="w-card inline-flex flex-wrap items-center justify-center gap-2 px-5 py-3 text-sm font-medium w-text">
            {["Ask", "Verify", "Escalate", "Resolve", "Learn"].map((step, i, arr) => (
              <span key={step} className="flex items-center gap-2">
                <span>{step}</span>
                {i < arr.length - 1 && <ArrowRight size={13} className="w-text-faint" />}
              </span>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------------- roles ---- */}
        <section>
          <h2 className="w-display text-xl text-center mb-2">Build your virtual community team.</h2>
          <p className="text-sm w-text-dim text-center mb-8">Create Watchers with different jobs.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {ROLES.map((r) => (
              <div key={r.title} className="w-card p-5">
                <div className="w-9 h-9 rounded-lg w-teal-soft-bg border w-teal-border flex items-center justify-center mb-3">
                  <r.icon size={16} className="w-teal" />
                </div>
                <p className="text-sm font-semibold w-text mb-1">{r.title}</p>
                <p className="text-xs w-text-dim leading-relaxed">{r.body}</p>
              </div>
            ))}
          </div>
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-xs w-text-faint uppercase tracking-wide font-semibold mb-3">Each Watcher can have its own</p>
            <div className="flex flex-wrap justify-center gap-2">
              {PER_WATCHER_CONFIG.map((item) => (
                <span key={item} className="w-pill text-xs w-text-dim">{item}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- closing ---- */}
        <section className="max-w-2xl mx-auto text-center border-t w-line-soft pt-14">
          <Radio size={18} className="w-teal mx-auto mb-4" />
          <h2 className="w-display text-xl mb-3">Your Telegram should not depend on whether a moderator is online.</h2>
          <p className="text-sm w-text-dim leading-relaxed mb-6">
            Watchers operate continuously, respond consistently, and escalate when human input is actually required.
          </p>
          <p className="text-sm w-text font-medium leading-relaxed mb-8">
            Innvil Watch gives your community a virtual moderator that can moderate, communicate, remember, escalate, and operate 24/7.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" className="w-btn-primary text-sm font-semibold px-5 py-2.5 rounded-lg flex items-center gap-1.5">
              Start Free Trial <ArrowRight size={14} />
            </Link>
            <a href="/#pricing" className="text-sm w-text-dim hover:w-text px-5 py-2.5">See pricing</a>
          </div>
        </section>
      </div>
    </PublicDocsShell>
  );
}
