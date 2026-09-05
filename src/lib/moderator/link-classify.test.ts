import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyLinkIntent, generateModerationWarning, generatePersonaSolicitationWarning, generatePersonaScamWarning,
  generatePersonaNegativeStatementWarning,
  type SolicitationWarningFacts, type ScamWarningFacts, type NegativeStatementWarningFacts,
} from "./link-classify";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "./domain";
import {
  SPAM_WARNING_LIMIT, SCAM_FIRST_WARNING_MUTE_MINUTES, scamFirstOffenseWarningHtml, scamRepeatOffenseWarningHtml,
  NEGATIVE_STATEMENT_MUTE_MINUTES, NEGATIVE_STATEMENT_BAN_MINUTES,
} from "./link-moderation";

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

// Live feedback (2026-09-02), corrected after an initial misread: "LETS GO,
// SHILL RAID IN @cryptomoonshots_chat and spread the word" is a member
// rallying fellow COMMUNITY members to go INTO another Telegram group
// (@cryptomoonshots_chat) and shill THIS community's OWN project there --
// the mentioned venue is where the raid happens, never itself the thing
// being promoted/advertised. This is standard, allowed crypto-community
// growth activity. The decisive distinction is WHAT is being promoted, never
// WHERE the raid targets: rallying members to promote a DIFFERENT,
// specifically named project ("let's go shill $OTHERCOIN") is its own
// COMPETING_PROJECT_PROMOTION category (a "global no-go", per explicit
// product decision -- see link-moderation.ts's decideLinkEnforcement, which
// never redirects its warning to the community's Promotion channel/topic,
// unlike ordinary UNSOLICITED_PROMOTION).
test("REQUIRED (live feedback): the prompt distinguishes a 'shill raid' promoting THIS community's own project at an external venue (SAFE_RELEVANT_LINK) from rallying members to promote a different named project (its own COMPETING_PROJECT_PROMOTION category)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: SAFE_RELEVANT_LINK\nCONFIDENCE: high"), async (calls) => {
      await classifyLinkIntent("LETS GO, SHILL RAID IN @cryptomoonshots_chat and spread the word", "");
      const body = calls[0].body as { system: string };
      assert.match(body.system, /shill raid/i);
      assert.match(body.system, /venue.*never itself the thing being promoted/i);
      assert.match(body.system, /COMPETING_PROJECT_PROMOTION/);
    });
  });
});

test("REQUIRED: the prompt's own worked example for rallying members to promote a DIFFERENT named project classifies as its own COMPETING_PROJECT_PROMOTION category, distinct from ordinary UNSOLICITED_PROMOTION", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("CATEGORY: COMPETING_PROJECT_PROMOTION\nCONFIDENCE: high"), async (calls) => {
      const result = await classifyLinkIntent("Let's rally and go shill $OTHERCOIN over at @somegroup", "");
      assert.deepEqual(result, { category: "COMPETING_PROJECT_PROMOTION", confidence: "high" });
      const body = calls[0].body as { system: string };
      assert.match(body.system, /\$OTHERCOIN/);
      assert.match(body.system, /is NOT this community's own subject/i);
      assert.match(body.system, /Distinct from ordinary UNSOLICITED_PROMOTION/i);
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

/* ---------------------------------------------- generatePersonaSolicitationWarning ---- */
// Persona-voiced solicitation warning (supersedes the flat deterministic
// template's WORDING per explicit live feedback: "the way it says a
// warning is too generic -- it should be persona based"). Every stated
// FACT must still be exactly as deterministic/accurate as before -- these
// tests verify the ACTUAL outgoing request requires each fact, and that
// the deterministic fallback (used on any generation failure) states them
// all correctly too.

const noMuteFacts: SolicitationWarningFacts = {
  currentTopicName: "General", muteMinutes: undefined, promotionTopicName: null, promotionTopicLink: null, contactHandle: null, warningNumber: 1,
};

test("REQUIRED: persona solicitation warning also routes to Sonnet 5, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("hey, no promos in General please -- pulled that one."), async (calls) => {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text && text.length > 0);
    });
  });
});

test("REQUIRED: the prompt requires the exact current topic name, and states no mute applies when none does", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos in General, thanks!"), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /General/);
      assert.match(system, /no mute applies/i);
    });
  });
});

test("REQUIRED: the prompt requires the exact mute duration verbatim when one applies", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("that resulted in a mute, no promos in General."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 10 });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /10-minute mute/);
    });
  });
});

// Live bug: "Dev I am your friend DM me" got a warning that opened with
// "i'm not the dev and we don't do promo deals over dms" -- this function is
// NEVER given the removed message's raw wording (SolicitationWarningFacts
// carries no such field), so any specific claim/denial the model states
// about what the message said is a pure invention. The correct behavior is
// to enforce the "no promos here" policy without reacting to fabricated
// content from a message the model was never shown.
test("REQUIRED: the prompt states the model was never shown the removed message's wording, and bans reacting to invented specifics from it", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos in General please, thanks!"), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /You were NOT shown the exact wording/i);
      assert.match(system, /never claim or deny being "the dev,"/i);
    });
  });
});

