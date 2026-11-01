import { test } from "node:test";
import assert from "node:assert/strict";
import { conversationSilenceReason } from "./conversation-intent";
import { selectChatterAction } from "./chatter-coordinator";

test("another person's DM request is not the watcher's conversation", () => {
  for (const text of ["Rhyleky check dm", "@Rhyleky can you check?", "hey Rhyleky, can you respond?", "check my inbox message"]) {
    assert.ok(conversationSilenceReason({ text, explicitlyDirected: false, otherParticipantNames: ["Rhyleky"] }), text);
  }
  assert.equal(conversationSilenceReason({ text: "Kwan can you help?", explicitlyDirected: true, replyToOtherParticipant: true }), null);
});

test("passive wishes stay silent even when the watcher was the last speaker", () => {
  for (const text of ["I would like to be able to see the tokens in my wallet one day", "I hope to see the tokens soon"]) {
    const action = selectChatterAction({ text, now: new Date(), candidates: [{ deploymentId: "watcher", isDirectedAtBot: false, wasLastSpeaker: true, recentlyParticipated: true, pacing: { lastSpokeAt: null, consecutiveMessages: 0 } }] });
    assert.equal(action.type, "SILENCE");
    assert.deepEqual(action.reasons, ["passive_wish_no_request"]);
  }
});

test("actual questions are not lost to the passive-wish gate", () => {
  for (const text of ["I'd like to know how to buy", "I want to see my tokens, can you help?", "How do I buy?", "What is the official website?"]) {
    assert.equal(conversationSilenceReason({ text, explicitlyDirected: false }), null, text);
  }
});

test("reply-to-human blocks questions too, not only greetings", () => {
  const action = selectChatterAction({ text: "Can you explain that?", replyToOtherParticipant: true, now: new Date(), candidates: [{ deploymentId: "watcher", isDirectedAtBot: false, wasLastSpeaker: true, recentlyParticipated: true, pacing: { lastSpokeAt: null, consecutiveMessages: 0 } }] });
  assert.equal(action.type, "SILENCE");
});
