import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectChatterAction, resolveDirectedModerator, isConversationalOpener,
  isAmbientOpenerFallbackCandidate, resolveAmbientOpenerFallback,
  type ChatterCandidate, type ChatterPacingState, type ModeratorIdentity,
} from "./chatter-coordinator";

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

test("REVISED (was: bare greeting stays trivial -> SILENCE): a bare greeting with no room-address term is now a real conversational opener, not silence -- see isConversationalOpener generalization", () => {
  const result = single({ text: "gm" });
  assert.equal(result.type, "CASUAL_CHAT");
  assert.ok(result.reasons.includes("community_opener"));
});

/* ============================================ isConversationalOpener ==========
   Semantic, not lexical: a conversation opener is identified by its SOCIAL
   FUNCTION (a bid to start/restart/re-enter interaction), not by membership
   in a fixed greeting/room-address phrase list. Live bug: "hey there again"
   (no "everyone"/"guys"/etc.) was silenced as low_social_priority even
   though it's plainly a re-entry bid. These tests prove generalization, not
   phrase memorization -- each group is a DIFFERENT message shape from the
   ones the implementation regexes literally quote in comments.

   isConversationalOpener() is a NARROW, purely positive signal detector --
   it does not know about questions/requests/problems/acknowledgements, so
   it correctly returns true for "hey thanks, that fixed it" (it DOES
   contain a greeting cue). Precedence between an opener signal and a
   stronger classification (question/problem/acknowledgement) is decided by
   classifyMessageKind's ORDERING, not inside this function -- tested below
   via the real end-to-end pipeline (single()/selectChatterAction), which is
   what actually exercises that precedence. ================ */

test("REQUIRED: clear openers/re-entry are recognized -- generalizes beyond any single fixed phrase", () => {
  const openers = [
    "hey there again", "hello again", "I'm back", "back here", "back again",
    "morning", "yo",
    // casing/punctuation variants
    "HEY THERE AGAIN!", "Hello Again.", "I'M BACK", "Yo!", "Morning,",
  ];
  for (const text of openers) {
    assert.equal(isConversationalOpener(text), true, `expected an opener: "${text}"`);
  }
});

test("REQUIRED: room-addressed openers are recognized", () => {
  for (const text of ["hey everyone", "anyone here?", "morning guys"]) {
    assert.equal(isConversationalOpener(text), true, `expected an opener: "${text}"`);
  }
});

test("REQUIRED: generalizes to UNSEEN combinations of the same signal types, not phrase memorization", () => {
  // None of these exact strings appear anywhere in the implementation's
  // regexes/comments -- they recombine the same underlying signal types
  // (greeting, re-entry, presence-check) in fresh wording/word order.
  const unseen = [
    "well hey, good to see this place lively again",
    "sup, back again folks",
    "it's pretty quiet in here today",
    "just wanted to say I'm back",
  ];
  for (const text of unseen) {
    assert.equal(isConversationalOpener(text), true, `expected an opener (unseen phrasing): "${text}"`);
  }
});

test("REQUIRED: ordinary statements with no opener signal at all are not openers", () => {
  for (const text of ["that's interesting", "looks good", "I already tried that", "the price changed", "okay thanks"]) {
    assert.equal(isConversationalOpener(text), false, `should not be an opener: "${text}"`);
  }
});

test("REQUIRED: no arbitrary length gate -- a longer message can be an opener, a one-word message can be an opener", () => {
  assert.equal(isConversationalOpener("good evening, nice to see this place active again"), true);
  assert.equal(isConversationalOpener("yo"), true);
});

/* ---- precedence: a real question/problem/closure outranks a mere opener
   SIGNAL, decided by classifyMessageKind's ordering (exercised end-to-end
   here, not by asking isConversationalOpener to know about these things) ---- */

test("REQUIRED: opener cue + substantive question/request intent -> QUESTION wins, not COMMUNITY_OPENER", () => {
  for (const text of ["hey, can someone explain this?", "morning, why did my order fail?", "yo kwan, what happened?"]) {
    const result = single({ text });
    assert.equal(result.type, "ANSWER", `expected ANSWER (question wins over the opener cue): "${text}"`);
  }
});

