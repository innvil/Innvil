import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSightengineNudity, classifyImageBytesViaSightengine, sightengineConfigured, type SightengineNudityClasses } from "./sightengine-provider";

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

const CONFIGURED_ENV = { SIGHTENGINE_API_USER: "test-user", SIGHTENGINE_API_SECRET: "test-secret" };

/* ==================================================== normalizeSightengineNudity ==== */
/* Pure mapping tests -- no network. Each documents WHY a given Sightengine
 * class combination lands where it does (per the file header's threshold
 * rationale), matching the required "document why each class contributes to
 * explicit/uncertain/safe" instruction. */

function classes(overrides: SightengineNudityClasses): SightengineNudityClasses {
  return { sexual_activity: 0, sexual_display: 0, erotica: 0, very_suggestive: 0, suggestive: 0, mildly_suggestive: 0, none: 1, ...overrides };
}

test("REQUIRED (case 1/2): high-confidence sexual_activity or sexual_display -> EXPLICIT/high", () => {
  const a = normalizeSightengineNudity(classes({ sexual_activity: 0.97 }));
  const b = normalizeSightengineNudity(classes({ sexual_display: 0.95 }));
  assert.equal(a.ok, true); if (a.ok) { assert.equal(a.verdict, "explicit"); assert.equal(a.confidence, "high"); }
  assert.equal(b.ok, true); if (b.ok) { assert.equal(b.verdict, "explicit"); assert.equal(b.confidence, "high"); }
});

test("moderate (not high-confidence) sexual_activity/sexual_display/erotica -> EXPLICIT/medium (borderline, not instant ban)", () => {
  const a = normalizeSightengineNudity(classes({ sexual_activity: 0.7 }));
  const b = normalizeSightengineNudity(classes({ erotica: 0.65 }));
  assert.equal(a.ok, true); if (a.ok) { assert.equal(a.verdict, "explicit"); assert.equal(a.confidence, "medium"); }
  assert.equal(b.ok, true); if (b.ok) { assert.equal(b.verdict, "explicit"); assert.equal(b.confidence, "medium"); }
});

test("REQUIRED (case 4): high erotica/very_suggestive without a strong sexual_activity/display signal -> UNCERTAIN/high, not EXPLICIT", () => {
  const a = normalizeSightengineNudity(classes({ erotica: 0.58 }));
  const b = normalizeSightengineNudity(classes({ very_suggestive: 0.6 }));
  assert.equal(a.ok, true); if (a.ok) assert.equal(a.verdict, "uncertain");
  assert.equal(b.ok, true); if (b.ok) assert.equal(b.verdict, "uncertain");
});

test("REQUIRED (case 3): a clearly safe response (none high, all other classes near zero) -> SAFE", () => {
  const result = normalizeSightengineNudity(classes({ none: 0.99 }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.verdict, "safe");
});

test("REQUIRED (case 5): swimwear/beach-style content must NOT become EXPLICIT merely from skin exposure -- sexual_activity/display/erotica stay low even when suggestive/mildly_suggestive register", () => {
  // Sightengine's own nudity-2.1 model scores ordinary swimwear/beach photos
  // low on sexual_activity/sexual_display/erotica specifically (those
  // classes exist to distinguish explicit content from mere skin exposure);
  // a beach photo instead registers on suggestive/mildly_suggestive, which
  // this policy deliberately treats as, at most, UNCERTAIN -- never EXPLICIT.
  const result = normalizeSightengineNudity(classes({ suggestive: 0.4, mildly_suggestive: 0.3, none: 0.2 }));
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.verdict, "explicit");
});

test("REQUIRED (case 6): fitness/shirtless imagery with no explicit signal -> no false EXPLICIT action", () => {
  const result = normalizeSightengineNudity(classes({ mildly_suggestive: 0.35, none: 0.5 }));
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.verdict, "explicit");
});

test("REQUIRED (case 7): a response with no elevated explicit-content classes (e.g. medical/breastfeeding-style imagery scored safe by the provider) never triggers automatic EXPLICIT action", () => {
  const result = normalizeSightengineNudity(classes({ erotica: 0.1, none: 0.85 }));
  assert.equal(result.ok, true);
  if (result.ok) assert.notEqual(result.verdict, "explicit");
});

