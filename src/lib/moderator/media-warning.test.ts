import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMediaModerationWarning } from "./media-warning";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import { SPAM_WARNING_LIMIT } from "./link-moderation";

/**
 * media-warning.ts previously interpolated only `persona.description` as a
 * bare string -- the exact same bug pattern the live-reported solicitation-
 * warning issue was traced to (see link-classify.test.ts's own "Persona-
 * based moderation wording" section). This file mirrors that test file's
 * established conventions (a fetch spy verifying the ACTUAL outgoing
 * request, never just the parsed result) applied to the media-moderation
 * warning path specifically. This is the FIRST dedicated test file for
 * media-warning.ts.
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

function multiCallFetchSpy(responses: string[]): { calls: Array<{ url: string; body: unknown }>; install: () => () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const install = () => {
    const originalFetch = globalThis.fetch;
    let i = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const text = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(JSON.stringify(deepseekTextResponse(text)), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  };
  return { calls, install };
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

/** DeepSeek/OpenAI-compatible response shape -- generateMediaModerationWarning
 *  (2026-09-06, explicit product decision) now routes through
 *  deepseekChatterProvider() for its non-BYO generation, same as
 *  chatter-generate.ts's CASUAL_CHAT and link-classify.ts's warning generators. */
function deepseekTextResponse(text: string) {
  return { choices: [{ message: { content: text } }] };
}

/** Extracts the system-prompt text regardless of provider shape -- Anthropic
 *  sends a top-level `system` field; DeepSeek/OpenAI-compatible sends it as
 *  the first `messages` entry, role "system" (client.ts's openaiComplete()). */
function systemOf(body: unknown): string {
  const b = body as { system?: string; messages?: Array<{ role: string; content: string }> };
  if (typeof b.system === "string") return b.system;
  return b.messages?.find((m) => m.role === "system")?.content ?? "";
}

const FORMAL_PERSONA: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, formal: true, formality: 90, slang: 5, description: "" };
const CASUAL_PERSONA: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, formal: false, formality: 10, slang: 85, description: "" };
const persona: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, description: "laid-back, dry humor" };

/* ------------------------------------------------------------ persona voicing ---- */

test("REQUIRED: persona is included and respected -- the system prompt carries real style mechanics derived from the configured persona, not just a bare description sentence", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("hey, keep uploads appropriate please."), async (calls) => {
      await generateMediaModerationWarning("Kwan", FORMAL_PERSONA, 1, false);
      const system = systemOf(calls[0].body);
      assert.match(system, /always capitalize the start/i);
      assert.match(system, /avoid slang/i);
    });
  });
});

test("REQUIRED: two different personas realize the SAME warning differently", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    let formalSystem = "";
    let casualSystem = "";
    await withFetchSpy(deepseekTextResponse("keep it appropriate please."), async (calls) => {
      await generateMediaModerationWarning("Kwan", FORMAL_PERSONA, 1, false);
      formalSystem = systemOf(calls[0].body);
    });
    await withFetchSpy(deepseekTextResponse("keep it appropriate please."), async (calls) => {
      await generateMediaModerationWarning("Kwan", CASUAL_PERSONA, 1, false);
      casualSystem = systemOf(calls[0].body);
    });
    assert.notEqual(formalSystem, casualSystem);
    assert.match(formalSystem, /always capitalize the start/i);
    assert.match(casualSystem, /always write in lowercase/i);
  });
});

test("a bare persona with nothing configured still produces a sensible prompt -- never crashes, never fabricates traits", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("keep it appropriate please."), async (calls) => {
      await generateMediaModerationWarning("Kwan", DEFAULT_MODERATOR_PERSONA, 1, false);
      const system = systemOf(calls[0].body);
      assert.ok(system && system.length > 0);
    });
  });
});

/* ------------------------------------------------------------ escalation stage ---- */

test("the final pre-kick warning is explicitly framed as such -- the model is told the real limit, never left to guess", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("last chance, please stop."), async (calls) => {
      await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true);
      const system = systemOf(calls[0].body);
      // The FINAL warning is the one case where a real consequence must not
      // be misleadingly concealed (spec §16) -- but it's stated as an
      // authorized fact in the persona's own words, never a formal notice.
      assert.match(system, /removed from the group/i);
      assert.match(system, /Not a checklist/i);
    });
  });
});

/* --------------------------------------------------------- anti-repetition ---- */

test("REQUIRED: a near-duplicate candidate triggers exactly ONE bounded regeneration", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const recentOwnWarnings = ["Hey, that media looks like it might not be appropriate for this group, so I've taken it down for now. Please keep uploads appropriate for the community."];
    const { calls, install } = multiCallFetchSpy([
      "Hey, that media isn't appropriate for this group, so I've removed it for now. Please keep uploads appropriate here.",
      "Yeah that one's not staying up -- keep it clean going forward.",
    ]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "exactly one regeneration attempt, never zero, never more than one");
      const retrySystem = systemOf(calls[1].body);
      assert.match(retrySystem, /said something VERY similar to this recently/i);
      assert.equal(text, "Yeah that one's not staying up -- keep it clean going forward.");
    } finally {
      restore();
    }
  });
});

