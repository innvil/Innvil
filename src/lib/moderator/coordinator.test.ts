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
    messageThreadId: null,
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

test('Case 8: event.origin BOT_ACK under "acknowledgements" mode -> hard IGNORE (stops at depth 1, no escalation to a handoff)', () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK, // even with an RNG that would otherwise always acknowledge
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test('event.origin BOT_ACK under "reactions_only" mode -> also hard IGNORE (only "role_handoffs" ever escalates)', () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK" }),
    botAckMode: "reactions_only",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_ACK,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("interactionDepth at MAX_BOT_HANDOFF_DEPTH (2) -> IGNORE regardless of origin/mode (hard chain-length ceiling)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 2 }),
    botAckMode: "role_handoffs",
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

/* ============================================ COMMUNITY_HANDOFF (spec tests) ==== */
// bot-ack-social-behavior-spec.md -- a depth-1 (origin BOT_ACK) event under
// "role_handoffs" mode may produce AT MOST one COMMUNITY_HANDOFF, addressed
// to the room, never another plain acknowledgement.

const ALWAYS_HANDOFF = () => 0.01; // below HANDOFF_PROBABILITY, picks target index 0

test("REQUIRED (spec TEST 1 shape): a depth-1 BOT_ACK event under role_handoffs mode MAY produce a COMMUNITY_HANDOFF", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?" }),
    botAckMode: "role_handoffs",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_HANDOFF,
  });
  assert.equal(action.kind, "COMMUNITY_HANDOFF");
  if (action.kind === "COMMUNITY_HANDOFF") {
    assert.equal(action.interactionDepth, 2);
    assert.equal(action.targetDeploymentId, "deploy-kaleb");
    assert.equal(action.causationMessageId, "msg-100");
  }
});

test("REQUIRED (spec §4): a COMMUNITY_HANDOFF is never addressed to the other moderator by name", () => {
  for (let i = 0; i < 20; i++) {
    const action = decideBotAcknowledgement({
      event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?" }),
      botAckMode: "role_handoffs",
      eligibleTargets: [kaleb()],
      now: new Date(),
      random: () => (i % 2 === 0 ? 0.01 : 0.3),
    });
    if (action.kind === "COMMUNITY_HANDOFF") {
      assert.doesNotMatch(action.text, /kaleb|mika/i);
      assert.doesNotMatch(action.text, /@/);
    }
  }
});

test("REQUIRED (spec TEST 2): a COMMUNITY_HANDOFF-origin event always IGNOREs -- no bot may ever respond to one", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "COMMUNITY_HANDOFF", interactionDepth: 2, text: "never better — anyone here got anything new?" }),
    botAckMode: "role_handoffs",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_HANDOFF, // even with an RNG that would otherwise always fire
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("REQUIRED (spec TEST 4): a bare closing acknowledgement (\"nice one\") does not force a handoff", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "nice one" }),
    botAckMode: "role_handoffs",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_HANDOFF,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("REQUIRED (spec TEST 5): a handoff is not mandatory even when eligible -- silence remains a valid outcome", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?" }),
    botAckMode: "role_handoffs",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.99, // above HANDOFF_PROBABILITY
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test('"acknowledgements" mode never escalates to a handoff, even for an open-ended depth-1 exchange', () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?" }),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_HANDOFF,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("a depth-1 handoff still respects target rate limits (no eligible/available target -> IGNORE)", () => {
  const rateLimited = kaleb({ botAcksToday: 5, botAcksDay: new Date().toISOString().slice(0, 10) }); // DAILY_CAP
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?" }),
    botAckMode: "role_handoffs",
    eligibleTargets: [rateLimited],
    now: new Date(),
    random: ALWAYS_HANDOFF,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("a depth-1 handoff still requires senderType INNVIL_MODERATOR (external bots never get this treatment)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent({ origin: "BOT_ACK", interactionDepth: 1, text: "good, you?", sender: { platformUserId: "999", isBot: true, senderType: "EXTERNAL_BOT", displayName: "OtherBot" } }),
    botAckMode: "role_handoffs",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: ALWAYS_HANDOFF,
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});
