import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables, type GenerateChatterReplyInput, type ChatterContextMessage } from "./chatter-generate";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import { resolvePersonaPreset, personaFromPreset } from "./presets";

const { buildSystemPrompt, buildContextLines, personaStyle, personaIdentityLine } = __testables;

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

/* ------------------------------------------------------ persona identity ---- */
// Live bug: "hey test, can you tell what persona are you?" got "just a
// regular mod persona here... nothing fancier than that" instead of a real
// persona answer -- the moderator collapsed persona questions into generic
// AI/mod identity. Root cause: the prompt had writing-STYLE mechanics
// (personaStyle: capitalization, slang, emoji frequency) but no first-person-
// usable self-DESCRIPTION, and no rule distinguishing a persona question from
// an AI-identity question -- so the model fell back to the only self-
// referential guidance it had (the AI-honesty rule) for both.

const TEST_PERSONA: ModeratorPersona = {
  ...DEFAULT_MODERATOR_PERSONA,
  description: "laid-back, friendly, concise, slightly witty",
};

const KWAN_PERSONA: ModeratorPersona = {
  ...DEFAULT_MODERATOR_PERSONA,
  description: "formal, calm, thoughtful",
};

test("REQUIRED: a configured persona description is surfaced verbatim as the authoritative persona answer", () => {
  const line = personaIdentityLine(baseInput({ persona: TEST_PERSONA }));
  assert.match(line, /laid-back, friendly, concise, slightly witty/);
  assert.match(line, /authoritative answer/i);
});

