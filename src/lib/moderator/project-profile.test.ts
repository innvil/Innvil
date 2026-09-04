import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContactIntent, findCommunityContactOverride, isPartnershipsIntent, CONTACT_LABELS, CONTACT_KINDS } from "./project-profile";

/**
 * Web3/crypto intent-aware Partnerships/Collaboration contact routing.
 * Core product rule under test throughout: a Web3/crypto TERM by itself is
 * NOT promotional intent — routing requires the COMBINATION of a genuine
 * commercial ask/request AND a commercial topic, never vocabulary alone.
 * Pre-existing technical_support/sales/support behavior is also covered
 * here for the first time (no dedicated test file existed for this module
 * before this pass).
 */

/* ------------------------------------------ pre-existing kinds, unchanged ---- */

test("REQUIRED: technical_support is resolved ahead of the generic support pattern", () => {
  assert.equal(resolveContactIntent("I need technical support with the API"), "technical_support");
  assert.equal(resolveContactIntent("having an integration issue"), "technical_support");
});

test("REQUIRED: sales intent is resolved", () => {
  assert.equal(resolveContactIntent("who do I talk to about enterprise pricing?"), "sales");
  assert.equal(resolveContactIntent("bulk pricing question"), "sales");
});

test("REQUIRED: plain support/help intent is the fallback", () => {
  assert.equal(resolveContactIntent("I have a problem with my order"), "support");
  assert.equal(resolveContactIntent("this is broken, please help"), "support");
});

test("no contact intent at all resolves to null, never a forced guess", () => {
  assert.equal(resolveContactIntent("just saying hi to everyone"), null);
});

/* ------------------------------------- REQUIRED test 4: plural bug fix ---- */

test("REQUIRED: 'Who handles partnerships?' resolves to partnerships (plural word-boundary bug, live gap)", () => {
  // \bpartnership\b never matched the plural "partnerships" -- there's no
  // word boundary between "partnership" and its own trailing "s".
  assert.equal(resolveContactIntent("Who handles partnerships?"), "partnerships");
  assert.equal(isPartnershipsIntent("Who handles partnerships?"), true);
});

test("the pre-existing singular form and bare standalone phrases still work unchanged", () => {
  assert.equal(resolveContactIntent("who handles partnership here"), "partnerships");
  assert.equal(resolveContactIntent("we'd love to collaborate"), "partnerships");
  assert.equal(resolveContactIntent("interested in business development"), "partnerships");
  assert.equal(resolveContactIntent("reaching out about bizdev"), "partnerships");
});

/* ------------------------- REQUIRED tests 1/2/6/8: informational, must NOT route ---- */

test("REQUIRED test 1: 'What is an IDO?' -> not a promo/partnership contact routing", () => {
  assert.equal(isPartnershipsIntent("What is an IDO?"), false);
  assert.notEqual(resolveContactIntent("What is an IDO?"), "partnerships");
});

test("REQUIRED test 2: 'Does this project have an IDO?' -> project knowledge, not contact routing", () => {
  // "this project" is a third-person subject, never "our"/"we"/"you" -- must
  // not be confused with a first-person commercial ask.
  assert.equal(isPartnershipsIntent("Does this project have an IDO?"), false);
});

test("a plain contextual statement mentioning a Web3 term is never routed", () => {
  assert.equal(isPartnershipsIntent("We have an IDO next month."), false);
});

test("REQUIRED test 6: 'What is an AMA?' -> informational, not contact routing", () => {
  assert.equal(isPartnershipsIntent("What is an AMA?"), false);
});

test("REQUIRED test 8: 'What exchange is the token listed on?' -> project knowledge, not contact routing", () => {
  // Contains "listed" (a topic word) but carries no ask/request shape at all.
  assert.equal(isPartnershipsIntent("What exchange is the token listed on?"), false);
});

test("further informational Web3 questions from the spec are never treated as commercial intent", () => {
  for (const q of [
    "How does staking work?",
    "What is the difference between an ICO and IDO?",
    "When is the TGE?",
    "What chain is this on?",
    "What is the max supply?",
  ]) {
    assert.equal(isPartnershipsIntent(q), false, `should not be commercial intent: "${q}"`);
  }
});

/* --------------------------- REQUIRED tests 3/5/7: genuine commercial asks ---- */

test("REQUIRED test 3: 'Can we promote our IDO here?' -> promo/partnership contact", () => {
  assert.equal(resolveContactIntent("Can we promote our IDO here?"), "partnerships");
});

test("'Who should I contact about promoting our token launch?' -> promo/partnership contact", () => {
  assert.equal(resolveContactIntent("Who should I contact about promoting our token launch?"), "partnerships");
});