test("REQUIRED: when the candidate is NOT similar to any recent warning, only ONE call is made -- no wasted regeneration", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const recentOwnWarnings = ["That's off-topic and not allowed here."];
    const { calls, install } = multiCallFetchSpy(["Hey, that media isn't appropriate for this group -- I've taken it down."]);
    const restore = install();
    try {
      await generateMediaModerationWarning("Kwan", persona, 1, false, undefined, recentOwnWarnings);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("an empty recentOwnWarnings list never triggers a regeneration, regardless of candidate content", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["Hey, that media isn't appropriate for this group -- I've taken it down."]);
    const restore = install();
    try {
      await generateMediaModerationWarning("Kwan", persona, 1, false, undefined, []);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (mode-aware retry, ENFORCEMENT_NOTICE): a near-duplicate on the FINAL pre-kick warning gets a retry instruction that keeps the removal consequence clear, never a brevity-only instruction", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const recentOwnWarnings = ["Hey, this is your final warning -- one more violation and you're removed from this community."];
    const { calls, install } = multiCallFetchSpy([
      "Hey, this is your final warning -- one more violation and you're removed from this group.",
      "Last chance here -- next one and you're gone for good.",
    ]);
    const restore = install();
    try {
      await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "the two fixture texts must actually register as near-duplicates for this test to exercise the retry path");
      const retrySystem = systemOf(calls[1].body);
      assert.match(retrySystem, /FINAL warning before removal.*still make that consequence clear/i);
      assert.doesNotMatch(retrySystem, /keep this one especially short/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (mode-aware retry, SHORT_NUDGE): a candidate RECOGNIZABLY SIMILAR (but not near-identical) to a recent warning gets the brevity instruction", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    // Chosen to land in the SHORT_NUDGE band specifically (>= NEAR_DUPLICATE_
    // WARNING_THRESHOLD but < NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD, ~0.52
    // measured) -- similar enough to react to, distinguishable enough that
    // it's NOT the "nothing new to say" NO_PUBLIC_REPLY case.
    const recentOwnWarnings = ["Hey, that media isn't appropriate for this group, so I've taken it down for now."];
    const { calls, install } = multiCallFetchSpy([
      "That upload isn't appropriate for this group, so I've gone ahead and removed it.",
      "Not for this group -- gone.",
    ]);
    const restore = install();
    try {
      await generateMediaModerationWarning("Kwan", persona, 1, false, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "the two fixture texts must actually register as similar enough to exercise the retry path");
      const retrySystem = systemOf(calls[1].body);
      assert.match(retrySystem, /keep this one especially short/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (NO_PUBLIC_REPLY): a candidate NEAR-IDENTICAL to a recent warning (no consequence attached) resolves to genuine silence -- null, not another short reply", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const recentOwnWarnings = ["Hey, that media isn't appropriate for this group, so I've taken it down for now. Please keep it appropriate."];
    const { calls, install } = multiCallFetchSpy([
      "Hey, that media isn't appropriate for this group, so I've taken it down for now. Please keep it clean.",
    ]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false, undefined, recentOwnWarnings);
      assert.equal(calls.length, 1, "no retry is attempted for a NO_PUBLIC_REPLY outcome -- there's nothing to vary the wording of");
      assert.equal(text, null);
    } finally {
      restore();
    }
  });
});

test("REQUIRED: a FINAL (consequence-bearing) warning with NOTHING recently similar is returned as-is, without a wasted retry call", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["This is your final warning -- next time results in removal."]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true, undefined, []);
      assert.equal(calls.length, 1, "ENFORCEMENT_NOTICE alone is not a reason to retry -- only a genuine near-duplicate signal is");
      assert.equal(text, "This is your final warning -- next time results in removal.");
    } finally {
      restore();
    }
  });
});

/* --------------------------------------- untrusted-output guard ---- */

test("REQUIRED: media has no mute concept at all -- a candidate stating ANY mute-minute count is discarded for the deterministic fallback", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["That's not allowed -- 10-minute mute for you."]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 1);
      assert.ok(text);
      assert.doesNotMatch(text, /10-minute mute/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED: a candidate claiming a definite ban/removal that hasn't actually happened (this is only a WARN) is discarded", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["You've been removed from this community already."]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 1);
      assert.ok(text);
      assert.doesNotMatch(text, /you've been removed/i);
    } finally {
      restore();
    }
  });
});

test("a hedged future-conditional consequence mention (the FINAL-warning framing itself) is explicitly permitted, never caught by the guard", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["This is your final warning -- next violation results in removal from the community."]);
    const restore = install();
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true);
      assert.equal(calls.length, 1);
      assert.equal(text, "This is your final warning -- next violation results in removal from the community.");
    } finally {
      restore();
    }
  });
});

