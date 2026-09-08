/* =========================================================
   Community message knowledge — pure logic. A second, message-DERIVED
   knowledge source (distinct from moderator/knowledge.ts's owner-authored
   Project/Community Knowledge): facts and links extracted from a
   community's own admin/mod-authored Telegram messages (pinned posts,
   announcements, official links) so a deferred Watcher reply can answer
   using what the community itself already established, instead of a
   generic response.

   Reuses moderator/knowledge.ts's exact "bounded, deterministic keyword-
   overlap retrieval, never a full-history prompt-stuff, empty result is a
   valid outcome" philosophy — this is NOT a second scoring model invented
   from scratch, just applied to a different source (real chat messages
   instead of owner-typed rows).

   IMPORTANT ordering invariant (enforced by the CALLER, community-runtime.ts
   — this file has no I/O and cannot enforce it itself): this retrieval must
   only ever run AFTER the Watcher has already been cleared to respond
   (moderation passed, no admin/mod actively handling the conversation, the
   120-second fallback window elapsed with nothing resolving it). Finding a
   pinned post or a whitepaper link here NEVER grants early/extra permission
   to respond — it only affects the QUALITY of an already-approved reply. */

export type CommunityResourceKind =
  | "WEBSITE" | "WHITEPAPER" | "DOCUMENTATION" | "ROADMAP" | "FAQ" | "ANNOUNCEMENT"
  | "PRESALE" | "TRADING" | "CHART" | "LISTING" | "TOKEN_INFORMATION" | "SOCIAL" | "PARTNERSHIP_CONTACT" | "PROJECT_STATUS" | "OTHER";

export const COMMUNITY_RESOURCE_KINDS: CommunityResourceKind[] = [
  "WEBSITE", "WHITEPAPER", "DOCUMENTATION", "ROADMAP", "FAQ", "ANNOUNCEMENT",
  "PRESALE", "TRADING", "CHART", "LISTING", "TOKEN_INFORMATION", "SOCIAL", "PARTNERSHIP_CONTACT", "PROJECT_STATUS", "OTHER",
];

export interface CommunityKnowledgeItem {
  id: string;
  messageThreadId: number | null;
  platformMessageId: string;
  isAdminAuthor: boolean;
  isPinned: boolean;
  isAnnouncementTopic: boolean;
  kind: CommunityResourceKind;
  /** Null for a pure text fact extracted from a message with no link. */
  url: string | null;
  /** The message text itself — used both for keyword relevance and, when
   *  url is null, as the actual answerable fact. */
  text: string;
  createdAt: string; // ISO
  sourceUrl?: string | null;
}

/* --------------------------------------------------------- classification ---- */
// Classification is driven primarily by the SURROUNDING message text, never
// only the URL path (spec: "https://docs.example.com/abc123" with no
// "whitepaper" in the path must still classify as WHITEPAPER when the
// admin's own message says "here is our whitepaper"). URL-path keywords are
// a secondary signal only, checked when the surrounding text is silent.

const KIND_TEXT_SIGNALS: Array<{ kind: CommunityResourceKind; re: RegExp }> = [
  { kind: "WHITEPAPER", re: /\bwhite\s?paper\b/i },
  { kind: "ROADMAP", re: /\broadmap\b/i },
  { kind: "FAQ", re: /\bfaq\b|\bfrequently asked\b/i },
  { kind: "PRESALE", re: /\bpresale\b|\bpre-sale\b/i },
  { kind: "TOKEN_INFORMATION", re: /\btoken(nomics)?\b|\bcontract address\b|\bcontract:\b/i },
  { kind: "PARTNERSHIP_CONTACT", re: /\bpartnership(s)?\b.{0,20}\bcontact\b|\bcontact\b.{0,20}\bpartnership/i },
  { kind: "PROJECT_STATUS", re: /\b(current(ly)?|now in|stage|status)\b.{0,20}\b(stage|phase|status)\b/i },
  { kind: "ANNOUNCEMENT", re: /\bannouncement\b/i },
  { kind: "DOCUMENTATION", re: /\bdoc(s|umentation)?\b/i },
  { kind: "SOCIAL", re: /\b(twitter|x\.com|telegram channel|discord|instagram)\b/i },
  { kind: "WEBSITE", re: /\b(official )?website\b|\bmain site\b/i },
];

const URL_PATH_SIGNALS: Array<{ kind: CommunityResourceKind; re: RegExp }> = [
  { kind: "WHITEPAPER", re: /whitepaper|white-paper/i },
  { kind: "ROADMAP", re: /roadmap/i },
  { kind: "DOCUMENTATION", re: /\/docs?\b/i },
  { kind: "PRESALE", re: /presale/i },
  { kind: "FAQ", re: /faq/i },
  { kind: "SOCIAL", re: /twitter\.com|x\.com|t\.me|discord\.(gg|com)|instagram\.com/i },
];

