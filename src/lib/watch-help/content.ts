/**
 * Innvil Watch Help Center — content model + pure search/lookup helpers.
 * No I/O, no `server-only` (rendered from both server article pages and a
 * client search box) — a plain, hand-authored content module rather than
 * MDX/markdown, since this codebase has no such infrastructure yet and the
 * article count is small enough that a typed data module stays maintainable.
 *
 * Commercial/config values (trial duration/capacity, plan prices, Community
 * Expansion pricing, per-community deployment cap) are read from the SAME
 * canonical sources every other Watch surface reads from — never a second
 * hardcoded copy that could drift from what Plans/Billing/Usage actually
 * enforce.
 */

import { TRIAL_DURATION_DAYS, TRIAL_CAPACITY, MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY } from "@/src/lib/moderator/plan";
import { watchPlanOptions } from "@/src/lib/products/watch-plans";
import { MODERATOR_COMMUNITY_CAPACITY, COMMUNITY_EXPANSION_MONTHLY_PRICE, MODERATOR_AI_GENERATION_POOL, MODERATOR_MEDIA_ADDON } from "@/src/lib/money";
import { INNVIL_CREDIT_DISCOUNT, ANNUAL_CREDIT_DISCOUNT_BPS, ANNUAL_DIRECT_DISCOUNT_BPS, annualCreditPriceUsd, annualDirectPriceUsd } from "@/src/lib/products/innvil-credit-pricing";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";

export type HelpCategoryId =
  | "getting-started" | "concepts" | "watchers" | "knowledge" | "moderation" | "escalation"
  | "communities" | "plans-billing" | "innvil-credit" | "dashboard" | "account" | "troubleshooting" | "faq";

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  description: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "getting-started", label: "Getting Started", description: "Innvil Watch, Watchers, and your first deployment." },
  { id: "concepts", label: "Core Concepts", description: "The terms and building blocks used throughout Innvil Watch." },
  { id: "watchers", label: "Watchers", description: "Profiles, personas, deployments, slots, and how Watchers behave." },
  { id: "knowledge", label: "Project Knowledge", description: "What a Watcher can answer from, and how confidence works." },
  { id: "moderation", label: "Moderation", description: "How Watchers enforce rules, warn, and handle media." },
  { id: "escalation", label: "Smart Escalation", description: "What happens when a Watcher doesn't have a verified answer." },
  { id: "communities", label: "Projects & Communities", description: "Projects, connecting a Telegram Community, and capacity." },
  { id: "plans-billing", label: "Plans & Billing", description: "The Free Trial, plans, Watcher slots, and how payment works." },
  { id: "innvil-credit", label: "Innvil Credit", description: "Prepaid service credit for Innvil products." },
  { id: "dashboard", label: "Dashboard", description: "Where each part of Innvil Watch actually lives." },
  { id: "account", label: "Account & Telegram", description: "Your Innvil account and connected Telegram identity." },
  { id: "troubleshooting", label: "Troubleshooting", description: "Common issues and how to check them." },
  { id: "faq", label: "FAQ", description: "Quick answers to the most common questions." },
];

/** Optional rich-content blocks for an article, additive to the plain
 *  `body: string[]` paragraph model every other article still uses
 *  unchanged. Introduced specifically to make the Plans & Billing article
 *  scannable (comparison tables, callouts, per-plan summary cards, anchor
 *  navigation) without redesigning the Help Center portal itself — every
 *  other article's rendering (app/support/[category]/[slug]/page.tsx's
 *  plain `body.map(p => <p>)` loop) is completely untouched; only an
 *  article that sets `richBody` renders through the new HelpRichBody
 *  component instead. */
export type HelpBlock =
  | { type: "heading"; id: string; text: string }
  | { type: "paragraph"; text: string }
  | { type: "callout"; tone: "info" | "warning"; title: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "cards"; items: Array<{ title: string; lines: string[] }> }
  | { type: "list"; items: string[] };

export interface HelpArticle {
  slug: string;
  category: HelpCategoryId;
  title: string;
  description: string;
  keywords: string[];
  /** Plain-text paragraphs — always populated (used for search relevance
   *  scoring and as the description/fallback rendering). For an article
   *  with `richBody`, this is auto-derived from it via
   *  flattenBlocksToPlainText rather than hand-duplicated, so the two can
   *  never drift apart. */
  body: string[];
  /** When present, the article page renders THIS instead of the plain
   *  `body` paragraphs (tables/callouts/cards/anchored headings). */
  richBody?: HelpBlock[];
  related: string[];
}

/** Flattens rich blocks into plain search/description-friendly text — the
 *  ONE place `body` is derived from `richBody`, so search indexing never
 *  needs a second hand-maintained copy of the same facts. */
export function flattenBlocksToPlainText(blocks: HelpBlock[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push(b.text);
    else if (b.type === "paragraph") out.push(b.text);
    else if (b.type === "callout") out.push(`${b.title}: ${b.text}`);
    else if (b.type === "table") out.push(`${b.headers.join(" ")} ${b.rows.map((r) => r.join(" ")).join(" ")}`);
    else if (b.type === "cards") out.push(b.items.map((c) => `${c.title}: ${c.lines.join(" ")}`).join(" "));
    else if (b.type === "list") out.push(b.items.join(" "));
  }
  return out;
}

