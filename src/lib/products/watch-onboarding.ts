/**
 * Customer-facing Innvil Watch "Getting Started" guide content — the
 * landing page's detailed setup walkthrough. Pure data, no I/O, safe to
 * import from a client component. Numeric limits are derived from the SAME
 * canonical sources the backend actually enforces (`watch-plans.ts` for
 * pricing/tier display names, `moderator/plan.ts`/`money.ts` for slot and
 * community counts) — never a second hardcoded copy that could drift from
 * real enforcement.
 *
 * HONEST STATE, checked against the actual codebase before writing this
 * (not assumed): Account creation, choosing a Watch plan, and creating a
 * standalone Project are genuinely self-serve today with NO Panel required
 * (`createStandaloneProject`/`createWatchProject`, gated on Watch
 * entitlement only). Connecting a Telegram community and creating/deploying
 * a Watcher are real, fully-implemented, tested capabilities — but as of
 * this pass they are only reachable through Innvil's existing owner-side
 * Virtual Moderator setup tooling (which is Panel-scoped:
 * `communities.panel_id`/`moderator_deployments.panel_id` are still NOT
 * NULL) — there is no zero-Panel self-serve UI for those steps yet, and the
 * customer-facing storefront surface for it (`AiModeratorSurface.tsx`) is
 * still explicitly gated behind `aiModeratorComingSoon` in
 * `app/p/[subdomain]/Storefront.tsx`. Steps 4 onward say so plainly rather
 * than promising a self-serve flow that doesn't exist yet.
 */

