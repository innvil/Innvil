/* =========================================================
   Knowledge — shared source of truth for the Panel -> Project -> Community
   hierarchy (Phase 4.N, docs/moderator/project-knowledge-autoposting-spec.md
   §1-§5, corrected per the follow-up "Panel -> Project -> Community"
   architecture revision). Powers Virtual Moderator Q&A grounding and AI
   Auto-Posting content generation.

   Pure module: types + retrieval scoring only, no I/O. The DB-facing CRUD
   lives in src/lib/actions/knowledge.ts.

   THREE knowledge scopes, in strict retrieval precedence order:
     COMMUNITY    -- belongs to ONE community (communityId set). Narrow
                     override/addition layer, e.g. "AMA every Friday".
     PROJECT      -- belongs to ONE project (projectId set). The bulk of a
                     project's facts (support contact, chains, docs, ...).
                     NEVER retrieved for a different project's community,
                     even under the same panel.
     ORGANIZATION -- panel-wide, shared across every project the panel owns
                     (projectId AND communityId both null). Truly global
                     facts only (company info, legal, shared policy).

   A community belongs to exactly one project (communities.project_id); a
   panel may own many projects, each with one or more communities. This
   replaces the earlier (incorrect) model where "PROJECT" scope was
   accidentally panel-wide — see CLAUDE.md's Phase 4.N entry for the
   corrected invariant and the migration (0057) that reclassified the old
   panel-wide rows to ORGANIZATION rather than guessing which project they
   belonged to.

   Retrieval (§5 "retrieval, not full-document prompt stuffing"): this
   codebase has no existing vector/embedding infrastructure (checked before
   implementing — no pgvector, no embedding client, no RAG library). Building
   one from scratch is out of scope for "the smallest safe, extensible
   patch". v1 retrieval is a bounded, deterministic keyword-overlap scorer
   instead — every question relevance-ranks the tenant's OWN knowledge rows
   (never sends the whole KB blindly, and returns nothing when nothing
   actually matches, rather than forcing irrelevant context into the
   prompt). Swappable for real embeddings later without changing the calling
   contract (retrieveRelevantKnowledge's signature doesn't depend on how
   scoring works internally). Isolation between projects/communities is
   enforced by the CALLER's DB query filters (community-runtime.ts), never
   by this function or by prompting alone — this module never receives rows
   outside the scope it was asked to score. */

export type KnowledgeSourceKind = "overview" | "faq" | "fact" | "link" | "note";
export type KnowledgeScopeType = "ORGANIZATION" | "PROJECT" | "COMMUNITY";

export interface KnowledgeSource {
  id: string;
  panelId: string;
  scopeType: KnowledgeScopeType;
  projectId: string | null;
  communityId: string | null;
  kind: KnowledgeSourceKind;
  title: string;
  content: string;
  active: boolean;
}

export const KNOWLEDGE_KINDS: KnowledgeSourceKind[] = ["overview", "faq", "fact", "link", "note"];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2); // drop stopword-length noise (a, is, to, ...)
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "what", "who", "how", "does", "did",
  "you", "your", "our", "can", "has", "have", "with", "this", "that", "about",
]);

function meaningfulTokens(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => !STOPWORDS.has(t)));
}

/** Overlap-based relevance score between a query and one knowledge source —
 *  matches on both title and content, title matches weighted higher (a
 *  direct topic-name hit is a stronger signal than an incidental word
 *  appearing in a long body). 0 = no relevant overlap at all. */
export function scoreKnowledgeRelevance(query: string, source: Pick<KnowledgeSource, "title" | "content">): number {
  const queryTokens = meaningfulTokens(query);
  if (queryTokens.size === 0) return 0;
  const titleTokens = meaningfulTokens(source.title);
  const contentTokens = meaningfulTokens(source.content);
  let score = 0;
  for (const t of queryTokens) {
    if (titleTokens.has(t)) score += 2;
    if (contentTokens.has(t)) score += 1;
  }
  return score;
}

/** Retrieves the top-N (default 4) ACTIVE knowledge sources relevant to a
 *  query, highest score first. Returns an EMPTY array when nothing scores
 *  above 0 — "insufficient source material" (spec §33) is a valid outcome;
 *  the caller must never fall back to sending the whole tenant KB when
 *  retrieval comes up empty. Ties broken by insertion order (stable sort)
 *  so results are deterministic given the same input list. */
export function retrieveRelevantKnowledge(query: string, sources: KnowledgeSource[], limit = 4): KnowledgeSource[] {
  return sources
    .filter((s) => s.active)
    .map((s, i) => ({ s, i, score: scoreKnowledgeRelevance(query, s) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.s);
}

/** Merges the three independently-retrieved scope results into one
 *  precedence-ordered list: COMMUNITY > PROJECT > ORGANIZATION. Ordering IS
 *  the precedence signal: "a more specific fact should override a more
 *  generic one when they conflict" is satisfied by listing the more
 *  specific facts first in the prompt (see chatter-generate.ts's
 *  projectKnowledgeContextLines, which states this explicitly) rather than
 *  attempting semantic conflict detection, which this v1 keyword-overlap
 *  retrieval has no basis to do reliably. Callers must pass
 *  ALREADY-SCOPED-AND-ISOLATED results (communityResults already filtered
 *  to ONE community, projectResults to ONE project, organizationResults to
 *  the panel) — this function performs no isolation itself, it only orders
 *  and caps. `organizationResults` defaults to empty so existing two-scope
 *  callers/tests don't need updating for a scope they don't use. */
export function combineKnowledgeRetrieval(communityResults: KnowledgeSource[], projectResults: KnowledgeSource[], organizationResults: KnowledgeSource[] = [], limit = 4): KnowledgeSource[] {
  return [...communityResults, ...projectResults, ...organizationResults].slice(0, limit);
}