const plans = watchPlanOptions();
const discountedTiers = plans.filter((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0).map((p) => p.displayName).join("/");
const monthlyDiscountPct = Math.round((plans.find((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0) ? INNVIL_CREDIT_DISCOUNT[plans.find((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0)!.tier] : 0) * 100);
const annualDiscountPct = ANNUAL_CREDIT_DISCOUNT_BPS / 100;
const annualDirectDiscountPct = ANNUAL_DIRECT_DISCOUNT_BPS / 100;

/** "Best For" is the one column with no canonical source to read from (it's
 *  positioning copy, not a config value) — kept as a small local map so
 *  every other cell in the comparison table still traces back to
 *  watchPlanOptions()/money.ts, never a duplicated number. */
const BEST_FOR: Record<string, string> = {
  Bronze: "Small communities",
  Silver: "Growing projects",
  Gold: "Larger operations",
  Platinum: "Multi-community teams",
  "BYO 20": "Teams using their own AI provider",
};

function communitiesCell(p: (typeof plans)[number]): string {
  return p.communitiesMax > p.communitiesIncluded ? `${p.communitiesIncluded} (up to ${p.communitiesMax})` : `${p.communitiesIncluded}`;
}

function aiGenerationsCell(p: (typeof plans)[number]): string {
  return p.tier === "byo20" ? "BYO / provider-based" : MODERATOR_AI_GENERATION_POOL[p.tier].toLocaleString();
}

/** Plans & Billing rich content — comparison table -> key definitions ->
 *  per-plan details -> usage rules -> examples -> edge cases, per the
 *  explicit "summary first, details second" requirement. Every number
 *  traces to the SAME canonical sources every other Watch surface enforces
 *  from (watchPlanOptions/money.ts/innvil-credit-pricing.ts) -- nothing
 *  here is a second, driftable copy. */
const plansAndBillingRichBody: HelpBlock[] = [
  { type: "heading", id: "pricing-overview", text: "Pricing Overview" },
  {
    type: "table",
    headers: ["Plan", "Monthly Price", "Watcher Slots", "Communities", "AI Generations", "Best For"],
    rows: plans.map((p) => [p.displayName, `$${p.price.toFixed(2)}`, String(p.slots), communitiesCell(p), aiGenerationsCell(p), BEST_FOR[p.displayName]]),
  },
  {
    type: "paragraph",
    text: "Enterprise (beyond Platinum) is three fixed, manually-provisioned packages — see its own summary further down and the full Innvil Watch Enterprise article.",
  },
  { type: "heading", id: "how-to-read", text: "How to Read the Plans" },
  {
    type: "cards",
    items: [
      { title: "Watcher Slots", lines: ["One slot means one Watcher actively deployed to one customer-facing Community."] },
      { title: "Communities", lines: ["The maximum number of customer-facing Communities allowed by the plan (some plans can expand this — see Community Expansion)."] },
      { title: "AI Generations", lines: ["The monthly pooled number of AI-generated responses/actions included with the plan, shared across every Watcher on the account."] },
      { title: "Escalation Groups", lines: ["Private Watcher Ops / Escalation Groups do NOT consume Watcher slots or Community allowances."] },
    ],
  },
  {
    type: "callout",
    tone: "warning",
    title: "Escalation Groups do not consume slots",
    text: "Connecting a Watcher to a private Watcher Ops / Escalation Group does not use an additional Watcher slot or customer-facing Community allowance.",
  },
  {
    type: "callout",
    tone: "warning",
    title: "Watcher Records are not deployments",
    text: "Creating a Watcher profile does not consume a slot. A slot is consumed only when that Watcher is actively deployed to a customer-facing Community.",
  },

  { type: "heading", id: "free-trial", text: "Free Trial" },
  {
    type: "cards",
    items: [
      {
        title: "Free Trial",
        lines: [
          `$0 for ${TRIAL_DURATION_DAYS} days`,
          `${TRIAL_CAPACITY.maxActiveSlots} Watcher slot`,
          `${TRIAL_CAPACITY.maxCommunities} Community`,
          "Full Smart Escalation / Watcher Ops included",
        ],
      },
    ],
  },
  {
    type: "paragraph",
    text: `A one-time, ${TRIAL_DURATION_DAYS}-day trial — no payment required, tied to your verified Telegram identity so it can't be reclaimed from a second account. It includes the SAME Smart Escalation and Watcher Ops moderation reporting every paid plan gets — this isn't held back for the trial. There's no separate AI Generations allowance number for the trial (it uses its own reactive daily quota, not the pooled monthly model paid plans use). When it ends, nothing is deleted — your Projects, Communities, and Watchers stay exactly as they are until you choose a paid plan.`,
  },

  ...plans.flatMap((p): HelpBlock[] => [
    { type: "heading" as const, id: `plan-${p.tier}`, text: p.displayName },
    {
      type: "cards" as const,
      items: [
        {
          title: p.displayName,
          lines: [
            `$${p.price.toFixed(2)}/month`,
            `${p.slots} Watcher slots`,
            `${communitiesCell(p)} Communities`,
            `${aiGenerationsCell(p)}${p.tier === "byo20" ? "" : " AI Generations"}`,
          ],
        },
      ],
    },
    {
      type: "paragraph" as const,
      text:
        p.tier === "byo20"
          ? `BYO 20 always requires your own AI provider credential (Anthropic or an OpenAI-compatible provider) — Innvil never charges you for AI usage on top of the $${p.price.toFixed(2)}/mo plan price. Media Moderation + is bundled in (${MODERATOR_MEDIA_ADDON.byo20.units.toLocaleString()} units/mo, never a separate purchase). Communities are fixed at ${p.communitiesIncluded} — already the max, with no expansion path. Best for teams that already run their own AI provider and want the most included in one flat price.`
          : `Media Moderation + is an optional add-on on ${p.displayName} — +$${MODERATOR_MEDIA_ADDON[p.tier].price.toFixed(2)}/mo for ${MODERATOR_MEDIA_ADDON[p.tier].units.toLocaleString()} Media Moderation Units per period, never bundled into the base price. ${
              p.communitiesMax > p.communitiesIncluded
                ? `Community Expansion can raise its Community allowance from ${p.communitiesIncluded} to ${p.communitiesMax} for an additional monthly fee — see the Community Expansion article.`
                : "Its Community allowance is fixed — the only way to raise it is to upgrade to a plan with a higher allowance."
            } Best for: ${BEST_FOR[p.displayName].toLowerCase()}.`,
    },
  ]),

  { type: "heading", id: "enterprise", text: "Enterprise" },
  {
    type: "cards",
    items: [
      {
        title: "Managed Enterprise 50",
        lines: [`from $${MANAGED_ENTERPRISE_50.price.toFixed(2)}/mo`, `${MANAGED_ENTERPRISE_50.slots} Watcher slots`, `${MANAGED_ENTERPRISE_50.communities} Communities`, "Managed — Innvil funds AI usage"],
      },
      {
        title: "BYO Enterprise 50",
        lines: [`$${WATCH_ENTERPRISE_BYO_TIERS[0].price}/mo`, `up to ${WATCH_ENTERPRISE_BYO_TIERS[0].maxSlots} Watcher deployments`, "Bring Your Own AI provider"],
      },
      {
        title: "BYO Enterprise Unlimited",
        lines: [`$${WATCH_ENTERPRISE_BYO_TIERS[1].price}/mo`, "Unlimited licensed Watcher deployments", "Bring Your Own AI provider"],
      },
    ],
  },
  {
    type: "paragraph",
    text: "Enterprise is for accounts that need more than Platinum's allowances — it's still the same Innvil Watch product, never a separate dashboard or domain. Managed means Innvil runs and pays for your AI provider usage; Bring Your Own (BYO) means you supply and pay for your own provider credential directly, lowering the Innvil platform fee (never a guarantee your total spend, Innvil fee plus your own provider usage, ends up lower overall). Support and provisioning for either mode are completed manually with the Innvil team — reach out from the Plans page. See the full Innvil Watch Enterprise article for everything each package includes.",
  },

  { type: "heading", id: "watcher-slots", text: "Watcher Slots" },
  {
    type: "paragraph",
    text: "Watcher Slot Usage = Active Watcher × Active Customer-Facing Community Deployment. A slot is consumed only by an ACTIVE deployment — creating a Watcher profile, or connecting a private Escalation Group, never consumes one. See \"Watcher Profiles vs Deployments vs Slots\" and \"Watcher Slots and Billing\" for the full concepts and formula.",
  },
  { type: "heading", id: "billing-examples", text: "Slot Examples" },
  {
    type: "table",
    headers: ["Example", "Setup", "Slots Used"],
    rows: [
      ["1", "1 Watcher deployed to 1 Community", "1 Watcher slot"],
      ["2", "1 Watcher deployed to 3 Communities", "3 Watcher slots"],
      ["3", "3 Watchers deployed to 1 Community", "3 Watcher slots"],
      ["4", "3 Watchers across Communities, all also connected to the same private Watcher Ops group", "Only the customer-facing deployments count — the Watcher Ops group adds 0 slots"],
    ],
  },

  { type: "heading", id: "ai-usage", text: "AI Usage" },
  {
    type: "paragraph",
    text: "Most conversation and Project Knowledge answers use your account's pooled AI Generations allowance. Deterministic actions — including the new Watcher Ops moderation reports — never do, because there's nothing for a model to generate: the backend already knows every fact the report states.",
  },
  {
    type: "table",
    headers: ["Activity", "Counts Toward AI Usage?"],
    rows: [
      ["Normal AI-generated conversation", "Yes"],
      ["Project Knowledge answer generated by AI", "Yes"],
      ["Deterministic warning notice", "No"],
      ["Template-based mute report", "No"],
      ["Template-based kick report", "No"],
      ["Template-based purge report", "No"],
      ["Structured Watcher Ops moderation report", "No, unless an AI model is actually used"],
      ["AI-generated summary", "Yes"],
    ],
  },

  { type: "heading", id: "media-moderation", text: "Media Moderation" },
  {
    type: "table",
    headers: ["Media Feature", "Included / Add-on", "Allowance / Price"],
    rows: [
      ["Photo moderation", "Part of Media Moderation +", "Shares the plan's Media Moderation Unit allowance"],
      ["Video moderation", "Part of Media Moderation +", "Shares the plan's Media Moderation Unit allowance"],
      [
        "Media Moderation +",
        "Optional add-on (Bronze–Platinum); bundled on BYO 20",
        [
          ...plans.filter((p) => p.tier !== "byo20").map((p) => `${p.displayName} +$${MODERATOR_MEDIA_ADDON[p.tier].price.toFixed(2)}/mo (${MODERATOR_MEDIA_ADDON[p.tier].units.toLocaleString()} units)`),
          `BYO 20: ${MODERATOR_MEDIA_ADDON.byo20.units.toLocaleString()} units/mo included, no separate charge`,
        ].join(" · "),
      ],
    ],
  },

  { type: "heading", id: "annual-billing", text: "Annual Billing" },
  {
    type: "paragraph",
    text: `Annual billing is paid upfront, on every self-serve plan: ${annualDirectDiscountPct}% off 12 months of the regular price with any direct crypto payment, or ${annualDiscountPct}% off with Innvil Credit — the bigger discount. The table below does the math for you.`,
  },
  {
    type: "table",
    headers: ["Plan", "Monthly", "Annual (Direct, -" + annualDirectDiscountPct + "%)", "Annual (Innvil Credit, -" + annualDiscountPct + "%)"],
    rows: plans.map((p) => [p.displayName, `$${p.price.toFixed(2)}`, `$${annualDirectPriceUsd(p.price).toFixed(2)}`, `$${annualCreditPriceUsd(p.price).toFixed(2)}`]),
  },

  { type: "heading", id: "payments", text: "Payments" },
  {
    type: "paragraph",
    text: "Watch is billed with crypto payments (Cryptomus, NOWPayments, or Binance Pay, depending on what's configured) or Innvil Credit, a discounted second way to pay — see the Innvil Credit article. There is currently no auto-renewal — you renew manually from the Billing page when your period ends; nothing about your existing Projects, Communities, or Watchers is affected while a subscription is expired.",
  },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "what-is-innvil-watch",
    category: "getting-started",
    title: "What is Innvil Watch?",
    description: "Innvil Watch is a platform for deploying Virtual Moderators, called Watchers, into Telegram communities.",
    keywords: ["watch", "product", "overview", "community operations", "virtual moderator"],
    body: [
      "Innvil Watch is a platform for deploying Virtual Moderators — called Watchers — into Telegram communities. A Watcher can moderate, communicate, use your project's knowledge, escalate questions it can't confidently answer, and operate continuously.",
      "Traditional moderation bots mostly react to commands, filters, and predefined rules. Watchers are designed to behave more like active virtual community staff: they can hold a persona, join ordinary conversation, answer from your project's knowledge, enforce your rules, and ask an authorized admin when they genuinely don't know something — rather than guessing or staying silent.",
      "Watchers handle routine community operations so human team members remain available for decisions, approvals, and information that requires human authority — Watch is not a claim that human administrators become unnecessary.",
      "The operating model, in short: a Watcher observes a message, decides whether it needs to act, answers from verified knowledge when it can, moderates when it should, and escalates to your team when it genuinely can't answer — then relays the verified answer back once it has one.",
      "Watch is a standalone Innvil product: one Innvil account gives you access to Watch, and to any other Innvil product you choose to use.",
      "The core building blocks are Project (your identity and knowledge base), Community (the actual Telegram group, supergroup, or channel you connect), and Watcher (the Virtual Moderator you deploy into a Community). See \"Core Concepts\" for the full glossary.",
    ],
    related: ["what-is-a-watcher", "core-concepts", "create-a-project", "getting-started-path"],
  },
  {
    slug: "what-is-a-watcher",
    category: "getting-started",
    title: "What is a Watcher?",
    description: "A Watcher is a configured Virtual Moderator, not just an instance of a generic bot.",
    keywords: ["watcher", "virtual moderator", "ai", "persona", "role"],
    body: [
      "A Watcher is an individual Virtual Moderator you deploy into your Telegram Community. Treat a Watcher as its own configured identity — a name, a persona, a role, and its own settings — rather than a generic, interchangeable bot instance.",
      "A Watcher can: join ordinary community conversation, hold a consistent persona and speaking style, answer questions grounded in your project's knowledge, enforce your moderation rules, identify and act on spam/scam/prohibited content, warn users in natural language, publish scheduled content where configured, recognize when it doesn't have a verified answer, escalate that question to your private admin group, relay the verified answer back once it has one, and (optionally) turn an admin's approved answer into reusable project knowledge.",
      "Everything above is opt-in and configured per Watcher — nothing is on by default, and a Watcher only does what its Watcher Record actually configures it to do. See \"Watcher Records\" for the full list of what's configurable.",
      "A Telegram community can have more than one Watcher deployed at once, each with a different role and persona — see \"Multi-Watcher Communities.\"",
      "For example, one community might run Mr Pres (Role: Community Lead, Persona: friendly and confident — member engagement, general project questions, moderation, community guidance) alongside Ms VP (Role: Community Support, Persona: warm and approachable — answering questions, welcoming members, support discussions). These are illustrative names, not required defaults — you name and configure your own Watchers.",
      "Creating a Watcher and deploying it are two separate steps — see \"Watcher Profiles vs Deployments vs Slots\" for the full relationship.",
    ],
    related: ["watcher-records", "personas-and-roles", "watcher-profiles-deployments-slots", "multi-watcher-communities", "how-moderation-works"],
  },
  {
    slug: "how-moderation-works",
    category: "moderation",
    title: "Moderation overview",
    description: "Graduated, opt-in enforcement — never a blanket ban on the first offense.",
    keywords: ["moderation", "spam", "scam", "warning", "ban", "rules"],
    body: [
      "Moderation is opt-in per Watcher — nothing is enabled without your choice, and it's independent of media safety, ordinary conversation, and Auto-Posting.",
      "A Watcher can act on: unsolicited promotion and repeated advertisements, phishing and scam links, link spam/flooding, and explicit content — both in text links and in photos/videos where media moderation is enabled. See \"Natural Moderation\" and \"Media Moderation\" for how each is handled.",
      "For unsolicited promotion and link spam, enforcement is graduated: a warning first, escalating only on repeat offenses within the same Community — never an immediate ban for a first-time, lower-severity violation.",
      "For clearly severe cases (explicit content, phishing/scam links at high confidence), enforcement is immediate — these are treated as safety issues, not subject to the graduated-warning path.",
      "Available actions depend on what the Watcher's Telegram bot account was actually granted: deleting the message, warning the user, and — where the bot has admin rights to restrict or remove members — escalating enforcement on repeat offenses. See \"Permissions\" for exactly what's required for each action.",
      "Every real moderation decision — warn, mute, kick, or purge — is recorded in that Community's Activity feed, and (where a private Escalation Group is connected) reported to your team in a structured Watcher Ops report — see \"Watcher Ops Moderation Reports.\" Routine chatter and silence are never logged as moderation events.",
    ],
    related: ["natural-moderation", "media-moderation", "watcher-ops-moderation-reports", "permissions", "safety-and-reliability"],
  },
  {
    slug: "watcher-profiles-deployments-slots",
    category: "watchers",
    title: "Watcher Profiles vs Deployments vs Slots",
    description: "Three related but distinct concepts your plan's capacity is measured in.",
    keywords: ["watcher", "slot", "deployment", "profile", "capacity"],
    body: [
      "Watcher Profile — a reusable AI moderator identity/persona (a `virtual_moderators` row). Creating one does not by itself consume a Watcher slot.",
      "Deployment — assigning a Watcher profile to a specific Community. A Watcher isn't live in a Community until it's deployed there.",
      "Watcher Slot — one ACTIVE (enabled) Watcher-to-Community deployment. Your plan's total slot allowance is checked against the count of active deployments, not the count of distinct Watcher profiles.",
      "Example: the same Watcher deployed to two Communities uses two slots. Two different Watchers deployed to the same Community also use two slots. Pausing a deployment frees its slot immediately; reactivating re-checks your current capacity.",
      `Regardless of your plan's total slot allowance, any single Community can hold at most ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watcher deployments.`,
      "A Watcher deployed into a private Escalation Group is the one exception — that deployment never consumes a Watcher slot, since the Escalation Group is internal ops infrastructure, not a customer-facing Community. See \"Watcher Slots and Billing\" for the full formula and worked examples.",
    ],
    related: ["what-is-a-watcher", "watcher-slots-and-billing", "create-and-deploy-a-watcher", "community-capacity"],
  },
  {
    slug: "start-the-free-trial",
    category: "plans-billing",
    title: "Start the Free Trial",
    description: `A one-time, ${TRIAL_DURATION_DAYS}-day trial of Innvil Watch — no payment required.`,
    keywords: ["free trial", "trial", "start"],
    body: [
      `The Free Trial is a one-time, ${TRIAL_DURATION_DAYS}-day trial of Innvil Watch — ${TRIAL_CAPACITY.maxActiveSlots} Watcher slot and ${TRIAL_CAPACITY.maxCommunities} Community, no payment required.`,
      "A verified Telegram account is required before you can start the trial — see \"Connect your Telegram account\". Once verified, go to Plans and click Start Free Trial.",
      "It's one-time per Innvil account, and tied to your verified Telegram identity, so it can't be claimed again from a second account.",
      "When the trial ends, nothing is deleted — your Projects, Communities, and Watchers stay exactly as they are. Choose a paid plan to continue active Watch operations.",
    ],
    related: ["connect-your-telegram-account", "plans-and-billing"],
  },
  {
    slug: "connect-your-telegram-account",
    category: "account",
    title: "Connect your Telegram account",
    description: "Verify your personal Telegram identity — this is not the same as connecting a Community.",
    keywords: ["telegram", "connect", "verify", "identity", "profile"],
    body: [
      "Connecting your Telegram account verifies YOUR personal Telegram identity — it's required before you can start the Free Trial, and it's separate from connecting a Telegram Community for a Watcher to operate in.",
      "Go to Profile → Connected identities → Telegram, and follow the connect flow. Innvil sends a verification link through Telegram; once you confirm it there, your account shows as connected.",
      "Your verified Telegram identity is used only to establish trial eligibility (one trial per verified person, not just per account) — it never creates a Project, Community, or Watcher by itself.",
    ],
    related: ["start-the-free-trial", "connect-a-community"],
  },
  {
    slug: "create-a-project",
    category: "communities",
    title: "Create a Project",
    description: "The identity and knowledge container your Watcher actually uses.",
    keywords: ["project", "create", "knowledge"],
    body: [
      "A Project holds your name, description, and the facts your Watcher can ground its answers in — it never invents claims about you beyond what you've added.",
      "Each Project's knowledge stays isolated: what you add to one Project never leaks into another.",
      "A Project can have more than one Community connected to it — each Community keeps its own Watcher deployments.",
    ],
    related: ["what-is-innvil-watch", "connect-a-community"],
  },
  {
    slug: "connect-a-community",
    category: "communities",
    title: "Connect a Community",
    description: "Add your Watcher's bot to the real Telegram group, supergroup, or channel you want it to operate in.",
    keywords: ["community", "telegram group", "connect", "deploy"],
    body: [
      "A Community is the actual Telegram group, supergroup, or channel you connect — never confuse it with your personal Telegram account identity (see \"Connect your Telegram account\").",
      "From your Watchers page, pick a bot username for your Watcher, open the Telegram deep link you're given, then confirm the Community. Innvil verifies the bot is actually present in the Community before anything goes live — this is never assumed from the invite alone.",
      "The bot only requests the admin rights your configuration actually uses — delete-message and restrict/ban rights if moderation is on, post rights if Auto-Posting is on. Innvil never requests blanket admin access.",
      `Each Community can hold at most ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watchers, independent of your plan's total slot count.`,
    ],
    related: ["community-capacity", "create-and-deploy-a-watcher", "telegram-connection-issue"],
  },
  {
    slug: "create-and-deploy-a-watcher",
    category: "watchers",
    title: "Create and Deploy a Watcher",
    description: "Two separate steps: creating the Watcher profile, then deploying it into a Community.",
    keywords: ["watcher", "create", "deploy"],
    body: [
      "Give your Watcher a name and a persona — a starting style preset, or your own custom description and tone. Its persona is what makes it sound like a consistent voice in your Community, not a generic bot.",
      "Creating a Watcher does not deploy it anywhere yet. Deploying assigns it to a specific Community — that deployment is what actually counts against your plan's Watcher-slot allowance and that Community's own cap.",
      "If you're at either limit, deployment is blocked with a clear reason rather than silently failing or bypassing the cap.",
    ],
    related: ["watcher-profiles-deployments-slots", "connect-a-community", "watcher-not-responding"],
  },
  {
    slug: "community-capacity",
    category: "communities",
    title: "Community capacity",
    description: "How many Communities you can connect, and how it's separate from your Watcher-slot allowance.",
    keywords: ["community", "capacity", "limit", "expansion"],
    body: [
      `Your plan sets a separate Community allowance from your Watcher-slot allowance — reaching one never uses up the other. Included Communities by plan: Bronze ${MODERATOR_COMMUNITY_CAPACITY.basic.included}, Silver ${MODERATOR_COMMUNITY_CAPACITY.standard.included}, Gold ${MODERATOR_COMMUNITY_CAPACITY.premium.included}, Platinum ${MODERATOR_COMMUNITY_CAPACITY.pro.included}.`,
      "Bronze and Silver are hard-capped — the only way to connect more Communities is to upgrade your plan. Gold and Platinum can be expanded with the Community Expansion add-on — see that article.",
      `Independent of your plan's Community allowance, any single Community can hold at most ${MAX_ACTIVE_DEPLOYMENTS_PER_COMMUNITY} active Watcher deployments.`,
      "A private Escalation Group is a real connection, but it never counts toward this allowance — see \"Watcher Ops / Escalation Group.\"",
    ],
    related: ["community-expansion", "plans-and-billing", "watcher-ops-escalation-group", "community-needs-attention"],
  },
  {
    slug: "community-expansion",
    category: "plans-billing",
    title: "Community Expansion",
    description: "A paid capacity add-on, available only on Gold and Platinum.",
    keywords: ["community expansion", "add-on", "capacity", "gold", "platinum"],
    body: [
      `Community Expansion is a fixed, paid add-on that raises your Community capacity — available ONLY on Gold and Platinum. Gold expands from ${MODERATOR_COMMUNITY_CAPACITY.premium.included} to ${MODERATOR_COMMUNITY_CAPACITY.premium.maxWithAddons} Communities for $${COMMUNITY_EXPANSION_MONTHLY_PRICE.premium.toFixed(2)}/month. Platinum expands from ${MODERATOR_COMMUNITY_CAPACITY.pro.included} to ${MODERATOR_COMMUNITY_CAPACITY.pro.maxWithAddons} for $${COMMUNITY_EXPANSION_MONTHLY_PRICE.pro.toFixed(2)}/month.`,
      "It never changes your Watcher-slot allowance — only Community capacity. Bronze and Silver can't purchase it at all; upgrading plan is the only way to raise their Community allowance.",
      "It renews together with your base subscription — there's no separate billing date. Removing it takes effect at your next renewal, never immediately, and only if your current Community usage already fits within your plan's included (non-expanded) allowance.",
      "You can add or manage Community Expansion from the Usage page.",
    ],
    related: ["community-capacity", "plans-and-billing"],
  },
  {
    slug: "plans-and-billing",
    category: "plans-billing",
    title: "Plans and Billing",
    description: "Comparison table first, details second — Free Trial through Enterprise, Watcher slots, AI usage, and annual pricing.",
    keywords: ["plans", "billing", "pricing", "annual", "monthly", "comparison", "watcher slots", "ai usage"],
    body: flattenBlocksToPlainText(plansAndBillingRichBody),
    richBody: plansAndBillingRichBody,
    related: ["start-the-free-trial", "innvil-credit", "crypto-payments", "community-expansion", "innvil-watch-enterprise", "watcher-slots-and-billing"],
  },
  {
    slug: "innvil-watch-enterprise",
    category: "plans-billing",
    title: "Innvil Watch Enterprise",
    description: "Managed vs. Bring Your Own Provider — three fixed packages beyond Platinum.",
    keywords: ["enterprise", "managed", "byo", "bring your own provider", "watcher slots"],
    body: [
      `Enterprise is for accounts that need more than Platinum's ${watchPlanOptions().find((p) => p.displayName === "Platinum")!.slots} Watcher slots or ${watchPlanOptions().find((p) => p.displayName === "Platinum")!.communitiesMax} Communities. It's still the same Innvil Watch product — same CRM, Projects, Communities, and Watchers — never a separate dashboard or domain.`,
      `Managed Enterprise 50 — $${MANAGED_ENTERPRISE_50.price.toFixed(2)}/month, fixed. Includes ${MANAGED_ENTERPRISE_50.slots} Watcher slots, ${MANAGED_ENTERPRISE_50.communities} Communities, and ${MANAGED_ENTERPRISE_50.aiGenerations.toLocaleString()} pooled AI Generations per month, funded by Innvil. You never manage a provider credential yourself. A custom quote is available for more than ${MANAGED_ENTERPRISE_50.slots} slots.`,
      `Bring Your Own Provider 50 — $${WATCH_ENTERPRISE_BYO_TIERS[0].price}/month, up to ${WATCH_ENTERPRISE_BYO_TIERS[0].maxSlots} licensed Watcher deployments. Bring Your Own Provider Unlimited — $${WATCH_ENTERPRISE_BYO_TIERS[1].price}/month, unlimited licensed Watcher deployments (never unlimited compute, storage, bandwidth, or provider usage — normal fair-use limits still apply). With either BYO package, you supply and pay for your own supported provider credentials directly — Innvil's fee is lower because it doesn't include that usage cost. This is never a guarantee your total spend (Innvil fee + your own provider usage) is lower overall.`,
      "Both Managed and BYO packages can add the optional Media Moderation + add-on, priced separately per package.",
      "Enterprise is provisioned manually — reach out from the Plans page and it's finalized with you directly.",
    ],
    related: ["plans-and-billing", "community-capacity"],
  },
  {
    slug: "innvil-credit",
    category: "innvil-credit",
    title: "Innvil Credit",
    description: "Prepaid service credit — 1 Innvil Credit = $1.00 USD of eligible Innvil service value.",
    keywords: ["innvil credit", "credit", "prepaid", "balance"],
    body: [
      "Innvil Credit is a reusable, account-owned prepaid service credit. 1 Innvil Credit = $1.00 USD of eligible Innvil service value.",
      `Add credit using a supported crypto gateway; it's then usable for eligible Innvil purchases, including Watch subscriptions and Community Expansion — often at a discount versus paying directly (${discountedTiers} get ${monthlyDiscountPct}% off when paying with Innvil Credit; annual billing gets ${annualDiscountPct}% off with Innvil Credit, vs. ${annualDirectDiscountPct}% off with a direct crypto payment for the same 12 months upfront).`,
      "Innvil Credit is account-owned, non-transferable, and non-withdrawable — it is explicitly NOT a crypto custody wallet; there is no coin/token quantity stored, no exchange, and no code path anywhere exposes a withdrawal.",
      "Top-ups are generally non-refundable except where required by applicable law.",
      "Manage your balance and see your full activity history from the Billing page.",
    ],
    related: ["plans-and-billing", "crypto-payments", "innvil-credit-not-updated"],
  },
  {
    slug: "crypto-payments",
    category: "plans-billing",
    title: "Crypto payments",
    description: "Watch is billed with crypto payments — how a payment moves from pending to confirmed.",
    keywords: ["crypto", "payment", "pending", "confirm"],
    body: [
      "Innvil Watch accepts crypto payments through whichever gateways are currently configured (Cryptomus, NOWPayments, or Binance Pay) — the Billing page shows what's available.",
      "A payment starts as pending the moment you begin checkout, and only activates your subscription (or credits your Innvil Credit balance) once the gateway confirms it server-side — never from a browser redirect alone.",
      "Only one pending payment is allowed for the same purchase at a time — starting a new checkout while one is already pending is blocked; complete or wait for the existing one to clear first.",
    ],
    related: ["payment-pending", "innvil-credit"],
  },
  {
    slug: "payment-pending",
    category: "troubleshooting",
    title: "Payment pending",
    description: "What to do while a crypto payment is still confirming.",
    keywords: ["payment", "pending", "crypto", "stuck"],
    body: [
      "A crypto payment starts as pending the moment checkout begins, and only activates once the gateway confirms it — this can take a few minutes depending on the network.",
      "Don't start a second payment for the same purchase while one is already pending — Billing blocks a duplicate pending checkout for exactly this reason. Wait for the existing one to clear, or check the gateway you paid through directly.",
      "If a payment seems stuck well beyond the gateway's normal confirmation time, contact support with the payment's reference id from your Billing payment history.",
    ],
    related: ["crypto-payments", "innvil-credit-not-updated"],
  },
  {
    slug: "innvil-credit-not-updated",
    category: "troubleshooting",
    title: "Innvil Credit not updated",
    description: "A top-up only credits your balance once the payment is actually confirmed.",
    keywords: ["innvil credit", "balance", "not updated", "missing"],
    body: [
      "Innvil Credit is only added once your crypto payment is confirmed server-side — a pending payment won't show as credit yet. See \"Payment pending\" if your payment is still confirming.",
      "Refresh or revisit the Billing page — your balance and activity history are read live, not cached.",
      "If a payment shows Paid in your history but the credit still doesn't reflect it, contact support with the payment's reference id.",
    ],
    related: ["innvil-credit", "payment-pending"],
  },
  {
    slug: "telegram-connection-issue",
    category: "troubleshooting",
    title: "Telegram connection issue",
    description: "The bot must actually be present in the Community, with the right rights, before anything goes live.",
    keywords: ["telegram", "connection", "permissions", "chat type"],
    body: [
      "Innvil verifies your Watcher's bot is actually present in the Telegram Community before it goes live — never assumed from the invite alone. If connection fails, confirm the bot was actually added to the group/supergroup/channel, not just invited.",
      "Only a real Telegram group, supergroup, or channel is supported — a private one-to-one Telegram chat can never be connected as a Community.",
      "The bot only requests the specific admin rights your configuration actually needs (delete-message/restrict if moderation is on, post rights if Auto-Posting is on). If those rights were revoked in Telegram after connecting, the affected capability will stop working until they're restored.",
    ],
    related: ["connect-a-community", "watcher-not-responding"],
  },
  {
    slug: "watcher-not-responding",
    category: "troubleshooting",
    title: "Watcher not responding",
    description: "The most common causes, and how to check each one.",
    keywords: ["watcher", "not responding", "troubleshoot", "silent"],
    body: [
      "Check the deployment is actually active — a Watcher profile existing isn't enough; it needs an ACTIVE deployment into the specific Community. See the Watcher's own detail page for its deployment status.",
      "Check your subscription/trial is currently active, not expired — an expired subscription pauses Watch operations without deleting anything. Billing shows your current status.",
      "Check the Community connection itself — a Watcher can only act with the Telegram admin rights it was actually granted (delete-message/restrict/post). See \"Telegram connection issue\".",
      "Check the Community's own status on the Communities page, and check Activity for that Community — a real decision (or a genuine silence, which is often correct) will show there.",
      "Not every message gets a reply — Watchers decide when responding actually adds value, and silence is frequently the right call, not a bug.",
    ],
    related: ["community-needs-attention", "telegram-connection-issue", "watcher-profiles-deployments-slots"],
  },
  {
    slug: "community-needs-attention",
    category: "troubleshooting",
    title: "Community needs attention",
    description: "What the health indicators on Overview and Communities actually mean.",
    keywords: ["needs attention", "health", "community status"],
    body: [
      "A Community is flagged \"needs attention\" for one of a few real, specific reasons — never a vague catch-all: it has no active Watcher deployed at all, or its Watcher-slot/Community capacity is nearing your plan's limit.",
      "Open the flagged item from Overview or Communities — it links straight to the real fix (deploy a Watcher, or upgrade/add capacity).",
      "A Watcher that's deployed but currently paused shows as its own distinct, lower-severity note — different from a Community with no Watcher at all.",
      "A private Escalation Group never triggers this check, even with no Watcher deployed into it — it's internal infrastructure, not a customer-facing Community.",
    ],
    related: ["watcher-not-responding", "community-capacity"],
  },

  /* ============================================================ Core Concepts ==== */
  {
    slug: "core-concepts",
    category: "concepts",
    title: "Core Concepts",
    description: "The terms used throughout Innvil Watch, in one place.",
    keywords: ["concepts", "glossary", "terminology", "definitions"],
    body: [
      "Innvil Watch — the platform. It gives Telegram communities Virtual Moderators (Watchers) that can moderate, communicate, use project knowledge, escalate questions, and operate continuously.",
      "Watcher — an individual Virtual Moderator. Its own name, Telegram bot identity, persona, and configuration — never a generic, interchangeable bot instance.",
      "Watcher Record — the complete configuration and operational identity of one Watcher: its persona, role, moderation behavior, knowledge, deployments, escalation settings, and status. This is where you define who a Watcher is and how it should behave.",
      "Community — a customer-facing Telegram group, supergroup, or channel where a Watcher is actively deployed. Never a private one-to-one Telegram chat, and never your own personal Telegram identity.",
      "Deployment — one Watcher operating inside one specific Community. Creating a Watcher and deploying it are two separate steps.",
      "Watcher Slot — the billing unit for one active deployment. 1 Watcher Slot = 1 active Watcher × 1 deployed customer-facing Community.",
      "Knowledge Base (Project Knowledge) — the facts, documentation, FAQs, and approved answers a Watcher can draw on when answering questions. A Watcher should prefer this over guessing.",
      "Persona — how a Watcher communicates: tone, vocabulary, formality, emoji use, response length.",
      "Role — what a Watcher is responsible for: moderation, support, security, technical answers, community leadership. Today, role is expressed through a Watcher's persona description and instructions rather than a separate structured field — see \"Personas and Roles.\"",
      "Moderation Rules — the configured behavior that decides what a Watcher acts on (spam, scams, explicit content, prohibited promotion) and what it does about it (warn, delete, escalate enforcement).",
      "Escalation Group — a private Telegram group where Watchers send questions they can't confidently answer, for an authorized admin to resolve. Also called Watcher Ops.",
      "Authorized Admin — someone with real Telegram administrator or creator status in the Escalation Group. Only an authorized admin's reply is treated as an approved answer.",
      "Escalation — a specific question or issue a Watcher has sent from a Community to the Escalation Group, awaiting a verified answer.",
      "Approved Knowledge — an admin's answer to an escalation, optionally promoted into the Knowledge Base so future, similar questions can be answered directly without escalating again.",
    ],
    related: ["what-is-innvil-watch", "what-is-a-watcher", "smart-escalation", "watcher-slots-and-billing"],
  },

  /* ================================================================ Watchers ==== */
  {
    slug: "watcher-records",
    category: "watchers",
    title: "Watcher Records",
    description: "The complete configuration and operational identity of one Watcher.",
    keywords: ["watcher record", "configuration", "identity"],
    body: [
      "A Watcher Record is the complete configuration and operational identity of one Watcher — this is where you define who the Watcher is and how it should behave.",
      "A Watcher Record can hold: its name, Telegram bot identity, persona (description, tone, style dials), custom behavior instructions, moderation configuration, knowledge it's grounded in, the Communities it's deployed to, escalation settings for its Project, scheduled-content configuration where enabled, provisioning/connection status, and its recent activity history.",
      "Every Watcher starts on a plain, unconfigured default persona — nothing is invented on your behalf. Giving it an explicit persona (a starting preset, or your own description and instructions) is a deliberate, per-Watcher step, never silently inherited from another Watcher or an account-wide default.",
      "Editing a Watcher Record changes how that ONE Watcher behaves going forward — it never retroactively rewrites past conversation history or past moderation decisions.",
    ],
    related: ["what-is-a-watcher", "personas-and-roles", "create-and-deploy-a-watcher"],
  },
  {
    slug: "personas-and-roles",
    category: "watchers",
    title: "Personas and Roles",
    description: "Persona is how a Watcher communicates. Role is what it's responsible for.",
    keywords: ["persona", "role", "tone", "personality", "preset"],
    body: [
      "Persona defines HOW a Watcher communicates: tone (professional, friendly, playful, concise, formal, technical), vocabulary, greeting style, emoji use, degree of formality, and typical response length. You can start from a curated preset (e.g. Calm Professional, Friendly Community Mod, Strict Moderator, Technical Expert, Diplomatic Mediator) or write your own description and instructions from scratch.",
      "Role defines WHAT a Watcher is responsible for: moderation, community support, security, technical answers, community leadership, engagement. Today, Innvil Watch doesn't have a separate structured \"Role\" field in the dashboard — you express a Watcher's role directly inside its persona description and instructions (for example: \"You are Sentinel, this community's security moderator — calm, concise, and focused on enforcing the rules\").",
      "Persona and role are still worth thinking about separately when you write a Watcher's configuration. The same role can be delivered with very different personas: a Security Moderator can be calm and concise, or terse and no-nonsense; a Community Manager can be friendly and energetic, or warm and measured. Decide the responsibility first, then the voice.",
      "A persona's writing style (capitalization, formality, slang) is fixed by its configuration and stays consistent — it doesn't drift over a long conversation, and it doesn't change just because someone comments on it or asks about it.",
      "A Watcher's persona is treated as its primary identity. Being AI-powered is a secondary fact it can acknowledge honestly if asked directly, but it doesn't replace or override the configured persona.",
    ],
    related: ["watcher-records", "community-conversation", "what-is-a-watcher"],
  },
  {
    slug: "community-conversation",
    category: "watchers",
    title: "Community Conversation",
    description: "How Watchers participate in ordinary community chat, not just react to commands.",
    keywords: ["conversation", "chat", "reply", "response", "engagement"],
    body: [
      "Where configured, a Watcher can participate naturally in ordinary conversation — greetings, casual chat, community questions, project discussions, and follow-ups that build on earlier context.",
      "A Watcher isn't meant to reply to every message. It decides whether responding actually adds value based on its configured role, what's already happened in the conversation, and how directly it's being addressed — silence is frequently the correct outcome, not a bug.",
      "A Watcher generally responds when it's directly addressed (mentioned, replied to, or called by name), and more selectively to ambient/general conversation, weighing recent activity so it doesn't repeat something another Watcher or a human just said.",
      "Multiple Watchers in the same Community coordinate so they don't all reply to the same message at once — see \"Multi-Watcher Communities\" for how that works today.",
      "Fine-grained response controls (e.g. a dashboard toggle for \"only respond when mentioned\" or a fixed reply frequency) are not currently exposed as customer-facing settings — response behavior is decided automatically per message rather than configured as a fixed rule. This is a planned area, not something available to configure today.",
    ],
    related: ["personas-and-roles", "conversation-context", "multi-watcher-communities"],
  },
  {
    slug: "conversation-context",
    category: "watchers",
    title: "Context and Conversation Memory",
    description: "How Watchers use recent conversation history — bounded, not unlimited.",
    keywords: ["context", "memory", "conversation history"],
    body: [
      "Where supported, a Watcher can use recent conversation context: who asked a question, who replied to it, whether a topic already came up, and whether it — or a different Watcher — already answered something recently.",
      "For example, if a member asks \"who did I ask that earlier?\" shortly after asking Ms VP a question, a Watcher may correctly answer \"You asked Ms VP earlier\" — because that exchange is still within its recent conversation window.",
      "This context is bounded to a recent window of the conversation, not unlimited or permanent memory. The further back an exchange happened, or the busier the Community has been since, the less likely a Watcher is to reference it accurately. Don't rely on a Watcher recalling something from days or weeks earlier unless it's been saved as Project Knowledge instead.",
      "Recent context is used to avoid redundant replies and to keep a conversation coherent — it is not the same thing as Project Knowledge, which is the durable, explicitly-approved information a Watcher answers from (see \"Project Knowledge\").",
    ],
    related: ["community-conversation", "project-knowledge", "multi-watcher-communities"],
  },
  {
    slug: "multi-watcher-communities",
    category: "watchers",
    title: "Multi-Watcher Communities",
    description: "More than one Watcher can be deployed in the same Community, each with its own job.",
    keywords: ["multiple watchers", "multi-watcher", "community", "coordination"],
    body: [
      "A single Community can have more than one Watcher deployed at once, each with a different role, persona, and specialty. For example: a Community Lead handling engagement and general questions, a Support Watcher answering FAQs, and a Security Watcher focused on moderation.",
      "Each deployment into that Community consumes its own Watcher slot — three Watchers deployed to one Community uses three slots, the same as three Watchers deployed across three separate Communities. See \"Watcher Slots and Billing\" for the exact formula.",
      "When several Watchers are deployed together, they're designed to avoid piling on: replying to the exact same message with several near-identical answers is treated as unhelpful, not as thoroughness. A message addressed to a specific Watcher by name is answered by that Watcher; a message that's clearly for the whole team may get more than one response, bounded so it doesn't turn into every Watcher replying at once.",
      "If a member's message names one Watcher, another deployed Watcher won't speak on that Watcher's behalf or invent what it would have said — each Watcher only speaks for itself.",
    ],
    related: ["community-conversation", "watcher-slots-and-billing", "deployment"],
  },

  /* ============================================================= Knowledge ==== */
  {
    slug: "project-knowledge",
    category: "knowledge",
    title: "Project Knowledge",
    description: "The facts a Watcher can ground its answers in.",
    keywords: ["knowledge", "project knowledge", "facts", "documentation"],
    body: [
      "Project Knowledge is the project-specific information a Watcher can use to answer questions: your project's documentation, FAQs, policies, official announcements, and information you or the team add directly — including answers approved through escalation (see \"Approved Knowledge\").",
      "The core rule: a Watcher should prefer verified knowledge over guessing. It's instructed never to invent an answer about your project when your Project Knowledge doesn't actually support one.",
      "Knowledge you add to one Project stays isolated to that Project — it never leaks into a different Project's Watchers or Communities.",
      "You manage Project Knowledge from your Project's Knowledge tab. A community-level entry can locally override a Project-wide one for that specific Community — useful for a detail that's only true in one particular group.",
    ],
    related: ["create-a-project", "answer-confidence", "approved-knowledge"],
  },
  {
    slug: "answer-confidence",
    category: "knowledge",
    title: "Answer Confidence",
    description: "Verified Answer, Known Unavailable, and Insufficient Information — how a Watcher decides.",
    keywords: ["confidence", "verified", "unavailable", "insufficient", "hallucination"],
    body: [
      "A Watcher's answer to a question falls into one of three states, depending on what its Project Knowledge actually supports.",
      "Verified Answer — the Watcher has sufficient approved knowledge to answer directly. It answers normally, grounded in what's actually been provided.",
      "Known Unavailable — the Project Knowledge explicitly says something hasn't been announced, confirmed, or decided yet. The Watcher states that honestly rather than treating it as a gap to escalate. Example: \"The team hasn't announced a distribution date yet.\"",
      "Insufficient Information — the Watcher can't find enough verified information to answer reliably, and the question genuinely needs project-specific facts (not something answerable generally or socially). It does not guess. If a private Escalation Group is configured for the Project, it forwards the question instead — see \"Smart Escalation.\" Example: \"I don't have a verified answer for that yet, so I've forwarded the question to the team rather than guessing.\"",
      "Without a configured Escalation Group, Insufficient Information is handled the same honest way, just without the forward — the Watcher says it doesn't have that information rather than inventing one.",
    ],
    related: ["project-knowledge", "smart-escalation", "safety-and-reliability"],
  },
  {
    slug: "approved-knowledge",
    category: "knowledge",
    title: "Approved Knowledge and Expiration",
    description: "Turning an admin's escalation answer into reusable knowledge — with an optional expiration date.",
    keywords: ["approved knowledge", "expiration", "time-sensitive", "promote"],
    body: [
      "When an authorized admin answers an escalation, that answer resolves the specific question by default — a one-time resolution that's relayed back to the community and goes no further.",
      "From the Project's Escalations tab, an answered (but not yet promoted) escalation shows a \"Save as Project Knowledge\" action. Using it stores the admin's answer as a real Project Knowledge entry, so future, similar questions can be answered directly instead of escalating again.",
      "A promoted answer can be given an optional expiration date — useful for time-sensitive facts like a distribution date, a claim window, an exchange listing, a maintenance window, or a promotion end date. Once an expiration date passes, that entry is no longer used to answer questions as if it were current — a Watcher won't confidently present expired information as still true.",
      "Only an authorized admin's reply can be promoted this way — see \"Watcher Ops / Escalation Group\" for who counts as authorized.",
    ],
    related: ["smart-escalation", "admin-responses", "project-knowledge"],
  },

  /* ============================================================ Moderation ==== */
  {
    slug: "natural-moderation",
    category: "moderation",
    title: "Natural Moderation",
    description: "Warnings phrased like a real moderator, not a mechanical bot command.",
    keywords: ["natural moderation", "warning", "tone", "enforcement"],
    body: [
      "When a Watcher warns someone, it's phrased in natural language consistent with its persona, rather than a fixed, robotic template — while staying consistent with your community's policy and the graduated-enforcement rule described in \"Moderation overview.\"",
      "Example: \"Hey @username, that's the second promotional post I've had to remove. Please keep promotional links out of this community — another violation may result in further action.\"",
      "A warning never restates the specific violating content back into the chat, and it never sounds like a generic canned message repeated word-for-word every time — the phrasing varies while the underlying enforcement decision stays consistent and rule-based.",
    ],
    related: ["how-moderation-works", "media-moderation"],
  },
  {
    slug: "media-moderation",
    category: "moderation",
    title: "Media Moderation",
    description: "Explicit/sexual content classification for photos and video — a separate, optional layer from text moderation.",
    keywords: ["media moderation", "photo", "video", "explicit content", "nsfw"],
    body: [
      "Media Moderation is a separate, optional layer from text and link moderation — it classifies photos, and video where enabled, specifically for explicit/sexual content. It does not moderate media for other reasons (e.g. copyright, general appropriateness) — only this one category.",
      "A high-confidence explicit result is enforced immediately (message deleted, escalating enforcement on repeats), the same severity as a high-confidence scam/phishing link. A borderline or uncertain result follows the same graduated warning path as unsolicited promotion.",
      "Video classification is a separate capability from photo classification and is enabled per account where available — check your plan/account for current availability.",
      "Media Moderation is billed separately from ordinary AI usage, in Media Moderation Units, with its own included allowance per plan — see \"Plans and Billing.\"",
      "This is distinct from text/link moderation, which covers spam, phishing/scam links, and unsolicited promotion — see \"Moderation overview.\"",
    ],
    related: ["how-moderation-works", "plans-and-billing", "permissions"],
  },
  {
    slug: "permissions",
    category: "moderation",
    title: "Permissions",
    description: "The Telegram admin rights a Watcher needs for actions that modify messages or members.",
    keywords: ["permissions", "telegram", "admin rights", "bot"],
    body: [
      "A Watcher can only take actions its Telegram bot account actually has rights for. Reading and replying to messages doesn't require special rights; deleting a message, restricting a member, or removing a member requires the bot to be a real Telegram admin with those specific rights granted.",
      "When you connect a Watcher to a Community, it only requests the admin rights its own configuration actually uses — delete-message and restrict/ban rights if moderation is on, post rights if scheduled content is on. Innvil never requests blanket admin access up front.",
      "Not every deployment supports every possible action — if a needed right was revoked in Telegram after connecting, that specific capability (for example, deleting a message) stops working until the right is restored, while everything else continues normally.",
      "If a Watcher's moderation seems to have stopped working, check its Community's own connection status first — see \"Telegram connection issue.\"",
    ],
    related: ["how-moderation-works", "connect-a-community", "telegram-connection-issue"],
  },
  {
    slug: "safety-and-reliability",
    category: "moderation",
    title: "Safety and Reliability",
    description: "The core principles a Watcher follows to avoid fabricating information or overstepping its authority.",
    keywords: ["safety", "reliability", "hallucination", "audit"],
    body: [
      "A Watcher is designed to: prefer approved Project Knowledge over guessing, escalate a genuinely uncertain, high-impact question rather than answer it anyway, preserve admin authority (only an authorized admin's reply is treated as an approved answer), never publish private Escalation Group content back into a public Community beyond the specific approved answer, respect the Telegram permission boundaries it was actually granted, and keep a real activity record of its moderation decisions.",
      "Particularly sensitive topics are held to the same \"prefer verified knowledge, escalate when uncertain\" standard, and deserve extra care when you decide what to put in Project Knowledge: contract addresses, token distribution details, exchange listings, financial guarantees, partnerships, legal statements, security incidents, and official announcements. Treat these as exactly the kind of question worth routing through Smart Escalation rather than leaving to inference.",
      "None of this guarantees a Watcher is never wrong — it describes the design intent (prefer facts, escalate uncertainty, respect authority and permissions), not an absolute guarantee for every possible message.",
    ],
    related: ["answer-confidence", "smart-escalation", "how-moderation-works"],
  },

  /* ============================================================= Escalation ==== */
  {
    slug: "smart-escalation",
    category: "escalation",
    title: "Smart Escalation",
    description: "When a Watcher can't confidently answer, it asks your team instead of guessing.",
    keywords: ["smart escalation", "escalation", "escalate", "unresolved"],
    body: [
      "A Watcher doesn't just say \"I don't know\" and stop there. When it genuinely can't find verified information for a question that needs project-specific facts, and a private Escalation Group is configured for the Project, it forwards the question there instead of guessing.",
      "The lifecycle: a community question comes in → the Watcher checks its Project Knowledge → if that's insufficient, it escalates → an authorized admin answers in the Escalation Group → the verified answer is relayed back to the original community → optionally, the answer is promoted into reusable Project Knowledge.",
      "Example — Member: \"When is token distribution?\" Watcher: \"We don't currently have a confirmed distribution date in the available project information. I've forwarded this to the team for clarification and will follow up here once they respond.\"",
      "Escalation only ever fires for a genuine informational question the Watcher can't answer — never for idle chat or something answerable generally/socially, and never when the Project Knowledge already has a real (even if \"not yet announced\") answer — see \"Answer Confidence.\"",
      "Escalation is Project-wide: any Watcher deployed to any Community in the Project can raise one, as long as the Project has a connected Escalation Group.",
    ],
    related: ["answer-confidence", "watcher-ops-escalation-group", "admin-responses", "escalation-group-slot-rule"],
  },
  {
    slug: "watcher-ops-escalation-group",
    category: "escalation",
    title: "Watcher Ops / Escalation Group",
    description: "The private Telegram group where Watchers send unresolved questions AND report moderation actions.",
    keywords: ["escalation group", "watcher ops", "private group", "admin", "moderation reports"],
    body: [
      "An Escalation Group is a private Telegram group your team controls — it's both the place Watchers send questions they can't confidently answer, and the project's real moderation operations/audit channel. Some teams call it \"Watcher Ops\" — there's no required naming convention.",
      "Connect one from a Project's Communities tab using \"+ Connect Escalation Group.\" It works through the exact same Telegram-connection flow as connecting an ordinary Community: add the Watcher's bot to your private group, then verify it from the dashboard, picking a Watcher whose bot confirms the connection.",
      "Only one Watcher needs to be deployed into the Escalation Group for it to work for the whole Project — every other Watcher across the Project's Communities can still raise escalations and moderation reports through it. The verified answer to a question is always relayed back through the ORIGINAL escalating Watcher's own bot, into its own Community — never a different Watcher's identity.",
      "Multiple Watchers and multiple Communities in the same Project can share one Escalation Group.",
      "Two kinds of posts show up there, visually distinguished so you can tell them apart at a glance: a Knowledge Escalation (the originating Community, the escalating Watcher, the asking member, the original question, and a note that no confirmed answer was found — reply directly to that message in Telegram to answer it), and a Moderation Action report (a warning, temporary mute, kick, message purge, or scam/NSFW removal a Watcher already took on its own — see \"Watcher Ops Moderation Reports\"). A moderation report is informational only — replying to it doesn't do anything; the enforcement it describes has already happened.",
      "Authorization for answering a question is based on real Telegram admin/creator status in the Escalation Group — an authorized admin is anyone Telegram itself recognizes as an administrator or the creator of that group. A regular member replying is never treated as an authoritative source — see \"Admin Responses.\"",
      "A private Escalation Group never consumes a Watcher slot or counts toward your plan's Community allowance — see \"Watcher Slots and Billing.\" It's strongly recommended for every Project (your dashboard shows a reminder when none is connected), but it's optional — a Watcher without one still moderates and answers normally, it just has nowhere to forward a question it can't answer or report what it did.",
    ],
    related: ["smart-escalation", "watcher-ops-moderation-reports", "admin-responses", "escalation-group-slot-rule", "escalation-roadmap"],
  },
  {
    slug: "watcher-ops-moderation-reports",
    category: "escalation",
    title: "Watcher Ops Moderation Reports",
    description: "Real-time, structured reports of every meaningful moderation action a Watcher takes.",
    keywords: ["moderation reports", "watcher ops", "audit", "warning", "mute", "kick", "purge"],
    body: [
      "Whenever a Watcher takes a meaningful moderation action — issuing a warning, applying a temporary mute, kicking a repeat offender, purging a removed user's messages, or removing a scam link or prohibited content — it posts a structured report into your connected Escalation Group, so your team has visibility without needing to constantly watch every public Community.",
      "Reports are built from templates, not written by a model — every fact (username, warning number, mute duration, purge result, which Watcher acted) is already known before the report is generated, so the wording is predictable and never robotic-sounding filler. Deterministic reports like these never count toward your account's AI Generations usage.",
      "Not every tiny action gets its own report — the goal is a useful operational record, not noise. A report only fires for a genuinely meaningful event: a warning, a mute, a kick, a purge, or a moderation action that couldn't complete due to missing Telegram permissions.",
      "Reports reflect ACTUAL outcomes, never an assumed one — if a kick or a message purge fails (for example, because the Watcher's bot doesn't have the right admin permission in that Community), the report says so honestly instead of claiming success.",
      "Warning and mute history for a member belongs to the Community they're in, not to whichever specific Watcher happened to catch each incident — if a second Watcher in the same Community catches the same person spamming again, it sees the existing history and continues the escalation rather than starting over.",
      "When more than one Watcher is deployed in a Community, only one of them acts on and reports any given violation — you'll never see duplicate warnings, duplicate kicks, or duplicate reports for the same incident.",
      "This is available on the Free Trial too — it's a core part of what makes Watcher Ops useful, not something held back for paid plans.",
    ],
    related: ["watcher-ops-escalation-group", "how-moderation-works", "natural-moderation", "media-moderation"],
  },
  {
    slug: "escalation-group-slot-rule",
    category: "escalation",
    title: "The Escalation Group Slot Rule",
    description: "An Escalation Group never consumes a Watcher slot. This is a hard billing rule, not a default that can drift.",
    keywords: ["slot rule", "escalation group", "billing", "does not count"],
    body: [
      "A Watcher Slot is defined as: 1 Watcher Slot = 1 active Watcher × 1 deployed customer-facing Community. An Escalation Group is internal operational infrastructure, not a customer-facing Community deployment — connecting or deploying into one never consumes a slot and never counts toward your plan's Community allowance.",
      "Worked examples:",
      "Watcher A deployed to Community 1 = 1 slot.",
      "Watcher A deployed to Community 1 and Community 2 = 2 slots.",
      "Watcher A and Watcher B both deployed to Community 1 = 2 slots.",
      "Watcher A deployed to Community 1, plus the same Watcher deployed into a private Escalation Group = still 1 slot.",
      "Three Watchers (A, B, C) across two Communities — A and B in Community 1, C in Community 2 — all also connected to one shared Escalation Group = 3 slots, not 6. The Escalation Group adds zero.",
      "This is a firm rule, enforced the same way whether you have one Escalation Group or none: it's counted only as a customer-facing Community when it's actually one, and it never is.",
    ],
    related: ["watcher-ops-escalation-group", "watcher-slots-and-billing", "smart-escalation"],
  },
  {
    slug: "admin-responses",
    category: "escalation",
    title: "Admin Responses",
    description: "How an authorized admin answers an escalation, and how the answer gets back to the community.",
    keywords: ["admin response", "reply", "answer escalation"],
    body: [
      "An authorized admin answers an escalation by replying directly to the Watcher's escalation message inside the Escalation Group — a plain Telegram reply, no special command syntax.",
      "Example — Watcher escalation: \"When is token distribution?\" Admin reply: \"Distribution is scheduled for September 12. The claim page will be announced 24 hours beforehand.\"",
      "The Watcher then relays that answer back into the original community, replying to the member's original question: \"Update from the team: Distribution is scheduled for September 12. The claim page will be announced approximately 24 hours beforehand.\"",
      "A reply from someone who isn't a real Telegram admin or creator of the Escalation Group is silently ignored — it's never treated as an approved answer and nothing is sent back to the community. This is a hard security rule, not a default that can be relaxed by accident.",
      "Once an escalation has been answered, a second reply to the same escalation doesn't overwrite the recorded answer or send a duplicate update — the first authorized answer stands.",
      "From the Escalations tab, an answered escalation can optionally be promoted to reusable Project Knowledge — see \"Approved Knowledge.\"",
    ],
    related: ["watcher-ops-escalation-group", "approved-knowledge", "smart-escalation"],
  },
  {
    slug: "escalation-roadmap",
    category: "escalation",
    title: "What Smart Escalation Doesn't Do Yet",
    description: "An honest list of escalation capabilities that are planned but not available today.",
    keywords: ["roadmap", "planned", "duplicate detection", "admin routing", "roles"],
    body: [
      "Smart Escalation today is a real, working closed loop: confidence-gated escalation, a private Escalation Group, real Telegram admin/creator authorization, and an optional promotion to Project Knowledge. A few related capabilities aren't available yet — listed here honestly rather than implied.",
      "Duplicate escalation merging — if many members ask a variant of the same question in a short window, each currently raises its own escalation rather than being automatically grouped into one (e.g. \"18 members have asked about token distribution in the last 3 hours\"). Answering one escalation today resolves that one question; it doesn't automatically close out every similarly-worded one.",
      "Topic-based admin routing — assigning specific topics (distribution, technical support, partnerships, listings) to specific responsible admins, so a Watcher can notify or suggest the right person, isn't available yet. Every real Telegram admin/creator of the Escalation Group can currently answer any escalation.",
      "Priority/urgency levels — escalations aren't currently classified as Normal/Important/Urgent.",
      "A full named authorization role system (Project Owner, Admin, Knowledge Approver, Moderator, Viewer) isn't available yet — authorization today is exactly \"is this person a real Telegram admin or creator of the Escalation Group,\" described in \"Watcher Ops / Escalation Group.\"",
      "An escalation analytics/metrics dashboard (open/answered/expired/high-volume counts, response-time metrics) isn't available yet — the Escalations tab today shows a plain Open/Answered list.",
    ],
    related: ["watcher-ops-escalation-group", "smart-escalation", "dashboard-tour"],
  },

  /* ============================================================ Communities ==== */
  {
    slug: "deployment",
    category: "communities",
    title: "Deployment",
    description: "Assigning a Watcher to operate inside a specific customer-facing Community.",
    keywords: ["deployment", "deploy", "assign"],
    body: [
      "A deployment is what happens when a Watcher is assigned to actually operate inside a customer-facing Telegram Community. Creating a Watcher Record and deploying it are two separate steps — a Watcher isn't live anywhere until it's deployed.",
      "Deploying a Watcher into a new Community requires: the Watcher's Telegram bot actually added to that Community, Innvil verifying the bot is genuinely present there, the Project the Community belongs to, and enough remaining Watcher-slot and Community capacity on your plan.",
      "Deployment is where the Watcher's already-configured persona, moderation, and knowledge settings actually start applying to that Community — you don't reconfigure the Watcher per deployment, you configure it once on its Watcher Record and deploy it wherever it should operate.",
      "Deploying into a private Escalation Group uses this exact same connection flow, but is exempt from Watcher-slot and Community-allowance billing — see \"The Escalation Group Slot Rule.\"",
    ],
    related: ["watcher-profiles-deployments-slots", "connect-a-community", "watcher-slots-and-billing"],
  },

  /* ========================================================= Plans & Billing ==== */
  {
    slug: "watcher-slots-and-billing",
    category: "plans-billing",
    title: "Watcher Slots and Billing",
    description: "Watcher Slot Usage = Active Watcher × Active Customer-Facing Community Deployment.",
    keywords: ["watcher slots", "billing", "formula", "deployments"],
    body: [
      "Watcher slots measure deployments, not the number of Watcher identities you've created in the dashboard. The formula: Watcher Slot Usage = Active Watcher × Active Customer-Facing Community Deployment.",
      "Example 1 — 1 Watcher, 1 Community = 1 slot.",
      "Example 2 — 1 Watcher, 3 Communities = 3 slots.",
      "Example 3 — 3 Watchers, 1 Community = 3 slots.",
      "Example 4 — 3 Watchers across 2 Communities (Watcher A → Community 1, Watcher B → Community 1, Watcher C → Community 2) = 3 slots. All three also connected to one private Escalation Group = still 3 slots — the Escalation Group adds zero.",
      "Creating a Watcher Record doesn't by itself use a slot; only an active deployment does. Pausing a deployment frees its slot immediately; reactivating it re-checks your current capacity against your plan.",
      "See \"The Escalation Group Slot Rule\" for the full billing rule around Escalation Groups, and \"Watcher Profiles vs Deployments vs Slots\" for the underlying concepts.",
    ],
    related: ["escalation-group-slot-rule", "watcher-profiles-deployments-slots", "plans-and-billing"],
  },
  {
    slug: "scheduled-content",
    category: "plans-billing",
    title: "Scheduled Content",
    description: "Auto-Posting — one AI-generated post per day, per Watcher, grounded in your Project Knowledge.",
    keywords: ["scheduled content", "auto-posting", "scheduled posts"],
    body: [
      "Where enabled on your plan, a Watcher deployed to a Community can publish scheduled content automatically — Auto-Posting. Each assigned Watcher publishes at most one AI-generated post per day, at a random time inside a posting window you configure for that Community.",
      "Post content is generated by the Watcher using your Project's real knowledge — it's not something you write and queue up manually today, and it won't fabricate announcements, prices, or claims beyond what your Project Knowledge actually supports.",
      "Auto-Posting is available on every paid plan (Bronze and up) and on Enterprise — it's not available on the Free Trial.",
      "This is a separate capability from ordinary conversation and moderation — a Community can use Auto-Posting, chat, and moderation independently of each other.",
    ],
    related: ["plans-and-billing", "project-knowledge"],
  },

  /* ============================================================== Dashboard ==== */
  {
    slug: "dashboard-tour",
    category: "dashboard",
    title: "Where Everything Lives",
    description: "A short tour of the real dashboard structure.",
    keywords: ["dashboard", "navigation", "sidebar", "where is"],
    body: [
      "Overview — your account's real-time summary: capacity, anything that needs attention, and recent activity across every Project.",
      "Projects — create and manage Projects. Inside a Project's detail page you'll find its own Overview, Knowledge (Project Knowledge), Escalations (the Open/Answered list and Save-as-Knowledge action), Communities (connect a Community or an Escalation Group), Watchers (deployed into this Project), Activity, and Settings tabs.",
      "Communities — every Telegram Community connected across your Projects. Inside a Community's detail page: Overview, Watchers deployed there, Moderation (configuration and recent decisions), Auto-Posting (where enabled), and Settings.",
      "Watchers — create and manage Watcher Records. Inside a Watcher's detail page: Overview, Persona, Deployments (every Community it's assigned to), Activity, and Settings.",
      "Activity and Deployments — Activity is a full, filterable feed of what's happened across your account. Deployments is a flat, operational view of exactly which Watcher is deployed to which Community and how that maps to slot usage.",
      "Usage — your real current capacity: Watcher slots and Communities used vs. your plan's totals, plus AI Generations and Media Moderation usage where applicable.",
      "Plans and Billing — choosing or changing your plan, and your payment history/current subscription status.",
      "Profile and Settings — your account identity, connected Telegram identity, notifications, and moderation defaults.",
      "There is currently no separate top-level \"Knowledge,\" \"Escalations,\" \"Moderation,\" or \"Scheduling\" section in the main sidebar — each of those lives inside the relevant Project, Community, or Watcher's own detail page, scoped to that specific record, rather than as one global list across everything.",
      "Analytics: today's real operational visibility is Activity (a real event feed) and Usage (real capacity numbers) — a dedicated analytics dashboard with metrics like scams detected, questions answered automatically, or escalation response time isn't available yet.",
    ],
    related: ["watcher-slots-and-billing", "smart-escalation", "escalation-roadmap"],
  },

  /* ===================================================================== FAQ ==== */
  {
    slug: "faq",
    category: "faq",
    title: "Frequently Asked Questions",
    description: "Quick answers to the questions people ask most.",
    keywords: ["faq", "questions", "help"],
    body: [
      "Is Innvil Watch a Telegram moderation bot? It includes moderation, but that's one part of a broader Virtual Moderator platform. A Watcher can also converse naturally, answer from your Project Knowledge, and escalate questions it can't confidently answer — a traditional moderation bot generally only reacts to commands and fixed rules.",
      "What is a Watcher? An individual Virtual Moderator you deploy into a Community — its own name, Telegram identity, persona, and configuration. See \"What is a Watcher?\" for the full explanation.",
      "Can multiple Watchers join the same Community? Yes — see \"Multi-Watcher Communities.\" Each one is its own deployment and consumes its own slot.",
      "Does each Watcher deployment consume a slot? Yes — one active deployment (one Watcher operating in one customer-facing Community) is one Watcher slot. Creating a Watcher Record without deploying it doesn't use a slot. See \"Watcher Slots and Billing.\"",
      "Does an Escalation Group consume a slot? No. A private Escalation Group is internal ops infrastructure, never a customer-facing Community — connecting or deploying into one never counts toward your Watcher-slot or Community allowance. See \"The Escalation Group Slot Rule.\"",
      "What happens if a Watcher doesn't know the answer? If it can't find enough verified information and a private Escalation Group is configured, it forwards the question to your team instead of guessing, and relays the verified answer back once it has one. See \"Smart Escalation.\"",
      "Can admins teach Watchers new information? Yes — an authorized admin's answer to an escalation can optionally be promoted into reusable Project Knowledge, with an optional expiration date for time-sensitive facts. See \"Approved Knowledge.\"",
      "Can Watchers have different personalities? Yes — persona is fully configurable per Watcher, from a curated preset or your own description. See \"Personas and Roles.\"",
      "Can Watchers moderate media? Yes, where enabled — explicit/sexual content in photos and video is classified and enforced separately from text/link moderation. See \"Media Moderation.\"",
      "Can Watchers remove users? Only if their Telegram bot account has the admin rights to do so. Innvil requests only the specific rights a Watcher's configuration actually needs. See \"Permissions.\"",
      "Does Watch replace all human admins? No. Watch handles routine community operations — conversation, moderation, and answering from verified knowledge — continuously, while your team remains the authority for decisions, approvals, and information a Watcher genuinely doesn't have.",
    ],
    related: ["what-is-innvil-watch", "watcher-slots-and-billing", "smart-escalation"],
  },

  /* ================================================================ Path ==== */
  {
    slug: "getting-started-path",
    category: "getting-started",
    title: "Getting Started: Your First Watcher",
    description: "The full path from a new account to a live Watcher in your Telegram Community.",
    keywords: ["getting started", "setup", "first watcher", "path"],
    body: [
      "1. Create a Watcher — give it a name from your Watchers page.",
      "2. Configure its persona (and, in effect, its role) — pick a starting preset or write your own description and instructions. See \"Personas and Roles.\"",
      "3. Add Project Knowledge — the facts your Watcher can ground its answers in. See \"Project Knowledge.\"",
      "4. Configure moderation — decide what your Watcher should act on and how. See \"Moderation overview.\"",
      "5. Deploy to a Telegram Community — add the Watcher's bot to your group/supergroup/channel and verify it from the dashboard. See \"Deployment\" and \"Connect a Community.\"",
      "6. Connect an Escalation Group (optional but recommended) — a private group for your team to answer questions your Watcher can't. See \"Watcher Ops / Escalation Group.\"",
      "7. Test it — ask it a question your Project Knowledge covers, one it genuinely doesn't, and check its moderation on a test message, before relying on it in a live Community.",
      "8. Go live — once you're satisfied, let it operate in the real Community. Everything above stays editable afterward: persona, knowledge, moderation, and deployments are never locked in.",
    ],
    related: ["what-is-innvil-watch", "create-and-deploy-a-watcher", "smart-escalation"],
  },
];

/* ------------------------------------------------------------ lookups ---- */

export function getArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}

export function articlesByCategory(category: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === category);
}

