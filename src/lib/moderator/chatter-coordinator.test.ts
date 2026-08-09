import { test } from "node:test";
import assert from "node:assert/strict";
import { selectChatterAction, resolveDirectedModerator, type ChatterCandidate, type ChatterPacingState, type ModeratorIdentity } from "./chatter-coordinator";

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

/* ------------------------------------------------- moderator handoff requests ---- */
// Reproduces the exact live sequence that prompted this: Kwan answered six
// messages in a row, including fabricating "it's just me around" when Test
// was actually deployed and eligible, and answering on Test's behalf even
// after an explicit @test1_mod_bot mention.

test('REQUIRED: "any other moderator who can respond here?" excludes whoever has been carrying the conversation, even with no eligible-candidate-blocking pacing issue', () => {
  const now = new Date();
  const kwan = candidate("kwan", { wasLastSpeaker: true, pacing: { lastSpokeAt: new Date(now.getTime() - 15_000).toISOString(), consecutiveMessages: 1 } });
  const test1 = candidate("test1", { pacing: { lastSpokeAt: new Date(now.getTime() - 3_600_000).toISOString(), consecutiveMessages: 0 } });
  const result = selectChatterAction({ text: "any other moderator who can respond here?", candidates: [kwan, test1], now });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, "test1");
  assert.ok(result.type === "CASUAL_CHAT" && result.reasons.includes("moderator_handoff_request"));
});

