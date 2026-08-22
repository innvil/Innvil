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
import { INNVIL_CREDIT_DISCOUNT, ANNUAL_CREDIT_DISCOUNT_BPS } from "@/src/lib/products/innvil-credit-pricing";
import { MANAGED_ENTERPRISE_50, WATCH_ENTERPRISE_BYO_TIERS } from "@/src/lib/products/watch-enterprise";

export type HelpCategoryId =
  | "getting-started" | "watchers" | "communities" | "plans-billing" | "innvil-credit" | "account" | "troubleshooting";

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  description: string;
}

export const HELP_CATEGORIES: HelpCategory[] = [
  { id: "getting-started", label: "Getting Started", description: "Innvil Watch, Watchers, and your first deployment." },
  { id: "watchers", label: "Watchers", description: "Profiles, deployments, slots, and configuration." },
  { id: "communities", label: "Projects & Communities", description: "Projects, connecting a Telegram Community, and capacity." },
  { id: "plans-billing", label: "Plans & Billing", description: "The Free Trial, plans, and how payment works." },
  { id: "innvil-credit", label: "Innvil Credit", description: "Prepaid service credit for Innvil products." },
  { id: "account", label: "Account & Telegram", description: "Your Innvil account and connected Telegram identity." },
  { id: "troubleshooting", label: "Troubleshooting", description: "Common issues and how to check them." },
];

export interface HelpArticle {
  slug: string;
  category: HelpCategoryId;
  title: string;
  description: string;
  keywords: string[];
  body: string[];
  related: string[];
}

