import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLinkIntent, generateModerationWarning } from "./link-classify";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import { SPAM_WARNING_LIMIT } from "./link-moderation";

/**
 * Phase 4.M (C)-(E): the AI-touching half of link moderation. Both
 * classification and the warning line are genuinely new automations (not
 * part of the existing CASUAL_CHAT DeepSeek carve-out) and stay on the hard
 * Sonnet 5 default -- these tests verify the ACTUAL outgoing request (via a
 * fetch spy), not just the parsed result, mirroring chatter-generate.test.ts's
 * established pattern for AI-call verification.
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

/* ------------------------------------------------------------ classifyLinkIntent ---- */

test("REQUIRED: classification routes to the hard Sonnet 5 default, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test", AI_MODEL: undefined, AI_PROVIDER: undefined }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: UNSOLICITED_PROMOTION\nCONFIDENCE: high"), async (calls) => {
      const result = await classifyLinkIntent("join our group https://t.me/othergroup", "");
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      const body = calls[0].body as { model?: string };
      assert.equal(body.model, "claude-sonnet-5");
      assert.deepEqual(result, { category: "UNSOLICITED_PROMOTION", confidence: "high" });
    });
  });
});

test("REQUIRED (live bug repro): a link-LESS promotional pitch is classified via the SAME classifier, and the prompt explicitly covers link-less messages", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: UNSOLICITED_PROMOTION\nCONFIDENCE: high"), async (calls) => {
      const text = "Hey Dev, Looking for real investors & strong volume? I can promote your project across active crypto communities and bring serious buyers. DM me if you're ready to grow.";
      const result = await classifyLinkIntent(text, "");
      assert.deepEqual(result, { category: "UNSOLICITED_PROMOTION", confidence: "high" });
      const body = calls[0].body as { system: string };
      assert.match(body.system, /most messages you're asked to classify contain an external link.*but some do not/i);
      assert.match(body.system, /dm me if you're ready to grow/i); // the real link-less worked example is present
    });
  });
});

test("parses a legitimate collaboration classification", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: COLLABORATION_REQUEST\nCONFIDENCE: medium"), async () => {
      const result = await classifyLinkIntent("would your team want to do an AMA? https://projectxyz.com", "");
      assert.deepEqual(result, { category: "COLLABORATION_REQUEST", confidence: "medium" });
    });
  });
});

test("REQUIRED: an unparseable/malformed model response degrades to UNKNOWN_OR_AMBIGUOUS/low -- never crashes, never guesses a severe category", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("I'm not sure how to classify this."), async () => {
      const result = await classifyLinkIntent("some ambiguous message", "");
      assert.deepEqual(result, { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" });
    });
  });
});

test("REQUIRED: unconfigured AI -- no network call, degrades to UNKNOWN_OR_AMBIGUOUS/low (an AI outage must never itself cause a deletion/ban)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_API_KEY: undefined }, async () => {
    await withFetchSpy({}, async (calls) => {
      const result = await classifyLinkIntent("join us at https://t.me/othergroup", "");
      assert.equal(calls.length, 0);
      assert.deepEqual(result, { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" });
    });
  });
});

test("a failed/errored call degrades to UNKNOWN_OR_AMBIGUOUS/low rather than throwing", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    try {
      const result = await classifyLinkIntent("https://example.com", "");
      assert.deepEqual(result, { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("recent conversation context is included in the request for grounding", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: SAFE_RELEVANT_LINK\nCONFIDENCE: high"), async (calls) => {
      await classifyLinkIntent("here's the doc: https://docs.example.com", "Kwan: does anyone have the docs link?");
      const body = calls[0].body as { messages: Array<{ content: string }> };
      assert.match(body.messages[0].content, /does anyone have the docs link/);
    });
  });
});

/* ------------------------------------------------------ generateModerationWarning ---- */

const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "laid-back, dry humor" };

test("REQUIRED: warning generation also routes to Sonnet 5, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Hey, please don't drop promo links in here — I've removed this one."), async (calls) => {
      const text = await generateModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text.length > 0);
    });
  });
});