test('"anyone else?" also triggers moderator handoff, not just the literal phrase "other moderator"', () => {
  const kwan = candidate("kwan", { wasLastSpeaker: true });
  const test1 = candidate("test1");
  const result = selectChatterAction({ text: "anyone else around?", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, "test1");
});

test("a moderator-handoff request with only ONE moderator deployed has no one to exclude, so it's just an ordinary question that moderator answers -- not silenced, and not forced to fabricate that no one else exists", () => {
  const result = single({ text: "is any other moderator around?", wasLastSpeaker: true });
  assert.equal(result.type, "ANSWER");
  assert.equal(result.type === "ANSWER" && result.deploymentId, DEPLOYMENT_A);
});

test('REQUIRED: an explicit @mention of a SPECIFIC different moderator wins over continuity even for a plain SUBSTANTIVE statement (not just a question) -- reproduces Kwan answering on test1_mod_bot\'s behalf after "@test1_mod_bot is here too"', () => {
  const kwan = candidate("kwan", { wasLastSpeaker: true });
  const test1 = candidate("test1", { isDirectedAtBot: true });
  const result = selectChatterAction({ text: "nothing, just thought @test1_mod_bot is here too", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, "test1");
  assert.ok(result.type === "CASUAL_CHAT" && result.reasons.includes("directed_casual"));
});

/* --------------------------------------------------------- conversation closing ---- */

test('REQUIRED: a closing acknowledgement ("I see, okay.") right after a moderator reply -> SILENCE, not a forced follow-up', () => {
  const result = single({ text: "I see, okay.", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled_recent_reply"]);
});

test('closing phrases like "got it" / "alright" / "fair enough" are treated as trivial regardless of word count', () => {
  for (const text of ["got it", "alright", "fair enough", "makes sense", "sounds good"]) {
    const result = single({ text });
    assert.notEqual(result.type, "ANSWER");
    assert.notEqual(result.type, "CASUAL_CHAT");
  }
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

/* ================================================= resolveDirectedModerator ==== */
// Reproduces the exact live bug: "what persona are you kwan?" (no @mention)
// went unanswered until the human typed "@kwan_mod_bot" explicitly.

const KWAN: ModeratorIdentity = { deploymentId: "dep-kwan", name: "Kwan", botUsername: "kwan_mod_bot" };
const TEST_MOD: ModeratorIdentity = { deploymentId: "dep-test", name: "Test", botUsername: "test1_mod_bot" };

test("REQUIRED: plain configured name (no @) resolves to that moderator -- \"what persona are you kwan?\"", () => {
  const match = resolveDirectedModerator("what persona are you kwan?", [KWAN, TEST_MOD]);
  assert.deepEqual(match, { deploymentId: "dep-kwan", isTypo: false });
});

test('REQUIRED: "test what do you think?" resolves to Test by plain name', () => {
  const match = resolveDirectedModerator("test what do you think?", [KWAN, TEST_MOD]);
  assert.deepEqual(match, { deploymentId: "dep-test", isTypo: false });
});

test("REQUIRED: @username still resolves, unambiguously, even with another moderator's plain name nowhere nearby", () => {
  const match = resolveDirectedModerator("@kwan_mod_bot what do you think?", [KWAN, TEST_MOD]);
  assert.deepEqual(match, { deploymentId: "dep-kwan", isTypo: false });
});

test('typo-tolerant: "how are you knaw?" resolves to Kwan via transposition match, flagged as a typo', () => {
  const match = resolveDirectedModerator("how are you knaw?", [KWAN, TEST_MOD]);
  assert.deepEqual(match, { deploymentId: "dep-kwan", isTypo: true });
});

test('typo-tolerant: "kwna" (letters swapped) also resolves to Kwan', () => {
  const match = resolveDirectedModerator("kwna, you there?", [KWAN, TEST_MOD]);
  assert.deepEqual(match, { deploymentId: "dep-kwan", isTypo: true });
});

test("REQUIRED word-boundary safety: a moderator named Ann is NOT triggered by \"announcement\"", () => {
  const ann: ModeratorIdentity = { deploymentId: "dep-ann", name: "Ann", botUsername: "ann_mod_bot" };
  const match = resolveDirectedModerator("did everyone see the announcement?", [ann]);
  assert.equal(match, null);
});

test("REQUIRED word-boundary safety: Test is not falsely fuzzy-matched by ordinary real words distance-1 away (rest/best/west)", () => {
  for (const word of ["let's rest for a bit", "that's the best one", "heading west now"]) {
    const match = resolveDirectedModerator(word, [KWAN, TEST_MOD]);
    assert.equal(match, null, `"${word}" must not falsely address Test`);
  }
});

test("ambiguous plain-name match across two moderators with overlapping tokens resolves to no match, not a guess", () => {
  const kwan2: ModeratorIdentity = { deploymentId: "dep-kwan2", name: "Kwan", botUsername: "kwan2_mod_bot" };
  const match = resolveDirectedModerator("hey kwan, you around?", [KWAN, kwan2]);
  assert.equal(match, null);
});

test("no match at all when the message doesn't reference any moderator", () => {
  const match = resolveDirectedModerator("just chatting about my day", [KWAN, TEST_MOD]);
  assert.equal(match, null);
});

test("works for arbitrary configured names, not hardcoded to Kwan/Test", () => {
  const mika: ModeratorIdentity = { deploymentId: "dep-mika", name: "Mika", botUsername: "mika_bot" };
  const match = resolveDirectedModerator("mika, what do you think?", [mika]);
  assert.deepEqual(match, { deploymentId: "dep-mika", isTypo: false });
});

/* ---- continuity priority when combined with the real selection pipeline ---- */

test("REQUIRED: an explicit plain-name mention of a DIFFERENT moderator wins over wasLastSpeaker continuity", () => {
  const kwan = candidate("dep-kwan", { wasLastSpeaker: true });
  const test1 = candidate("dep-test", { isDirectedAtBot: true }); // as resolved by resolveDirectedModerator for "test"
  const result = selectChatterAction({ text: "test what do you think about that?", candidates: [kwan, test1], now: new Date() });
  assert.notEqual(result.type, "SILENCE");
  assert.equal(result.type !== "SILENCE" && result.deploymentId, "dep-test");
});

test("when no moderator is named, continuity still governs normally (Kwan keeps answering its own thread)", () => {
  const kwan = candidate("dep-kwan", { wasLastSpeaker: true });
  const test1 = candidate("dep-test");
  const result = selectChatterAction({ text: "oh nice, tell me more about that", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.equal(result.type === "CASUAL_CHAT" && result.deploymentId, "dep-kwan");
});
