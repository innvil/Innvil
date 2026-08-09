import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables, type GenerateChatterReplyInput, type ChatterContextMessage } from "./chatter-generate";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";

const { buildSystemPrompt, buildContextLines, personaStyle } = __testables;

/**
 * These test the PROMPT/DATA ASSEMBLY directly (per the user's explicit
 * request) rather than live model output — asserting on the actual strings
 * fed to the model, which is deterministic and doesn't depend on Sonnet's
 * probabilistic generation.
 */

const FORMAL_MODERATOR_A: ModeratorPersona = {
  ...DEFAULT_MODERATOR_PERSONA,
  formality: 90,
  slang: 5,
  teasing: 5,
  chattiness: 30,
};

const CASUAL_MODERATOR_B: ModeratorPersona = {
  ...DEFAULT_MODERATOR_PERSONA,
  formality: 10,
  slang: 85,
  teasing: 70,
  chattiness: 80,
};

function baseInput(over: Partial<GenerateChatterReplyInput> = {}): GenerateChatterReplyInput {
  return {
    action: "CASUAL_CHAT",
    selfDeploymentId: "dep-a",
    moderatorName: "Alex",
    persona: DEFAULT_MODERATOR_PERSONA,
    recentContext: [],
    triggerMessage: { senderName: "K", text: "hey" },
    isDirectedAtBot: false,
    addressedWithTypo: false,
    otherActiveModeratorNames: [],
    ...over,
  };
}

/* ------------------------------------------------------- persona isolation ---- */

test("REQUIRED: the selected moderator's OWN persona is present and authoritative in its prompt", () => {
  const prompt = buildSystemPrompt(baseInput({ moderatorName: "Alex", persona: FORMAL_MODERATOR_A }));
  assert.match(prompt, /always capitalize the start/i);
  assert.match(prompt, /Avoid slang/i);
});

test("REQUIRED: a different moderator's persona traits are NOT injected as the current speaker's persona", () => {
  const promptForA = buildSystemPrompt(baseInput({ moderatorName: "Alex", persona: FORMAL_MODERATOR_A }));
  // B's traits (heavy slang, very casual, heavy teasing) must not appear as
  // instructions for A, who is formal/low-slang/low-teasing.
  assert.doesNotMatch(promptForA, /Slang and internet-speak are welcome/i);
  assert.doesNotMatch(promptForA, /playful teasing\/ribbing is fine/i);
  assert.doesNotMatch(promptForA, /always write in lowercase/i);
});

test("REQUIRED: prompt contains an explicit anti-imitation / persona-isolation rule", () => {
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /conversational context only/i);
  assert.match(prompt, /do not imitate their voice/i);
  assert.match(prompt, /not their capitalization, punctuation habits, slang, phrasing, or temperament/i);
});

test("REQUIRED: other moderators' messages are clearly labeled with identity (not-you), the speaker's own past messages are labeled (you)", () => {
  const context: ChatterContextMessage[] = [
    { senderType: "HUMAN", senderName: "K", text: "hows everyone" },
    { senderType: "INNVIL_MODERATOR", senderName: "Bella", text: "lowercase reply here", deploymentId: "dep-b" },
    { senderType: "INNVIL_MODERATOR", senderName: "Alex", text: "Proper reply here.", deploymentId: "dep-a" },
  ];
  const lines = buildContextLines(baseInput({ selfDeploymentId: "dep-a", recentContext: context }));
  assert.match(lines, /Bella \(a different moderator, not you\): lowercase reply here/);
  assert.match(lines, /Alex \(you\): Proper reply here\./);
});

