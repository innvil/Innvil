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

const TECHNICAL_SUPPORT_RE = /\b(technical support|integration issue|api help|developer support|dev support|sdk help)\b/i;
const SALES_RE = /\b(sales|enterprise (plan|pricing|inquiry)|pricing discussion|commercial (inquiry|license)|business inquiry|bulk (pricing|order))\b/i;
const SUPPORT_RE = /\b(support|help|assistance|assist me|problem|issue|trouble|broken|not working|contact support)\b/i;

/* ================= Web3/crypto commercial-intent (Partnerships routing) ====
   A Web3/crypto term by itself is NOT promotional intent ("What is an IDO?",
   "We have an IDO next month." must never route to a contact just because a
   commercial-sounding noun appears). Commercial-intent routing instead
   requires the COMBINATION of a genuine ASK/REQUEST shape AND a commercial
   topic — vocabulary alone is never sufficient. This intentionally does NOT
   attempt to catalog Web3 terminology broadly (staking/APY/rollups/wallets/
   NFTs/DAOs/slang, etc.) — Sonnet 5 already understands common Web3 concepts
   from its own training, and NO_PROJECT_KNOWLEDGE_LINE (chatter-generate.ts)
   already permits answering a question generally/socially when it doesn't
   need project-specific facts. The only real gap this module closes is
   COMMERCIAL-INTENT ROUTING for the narrower "promo/partnership/BD/listing"
   slice of that vocabulary, where a bare term is genuinely ambiguous between
   informational and commercial use. */

/** A bounded reference set of terms that commonly carry promo/BD/listing/
 *  marketing connotations in a crypto community (this feature's own "Promo /
 *  partnership intent emphasis" list, plus the bare verb/noun forms needed
 *  to recognize a direct ask — "sponsor"/"list"/"promote"/"partner"/
 *  "cross-promote"/"bd"). Deliberately broad: a topic match alone never
 *  routes anywhere (see isPartnershipsIntent below) — it only ever combines
 *  with COMMERCIAL_ASK_RE, so a generous vocabulary here costs nothing in
 *  false positives on its own (e.g. "the list of supported chains" matching
 *  the bare word "list" is harmless, since that sentence carries no ask
 *  shape at all). */
const COMMERCIAL_TOPIC_RE =
  /\b(ico|ido|ieo|igo|ino|sto|tge|pre[\s-]?sale|token sale|launchpad|launchpool|list|listings?|exchange listing|cex listing|dex listing|market making|ama|twitter space|x space|campaigns?|sponsor(ed|ing|s|ship)?|giveaways?|airdrops?|bounty|kols?|influencers?|shill(ing)?|raids?|ambassador(s|\s+program)?|affiliate(s|\s+program)?|referral(s|\s+(program|campaign))?|cross-?promot(e|ion|ing)?|co-?marketing|banner placement|featured listing|trending campaign|volume campaign|partnerships?|partner(s|ing)?|collab(oration)?|integrations?|business development|bd|media partner(ship)?|launch partner|liquidity partnership|promot(e|ing|ion)|marketing)\b/i;

/** A genuine REQUEST/PROPOSAL grammatical shape directed at "us"/"you"/"our
 *  [noun]" or asking who to contact — distinguishes an actual commercial ASK
 *  ("can we promote our IDO here?", "who handles partnerships?") from a
 *  purely informational or conversational mention of the same topic ("what
 *  is an IDO?", "we have an IDO next month."). "Does THIS PROJECT have an
 *  IDO?" is correctly excluded too — it asks about the target project's own
 *  facts using "this project", never "our"/"we"/"you", so `do(es)?` only
 *  matches when immediately followed by a first/second-person subject or an
 *  "our <noun>" possessive, not an arbitrary third-person one. */
const COMMERCIAL_ASK_RE =
  /\b(can|could|would|do(es)?)\s+(we|you|i|our\s+\w+)\b|\bwho\s+(can|should|do(es)?)\s+i\b|\bwho\s+handles?\b|\bwho('?s|\s+is)\s+the\s+right\s+person\b|\bwe('?d|\s+would)\s+like\b|\bwe\s+want\s+to\b|\bwe'?re\s+looking\s+to\b/i;

/** Already-established, standalone-sufficient partnership/collab phrases
 *  (predate the Web3-vocabulary work above) — inherently commercial-
 *  relationship-shaped on their own, so no separate ask-structure check is
 *  required for these. Kept as-is except for two real, pre-existing word-form
 *  gaps found while adding test coverage for this module (neither is new —
 *  both existed in the original pattern too): `\bpartnership\b` never
 *  matched the PLURAL "partnerships" (no boundary between "partnership" and
 *  its own trailing "s") — "Who handles partnerships?", one of this
 *  feature's own required test cases, silently fell through; and
 *  `collab(oration)?` never matched the verb forms "collaborate"/
 *  "collaborating"/"collaborated" (only the bare noun "collab" or
 *  "collaboration"), even though "we'd love to collaborate" expresses the
 *  identical intent. */
const PARTNERSHIP_KEYWORD_RE = /\b(collab(s|orat(e|es|ed|ing)|oration)?|partnerships?|partner up|business development|bizdev|work together|integrate with you|integration partner)\b/i;

/** Commercial-intent routing = the combination of vocabulary/topic AND user
 *  intent, never vocabulary alone. Routes to the Partnerships / Collaboration
 *  contact when the message EITHER (a) uses one of the already-established
 *  standalone phrases above, OR (b) combines a genuine commercial ask with a
 *  Web3/marketing/BD topic. A bare topic mention with no ask attached (e.g.
 *  "gm frens, that shill was wild", "nice airdrop") never matches on its
 *  own — see this module's own top comment. */
export function isPartnershipsIntent(text: string): boolean {
  if (PARTNERSHIP_KEYWORD_RE.test(text)) return true;
  return COMMERCIAL_ASK_RE.test(text) && COMMERCIAL_TOPIC_RE.test(text);
}

const CONTACT_INTENT_MATCHERS: Record<ContactKind, (text: string) => boolean> = {
  technical_support: (t) => TECHNICAL_SUPPORT_RE.test(t),
  partnerships: isPartnershipsIntent,
  sales: (t) => SALES_RE.test(t),
  support: (t) => SUPPORT_RE.test(t),
};

/** Checked most-specific-first: "technical support" would also match the
 *  generic support pattern, so technical/partnerships/sales are resolved
 *  before falling back to plain support. */
const CONTACT_INTENT_ORDER: ContactKind[] = ["technical_support", "partnerships", "sales", "support"];

/** Classifies which structured contact preset (if any) a message's intent
 *  maps to. Returns null when nothing clearly matches — never a forced
 *  guess. */
export function resolveContactIntent(text: string): ContactKind | null {
  for (const kind of CONTACT_INTENT_ORDER) {
    if (CONTACT_INTENT_MATCHERS[kind](text)) return kind;
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
  const matcher = CONTACT_INTENT_MATCHERS[kind];
  const hit = communityEntries.find((e) => matcher(e.title) || matcher(e.content));
  return hit ? hit.content : null;
}
