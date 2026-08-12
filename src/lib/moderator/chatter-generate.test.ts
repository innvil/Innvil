import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables, shortAckText, classifyAmbientGreeting, personaReactionEmoji, type GenerateChatterReplyInput, type ChatterContextMessage } from "./chatter-generate";
import { requiresIndividualContribution } from "./chatter-coordinator";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import { resolvePersonaPreset, personaFromPreset } from "./presets";

const { buildSystemPrompt, buildContextLines, personaStyle, personaIdentityLine, obligationContextLines, collabContactLine, projectKnowledgeContextLines } = __testables;

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

test("REQUIRED: prompt forbids inventing a stronger accusation/emotion/motive than the human actually expressed (live bug: fabricated 'impersonation' framing)", () => {
  const prompt = buildSystemPrompt(baseInput());
  assert.match(prompt, /do not invent a stronger accusation, emotion, criticism, motive, or premise/i);
  assert.match(prompt, /is NOT an accusation of impersonation/i);
});

test("REQUIRED: prompt hardcodes a ban on sliding into generic AI customer-support mode, for BOTH actions", () => {
  const casual = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT" }));
  const answer = buildSystemPrompt(baseInput({ action: "ANSWER" }));
  for (const prompt of [casual, answer]) {
    assert.match(prompt, /do not turn into a generic ai customer-support assistant/i);
    assert.match(prompt, /this applies to every reply, not just casual chatter/i);
  }
});

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

/* ------------------------------------------------- task-based model routing ---- */
// resolveChatterRoute() is the ONLY place that decides provider/model for
// chatter generation. It must key strictly on action.type (never text), never
// let CASUAL_CHAT silently escalate to Sonnet on DeepSeek failure, and never
// change what persona/prompt content gets sent (see the provider-independence
// test below).

const { resolveChatterRoute } = __testables;

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("REQUIRED: ANSWER routes to Sonnet 5 at effort medium, never DeepSeek -- even when DeepSeek is configured", () => {
  withEnv({ AI_MODEL: undefined, DEEPSEEK_API_KEY: "sk-deepseek-test" }, () => {
    const route = resolveChatterRoute("ANSWER");
    assert.equal(route.ok, true);
    if (route.ok) {
      assert.equal(route.model, "claude-sonnet-5");
      assert.equal(route.effort, "medium");
      assert.equal(route.providerOverride, undefined);
      assert.equal(route.automation, "NATURAL_CHATTER_ANSWER");
    }
  });
});

test("REQUIRED: CASUAL_CHAT routes to DeepSeek v4 Flash in non-thinking mode, never Sonnet", () => {
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: undefined, DEEPSEEK_BASE_URL: undefined }, () => {
    const route = resolveChatterRoute("CASUAL_CHAT");
    assert.equal(route.ok, true);
    if (route.ok) {
      assert.equal(route.model, "deepseek-v4-flash");
      assert.notEqual(route.model, "claude-sonnet-5");
      assert.equal(route.disableThinking, true);
      assert.equal(route.automation, "NATURAL_CHATTER_CASUAL");
      assert.ok(route.providerOverride);
      assert.equal(route.providerOverride?.provider, "openai");
      assert.equal(route.providerOverride?.apiKey, "sk-deepseek-test");
      assert.equal(route.providerOverride?.baseUrl, "https://api.deepseek.com");
    }
  });
});

test("REQUIRED: CASUAL_CHAT never silently falls back to Sonnet when DeepSeek is unconfigured", () => {
  withEnv({ DEEPSEEK_API_KEY: undefined }, () => {
    const route = resolveChatterRoute("CASUAL_CHAT");
    assert.equal(route.ok, false);
    if (!route.ok) {
      assert.match(route.error, /DeepSeek/i);
      assert.doesNotMatch(route.error, /sonnet/i);
    }
  });
});

test("REQUIRED: DeepSeek model/base-url are centrally configurable -- switching Flash to Pro is a config change, not a code change", () => {
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: "deepseek-v4-pro", DEEPSEEK_BASE_URL: "https://custom.example.com" }, () => {
    const route = resolveChatterRoute("CASUAL_CHAT");
    assert.equal(route.ok, true);
    if (route.ok) {
      assert.equal(route.model, "deepseek-v4-pro");
      assert.equal(route.providerOverride?.baseUrl, "https://custom.example.com");
    }
  });
});