/** Classifies ONE link's purpose. `surroundingText` is the message the link
 *  appeared in (or was referenced from) — checked FIRST, per spec (surrounding
 *  authoritative context defines the resource type, not the URL path alone).
 *  Falls back to the URL path only when the text gives no signal; falls back
 *  to a bare-domain WEBSITE guess only when the url has no path at all
 *  (e.g. "https://example.com") and nothing else matched — never guesses a
 *  MORE SPECIFIC kind (whitepaper/docs/roadmap) from the URL shape alone,
 *  since those must come from an explicit, confirmed signal (spec: "never
 *  invent, guess, derive, or construct a whitepaper URL" applies just as
 *  much to classifying an unrelated URL as one). */
export function classifyResourceKind(surroundingText: string, url: string): CommunityResourceKind {
  for (const { kind, re } of KIND_TEXT_SIGNALS) if (re.test(surroundingText)) return kind;
  for (const { kind, re } of URL_PATH_SIGNALS) if (re.test(url)) return kind;
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "" || parsed.pathname === "/") return "WEBSITE";
  } catch {
    /* not a real URL — fall through */
  }
  return "OTHER";
}

/* ---------------------------------------------------------------- ranking ---- */

// Mirrors knowledge.ts's own STOPWORDS discipline (a second, independent
// copy is intentional -- this module is deliberately self-contained/pure
// with no cross-import of that sibling module's internals) -- without it, a
// common word like "the" in the query would false-positive-match against
// almost any stored message purely by coincidence.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "what", "who", "how", "does", "did",
  "you", "your", "our", "can", "has", "have", "with", "this", "that", "about",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

/** Relevance score against the user's question — same lightweight keyword-
 *  overlap approach as knowledge.ts's scoreKnowledgeRelevance, applied to a
 *  message's own text rather than a title+content pair. */
export function scoreCommunityItemRelevance(query: string, item: Pick<CommunityKnowledgeItem, "text"> & Partial<Pick<CommunityKnowledgeItem, "kind">>): number {
  if (item.kind === "TRADING" && /\b(?:buy|buying|purchase|swap|trade|trading)\b/i.test(query)) return 5;
  if (item.kind === "CHART" && /\b(?:chart|price|market cap)\b/i.test(query)) return 5;
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return 0;
  const itemTokens = tokenize(item.text);
  let score = 0;
  for (const t of queryTokens) if (itemTokens.has(t)) score += 1;
  return score;
}

/** Authority weight — pinned beats announcement beats an ordinary admin
 *  message beats anything else; a non-admin author is never authoritative
 *  here at all (filtered out entirely before this runs — see
 *  rankCommunityKnowledge). Recency is the tiebreaker within equal
 *  authority, never the other way around — a newer admin update always
 *  outranks an older pinned one once relevance is comparable (spec's own
 *  "recency and conflict resolution" worked example: "Presale is now live"
 *  beats an older pinned "Presale starts next month"). */
function authorityWeight(item: CommunityKnowledgeItem): number {
  let w = 0;
  if (item.isPinned) w += 3;
  if (item.isAnnouncementTopic) w += 2;
  return w;
}

/** Retrieves the top-N most relevant, authoritative community-message
 *  resources for a question — ONLY admin/mod-authored items are ever
 *  considered authoritative here (spec: "random user messages should not
 *  override admin/mod information"; a Promotion-topic post is authoritative
 *  ONLY if it's also admin-authored, matching the same isAdminAuthor gate).
 *  Recency breaks ties within the same authority+relevance band, and — per
 *  the explicit worked example — a materially NEWER item can outrank an
 *  older, more "authoritative" (pinned) one when it's a direct, relevant
 *  update on the same subject: relevance+recency are folded into one
 *  composite score alongside authority, rather than a strict
 *  authority-always-wins lexicographic sort, so a stale pinned fact never
 *  permanently shadows a fresh admin correction. Returns an empty array
 *  when nothing scores above 0 — never falls back to dumping every stored
 *  resource. */
export function rankCommunityKnowledge(query: string, items: CommunityKnowledgeItem[], limit = 4, now: Date = new Date()): CommunityKnowledgeItem[] {
  return items
    .filter((i) => i.isAdminAuthor)
    .map((i, idx) => {
      const relevance = scoreCommunityItemRelevance(query, i);
      if (relevance === 0) return null;
      const ageHours = Math.max(0, (now.getTime() - new Date(i.createdAt).getTime()) / 3_600_000);
      // Recency contributes a small, bounded bonus (never dominates a real
      // relevance/authority difference) so a NEWER equally-relevant fact
      // edges out an older one, matching the spec's own worked example,
      // without letting a barely-relevant brand-new message outrank a
      // strongly relevant pinned one.
      const recencyBonus = Math.max(0, 2 - ageHours / 24);
      const score = relevance * 3 + authorityWeight(i) + recencyBonus;
      return { i, idx, score };
    })
    .filter((r): r is { i: CommunityKnowledgeItem; idx: number; score: number } => r !== null)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map((r) => r.i);
}

