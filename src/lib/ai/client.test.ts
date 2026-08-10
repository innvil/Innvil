import { test } from "node:test";
import assert from "node:assert/strict";
import { INNVIL_REQUIRED_MODEL, assertInnvilModel, getInnvilModelConfig, deepseekChatterProvider } from "./client";

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

/**
 * deepseekChatterProvider() — the dedicated CASUAL_CHAT provider (Natural
 * Chatter task-based routing). Mirrors aiprimetechProvider()'s "own
 * key/provider/spend, returns null when unconfigured" shape. This is a
 * SEPARATE credential from AI_API_KEY/AI_FALLBACK_* on purpose — it must
 * never silently borrow the Sonnet key/provider.
 */

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("deepseekChatterProvider returns null when DEEPSEEK_API_KEY is unset -- no silent reuse of AI_API_KEY", () => {
  withEnv({ DEEPSEEK_API_KEY: undefined, AI_API_KEY: "sk-primary-test" }, () => {
    assert.equal(deepseekChatterProvider(), null);
  });
});

test("deepseekChatterProvider defaults to deepseek-v4-flash and the official DeepSeek base URL", () => {
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: undefined, DEEPSEEK_BASE_URL: undefined }, () => {
    const p = deepseekChatterProvider();
    assert.ok(p);
    assert.equal(p?.provider, "openai");
    assert.equal(p?.apiKey, "sk-deepseek-test");
    assert.equal(p?.baseUrl, "https://api.deepseek.com");
    assert.equal(p?.model, "deepseek-v4-flash");
  });
});

test("deepseekChatterProvider honors explicit model/base-url overrides (Flash -> Pro is a config change)", () => {
  withEnv({ DEEPSEEK_API_KEY: "sk-deepseek-test", DEEPSEEK_CHATTER_MODEL: "deepseek-v4-pro", DEEPSEEK_BASE_URL: "https://gateway.example.com/" }, () => {
    const p = deepseekChatterProvider();
    assert.equal(p?.model, "deepseek-v4-pro");
    // trailing slash stripped, same as the other baseUrl resolvers in this file
    assert.equal(p?.baseUrl, "https://gateway.example.com");
  });
});