// Corrected 2026-09-02, per explicit live feedback: "it should not send the
// promotion link, it should say promotion" -- the redirect destination is
// now ALWAYS spoken by name only. A raw link/URL must never appear anywhere
// in the outgoing prompt, even when one is technically available on the
// facts object (kept there only for a possible future non-message use, per
// the field's own doc comment -- never read by this function's prompt).
test("REQUIRED: the prompt requires the real configured Promotion destination BY NAME ONLY (never a link), and bans inventing one when none exists", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("head to Promotion instead."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, {
        ...noMuteFacts, promotionTopicName: "Promotion", promotionTopicLink: "https://t.me/c/123/45",
      });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /"Promotion"/);
      assert.match(system, /never a link\/URL of any kind/i);
      assert.doesNotMatch(system, /https:\/\/t\.me\/c\/123\/45/);
    });
  });
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos here, sorry."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /do NOT invent one/i);
    });
  });
});

test("REQUIRED: the prompt never mentions a promotion destination AND a contact together, and asks for genuine brevity", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos here, use Promotion instead."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, {
        ...noMuteFacts, promotionTopicName: "Promotion", contactHandle: "@RhyleKhy",
      });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /at most one destination\/contact/i);
      assert.match(system, /under 30 words/i);
      // Only the Promotion-topic fact is required when both a topic and a
      // contact are configured -- the contact fact is never separately
      // required in this branch (mirrors decideLinkEnforcement's own
      // Forum-topic-first precedence).
      assert.match(system, /"Promotion"/);
    });
  });
});

test("REQUIRED: the prompt requires the real configured contact handle when one exists", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("hit up the contact if you want to talk business."), async (calls) => {
      await generatePersonaSolicitationWarning("Patricia", persona, { ...noMuteFacts, contactHandle: "@RhyleKhy" });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /@RhyleKhy/);
    });
  });
});

// Live requirement (2026-09-02): "it should also be able to recognize a
// different language, if it is a promotion or not, and when it's a
// promotion, it should still give warning in English" -- the violating
// message itself may be in any language (see classifyPitchLikelihood in
// chatter-generate.ts), but the warning text sent back must always be
// English regardless.
test("REQUIRED: the prompt always requires an English warning, regardless of the violating message's own language", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos in General please."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /always write the warning in english/i);
    });
  });
});

// COMPETING_PROJECT_PROMOTION ("global no-go") -- the warning must NEVER
// redirect to the community's real configured Promotion channel/topic or
// contact, even when one genuinely exists, since promoting a rival project
// is never allowed anywhere in the community, not just outside the
// Promotion destination.
test("REQUIRED: a competing-project-promotion warning never redirects to the Promotion destination or contact, even when both are configured (isCompetingProjectPromotion overrides them)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("promoting other projects isn't allowed here at all."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, {
        ...noMuteFacts,
        promotionTopicName: "Promotion", promotionTopicLink: "https://t.me/c/123/45", contactHandle: "@RhyleKhy",
        isCompetingProjectPromotion: true,
      });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /never allowed here, in any form/i);
      assert.match(system, /do NOT suggest any alternative place/i);
      assert.doesNotMatch(system, /"Promotion"/);
      assert.doesNotMatch(system, /https:\/\/t\.me\/c\/123\/45/);
      assert.doesNotMatch(system, /@RhyleKhy/);
    });
  });
  // The deterministic fallback (used on any generation failure) must honor
  // the same rule -- verified with no AI provider configured at all.
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, {
      ...noMuteFacts,
      promotionTopicName: "Promotion", promotionTopicLink: "https://t.me/c/123/45", contactHandle: "@RhyleKhy",
      isCompetingProjectPromotion: true,
    });
    assert.ok(text);
    assert.doesNotMatch(text, /Promotion/);
    assert.doesNotMatch(text, /t\.me/);
    assert.doesNotMatch(text, /RhyleKhy/);
    assert.match(text, /not allowed here, in any form/i);
  });
});

// SEARCH_SPAM (2026-09-03 live feedback: "Search miniairdrops" posted by
// different accounts minutes apart) -- flagged as spam, never as a
// promotion; never redirects to a Promotion destination/contact even when
// one is configured; "coordinated" reads as a general room reminder with no
// specific person named, "isolated" still explicitly addresses the sender.

test("REQUIRED: an ISOLATED search-spam warning states this is off-topic spam, never mentions a Promotion destination or contact even when both are configured", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("that's spam, not allowed here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, {
        ...noMuteFacts,
        promotionTopicName: "Promotion", contactHandle: "@RhyleKhy",
        searchSpamPattern: "isolated",
      });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /off-topic spam/i);
      assert.match(system, /no Promotion destination or contact to mention/i);
      assert.doesNotMatch(system, /"Promotion"/);
      assert.doesNotMatch(system, /@RhyleKhy/);
      // An isolated occurrence still writes "to the person", not "to the room".
      assert.match(system, /warning to the person/i);
    });
  });
});

test("REQUIRED: a COORDINATED search-spam warning reads as a general room reminder and explicitly bans naming the specific sender", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("please stop spamming that here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, {
        ...noMuteFacts,
        searchSpamPattern: "coordinated",
      });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /coordinated pattern/i);
      assert.match(system, /do NOT name, mention, or single out this one specific person/i);
      assert.match(system, /warning to the room/i);
    });
  });
});

