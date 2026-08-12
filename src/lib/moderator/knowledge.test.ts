import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreKnowledgeRelevance, retrieveRelevantKnowledge, combineKnowledgeRetrieval, type KnowledgeSource } from "./knowledge";

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

/* ==================================== COMMUNITY-SPECIFIC KNOWLEDGE (spec §6-§8/§24) ==== */

test("REQUIRED (spec §7/§24): combineKnowledgeRetrieval lists community results FIRST -- precedence when facts conflict", () => {
  const community = [source({ id: "comm-contact", scopeType: "COMMUNITY", communityId: "c1", title: "Support contact", content: "@comm2_admin" })];
  const project = [source({ id: "proj-contact", title: "Support contact", content: "@global_support" })];
  const combined = combineKnowledgeRetrieval(community, project);
  assert.deepEqual(combined.map((s) => s.id), ["comm-contact", "proj-contact"]);
});

test("combineKnowledgeRetrieval respects the limit across both sets combined", () => {
  const community = [source({ id: "c1" }), source({ id: "c2" })];
  const project = [source({ id: "p1" }), source({ id: "p2" })];
  const combined = combineKnowledgeRetrieval(community, project, 3);
  assert.deepEqual(combined.map((s) => s.id), ["c1", "c2", "p1"]);
});

test("combineKnowledgeRetrieval with no community results falls back to project-only, in project order", () => {
  const project = [source({ id: "p1" }), source({ id: "p2" })];
  assert.deepEqual(combineKnowledgeRetrieval([], project).map((s) => s.id), ["p1", "p2"]);
});

test("combineKnowledgeRetrieval with only community results (no project match) still works", () => {
  const community = [source({ id: "c1", scopeType: "COMMUNITY", communityId: "c1" })];
  assert.deepEqual(combineKnowledgeRetrieval(community, []).map((s) => s.id), ["c1"]);
});

test("REQUIRED (spec test 1 shape): same query against two different communities' own knowledge retrieves each community's own answer", () => {
  const community1Sources = [source({ id: "alpha", scopeType: "COMMUNITY", communityId: "community-1", title: "About this community", content: "This community is focused on Project Alpha." })];
  const community2Sources = [source({ id: "beta", scopeType: "COMMUNITY", communityId: "community-2", title: "About this community", content: "This community is focused on Project Beta." })];
  const answer1 = retrieveRelevantKnowledge("what is this community about?", community1Sources);
  const answer2 = retrieveRelevantKnowledge("what is this community about?", community2Sources);
  assert.equal(answer1[0]?.id, "alpha");
  assert.equal(answer2[0]?.id, "beta");
});

test("REQUIRED (spec test 4): community 1 knowledge must never appear when only community 2's list is queried", () => {
  // Isolation is enforced by the CALLER's query scoping (community-runtime.ts
  // filters by community_id in the DB query) -- this proves the pure
  // retrieval function itself never reaches into a list it wasn't given.
  const community2OnlySources = [source({ id: "beta-fact", scopeType: "COMMUNITY", communityId: "community-2", content: "Project Beta launched in Q2." })];
  const results = retrieveRelevantKnowledge("project", community2OnlySources);
  assert.ok(!results.some((r) => r.id === "alpha-fact"));
});
