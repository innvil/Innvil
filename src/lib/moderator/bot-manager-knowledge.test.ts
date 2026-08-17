import { test } from "node:test";
import assert from "node:assert/strict";
import { INNVIL_PRODUCT_KNOWLEDGE, retrieveProductKnowledge } from "./bot-manager-knowledge";

test("retrieveProductKnowledge finds the pricing entry for a pricing question", () => {
  const results = retrieveProductKnowledge("how much does innvil cost, what's the commission?");
  assert.ok(results.some((r) => r.id === "innvil-pricing-model"));
});

test("retrieveProductKnowledge finds the getting-started entry for a setup question", () => {
  const results = retrieveProductKnowledge("how do I create my first panel and go live?");
  assert.ok(results.some((r) => r.id === "innvil-getting-started"));
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