test("deterministic fallback (isolated): states the off-topic-spam framing, never 'no promos'/a Promotion redirect", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, {
      ...noMuteFacts, muteMinutes: 10, searchSpamPattern: "isolated",
    });
    assert.equal(text, "No spamming that here, please. This resulted in a 10-minute mute. Repeated offenses escalate to a kick or ban.");
  });
});

test("deterministic fallback (coordinated): a general room reminder, never singles out a name/mention", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, {
      ...noMuteFacts, searchSpamPattern: "coordinated",
    });
    assert.equal(text, "Please stop spamming that here. Repeated offenses escalate to a kick or ban.");
  });
});

test("REQUIRED: falls back to a short deterministic template on any generation failure -- never a broken/missing warning, never speaks a link", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts);
    assert.equal(text, "No promos in General, please. Repeated offenses escalate to a kick or ban.");
  });
});

// Corrected 2026-09-02: the deterministic fallback must obey the SAME
// "at most one destination" and "never a link" rules as the AI-generated
// path -- given both a Promotion topic name AND a contact, only the topic
// name is stated (matching decideLinkEnforcement's own Forum-topic-first
// precedence), and the raw link is never included even though it's present
// on the facts object.
test("deterministic fallback states the mute duration and the Promotion topic NAME only -- never the link, never both a topic and a contact together", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, {
      currentTopicName: "General", muteMinutes: 30, promotionTopicName: "Promotion", promotionTopicLink: "https://t.me/c/1/2", contactHandle: "@RhyleKhy", warningNumber: 2,
    });
    assert.ok(text);
    assert.match(text, /Post that in Promotion instead/);
    assert.match(text, /30-minute mute/);
    assert.doesNotMatch(text, /https:\/\/t\.me\/c\/1\/2/);
    assert.doesNotMatch(text, /@RhyleKhy/);
  });
});

test("deterministic fallback falls back to the contact when no Promotion topic name is known", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const text = await generatePersonaSolicitationWarning("Kwan", persona, {
      currentTopicName: "General", muteMinutes: undefined, promotionTopicName: null, promotionTopicLink: null, contactHandle: "@RhyleKhy", warningNumber: 1,
    });
    assert.ok(text);
    assert.match(text, /For that, contact @RhyleKhy/);
  });
});

test("REQUIRED: BYO required but unusable falls straight to the deterministic fallback, no network call at all", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, noMuteFacts, { required: true, credential: null });
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.ok(text && text.length > 0);
    });
  });
});

/* ===================================================================
   Persona-based moderation wording + anti-repetition (2026-09-04)
   ===================================================================
   Live feedback: a Watcher was repeating near-identical moderation
   warnings across different offenders ("No promo in this topic,
   friend -- that's a 10-min mute..." variants). Fixed by (1) reusing
   Natural Chatter's own persona-realization machinery instead of a bare
   description sentence, (2) an escalation-stage fact so tone can firm up
   across repeat offenses, and (3) a bounded, one-time regeneration when
   the candidate reads as a near-duplicate of this Watcher's own recent
   messages. These tests verify each requirement against the ACTUAL
   outgoing prompt/behavior, not assumptions. */

const FORMAL_PERSONA: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, formal: true, formality: 90, slang: 5, description: "" };
const CASUAL_PERSONA: ModeratorPersona = { ...DEFAULT_MODERATOR_PERSONA, formal: false, formality: 10, slang: 85, description: "" };

/* -------------------------------------------------- (1) persona respected ---- */

test("REQUIRED: persona is included and respected in moderation-language generation -- the system prompt carries real style mechanics derived from the configured persona, not just a bare description sentence", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos in General."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", FORMAL_PERSONA, { ...noMuteFacts, warningNumber: 1 });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /always capitalize the start/i);
      assert.match(system, /avoid slang/i);
    });
  });
});

/* --------------------------------------- (2) two personas, same facts, different voice ---- */

test("REQUIRED: two different personas realize the SAME moderation facts differently", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const facts: SolicitationWarningFacts = { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 };
    let formalSystem = "";
    let casualSystem = "";
    await withFetchSpy(anthropicTextResponse("no promos here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", FORMAL_PERSONA, facts);
      formalSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    await withFetchSpy(anthropicTextResponse("no promos here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", CASUAL_PERSONA, facts);
      casualSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    assert.notEqual(formalSystem, casualSystem);
    assert.match(formalSystem, /always capitalize the start/i);
    assert.match(casualSystem, /always write in lowercase/i);
  });
});

/* ------------------------------------------- (3) facts stay authoritative ---- */

test("REQUIRED: enforcement facts remain authoritative and are IDENTICAL regardless of persona -- only the style mechanics differ", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const facts: SolicitationWarningFacts = { ...noMuteFacts, muteMinutes: 30, promotionTopicName: "Promotion", warningNumber: 3 };
    let formalSystem = "";
    let casualSystem = "";
    await withFetchSpy(anthropicTextResponse("no promos here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", FORMAL_PERSONA, facts);
      formalSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    await withFetchSpy(anthropicTextResponse("no promos here."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", CASUAL_PERSONA, facts);
      casualSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    // The exact facts -- mute duration, topic name, destination, escalation
    // stage -- must be present VERBATIM and IDENTICALLY in both prompts.
    for (const required of [/"General"/, /30-minute mute/, /"Promotion"/, /warning 3 of 4/i]) {
      assert.match(formalSystem, required);
      assert.match(casualSystem, required);
    }
  });
});