test("REQUIRED: CASUAL_CHAT gets a low output-token cap; ANSWER keeps its generous cap", () => {
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, () => {
    const casual = resolveChatterRoute("CASUAL_CHAT");
    const answer = resolveChatterRoute("ANSWER");
    assert.equal(casual.ok, true);
    assert.equal(answer.ok, true);
    if (casual.ok && answer.ok) {
      assert.ok(casual.maxTokens < answer.maxTokens);
      assert.ok(casual.maxTokens <= 200);
    }
  });
});

test("REQUIRED: routing keys strictly on action.type, not message content -- resolveChatterRoute takes no text/message argument at all", () => {
  // Structural proof: the function signature is (action: ChatterGenerationAction) => ChatterRoute.
  // If this ever grows a second parameter for message text, this call site breaks loudly.
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, () => {
    const route = resolveChatterRoute("CASUAL_CHAT");
    assert.equal(route.ok, true);
  });
});

test("REQUIRED: persona/prompt construction is provider-independent -- identical output regardless of DeepSeek configuration", () => {
  const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "laid-back, dry humor, terse" };
  const input = baseInput({ moderatorName: "Kwan", persona, action: "CASUAL_CHAT" });
  const withoutDeepseek = buildSystemPrompt(input);
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: "deepseek-v4-pro" }, () => {
    const withDeepseek = buildSystemPrompt(input);
    assert.equal(withDeepseek, withoutDeepseek);
    assert.match(withDeepseek, /laid-back, dry humor, terse/);
  });
});

/* ------------------------------------------------- emoji dead-zone fix ---- */
// REQUIRED (live bug): the default persona (emojiFrequency=30) and most
// presets (5-50) previously fell in a silent gap (the old rule only fired
// below 20 or above 60), so the model got NO emoji instruction at all and
// defaulted to using none. personaStyle must now give every emojiFrequency
// value SOME explicit instruction, with no dead zone.

test("REQUIRED: personaStyle gives an explicit emoji instruction at every emojiFrequency value, no silent gap", () => {
  for (const freq of [0, 5, 14, 15, 30, 39, 40, 50, 64, 65, 80, 100]) {
    const style = personaStyle({ ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: freq }).join(" ");
    assert.match(style, /emoji/i, `emojiFrequency=${freq} produced no emoji instruction at all`);
  }
});

test("REQUIRED: the DEFAULT persona (emojiFrequency 30) gets a real emoji instruction, not silence (the exact live bug)", () => {
  const style = personaStyle(DEFAULT_MODERATOR_PERSONA).join(" ");
  assert.match(style, /emoji are rare for you/i);
});

test("emoji instruction escalates from avoid -> rare -> moderate -> welcome across the range", () => {
  const at = (freq: number) => personaStyle({ ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: freq }).join(" ");
  assert.match(at(5), /avoid emoji almost entirely/i);
  assert.match(at(30), /rare for you/i);
  assert.match(at(50), /fine in moderation/i);
  assert.match(at(80), /natural part of how you write/i);
});

test("REQUIRED: shortAckText scales probability continuously with emojiFrequency (default persona is no longer excluded)", () => {
  const persona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 30 };
  // Deterministic random stub: always "wins" the roll (returns 0).
  const alwaysRolls = () => 0;
  assert.match(shortAckText(persona, alwaysRolls), /😄/);
});

test("shortAckText never appends emoji when emojiFrequency is near zero, even on a winning roll", () => {
  const persona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 0 };
  const alwaysRolls = () => 0;
  assert.doesNotMatch(shortAckText(persona, alwaysRolls), /😄/);
});

test("shortAckText's emoji chance grows with emojiFrequency (higher dial -> higher hit rate at a fixed roll)", () => {
  // Roll exactly at the boundary a low-emoji persona would just barely miss --
  // a higher emojiFrequency should still clear it.
  const roll = () => 0.14; // 14% roll
  const low = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 20 };   // chance = 10% -> misses
  const high = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 80 };  // chance = 40% -> hits
  assert.doesNotMatch(shortAckText(low, roll), /😄/);
  assert.match(shortAckText(high, roll), /😄/);
});

/* ------------------------------------------- other persona-dial dead zones ---- */
// REQUIRED (live bug): "Witty Mod" preset (formality=30, slang=35,
// chattiness=40, teasing=55) landed in the OLD binary threshold's gap for
// EVERY one of these dials at once (none were >70/<30, >60/<20, etc.), so
// the model got ZERO style instruction for any of them and defaulted to a
// neutral/professional-reading voice despite the preset. Same class of bug
// as the emoji dead zone above, now closed for every dial with a gap.