const plans = watchPlanOptions();
const planLine = plans.map((p) => `${p.displayName} $${p.price.toFixed(2)}/mo`).join(", ");
const slotLine = plans.map((p) => `${p.displayName} ${p.slots}`).join(" · ");
const discountedTiers = plans.filter((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0).map((p) => p.displayName).join("/");
const monthlyDiscountPct = Math.round((plans.find((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0) ? INNVIL_CREDIT_DISCOUNT[plans.find((p) => INNVIL_CREDIT_DISCOUNT[p.tier] > 0)!.tier] : 0) * 100);
const annualDiscountPct = ANNUAL_CREDIT_DISCOUNT_BPS / 100;

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "what-is-innvil-watch",
    category: "getting-started",
    title: "What is Innvil Watch?",
    description: "Innvil Watch is a standalone Community Operations product — AI-powered Watchers for your Telegram Communities.",
    keywords: ["watch", "product", "overview", "community operations"],
    body: [
      "Innvil Watch gives your Telegram Community AI-powered Virtual Moderators called Watchers. A Watcher can moderate, protect, monitor, and help operate your Community — around the clock.",
      "Watch is a standalone Innvil product: one Innvil account gives you access to Watch, and to any other Innvil product you choose to use.",
      "The core building blocks are Project (your identity and knowledge base), Community (the actual Telegram group, supergroup, or channel you connect), and Watcher (the AI moderator you deploy into a Community).",
    ],
    related: ["what-is-a-watcher", "create-a-project", "connect-a-community"],
  },
  {
    slug: "what-is-a-watcher",
    category: "getting-started",
    title: "What is a Watcher?",
    description: "A Watcher is an AI-powered Virtual Moderator you deploy to your Community.",
    keywords: ["watcher", "virtual moderator", "ai", "persona"],
    body: [
      "A Watcher is an AI-powered Virtual Moderator you deploy to your Community. Each Watcher has its own persona and settings, and can be deployed to one or more Communities.",
      "A Watcher can moderate (spam/scam detection with graduated enforcement), answer questions grounded in your Project's knowledge, stay active and post on a schedule (Auto-Posting, where configured), and surface its own activity — all opt-in, nothing is on by default.",
      "Creating a Watcher and deploying it are two separate steps — see \"Watcher Profiles vs Deployments vs Slots\" for the full relationship.",
    ],
    related: ["watcher-profiles-deployments-slots", "create-and-deploy-a-watcher", "how-moderation-works"],
  },
  {
    slug: "how-moderation-works",
    category: "watchers",
    title: "How moderation works",
    description: "Graduated, opt-in enforcement — never a blanket ban on the first offense.",
    keywords: ["moderation", "spam", "scam", "warning", "ban"],
    body: [
      "Moderation is opt-in per Watcher — nothing is enabled without your choice, and it's independent of media safety and Auto-Posting.",
      "For unsolicited promotion/link spam, enforcement is graduated: a warning first, escalating only on repeat offenses within the same Community.",
      "For clearly severe cases (explicit content, phishing/scam links at high confidence), enforcement is immediate — these are treated as safety issues, not subject to the graduated-warning path.",
      "Every real moderation decision — warn, kick, or ban — is recorded in that Community's Activity feed. Routine chatter and silence are never logged as moderation events.",
    ],
    related: ["what-is-a-watcher", "watcher-not-responding", "community-needs-attention"],
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
    ],
    related: ["what-is-a-watcher", "create-and-deploy-a-watcher", "community-capacity"],
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
    ],
    related: ["community-expansion", "plans-and-billing", "community-needs-attention"],
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
    description: "Bronze through Platinum, monthly or annual, and how payment works.",
    keywords: ["plans", "billing", "pricing", "annual", "monthly"],
    body: [
      `Self-serve monthly plans: ${planLine}. Each includes a Watcher-slot allowance (${slotLine}) and a separate Community allowance.`,
      `Each plan also includes a pooled monthly AI Generations allowance — Bronze ${MODERATOR_AI_GENERATION_POOL.basic.toLocaleString()}, Silver ${MODERATOR_AI_GENERATION_POOL.standard.toLocaleString()}, Gold ${MODERATOR_AI_GENERATION_POOL.premium.toLocaleString()}, Platinum ${MODERATOR_AI_GENERATION_POOL.pro.toLocaleString()} per billing period, shared across every Watcher on the account. An AI Generation is counted once your Watcher's AI reply is successfully generated — deterministic actions like silence, reactions, short acknowledgements, and moderation decisions never consume one.`,
      `Media Moderation + is an optional add-on available on every self-serve plan — Bronze +$${MODERATOR_MEDIA_ADDON.basic.price.toFixed(2)}/mo, Silver +$${MODERATOR_MEDIA_ADDON.standard.price.toFixed(2)}/mo, Gold +$${MODERATOR_MEDIA_ADDON.premium.price.toFixed(2)}/mo, Platinum +$${MODERATOR_MEDIA_ADDON.pro.price.toFixed(2)}/mo, each with its own included Media Moderation Unit allowance per period.`,
      `Annual billing is available on every self-serve plan, at ${annualDiscountPct}% off 12 months of the regular price — paid upfront with Innvil Credit only, no direct crypto option for annual.`,
      "Watch is billed with crypto payments (Cryptomus, NOWPayments, or Binance Pay, depending on what's configured) or Innvil Credit, a discounted second way to pay. There is currently no auto-renewal — you renew manually from the Billing page when your period ends; nothing about your existing Projects, Communities, or Watchers is affected while a subscription is expired.",
      `Enterprise (beyond Platinum) is three fixed packages: Managed Enterprise 50 ($${MANAGED_ENTERPRISE_50.price.toFixed(2)}/mo), Bring Your Own Provider 50 ($${WATCH_ENTERPRISE_BYO_TIERS[0].price}/mo), and Bring Your Own Provider Unlimited ($${WATCH_ENTERPRISE_BYO_TIERS[1].price}/mo) — see the Innvil Watch Enterprise article for what each includes.`,
    ],
    related: ["start-the-free-trial", "innvil-credit", "crypto-payments", "community-expansion", "innvil-watch-enterprise"],
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
      `Add credit using a supported crypto gateway; it's then usable for eligible Innvil purchases, including Watch subscriptions and Community Expansion — often at a discount versus paying directly (${discountedTiers} get ${monthlyDiscountPct}% off when paying with Innvil Credit; annual billing is Innvil Credit only, at a further ${annualDiscountPct}% off 12 months of the regular price).`,
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
    ],
    related: ["watcher-not-responding", "community-capacity"],
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
  "what-is-a-watcher", "watcher-profiles-deployments-slots", "start-the-free-trial",
  "connect-your-telegram-account", "connect-a-community", "innvil-credit",
  "community-expansion", "watcher-not-responding",
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