test("'Can we partner for an AMA?' -> promo/partnership contact", () => {
  assert.equal(resolveContactIntent("Can we partner for an AMA?"), "partnerships");
});

test("REQUIRED test 5: 'Can we sponsor an AMA?' -> promo/partnership contact", () => {
  assert.equal(resolveContactIntent("Can we sponsor an AMA?"), "partnerships");
  assert.equal(resolveContactIntent("We want to sponsor an AMA."), "partnerships");
});

test("REQUIRED test 7: 'Can you list our token?' -> business/listing contact (mapped to the canonical Partnerships/Collaboration field)", () => {
  assert.equal(resolveContactIntent("Can you list our token?"), "partnerships");
  assert.equal(resolveContactIntent("Who can I speak to about listing our token?"), "partnerships");
});

test("further required commercial-ask phrasings all resolve to partnerships", () => {
  const cases = [
    "We want to run a KOL campaign with you.",
    "We'd like a media partnership.",
    "Can our project sponsor a giveaway?",
    "Can we cross-promote?",
    "Who handles BD?",
    "We'd like an integration partnership.",
  ];
  for (const c of cases) assert.equal(resolveContactIntent(c), "partnerships", `expected partnerships for: "${c}"`);
});

/* --------------------------------------- REQUIRED test 9/10: never here ---- */
// Unsolicited-promotion/scam messages are never this module's concern at
// all -- they're gated out of the ANSWER/knowledge-retrieval path entirely
// by runLinkModeration BEFORE loadRelevantKnowledge (and therefore
// resolveContactIntent) is ever reached, so there is nothing for this pure
// function to get wrong here. Included anyway as a documentation-level
// guard: even if such text somehow reached this function directly, a bare
// promotional link/pitch with no genuine commercial-ask-to-THIS-project
// framing does not itself resolve to partnerships.
test("a raw promotional pitch string, evaluated in isolation, does not itself trigger partnerships routing (moderation is the real gate for this content, not this function)", () => {
  assert.equal(isPartnershipsIntent("Join our presale now: https://example.com/presale"), false);
  assert.equal(isPartnershipsIntent("Best token 100x guaranteed, join Telegram https://t.me/x"), false);
  assert.equal(isPartnershipsIntent("Send 1 ETH to this wallet for guaranteed 10x returns"), false);
});

/* --------------------------------------- REQUIRED test 14: slang alone ---- */

test("REQUIRED test 14: Web3 slang (KOL/shill/raid/airdrop) does not trigger routing without commercial intent", () => {
  assert.equal(isPartnershipsIntent("he's a well known KOL in this space"), false);
  assert.equal(isPartnershipsIntent("gm frens, that shill was wild lol"), false);
  assert.equal(isPartnershipsIntent("that was a nice raid ngl"), false);
  assert.equal(isPartnershipsIntent("check out this airdrop"), false);
});

test("the SAME topic words DO combine with a genuine commercial ask", () => {
  assert.equal(isPartnershipsIntent("can we do a KOL raid campaign together?"), true);
  assert.equal(isPartnershipsIntent("who handles our airdrop campaign partnership?"), true);
});

/* ---------------------------------------------------- findCommunityContactOverride ---- */

test("REQUIRED test 11 (used exactly, never hallucinated): a community override is found by title/content matching the resolved kind", () => {
  const kind = resolveContactIntent("who handles partnerships?");
  assert.equal(kind, "partnerships");
  const value = findCommunityContactOverride(kind!, [{ title: "Partnerships", content: "@regional_bd" }]);
  assert.equal(value, "@regional_bd");
});

test("findCommunityContactOverride returns null when no community entry matches -- never fabricated", () => {
  const value = findCommunityContactOverride("partnerships", [{ title: "General FAQ", content: "unrelated content" }]);
  assert.equal(value, null);
});

test("findCommunityContactOverride still resolves correctly for every OTHER contact kind (unaffected by the partnerships refactor)", () => {
  for (const kind of CONTACT_KINDS) {
    // Every kind must at least be checkable without throwing, and the
    // structural contract (no matching entries -> null) must hold uniformly.
    assert.equal(findCommunityContactOverride(kind, []), null);
  }
});

test("CONTACT_LABELS still identifies partnerships as 'Partnerships / Collaboration' -- the canonical field this whole feature routes onto, no new contact kind was invented", () => {
  assert.equal(CONTACT_LABELS.partnerships, "Partnerships / Collaboration");
  assert.deepEqual(CONTACT_KINDS, ["support", "partnerships", "sales", "technical_support"]);
});
