import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreKnowledgeRelevance, retrieveRelevantKnowledge, type KnowledgeSource } from "./knowledge";

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: "src-1", panelId: "panel-1", scopeType: "PROJECT", communityId: null,
    kind: "fact", title: "", content: "", active: true,
    ...overrides,
  };
}

/* ================================================= REQUIRED TESTS -- KNOWLEDGE ==== */
// spec §37 (docs/moderator/project-knowledge-autoposting-spec.md)

test("REQUIRED (spec test 1): project overview contains supported chains -- 'what chains do you support?' retrieves the relevant entry", () => {
  const sources = [
    source({ id: "chains", kind: "overview", title: "Supported chains", content: "We support Ethereum, Polygon, and Arbitrum." }),
    source({ id: "unrelated", kind: "faq", title: "Refund policy", content: "Refunds are handled within 3 business days." }),
  ];
  const results = retrieveRelevantKnowledge("what chains do you support?", sources);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "chains");
});

test("REQUIRED (spec test 2): a question not covered by any knowledge retrieves nothing -- moderator must not fabricate", () => {
  const sources = [source({ id: "chains", title: "Supported chains", content: "We support Ethereum and Polygon." })];
  const results = retrieveRelevantKnowledge("what's the current token price?", sources);
  assert.deepEqual(results, []);
});

test("REQUIRED (spec test 4): tenant A and tenant B knowledge -- retrieval never crosses panels (caller's own query scoping, proven at the data-shape level)", () => {
  // retrieveRelevantKnowledge operates on whatever list it's given -- the
  // actual cross-tenant safety is the caller's `.eq("panel_id", panelId)`
  // query (community-runtime.ts's loadRelevantProjectKnowledge). This proves
  // the pure function itself never reaches outside the provided list.
  const tenantASources = [source({ id: "a1", panelId: "panel-a", title: "Alpha", content: "Alpha project details." })];
  const results = retrieveRelevantKnowledge("alpha project", tenantASources);
  assert.equal(results.length, 1);
  assert.equal(results[0].panelId, "panel-a");
});

test("inactive sources are never retrieved even if they'd otherwise score highest", () => {
  const sources = [
    source({ id: "stale", title: "Old roadmap", content: "roadmap details here", active: false }),
    source({ id: "current", title: "Roadmap", content: "roadmap details here too", active: true }),
  ];
  const results = retrieveRelevantKnowledge("roadmap details", sources);
  assert.deepEqual(results.map((r) => r.id), ["current"]);
});

test("title matches score higher than content-only matches, so a direct topic hit ranks first", () => {
  const sources = [
    source({ id: "content-only", title: "General FAQ", content: "This mentions staking somewhere in the middle of a longer answer." }),
    source({ id: "title-hit", title: "Staking", content: "Details about our staking program." }),
  ];
  const results = retrieveRelevantKnowledge("staking", sources);
  assert.equal(results[0].id, "title-hit");
});

test("scoreKnowledgeRelevance returns 0 for a query with no meaningful tokens (e.g. only stopwords)", () => {
  assert.equal(scoreKnowledgeRelevance("what is the", source({ content: "some content" })), 0);
});

test("retrieval respects the limit parameter and returns highest-scoring first", () => {
  const sources = [
    source({ id: "one", title: "roadmap", content: "roadmap roadmap" }),
    source({ id: "two", title: "roadmap", content: "roadmap" }),
    source({ id: "three", title: "other", content: "roadmap mentioned once" }),
  ];
  const results = retrieveRelevantKnowledge("roadmap", sources, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "one"); // highest score (title + content double mention)
});

test("empty knowledge list retrieves nothing, never throws", () => {
  assert.deepEqual(retrieveRelevantKnowledge("anything", []), []);
});

test("a source with no title (title-less fact/note) can still be retrieved via content match", () => {
  const sources = [source({ id: "note-1", title: "", content: "Our support hours are 9am-5pm UTC." })];
  const results = retrieveRelevantKnowledge("support hours", sources);
  assert.equal(results.length, 1);
});
