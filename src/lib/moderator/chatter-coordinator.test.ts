import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChatterAction, type ChatterCandidate, type ChatterPacingState } from "./chatter-coordinator";

/**
 * Natural Chatter is contextual SOCIAL ACTION SELECTION, not response
 * probability. There is no RNG anywhere in selectChatterAction — these
 * tests are fully deterministic by construction, which is itself the proof
 * that no coin flip can silence an obviously-appropriate message.
 */

const freshPacing: ChatterPacingState = { lastSpokeAt: null, consecutiveMessages: 0 };

const DEPLOYMENT_A = "deployment-a";
const DEPLOYMENT_B = "deployment-b";

function candidate(id: string, over: Partial<ChatterCandidate> = {}): ChatterCandidate {
  return { deploymentId: id, isDirectedAtBot: false, wasLastSpeaker: false, pacing: freshPacing, ...over };
}

function single(opts: {
  text: string;
  isDirectedAtBot?: boolean;
  wasLastSpeaker?: boolean;
  pacing?: ChatterPacingState;
  now?: Date;
  recentlyAnsweredByModerator?: boolean;
  recentlyRespondedByHuman?: boolean;
}) {
  return selectChatterAction({
    text: opts.text,
    candidates: [
      candidate(DEPLOYMENT_A, {
        isDirectedAtBot: opts.isDirectedAtBot ?? false,
        wasLastSpeaker: opts.wasLastSpeaker ?? false,
        pacing: opts.pacing ?? freshPacing,
      }),
    ],
    now: opts.now ?? new Date(),
    recentlyAnsweredByModerator: opts.recentlyAnsweredByModerator,
    recentlyRespondedByHuman: opts.recentlyRespondedByHuman,
  });
}

/* ------------------------------------------------------------ hard filters ---- */

test("empty message -> SILENCE with a contextual reason (never a roll)", () => {
  const result = single({ text: "   " });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["empty_message"]);
});

test("single-character message -> SILENCE (too_short)", () => {
  const result = single({ text: "k" });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["too_short"]);
});

/* -------------------------------------------------- the original failure case ---- */

test("REQUIRED: quiet-room community opener -> CASUAL_CHAT, deterministically, with one moderator selected", () => {
  const result = selectChatterAction({
    text: "good evening everyone, how's everyone doing?",
    candidates: [candidate(DEPLOYMENT_A), candidate(DEPLOYMENT_B), candidate("deployment-c")],
    now: new Date(),
  });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && typeof result.deploymentId, "string");
  assert.ok(result.reasons.includes("community_opener"));
  assert.ok(result.reasons.includes("unanswered"));
});

test("REQUIRED: the quiet-room opener result is invariant -- there is no RNG input that could turn it into SILENCE", () => {
  // selectChatterAction takes no `random` parameter at all: repeated calls
  // with identical context are identical by construction, which is a
  // stronger guarantee than mocking a seed.
  const run = () =>
    selectChatterAction({
      text: "good evening everyone, how's everyone doing?",
      candidates: [candidate(DEPLOYMENT_A), candidate(DEPLOYMENT_B)],
      now: new Date(),
    });
  for (let i = 0; i < 50; i++) {
    assert.equal(run().type, "CASUAL_CHAT");
  }
});

test('REQUIRED: weaker opener "gm guys" in a quiet room -> a real engagement action, not silence', () => {
  const result = single({ text: "gm guys" });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.ok(result.reasons.includes("community_opener"));
});

test('"what\'s everyone up to?" is a community opener -> CASUAL_CHAT, not ANSWER', () => {
  const result = single({ text: "what's everyone up to?" });
  assert.equal(result.type, "CASUAL_CHAT");
});

test("REQUIRED: opener already handled by humans -> SILENCE with reason already_handled", () => {
  const result = single({ text: "gm everyone", recentlyRespondedByHuman: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled"]);
});

test("opener already handled by another moderator -> SILENCE (already_handled)", () => {
  const result = single({ text: "gm everyone", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled"]);
});

/* --------------------------------------------------------- trivial handling ---- */

test('REQUIRED: unmentioned "lol" -> SILENCE (trivial_low_value), no text action', () => {
  const result = single({ text: "lol" });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["trivial_low_value"]);
});

test("a bare greeting with no room-address term stays trivial -> SILENCE", () => {
  const result = single({ text: "gm" });
  assert.equal(result.type, "SILENCE");
});

test('a DIRECTED laugh ("@bot lol") -> REACT (a real Telegram reaction), never a text reply', () => {
  const result = single({ text: "@bot lol", isDirectedAtBot: true });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.emoji, "😂");
});

test('a DIRECTED thanks -> REACT with an appropriate reaction', () => {
  const result = single({ text: "@bot thanks", isDirectedAtBot: true });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.emoji, "🙏");
});

test('a DIRECTED trivial message that isn\'t a laugh/thanks -> SHORT_ACK (deterministic, no LLM)', () => {
  const result = single({ text: "@bot yeah", isDirectedAtBot: true });
  assert.equal(result.type, "SHORT_ACK");
});

test('a resolution acknowledgement ("fixed now") -> REACT, even unmentioned', () => {
  const result = single({ text: "fixed now" });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.emoji, "👍");
});