test("REQUIRED: a pure acknowledgement/closure after a moderator reply wins over a greeting cue, not COMMUNITY_OPENER", () => {
  // "fixed" triggers the RESOLVED_ACK_RE reaction path -- proves TRIVIAL
  // classification won, not COMMUNITY_OPENER (which would produce CASUAL_CHAT).
  const withGreeting = single({ text: "hey thanks, that fixed it" });
  assert.equal(withGreeting.type, "REACT");
  assert.notEqual(withGreeting.type, "CASUAL_CHAT");

  const bareAck = single({ text: "okay thanks" });
  assert.equal(bareAck.type, "SILENCE");
  assert.deepEqual(bareAck.reasons, ["trivial_low_value"]);
});

test('a re-entry cue near a problem word stays a real report, not an opener ("again" isn\'t a magic word on its own)', () => {
  // isConversationalOpener DOES detect the re-entry signal in isolation
  // (it's purely positive, by design) -- the problem word is what makes the
  // OVERALL message resolve to SUBSTANTIVE, not COMMUNITY_OPENER.
  assert.equal(isConversationalOpener("it broke again"), true);
  const result = single({ text: "it broke again" });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["low_social_priority"]);
  assert.notEqual(result.type, "CASUAL_CHAT");
});

/* ---- opener + room-activity is a response-selection concern, not part of the definition ---- */

test("REQUIRED: the SAME opener message is classified identically regardless of how busy the room is -- selectChatterAction's context decides the ACTION, not the classification", () => {
  // Case A: quiet room -> engages.
  const quiet = single({ text: "hey there again" });
  assert.equal(quiet.type, "CASUAL_CHAT");
  assert.ok(quiet.reasons.includes("community_opener"));

  // Case B: a moderator JUST answered (busy/active exchange) -> coordinator
  // may choose not to reply, but that's a response-selection decision, not
  // a reclassification of the message as "not an opener".
  const busy = single({ text: "hey there again", recentlyAnsweredByModerator: true });
  assert.equal(busy.type, "SILENCE");
  assert.deepEqual(busy.reasons, ["already_handled"]);
  // isConversationalOpener itself is unaffected by room state -- it's a
  // pure function of the text alone.
  assert.equal(isConversationalOpener("hey there again"), true);
});

/* ---- spam/repetition: an immediate repeat after being answered doesn't double-reply ---- */

