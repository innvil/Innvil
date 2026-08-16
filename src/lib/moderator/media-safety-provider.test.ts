import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyImageBytes } from "./media-safety-provider";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>) {
  const prior: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) prior[k] = process.env[k];
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prior)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test("REQUIRED (CASE 5): an unconfigured provider (no URL/key set) fails explicitly -- never fabricates a verdict, never calls fetch", async () => {
  const originalFetch = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw new Error("should not be called"); };
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: undefined, MEDIA_SAFETY_PROVIDER_API_KEY: undefined }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_unconfigured" });
      assert.equal(called, false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a configured provider returning a valid verdict is normalized correctly", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ verdict: "explicit", confidence: "high", reason: "test" }), { status: 200 });
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "k" }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: true, verdict: "explicit", confidence: "high", reason: "test" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED (CASE 5): a non-2xx HTTP response fails explicitly rather than being treated as a verdict", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("server error", { status: 500 });
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "k" }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED (CASE 5): a malformed/unrecognized response body fails explicitly -- never guesses a verdict", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ verdict: "maybe-nsfw", confidence: "very high" }), { status: 200 });
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "k" }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED (CASE 5): a network-level throw (e.g. connection refused) fails explicitly, not a fabricated verdict", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "k" }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED (CASE 5): an aborted/timed-out request is reported as a distinct provider_timeout failure", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  };
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "k", MEDIA_SAFETY_TIMEOUT_MS: "10" }, async () => {
      const result = await classifyImageBytes(Buffer.from("fake"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_timeout" });
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("the raw image bytes are sent as the request body with the given mime type as content-type", async () => {
  const originalFetch = global.fetch;
  let capturedInit: RequestInit | undefined;
  global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    capturedInit = init;
    return new Response(JSON.stringify({ verdict: "safe", confidence: "high" }), { status: 200 });
  };
  try {
    await withEnv({ MEDIA_SAFETY_PROVIDER_URL: "https://example.test/classify", MEDIA_SAFETY_PROVIDER_API_KEY: "secret-key" }, async () => {
      await classifyImageBytes(Buffer.from([1, 2, 3]), "image/png");
      assert.ok(capturedInit);
      const headers = capturedInit!.headers as Record<string, string>;
      assert.equal(headers["content-type"], "image/png");
      assert.equal(headers["authorization"], "Bearer secret-key");
      assert.ok(capturedInit!.body instanceof Uint8Array);
    });
  } finally {
    global.fetch = originalFetch;
  }
});
