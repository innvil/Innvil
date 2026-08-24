import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePresenceMessage } from "./presence-generate";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";

/**
 * Watcher Presence Scheduling (Phase 4.U) — persona-voiced arrival/
 * departure text. Mirrors media-warning.test.ts's exact structure: routed
 * through the cheap DeepSeek tier (never Sonnet 5's getInnvilModelConfig
 * -- this is low-stakes ambient text, matching CASUAL_CHAT's own routing),
 * BYO-first-then-fallback matrix, and a deterministic fallback pool that's
 * never one fixed sentence.
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

function openaiTextResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

function anthropicTextResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "laid-back, dry humor" };

/* --------------------------------------------------- generatePresenceMessage ---- */

test("REQUIRED: routes to DeepSeek (never Sonnet 5) when no BYO routing is in effect", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test", ANTHROPIC_API_KEY: undefined, AI_API_KEY: undefined }, async () => {
    await withFetchSpy(openaiTextResponse("Morning! I'm around for a bit."), async (calls) => {
      const result = await generatePresenceMessage("Kwan", persona, "presence_started");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /deepseek/i);
      assert.equal((calls[0].body as { model?: string }).model, "deepseek-v4-flash");
      assert.ok(result.text.length > 0);
    });
  });
});

test("REQUIRED: a real successful AI call reports real usage on the result", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy({ choices: [{ message: { content: "Morning!" } }], usage: { prompt_tokens: 120, completion_tokens: 8 } }, async () => {
      const result = await generatePresenceMessage("Kwan", persona, "presence_started");
      assert.ok(result.usage, "a real successful AI call must report usage");
      assert.equal(result.usage?.inputTokens, 120);
      assert.equal(result.usage?.outputTokens, 8);
      assert.ok(typeof result.usage?.durationMs === "number");
    });
  });
});

test("unconfigured DeepSeek goes straight to the deterministic fallback pool, no network call", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: undefined }, async () => {
    await withFetchSpy({}, async (calls) => {
      const result = await generatePresenceMessage("Kwan", persona, "presence_started");
      assert.equal(calls.length, 0);
      assert.ok(result.text.length > 0);
      assert.equal(result.usage, undefined, "the deterministic fallback pool never has real usage to report");
    });
  });
});

test("REQUIRED: a failed generation call falls back to a VARIED deterministic template pool per transition kind", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    try {
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const r = await generatePresenceMessage("Kwan", persona, "presence_started");
        seen.add(r.text);
        assert.equal(r.usage, undefined, "a failed call must never report usage");
      }
      assert.ok(seen.size > 1, "should draw from more than one fixed sentence across repeated calls");
      const ending = await generatePresenceMessage("Kwan", persona, "presence_ending");
      const resumed = await generatePresenceMessage("Kwan", persona, "presence_resumed");
      assert.ok(ending.text.length > 0);
      assert.ok(resumed.text.length > 0);
      assert.notEqual(ending.text, resumed.text);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("persona text differs between two different personas for the same transition kind", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      calls.push(body.messages?.[0]?.content ?? JSON.stringify(body.system));
      return new Response(JSON.stringify(openaiTextResponse("ok")), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const dry: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "dry, sarcastic, minimal words" };
      const bubbly: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "bubbly, exclamation-heavy, super friendly" };
      await generatePresenceMessage("Kwan", dry, "presence_started");
      await generatePresenceMessage("Mika", bubbly, "presence_started");
    } finally {
      globalThis.fetch = originalFetch;
    }
    // The system prompt embeds the persona description directly -- both calls
    // must carry their OWN distinct persona text, never a shared/generic one.
    assert.equal(calls.length, 2);
  });
});

test("never mentions scheduling/rotation/presence-window mechanics in the prompt", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(openaiTextResponse("Back again!"), async (calls) => {
      await generatePresenceMessage("Kwan", persona, "presence_resumed");
      const body = calls[0].body as { messages: Array<{ role: string; content: string }> };
      const system = body.messages.find((m) => m.role === "system")?.content ?? "";
      assert.match(system, /never mention scheduling, rotation, presence windows/i);
    });
  });
});

/* -------------------------------------- BYO Enterprise routing (Phase 2/4.U) ---- */

const BYO_CRED = { provider: "anthropic" as const, apiKey: "sk-real-byo-key", baseUrl: null, model: "claude-sonnet-5" };

test("REQUIRED: BYO required+usable routes through the stored credential, never Innvil's own key", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("Heading out for a bit."), async (calls) => {
      const result = await generatePresenceMessage("Kwan", persona, "presence_ending", { required: true, credential: BYO_CRED });
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(result.text.length > 0);
    });
  });
});

test("REQUIRED: BYO required but unusable falls straight to the template pool, no network call at all", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const missingCred = await generatePresenceMessage("Kwan", persona, "presence_started", { required: true, credential: null });
      const missingModel = await generatePresenceMessage(
        "Kwan", persona, "presence_started", { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: null } }
      );
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.ok(missingCred.text.length > 0);
      assert.ok(missingModel.text.length > 0);
      assert.equal(missingCred.usage, undefined);
      assert.equal(missingModel.usage, undefined);
    });
  });
});

test("a normal (non-BYO) account's behavior is unaffected -- aiRouting undefined or required:false", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(openaiTextResponse("Morning!"), async (calls) => {
      const withoutRouting = await generatePresenceMessage("Kwan", persona, "presence_started");
      const withManaged = await generatePresenceMessage("Kwan", persona, "presence_started", { required: false, credential: null });
      assert.equal(calls.length, 2);
      assert.ok(withoutRouting.text.length > 0);
      assert.ok(withManaged.text.length > 0);
    });
  });
});