test("REQUIRED: a persona can never alter what the fallback (or any generation attempt) states as fact -- the deterministic fallback ignores persona entirely by design", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const facts: SolicitationWarningFacts = { currentTopicName: "General", muteMinutes: 10, promotionTopicName: "Promotion", promotionTopicLink: null, contactHandle: null, warningNumber: 2 };
    const formalText = await generatePersonaSolicitationWarning("Kwan", FORMAL_PERSONA, facts);
    const casualText = await generatePersonaSolicitationWarning("Kwan", CASUAL_PERSONA, facts);
    assert.equal(formalText, casualText);
  });
});

/* --------------------------------------------- escalation-stage tone fact ---- */

test("REQUIRED (Case B): the prompt instructs a firmer tone for repeat offenses, and explicitly states the real warning number/limit -- never left for the model to guess", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 30, warningNumber: 3 });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /warning 3 of 4/i);
      assert.match(system, /sound noticeably firmer/i);
    });
  });
});

test("a first offense is explicitly framed as light/matter-of-fact, not firm", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("no promos."), async (calls) => {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 });
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /first offense/i);
      assert.doesNotMatch(system, /sound noticeably firmer/i);
    });
  });
});

/* --------------------------------------------------------- anti-repetition ---- */

function multiCallFetchSpy(responses: string[]): { calls: Array<{ url: string; body: unknown }>; install: () => () => void } {
  const calls: Array<{ url: string; body: unknown }> = [];
  const install = () => {
    const originalFetch = globalThis.fetch;
    let i = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const text = responses[Math.min(i, responses.length - 1)];
      i++;
      return new Response(JSON.stringify(anthropicTextResponse(text)), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    return () => {
      globalThis.fetch = originalFetch;
    };
  };
  return { calls, install };
}

test("REQUIRED (Case C/4): a near-duplicate candidate triggers exactly ONE bounded regeneration, whose prompt explicitly says to avoid repeating the recent wording", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city."];
    // First call returns near-identical text to the recent one; second
    // (retry) call returns something genuinely different.
    const { calls, install } = multiCallFetchSpy([
      "No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.",
      "Hey, that's a promo, pulled it. 10-minute mute, use Promotion next time.",
    ]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 }, undefined, recentOwnWarnings
      );
      assert.equal(calls.length, 2, "exactly one regeneration attempt, never zero, never more than one");
      const retrySystem = (calls[1].body as { system?: string }).system ?? "";
      assert.match(retrySystem, /said something VERY similar to this recently/i);
      assert.match(retrySystem, /say this one differently/i);
      assert.equal(text, "Hey, that's a promo, pulled it. 10-minute mute, use Promotion next time.");
    } finally {
      restore();
    }
  });
});

test("REQUIRED: when the candidate is NOT similar to any recent warning, only ONE call is made -- no wasted regeneration", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["That's off-topic spam, not allowed here."];
    const { calls, install } = multiCallFetchSpy(["No promo in this topic, please -- 10 minute mute. Use Promotion instead."]);
    const restore = install();
    try {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 10, warningNumber: 2 }, undefined, recentOwnWarnings);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("REQUIRED: the retry is bounded to exactly ONE attempt -- even if the regenerated text is STILL similar, it's used as-is, never retried again", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city."];
    const sameSimilarText = "No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.";
    const { calls, install } = multiCallFetchSpy([sameSimilarText, sameSimilarText]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 }, undefined, recentOwnWarnings
      );
      assert.equal(calls.length, 2, "never a third call even though the retry is also similar");
      assert.equal(text, sameSimilarText);
    } finally {
      restore();
    }
  });
});

test("an empty recentOwnWarnings list never triggers a regeneration, regardless of candidate content", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead."]);
    const restore = install();
    try {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 10, warningNumber: 2 }, undefined, []);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("REQUIRED: an ENFORCEMENT_NOTICE (a real mute attached) with NOTHING recently similar is returned as-is, without a wasted retry call -- ENFORCEMENT_NOTICE alone is not a reason to retry, only a genuine near-duplicate signal is", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead."]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 10, warningNumber: 2 }, undefined, []);
      assert.equal(calls.length, 1);
      assert.equal(text, "No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead.");
    } finally {
      restore();
    }
  });
});

test("REQUIRED (mode-aware retry, SHORT_NUDGE): a candidate RECOGNIZABLY SIMILAR (but not near-identical) to a recent warning, with no mute attached, gets the brevity instruction", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    // ~0.64 similarity measured -- above NEAR_DUPLICATE_WARNING_THRESHOLD
    // (0.45), below NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD (0.7).
    const recentOwnWarnings = ["Hey, no promos in General please -- pulled that link for now."];
    const { calls, install } = multiCallFetchSpy([
      "No promos in General, please -- I've pulled that one for now.",
      "Yeah, that one's not staying up either.",
    ]);
    const restore = install();
    try {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 }, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "the two fixture texts must actually register as similar enough to exercise the retry path");
      const retrySystem = (calls[1].body as { system?: string }).system ?? "";
      assert.match(retrySystem, /keep this one especially short/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (NO_PUBLIC_REPLY): a candidate NEAR-IDENTICAL to a recent warning, with no consequence attached, resolves to genuine silence -- null, not another short reply", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promos in General, please. Repeated offenses escalate to a kick or ban."];
    const { calls, install } = multiCallFetchSpy(["No promos in General, please -- repeated offenses can escalate to a kick or ban."]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 }, undefined, recentOwnWarnings);
      assert.equal(calls.length, 1, "no retry is attempted for a NO_PUBLIC_REPLY outcome -- there's nothing to vary the wording of");
      assert.equal(text, null);
    } finally {
      restore();
    }
  });
});