test("REQUIRED: personaStyle gives an explicit formality instruction at every value, no silent gap", () => {
  for (const formality of [0, 15, 29, 30, 50, 69, 70, 71, 100]) {
    const style = personaStyle({ ...DEFAULT_MODERATOR_PERSONA, formality }).join(" ");
    assert.match(style, /capital|lowercase|punctuation/i, `formality=${formality} produced no formality instruction`);
  }
});

test("REQUIRED: personaStyle gives an explicit slang instruction at every value, no silent gap", () => {
  for (const slang of [0, 19, 20, 40, 60, 61, 100]) {
    const style = personaStyle({ ...DEFAULT_MODERATOR_PERSONA, slang }).join(" ");
    assert.match(style, /slang/i, `slang=${slang} produced no slang instruction`);
  }
});

test("REQUIRED: personaStyle gives an explicit chattiness instruction at every value, no silent gap", () => {
  for (const chattiness of [0, 29, 30, 50, 70, 71, 100]) {
    const style = personaStyle({ ...DEFAULT_MODERATOR_PERSONA, chattiness }).join(" ");
    assert.match(style, /brief|talkative|conversational/i, `chattiness=${chattiness} produced no chattiness instruction`);
  }
});

test("REQUIRED (exact live bug): the Witty Mod preset's dials (formality=30, slang=35, chattiness=40, teasing=55) each produce a real style instruction, not silence", () => {
  const witty = personaFromPreset(resolvePersonaPreset("witty_mod")!);
  assert.equal(witty.formality, 30);
  assert.equal(witty.slang, 35);
  assert.equal(witty.chattiness, 40);
  assert.equal(witty.teasing, 55);
  const style = personaStyle(witty).join(" ");
  assert.match(style, /capital|lowercase|punctuation/i);
  assert.match(style, /slang/i);
  assert.match(style, /brief|talkative|conversational/i);
  // humor=80 clears the existing >60 threshold already -- confirms the wit
  // signal genuinely reaches the model, not just that nothing crashed.
  assert.match(style, /light humor is welcome/i);
});

test("REQUIRED (exact live bug, follow-up): Witty Mod resolves to the LOWERCASE contract via its explicit formal:false, not a numeric threshold -- live repro was Kwan still capitalizing sentence starts", () => {
  const witty = personaFromPreset(resolvePersonaPreset("witty_mod")!);
  assert.equal(witty.formal, false); // the actual source of truth, not formality=30
  const style = personaStyle(witty).join(" ");
  assert.match(style, /always write in lowercase/i);
  assert.doesNotMatch(style, /semi-formal/i);
  assert.doesNotMatch(style, /always capitalize the start/i);
});

/* --------------------------------------- formal: binary, never a probability band ---- */
// REQUIRED: architecture correction -- formality/capitalization for a
// PRESET persona is decided by the explicit `formal` boolean, never
// re-derived from the numeric `formality` dial. These tests prove the
// boolean is authoritative even when it CONTRADICTS what the numeric dial
// would otherwise imply -- the strongest possible guard against silently
// regressing back to threshold logic.

test("REQUIRED: persona.formal is authoritative even when it contradicts the numeric formality dial", () => {
  // formality=90 would normally mean strict caps -- formal:false must still win.
  const contradictoryCasual = { ...DEFAULT_MODERATOR_PERSONA, formal: false as boolean | null, formality: 90 };
  assert.match(personaStyle(contradictoryCasual).join(" "), /always write in lowercase/i);

  // formality=5 would normally mean lowercase -- formal:true must still win.
  const contradictoryFormal = { ...DEFAULT_MODERATOR_PERSONA, formal: true as boolean | null, formality: 5 };
  assert.match(personaStyle(contradictoryFormal).join(" "), /always capitalize the start/i);
});

test("REQUIRED: formal=true/false never produces the neutral semi-formal instruction -- that only exists as a numeric-fallback band for formal=null", () => {
  const formalYes = { ...DEFAULT_MODERATOR_PERSONA, formal: true as boolean | null, formality: 50 };
  const formalNo = { ...DEFAULT_MODERATOR_PERSONA, formal: false as boolean | null, formality: 50 };
  assert.doesNotMatch(personaStyle(formalYes).join(" "), /semi-formal/i);
  assert.doesNotMatch(personaStyle(formalNo).join(" "), /semi-formal/i);
});

