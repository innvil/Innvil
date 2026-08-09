import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChatterResponder, type ChatterCandidate, type ChatterPacingState } from "./chatter-coordinator";

const freshPacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 0 };
const FAVORABLE = () => 0.01; // passes any probability gate
const UNFAVORABLE = () => 0.99; // fails any probability gate

const DEPLOYMENT_A = "deployment-a";
const DEPLOYMENT_B = "deployment-b";

/** Single-candidate helper — most tests only care about one deployment's own
 *  scoring; selectChatterResponder is the only exported entry point now that
 *  it also handles the multi-candidate case. */
function single(opts: {
  text: string;
  isDirectedAtBot: boolean;
  wasLastSpeaker?: boolean;
  pacing?: ChatterPacingState;
  now?: Date;
  recentlyAnsweredByModerator?: boolean;
  random?: () => number;
}) {
  return selectChatterResponder({
    text: opts.text,
    candidates: [{ deploymentId: DEPLOYMENT_A, isDirectedAtBot: opts.isDirectedAtBot, wasLastSpeaker: opts.wasLastSpeaker ?? false, pacing: opts.pacing ?? freshPacing }],
    now: opts.now ?? new Date(),
    recentlyAnsweredByModerator: opts.recentlyAnsweredByModerator,
    random: opts.random,
  });
}

/* ---------------------------------------------------------- hard pre-filters ---- */

test("empty message -> IGNORE (EMPTY_MESSAGE), regardless of everything else", () => {
  const result = single({ text: "   ", isDirectedAtBot: true, random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, deploymentId: null, reasonCode: "EMPTY_MESSAGE", priority: "LOW" });
});

test("single-character message -> IGNORE (TOO_SHORT)", () => {
  const result = single({ text: "k", isDirectedAtBot: true, random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, deploymentId: null, reasonCode: "TOO_SHORT", priority: "LOW" });
});

test("ambient message within the cooldown window since the bot last spoke -> hard IGNORE (no eligible candidate), even with a favorable roll", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 }; // 5s ago
  const result = single({ text: "hows it going", isDirectedAtBot: false, pacing, now, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("a DIRECTED message bypasses the cooldown window entirely", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 };
  const result = single({ text: "hey are you around", isDirectedAtBot: true, pacing, now, random: FAVORABLE });
  assert.equal(result.proceed, true);
});

test("ambient message after the bot has already sent 2 messages in a row -> hard IGNORE (no eligible candidate)", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 2 };
  const result = single({ text: "just chatting away", isDirectedAtBot: false, pacing, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("a DIRECTED message bypasses the consecutive-messages cap too", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 5 };
  const result = single({ text: "still there?", isDirectedAtBot: true, pacing, random: FAVORABLE });
  assert.equal(result.proceed, true);
});

/* ------------------------------------------- contextual scoring, not a coin flip ---- */

