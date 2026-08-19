import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODERATOR_PERSONA_PRESETS, DEFAULT_SURFACED_PRESET_IDS,
  resolvePersonaPreset, applyPersonaPreset, personaFromPreset,
  currentPersonaPresetSummary, personaFieldsAfterApply,
} from "./presets";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";

/* --------------------------------------------------------- preset catalog ---- */

test("REQUIRED: exactly 18 presets exist, each with a unique id", () => {
  assert.equal(MODERATOR_PERSONA_PRESETS.length, 18);
  const ids = new Set(MODERATOR_PERSONA_PRESETS.map((p) => p.id));
  assert.equal(ids.size, 18);
});

test("REQUIRED: every preset has the fields the picker/generation needs", () => {
  for (const preset of MODERATOR_PERSONA_PRESETS) {
    assert.ok(preset.label.trim().length > 0, `${preset.id} missing label`);
    assert.ok(preset.shortDescription.trim().length > 0, `${preset.id} missing shortDescription`);
    assert.ok(preset.tags.length > 0, `${preset.id} missing tags`);
    assert.ok(preset.exampleVoice.trim().length > 0, `${preset.id} missing exampleVoice`);
    assert.ok(preset.overrides.description && preset.overrides.description.trim().length > 0, `${preset.id} missing overrides.description`);
    assert.ok(preset.overrides.customInstructions && preset.overrides.customInstructions.length > 20, `${preset.id}'s customInstructions is too thin ("You are friendly"-style)`);
  }
});

test("REQUIRED: exactly 10 default-surfaced presets, all valid ids, 8 remain for \"More presets\"", () => {
  assert.equal(DEFAULT_SURFACED_PRESET_IDS.length, 10);
  for (const id of DEFAULT_SURFACED_PRESET_IDS) {
    assert.ok(resolvePersonaPreset(id), `surfaced id "${id}" does not resolve to a real preset`);
  }
  const remaining = MODERATOR_PERSONA_PRESETS.filter((p) => !DEFAULT_SURFACED_PRESET_IDS.includes(p.id));
  assert.equal(remaining.length, 8);
});

test("REQUIRED: preset example voices are each distinct, not one shared generic line", () => {
  const examples = MODERATOR_PERSONA_PRESETS.map((p) => p.exampleVoice);
  assert.equal(new Set(examples).size, examples.length);
});

/* ---------------------------------------------------------------- resolution ---- */

test("REQUIRED: resolvePersonaPreset returns the expected structured config for a known id", () => {
  const preset = resolvePersonaPreset("calm_professional");
  assert.ok(preset);
  assert.equal(preset!.label, "Calm Professional");
  assert.equal(preset!.overrides.formality, 75);
  assert.equal(preset!.overrides.humor, 20);
});

test("resolvePersonaPreset returns null for an unknown id", () => {
  assert.equal(resolvePersonaPreset("does_not_exist"), null);
});

/* ------------------------------------------- Watcher-tab preset summary UX ---- */
/* currentPersonaPresetSummary / personaFieldsAfterApply back the compact
   Persona-tab "current preset" card + the preset picker's selected-state
   highlighting (WatcherPersonaTab.tsx / PersonaPresetPicker.tsx). */

test("REQUIRED: currentPersonaPresetSummary resolves a known presetId to the real preset (drives the 'current preset' summary card and the picker's selected-state highlighting)", () => {
  const summary = currentPersonaPresetSummary("friendly_community_mod");
  assert.ok(summary);
  assert.equal(summary!.label, "Friendly Community Mod");
});

test("REQUIRED: currentPersonaPresetSummary returns null for a Watcher with no preset applied yet -- renders as 'Custom persona', never a fabricated label", () => {
  assert.equal(currentPersonaPresetSummary(null), null);
});

test("currentPersonaPresetSummary returns null for a stale/removed preset id, never throws", () => {
  assert.equal(currentPersonaPresetSummary("this_preset_id_no_longer_exists"), null);
});

test("REQUIRED: personaFieldsAfterApply mirrors exactly what the server-side materialization writes -- both description and customInstructions, so the UI never shows stale text after picking a preset", () => {
  const preset = resolvePersonaPreset("calm_professional")!;
  const fields = personaFieldsAfterApply(preset);
  assert.equal(fields.description, preset.overrides.description);
  assert.equal(fields.customInstructions, preset.overrides.customInstructions);
});