test("REQUIRED: no probability/tendency language leaks into the binary contract -- exact deterministic phrasing only", () => {
  const style = personaStyle({ ...DEFAULT_MODERATOR_PERSONA, formal: false }).join(" ");
  for (const word of ["skew", "usually", "may capitalize", "lowercase-leaning", "sometimes"]) {
    assert.doesNotMatch(style, new RegExp(word, "i"), `found probability language "${word}"`);
  }
});

test("REQUIRED: formal=null (no explicit decision -- custom/legacy persona) falls back to the numeric dial, preserving prior custom-persona behavior", () => {
  const at = (over: Partial<ModeratorPersona>) => personaStyle({ ...DEFAULT_MODERATOR_PERSONA, formal: null, ...over }).join(" ");
  assert.match(at({ formality: 90 }), /always capitalize the start/i);
  assert.match(at({ formality: 50 }), /semi-formal/i);
  assert.match(at({ formality: 10 }), /always write in lowercase/i);
});

test("formality/slang/chattiness instructions escalate across the range, not just a binary (formal=null numeric-fallback path)", () => {
  const at = (over: Partial<ModeratorPersona>) => personaStyle({ ...DEFAULT_MODERATOR_PERSONA, formal: null, ...over }).join(" ");
  assert.match(at({ formality: 90 }), /always capitalize the start/i);
  assert.match(at({ formality: 50 }), /semi-formal/i);
  assert.match(at({ formality: 10 }), /always write in lowercase/i);
  assert.match(at({ slang: 90 }), /slang and internet-speak are welcome/i);
  assert.match(at({ slang: 40 }), /casual wording is fine where it naturally fits/i);
  assert.match(at({ slang: 5 }), /avoid slang/i);
});

/* -------------------------------------- persona hierarchy: identity > dials ---- */
// REQUIRED: description + customInstructions are the AUTHORITATIVE identity
// source; numeric dials only refine mechanics/intensity. Two presets with
// moderate dial values (Kwan's chattiness=40 lands in the middle band, Test's
// humor=20 sits right at the edge of the dead zone) must still produce
// materially different persona IDENTITY -- proving moderate dials never
// collapse two different personas into one generic/default voice.

test("REQUIRED (persona hierarchy): two moderate-dial presets (Witty Mod / Calm Professional) still produce materially different persona identity, and dials refine rather than replace it", () => {
  const kwan = personaFromPreset(resolvePersonaPreset("witty_mod")!);
  const test1 = personaFromPreset(resolvePersonaPreset("calm_professional")!);

  const kwanPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-kwan", moderatorName: "Kwan", persona: kwan, action: "ANSWER" }));
  const testPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-test", moderatorName: "Test", persona: test1, action: "ANSWER" }));

  // Identity (tier 1: description) is present verbatim and distinct per moderator.
  assert.match(kwanPrompt, /playful and clever, with dry humor/i);
  assert.match(testPrompt, /composed, clear, and respectful/i);
  assert.doesNotMatch(kwanPrompt, /composed, clear, and respectful/i);
  assert.doesNotMatch(testPrompt, /playful and clever, with dry humor/i);

  // customInstructions (tier 2) also present and distinct, as authoritative
  // behavioral guidance -- not buried inside the dial-mechanics bullet list.
  assert.match(kwanPrompt, /be playful and quick-witted/i);
  assert.match(testPrompt, /speak like a composed, professional community moderator/i);

  // The hierarchy itself is stated explicitly, not just implied by ordering.
  assert.match(kwanPrompt, /secondary style\/intensity notes/i);
  assert.match(kwanPrompt, /the persona wins/i);

  // Dials REFINE (both still get concrete mechanics), they do not REPLACE
  // identity -- neither prompt reads as empty/generic just because some of
  // its dials land in the moderate range.
  assert.match(kwanPrompt, /light humor is welcome/i); // Kwan humor=80, clears the high band
  assert.match(testPrompt, /avoid slang — keep language plain and standard/i); // Test slang=5, clears the low band
});

test("REQUIRED: two-moderator persona isolation holds for the DeepSeek-routed CASUAL_CHAT action too", () => {
  const kwanPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-kwan", moderatorName: "Kwan", persona: FORMAL_MODERATOR_A, action: "CASUAL_CHAT" }));
  const testPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-test", moderatorName: "Test", persona: CASUAL_MODERATOR_B, action: "CASUAL_CHAT" }));
  assert.doesNotMatch(kwanPrompt, /Slang and internet-speak are welcome/i);
  assert.match(testPrompt, /Slang and internet-speak are welcome/i);
  assert.match(kwanPrompt, /You are Kwan/);
  assert.match(testPrompt, /You are Test/);
});