test("missing/undefined class fields default to 0, never treated as high-signal", () => {
  const result = normalizeSightengineNudity({});
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.verdict, "safe");
});

/* ==================================================== classifyImageBytesViaSightengine (HTTP) ==== */

test("REQUIRED (case 13): unconfigured credentials -> provider_unconfigured, zero network calls", async () => {
  let called = false;
  const originalFetch = global.fetch;
  global.fetch = async () => { called = true; throw new Error("should not be called"); };
  try {
    await withEnv({ SIGHTENGINE_API_USER: undefined, SIGHTENGINE_API_SECRET: undefined }, async () => {
      assert.equal(sightengineConfigured(), false);
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_unconfigured" });
      assert.equal(called, false);
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("a well-formed successful response is normalized end-to-end through the real HTTP path", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: "success", nudity: { sexual_activity: 0.02, sexual_display: 0.01, erotica: 0.01, very_suggestive: 0.02, suggestive: 0.03, mildly_suggestive: 0.05, none: 0.95 } }), { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.verdict, "safe");
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("REQUIRED (case 8): a 401 response -> provider_auth_failed, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("unauthorized", { status: 401 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_auth_failed" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 8): a 403 response -> provider_auth_failed", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("forbidden", { status: 403 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_auth_failed" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 9): a 429 response -> provider_rate_limited, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("too many requests", { status: 429 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_rate_limited" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 10): a 500 response -> provider_error, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("server error", { status: 500 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 11): a network throw -> provider_error, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new TypeError("network down"); };
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 11): a timeout (abort) -> provider_timeout, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      const err = new Error("aborted"); err.name = "AbortError"; reject(err);
    });
  });
  try {
    await withEnv({ ...CONFIGURED_ENV, MEDIA_SAFETY_TIMEOUT_MS: "10" }, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_timeout" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 12): malformed (non-JSON) response body -> provider_error, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("not json{{{", { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally { global.fetch = originalFetch; }
});

test("a well-formed 200 response missing the expected nudity object -> provider_error (missing classification fields), never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: "success" }), { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally { global.fetch = originalFetch; }
});

test("Sightengine's own status:failure envelope with a credential-shaped error maps to provider_auth_failed", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: "failure", error: { type: "access_denied", code: 33, message: "Invalid api_user/api_secret credential" } }), { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_auth_failed" });
    });
  } finally { global.fetch = originalFetch; }
});

test("Sightengine's own status:failure envelope with a quota-shaped error maps to provider_rate_limited", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: "failure", error: { type: "usage_limit", message: "You have reached your monthly quota" } }), { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_rate_limited" });
    });
  } finally { global.fetch = originalFetch; }
});

test("Sightengine's own status:failure envelope with an unrecognized error type falls back to provider_error, never explicit", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: "failure", error: { type: "bad_media_format", message: "could not decode image" } }), { status: 200 });
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.deepEqual(result, { ok: false, failure: "provider_error" });
    });
  } finally { global.fetch = originalFetch; }
});

test("REQUIRED (case 14): the api_secret never appears in the resolved failure result (nothing beyond a named failure kind is ever returned to the caller)", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response("unauthorized", { status: 401 });
  try {
    await withEnv({ SIGHTENGINE_API_USER: "test-user", SIGHTENGINE_API_SECRET: "super-secret-value-should-never-leak" }, async () => {
      const result = await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes("super-secret-value-should-never-leak"));
    });
  } finally { global.fetch = originalFetch; }
});

test("credentials are sent as multipart form fields (api_user/api_secret), never in the URL or as a bearer header", async () => {
  const originalFetch = global.fetch;
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;
  global.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init;
    return new Response(JSON.stringify({ status: "success", nudity: { none: 1 } }), { status: 200 });
  };
  try {
    await withEnv(CONFIGURED_ENV, async () => {
      await classifyImageBytesViaSightengine(Buffer.from("x"), "image/jpeg");
      assert.ok(capturedUrl);
      assert.ok(!capturedUrl!.includes("test-secret"));
      assert.ok(!capturedUrl!.includes("api_secret"));
      assert.ok(capturedInit!.body instanceof FormData);
      const headers = capturedInit!.headers as Record<string, string> | undefined;
      if (headers) assert.ok(!("authorization" in headers));
    });
  } finally { global.fetch = originalFetch; }
});
