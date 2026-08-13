/* =========================================================
   Project Profile — structured project identity + contact presets
   (Phase 4.N simplification: Organization/Project/Community Knowledge were
   too fragmented as three equally-prominent customer-facing systems. The
   correct mental model is ONE Project Profile a community inherits, with
   optional small community-specific context — see CLAUDE.md's Phase 4.N
   entry for the corrected invariant.

   Pure module: types + the contact-intent classifier only, no I/O. DB-facing
   CRUD lives in src/lib/actions/knowledge.ts; retrieval wiring lives in
   community-runtime.ts / autopost-runtime.ts.

   Contacts are STRUCTURED PRESETS, not ordinary free-form knowledge rows —
   "who do I contact for support?" must not depend on keyword retrieval
   accidentally finding a Fact entry titled "Support". resolveContactIntent
   is a small, bounded classifier (same scale as chatter-coordinator.ts's
   existing isLikelyQuestion/hasProblemWord helpers, not a "giant keyword
   engine") that lets the caller look up the configured preset directly and
   treat it as authoritative — ahead of, not competing with, relevance-scored
   knowledge. */

export type ContactKind = "support" | "partnerships" | "sales" | "technical_support";

export const CONTACT_KINDS: ContactKind[] = ["support", "partnerships", "sales", "technical_support"];

export const CONTACT_LABELS: Record<ContactKind, string> = {
  support: "Support",
  partnerships: "Partnerships / Collaboration",
  sales: "Sales / Enterprise",
  technical_support: "Technical Support",
};

export type ProjectContacts = Partial<Record<ContactKind, string>>;

export interface ProjectProfile {
  id: string;
  panelId: string;
  name: string;
  description: string;
  website: string;
  docsUrl: string;
  overview: string;
  contacts: ProjectContacts;
}

/** Checked most-specific-first: "technical support" would also match the
 *  generic support pattern, so technical/partnerships/sales are resolved
 *  before falling back to plain support. */
const CONTACT_INTENT_PATTERNS: Array<[ContactKind, RegExp]> = [
  ["technical_support", /\b(technical support|integration issue|api help|developer support|dev support|sdk help)\b/i],
  ["partnerships", /\b(collab(oration)?|partnership|partner up|business development|bizdev|work together|integrate with you|integration partner)\b/i],
  ["sales", /\b(sales|enterprise (plan|pricing|inquiry)|pricing discussion|commercial (inquiry|license)|business inquiry|bulk (pricing|order))\b/i],
  ["support", /\b(support|help|assistance|assist me|problem|issue|trouble|broken|not working|contact support)\b/i],
];

/** Classifies which structured contact preset (if any) a message's intent
 *  maps to. Returns null when nothing clearly matches — never a forced
 *  guess. */
export function resolveContactIntent(text: string): ContactKind | null {
  for (const [kind, re] of CONTACT_INTENT_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

/** Community-specific override lookup: a community may configure its own
 *  local value for a contact category (spec example: Innvil's global
 *  partnerships contact vs. a community's own regional one) by titling a
 *  community-context entry with the matching category keyword — reuses the
 *  SAME community-scope knowledge rows already built for community-specific
 *  context, rather than a second parallel per-community contacts column.
 *  Returns the first matching entry's content, or null if the community has
 *  no override for this category. */
export function findCommunityContactOverride(kind: ContactKind, communityEntries: Array<{ title: string; content: string }>): string | null {
  const pattern = CONTACT_INTENT_PATTERNS.find(([k]) => k === kind)?.[1];
  if (!pattern) return null;
  const hit = communityEntries.find((e) => pattern.test(e.title) || pattern.test(e.content));
  return hit ? hit.content : null;
}