/* ================================== ambient-greeting model fallback ==========
   REQUIRED (live bug): "waddup guys" (no "?", no directed name) was silenced
   -- isConversationalOpener has no orthography-independent signal for a
   phonetic slang greeting. classifyAmbientGreeting is the narrow, opt-in
   model fallback for exactly that residual case -- verified here against the
   ACTUAL outgoing request (via a fetch spy, not just the parsed result), and
   proven to never touch Sonnet and never escalate on failure. ================ */

function withFetchSpy<T>(responseBody: unknown, fn: (calls: Array<{ url: string; body: unknown }>) => Promise<T> | T): Promise<T> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function withEnvAsync<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prev[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("REQUIRED: classifyAmbientGreeting routes to DeepSeek Flash (never Sonnet), sends a tiny classification request", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: undefined, DEEPSEEK_BASE_URL: undefined }, async () => {
    await withFetchSpy({ choices: [{ message: { content: "GREETING" } }] }, async (calls) => {
      const result = await classifyAmbientGreeting("waddup guys");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /deepseek/i);
      const body = calls[0].body as { model?: string; max_tokens?: number; thinking?: { type: string } };
      assert.equal(body.model, "deepseek-v4-flash");
      assert.equal(body.thinking?.type, "disabled");
      assert.ok((body.max_tokens ?? 1024) <= 10, "classification output should be tiny, not a full reply");
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.isGreeting, true);
    });
  });
});

test('REQUIRED: "OTHER" response classifies as not-a-greeting', async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy({ choices: [{ message: { content: "OTHER" } }] }, async () => {
      const result = await classifyAmbientGreeting("the price changed");
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.isGreeting, false);
    });
  });
});

test("REQUIRED: unconfigured DeepSeek fails explicitly -- no network call attempted, never falls back to Sonnet", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: undefined }, async () => {
    await withFetchSpy({}, async (calls) => {
      const result = await classifyAmbientGreeting("waddup guys");
      assert.equal(result.ok, false);
      assert.equal(calls.length, 0, "must not attempt any network call when DeepSeek is unconfigured");
    });
  });
});