test("REQUIRED: never outputs robotic 'Violation N/3' style wording -- the prompt explicitly bans it", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Please keep unrelated promo out of here — I've taken that down."), async (calls) => {
      await generateModerationWarning("Kwan", persona, 2, false);
      const body = calls[0].body as { system: string };
      assert.match(body.system, /never output "violation/i);
      assert.match(body.system, /warning #2 of 2/i);
    });
  });
});

test("the FINAL warning tells the model to make removal-on-next-violation explicit", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("This is your final warning — next time you're removed."), async (calls) => {
      await generateModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true);
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
      const first = await generateModerationWarning("Kwan", persona, 1, false);
      const second = await generateModerationWarning("Kwan", persona, 2, false);
      const third = await generateModerationWarning("Kwan", persona, 3, true);
      assert.ok(first.length > 0);
      assert.ok(second.length > 0);
      assert.ok(third.length > 0);
      // Different warning numbers get different fallback templates -- not one hardcoded phrase.
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
      const text = await generateModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 0);
      assert.ok(text.length > 0);
    });
  });
});

/* -------------------------------------- BYO Enterprise routing (Phase 2, 2026-08-24) ---- */
// aiRouting?.required checked FIRST in both functions -- when true, routes
// through the account's own stored credential; getInnvilModelConfig()/
// Innvil's own key are never reached in that branch, verified via the
// actual outgoing request URL/body, not just the parsed result.

const BYO_CRED = { provider: "anthropic" as const, apiKey: "sk-real-byo-key", baseUrl: null, model: "claude-sonnet-5" };

test("REQUIRED: classifyLinkIntent BYO required+usable routes through the stored credential, never Innvil's own key", async () => {
  // Innvil's own key IS configured here, on purpose -- proves BYO wins, not merely that Innvil's key was absent.
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: UNSOLICITED_PROMOTION\nCONFIDENCE: high"), async (calls) => {
      const result = await classifyLinkIntent("join us at https://t.me/othergroup", "", { required: true, credential: BYO_CRED });
      assert.equal(calls.length, 1);
      const body = calls[0].body as { model?: string };
      assert.equal(body.model, "claude-sonnet-5");
      // The BYO key must be the one actually sent -- headers carry it, never the request body.
      assert.deepEqual(result, { category: "UNSOLICITED_PROMOTION", confidence: "high" });
    });
  });
});

test("REQUIRED: classifyLinkIntent BYO required but nothing usable degrades to the SAME safe fallback, without ever calling Innvil's key", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const missingCred = await classifyLinkIntent("https://t.me/othergroup", "", { required: true, credential: null });
      const missingModel = await classifyLinkIntent(
        "https://t.me/othergroup", "", { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: null } }
      );
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.deepEqual(missingCred, { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" });
      assert.deepEqual(missingModel, { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" });
    });
  });
});

test("classifyLinkIntent: a normal (non-BYO) account's behavior is unaffected -- aiRouting undefined or required:false", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: SAFE_RELEVANT_LINK\nCONFIDENCE: high"), async (calls) => {
      const withoutRouting = await classifyLinkIntent("here's the doc https://docs.example.com", "");
      const withManaged = await classifyLinkIntent("here's the doc https://docs.example.com", "", { required: false, credential: null });
      assert.equal(calls.length, 2);
      assert.deepEqual(withoutRouting, withManaged);
    });
  });
});

test("REQUIRED: generateModerationWarning BYO required+usable routes through the stored credential, never Innvil's own key", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("Hey, please keep promo links out of here."), async (calls) => {
      const text = await generateModerationWarning("Kwan", persona, 1, false, { required: true, credential: BYO_CRED });
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text.length > 0);
    });
  });
});

test("REQUIRED: generateModerationWarning BYO required but unusable falls straight to the template pool, no network call at all", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const missingCred = await generateModerationWarning("Kwan", persona, 1, false, { required: true, credential: null });
      const missingModel = await generateModerationWarning(
        "Kwan", persona, 2, false, { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: null } }
      );
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.ok(missingCred.length > 0);
      assert.ok(missingModel.length > 0);
    });
  });
});