/* -------------------------------------- generation-failure never blocks enforcement ---- */

test("REQUIRED: a failed generation call falls to the deterministic template pool -- enforcement (the delete/kick decision) never depends on this succeeding", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("server error", { status: 500 });
    }) as typeof fetch;
    try {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(callCount, 1, "exactly one attempt, never a retry after a genuine failure");
      assert.ok(text && text.length > 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/* ============================================================================
 * The tests below PRE-DATE this pass (this file already existed and was
 * committed) -- restored verbatim after being accidentally overwritten by an
 * initial `Write` call that assumed, incorrectly, that no test file existed
 * yet for media-warning.ts. Kept as-is (still valid against the rewritten
 * implementation -- Sonnet-5 routing, the anti-robotic-wording ban, FINAL-
 * warning framing, the varied fallback pool, and BYO Enterprise routing are
 * all completely unchanged by this pass's persona/anti-repetition/guard
 * additions), rather than deleted or silently left out. ========================= */

test("REQUIRED (2026-09-06, explicit product decision): warning generation routes to DeepSeek, never Sonnet 5", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("Hey, that upload looked borderline so I've taken it down."), async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /deepseek/i);
      assert.doesNotMatch(calls[0].url, /anthropic/i);
      const body = calls[0].body as { model?: string; thinking?: { type: string } };
      assert.equal(body.model, "deepseek-flash");
      assert.notEqual(body.model, "claude-sonnet-5");
      assert.equal(body.thinking?.type, "disabled");
      assert.ok(text && text.length > 0);
    });
  });
});

test("REQUIRED: never outputs robotic 'Violation N/3' style wording -- the prompt explicitly bans it", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("Please keep uploads appropriate -- I've removed that one."), async (calls) => {
      await generateMediaModerationWarning("Kwan", persona, 2, false);
      const system = systemOf(calls[0].body);
      assert.match(system, /Not a checklist/i);
      assert.match(system, /time 2/i);
    });
  });
});

test("the FINAL warning tells the model to make removal-on-next-violation explicit", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("This is your final warning -- next time you're removed."), async (calls) => {
      await generateMediaModerationWarning("Kwan", persona, SPAM_WARNING_LIMIT, true);
      const system = systemOf(calls[0].body);
      assert.match(system, /removed from the group/i);
    });
  });
});

test("REQUIRED: a failed generation call falls back to a VARIED deterministic template pool, never one fixed sentence", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
    try {
      const first = await generateMediaModerationWarning("Kwan", persona, 1, false);
      const second = await generateMediaModerationWarning("Kwan", persona, 2, false);
      const third = await generateMediaModerationWarning("Kwan", persona, 3, true);
      assert.ok(first && first.length > 0);
      assert.ok(second && second.length > 0);
      assert.ok(third && third.length > 0);
      assert.notEqual(first, second);
      assert.notEqual(second, third);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("unconfigured AI goes straight to the deterministic fallback pool, no network call", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: undefined }, async () => {
    await withFetchSpy({}, async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false);
      assert.equal(calls.length, 0);
      assert.ok(text && text.length > 0);
    });
  });
});

/* -------------------------------------- BYO Enterprise routing (Phase 2, 2026-08-24) ---- */

const BYO_CRED = { provider: "anthropic" as const, apiKey: "sk-real-byo-key", baseUrl: null, model: "claude-sonnet-5" };

test("REQUIRED: BYO required+usable routes through the CUSTOMER'S OWN stored credential, never Innvil's own DeepSeek key", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("Hey, keep uploads appropriate please."), async (calls) => {
      const text = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: true, credential: BYO_CRED });
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text && text.length > 0);
    });
  });
});

test("REQUIRED: BYO required but unusable falls straight to the template pool, no network call at all", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const missingCred = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: true, credential: null });
      const missingModel = await generateMediaModerationWarning(
        "Kwan", persona, 2, false, { required: true, credential: { provider: "anthropic", apiKey: "sk-real", baseUrl: null, model: null } }
      );
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.ok(missingCred && missingCred.length > 0);
      assert.ok(missingModel && missingModel.length > 0);
    });
  });
});

test("a normal (non-BYO) account's behavior is unaffected -- aiRouting undefined or required:false", async () => {
  await withEnvAsync({ DEEPSEEK_API_KEY: "sk-deepseek-test" }, async () => {
    await withFetchSpy(deepseekTextResponse("Please keep uploads appropriate here."), async (calls) => {
      const withoutRouting = await generateMediaModerationWarning("Kwan", persona, 1, false);
      const withManaged = await generateMediaModerationWarning("Kwan", persona, 1, false, { required: false, credential: null });
      assert.equal(calls.length, 2);
      assert.ok(withoutRouting && withoutRouting.length > 0);
      assert.ok(withManaged && withManaged.length > 0);
    });
  });
});