/* -------------------------------------- generation-failure never blocks enforcement ---- */

test("REQUIRED: a failed FIRST generation call falls straight to the deterministic fallback -- no retry is ever attempted (there's nothing successful to compare for similarity)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return new Response("server error", { status: 500 });
    }) as typeof fetch;
    try {
      const text = await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, warningNumber: 2 }, undefined, ["some recent warning text"]
      );
      assert.equal(callCount, 1, "exactly one attempt, never a retry after a genuine failure");
      assert.ok(text && text.length > 0);
      assert.equal(text, "No promos in General, please. This resulted in a 10-minute mute. Repeated offenses escalate to a kick or ban.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("REQUIRED: a successful first generation that IS a near-duplicate, whose retry then fails, still returns the first (already-valid) text -- never discarded for an unrelated retry failure", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city."];
    const firstText = "No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.";
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify(anthropicTextResponse(firstText)), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("server error", { status: 500 }); // the retry attempt fails
    }) as typeof fetch;
    try {
      const text = await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 }, undefined, recentOwnWarnings
      );
      assert.equal(callCount, 2);
      assert.equal(text, firstText, "the retry failing must not discard the already-valid first generation");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

/* ============ (2026-09-04, second pass) response mode + authorized-facts guard ==== */
// Closes two completeness gaps flagged against the first pass: (a) the
// retry, when it happens, must be RESPONSE-MODE aware -- an actual mute
// must never be shortened away just because it also reads as a near-
// duplicate; (b) EVERY generated candidate (not just the retry) is checked
// against warningTextExceedsAuthorizedFacts before being returned, since
// generated text is untrusted presentation output, never an enforcement
// authority.

test("REQUIRED (mode-aware retry, ENFORCEMENT_NOTICE): a near-duplicate WITH a real mute attached gets a retry instruction that explicitly demands the consequence still be stated in full, never shortened", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city."];
    const { calls, install } = multiCallFetchSpy([
      "No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.",
      "Hey, that's a promo, pulled it. 10-minute mute, use Promotion next time.",
    ]);
    const restore = install();
    try {
      await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 }, undefined, recentOwnWarnings
      );
      const retrySystem = (calls[1].body as { system?: string }).system ?? "";
      assert.match(retrySystem, /real consequence is attached.*still state every required fact.*in full/i);
      assert.doesNotMatch(retrySystem, /keep this one especially short/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (mode-aware retry, SHORT_NUDGE): a near-duplicate with NO consequence attached (no mute -- a genuine first-offense-shaped warning) gets the brevity instruction instead", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promos in General, please. Post that in Promotion instead."];
    const { calls, install } = multiCallFetchSpy([
      "No promos in General, please -- take it to Promotion.",
      "Hey, please keep that kind of thing out of General.",
    ]);
    const restore = install();
    try {
      await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 }, undefined, recentOwnWarnings);
      const retrySystem = (calls[1].body as { system?: string }).system ?? "";
      assert.match(retrySystem, /keep this one especially short/i);
      assert.doesNotMatch(retrySystem, /real consequence is attached/i);
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard, fast path): a generated candidate that invents an unsupported fact is discarded for the deterministic fallback, WITHOUT ever attempting a retry (no near-duplicate detected -- the guard is a separate check from anti-repetition)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    // "no consequence beyond deletion" facts (muteMinutes undefined) --
    // the generated text nonetheless invents a specific mute duration.
    const { calls, install } = multiCallFetchSpy(["No promos in General, please -- that's a 30-minute mute for you."]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 }, undefined, []);
      assert.equal(calls.length, 1, "the guard rejecting a candidate must never itself trigger the anti-repetition retry");
      assert.equal(text, "No promos in General, please. Repeated offenses escalate to a kick or ban.", "falls back to the exact deterministic template, no invented mute stated");
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard, exact live-quoted example): a candidate claiming a definite ban ('next time you're banned') that isn't actually authorized is discarded", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["Careful -- you've been banned from posting that here."]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, warningNumber: 1 }, undefined, []);
      assert.equal(calls.length, 1);
      assert.ok(text);
      assert.doesNotMatch(text, /you've been banned/i);
      assert.equal(text, "No promos in General, please. Repeated offenses escalate to a kick or ban.");
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard applies to the RETRY too): a near-duplicate whose regenerated retry ALSO invents an unsupported fact is discarded for the deterministic fallback, not silently returned", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city."];
    const { calls, install } = multiCallFetchSpy([
      "No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.",
      // Retry regenerates with a DIFFERENT (wrong) mute number than the
      // real authoritative 10 minutes -- must still be caught, not just
      // "different enough" from the first attempt to pass.
      "Different wording this time, but that's a 45-minute mute for you.",
    ]);
    const restore = install();
    try {
      const text = await generatePersonaSolicitationWarning(
        "Kwan", persona, { ...noMuteFacts, muteMinutes: 10, promotionTopicName: "Promotion", warningNumber: 2 }, undefined, recentOwnWarnings
      );
      assert.equal(calls.length, 2);
      assert.ok(text);
      assert.doesNotMatch(text, /45-minute/i);
      assert.equal(text, "No promos in General, please. Post that in Promotion instead. This resulted in a 10-minute mute. Repeated offenses escalate to a kick or ban.");
    } finally {
      restore();
    }
  });
});

