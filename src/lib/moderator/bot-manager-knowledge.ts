import "server-only";

import { scoreKnowledgeRelevance, type KnowledgeSource } from "./knowledge";

/**
 * Static, hand-authored Innvil product knowledge for innvil_bot_manager's
 * reactive support mode (innvil-bot-manager-spec.md — "2. Reactive support
 * assistant"). Deliberately NOT the tenant/panel Project Knowledge system
 * (knowledge.ts) — that's per-panel/per-community customer data; this is
 * Innvil's OWN product facts, the same for every conversation this bot has,
 * on every panel and platform. Reuses the SAME keyword-overlap scorer
 * (scoreKnowledgeRelevance) rather than a second retrieval implementation —
 * the "source" shape is intentionally identical (KnowledgeSource) even
 * though this array is static in code, not a DB table.
 *
 * Keep this in sync with real product facts by hand — nothing here is
 * pulled live from money.ts/plan.ts, so a pricing change elsewhere in the
 * codebase does NOT automatically update what this bot says. Treat this
 * file as a review item whenever pricing/plans/features change.
 */
export const INNVIL_PRODUCT_KNOWLEDGE: KnowledgeSource[] = [
  {
    id: "innvil-what-is-it",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "overview",
    title: "What is Innvil",
    content:
      "Innvil is a multi-product platform with TWO real products today, both reachable from one Innvil account: Innvil Forge (innvil.cloud) — a no-code, white-label SMM (social media marketing) panel builder, where anyone can create their own independent SMM panel with its own subdomain, storefront, customer dashboard, and wallet, bringing their own SMM provider; and Innvil Watch (watch.innvil.cloud) — a standalone AI-powered Telegram community moderator product, unrelated to running an SMM panel. A person can sign up once and use either or both.",
    active: true,
  },
  {
    id: "innvil-forge-pricing-model",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Forge pricing / commission model",
    content:
      "Innvil Forge (the SMM panel builder) charges a 5% commission ONLY on completed customer orders — there is no monthly rent and no setup fee to create a panel. The commission rate can drop as low as 1% for high-volume panels (volume discount brackets), with a $100/panel/day cap on what Innvil ever takes. This pricing model is specific to Forge — Innvil Watch (the separate Telegram AI moderator product) is NOT priced this way, it has its own fixed monthly plans (see 'Innvil Watch pricing').",
    active: true,
  },
  {
    id: "innvil-getting-started",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "faq",
    title: "How do I create a panel / get started with Forge",
    content:
      "Sign up at innvil.cloud, create a panel (choose a subdomain), then connect your own SMM provider's API in the panel's Providers tab and import services. A panel starts in Draft status (not visible to customers) and can be set to Live once it's ready. Going Live requires the panel to have a positive Innvil balance — funding a panel is how the owner 'activates' it.",
    active: true,
  },
  {
    id: "innvil-domains",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Custom domains (Forge panels)",
    content:
      "Every Forge panel gets a free subdomain (yourname.innvil.cloud) by default. Owners can also connect their own custom domain from the panel's Domain tab. Disconnecting a custom domain automatically falls back to the included subdomain — there's no lock-in.",
    active: true,
  },
  {
    id: "innvil-watch-overview",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "overview",
    title: "What is Innvil Watch",
    content:
      "Innvil Watch (watch.innvil.cloud) is a standalone product, separate from the Forge SMM panel builder — it does not require owning or creating an SMM panel. A Watch customer creates one or more 'Watchers' (AI-powered Telegram bot identities) and deploys them into their own Telegram Communities, where they chat naturally with members, answer questions, and moderate the community (spam/scam link detection, unsafe photo and video content). Each active Watcher-to-Community connection uses one 'Watcher slot', and a plan's slot count is separate from how many Communities it includes.",
    active: true,
  },
  {
    id: "innvil-watch-pricing",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch pricing",
    content:
      "Innvil Watch has four fixed self-serve monthly plans: Bronze $29.99/mo (2 Watcher slots, 1 Community), Silver $59.99/mo (5 Watcher slots, 2 Communities), Gold $99.99/mo (10 Watcher slots, 3 Communities included, expandable to 5), and Platinum $199.00/mo (20 Watcher slots, 5 Communities included, expandable to 10). Enterprise is separate and manually provisioned (contact/inquiry-based, not self-serve checkout): Managed Enterprise 50 is $399/mo for 50 Watcher slots; Bring-Your-Own (BYO) Enterprise 50 is $299/mo (up to 50 licensed Watcher deployments, customer supplies their own AI provider credential); BYO Enterprise Unlimited is $499/mo (unlimited licensed Watcher deployments). This pricing model is completely separate from Innvil Forge's 5% order commission — Watch does not charge a commission on anything.",
    active: true,
  },
  {
    id: "innvil-watch-free-trial",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "faq",
    title: "Innvil Watch Free Trial",
    content:
      "Innvil Watch offers a one-time, 7-day Free Trial: 1 Watcher slot, 1 Community, no payment required. Starting it requires connecting and verifying a real Telegram account first (a genuine anti-abuse identity check, not optional). Each verified Telegram identity may only claim the trial once, even across different Innvil accounts. After the trial ends, existing Projects/Communities/Watchers are preserved (nothing is deleted) but stop being active until a paid plan is chosen.",
    active: true,
  },
  {
    id: "innvil-watch-getting-started",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "faq",
    title: "How do I get started with Innvil Watch",
    content:
      "Go to watch.innvil.cloud and sign up (or sign in with an existing Innvil account — one account works for both Forge and Watch). Connect and verify a Telegram account, then either start the 7-day Free Trial or choose a paid plan. From there, create a Project, create a Watcher (give it a name/persona), connect it to a real Telegram group/supergroup/channel you have admin rights in, and deploy it — that deployment is what actually starts the Watcher chatting and moderating in that Community.",
    active: true,
  },
  {
    id: "innvil-watch-community-expansion",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch Community Expansion add-on",
    content:
      "Community Expansion is a paid add-on available only on Gold and Platinum. Gold's 3 included Communities can expand to 5 total for +$9.99/mo. Platinum's 5 included Communities can expand to 10 total for +$14.99/mo. It's a fixed capacity package (buy the expansion, get the higher total), not a per-Community price. Bronze and Silver are hard-capped and cannot expand.",
    active: true,
  },
  {
    id: "innvil-watch-media-moderation-addon",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch Media Moderation + add-on",
    content:
      "Media Moderation + is a paid add-on, available on any self-serve tier, that adds real photo/video safety classification (explicit-content/unsafe-media detection) with a monthly unit allowance: Bronze +$9.99/mo for 1,000 units, Silver +$14.99/mo for 2,000, Gold +$19.99/mo for 3,000, Platinum +$24.99/mo for 4,000. One classified photo, or one sampled video frame, is one unit.",
    active: true,
  },
  {
    id: "innvil-watch-annual-billing-credit",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch annual billing and Innvil Credit",
    content:
      "A Watch subscription can be paid annually for a discount: 5% off when paid directly with crypto, or 10% off when paid with Innvil Credit. Innvil Credit is a prepaid, non-refundable, non-transferable service credit — 1 Innvil Credit always equals $1.00 USD — that also gives a 5% discount on eligible monthly plans (Silver/Gold/Platinum; Bronze gets 0% on the monthly discount but still gets the full 10% annual discount).",
    active: true,
  },
  {
    id: "innvil-watch-presence-scheduling",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch Presence Scheduling",
    content:
      "Presence Scheduling (available on Silver, Gold, Platinum, and Enterprise — not Bronze) lets multiple Watchers deployed in the same Community auto-stagger being 'conversationally present' on a schedule, each sending a real, persona-voiced arrival/departure message, so they don't all go active or silent at the same time. Core moderation (spam/scam/unsafe media detection) keeps running regardless of a Watcher's presence state.",
    active: true,
  },
  {
    id: "innvil-watch-project-knowledge",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil Watch Project Knowledge",
    content:
      "A Project owner can give their Watchers real, grounded knowledge of the project: typed facts, or a website/documentation URL. When a URL is submitted, Innvil actually fetches, extracts, and indexes the real page content (and, for a small bounded number of same-site linked pages, not just the one submitted page) so a Watcher can answer questions from real content instead of guessing. Without matching knowledge for a question, a Watcher is instructed to say it doesn't know rather than invent an answer.",
    active: true,
  },
  {
    id: "innvil-support-contact",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "faq",
    title: "How do I contact Innvil support",
    content:
      "A Forge panel owner can reach Innvil support from their dashboard sidebar ('Contact support'). A Watch customer can do the same from watch.innvil.cloud's Support section. This chat is a general product-question assistant, not a substitute for those support channels — for account-specific issues (billing disputes, a stuck payment, access problems), the real dashboard's Contact support form is the right place, since it reaches a human and can look at account-specific data this bot cannot see.",
    active: true,
  },
  {
    id: "innvil-privacy-boundary",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Customer privacy boundary (Forge)",
    content:
      "On Innvil Forge, panel owners cannot log into their customers' accounts and cannot reset a customer's password. Owners can only adjust a customer's wallet balance (credit/debit) for support/moderation purposes. This is a structural product guarantee, not a configurable setting.",
    active: true,
  },
];

/** Retrieves the most relevant product-knowledge entries for a question,
 *  reusing the SAME scorer as tenant Project Knowledge (knowledge.ts) —
 *  returns an empty array when nothing scores above 0, so the caller can
 *  correctly decline ("I don't have confirmed information about that yet")
 *  instead of ever answering ungrounded. */
export function retrieveProductKnowledge(query: string, limit = 4): KnowledgeSource[] {
  return INNVIL_PRODUCT_KNOWLEDGE
    .map((s, i) => ({ s, i, score: scoreKnowledgeRelevance(query, s) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.s);
}
