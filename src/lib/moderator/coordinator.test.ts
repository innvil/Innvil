import { test } from "node:test";
import assert from "node:assert/strict";
import { decideBotAcknowledgement, type EligibleTarget } from "./coordinator";
import type { CommunityEvent } from "./event-types";

function baseEvent(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    panelId: "panel-1",
    communityId: "community-1",
    integrationId: "integration-mika",
    messageId: "msg-100",
    sender: {
      platformUserId: "111",
      isBot: true,
      senderType: "INNVIL_MODERATOR",
      displayName: "Mika",
      innvilModeratorId: "mod-mika",
      deploymentId: "deploy-mika",
    },
    timestamp: new Date().toISOString(),
    text: "Good morning everyone 👋",
    replyToMessageId: null,
    origin: "HUMAN",
    interactionDepth: 0,
    causationMessageId: null,
    ...overrides,
  };
}

function kaleb(overrides: Partial<EligibleTarget> = {}): EligibleTarget {
  return { deploymentId: "deploy-kaleb", displayName: "Kaleb", lastBotAckAt: null, botAcksToday: 0, botAcksDay: null, ...overrides };
}

const ALWAYS_ACK = () => 0.01; // below ACK_PROBABILITY, chooses index 0, prefers REACT

test("Case 7: Mika message + one eligible target (Kaleb) -> exactly one acknowledgement action, targeting Kaleb", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.notEqual(action.kind, "IGNORE");
  if (action.kind !== "IGNORE") assert.equal(action.targetDeploymentId, "deploy-kaleb");
});

test("Case 8: event.origin BOT_ACK -> hard IGNORE regardless of everything else (loop terminates)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK, // even with an RNG that would otherwise always acknowledge
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("interactionDepth at MAX_BOT_INTERACTION_DEPTH -> IGNORE (loop prevention)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ interactionDepth: 1 }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("sender is not INNVIL_MODERATOR -> IGNORE regardless of mode/targets (defensive hard gate)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ sender: { ...baseEvent().sender, senderType: "EXTERNAL_BOT" } }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("Case 10: target rate-limited by daily cap -> IGNORE, no acknowledgement produced", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb({ botAcksToday: 5, botAcksDay: new Date().toISOString().slice(0, 10) })],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("Case 10: target rate-limited by minimum gap since last ack -> IGNORE", () => {
  const now = new Date();
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb({ lastBotAckAt: new Date(now.getTime() - 60_000).toISOString() })], // 1 min ago, under the 10 min gap
    now,
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("target's rate-limit resets on a new day (bot_acks_day differs from today)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb({ botAcksToday: 5, botAcksDay: "2000-01-01" })], // capped, but for a past day
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.notEqual(action.kind, "IGNORE");
});

test("Case 11: reactions_only mode always produces REACT, never SEND_TEXT", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "reactions_only",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.equal(action.kind, "REACT");
});

test("botAckMode off -> IGNORE even with eligible targets and favorable RNG", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "off",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("no eligible targets -> IGNORE", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

// UPDATED: this test's fixture used to reuse baseEvent()'s default opener
// text ("Good morning everyone 👋"). Openers are now a deterministic,
// probability-EXEMPT path (see the "opening acknowledgement" suite below) --
// reusing it here would no longer prove what this test is actually about
// (ordinary, NON-opening bot chatter still being probability-gated). Text
// changed to genuine non-opening chatter; the probability-gate behavior
// itself is unchanged for that case.
test("probability gate: an RNG that never favors acknowledgement -> IGNORE for ORDINARY (non-opening) bot chatter ('occasional', not every message)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "yeah that tracks, makes sense to me" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.99, // above ACK_PROBABILITY
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

/* ============================================ deterministic opening acknowledgement ====
   An eligible OPENING statement ("gm", "hello", "hey everyone", ...) from one
   Innvil moderator to another is ALWAYS acknowledged -- no probability roll.
   Ordinary/non-opening bot-to-bot chatter is UNCHANGED (still probability-
   gated, see the updated "probability gate" test above). */

test("REQUIRED (TEST 1/2): an eligible opening statement is acknowledged even with an RNG that would normally reject an optional acknowledgement", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "Good morning everyone 👋" }), // a genuine opener
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.99, // above ACK_PROBABILITY -- would reject a NON-opener (see the updated test above)
  });
  assert.notEqual(action.kind, "IGNORE");
});

test("REQUIRED: the opener bypass generalizes beyond one literal phrase (semantic classifier, not a hardcoded string)", () => {
  for (const text of ["gm", "hello", "hey everyone", "morning fam", "what's up", "evening guys"]) {
    const action = decideBotAcknowledgement({
      event: baseEvent({ text }),
      botAckMode: "acknowledgements",
      eligibleTargets: [kaleb()],
      now: new Date(),
      random: () => 0.99,
    });
    assert.notEqual(action.kind, "IGNORE", `expected an opener acknowledgement for: "${text}"`);
  }
});

