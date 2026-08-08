import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateChatterGate, type ChatterPacingState } from "./chatter-coordinator";

const freshPacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 0 };
const FAVORABLE = () => 0.01; // passes any probability gate
const UNFAVORABLE = () => 0.99; // fails any probability gate

test("empty message -> IGNORE (EMPTY_MESSAGE), regardless of everything else", () => {
  const result = evaluateChatterGate({ text: "   ", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "EMPTY_MESSAGE" });
});

test("single-character message -> IGNORE (TOO_SHORT)", () => {
  const result = evaluateChatterGate({ text: "k", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "TOO_SHORT" });
});

test("ambient message within the cooldown window since the bot last spoke -> IGNORE (COOLDOWN)", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 }; // 5s ago
  const result = evaluateChatterGate({ text: "hows it going", isDirectedAtBot: false, pacing, now, random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "COOLDOWN" });
});

test("a DIRECTED message (reply/mention) bypasses the cooldown window", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 };
  const result = evaluateChatterGate({ text: "hey are you around", isDirectedAtBot: true, pacing, now, random: FAVORABLE });
  assert.equal(result.proceed, true);
});

test("ambient message after the bot has already sent 2 messages in a row -> IGNORE (AVOID_DOMINATING_CONVERSATION)", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 2 };
  const result = evaluateChatterGate({ text: "just chatting away", isDirectedAtBot: false, pacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "AVOID_DOMINATING_CONVERSATION" });
});

test("a DIRECTED message bypasses the consecutive-messages cap too", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 5 };
  const result = evaluateChatterGate({ text: "still there?", isDirectedAtBot: true, pacing, now: new Date(), random: FAVORABLE });
  assert.equal(result.proceed, true);
});

test("ambient chatter is mostly ignored — an unfavorable RNG resolves to IGNORE (PROBABILITY_GATE)", () => {
  const result = evaluateChatterGate({ text: "just an ordinary message", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: UNFAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "PROBABILITY_GATE" });
});

test("ambient chatter CAN proceed with a favorable RNG -> AMBIENT_OPPORTUNITY", () => {
  const result = evaluateChatterGate({ text: "just an ordinary message", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: true, reasonCode: "AMBIENT_OPPORTUNITY" });
});

test("a directed message proceeds with -> DIRECTED reason code", () => {
  const result = evaluateChatterGate({ text: "hey what do you think", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: true, reasonCode: "DIRECTED" });
});

test("a directed message is still subject to the probability gate (not automatic)", () => {
  const result = evaluateChatterGate({ text: "hey what do you think", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: UNFAVORABLE });
  assert.deepEqual(result, { proceed: false, reasonCode: "PROBABILITY_GATE" });
});

test("directed messages are held to a much higher probability threshold than ambient ones", () => {
  // A borderline RNG value that ambient chatter would fail but a directed message would pass.
  const borderline = () => 0.5;
  const ambient = evaluateChatterGate({ text: "ordinary chat", isDirectedAtBot: false, pacing: freshPacing, now: new Date(), random: borderline });
  const directed = evaluateChatterGate({ text: "ordinary chat", isDirectedAtBot: true, pacing: freshPacing, now: new Date(), random: borderline });
  assert.equal(ambient.proceed, false);
  assert.equal(directed.proceed, true);
});
