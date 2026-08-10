import { test } from "node:test";
import assert from "node:assert/strict";
import { __testables, shortAckText, type GenerateChatterReplyInput, type ChatterContextMessage } from "./chatter-generate";
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

test("REQUIRED: two-moderator persona isolation holds for the DeepSeek-routed CASUAL_CHAT action too", () => {
  const kwanPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-kwan", moderatorName: "Kwan", persona: FORMAL_MODERATOR_A, action: "CASUAL_CHAT" }));
  const testPrompt = buildSystemPrompt(baseInput({ selfDeploymentId: "dep-test", moderatorName: "Test", persona: CASUAL_MODERATOR_B, action: "CASUAL_CHAT" }));
  assert.doesNotMatch(kwanPrompt, /Slang and internet-speak are welcome/i);
  assert.match(testPrompt, /Slang and internet-speak are welcome/i);
  assert.match(kwanPrompt, /You are Kwan/);
  assert.match(testPrompt, /You are Test/);
});
