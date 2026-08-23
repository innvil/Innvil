import { test } from "node:test";
import assert from "node:assert/strict";
import { INNVIL_PRODUCT_KNOWLEDGE, retrieveProductKnowledge } from "./bot-manager-knowledge";

test("retrieveProductKnowledge finds the Forge pricing entry for a commission question", () => {
  const results = retrieveProductKnowledge("how much does innvil cost, what's the commission?");
  assert.ok(results.some((r) => r.id === "innvil-forge-pricing-model"));
});

test("retrieveProductKnowledge finds the getting-started entry for a setup question", () => {
  const results = retrieveProductKnowledge("how do I create my first panel and go live?");
  assert.ok(results.some((r) => r.id === "innvil-getting-started"));
});

/* ---------------------------- REQUIRED: Innvil Watch coverage (2026-08-23 fix) ---- */
// The knowledge base previously had ZERO mention of Innvil Watch (still described
// it as an "AI Virtual Moderator add-on" bundled into Forge) -- these pin the real,
// current, standalone-product facts so this can't silently regress again.

test("REQUIRED: retrieveProductKnowledge finds the Watch overview for a 'what is watch' question", () => {
  const results = retrieveProductKnowledge("what is innvil watch, is it different from the panel builder?");
  assert.ok(results.some((r) => r.id === "innvil-watch-overview"));
});

test("REQUIRED: retrieveProductKnowledge finds real Watch pricing for a Watch plan-price question", () => {
  const results = retrieveProductKnowledge("how much is the bronze watch plan per month?");
  const hit = results.find((r) => r.id === "innvil-watch-pricing");
  assert.ok(hit, "must retrieve the real Watch pricing entry");
  assert.match(hit!.content, /\$29\.99/);
  assert.match(hit!.content, /\$59\.99/);
  assert.match(hit!.content, /\$99\.99/);
  assert.match(hit!.content, /\$199\.00/);
});

test("REQUIRED: retrieveProductKnowledge finds the Watch Free Trial entry for a trial question", () => {
  const results = retrieveProductKnowledge("does innvil watch have a free trial?");
  const hit = results.find((r) => r.id === "innvil-watch-free-trial");
  assert.ok(hit, "must retrieve the real trial entry");
  assert.match(hit!.content, /7-day/);
});

test("REQUIRED: Watch pricing is never conflated with Forge's 5% commission model", () => {
  const watchPricing = INNVIL_PRODUCT_KNOWLEDGE.find((r) => r.id === "innvil-watch-pricing")!;
  assert.doesNotMatch(watchPricing.content, /5% commission/);
  const forgePricing = INNVIL_PRODUCT_KNOWLEDGE.find((r) => r.id === "innvil-forge-pricing-model")!;
  assert.match(forgePricing.content, /5% commission/);
});

test("REQUIRED: no entry anywhere still describes Watch as an 'add-on' bundled into Forge -- it's a standalone product", () => {
  for (const entry of INNVIL_PRODUCT_KNOWLEDGE) {
    assert.doesNotMatch(entry.content, /virtual moderator add-on/i);
  }
});

test("retrieveProductKnowledge returns empty for a query with no overlap -- never falls back to the whole KB", () => {
  const results = retrieveProductKnowledge("xyzzy quantum banana zephyr");
  assert.deepEqual(results, []);
});

test("every product-knowledge entry is active and ORGANIZATION-scoped (this bot has no per-panel/community scoping)", () => {
  for (const entry of INNVIL_PRODUCT_KNOWLEDGE) {
    assert.equal(entry.active, true);
    assert.equal(entry.scopeType, "ORGANIZATION");
  }
});

test("retrieveProductKnowledge respects the limit parameter", () => {
  const results = retrieveProductKnowledge("innvil panel", 1);
  assert.ok(results.length <= 1);
});