/** The single confirmed whitepaper link, if one has EVER been observed and
 *  classified as such — never derived/guessed from another URL. Prefers the
 *  most recently observed one if multiple exist (a project may have moved
 *  its docs). */
export function pickWhitepaperLink(items: CommunityKnowledgeItem[]): string | null {
  const whitepapers = items.filter((i) => i.isAdminAuthor && i.kind === "WHITEPAPER" && i.url);
  if (!whitepapers.length) return null;
  return [...whitepapers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].url;
}

/** Other confirmed official resources worth OFFERING (the caller/model still
 *  decides per-answer whether any are actually relevant) — deliberately
 *  excludes WHITEPAPER (surfaced separately via pickWhitepaperLink) and
 *  OTHER/unclassified links (too generic to confidently recommend), and
 *  keeps only the newest of each kind so the model isn't handed five stale
 *  duplicate website links. */
export function otherOfficialResources(items: CommunityKnowledgeItem[]): Array<{ kind: CommunityResourceKind; url: string }> {
  const byKind = new Map<CommunityResourceKind, CommunityKnowledgeItem>();
  for (const item of items) {
    if (!item.isAdminAuthor || !item.url || item.kind === "WHITEPAPER" || item.kind === "OTHER") continue;
    const existing = byKind.get(item.kind);
    if (!existing || new Date(item.createdAt) > new Date(existing.createdAt)) byKind.set(item.kind, item);
  }
  return [...byKind.values()].map((i) => ({ kind: i.kind, url: i.url as string }));
}

/** The most relevant PINNED item for this question, if any (spec: choose the
 *  one most relevant to the question, never reference every pinned message
 *  at once). */
/** Already-resolved grounding threaded into generation (chatter-generate.ts)
 *  -- built by the runtime retrieval layer (community-runtime.ts), never
 *  constructed by the generation layer itself, mirroring
 *  knowledge.ts's KnowledgeContextEntry convention. `null` (the caller
 *  passes `undefined`/omits it) when NOTHING relevant was found at all --
 *  the prompt then omits the whole block rather than injecting an empty
 *  one, and the model is never told anything was "missing" (spec: silence
 *  on absence, never "I couldn't find..."). */
export interface CommunityKnowledgeGrounding {
  facts: Array<{ text: string; isPinned: boolean; isAnnouncement: boolean; createdAt: string; sourceUrl?: string | null }>;
  pinnedReference: { text: string; link: string | null } | null;
  /** The ONE confirmed whitepaper URL, or null -- never a derived/guessed one. */
  whitepaperLink: string | null;
  otherResources: Array<{ kind: CommunityResourceKind; url: string }>;
}

export function pickPinnedReference(query: string, items: CommunityKnowledgeItem[]): CommunityKnowledgeItem | null {
  const pinned = items.filter((i) => i.isAdminAuthor && i.isPinned);
  if (!pinned.length) return null;
  const scored = pinned
    .map((i) => ({ i, score: scoreCommunityItemRelevance(query, i) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.i ?? null;
}

/** Composes the full grounding bundle from an already-loaded item list --
 *  pure, so the "nothing relevant at all -> return null, never an empty
 *  shell" contract is directly testable without a DB. `pinnedLink`, when
 *  given, is a real Telegram deep link to the specific pinned message
 *  (community-topics.ts's buildTopicLink, resolved by the caller since it
 *  needs the chat's username/id -- this function has no I/O); omitted
 *  (null) when no reliable link can be built, in which case the caller
 *  falls back to naming the pinned post naturally instead of linking it. */
export function buildCommunityKnowledgeGrounding(
  query: string,
  items: CommunityKnowledgeItem[],
  now: Date = new Date(),
  pinnedLink: string | null = null
): CommunityKnowledgeGrounding | null {
  const facts = rankCommunityKnowledge(query, items, 4, now);
  const pinned = pickPinnedReference(query, items);
  const whitepaperLink = pickWhitepaperLink(items);
  const otherResources = otherOfficialResources(items);
  if (!facts.length && !pinned && !whitepaperLink && !otherResources.length) return null;
  return {
    facts: facts.map((i) => ({ text: i.text, isPinned: i.isPinned, isAnnouncement: i.isAnnouncementTopic, createdAt: i.createdAt, sourceUrl: i.sourceUrl })),
    pinnedReference: pinned ? { text: pinned.text, link: pinnedLink } : null,
    whitepaperLink,
    otherResources,
  };
}