test("a failed DeepSeek call surfaces as ok:false rather than throwing or escalating", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    try {
      const result = await classifyAmbientGreeting("waddup guys");
      assert.equal(result.ok, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/* ============================== human group-chat behavior contract ==========
   Virtual Moderators are participants, not assistants. Live bug: casual
   meta-questions ("why are the two of you not answering one after the
   other?") produced assistant-style over-explanation of internal mechanics
   ("no secret turn system, we just reply when we see it" / "no coordination
   going on"). These assert the actual prompt strings the model receives --
   deterministic prompt assembly, not live model output (see file header). ==== */

test("REQUIRED: the no-hidden-mechanics rule is present for CASUAL_CHAT", () => {
  const prompt = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT" }));
  assert.match(prompt, /internal mechanics/i);
  assert.match(prompt, /routing/i);
  assert.match(prompt, /turn-taking/i);
});

test("REQUIRED: the no-hidden-mechanics rule is ALSO present for ANSWER -- casual meta-questions phrased as a literal question route to ANSWER, not just CASUAL_CHAT", () => {
  const prompt = buildSystemPrompt(baseInput({ action: "ANSWER" }));
  assert.match(prompt, /internal mechanics/i);
  assert.match(prompt, /the system picked me/i);
});

test('REQUIRED: the prompt explicitly bans the exact over-explaining phrasing pattern from the live bug ("there\'s no turn system", "we don\'t coordinate")', () => {
  const prompt = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT" }));
  assert.match(prompt, /there's no turn system/i);
  assert.match(prompt, /we don't coordinate/i);
});

test("REQUIRED: the minimum-sufficient-response rule (shortest natural reply, don't restate the message) is present for CASUAL_CHAT and ANSWER", () => {
  const casual = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT" }));
  const answer = buildSystemPrompt(baseInput({ action: "ANSWER" }));
  for (const prompt of [casual, answer]) {
    assert.match(prompt, /shortest natural reply/i);
    assert.match(prompt, /don't restate or summarize the human's message/i);
  }
});

/* ------------------------------------------ requiresIndividualContribution ---- */
// Distinguishes an inherently PER-PERSON request ("tell me about yourself")
// from a shared/collective one ("why are you two replying like that?") a
// single sufficient answer typically already satisfies.

test('REQUIRED: "can you both tell me about yourself?" (the live repro) requires individual contribution', () => {
  assert.equal(requiresIndividualContribution("can you both tell me about yourself?"), true);
});

test('REQUIRED: "tell me about yourselves" requires individual contribution', () => {
  assert.equal(requiresIndividualContribution("tell me about yourselves"), true);
});

test('REQUIRED: "introduce yourself" requires individual contribution', () => {
  assert.equal(requiresIndividualContribution("introduce yourself"), true);
});

test('REQUIRED: "why are you two replying like that?" is a shared/collective question, not individual', () => {
  assert.equal(requiresIndividualContribution("why are you two replying like that?"), false);
});

test('REQUIRED: "why are the two of you not answering one after the other?" (the live repro) is a shared/collective question', () => {
  assert.equal(requiresIndividualContribution("why are the two of you not answering one after the other? like you are taking turns?"), false);
});

test('REQUIRED: "is the room quiet today?" is a shared/collective question', () => {
  assert.equal(requiresIndividualContribution("is the room quiet today?"), false);
});

/* ------------------------------------------------ obligationContextLines ---- */
// Grounds a secondary responder's "did someone already cover this?" in what
// was actually said -- never invented -- and gives different instructions
// depending on whether the request was individual or shared.

test("obligationContextLines is null when there are no prior responses (primary responder, or any ordinary single-responder message)", () => {
  assert.equal(obligationContextLines(baseInput({})), null);
});

test("REQUIRED: shared/collective obligation -- instructs the model that a sufficient prior reply may already cover it, offers NO_REPLY, and forbids repeating the explanation", () => {
  const line = obligationContextLines(
    baseInput({
      priorResponsesToThisMessage: [{ moderatorName: "Kwan", text: "just timing lol" }],
      individualContributionExpected: false,
    })
  );
  assert.ok(line);
  assert.match(line!, /Kwan/);
  assert.match(line!, /just timing lol/);
  assert.match(line!, /do not need to answer again/i);
  assert.match(line!, /do not repeat or restate/i);
  assert.match(line!, /NO_REPLY/);
});

test("REQUIRED: individual obligation -- instructs the model it must still give its OWN answer, not just repeat or describe the other moderator", () => {
  const line = obligationContextLines(
    baseInput({
      priorResponsesToThisMessage: [{ moderatorName: "Test", text: "i'm test, meme-friendly but i get stuff done" }],
      individualContributionExpected: true,
    })
  );
  assert.ok(line);
  assert.match(line!, /Test/);
  assert.match(line!, /each of you individually/i);
  assert.match(line!, /still give your own genuine answer/i);
  assert.doesNotMatch(line!, /NO_REPLY/);
});

test("obligationContextLines is wired into the actual CASUAL_CHAT and ANSWER prompts when present", () => {
  const input = baseInput({
    action: "CASUAL_CHAT",
    priorResponsesToThisMessage: [{ moderatorName: "Kwan", text: "just timing lol" }],
    individualContributionExpected: false,
  });
  const casualPrompt = buildSystemPrompt(input);
  assert.match(casualPrompt, /just timing lol/);
  const answerPrompt = buildSystemPrompt({ ...input, action: "ANSWER" });
  assert.match(answerPrompt, /just timing lol/);
});

test("REQUIRED: persona distinction survives the obligation context -- two different presets given the SAME prior-response context still each carry their own persona text, not each other's", () => {
  const kwan = personaFromPreset(resolvePersonaPreset("witty_mod")!);
  const test_ = personaFromPreset(resolvePersonaPreset("calm_professional")!);
  const priorResponsesToThisMessage = [{ moderatorName: "Kwan", text: "just timing lol" }];

  const kwanPrompt = buildSystemPrompt(baseInput({ moderatorName: "Kwan", persona: kwan, priorResponsesToThisMessage, individualContributionExpected: false }));
  const calmPrompt = buildSystemPrompt(baseInput({ moderatorName: "Test", persona: test_, priorResponsesToThisMessage, individualContributionExpected: false }));

  assert.match(kwanPrompt, new RegExp(kwan.description.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.match(calmPrompt, new RegExp(test_.description.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.notEqual(kwan.description, test_.description);
});

/* ==================================== persona-aware reaction selection ====
   "The coordinator decides whether a reaction is warranted. The persona
   layer decides how that reaction is expressed." -- these test the SECOND
   half: given the coordinator's neutral content-based emoji suggestion,
   personaReactionEmoji picks how ONE specific moderator expresses it. */

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test("REQUIRED: a persona that strongly avoids emoji (emojiFrequency < 15) still reacts -- Telegram reactions ARE emoji -- but gets the plainest option for the category, not an exuberant one", () => {
  const lowEmoji: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 5 };
  assert.equal(personaReactionEmoji("😂", lowEmoji), "😄");
  assert.equal(personaReactionEmoji("🙏", lowEmoji), "🙏");
  assert.equal(personaReactionEmoji("👍", lowEmoji), "👍");
  assert.equal(personaReactionEmoji("😄", lowEmoji), "🙂");
});

test("REQUIRED: emoji use is never forced beyond the plain option for a low-emoji persona, regardless of humor/teasing", () => {
  const lowEmojiHighHumor: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 5, humor: 90, teasing: 90 };
  assert.equal(personaReactionEmoji("😂", lowEmojiHighHumor), "😄");
});

test("a high-humor/teasing persona gets a more exuberant laugh pool than a low-humor one", () => {
  const witty: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, humor: 80, teasing: 80 };
  const reserved: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, humor: 10, teasing: 10 };
  const wittyEmoji = personaReactionEmoji("😂", witty, seq([0]));
  const reservedEmoji = personaReactionEmoji("😂", reserved, seq([0]));
  assert.equal(wittyEmoji, "🤣");
  assert.equal(reservedEmoji, "😂");
});

test("a formal persona gets a restrained positive/agreement reaction, a casual one a more expressive pool", () => {
  const formal: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, formality: 90 };
  const casual: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, formality: 10 };
  assert.equal(personaReactionEmoji("😄", formal, seq([0])), "🙂");
  assert.equal(personaReactionEmoji("😄", casual, seq([0])), "😄");
  assert.equal(personaReactionEmoji("👍", formal, seq([0])), "👍");
});

test("randomness (when used) only chooses AMONG equally-valid expressions of the SAME category -- never decides whether to react (that's already decided by the time this function runs)", () => {
  const witty: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, humor: 80 };
  // Fractional random() outputs (in [0,1)), one per pool slot -- 0, 1/3, 2/3
  // select pool indices 0, 1, 2 respectively out of the 3-item laugh pool.
  const results = [0, 1 / 3, 2 / 3].map((r) => personaReactionEmoji("😂", witty, () => r));
  // Every result is still a laugh-category emoji -- variety in EXPRESSION, never a "no reaction" outcome.
  for (const r of results) assert.ok(["🤣", "😂", "😆"].includes(r));
  assert.deepEqual(results, ["🤣", "😂", "😆"]);
});

test("thanks stays a single, near-universal reaction across personas (🙏)", () => {
  const witty: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, humor: 90 };
  const formal: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60, formality: 90 };
  assert.equal(personaReactionEmoji("🙏", witty), "🙏");
  assert.equal(personaReactionEmoji("🙏", formal), "🙏");
});

