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
      "Innvil is a no-code white-label SMM (social media marketing) panel builder. Anyone can create their own independent SMM panel with its own subdomain, storefront, customer dashboard, and wallet — without writing code. The panel owner brings their own SMM provider (bring-your-own-provider); Innvil never resells services directly.",
    active: true,
  },
  {
    id: "innvil-pricing-model",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Innvil pricing / commission model",
    content:
      "Innvil charges a 5% commission ONLY on completed customer orders — there is no monthly rent and no setup fee to create a panel. The commission rate can drop as low as 1% for high-volume panels (volume discount brackets), with a $100/panel/day cap on what Innvil ever takes. Optional paid add-ons exist on top of the free base panel (e.g. AI Virtual Moderator, Campaign Automation, Design Shop templates) — those are separate, clearly priced features, never bundled silently into the base 5%.",
    active: true,
  },
  {
    id: "innvil-getting-started",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "faq",
    title: "How do I create a panel / get started",
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
    title: "Custom domains",
    content:
      "Every panel gets a free subdomain (yourname.innvil.cloud) by default. Owners can also connect their own custom domain from the panel's Domain tab. Disconnecting a custom domain automatically falls back to the included subdomain — there's no lock-in.",
    active: true,
  },
  {
    id: "innvil-virtual-moderator",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "overview",
    title: "AI Virtual Moderator add-on",
    content:
      "The Virtual Moderator is Innvil's Telegram AI community moderator add-on. A panel owner (or, on some plans, a panel's own customer) can deploy an AI-powered Telegram bot into their community that answers questions, chats naturally, moderates spam/scam links and unsafe media, and can auto-post scheduled content. A 7-day free trial is available for eligible accounts; paid tiers scale by how many communities and simultaneously active moderator deployments are included.",
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
      "A panel owner can reach Innvil support from their dashboard sidebar ('Contact support'). This chat is a general product-question assistant, not a substitute for that support channel — for account-specific issues (billing disputes, a stuck payment, access problems), the owner dashboard's Contact support form is the right place, since it reaches a human and can look at account-specific data this bot cannot see.",
    active: true,
  },
  {
    id: "innvil-privacy-boundary",
    panelId: "innvil",
    scopeType: "ORGANIZATION",
    projectId: null,
    communityId: null,
    kind: "fact",
    title: "Customer privacy boundary",
    content:
      "Panel owners cannot log into their customers' accounts and cannot reset a customer's password. Owners can only adjust a customer's wallet balance (credit/debit) for support/moderation purposes. This is a structural product guarantee, not a configurable setting.",
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