test("a normal, fact-accurate candidate with no unsupported claims is returned unchanged -- the guard is not overzealous against ordinary correct wording", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const text = await (async () => {
      const { calls, install } = multiCallFetchSpy(["No promos in General, please -- that's a 10-minute mute. Repeated offenses can escalate to a kick or ban."]);
      const restore = install();
      try {
        return await generatePersonaSolicitationWarning("Kwan", persona, { ...noMuteFacts, muteMinutes: 10, warningNumber: 2 }, undefined, []);
      } finally {
        restore();
      }
    })();
    assert.equal(text, "No promos in General, please -- that's a 10-minute mute. Repeated offenses can escalate to a kick or ban.");
  });
});

/* ==================== generatePersonaScamWarning (2026-09-04, third pass) ====
   Explicit product correction: scam/phishing DETECTION and the ENFORCEMENT
   DECISION remain fully deterministic (decideLinkEnforcement, untouched by
   this) -- what changes is that the VISIBLE WORDING is now ALSO persona-
   voiced, exactly like the solicitation-warning path, since there is no
   reliability blocker (enforcement in community-runtime.ts already executes
   independent of whether this generation call succeeds -- proven, not
   assumed). Safety: this function is given ONLY safe structured facts
   (ScamWarningFacts), never the malicious URL/message content. */

const FIRST_OFFENSE_FACTS: ScamWarningFacts = { isRepeatOffense: false, muteMinutes: SCAM_FIRST_WARNING_MUTE_MINUTES };
const REPEAT_OFFENSE_FACTS: ScamWarningFacts = { isRepeatOffense: true, muteMinutes: undefined };
const MENTION = "@ScammedUser";

test("REQUIRED: scam warning generation routes to Sonnet 5, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("Careful with links like that -- I've removed it and muted you for a bit."), async (calls) => {
      await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
    });
  });
});

test("REQUIRED: persona is respected -- two differently-configured Watchers produce genuinely different prompts for the identical scam facts", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    let formalSystem = "";
    let casualSystem = "";
    await withFetchSpy(anthropicTextResponse("removed that, be careful."), async (calls) => {
      await generatePersonaScamWarning("Kwan", FORMAL_PERSONA, MENTION, FIRST_OFFENSE_FACTS);
      formalSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    await withFetchSpy(anthropicTextResponse("removed that, be careful."), async (calls) => {
      await generatePersonaScamWarning("Kwan", CASUAL_PERSONA, MENTION, FIRST_OFFENSE_FACTS);
      casualSystem = (calls[0].body as { system?: string }).system ?? "";
    });
    assert.notEqual(formalSystem, casualSystem);
    assert.match(formalSystem, /always capitalize the start/i);
    assert.match(casualSystem, /always write in lowercase/i);
  });
});

test("REQUIRED: the model is never given the malicious URL/message -- explicit safety instruction present in the prompt for every call", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("removed that link, be careful."), async (calls) => {
      await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /you were not shown the link\/message content/i);
      assert.match(system, /never mention, describe, guess, or invent/i);
    });
  });
});

test("REQUIRED: first-offense facts require the real mute duration stated verbatim and the real future-removal risk, never a claim that removal already happened", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("removed that link, be careful."), async (calls) => {
      await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, new RegExp(`muted them for exactly ${SCAM_FIRST_WARNING_MUTE_MINUTES} minutes`, "i"));
      assert.match(system, /never invent, omit, or alter/i);
      assert.match(system, /will result in removal/i);
      assert.doesNotMatch(system, /have ALREADY been removed/i);
    });
  });
});

test("REQUIRED: repeat-offense facts state removal as an already-completed fact, never a threat, and never mention a mute", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("that's it, you're out."), async (calls) => {
      await generatePersonaScamWarning("Kwan", persona, MENTION, REPEAT_OFFENSE_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /ALREADY been removed \(kicked\)/i);
      assert.match(system, /this has genuinely already happened, state it as a completed fact, not a threat/i);
      assert.doesNotMatch(system, /muted them for exactly/i);
    });
  });
});

test("REQUIRED: the mention is embedded deterministically by the function itself, never left to the model -- the returned text always starts with the exact mention passed in", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("your message was removed, be careful with links."), async (calls) => {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      assert.equal(calls.length, 1);
      assert.equal(text, `${MENTION}, your message was removed, be careful with links.`);
    });
  });
});

