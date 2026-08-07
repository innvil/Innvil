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

test("probability gate: an RNG that never favors acknowledgement -> IGNORE ('occasional', not every message)", () => {
  const action = decideBotAcknowledgement({
    event: baseEvent(),
    botAckMode: "acknowledgements",
    eligibleTargets: [kaleb()],
    now: new Date(),
    random: () => 0.99, // above ACK_PROBABILITY
  });
  assert.deepEqual(action, { kind: "IGNORE" });
});

test("a produced SEND_TEXT acknowledgement is tagged origin=BOT_ACK with interactionDepth incremented by exactly 1", () => {
  // Force a SEND_TEXT deterministically: pass the probability gate, pick
  // target index 0, then land above REACT_PREFERENCE so REACT isn't chosen.
  let call = 0;
  const seq = [0.01, 0.0, 0.99];
  const forced = decideBotAcknowledgement({
    event: baseEvent({ interactionDepth: 0 }),
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