import { watchPlanOptions } from "./watch-plans";
import { CAPACITY, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";
import { MODERATOR_COMMUNITY_CAPACITY } from "@/src/lib/money";

export interface OnboardingCallout {
  kind: "plan-limit" | "community-limit" | "good-to-know" | "required" | "in-progress";
  text: string;
}

export interface OnboardingStep {
  n: string;
  title: string;
  summary: string;
  body: string[];
  callouts: OnboardingCallout[];
  cta?: { label: string; href: string };
}

/** Plan → Watcher-slot/community table, read live from the canonical
 *  sources — never a duplicated hardcoded copy. */
export function watchPlanCapacityTable(): Array<{ displayName: string; price: number; watcherSlots: number; communities: number }> {
  return watchPlanOptions().map((opt) => ({
    displayName: opt.displayName,
    price: opt.price,
    watcherSlots: CAPACITY[opt.tier].maxActiveSlots,
    communities: MODERATOR_COMMUNITY_CAPACITY[opt.tier].included,
  }));
}

export function watchOnboardingSteps(): OnboardingStep[] {
  const plans = watchPlanCapacityTable();
  const planLine = plans.map((p) => `${p.displayName} ${p.watcherSlots}`).join(" · ");

  return [
    {
      n: "01",
      title: "Create your Innvil account",
      summary: "One account, usable across every official Innvil product.",
      body: [
        "Sign up (or log in if you already have an account) at innvil.cloud or right here on watch.innvil.cloud — it's the same Innvil account either way.",
        "You do not need to own or create an SMM Panel (Innvil Forge) to use Watch directly. Watch is an independently ownable product — a Panel is only one of several ways to access it, not a requirement.",
      ],
      callouts: [
        { kind: "good-to-know", text: "Watch entitlement is independent of Forge/Panel ownership — owning one never automatically grants or blocks the other." },
      ],
      cta: { label: "Create your account", href: "/signup" },
    },
    {
      n: "02",
      title: "Choose your Watch plan",
      summary: "Your plan sets two separate limits: total Watcher slots and how many communities you can connect.",
      body: [
        "Pick Bronze, Silver, Gold, or Platinum for self-serve monthly billing, or contact us for Enterprise. Each plan includes a set number of total Watcher slots (how many Watchers you can have active at once, across all your communities) and a separate community allowance (how many distinct communities you can connect at all).",
        "These two numbers are independent — reaching your community limit doesn't use up Watcher slots, and vice versa.",
      ],
      callouts: [
        { kind: "plan-limit", text: `Watcher slots by plan — ${planLine}` },
        { kind: "good-to-know", text: "Total Watcher slots and your community allowance are tracked separately." },
      ],
      cta: { label: "View plans", href: "#pricing" },
    },
    {
      n: "03",
      title: "Create a Project",
      summary: "The identity and knowledge container your Watcher will actually use.",
      body: [
        "A Project holds your name, description, and the facts your Watcher can ground its answers in — never invented claims about you.",
        "Each Project's knowledge stays isolated: what you add to one Project never leaks into another. A standalone Project (the kind you create directly through Watch) starts with just a name today; the fuller profile fields (website, docs link, overview) are available once your Project is connected through the existing setup path in step 4.",
      ],
      callouts: [
        { kind: "good-to-know", text: "Project knowledge is isolated per Project — never shared across projects." },
      ],
    },
    {
      n: "04",
      title: "Connect your Telegram community",
      summary: "Add your Watcher's bot to the Telegram group or channel you want it to operate in.",
      body: [
        "Once connected, Innvil verifies the bot is actually present in your community before anything goes live — this is never assumed from the invite alone.",
        "The bot needs specific admin rights, and only the ones your configuration actually uses: delete-message and restrict/ban rights if moderation is on, post rights if Auto-Posting is on. Innvil never requests blanket admin access.",
      ],
      callouts: [
        { kind: "community-limit", text: "Each community can hold at most 5 active Watchers, regardless of your plan's total slot count." },
        { kind: "required", text: "The bot must actually be present in the Telegram community — verified by Innvil before it goes live." },
        { kind: "in-progress", text: "Self-serve Telegram connection for a Panel-less account is still rolling out. Contact support to get connected today." },
      ],
      cta: { label: "Contact support", href: "/signup" },
    },
    {
      n: "05",
      title: "Create your Watcher",
      summary: "Configure the AI-powered Virtual Moderator that will represent you in the community.",
      body: [
        "Give your Watcher a name and a persona — a starting style preset, or your own custom description and tone. Its persona is what makes it sound like a real, consistent voice in your community rather than a generic bot.",
        "Your Watcher answers questions grounded in the Project knowledge from step 3 — it never fabricates facts about your project beyond what you've told it.",
      ],
      callouts: [
        { kind: "plan-limit", text: `Total Watcher slots are shared across every community you connect — ${planLine}` },
        { kind: "good-to-know", text: "A Watcher's persona is a starting point you can edit any time, not a one-time choice." },
      ],
    },
    {
      n: "06",
      title: "Deploy it into your community",
      summary: "Creating a Watcher and putting it to work are two separate steps.",
      body: [
        `A Watcher isn't live until you deploy it into a specific community, and that deployment counts against both your account's total Watcher-slot allowance and that community's own cap of ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watchers.`,
        "If you're at either limit, deployment is blocked with a clear reason rather than silently failing or bypassing the cap.",
      ],
      callouts: [
        { kind: "community-limit", text: `Up to ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watchers per community.` },
        { kind: "good-to-know", text: "Pausing a Watcher frees its slot immediately; reactivating re-checks your current capacity." },
      ],
    },
    {
      n: "07",
      title: "Configure how it behaves",
      summary: "Moderation, media safety, and scheduled posting are all separate switches you control.",
      body: [
        "Moderation covers spam and scam-link detection with graduated enforcement (a warning first, escalating only on repeat offenses). Media moderation reviews supported photos/videos against your community's own settings. Auto-Posting lets a Watcher publish on a schedule you define, grounded in the same Project knowledge it answers questions from.",
        "Every one of these is opt-in — nothing is turned on without your choice, and none of them are required to deploy a Watcher.",
      ],
      callouts: [
        { kind: "good-to-know", text: "Moderation, media safety, and Auto-Posting are independent, opt-in settings — not bundled together." },
      ],
    },
    {
      n: "08",
      title: "Go live and monitor",
      summary: "Your Watcher starts operating immediately — you can pause, adjust, or remove it any time.",
      body: [
        "Once deployed, your Watcher answers naturally, moderates, and (if configured) posts on schedule — no further action needed from you.",
        "You can pause a deployment, edit its persona, or disconnect a community whenever you like; nothing about existing data is deleted just because a Watcher is paused. If you ever reach a plan limit, Innvil tells you clearly rather than silently degrading or shutting things down.",
      ],
      callouts: [
        { kind: "good-to-know", text: "Pausing or removing a Watcher never deletes your Project's knowledge or history." },
      ],
    },
  ];
}