test("personaReactionEmoji is pure/deterministic given a fixed random source -- same input, same output, no flakiness in tests", () => {
  const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, emojiFrequency: 60 };
  const a = personaReactionEmoji("😂", persona, () => 0);
  const b = personaReactionEmoji("😂", persona, () => 0);
  assert.equal(a, b);
});

/* ============================================ collab-contact routing (Phase 4.M (F)) ==
   Conversational routing only, never an authorization grant (spec §36) --
   grounded ONLY in the community's own configured contact, never invented. */

test("collabContactLine is null when no contact is configured", () => {
  assert.equal(collabContactLine(baseInput({})), null);
});

test("REQUIRED: collabContactLine mentions the EXACT configured contact when set", () => {
  const line = collabContactLine(baseInput({ collabContact: "@project_admin" }));
  assert.ok(line);
  assert.match(line!, /@project_admin/);
});

test("REQUIRED: never implies the contact has special authority beyond routing", () => {
  const line = collabContactLine(baseInput({ collabContact: "@project_admin" }));
  assert.match(line!, /no special authority|never imply this contact has any special authority/i);
});

test("REQUIRED: no configured contact -- SHARED_RULES bans inventing a username", () => {
  const prompt = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT", collabContact: null }));
  assert.match(prompt, /never invent a username/i);
  assert.doesNotMatch(prompt, /@project_admin/);
});

test("collabContactLine is wired into both the ANSWER and CASUAL_CHAT prompts when set", () => {
  const input = baseInput({ collabContact: "@project_admin" });
  assert.match(buildSystemPrompt({ ...input, action: "CASUAL_CHAT" }), /@project_admin/);
  assert.match(buildSystemPrompt({ ...input, action: "ANSWER" }), /@project_admin/);
});