test("a trivial follow-up right after a moderator reply -> SILENCE with already_handled_recent_reply", () => {
  const result = single({ text: "ok", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled_recent_reply"]);
});

/* ------------------------------------------------------------------ ANSWER ---- */

test("REQUIRED: a genuine product question -> ANSWER (not CASUAL_CHAT)", () => {
  const result = single({ text: "how many moderators can Basic have?" });
  assert.equal(result.type, "ANSWER");
  assert.ok(result.reasons.includes("substantive_question"));
});

test("a substantive unmentioned question -> ANSWER, never dropped for being unmentioned", () => {
  const result = single({ text: "does anyone know why all withdrawals are failing?" });
  assert.equal(result.type, "ANSWER");
});

/* -------------------------------------------------------- conversation flow ---- */

test("REQUIRED: an active conversation continuation is answered by the SAME moderator, not the quietest one", () => {
  const now = new Date();
  const result = selectChatterAction({
    text: "just here thinking about this new product, pretty tired though",
    candidates: [
      candidate(DEPLOYMENT_A, { wasLastSpeaker: true, pacing: { lastSpokeAt: new Date(now.getTime() - 40_000).toISOString(), consecutiveMessages: 1 } }),
      candidate(DEPLOYMENT_B, { pacing: { lastSpokeAt: new Date(now.getTime() - 600_000).toISOString(), consecutiveMessages: 0 } }),
    ],
    now,
  });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, DEPLOYMENT_A);
  assert.ok(result.reasons.includes("active_conversation_continuity"));
});

test("an explicit mention of a DIFFERENT moderator still wins over continuity", () => {
  const result = selectChatterAction({
    text: "@test1_mod_bot what do you think about that?",
    candidates: [candidate(DEPLOYMENT_A, { wasLastSpeaker: true }), candidate(DEPLOYMENT_B, { isDirectedAtBot: true })],
    now: new Date(),
  });
  assert.notEqual(result.type, "SILENCE");
  assert.equal(result.type !== "SILENCE" && result.deploymentId, DEPLOYMENT_B);
});

test("an unmentioned plain statement with no active exchange -> SILENCE (low_social_priority)", () => {
  const result = single({ text: "just finished a really long day at work today" });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["low_social_priority"]);
});

/* ---------------------------------------------------------- pacing safeguards ---- */

test("an ambient trivial message while a moderator is over-participating -> SILENCE (no eligible moderator)", () => {
  const result = single({ text: "haha", pacing: { lastSpokeAt: null, consecutiveMessages: 2 } });
  assert.equal(result.type, "SILENCE");
});

test("a community opener bypasses the cooldown window -- it is not lost to pacing", () => {
  const now = new Date();
  const result = single({
    text: "good evening everyone, how's everyone doing?",
    pacing: { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 },
    now,
  });
  assert.equal(result.type, "CASUAL_CHAT");
});

test("a real question bypasses the cooldown window too", () => {
  const now = new Date();
  const result = single({
    text: "does anyone know why this is happening?",
    pacing: { lastSpokeAt: new Date(now.getTime() - 5_000).toISOString(), consecutiveMessages: 0 },
    now,
  });
  assert.equal(result.type, "ANSWER");
});

/* ------------------------------------------------------- multi-moderator cost ---- */

test("REQUIRED: 5 moderators + one opener -> exactly ONE deployment selected (never one action per moderator)", () => {
  const result = selectChatterAction({
    text: "good evening everyone, how's everyone doing?",
    candidates: [candidate("d1"), candidate("d2"), candidate("d3"), candidate("d4"), candidate("d5")],
    now: new Date(),
  });
  assert.equal(result.type, "CASUAL_CHAT");
  // The action union structurally carries exactly one deploymentId — there
  // is no shape in which several moderators could each be told to generate.
  assert.ok(result.type === "CASUAL_CHAT" && ["d1", "d2", "d3", "d4", "d5"].includes(result.deploymentId));
});

test("REQUIRED: SILENCE carries no deploymentId at all -- nothing downstream can generate from it", () => {
  const result = selectChatterAction({
    text: "lol",
    candidates: [candidate("d1"), candidate("d2"), candidate("d3")],
    now: new Date(),
  });
  assert.equal(result.type, "SILENCE");
  assert.ok(!("deploymentId" in result));
});

test("zero eligible moderators -> SILENCE (no_eligible_moderator)", () => {
  const result = selectChatterAction({ text: "good evening everyone, how's everyone doing?", candidates: [], now: new Date() });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["no_eligible_moderator"]);
});

test("selection spreads across moderators: the quietest eligible one is chosen when none is mentioned or mid-exchange", () => {
  const now = new Date();
  const result = selectChatterAction({
    text: "what's everyone up to?",
    candidates: [
      candidate(DEPLOYMENT_A, { pacing: { lastSpokeAt: new Date(now.getTime() - 60_000).toISOString(), consecutiveMessages: 0 } }),
      candidate(DEPLOYMENT_B, { pacing: { lastSpokeAt: new Date(now.getTime() - 600_000).toISOString(), consecutiveMessages: 0 } }),
    ],
    now,
  });
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, DEPLOYMENT_B);
});

/* --------------------------------------------------- no legacy probability path ---- */

test("REQUIRED: every action carries contextual reasons, and none of them is a probability/roll reason", () => {
  const samples = [
    single({ text: "good evening everyone, how's everyone doing?" }),
    single({ text: "lol" }),
    single({ text: "how many moderators can Basic have?" }),
    single({ text: "@bot lol", isDirectedAtBot: true }),
    single({ text: "gm guys" }),
  ];
  for (const s of samples) {
    assert.ok(s.reasons.length > 0, "every action must explain itself");
    for (const reason of s.reasons) {
      assert.ok(!/roll|probability|chance|random/i.test(reason), `reason "${reason}" must not be probability-based`);
    }
  }
});