test("reversed: generating for Bella (casual persona) does not copy Alex's formal style, and Alex's messages are labeled not-you", () => {
  const context: ChatterContextMessage[] = [
    { senderType: "INNVIL_MODERATOR", senderName: "Alex", text: "Good afternoon, everyone.", deploymentId: "dep-a" },
    { senderType: "INNVIL_MODERATOR", senderName: "Alex", text: "How may I be of assistance?", deploymentId: "dep-a" },
  ];
  const promptForB = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-b", moderatorName: "Bella", persona: CASUAL_MODERATOR_B, recentContext: context }));
  const lines = buildContextLines(baseInput({ selfDeploymentId: "dep-b", recentContext: context }));
  // B's own prompt still reflects B's configured casual voice, not A's formal one.
  assert.match(promptForB, /always write in lowercase/i);
  assert.doesNotMatch(promptForB, /always capitalize the start/i);
  // Both of A's lines are labeled as a different moderator, never "(you)" for B.
  assert.match(lines, /Alex \(a different moderator, not you\): Good afternoon, everyone\./);
  assert.match(lines, /Alex \(a different moderator, not you\): How may I be of assistance\?/);
  assert.doesNotMatch(lines, /Alex \(you\)/);
});

test("personaStyle: formality/slang/teasing are actually read from the persona (previously silently ignored)", () => {
  assert.ok(personaStyle(FORMAL_MODERATOR_A).some((s) => /always capitalize the start/i.test(s)));
  assert.ok(personaStyle(CASUAL_MODERATOR_B).some((s) => /always write in lowercase/i.test(s)));
  assert.ok(personaStyle(CASUAL_MODERATOR_B).some((s) => /Slang and internet-speak are welcome/i.test(s)));
  assert.ok(personaStyle(CASUAL_MODERATOR_B).some((s) => /playful teasing\/ribbing is fine/i.test(s)));
});

test("REQUIRED: prompt forbids drifting writing style over a conversation or in response to being asked about tone", () => {
  // Live bug: Kwan's capitalization flipped from initial-caps to all-lowercase
  // right after a human asked "why are you so formal though, kwan?" -- the
  // model was treating the question as an instruction to change its style.
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /is FIXED by your configuration above and must stay consistent/i);
  assert.match(prompt, /does not change just because a human comments on it or asks about it/i);
  assert.match(prompt, /do not actually shift your tone\/casing in response to being asked about it/i);
});

/* ------------------------------------------------------- history grounding ---- */

test("REQUIRED: prompt forbids inventing explanations for silence or another moderator's actions", () => {
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /Never invent claims about the conversation history/i);
  assert.match(prompt, /don't make up a reason why you were silent/i);
  assert.match(prompt, /don't claim to know what another moderator was doing/i);
});

test("REQUIRED: prompt instructs a neutral fallback instead of a fabricated explanation when asked why it didn't respond", () => {
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /give a brief, honest, neutral reply/i);
});

/* --------------------------------------------------- presence grounding ---- */

test("no other moderators active -> prompt states that plainly, doesn't imply others might exist", () => {
  const prompt = buildSystemPrompt(baseInput({ otherActiveModeratorNames: [] }));
  assert.match(prompt, /you're the only one/i);
});

test("other moderators active -> prompt lists them by the REAL current names, nothing invented", () => {
  const prompt = buildSystemPrompt(baseInput({ otherActiveModeratorNames: ["Kwan", "Test"] }));
  assert.match(prompt, /Kwan, Test/);
});

/* ----------------------------------------------------------------- typo hint ---- */

test("typo hint appears only when addressedWithTypo is true", () => {
  const withTypo = buildSystemPrompt(baseInput({ addressedWithTypo: true }));
  const withoutTypo = buildSystemPrompt(baseInput({ addressedWithTypo: false }));
  assert.match(withTypo, /slight misspelling of your name/i);
  assert.doesNotMatch(withoutTypo, /slight misspelling of your name/i);
});

/* ---------------------------------------------------------- support-tone rule ---- */

test("prompt still bans generic support-chat closers (regression from the earlier fix)", () => {
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /anything else on your mind/i);
  assert.match(prompt, /do not manufacture a follow-up question/i);
});