/* ==================================== Phase 4.N: project knowledge grounding ====
   Only the ALREADY-RETRIEVED, relevance-ranked subset is ever visible to the
   model (retrieval itself happens in community-runtime.ts, not here) -- this
   layer just verifies the grounded content reaches the prompt, the
   never-fabricate-beyond-it instruction is present, and it's scoped to
   ANSWER only (never CASUAL_CHAT, per spec: substantive Q&A uses ANSWER). */

test("projectKnowledgeContextLines is null when nothing was retrieved", () => {
  assert.equal(projectKnowledgeContextLines(baseInput({})), null);
  assert.equal(projectKnowledgeContextLines(baseInput({ projectKnowledge: [] })), null);
});

test("REQUIRED: projectKnowledgeContextLines surfaces the exact retrieved title/content, verbatim", () => {
  const line = projectKnowledgeContextLines(baseInput({ projectKnowledge: [{ scope: "PROJECT", title: "Supported chains", content: "Ethereum and Polygon." }] }));
  assert.ok(line);
  assert.match(line!, /Supported chains/);
  assert.match(line!, /Ethereum and Polygon\./);
});

test("REQUIRED: instructs the moderator this is the ONLY source of factual project claims -- never invent beyond it", () => {
  const line = projectKnowledgeContextLines(baseInput({ projectKnowledge: [{ scope: "PROJECT", title: "X", content: "Y" }] }));
  assert.match(line!, /ONLY source of factual claims/i);
  assert.match(line!, /don't have that information|never state a fact beyond/i);
});

test("REQUIRED: projectKnowledge is wired into the ANSWER prompt", () => {
  const prompt = buildSystemPrompt(baseInput({ action: "ANSWER", projectKnowledge: [{ scope: "PROJECT", title: "Roadmap", content: "Q3 launch of feature X." }] }));
  assert.match(prompt, /Roadmap/);
  assert.match(prompt, /Q3 launch of feature X\./);
});

test("REQUIRED: projectKnowledge is NOT wired into CASUAL_CHAT -- casual chatter never cites facts", () => {
  const prompt = buildSystemPrompt(baseInput({ action: "CASUAL_CHAT", projectKnowledge: [{ scope: "PROJECT", title: "Roadmap", content: "Q3 launch of feature X." }] }));
  assert.doesNotMatch(prompt, /Q3 launch of feature X\./);
});

test("multiple retrieved entries all appear in the prompt, each on its own line", () => {
  const prompt = buildSystemPrompt(
    baseInput({
      action: "ANSWER",
      projectKnowledge: [
        { scope: "PROJECT", title: "Chains", content: "Ethereum, Polygon." },
        { scope: "COMMUNITY", title: "Support", content: "support@example.com" },
      ],
    })
  );
  assert.match(prompt, /Chains/);
  assert.match(prompt, /Ethereum, Polygon\./);
  assert.match(prompt, /Support/);
  assert.match(prompt, /support@example\.com/);
});

test("a title-less entry still renders its content without a dangling label", () => {
  const line = projectKnowledgeContextLines(baseInput({ projectKnowledge: [{ scope: "ORGANIZATION", title: "", content: "Support hours are 9am-5pm UTC." }] }));
  assert.match(line!, /Support hours are 9am-5pm UTC\./);
});

/* ---------------------------------------- scope labeling (architecture correction) ----
   "Do not label organization-wide knowledge as Project Knowledge" -- each
   entry must be labeled by its OWN scope, never a single generic header. */

test("REQUIRED: COMMUNITY, PROJECT, and ORGANIZATION entries are each labeled by their own scope, never conflated", () => {
  const line = projectKnowledgeContextLines(
    baseInput({
      projectKnowledge: [
        { scope: "COMMUNITY", title: "AMA", content: "Fridays 3pm UTC" },
        { scope: "PROJECT", title: "Chains", content: "Ethereum, Polygon" },
        { scope: "ORGANIZATION", title: "Legal", content: "KaJ Labs Inc." },
      ],
    })
  );
  assert.match(line!, /community.*specific to this community/i);
  assert.match(line!, /project.*specific to this project/i);
  assert.match(line!, /organization.*shared across every project/i);
});

test("an organization-wide entry is never labeled as project knowledge", () => {
  const line = projectKnowledgeContextLines(baseInput({ projectKnowledge: [{ scope: "ORGANIZATION", title: "Legal", content: "KaJ Labs Inc." }] }));
  assert.doesNotMatch(line!, /\[Project knowledge/);
  assert.match(line!, /\[Organization knowledge/);
});