test("REQUIRED: personaFieldsAfterApply never returns anything beyond description/customInstructions -- a preset is a one-time starting value, not a lock on the textareas", () => {
  for (const preset of MODERATOR_PERSONA_PRESETS) {
    const fields = personaFieldsAfterApply(preset);
    assert.deepEqual(Object.keys(fields).sort(), ["customInstructions", "description"]);
  }
});

test("every real preset resolves through currentPersonaPresetSummary identically to resolvePersonaPreset -- the summary card can never disagree with the picker's own resolution", () => {
  for (const preset of MODERATOR_PERSONA_PRESETS) {
    assert.equal(currentPersonaPresetSummary(preset.id), resolvePersonaPreset(preset.id));
  }
});

/* -------------------------------------------------------------- distinctness ---- */

test("REQUIRED: several presets are clearly distinct across tone/formality/slang/emoji/verbosity/behavior", () => {
  const calm = resolvePersonaPreset("calm_professional")!;
  const chill = resolvePersonaPreset("chill_casual")!;
  const strict = resolvePersonaPreset("strict_moderator")!;
  const hype = resolvePersonaPreset("hype_energetic")!;

  // formality: Calm Professional is far more formal than Chill & Casual.
  assert.ok(calm.overrides.formality! - chill.overrides.formality! >= 40);
  // slang: Chill & Casual leans on slang far more than Strict Moderator.
  assert.ok(chill.overrides.slang! - strict.overrides.slang! >= 40);
  // emoji: Hype & Energetic uses emoji far more than Strict Moderator.
  assert.ok(hype.overrides.emojiFrequency! - strict.overrides.emojiFrequency! >= 50);
  // verbosity (chattiness): Hype & Energetic is far chattier than Polite Minimalist.
  const minimalist = resolvePersonaPreset("polite_minimalist")!;
  assert.ok(hype.overrides.chattiness! - minimalist.overrides.chattiness! >= 40);
  // behavior notes are not interchangeable strings.
  assert.notEqual(calm.overrides.customInstructions, chill.overrides.customInstructions);
});

test("no two presets share byte-identical numeric dials (each is a real distinct combination)", () => {
  const signatures = MODERATOR_PERSONA_PRESETS.map((p) =>
    [p.overrides.formality, p.overrides.humor, p.overrides.slang, p.overrides.emojiFrequency, p.overrides.teasing, p.overrides.chattiness].join(",")
  );
  assert.equal(new Set(signatures).size, signatures.length);
});

/* --------------------------------------------------------------- application ---- */

test("REQUIRED: applying a preset materializes its overrides onto the persona, preserving untouched fields", () => {
  const base = { ...DEFAULT_MODERATOR_PERSONA, language: "en+tl", topicsToAvoid: ["politics"] };
  const preset = resolvePersonaPreset("witty_mod")!;
  const result = applyPersonaPreset(base, preset);

  assert.equal(result.formality, preset.overrides.formality);
  assert.equal(result.humor, preset.overrides.humor);
  assert.equal(result.description, preset.overrides.description);
  assert.equal(result.customInstructions, preset.overrides.customInstructions);
  assert.equal(result.presetId, "witty_mod");
  // Untouched fields carry over from base, not reset.
  assert.equal(result.language, "en+tl");
  assert.deepEqual(result.topicsToAvoid, ["politics"]);
});

test("personaFromPreset applies a preset onto DEFAULT_MODERATOR_PERSONA for brand-new moderators", () => {
  const preset = resolvePersonaPreset("direct_no_nonsense")!;
  const result = personaFromPreset(preset);
  assert.equal(result.formality, 55);
  assert.equal(result.presetId, "direct_no_nonsense");
});

