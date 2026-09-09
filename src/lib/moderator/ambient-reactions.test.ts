import { test } from "node:test";
import assert from "node:assert/strict";
import { ambientReactionCandidate, ambientReactionBudgetMs, parseAmbientReaction, pickAmbientReactor, AMBIENT_REACTION_EMOJIS } from "./ambient-reactions";
import { personaReactionEmoji } from "./chatter-generate";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";
import { classifyAmbientReaction } from "./ambient-reaction-classify";
import { MANAGED_AI_ROUTING } from "@/src/lib/products/watch-runtime";

test("standalone congratulations qualify without any watcher participation, including human-to-human replies", () => {
  for (const text of ["Congratulations!", "Congratulations!!", "Congrats hera team 🎉👏", "Congratulations 🔥👌", "Congrats @hera_team"]) {
    for (const role of ["member", "admin"] as const) for (const reply of [false, true])
      assert.deepEqual(ambientReactionCandidate(text, role, reply), { kind: "direct", reaction: "applause" });
  }
});
test("no emoji acknowledgement of passive wishes, questions, commands, DM nudges or obvious harmful sentiment", () => {
  for (const text of ["I'd like to be able to see the tokens", "Congratulations but where are my tokens?", "/help", "Check your DM", "Congrats team we got hacked", "lol", "of course"]) {
    assert.equal(ambientReactionCandidate(text, "member", false), null, text);
  }
  assert.equal(ambientReactionCandidate("Congratulations", "unknown", false), null);
  for (const text of ["Congratulations on the launch!", "Congrats we are broke", "Congratulations on losing all our funds", "Congrats team buy now"])
    assert.deepEqual(ambientReactionCandidate(text, "member", false), { kind: "classify" }, "ambiguous praise needs semantic review, never automatic applause");
});

test("reaction budget accounts for time already spent in moderation", () => {
  assert.equal(ambientReactionBudgetMs(0), 8000);
  assert.equal(ambientReactionBudgetMs(20000), 5000);
  assert.equal(ambientReactionBudgetMs(26000), 0);
});
test("long admin progress updates get semantic review, not keyword-based celebration", () => {
  const text = "We received five error codes during testing. Progress is great, we're tired but in good spirits. Good night everyone.";
  assert.deepEqual(ambientReactionCandidate(text, "admin", false), { kind: "classify" });
  assert.equal(ambientReactionCandidate(text, "member", false), null);
  assert.equal(ambientReactionCandidate(text, "admin", true), null);
  assert.equal(ambientReactionCandidate("Great, we were hacked and all funds were stolen.", "admin", false), null);
});
test("semantic results require allowed labels, valid JSON and a verbatim supporting quote", () => {
  const text = "We are tired but in good spirits. Good night everyone.";
  assert.equal(parseAmbientReaction(JSON.stringify({ reaction: "support", quote: "tired but in good spirits" }), text), "support");
  for (const raw of ["❤️", "NONE", '{}', '{"reaction":"support","quote":"made up evidence"}', '{"reaction":"support","quote":"We"}', '{"reaction":"__proto__","quote":"Good night everyone."}', '{"reaction":"buy_now","quote":"Good night everyone."}']) assert.equal(parseAmbientReaction(raw, text), null);
});
test("all bots pick the same single reactor, with stable rotation across messages", () => {
  assert.equal(pickAmbientReactor("42", ["b", "a"]), pickAmbientReactor("42", ["a", "b", "a"]));
  assert.notEqual(pickAmbientReactor("42", ["a", "b"]), pickAmbientReactor("43", ["a", "b"]));
  assert.equal(pickAmbientReactor("42", []), null);
});
test("persona settings never turn selected warmth, applause, celebration or neutral acknowledgement into another intent", () => {
  for (const emoji of Object.values(AMBIENT_REACTION_EMOJIS)) for (const frequency of [0, 50, 100]) {
    assert.equal(personaReactionEmoji(emoji, { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: frequency }, () => 0.99), emoji);
  }
});
test("semantic reaction fails closed without a provider and never falls back to managed keys for missing BYO", async () => {
  const before = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    assert.equal(await classifyAmbientReaction("We are making good progress today.", MANAGED_AI_ROUTING), null);
    process.env.DEEPSEEK_API_KEY = "must-not-be-used";
    assert.equal(await classifyAmbientReaction("We are making good progress today.", { required: true, credential: null } as never), null);
  } finally { if (before === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = before; }
});