test("REQUIRED: falls back to the EXACT existing deterministic templates on any generation failure -- scam enforcement's public wording never depends on AI succeeding", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const firstText = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
    const repeatText = await generatePersonaScamWarning("Kwan", persona, MENTION, REPEAT_OFFENSE_FACTS);
    assert.equal(firstText, scamFirstOffenseWarningHtml(MENTION));
    assert.equal(repeatText, scamRepeatOffenseWarningHtml(MENTION));
  });
});

test("REQUIRED (untrusted-output guard): a candidate stating a WRONG mute duration is discarded for the deterministic fallback", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["Careful -- that's a 5-minute mute for you."]);
    const restore = install();
    try {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      assert.equal(calls.length, 1, "the guard rejecting a candidate must never itself trigger a retry");
      assert.equal(text, scamFirstOffenseWarningHtml(MENTION));
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard): a candidate containing a raw link/URL is discarded even though none was ever given to the model", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["That was a fake link, https://not-real.example, be careful."]);
    const restore = install();
    try {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      assert.equal(calls.length, 1);
      assert.equal(text, scamFirstOffenseWarningHtml(MENTION));
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard): a FIRST-offense candidate falsely claiming removal already happened is discarded (nothing was actually removed -- only muted)", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["You've been removed from this community already."]);
    const restore = install();
    try {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS);
      assert.equal(calls.length, 1);
      assert.equal(text, scamFirstOffenseWarningHtml(MENTION));
    } finally {
      restore();
    }
  });
});

test("REQUIRED (untrusted-output guard, repeat offense): a candidate stating removal ALREADY happened is EXPLICITLY PERMITTED -- the kick genuinely already executed before this text is generated", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("You've been removed from this community already."), async (calls) => {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, REPEAT_OFFENSE_FACTS);
      assert.equal(calls.length, 1);
      assert.equal(text, `${MENTION}, You've been removed from this community already.`);
    });
  });
});

/* -------------------------------------- scam anti-repetition ---- */

test("REQUIRED: a near-duplicate scam warning triggers exactly ONE bounded regeneration, always in ENFORCEMENT_NOTICE (full, never shortened) style", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = [`${MENTION}, your message was removed because it contained a suspected scam/phishing link. You've been muted for ${SCAM_FIRST_WARNING_MUTE_MINUTES} minutes. Another confirmed violation will result in removal from this community.`];
    const { calls, install } = multiCallFetchSpy([
      "your message was removed because it contained a suspected scam/phishing link. You've been muted for 30 minutes. Another confirmed violation will result in removal from this community.",
      "Careful with that link -- it's gone, and you're on a 30-minute timeout because of it.",
    ]);
    const restore = install();
    try {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "exactly one regeneration attempt, never zero, never more than one");
      const retrySystem = (calls[1].body as { system?: string }).system ?? "";
      assert.match(retrySystem, /still make that consequence clear|still state every required fact/i);
      assert.doesNotMatch(retrySystem, /keep this one especially short/i);
      assert.equal(text, `${MENTION}, Careful with that link -- it's gone, and you're on a 30-minute timeout because of it.`);
    } finally {
      restore();
    }
  });
});

test("REQUIRED: when the candidate is NOT similar to any recent scam warning, only ONE call is made -- no wasted regeneration", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const recentOwnWarnings = ["That's off-topic spam, not allowed here."];
    const { calls, install } = multiCallFetchSpy(["Careful with that link -- removed it and muted you for a bit."]);
    const restore = install();
    try {
      await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS, undefined, recentOwnWarnings);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("an empty recentOwnWarnings list never triggers a regeneration, regardless of candidate content", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const { calls, install } = multiCallFetchSpy(["Careful with that link -- removed it and muted you for a bit."]);
    const restore = install();
    try {
      await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS, undefined, []);
      assert.equal(calls.length, 1);
    } finally {
      restore();
    }
  });
});

test("the retry is bounded to exactly ONE attempt -- even if the regenerated text is STILL similar, it's used as-is, never retried again", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    const sameSimilarText = "your message was removed because it contained a suspected scam/phishing link. You've been muted for 30 minutes. Another confirmed violation will result in removal from this community.";
    const recentOwnWarnings = [`${MENTION}, ${sameSimilarText}`];
    const { calls, install } = multiCallFetchSpy([sameSimilarText, sameSimilarText]);
    const restore = install();
    try {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS, undefined, recentOwnWarnings);
      assert.equal(calls.length, 2, "never a third call even though the retry is also similar");
      assert.equal(text, `${MENTION}, ${sameSimilarText}`);
    } finally {
      restore();
    }
  });
});

/* -------------------------------------- BYO Enterprise routing ---- */

test("REQUIRED: BYO required+usable routes through the stored credential, never Innvil's own key", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy(anthropicTextResponse("Careful with that link -- removed it."), async (calls) => {
      const text = await generatePersonaScamWarning(
        "Kwan", persona, MENTION, FIRST_OFFENSE_FACTS,
        { required: true, credential: { provider: "anthropic", apiKey: "sk-real-byo-key", baseUrl: null, model: "claude-sonnet-5" } }
      );
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
      assert.ok(text.length > 0);
    });
  });
});

test("REQUIRED: BYO required but unusable falls straight to the deterministic fallback, no network call at all", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const text = await generatePersonaScamWarning("Kwan", persona, MENTION, FIRST_OFFENSE_FACTS, { required: true, credential: null });
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.equal(text, scamFirstOffenseWarningHtml(MENTION));
    });
  });
});