test("Spec §14: unmentioned substantive question -> HIGH priority, engages with a favorable roll (not lost to a flat 15%)", () => {
  const result = single({ text: "Does anyone know why all withdrawals are failing?", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

test('Spec §14: unmentioned trivial chatter ("lol") -> hard LOW priority, deterministic SILENCE regardless of RNG', () => {
  const favorable = single({ text: "lol", isDirectedAtBot: false, random: FAVORABLE });
  const unfavorable = single({ text: "lol", isDirectedAtBot: false, random: UNFAVORABLE });
  assert.equal(favorable.proceed, false);
  assert.equal(favorable.reasonCode, "NO_ELIGIBLE_CANDIDATE");
  assert.equal(unfavorable.proceed, false);
  assert.equal(unfavorable.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("Spec §14: meaningful direct mention -> VERY_HIGH priority, always engages (no RNG call needed)", () => {
  const result = single({ text: "@mika_mod_bot can you explain this?", isDirectedAtBot: true, random: UNFAVORABLE }); // even an unfavorable roll can't stop VERY_HIGH
  assert.equal(result.priority, "VERY_HIGH");
  assert.equal(result.proceed, true);
});

test('Spec §13: a low-value direct mention ("@bot lol") does NOT gain an automatic ~75-85% response chance — it lands in the ambiguous middle', () => {
  const result = single({ text: "@bot lol", isDirectedAtBot: true, random: FAVORABLE });
  assert.equal(result.priority, "MEDIUM");
});

test("MEDIUM priority is the only band randomness actually decides — unfavorable RNG resolves to IGNORE (PROBABILITY_GATE)", () => {
  const result = single({ text: "@bot lol", isDirectedAtBot: true, random: UNFAVORABLE });
  assert.deepEqual(result, { proceed: false, deploymentId: DEPLOYMENT_A, reasonCode: "PROBABILITY_GATE", priority: "MEDIUM" });
});

test("Spec §10: a repeated trivial direct mention right after the bot itself just answered -> LOW priority (recently-answered signal), not an automatic reply", () => {
  const result = single({ text: "@bot hi", isDirectedAtBot: true, recentlyAnsweredByModerator: true, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("a NEW substantive directed question is still engaged even right after the bot spoke (recently-answered doesn't blanket-suppress everything)", () => {
  const result = single({ text: "@bot does this affect existing orders too?", isDirectedAtBot: true, recentlyAnsweredByModerator: true, random: FAVORABLE });
  assert.notEqual(result.priority, "LOW");
  assert.equal(result.proceed, true);
});

test("a genuinely new, substantive AMBIENT question right after the bot replied competes on its own merits, no penalty -- it isn't the same message as whatever was just answered, and a live back-and-forth is the clearest case of a message actually meant for the room", () => {
  const result = single({ text: "does anyone know why this happened?", isDirectedAtBot: false, recentlyAnsweredByModerator: true, random: FAVORABLE });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

test("a trivial AMBIENT follow-up right after the bot replied still stays hard-silenced -- that one really is just redundant chatter", () => {
  const result = single({ text: "ok", isDirectedAtBot: false, recentlyAnsweredByModerator: true, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test('a greeting that addresses the room ("good morning everyone") is a COMMUNITY_OPENER -> HIGH, not left to a coin flip like plain ambient chatter', () => {
  const result = single({ text: "good morning everyone", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

/* ---------------------------------------------------- community opener detection ---- */

test("Spec: an unanswered community opener into a quiet room engages deterministically (VERY_HIGH), not lost to an 85% roll -- reproduces the exact live case that prompted this", () => {
  const result = single({ text: "good evening everyone, how's everyone doing?", isDirectedAtBot: false, random: UNFAVORABLE });
  assert.equal(result.priority, "VERY_HIGH");
  assert.equal(result.proceed, true); // even the worst roll can't stop VERY_HIGH
});

test('Spec §4: a short greeting that explicitly addresses the room ("gm guys") is an opener, not trivial filler', () => {
  const result = single({ text: "gm guys", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

test('Spec §22: "what\'s everyone up to?" is a community opener, not merely a factual question', () => {
  const result = single({ text: "what's everyone up to?", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.priority, "VERY_HIGH");
});

test("Spec §7: a bare greeting with no room-address term (\"gm\" alone) is still ordinary trivial chatter, not an opener", () => {
  const result = single({ text: "gm", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("Spec: a genuine factual/support question is NOT reclassified as a community opener just because it contains \"anyone\"", () => {
  const result = single({ text: "does anyone know why orders are delayed?", isDirectedAtBot: false, random: FAVORABLE });
  assert.equal(result.priority, "HIGH"); // question + substantive, same as before -- not boosted to VERY_HIGH by the opener weight
  assert.equal(result.proceed, true);
});

/* ------------------------------------------------------- multi-moderator selection ---- */

test("Spec §15: with multiple eligible moderators, the Coordinator picks AT MOST ONE responder, never runs a roll per moderator", () => {
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing },
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing },
  ];
  const result = selectChatterResponder({
    text: "does anyone know why my order is stuck?",
    candidates,
    now: new Date(),
    random: FAVORABLE,
  });
  assert.equal(result.proceed, true);
  // Exactly one winner — the type itself only ever carries a single deploymentId.
  assert.ok(result.deploymentId === DEPLOYMENT_A || result.deploymentId === DEPLOYMENT_B);
});

test("Spec §15: a direct mention of one specific moderator makes that deployment win over an ambient-only rival", () => {
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: true, wasLastSpeaker: false, pacing: freshPacing }, // @mentioned
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing }, // not mentioned
  ];
  const result = selectChatterResponder({ text: "@mika_mod_bot lol", candidates, now: new Date(), random: FAVORABLE });
  assert.equal(result.proceed, true);
  assert.equal(result.deploymentId, DEPLOYMENT_A);
});

test("Spec §15: if another moderator already answered, others normally stay silent for a low-value follow-up", () => {
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing },
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing },
  ];
  const result = selectChatterResponder({
    text: "nice",
    candidates,
    now: new Date(),
    recentlyAnsweredByModerator: true,
    random: FAVORABLE,
  });
  assert.equal(result.proceed, false);
});

test("ties are broken toward whichever moderator has been quietest longest, spreading engagement rather than always picking the same one", () => {
  const now = new Date();
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: false, pacing: { lastSpokeAt: new Date(now.getTime() - 60_000).toISOString(), consecutiveMessages: 0 } },
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: { lastSpokeAt: new Date(now.getTime() - 600_000).toISOString(), consecutiveMessages: 0 } }, // spoke longer ago
  ];
  const result = selectChatterResponder({ text: "what does everyone think about this?", candidates, now, random: FAVORABLE });
  assert.equal(result.proceed, true);
  assert.equal(result.deploymentId, DEPLOYMENT_B);
});

test("a human continuing an active exchange with a SPECIFIC moderator gets answered by that SAME moderator, not whichever one has simply been quietest -- reproduces a live bug where a different bot jumped into someone else's conversation as if it were the subject", () => {
  const now = new Date();
  const candidates: ChatterCandidate[] = [
    // DEPLOYMENT_A just replied to the human moments ago -- it's the one actually mid-conversation.
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: true, pacing: { lastSpokeAt: new Date(now.getTime() - 40_000).toISOString(), consecutiveMessages: 1 } },
    // DEPLOYMENT_B hasn't spoken in a long time -- "quietest", but wasn't part of this exchange.
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: { lastSpokeAt: new Date(now.getTime() - 600_000).toISOString(), consecutiveMessages: 0 } },
  ];
  const result = selectChatterResponder({
    text: "I am doing an autobot - a moderator for telegram, and you are literally it. lol",
    candidates,
    now,
    random: FAVORABLE,
  });
  assert.equal(result.proceed, true);
  assert.equal(result.deploymentId, DEPLOYMENT_A);
});

test("continuity does not override an explicit mention of a DIFFERENT moderator -- a deliberate mention still wins", () => {
  const now = new Date();
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: true, pacing: freshPacing },
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: true, wasLastSpeaker: false, pacing: freshPacing }, // explicitly @mentioned instead
  ];
  const result = selectChatterResponder({ text: "@test1_mod_bot what do you think?", candidates, now, random: FAVORABLE });
  assert.equal(result.proceed, true);
  assert.equal(result.deploymentId, DEPLOYMENT_B);
});

test("zero candidates (no chatter-eligible deployment in the community) -> NO_ELIGIBLE_CANDIDATE", () => {
  const result = selectChatterResponder({ text: "hello world", candidates: [], now: new Date(), random: FAVORABLE });
  assert.deepEqual(result, { proceed: false, deploymentId: null, reasonCode: "NO_ELIGIBLE_CANDIDATE", priority: "LOW" });
});

test("an ambient HIGH-priority question bypasses the cooldown window, even though only a DIRECTED message used to", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 }; // 5s ago, within cooldown
  const result = single({ text: "does anyone know why the site is down?", isDirectedAtBot: false, pacing, now, random: FAVORABLE });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.proceed, true);
});

test("an ambient MEDIUM-priority message (not HIGH/VERY_HIGH) still respects the cooldown window", () => {
  const now = new Date();
  const pacing: ChatterPacingState = { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 };
  const result = single({ text: "hows it going", isDirectedAtBot: false, pacing, now, random: FAVORABLE });
  assert.equal(result.proceed, false);
  assert.equal(result.reasonCode, "NO_ELIGIBLE_CANDIDATE");
});

test("an ambient HIGH-priority question also bypasses the dominating-conversation cap", () => {
  const pacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 2 };
  const result = single({ text: "does anyone know why the site is down?", isDirectedAtBot: false, pacing, random: FAVORABLE });
  assert.equal(result.proceed, true);
});

test("one candidate hard-blocked (dominating, MEDIUM-priority message) and one still eligible -> the eligible one may still respond", () => {
  const candidates: ChatterCandidate[] = [
    { deploymentId: DEPLOYMENT_A, isDirectedAtBot: false, wasLastSpeaker: false, pacing: { lastSpokeAt: null, consecutiveMessages: 2 } }, // over-participating
    { deploymentId: DEPLOYMENT_B, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing },
  ];
  // Non-question, substantive -> MEDIUM, so it does NOT bypass the dominating-conversation cap (only HIGH/VERY_HIGH do).
  const result = selectChatterResponder({ text: "that's a good point", candidates, now: new Date(), random: FAVORABLE });
  assert.equal(result.proceed, true);
  assert.equal(result.deploymentId, DEPLOYMENT_B);
});
