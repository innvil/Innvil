import { test } from "node:test";
import assert from "node:assert/strict";
import { INNVIL_REQUIRED_MODEL, assertInnvilModel, getInnvilModelConfig } from "./client";

/**
 * Model-enforcement invariant: every Innvil-authored AI automation must
 * resolve to Sonnet 5, never silently fall back to a cheaper/older model.
 * getInnvilModelConfig() re-reads AI_MODEL per call (not the frozen
 * DEFAULT_AI_MODEL constant) specifically so this is testable and so a
 * misconfiguration is caught at call time.
 */

function withAiModelEnv<T>(value: string | undefined, fn: () => T): T {
  const prior = process.env.AI_MODEL;
  if (value === undefined) delete process.env.AI_MODEL;
  else process.env.AI_MODEL = value;
  try {
    return fn();
  } finally {
    if (prior === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prior;
  }
}

test("assertInnvilModel accepts the exact required model id", () => {
  assert.doesNotThrow(() => assertInnvilModel(INNVIL_REQUIRED_MODEL));
});

test("assertInnvilModel rejects Fable", () => {
  assert.throws(() => assertInnvilModel("claude-fable-5"));
});

test("assertInnvilModel rejects Haiku", () => {
  assert.throws(() => assertInnvilModel("claude-haiku-4-5-20251001"));
});

test("assertInnvilModel rejects Opus", () => {
  assert.throws(() => assertInnvilModel("claude-opus-5"));
});

test("assertInnvilModel rejects an older Sonnet", () => {
  assert.throws(() => assertInnvilModel("claude-sonnet-4-6"));
});

test("missing AI_MODEL resolves to the canonical Sonnet 5 config, not a provider/lesser-model default", () => {
  const config = withAiModelEnv(undefined, () => getInnvilModelConfig());
  assert.equal(config.model, "claude-sonnet-5");
  assert.equal(config.effort, "medium");
});

test("AI_MODEL explicitly set to the required model resolves cleanly", () => {
  const config = withAiModelEnv("claude-sonnet-5", () => getInnvilModelConfig());
  assert.equal(config.model, "claude-sonnet-5");
});

test("AI_MODEL misconfigured to a different model throws instead of silently downgrading", () => {
  withAiModelEnv("claude-fable-5", () => {
    assert.throws(() => getInnvilModelConfig());
  });
});

test("AI_MODEL misconfigured to an arbitrary string throws", () => {
  withAiModelEnv("gpt-4o", () => {
    assert.throws(() => getInnvilModelConfig());
  });
});