export function relatedArticles(article: HelpArticle): HelpArticle[] {
  return article.related.map((slug) => getArticle(slug)).filter((a): a is HelpArticle => a != null);
}

export const POPULAR_ARTICLE_SLUGS = [
  "getting-started-path", "what-is-a-watcher", "smart-escalation", "watcher-slots-and-billing",
  "watcher-profiles-deployments-slots", "start-the-free-trial", "connect-a-community",
  "innvil-credit", "watcher-not-responding", "faq",
];

export function popularArticles(): HelpArticle[] {
  return POPULAR_ARTICLE_SLUGS.map((slug) => getArticle(slug)).filter((a): a is HelpArticle => a != null);
}

/** Simple client-safe local search over title/description/keywords/body --
 *  no external search service. Scores title matches highest, then
 *  description/keywords, then a body-text hit; returns nothing for a query
 *  with zero real overlap rather than falling back to "show everything". */
export function searchArticles(query: string, limit = 8): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored = HELP_ARTICLES.map((a) => {
    let score = 0;
    const title = a.title.toLowerCase();
    const description = a.description.toLowerCase();
    const keywordText = a.keywords.join(" ").toLowerCase();
    const bodyText = a.body.join(" ").toLowerCase();
    for (const term of terms) {
      if (title.includes(term)) score += 5;
      if (keywordText.includes(term)) score += 3;
      if (description.includes(term)) score += 2;
      if (bodyText.includes(term)) score += 1;
    }
    return { article: a, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.article);
}
