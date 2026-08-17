import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyManagerMessageIntent, generateManagerSupportReply, MANAGER_INTENT_CONFIDENCE_THRESHOLD } from "./bot-manager-classify";
import { retrieveProductKnowledge } from "./bot-manager-knowledge";

/**
 * Phase 4.Q — innvil_bot_manager's reactive-support intent/generation layer.
 * Mirrors link-classify.test.ts's fetch-spy pattern to verify the ACTUAL
 * outgoing request routes through the hard Sonnet 5 default, never the
 * DeepSeek CASUAL_CHAT carve-out -- whether an official Innvil answer gets
 * sent at all is a consequential decision, same reasoning as link
 * moderation's own classify/generate split.
 */

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

function anthropicTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

test("REQUIRED: intent classification routes to the hard Sonnet 5 default", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test", AI_MODEL: undefined, AI_PROVIDER: undefined }, async () => {
    await withFetchSpy(anthropicTextResponse("INTENT: INNVIL_PRODUCT_QUESTION\nCONFIDENCE: 0.93"), async (calls) => {
      const result = await classifyManagerMessageIntent("how much commission does innvil take?");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      const body = calls[0].body as { model?: string };
      assert.equal(body.model, "claude-sonnet-5");
      assert.deepEqual(result, { intent: "INNVIL_PRODUCT_QUESTION", confidence: 0.93 });
    });
  });
});

test("an unrelated message classifies as UNRELATED", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("INTENT: UNRELATED\nCONFIDENCE: 0.97"), async () => {
      const result = await classifyManagerMessageIntent("does anyone know a good pizza place nearby?");
      assert.equal(result.intent, "UNRELATED");
    });
  });
});

test("unconfigured AI makes ZERO network calls and degrades to UNRELATED/0 confidence", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_API_KEY: undefined }, async () => {
    await withFetchSpy(anthropicTextResponse("should never be reached"), async (calls) => {
      const result = await classifyManagerMessageIntent("what plans does innvil offer?");
      assert.equal(calls.length, 0);
      assert.deepEqual(result, { intent: "UNRELATED", confidence: 0 });
    });
  });
});

test("a malformed model response degrades to UNRELATED/0 rather than throwing", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("not the expected format at all"), async () => {
      const result = await classifyManagerMessageIntent("anything");
      assert.deepEqual(result, { intent: "UNRELATED", confidence: 0 });
    });
  });
});

test("confidence is clamped to [0,1] even if the model returns something out of range", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("INTENT: INNVIL_PRODUCT_QUESTION\nCONFIDENCE: 1.5"), async () => {
      const result = await classifyManagerMessageIntent("what is innvil?");
      assert.equal(result.confidence, 1);
    });
  });
});

test("MANAGER_INTENT_CONFIDENCE_THRESHOLD is 0.80 per spec", () => {
  assert.equal(MANAGER_INTENT_CONFIDENCE_THRESHOLD, 0.8);
});

/* ------------------------------------------------- generateManagerSupportReply ---- */

test("REQUIRED: with no retrieved knowledge, returns the honest fallback WITHOUT calling the model", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("should never be reached"), async (calls) => {
      const reply = await generateManagerSupportReply("what is innvil?", []);
      assert.equal(calls.length, 0);
      assert.match(reply, /don't have confirmed information/i);
    });
  });
});

test("generation routes to Sonnet 5 and is grounded in the retrieved facts", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const retrieved = retrieveProductKnowledge("what commission does innvil charge?");
    assert.ok(retrieved.length > 0);
    await withFetchSpy(anthropicTextResponse("Innvil charges a 5% commission only on completed orders, no monthly rent."), async (calls) => {
      const reply = await generateManagerSupportReply("what commission does innvil charge?", retrieved);
      assert.equal(calls.length, 1);
      const body = calls[0].body as { model?: string; system?: string };
      assert.equal(body.model, "claude-sonnet-5");
      assert.match(body.system ?? "", /5% commission/);
      assert.match(reply, /5%/);
    });
  });
});

test("a failed generation call falls back to the honest no-info line, never throws", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      const retrieved = retrieveProductKnowledge("innvil pricing");
      const reply = await generateManagerSupportReply("innvil pricing", retrieved);
      assert.match(reply, /don't have confirmed information/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
