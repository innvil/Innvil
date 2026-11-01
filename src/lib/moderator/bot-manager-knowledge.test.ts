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

test("REQUIRED (2026-09-02): the Free Trial entry states it includes a REAL, capped Media Moderation allowance -- never 'not included'", () => {
  const entry = INNVIL_PRODUCT_KNOWLEDGE.find((r) => r.id === "innvil-watch-free-trial")!;
  assert.match(entry.content, /30 units/);
  assert.doesNotMatch(entry.content, /does not include media moderation/i);
  assert.doesNotMatch(entry.content, /media moderation.*not (available|included)/i);
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

/* ------------------------- REQUIRED: newer Watch feature coverage (v1.47.66-follow-up) ---- */
// Same coverage gap as the AI blog writer's PRODUCT_FACTS -- core pricing was
// accurate but several real, shipped features were never mentioned at all.

test("REQUIRED: retrieveProductKnowledge finds Community Expansion for a Gold/Platinum capacity question", () => {
  const results = retrieveProductKnowledge("can I expand community capacity on the gold plan?");
  const hit = results.find((r) => r.id === "innvil-watch-community-expansion");
  assert.ok(hit, "must retrieve the Community Expansion entry");
  assert.match(hit!.content, /\$9\.99/);
  assert.match(hit!.content, /\$14\.99/);
});

test("REQUIRED: retrieveProductKnowledge finds Media Moderation for a photo/video safety question", () => {
  const results = retrieveProductKnowledge("does watch moderate unsafe photo and video content?");
  assert.ok(results.some((r) => r.id === "innvil-watch-media-moderation-addon"));
});

test("REQUIRED (2026-09-02): Media Moderation is stated as INCLUDED on every plan, never as a paid add-on requiring a separate purchase", () => {
  const entry = INNVIL_PRODUCT_KNOWLEDGE.find((r) => r.id === "innvil-watch-media-moderation-addon")!;
  assert.match(entry.content, /INCLUDED automatically on every plan/i);
  assert.doesNotMatch(entry.content, /is a paid add-on/i);
  assert.match(entry.content, /Bronze 300/);
  assert.match(entry.content, /Platinum 1,000/);
  assert.match(entry.content, /capped at 30 units/);
});

test("REQUIRED: retrieveProductKnowledge finds annual billing / Innvil Credit for a discount question", () => {
  const results = retrieveProductKnowledge("is there a discount for annual billing with innvil credit?");
  const hit = results.find((r) => r.id === "innvil-watch-annual-billing-credit");
  assert.ok(hit, "must retrieve the annual billing / Innvil Credit entry");
  assert.match(hit!.content, /5%/);
  assert.match(hit!.content, /10%/);
});

test("REQUIRED: retrieveProductKnowledge finds Presence Scheduling for a Watcher-rotation question", () => {
  const results = retrieveProductKnowledge("can multiple watchers rotate their presence in a community?");
  assert.ok(results.some((r) => r.id === "innvil-watch-presence-scheduling"));
});

test("REQUIRED: retrieveProductKnowledge finds Project Knowledge for a website-grounding question", () => {
  const results = retrieveProductKnowledge("can a watcher learn from our project website?");
  assert.ok(results.some((r) => r.id === "innvil-watch-project-knowledge"));
});

test("REQUIRED: no entry claims AI Telegram Auto-Posting is a live customer feature", () => {
  for (const entry of INNVIL_PRODUCT_KNOWLEDGE) {
    assert.doesNotMatch(entry.content, /auto-posting/i);
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
