import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODERATOR_PERSONA, moderatorPersonaIsAssigned } from "./domain";

test("REQUIRED: the untouched platform default is never treated as assigned", () => {
  assert.equal(moderatorPersonaIsAssigned(DEFAULT_MODERATOR_PERSONA), false);
});

test("a preset link alone counts as assigned", () => {
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, presetId: "friendly-community-mod" }), true);
});

test("a real typed description alone counts as assigned", () => {
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, description: "Laid-back and witty." }), true);
});

test("a real typed custom instructions alone counts as assigned", () => {
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, customInstructions: "Always mention the FAQ." }), true);
});

test("whitespace-only description/instructions never counts as assigned", () => {
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, description: "   " }), false);
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, customInstructions: "  \n " }), false);
});

test("adjusting numeric style dials alone never counts as assigned -- only description/instructions/preset are explicit assignment signals", () => {
  assert.equal(moderatorPersonaIsAssigned({ ...DEFAULT_MODERATOR_PERSONA, formality: 90, humor: 5, slang: 5 }), false);
});