/* ==================== generatePersonaNegativeStatementWarning (2026-09-05) ====
   Explicit product decision: an unfounded, mocking scam/rug/fraud
   ACCUSATION about the project (never a genuine question, never a
   substantive evidence-backed report) gets a silent 1st-offense delete
   (this function is never called for that case), then a real warning+mute
   on the 2nd, then a real time-bound ban on the 3rd+. This function ONLY
   ever handles the 2nd/escalated cases -- mirrors generatePersonaScamWarning's
   exact safety shape: given ONLY safe structured facts, never the violating
   message's own text. */

const NS_WARN_FACTS: NegativeStatementWarningFacts = { isEscalatedOffense: false, muteMinutes: NEGATIVE_STATEMENT_MUTE_MINUTES, banHours: undefined };
const NS_BAN_FACTS: NegativeStatementWarningFacts = { isEscalatedOffense: true, muteMinutes: undefined, banHours: NEGATIVE_STATEMENT_BAN_MINUTES / 60 };
const NS_MENTION = "@AccuserUser";

test("REQUIRED: negative-statement warning generation routes to Sonnet 5, never DeepSeek", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("please don't spread claims like that here -- you're muted for a bit."), async (calls) => {
      await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /anthropic/i);
      assert.equal((calls[0].body as { model?: string }).model, "claude-sonnet-5");
    });
  });
});

test("REQUIRED: the model is never given the removed message's own text -- explicit safety instruction present in the prompt", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("keep it factual, please."), async (calls) => {
      await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /you were not shown the exact wording of the removed message/i);
      assert.match(system, /do not guess, invent, or react to specific words/i);
    });
  });
});

test("REQUIRED: a genuine question about whether something is a scam is explicitly distinguished as fine, not the violation being warned about", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("keep it factual, please."), async (calls) => {
      await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /a genuine question about whether something is a scam is completely fine/i);
    });
  });
});

test("REQUIRED: warn-tier facts require the real mute duration stated verbatim, and make clear a ban follows next time -- never a claim removal already happened", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("please stop, that's a 30-minute mute."), async (calls) => {
      await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, new RegExp(`muted them for exactly ${NEGATIVE_STATEMENT_MUTE_MINUTES} minutes`, "i"));
      assert.match(system, /doing this again will result in a ban/i);
      assert.doesNotMatch(system, /REPEAT offense/i);
    });
  });
});

test("REQUIRED: ban-tier facts state the ban as an already-completed, TIME-BOUND fact, never a threat, and never mention a mute", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("that's it, you're banned for now."), async (calls) => {
      await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_BAN_FACTS);
      const system = (calls[0].body as { system?: string }).system ?? "";
      assert.match(system, /REPEAT offense/i);
      assert.match(system, new RegExp(`banned them for exactly ${NEGATIVE_STATEMENT_BAN_MINUTES / 60} hours`, "i"));
      assert.match(system, /temporary\/time-bound, not permanent/i);
      assert.doesNotMatch(system, /muted them for exactly/i);
    });
  });
});

test("REQUIRED: the mention is embedded deterministically, never left to the model -- the returned text always starts with the exact mention passed in", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("please keep it factual, that's a mute for now."), async (calls) => {
      const text = await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      assert.equal(calls.length, 1);
      assert.equal(text, `${NS_MENTION}, please keep it factual, that's a mute for now.`);
    });
  });
});

test("REQUIRED: falls back to a fixed, accurate deterministic template on any generation failure -- public wording never depends on AI succeeding", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: undefined, AI_FALLBACK_API_KEY: undefined }, async () => {
    const warnText = await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
    const banText = await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_BAN_FACTS);
    assert.match(warnText, new RegExp(`${NEGATIVE_STATEMENT_MUTE_MINUTES}-minute mute`));
    assert.match(banText, new RegExp(`${NEGATIVE_STATEMENT_BAN_MINUTES / 60}-hour ban`));
    assert.ok(warnText.startsWith(NS_MENTION));
    assert.ok(banText.startsWith(NS_MENTION));
  });
});

test("REQUIRED (untrusted-output guard): a candidate stating a WRONG mute duration is discarded for the deterministic fallback", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-ant-test" }, async () => {
    await withFetchSpy(anthropicTextResponse("that's a 90-minute mute, please stop."), async (calls) => {
      const text = await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS);
      assert.equal(calls.length, 1);
      assert.match(text, new RegExp(`${NEGATIVE_STATEMENT_MUTE_MINUTES}-minute mute`));
      assert.doesNotMatch(text, /90-minute/);
    });
  });
});

test("REQUIRED: BYO required but unusable falls straight to the deterministic fallback, no network call at all", async () => {
  await withEnvAsync({ ANTHROPIC_API_KEY: "sk-innvil-should-never-be-used" }, async () => {
    await withFetchSpy({}, async (calls) => {
      const text = await generatePersonaNegativeStatementWarning("Kwan", persona, NS_MENTION, NS_WARN_FACTS, { required: true, credential: null });
      assert.equal(calls.length, 0, "must never reach Innvil's own key when BYO is required but unusable");
      assert.match(text, new RegExp(`${NEGATIVE_STATEMENT_MUTE_MINUTES}-minute mute`));
    });
  });
});
