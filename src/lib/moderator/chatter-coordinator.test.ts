import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChatterGate, type ChatterPacingState } from "./chatter-coordinator";

const freshPacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 0 };
const FAVORABLE = () => 0.01; // passes any probability gate
const UNFAVORABLE = () => 0.99; // fails any probability gate

/* ---------------------------------------------------------- hard pre-filters ---- */

test("empty message -> IGNORE (EMPTY_MESSAGE), regardless of everything else", () => {
  const result = evaluateChatterGate({ text: "   ", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "EMPTY_MESSAGE", priority: "LOW" });
});

test("single-character message -> IGNORE (TOO_SHORT)", () => {
  const result = evaluateChatterGate({ text: "k", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "TOO_SHORT", priority: "LOW" });
});

test("ambient message within the cooldown window since the bot last spoke -> hard IGNORE (COOLDOWN), even with a favorable roll", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 }; // 5s ago
  const result = evaluateChatterGate({ text: "hows it going", isDirectedAtBot: false, pacing, now, random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "COOLDOWN", priority: "LOW" });
});

test("a DIRECTED message bypasses the cooldown window entirely", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 };
  const result = evaluateChatterGate({ text: "hey are you around", isDirectedAtBot: true, pacing, now, random: FAVORABLE });
  assert.equal(result.proceed, true);
});

test("ambient message after the bot has already sent 2 messages in a row -> hard IGNORE (AVOID_DOMINATING_CONVERSATION)", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 2 };
  const result = evaluateChatterGate({ text: "just chatting away", isDirectedAtBot: false, pacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "AVOID_DOMINATING_CONVERSATION", priority: "LOW" });
});

test("a DIRECTED message bypasses the consecutive-messages cap too", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 5 };
  const result = evaluateChatterGate({ text: "still there?", isDirectedAtBot: true, pacing, now: new Date(), random: FAVORABLE });
  assert.equal(result.proceed, true);
});

/* ------------------------------------------- contextual scoring, not a coin flip ---- */

test("Spec §14: unmentioned substantive question -> HIGH priority, engages with a favorable roll (not lost to a flat 15%)", () => {
  const result = evaluateChatterGate({
    text: "Does anyone know why all withdrawals are failing?",
    isDirectedAtBot: false,
    pacing: freshPacing,
    now: new Date(),
    random: FAVORABLE,
  });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

test('Spec §14: unmentioned trivial chatter ("lol") -> hard LOW priority, deterministic SILENCE regardless of RNG', () => {
  const favorable = evaluateChatterGate({ text: "lol", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  const unfavorable = evaluateChatterGate({ text: "lol", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: UNFAVORABLE });
  assert.deepEqual(favorable, { proceed: false, reasonCode: "LOW_PRIORITY", priority: "LOW" });
  assert.deepEqual(unfavorable, { proceed: false, reasonCode: "LOW_PRIORITY", priority: "LOW" });
});

test("Spec §14: meaningful direct mention -> VERY_HIGH priority, always engages (no RNG call needed)", () => {
  const result = evaluateChatterGate({
    text: "@mika_mod_bot can you explain this?",
    isDirectedAtBot: true,
    pacing: freshPacing,
    now: new Date(),
    random: UNFAVORABLE, // even an unfavorable roll can't stop VERY_HIGH
  });
  assert.equal(result.priority, "VERY_HIGH");
  assert.equal(result.proceed, true);
});

test('Spec §13: a low-value direct mention ("@bot lol") does NOT gain an automatic ~75-85% response chance — it lands in the ambiguous middle', () => {
  const result = evaluateChatterGate({ text: "@bot lol", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.equal(result.priority, "MEDIUM");
});

test("MEDIUM priority is the only band randomness actually decides — unfavorable RNG resolves to IGNORE (PROBABILITY_GATE)", () => {
  const result = evaluateChatterGate({ text: "@bot lol", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: UNFAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "PROBABILITY_GATE", priority: "MEDIUM" });
});

test("Spec §10: a repeated trivial direct mention right after the bot itself just answered -> LOW priority (recently-answered signal), not an automatic reply", () => {
  const result = evaluateChatterGate({
    text: "@bot hi",
    isDirectedAtBot: true,
    pacing: freshPacing,
    now: new Date(),
    recentlyAnsweredByModerator: true,
    random: FAVORABLE,
  });
  assert.equal(result.priority, "LOW");
  assert.equal(result.proceed, false);
});

test("a NEW substantive directed question is still engaged even right after the bot spoke (recently-answered doesn't blanket-suppress everything)", () => {
  const result = evaluateChatterGate({
    text: "@bot does this affect existing orders too?",
    isDirectedAtBot: true,
    pacing: freshPacing,
    now: new Date(),
    recentlyAnsweredByModerator: true,
    random: FAVORABLE,
  });
  assert.notEqual(result.priority, "LOW");
  assert.equal(result.proceed, true);
});

test('ambient greeting ("good morning everyone") -> MEDIUM, may or may not respond depending on pacing/RNG, per spec §14', () => {
  const favorable = evaluateChatterGate({ text: "good morning everyone", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  const unfavorable = evaluateChatterGate({ text: "good morning everyone", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: UNFAVORABLE });
  assert.equal(favorable.priority, "MEDIUM");
  assert.equal(favorable.proceed, true);
  assert.equal(unfavorable.proceed, false);
});