test("REQUIRED: repeating the same opener right after a moderator reply does not produce a second reply", () => {
  // 1st "hey" in a quiet room -> engages.
  const first = single({ text: "hey" });
  assert.equal(first.type, "CASUAL_CHAT");
  // 2nd "hey" immediately after, now that a moderator has just answered ->
  // recentlyAnsweredByModerator suppresses the repeat instead of replying again.
  const second = single({ text: "hey", recentlyAnsweredByModerator: true });
  assert.equal(second.type, "SILENCE");
  assert.deepEqual(second.reasons, ["already_handled"]);
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

/* ------------------------------------- referential vs. vocative mentions ---- */
// Live bug: "why are you responding for kwan though?" resolved to Kwan
// (Kwan's name is mentioned) when Test -- signaled by "you" right after
// Test's own prior message -- was the actual addressee. Mentioning a name
// does not by itself make that person the addressee.

test("REQUIRED (live bug repro): \"why are you responding for kwan though?\" does NOT resolve to Kwan -- referential mention, not an address", () => {
  const match = resolveDirectedModerator("why are you responding for kwan though?", [KWAN, TEST_MOD]);
  assert.equal(match, null);
});

test("REQUIRED: \"why did test answer for kwan?\" resolves to neither -- both names are referential here", () => {
  const match = resolveDirectedModerator("why did test answer for kwan?", [KWAN, TEST_MOD]);
  assert.equal(match, null);
});

test("REQUIRED: \"I think Kwan already answered\" does not address Kwan", () => {
  const match = resolveDirectedModerator("I think Kwan already answered", [KWAN, TEST_MOD]);
  assert.equal(match, null);
});

test("REQUIRED: \"does Kwan know about this?\" does not address Kwan", () => {
  const match = resolveDirectedModerator("does Kwan know about this?", [KWAN, TEST_MOD]);
  assert.equal(match, null);
});

test("REQUIRED: genuine vocative uses still resolve after the referential fix (no regression)", () => {
  assert.deepEqual(resolveDirectedModerator("kwan, what do you think?", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("what persona are you kwan?", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("hey kwan", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("tell me, kwan", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("test what do you think?", [KWAN, TEST_MOD]), { deploymentId: "dep-test", isTypo: false });
});

test("REQUIRED (end-to-end, exact live scenario): after Test speaks, \"why are you responding for kwan though?\" selects Test via continuity, not Kwan via a false directed-match", () => {
  const directedMatch: { deploymentId: string; isTypo: boolean } | null = resolveDirectedModerator("why are you responding for kwan though?", [KWAN, TEST_MOD]);
  assert.equal(directedMatch, null); // the fix: no false directed match at all

  // directedMatch is null (just asserted above) -- neither candidate is directed;
  // built explicitly rather than hardcoded false/false so this test would fail
  // loudly if resolveDirectedModerator regressed and started matching again.
  const kwan = candidate("dep-kwan", { isDirectedAtBot: (directedMatch as { deploymentId: string } | null)?.deploymentId === "dep-kwan", wasLastSpeaker: false });
  const test1 = candidate("dep-test", { isDirectedAtBot: (directedMatch as { deploymentId: string } | null)?.deploymentId === "dep-test", wasLastSpeaker: true }); // Test spoke immediately prior
  const result = selectChatterAction({ text: "why are you responding for kwan though?", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "ANSWER");
  if (result.type === "ANSWER") assert.equal(result.deploymentId, "dep-test");
});

/* ---------------------------------- comma-flanked mid-sentence vocative ---- */
// Live bug: "okay, test, waddup?" (a name flanked by commas in the MIDDLE of
// the message -- a completely standard written vocative pattern) wasn't
// recognized as addressing Test at all. isLikelyQuestion already handled
// "waddup?" correctly (a trailing "?" is orthography-agnostic) -- the actual
// gap was purely positional/structural in resolveDirectedModerator, not a
// slang-comprehension gap. Fixed via commaPrecededVocative, which generalizes
// by POSITION (comma immediately before the name), not by phrase list.

test('REQUIRED (live bug repro): "okay, test, waddup?" resolves to Test, not left undirected', () => {
  assert.deepEqual(resolveDirectedModerator("okay, test, waddup?", [KWAN, TEST_MOD]), { deploymentId: "dep-test", isTypo: false });
});

test("REQUIRED (end-to-end, exact live scenario): Test is selected even though Kwan spoke most recently -- the comma-flanked name wins over continuity", () => {
  const kwan = candidate("dep-kwan", { wasLastSpeaker: true }); // Kwan spoke immediately prior, per the live transcript
  const test1 = candidate("dep-test", { isDirectedAtBot: resolveDirectedModerator("okay, test, waddup?", [KWAN, TEST_MOD])?.deploymentId === "dep-test" });
  const result = selectChatterAction({ text: "okay, test, waddup?", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "ANSWER");
  if (result.type === "ANSWER") assert.equal(result.deploymentId, "dep-test");
});

test("REQUIRED: generalizes by POSITION, not phrase memorization -- fresh informal wording around a comma-flanked name still resolves correctly", () => {
  assert.deepEqual(resolveDirectedModerator("well, kwan, why is this happening", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("so, test, any updates on that", [KWAN, TEST_MOD]), { deploymentId: "dep-test", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("lol okay, kwan, fr what do u think", [KWAN, TEST_MOD]), { deploymentId: "dep-kwan", isTypo: false });
});

test("REQUIRED: referential mid-sentence mentions are still correctly excluded (no regression from the comma-vocative fix)", () => {
  // No comma directly before the name in any of these -- must stay non-directed.
  assert.equal(resolveDirectedModerator("why did test answer for kwan?", [KWAN, TEST_MOD]), null);
  assert.equal(resolveDirectedModerator("ngl I think kwan already replied to that", [KWAN, TEST_MOD]), null);
  assert.equal(resolveDirectedModerator("not sure why test would say that", [KWAN, TEST_MOD]), null);
});

test('REQUIRED: casual question without canonical grammar still routes to the named moderator, not silence -- "yo test can u explain this?"', () => {
  const directedMatch = resolveDirectedModerator("yo test can u explain this?", [KWAN, TEST_MOD]);
  assert.deepEqual(directedMatch, { deploymentId: "dep-test", isTypo: false });
  const kwan = candidate("dep-kwan", { wasLastSpeaker: true }); // Kwan spoke last -- must NOT win over the named Test
  const test1 = candidate("dep-test", { isDirectedAtBot: true });
  const result = selectChatterAction({ text: "yo test can u explain this?", candidates: [kwan, test1], now: new Date() });
  assert.equal(result.type, "ANSWER");
  if (result.type === "ANSWER") assert.equal(result.deploymentId, "dep-test");
});

test('REQUIRED: casual, comma-flanked substantive ask (no "?") -- problem content wins classification, but the named moderator still gets picked', () => {
  const directedMatch = resolveDirectedModerator("well, test, why is my order stuck", [KWAN, TEST_MOD]);
  assert.deepEqual(directedMatch, { deploymentId: "dep-test", isTypo: false });
  const test1 = candidate("dep-test", { isDirectedAtBot: true });
  const kwan = candidate("dep-kwan");
  const result = selectChatterAction({ text: "well, test, why is my order stuck", candidates: [kwan, test1], now: new Date() });
  assert.notEqual(result.type, "SILENCE");
  if (result.type !== "SILENCE") assert.equal(result.deploymentId, "dep-test");
});

test('REQUIRED: closure in informal/shorthand form is acknowledgement/closure, not a needless new reply -- "kk thx"', () => {
  // Directed, so the outcome distinguishes TRIVIAL specifically (REACT via
  // THANKS_RE) from a generic "not directed" silence -- a weaker assertion
  // (merely "not CASUAL_CHAT/ANSWER") would pass even if this fell through
  // to SILENCE for an unrelated reason, proving nothing about TRIVIAL.
  const result = single({ text: "kk thx", isDirectedAtBot: true });
  assert.equal(result.type, "REACT");
});

test("REQUIRED: unknown/ambiguous informal wording with no real signal stays silent rather than inventing a specific interpretation", () => {
  const result = single({ text: "vibes ig" });
  assert.equal(result.type, "SILENCE");
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

/* ------------------------------------------------ upbeat closing -> REACT ---- */
// Live example: "okay, perfect!" (replying to a moderator mid-conversation)
// got a full CASUAL_CHAT text reply instead of a reaction. Root cause: it's
// 14 chars / 2 words, which used to exceed the old 12-char trivial cap, so it
// fell through to SUBSTANTIVE and continuity picked it up as a real message
// worth continuing.

test('REQUIRED: "okay, perfect!" right after a moderator reply -> REACT, not a text reply', () => {
  const kwan = candidate("dep-kwan", { wasLastSpeaker: true, pacing: { lastSpokeAt: new Date().toISOString(), consecutiveMessages: 1 } });
  const result = selectChatterAction({ text: "okay, perfect!", candidates: [kwan], now: new Date() });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.deploymentId, "dep-kwan");
  assert.equal(result.type === "REACT" && result.emoji, "😄");
});

test('an upbeat closing mentioning "love" reacts with a heart, not the default grin', () => {
  // Must stay <= 2 words to land in the TRIVIAL classification at all (that's
  // where POSITIVE_WORD_RE is checked) -- "love it!" not "love it, thanks!".
  const result = single({ text: "love it!", wasLastSpeaker: true });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.emoji, "❤️");
});

test("a plain neutral closing (no positive word) still stays SILENCE, not REACT -- only genuinely upbeat closings react", () => {
  const result = single({ text: "got it", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled_recent_reply"]);
});

test("an upbeat closing reacts even when NOT directed and NOT mid a continuity thread, as long as a candidate is eligible", () => {
  const result = single({ text: "awesome, thanks!" });
  assert.equal(result.type, "REACT");
});

test('REQUIRED: a positive closing with LONGER words still reacts, not just short ones -- "that\'s fantastic!" is 17 chars but only 2 words, and must not fall through to a text reply the way a raw character cap would cause', () => {
  const result = single({ text: "that's fantastic!", wasLastSpeaker: true });
  assert.equal(result.type, "REACT");
  assert.equal(result.type === "REACT" && result.emoji, "😄");
});

test("a genuinely longer sentence that happens to mention a positive word mid-paragraph is NOT treated as a closing (word-count bound still applies)", () => {
  const result = single({ text: "that was a really great effort from the whole team honestly", wasLastSpeaker: true });
  assert.equal(result.type, "CASUAL_CHAT");
});

/* ---------------------------------------------- semantic closing detection ---- */
// Live bug: length/word-count is not a valid proxy for "does this message
// introduce a new conversational obligation." A moderator told a joke
// ("Why did the developer go broke? Because they used up all their cache.
// 😁"), the human replied "prettyaccurate too. lol" (3 words, 23 chars --
// over every length heuristic tried so far), and the moderator generated a
// full follow-up text reply ("glad it landed 😁") instead of reacting or
// staying silent. isAcknowledgementOnly() replaces length with a semantic
// check: strip agreement/approval/laughter/thanks/closing vocabulary +
// neutral filler, and see whether any real content is left.

test("REQUIRED (live bug repro): a long acknowledgement reacting to a moderator's joke resolves to SILENCE or REACT, never another generated reply", () => {
  const result = single({ text: "prettyaccurate too. lol", wasLastSpeaker: true, recentlyAnsweredByModerator: true });
  assert.notEqual(result.type, "CASUAL_CHAT");
  assert.notEqual(result.type, "ANSWER");
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled_recent_reply"]);
});

const LONG_TRIVIAL_ACKNOWLEDGEMENTS = [
  "prettyaccurate too. lol",
  "yeah lol that's actually pretty accurate",
  "haha okay fair enough, I get you now",
  "that makes sense, thanks for explaining",
  "alright, sounds good to me then",
  "yeah that's basically what I meant",
  "that's actually hilarious lol",
];

for (const text of LONG_TRIVIAL_ACKNOWLEDGEMENTS) {
  test(`REQUIRED: long acknowledgement "${text}" is not treated as substantive -- resolves to SILENCE, never a generated reply`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.notEqual(result.type, "CASUAL_CHAT");
    assert.notEqual(result.type, "ANSWER");
    assert.equal(result.type, "SILENCE");
  });
}

test("a long acknowledgement DIRECTED at the bot still resolves to REACT, not a generated reply", () => {
  const result = single({ text: "haha okay fair enough, I get you now", isDirectedAtBot: true });
  assert.equal(result.type, "REACT");
});

const ACKNOWLEDGEMENT_PLUS_NEW_CONTENT = [
  "yeah that's accurate, but the API is still failing",
  "okay got it, now I have another issue",
  "that's accurate, though production behaves differently",
];

for (const text of ACKNOWLEDGEMENT_PLUS_NEW_CONTENT) {
  test(`REQUIRED: acknowledgement + new statement "${text}" still gets a real reply (not swallowed as trivial)`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.equal(result.type, "CASUAL_CHAT");
  });
}

const ACKNOWLEDGEMENT_PLUS_NEW_QUESTION = [
  "fair enough, what should I change?",
  "makes sense, but why is Test not responding?",
  "lol yeah, also can you check the deployment?",
];

for (const text of ACKNOWLEDGEMENT_PLUS_NEW_QUESTION) {
  test(`REQUIRED: acknowledgement + new question "${text}" still routes to ANSWER (not swallowed as trivial)`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.equal(result.type, "ANSWER");
  });
}

test("REQUIRED (context-sensitive closing, pure acknowledgement half): \"yeah that makes sense now, thanks\" right after a moderator reply -> TRIVIAL/SILENCE", () => {
  const result = single({ text: "yeah that makes sense now, thanks", wasLastSpeaker: true, recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
});

test('REQUIRED (context-sensitive closing, acknowledgement + new problem half): "yeah that makes sense, but I\'m still getting a 500" -> SUBSTANTIVE/CASUAL_CHAT, not silenced', () => {
  const result = single({ text: "yeah that makes sense, but I'm still getting a 500", wasLastSpeaker: true, recentlyAnsweredByModerator: true });
  assert.equal(result.type, "CASUAL_CHAT");
});

/* --------------------------------- adversarial: single-token problem residue ---- */
// Explicit regression coverage for the exact critique: a single unrecognized
// residual token must NOT be assumed safe by tolerance alone -- "broken",
// "failed", "down", and "error" are precisely the kind of one-word residue
// that a bare "<=1 leftover token" rule would have waved through. These must
// all still get a real reply, never be swallowed as a closing.

const SINGLE_TOKEN_PROBLEM_REPORTS = [
  "yeah lol broken",
  "haha okay it's failed",
  "yeah lol down",
  "lol yeah error",
];

for (const text of SINGLE_TOKEN_PROBLEM_REPORTS) {
  test(`ADVERSARIAL: "${text}" carries ack-signal words (yeah/lol/haha/thanks) but a real one-word problem report -- must NOT be silenced`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.notEqual(result.type, "SILENCE");
    assert.notEqual(result.type, "REACT");
    assert.equal(result.type, "CASUAL_CHAT");
  });
}

test("ADVERSARIAL: a long, genuinely new statement that merely starts with an ack word is not swallowed just because it has plenty of ack/filler words sprinkled in", () => {
  const result = single({
    text: "yeah honestly we migrated the whole billing system to a new provider and rewrote the order pipeline overnight",
    wasLastSpeaker: true,
  });
  assert.equal(result.type, "CASUAL_CHAT");
});

test("ADVERSARIAL: a benign unclassifiable residual word (not a problem word, not decomposable) still classifies as a closing and reacts when directed at the bot", () => {
  const result = single({ text: "haha yeah fair point honestly", isDirectedAtBot: true });
  assert.equal(result.type, "REACT");
});

test('ADVERSARIAL: isKnownConcatenation does not falsely decompose a real problem word ("failure") that happens to start with letters shared by dictionary words ("fail")', () => {
  const result = single({ text: "yeah lol total failure", wasLastSpeaker: true });
  assert.equal(result.type, "CASUAL_CHAT");
});

/* -------------------------------------------- a short question is never trivial ---- */
// Live bug: "who else?" (2 words) was silenced with reason
// already_handled_recent_reply -- isTrivial()'s word-count/char-length check
// doesn't know or care that the message is a real question (it even strips
// the trailing "?" the same as "!"/"."), so it was classified TRIVIAL before
// ever reaching isLikelyQuestion. A message ending in "?" must always route
// to QUESTION/ANSWER, no matter how short.

test('REQUIRED (live bug repro): "who else?" right after a recent moderator reply -> ANSWER, not silenced as already-handled trivia', () => {
  const result = single({ text: "who else?", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "ANSWER");
});

test('a short question is ANSWERed even with no other signal at all (not swallowed by the 2-word trivial heuristic)', () => {
  const result = single({ text: "who else?" });
  assert.equal(result.type, "ANSWER");
});

test('REQUIRED: isPositiveClosing\'s word-count blind spot does not swallow a real question ("is this perfect?" must ANSWER, not REACT)', () => {
  const result = single({ text: "is this perfect?", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "ANSWER");
});

test('a short acknowledgement-shaped question ("makes sense?") still routes to ANSWER, not TRIVIAL', () => {
  const result = single({ text: "makes sense?" });
  assert.equal(result.type, "ANSWER");
});

/* ============================================================
   ARCHITECTURAL FIX: intent beats length structurally.
   classifyMessageKind now checks question/request intent (isLikelyQuestion)
   BEFORE any trivial/closing check runs at all -- isTrivial() (a raw
   word-count/char-count heuristic) has been REMOVED entirely, not patched
   with another special case. TRIVIAL is decided purely semantically now.
   ============================================================ */

/* -------------------------------------------- short questions, punctuated ---- */

const SHORT_QUESTIONS_PUNCTUATED = [
  "who else?", "why?", "how so?", "which one?", "what happened?",
  "anyone else?", "you sure?", "what now?", "can you?", "help me?",
  "where?", "when?",
];

for (const text of SHORT_QUESTIONS_PUNCTUATED) {
  test(`REQUIRED: short question "${text}" is never TRIVIAL -- routes to ANSWER`, () => {
    const result = single({ text });
    assert.notEqual(result.type, "SILENCE");
    assert.notEqual(result.type, "REACT");
    assert.notEqual(result.type, "SHORT_ACK");
    assert.equal(result.type, "ANSWER");
  });
}

/* ------------------------------------------ short questions, unpunctuated ---- */

const SHORT_QUESTIONS_UNPUNCTUATED = ["who else", "why though", "how so", "what happened", "anyone else"];

for (const text of SHORT_QUESTIONS_UNPUNCTUATED) {
  test(`REQUIRED: headless (no "?") short question "${text}" is never TRIVIAL -- routes to ANSWER`, () => {
    const result = single({ text });
    assert.equal(result.type, "ANSWER");
  });
}

/* ------------------------------------------------- misplaced "?" typo ---- */
// Live bug: "?just testing things up, what's up" (a stray "?" typed at the
// START, e.g. a fat-fingered mobile keyboard) has NO trailing "?" and its
// leading word is "?just" -- neither of isLikelyQuestion's two checks
// (endsWith("?"), leading-word regex) matched, so it fell through to
// isConversationalOpener's "what's up" greeting match, then got silenced
// via the COMMUNITY_OPENER "already_handled" suppression (a moderator had
// JUST replied) -- indistinguishable from being ignored entirely.

test('REQUIRED (live bug repro): a "?" typed at the START of the message still signals question intent', () => {
  const result = single({ text: "?just testing things up, what's up", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "ANSWER");
  assert.notEqual(result.type, "SILENCE");
});

test('"?" anywhere in the middle of the message also signals question intent, not only at the very end', () => {
  const result = single({ text: "wait what ? is that even right" });
  assert.equal(result.type, "ANSWER");
});

test('a message with NO "?" anywhere and no leading question word still correctly stays non-QUESTION (the fix is not "always treat everything as a question")', () => {
  const result = single({ text: "that's interesting" });
  assert.notEqual(result.type, "ANSWER");
});

/* --------------------------------------------------- directed short messages ---- */

test('REQUIRED: "kwan?" directed at Kwan -> ANSWER, not TRIVIAL/SHORT_ACK', () => {
  const result = single({ text: "kwan?", isDirectedAtBot: true });
  assert.equal(result.type, "ANSWER");
  assert.equal(result.type === "ANSWER" && result.deploymentId, DEPLOYMENT_A);
});

test('REQUIRED: "test?" directed at Test -> ANSWER, not TRIVIAL/SHORT_ACK', () => {
  const result = single({ text: "test?", isDirectedAtBot: true });
  assert.equal(result.type, "ANSWER");
  assert.equal(result.type === "ANSWER" && result.deploymentId, DEPLOYMENT_A);
});

test('resolveDirectedModerator still resolves a plain-name-plus-"?" message ("kwan?") to the right moderator', () => {
  const kwan: ModeratorIdentity = { deploymentId: "dep-kwan", name: "Kwan", botUsername: null };
  const test1: ModeratorIdentity = { deploymentId: "dep-test", name: "Test", botUsername: null };
  assert.deepEqual(resolveDirectedModerator("kwan?", [kwan, test1]), { deploymentId: "dep-kwan", isTypo: false });
  assert.deepEqual(resolveDirectedModerator("test?", [kwan, test1]), { deploymentId: "dep-test", isTypo: false });
});

/* -------------------------------------------------------------- trivial controls ---- */

const TRIVIAL_CONTROLS = ["lol", "nice", "cool", "okay", "got it", "thanks", "fair enough"];

for (const text of TRIVIAL_CONTROLS) {
  test(`REQUIRED: trivial control "${text}" remains SILENCE/REACT (never a generated reply)`, () => {
    const result = single({ text });
    assert.notEqual(result.type, "CASUAL_CHAT");
    assert.notEqual(result.type, "ANSWER");
  });
}

/* --------------------------------------------------- long acknowledgement controls ---- */

const LONG_ACK_CONTROLS = [
  "prettyaccurate too. lol",
  "yeah lol that's actually pretty accurate",
  "that makes sense, thanks for explaining",
  "haha okay fair enough, I get you now",
];

for (const text of LONG_ACK_CONTROLS) {
  test(`REQUIRED: long acknowledgement control "${text}" remains TRIVIAL (SILENCE/REACT, never a generated reply)`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.notEqual(result.type, "CASUAL_CHAT");
    assert.notEqual(result.type, "ANSWER");
  });
}

/* ----------------------------------------------------- acknowledgement + question ---- */

const ACK_PLUS_QUESTION = [
  "yeah makes sense, why?",
  "fair enough, what now?",
  "okay got it, but who else?",
  "lol yeah, how so?",
];

for (const text of ACK_PLUS_QUESTION) {
  test(`REQUIRED: acknowledgement + new question "${text}" must NOT be TRIVIAL -- routes to ANSWER`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.equal(result.type, "ANSWER");
  });
}

/* ------------------------------------------ acknowledgement + substantive continuation ---- */

const ACK_PLUS_SUBSTANTIVE = [
  "yeah that's accurate, but production is still broken",
  "makes sense, auth is failing now",
  "fair enough, I have another issue",
];

for (const text of ACK_PLUS_SUBSTANTIVE) {
  test(`REQUIRED: acknowledgement + substantive continuation "${text}" must NOT be TRIVIAL -- gets a real reply`, () => {
    const result = single({ text, wasLastSpeaker: true });
    assert.equal(result.type, "CASUAL_CHAT");
  });
}

/* --------------------------------------------------------- action-selection checks ---- */

test('REQUIRED (action-selection): "who else?" reaches the appropriate responder path, never SILENCE/REACT-only due to shortness', () => {
  const result = single({ text: "who else?", recentlyAnsweredByModerator: true });
  assert.equal(result.type, "ANSWER");
});

test('REQUIRED (action-selection): "prettyaccurate too. lol" resolves to REACT/SILENCE/SHORT_ACK, never CASUAL_CHAT/ANSWER', () => {
  const result = single({ text: "prettyaccurate too. lol", wasLastSpeaker: true, recentlyAnsweredByModerator: true });
  assert.notEqual(result.type, "CASUAL_CHAT");
  assert.notEqual(result.type, "ANSWER");
});

/* ================================== ambient-greeting model fallback ==========
   REQUIRED (live bug): "waddup guys" (phonetic slang, no "?", no directed
   name) silenced as low_social_priority -- no deterministic classifier can
   connect that spelling to "what's up". isAmbientOpenerFallbackCandidate /
   resolveAmbientOpenerFallback are the pure, gated entry points
   community-runtime.ts uses around the (separately tested, in
   chatter-generate.test.ts) model classification call. ================ */

test('REQUIRED: "waddup guys" is the exact residual bucket the fallback gate targets', () => {
  const result = single({ text: "waddup guys" });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["low_social_priority"]);
  assert.equal(isAmbientOpenerFallbackCandidate(result, "waddup guys"), true);
});

test("REQUIRED: the fallback gate only fires for the exact low_social_priority SILENCE, not other silence reasons", () => {
  const alreadyHandled = single({ text: "gm everyone", recentlyRespondedByHuman: true });
  assert.equal(isAmbientOpenerFallbackCandidate(alreadyHandled, "gm everyone"), false);

  const trivial = single({ text: "lol" });
  assert.equal(trivial.type, "SILENCE");
  assert.notDeepEqual(trivial.reasons, ["low_social_priority"]);
  assert.equal(isAmbientOpenerFallbackCandidate(trivial, "lol"), false);
});

test("REQUIRED: the fallback gate never fires on a non-SILENCE action", () => {
  const answered = single({ text: "who else?" });
  assert.equal(isAmbientOpenerFallbackCandidate(answered, "who else?"), false);
});

test("REQUIRED: the fallback gate is length-bounded -- a long ambient statement never qualifies, even if it happens to land in low_social_priority", () => {
  const longText = "well honestly this is just a fairly long ambient statement about something unrelated";
  const result = single({ text: longText });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["low_social_priority"]);
  assert.equal(isAmbientOpenerFallbackCandidate(result, longText), false);
});

test("REQUIRED: resolveAmbientOpenerFallback engages a candidate in a quiet room, mirroring COMMUNITY_OPENER handling", () => {
  const a = candidate(DEPLOYMENT_A);
  const result = resolveAmbientOpenerFallback({ text: "waddup guys", candidates: [a], now: new Date() });
  assert.equal(result.type, "CASUAL_CHAT");
  if (result.type === "CASUAL_CHAT") {
    assert.equal(result.deploymentId, DEPLOYMENT_A);
    assert.ok(result.reasons.includes("ambient_greeting_model_confirmed"));
  }
});

test("REQUIRED: resolveAmbientOpenerFallback respects the SAME already_handled suppression as a real COMMUNITY_OPENER", () => {
  const a = candidate(DEPLOYMENT_A);
  const result = resolveAmbientOpenerFallback({ text: "waddup guys", candidates: [a], now: new Date(), recentlyAnsweredByModerator: true });
  assert.equal(result.type, "SILENCE");
  assert.deepEqual(result.reasons, ["already_handled"]);
});

test("REQUIRED (end-to-end shape): the fallback path produces the exact same downstream action shape a deterministic COMMUNITY_OPENER would", () => {
  // Proves the fallback is a second-pass ENTRY into the existing handling,
  // not a new/parallel action category with different semantics.
  const a = candidate(DEPLOYMENT_A);
  const deterministic = single({ text: "gm guys" }); // a real, deterministic COMMUNITY_OPENER
  const fallback = resolveAmbientOpenerFallback({ text: "waddup guys", candidates: [a], now: new Date() });
  assert.equal(deterministic.type, fallback.type);
});