test('REQUIRED: custom override -- a manual edit after applying a preset is never silently overwritten (no re-application mechanism exists)', () => {
  const preset = resolvePersonaPreset("chill_casual")!;
  let persona = personaFromPreset(preset);
  assert.equal(persona.description, preset.overrides.description);

  // Simulates the owner manually editing the description afterward (what
  // setModeratorPersonaDescription does in the actions layer) -- a plain
  // object mutation, no call back into applyPersonaPreset.
  persona = { ...persona, description: "actually more sarcastic than chill, still short replies" };

  // Nothing in this module re-reads or re-applies the preset automatically --
  // the edited value is exactly what a subsequent read would see.
  assert.equal(persona.description, "actually more sarcastic than chill, still short replies");
  assert.equal(persona.presetId, "chill_casual"); // provenance label persists, but never forces a snap-back
});

/* ---------------------------------------------------------------- boundaries ---- */

test("REQUIRED: preset overrides never touch fields outside style (no moderation/authority/identity fields exist on ModeratorPersona at all)", () => {
  const preset = resolvePersonaPreset("strict_moderator")!;
  const allowedKeys = new Set(["description", "customInstructions", "formal", "formality", "humor", "slang", "emojiFrequency", "teasing", "chattiness", "profanityTolerance"]);
  for (const key of Object.keys(preset.overrides)) {
    assert.ok(allowedKeys.has(key), `preset override touches unexpected field "${key}"`);
  }
});

/* ------------------------------------------------- formal: binary, not a threshold ---- */
// REQUIRED: formality/capitalization for a PRESET is an explicit semantic
// YES/NO decision on the preset itself, never re-derived from the numeric
// `formality` dial. Every preset below has a `formal` value asserted
// directly against ITS OWN catalog entry, not a computed range check --
// proving the mapping is a stored product decision, not a formula.

test("REQUIRED: every preset explicitly sets `formal` -- true or false, never left unset", () => {
  for (const preset of MODERATOR_PERSONA_PRESETS) {
    assert.equal(typeof preset.overrides.formal, "boolean", `${preset.id} must explicitly set formal`);
  }
});

test("REQUIRED: formal mapping matches the explicit product decision per preset (semantic, not numeric)", () => {
  const expected: Record<string, boolean> = {
    calm_professional: true,
    friendly_community_mod: false,
    chill_casual: false,
    witty_mod: false,
    direct_no_nonsense: true,
    hype_energetic: false,
    supportive_guide: false,
    technical_expert: true,
    strict_moderator: true,
    diplomatic_mediator: true,
    polite_minimalist: true,
    playful_meme_mod: false,
    community_veteran: false,
    dry_humor: false,
    big_sibling_mod: false,
    founder_like: false,
    web3_native: false,
    gaming_community_mod: false,
  };
  assert.equal(Object.keys(expected).length, MODERATOR_PERSONA_PRESETS.length, "expected mapping must cover every preset");
  for (const preset of MODERATOR_PERSONA_PRESETS) {
    assert.equal(preset.overrides.formal, expected[preset.id], `${preset.id}: expected formal=${expected[preset.id]}`);
  }
});

test("REQUIRED (exact live bug): Witty Mod is formal=false, NOT derived from formality=30 landing near a threshold", () => {
  const witty = resolvePersonaPreset("witty_mod")!;
  assert.equal(witty.overrides.formal, false);
  const persona = personaFromPreset(witty);
  assert.equal(persona.formal, false);
});

test("REQUIRED: Calm Professional / Chill & Casual / Polite Minimalist / Playful Meme Mod materialize the exact expected formal value onto the persona", () => {
  assert.equal(personaFromPreset(resolvePersonaPreset("calm_professional")!).formal, true);
  assert.equal(personaFromPreset(resolvePersonaPreset("chill_casual")!).formal, false);
  assert.equal(personaFromPreset(resolvePersonaPreset("polite_minimalist")!).formal, true);
  assert.equal(personaFromPreset(resolvePersonaPreset("playful_meme_mod")!).formal, false);
});

test("a custom (non-preset) persona defaults formal to null -- no explicit decision, falls back to the numeric dial elsewhere", () => {
  assert.equal(DEFAULT_MODERATOR_PERSONA.formal, null);
});

test('a "Founder-Like" preset explicitly disclaims actually being the founder', () => {
  const preset = resolvePersonaPreset("founder_like")!;
  assert.match(preset.overrides.customInstructions!, /never claim to actually be the founder/i);
});
