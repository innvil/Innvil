import { test } from "node:test";
import assert from "node:assert/strict";
import { INNVIL_REQUIRED_MODEL, assertInnvilModel, getInnvilModelConfig, deepseekChatterProvider, aiComplete } from "./client";

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

/**
 * REQUIRED (live correction): DeepSeek V4 defaults thinking to ENABLED and
 * needs the explicit `thinking: { type: "disabled" }` request field -- the
 * model id alone ("deepseek-v4-flash") is not sufficient. This must be sent
 * by the OpenAI-compatible request path in THIS file (the provider/client
 * layer), never constructed by moderator code. Verified against the actual
 * outgoing request body, not just the resolved route.
 */

async function withFetchSpy<T>(responseBody: unknown, fn: (calls: Array<{ url: string; body: unknown }>) => Promise<T>): Promise<T> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(responseBody), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("REQUIRED: disableThinking sends thinking:{type:\"disabled\"} on the OpenAI-compatible (DeepSeek) request path", async () => {
  await withFetchSpy({ choices: [{ message: { content: "hey" } }] }, async (calls) => {
    await aiComplete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "deepseek-v4-flash",
      disableThinking: true,
      providerOverride: { provider: "openai", apiKey: "sk-test", baseUrl: "https://api.deepseek.com" },
    });
    assert.equal(calls.length, 1);
    const body = calls[0].body as { thinking?: { type: string } };
    assert.deepEqual(body.thinking, { type: "disabled" });
  });
});

test("without disableThinking, no thinking field is sent on the OpenAI-compatible path", async () => {
  await withFetchSpy({ choices: [{ message: { content: "hey" } }] }, async (calls) => {
    await aiComplete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-test",
      providerOverride: { provider: "openai", apiKey: "sk-test", baseUrl: "https://example.com" },
    });
    const body = calls[0].body as { thinking?: unknown };
    assert.equal(body.thinking, undefined);
  });
});

/**
 * Live incident fix: a Telegram webhook (30s platform maxDuration) was
 * killed with ZERO trace after a provider sent response HEADERS promptly
 * but the BODY stalled -- the previous implementation cleared the abort
 * timer as soon as fetch() resolved (headers only), leaving the subsequent
 * res.json()/res.text() call completely unprotected. postJson() now reads
 * the body INSIDE the same abort scope, so a stalled body is aborted within
 * the configured timeout instead of hanging indefinitely.
 */

async function flushMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("REQUIRED (live incident fix): headers arrive instantly but the BODY never resolves -- still aborted within the configured timeout, not left hanging", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let bodyReadStarted = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    // Headers "arrive" immediately (fetch() resolves right away) -- only the
    // BODY read hangs, exactly the live incident's failure shape.
    return {
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          bodyReadStarted = true;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
          // Deliberately never resolves otherwise -- simulates a stalled body.
        }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const promise = aiComplete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "deepseek-v4-flash",
      providerOverride: { provider: "openai", apiKey: "sk-test", baseUrl: "https://api.deepseek.com" },
    });
    // Let the fetch()->text() chain actually start (attach the abort
    // listener) before advancing the fake clock past it.
    await flushMicrotasks();
    assert.equal(bodyReadStarted, true, "test setup invalid -- body read never started");
    // Advance past the configured AI request timeout (12s) -- fake timers
    // make this instant, not a real 12-second wait.
    t.mock.timers.tick(12_000);
    await assert.rejects(promise, /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a fetch() that never even resolves headers is also aborted within the configured timeout (the original, already-working case)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    })) as typeof fetch;

  try {
    const promise = aiComplete({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      model: "deepseek-v4-flash",
      providerOverride: { provider: "openai", apiKey: "sk-test", baseUrl: "https://api.deepseek.com" },
    });
    await flushMicrotasks();
    t.mock.timers.tick(12_000);
    await assert.rejects(promise, /timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