test("REQUIRED: every OTHER hard gate still fully applies to an opener -- BOT_ACK origin still forces IGNORE even for opener text", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "gm everyone", origin: "BOT_ACK" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.99,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("REQUIRED (TEST 6, no recursion): an opener's OWN acknowledgement reply is tagged origin=BOT_ACK -- feeding that back in must not force a second acknowledgement", () => {
  // Simulates the acknowledgement reply itself being re-observed (Telegram
  // delivers every bot's messages to every other bot's webhook) -- origin is
  // BOT_ACK for that re-observation, which is an unconditional IGNORE gate
  // regardless of opener classification or RNG.
  const ackReplyReobserved = baseEvent({ text: "Morning Kwan 👋", origin: "BOT_ACK", interactionDepth: 1 });
  const action = decideBotAcknowledgement({
    event: ackReplyReobserved,
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.01,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("botAckMode off still IGNOREs an opener -- the opener bypass only removes the probability roll, not the other gates", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "gm everyone" }),
    botAckMode: "off",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.01,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("a rate-limited target still means an opener IGNOREs -- the bypass only removes the probability roll, not rate limiting", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "gm everyone" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb({ botAcksToday: 5, botAcksDay: new Date().toISOString().slice(0, 10) })],
    now: new Date(),
    random: () => 0.01,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("REQUIRED (TEST 9): with multiple eligible receiving deployments, an opener still selects exactly ONE -- never all of them", () => {
  const targets: EligibleTarget[] = [kaleb(), { deploymentId: "deploy-alice", displayName: "Alice", lastBotAckAt: null, botAcksToday: 0, botAcksDay: null }];
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "gm everyone" }),
    botAckMode: "acknowledgements",
    eligibleTargets: targets,
    now: new Date(),
    random: () => 0.99, // would reject a non-opener, must not matter for an opener
  });
  assert.notEqual(action.kind, "IGNORE");
  // The action union structurally carries exactly one targetDeploymentId --
  // there is no shape in which more than one deployment could be told to act.
  if (action.kind !== "IGNORE") assert.ok(["deploy-kaleb", "deploy-alice"].includes(action.targetDeploymentId));
});

/* -------------------------------------------------------- name safety (craftAckText) ---- */
// The name passed in here must already be safe (resolved upstream in
// community-runtime.ts's classifySender -- see its own tests for the actual
// username-vs-configured-name resolution). These tests prove the template
// layer itself never introduces a leak and degrades safely when no name is
// available, regardless of what upstream provides.

test("REQUIRED (TEST 3): a SEND_TEXT opener acknowledgement uses the given human-facing name", () => {
  let call = 0;
  // Openers skip the probability-gate random() call entirely (short-
  // circuited) -- only 2 calls remain: pick target 0, then land above
  // REACT_PREFERENCE -> SEND_TEXT.
  const seq = [0.0, 0.99];
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "gm everyone", sender: { ...baseEvent().sender, displayName: "Kwan" } }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => seq[Math.min(call++, seq.length - 1)],
  });
  assert.equal(action.kind, "SEND_TEXT");
  if (action.kind === "SEND_TEXT") {
    assert.match(action.text, /\bKwan\b/);
  }
});

test("REQUIRED (TEST 4): the acknowledgement text never contains a Telegram-handle-shaped string, even if one were passed as the name", () => {
  let call = 0;
  const seq = [0.0, 0.99]; // openers skip the probability-gate call -- see TEST 3
  // Defensive: even if something upstream ever regressed and passed the raw
  // username through, prove what that would look like is never produced for
  // the SAFE input this coordinator is actually given ("Kwan", not
  // "kwan_mod_bot" or "@kwan_mod_bot") -- the real leak-prevention guarantee
  // lives in classifySender's resolution (community-runtime.test.ts).
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "hello", sender: { ...baseEvent().sender, displayName: "Kwan" } }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => seq[Math.min(call++, seq.length - 1)],
  });
  if (action.kind === "SEND_TEXT") {
    assert.doesNotMatch(action.text, /@\w+_bot\b/i);
    assert.doesNotMatch(action.text, /kwan_mod_bot/i);
  }
});

test("REQUIRED (TEST 5): a null sender name (safe upstream fallback) never produces a username-shaped acknowledgement -- uses the name-free template pool", () => {
  let call = 0;
  const seq = [0.0, 0.99]; // openers skip the probability-gate call -- see TEST 3
  const action = decideBotAcknowledgement({
    event: baseEvent({ text: "hello", sender: { ...baseEvent().sender, displayName: null } }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => seq[Math.min(call++, seq.length - 1)],
  });
  assert.equal(action.kind, "SEND_TEXT");
  if (action.kind === "SEND_TEXT") {
    assert.doesNotMatch(action.text, /@/);
    assert.ok(["Got it 👍", "Yep.", "On it.", "Hey 👋"].includes(action.text));
  }
});

test("a produced SEND_TEXT acknowledgement is tagged origin=BOT_ACK with interactionDepth incremented by exactly 1", () => {
  // Force a SEND_TEXT deterministically: pass the probability gate, pick
  // target index 0, then land above REACT_PREFERENCE so REACT isn't chosen.
  // Explicit NON-opener text -- openers now skip the probability-gate
  // random() call entirely (see the opener suite above), which would shift
  // this 3-call sequence; kept as ordinary bot chatter so this test still
  // exercises the general (non-opener) SEND_TEXT/tagging path it's about.
  let call = 0;
  const seq = [0.01, 0.0, 0.99];
  const forced = decideBotAcknowledgement({
    event: baseEvent({ text: "yeah for sure, appreciate it", interactionDepth: 0 }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => seq[Math.min(call++, seq.length - 1)],
  });
  assert.equal(forced.kind, "SEND_TEXT");
  if (forced.kind === "SEND_TEXT") {
    assert.equal(forced.origin, "BOT_ACK");
    assert.equal(forced.interactionDepth, 1);
    assert.equal(forced.causationMessageId, "msg-100");
  }
});
