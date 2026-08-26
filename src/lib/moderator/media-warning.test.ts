import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMediaModerationWarning } from "./media-warning";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import { SPAM_WARNING_LIMIT } from "./link-moderation";

/**
 * The AI-touching half of media (photo/video) moderation's borderline-
 * result warning text -- mirrors link-classify.test.ts's exact structure
 * (same hard Sonnet 5 default, same "never robotic wording" requirement,
 * same deterministic fallback pool). Also covers BYO Enterprise routing
 * (Phase 2, 2026-08-24): `aiRouting?.required` is checked FIRST -- when
 * true, generation routes through the account's own stored credential,
 * and `aiConfigured()`/Innvil's own key are never reached in that branch.
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

const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "laid-back, dry humor" };

/* ------------------------------------------------- generateMediaModerationWarning ---- */

test("REQUIRED: warning generation routes to Sonnet 5, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Hey, that upload looked borderline so I've taken it down."), async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text.length > 0);
    });
  });
});

test("REQUIRED: never outputs robotic 'Violation N/3' style wording -- the prompt explicitly bans it", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Please keep uploads appropriate -- I've removed that one."), async (calls) => {
      await generateMediaModerationWarning("Kwan", persona, 2, false);
      const body = calls[0].body as { system: string };
      assert.match(body.system, /never output "violation/i);
      assert.match(body.system, /warning #2 of 2/i);
    });
  });
});

test("the FINAL warning tells the model to make removal-on-next-violation explicit", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("This is your final warning -- next time you're removed."), async (calls) => {
      await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true);
      const body = calls[0].body as { system: string };
      assert.match(body.system, /FINAL warning/);
    });
  });
});

test("REQUIRED: a failed generation call falls back to a VARIED deterministic template pool, never one fixed sentence", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    try {
      const first = await generateMediaModerationWarning("Kwan", persona, 1, false);
      const second = await generateMediaModerationWarning("Kwan", persona, 2, false);
      const third = await generateMediaModerationWarning("Kwan", persona, 3, true);
      assert.ok(first.length > 0);
      assert.ok(second.length > 0);
      assert.ok(third.length > 0);
      assert.notEqual(first, second);
      assert.notEqual(second, third);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("unconfigured AI goes straight to the deterministic fallback pool, no network call", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_API_KEY: undefined }, async () => {
    await withFetchSpy({}, async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 0);
      assert.ok(text.length > 0);
    });
  });
});

/* -------------------------------------- BYO Enterprise routing (Phase 2, 2026-08-24) ---- */

const BYO_CRED = { provider: "anthropic" as const, apiKey: "sk-real-byo-key", baseUrl: null, model: "claude-sonnet-5" };

test("REQUIRED: BYO required+usable routes through the stored credential, never Innvil's own key", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("Hey, keep uploads appropriate please."), async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: true, credential: BYO_CRED });
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text.length > 0);
    });
  });
});

test("REQUIRED: BYO required but unusable falls straight to the template pool, no network call at all", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const missingCred = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: true, credential: null });
      const missingModel = await generateMediaModerationWarning(
        "Kwan", persona, 2, false, { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: null } }
      );
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.ok(missingCred.length > 0);
      assert.ok(missingModel.length > 0);
    });
  });
});

test("a normal (non-BYO) account's behavior is unaffected -- aiRouting undefined or required:false", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Please keep uploads appropriate here."), async (calls) => {
      const withoutRouting = await generateMediaModerationWarning("Kwan", persona, 1, false);
      const withManaged = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: false, credential: null });
      assert.equal(calls.length, 2);
      assert.ok(withoutRouting.length > 0);
      assert.ok(withManaged.length > 0);
    });
  });
});