test("REQUIRED: prompt explicitly instructs answering persona questions from the configured persona, not as an AI-identity question", () => {
  const prompt = buildSystemPrompt(baseInput({ moderatorName: "Test", persona: TEST_PERSONA }));
  assert.match(prompt, /laid-back, friendly, concise, slightly witty/);
  assert.match(prompt, /different question from asking whether you're AI/i);
  assert.match(prompt, /do not reinterpret a persona question as an AI-identity question/i);
});

test("REQUIRED: prompt forbids denying/flattening a configured persona", () => {
  const prompt = buildSystemPrompt(baseInput({ persona: TEST_PERSONA }));
  assert.match(prompt, /never say things like "just an ai", "no special persona", "just a regular mod"/i);
});

test("REQUIRED: AI-identity rule requires re-anchoring to name + persona, not replacing it", () => {
  const prompt = buildSystemPrompt(baseInput({ moderatorName: "Test", persona: TEST_PERSONA }));
  assert.match(prompt, /re-anchor to your name and configured persona/i);
  assert.match(prompt, /never let it replace or erase your persona identity/i);
});

test("REQUIRED: persona is the PRIMARY identity, AI-ness explicitly secondary", () => {
  const prompt = buildSystemPrompt(baseInput({ persona: TEST_PERSONA }));
  assert.match(prompt, /your persona is your PRIMARY identity; AI-ness is secondary/i);
});

test("REQUIRED: separate moderators -- Test only receives Test's persona, Kwan only receives Kwan's, no cross-contamination", () => {
  const testPrompt = buildSystemPrompt(baseInput({ moderatorName: "Test", persona: TEST_PERSONA }));
  const kwanPrompt = buildSystemPrompt(baseInput({ moderatorName: "Kwan", persona: KWAN_PERSONA }));
  assert.match(testPrompt, /laid-back, friendly, concise, slightly witty/);
  assert.doesNotMatch(testPrompt, /formal, calm, thoughtful/);
  assert.match(kwanPrompt, /formal, calm, thoughtful/);
  assert.doesNotMatch(kwanPrompt, /laid-back, friendly, concise, slightly witty/);
});

test("REQUIRED: missing/unconfigured persona -- does not fabricate one, answers neutrally from name/role instead", () => {
  const line = personaIdentityLine(baseInput({ persona: DEFAULT_MODERATOR_PERSONA }));
  assert.match(line, /No specific persona description has been configured/i);
  assert.match(line, /rather than inventing detailed personality traits/i);
  assert.doesNotMatch(line, /laid-back|formal, calm, thoughtful/);
});

test("REQUIRED: missing persona is grounded in the prompt too (not silently dropped)", () => {
  const prompt = buildSystemPrompt(baseInput({ persona: DEFAULT_MODERATOR_PERSONA }));
  assert.match(prompt, /No specific persona description has been configured/i);
});

/* ------------------------------------------------------ persona presets ---- */
// Requirements from the preset-picker feature: a moderator created with a
// preset receives that preset's persona in generation, two moderators with
// different presets stay isolated, and an existing moderator with no preset
// (persona.presetId === null) keeps working exactly as before.

test("REQUIRED: a moderator with a preset applied receives that preset's persona in generation (description + style + behavior notes)", () => {
  const preset = resolvePersonaPreset("technical_expert")!;
  const persona = personaFromPreset(preset);
  const prompt = buildSystemPrompt(baseInput({ moderatorName: "Kwan", persona }));
  assert.match(prompt, /precise, analytical, and detail-oriented/i); // description
  assert.match(prompt, /be precise and analytical/i); // customInstructions
  assert.match(prompt, /avoid slang — keep language plain and standard/i); // slang: 5 -> style mechanics
});

test("REQUIRED: two-moderator isolation with presets -- Kwan (Calm Professional) and Test (Chill & Casual) never receive each other's persona as authoritative style", () => {
  const kwanPersona = personaFromPreset(resolvePersonaPreset("calm_professional")!);
  const testPersona = personaFromPreset(resolvePersonaPreset("chill_casual")!);

  const kwanPrompt = buildSystemPrompt(baseInput({ moderatorName: "Kwan", persona: kwanPersona }));
  const testPrompt = buildSystemPrompt(baseInput({ moderatorName: "Test", persona: testPersona }));

  assert.match(kwanPrompt, /composed, clear, and respectful/i);
  assert.doesNotMatch(kwanPrompt, /relaxed and informal/i);
  assert.match(testPrompt, /relaxed and informal/i);
  assert.doesNotMatch(testPrompt, /composed, clear, and respectful/i);

  // Style mechanics also stay isolated: Calm Professional is high-formality
  // (capitalized), Chill & Casual is low-formality (lowercase).
  assert.match(kwanPrompt, /always capitalize the start/i);
  assert.doesNotMatch(kwanPrompt, /always write in lowercase/i);
  assert.match(testPrompt, /always write in lowercase/i);
  assert.doesNotMatch(testPrompt, /always capitalize the start/i);
});

test("REQUIRED: shared conversation transcript never overrides the selected moderator's own preset persona (Kwan speaking after a transcript full of Test's casual messages still uses Kwan's formal preset)", () => {
  const kwanPersona = personaFromPreset(resolvePersonaPreset("calm_professional")!);
  const context: ChatterContextMessage[] = [
    { senderType: "INNVIL_MODERATOR", senderName: "Test", text: "yeah lol nah that's fine", deploymentId: "dep-test" },
    { senderType: "INNVIL_MODERATOR", senderName: "Test", text: "np, all good haha", deploymentId: "dep-test" },
  ];
  const prompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-kwan", moderatorName: "Kwan", persona: kwanPersona, recentContext: context }));
  assert.match(prompt, /always capitalize the start/i); // Kwan's own preset, not Test's casual style
  assert.doesNotMatch(prompt, /always write in lowercase/i);
});

test("REQUIRED: an existing moderator with no preset (presetId null) keeps working exactly as before", () => {
  assert.equal(DEFAULT_MODERATOR_PERSONA.presetId, null);
  const prompt = buildSystemPrompt(baseInput({ persona: DEFAULT_MODERATOR_PERSONA }));
  // Falls back to the same neutral "nothing configured" persona line as
  // before presets existed -- unaffected by the new preset catalog.
  assert.match(prompt, /No specific persona description has been configured/i);
});
