import { test } from "node:test";
import assert from "node:assert/strict";
import { runLinkModeration, handleHumanMessage, processDuePendingReply, createRequestTimer, type ChatterDeployment } from "./community-runtime";
import type { CommunityEvent } from "./event-types";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";

const deployment: ChatterDeployment = { deploymentId: "dep", moderatorId: "mod", moderatorName: "Patricia", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "watcher_bot", createdAt: "2026-01-01T00:00:00Z" };
const pitch = "Hello dev, we promote your project to investors. DM me to get started.";
function event(text = pitch): CommunityEvent {
  return { panelId: null, communityId: "community", integrationId: "integration", messageId: "42", sender: { platformUserId: "7", isBot: false, senderType: "HUMAN", displayName: "Member", username: "member" },
    timestamp: new Date().toISOString(), text, replyToMessageId: null, messageThreadId: 31, origin: "HUMAN", interactionDepth: 0, causationMessageId: null };
}

function database(topicPolicy = "normal", priorWarnings = 0, context: Record<string, unknown>[] = [], memory: Record<string, unknown>[] = []) {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const touched: string[] = [];
  const db = {
    from(table: string) {
      touched.push(table);
      const rows = table === "moderator_deployments" ? [{ id: "dep", moderator_id: "mod", created_at: deployment.createdAt, virtual_moderators: { name: "Patricia", persona: DEFAULT_MODERATOR_PERSONA } }]
        : table === "telegram_bot_integrations" ? [{ id: "integration", virtual_moderator_id: "mod", username: "watcher_bot" }]
        : table === "watch_community_topics" ? [{ message_thread_id: 31, topic_name: "Promotion", custom_name: null, policy: topicPolicy }]
        : table === "moderator_link_warning_state" && priorWarnings ? [{ warning_count: priorWarnings, warning_at: new Date().toISOString() }]
        : table === "community_messages" ? context
        : table === "watch_official_memory_sources" ? memory
        : table === "communities" ? [{ id: "community", acknowledge_admin_mod: false, chat_id: "-100999", title: "Test Community" }] : [];
      const query = {
        select() { return query; }, eq() { return query; }, in() { return query; }, is() { return query; }, not() { return query; }, order() { return query; }, limit() { return query; }, range() { return query; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
        insert(value: Record<string, unknown>) { writes.push({ table, value }); return Promise.resolve({ error: null }); },
        upsert(value: Record<string, unknown>) { writes.push({ table, value }); return Promise.resolve({ error: null }); },
        update(value: Record<string, unknown>) { writes.push({ table, value }); return query; },
      };
      return query;
    },
    rpc: async (name: string) => ({ data: name === "get_telegram_bot_key" ? "test-token" : true, error: null }),
  };
  return { db, writes, touched };
}

async function runFixture(opts: { policy?: string; role?: string; category?: string; priorWarnings?: number; failDelete?: boolean; failMute?: boolean; failWarning?: boolean; context?: Record<string, unknown>[]; memory?: Record<string, unknown>[] }, fn: (result: { calls: Array<{ method: string; body: Record<string, unknown> }>; fixture: ReturnType<typeof database> }) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const env = { PROVIDER_KEY_SECRET: process.env.PROVIDER_KEY_SECRET, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY };
  process.env.PROVIDER_KEY_SECRET = "test-secret";
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.DEEPSEEK_API_KEY;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    const body = String(url).includes("api.telegram.org")
      ? Object.fromEntries(new URLSearchParams(String(init?.body))) : JSON.parse(String(init?.body ?? "{}"));
    const method = String(url).split("/").pop()!;
    calls.push({ method, body });
    const payload = String(url).includes("api.telegram.org")
      ? method === "getChatMember" ? opts.role === "unavailable" ? { ok: false, description: "lookup unavailable" } : { ok: true, result: { status: opts.role ?? "member" } }
        : (method === "deleteMessage" && opts.failDelete) || (method === "restrictChatMember" && opts.failMute) || (method === "sendMessage" && body.chat_id === "-100123" && opts.failWarning) ? { ok: false, description: "permission denied" }
        : { ok: true, result: method === "sendMessage" ? { message_id: 88 } : true }
      : { content: [{ type: "text", text: `CATEGORY: ${opts.category ?? "UNSOLICITED_PROMOTION"}\nCONFIDENCE: high` }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try { await fn({ calls, fixture: database(opts.policy, opts.priorWarnings, opts.context, opts.memory) }); }
  finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("actual moderation allows a marketing service pitch in the configured Promotion topic without strikes or deletion", async () => {
  await runFixture({ policy: "promotion" }, async ({ calls, fixture }) => {
    const result = await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(), [deployment], new Date());
    assert.equal(result.handled, false);
    assert.equal(calls.some(c => c.method === "deleteMessage" || c.method === "sendMessage"), false);
    assert.equal(fixture.writes.find(w => w.table === "moderator_link_warning_state")?.value.warning_count, 0);
    assert.ok(JSON.stringify(calls).includes('solicitationAllowed'));
  });
});

test("actual moderation never penalizes ordinary admin content or a failed role lookup", async () => {
  for (const role of ["administrator", "unavailable"]) {
    await runFixture({ role, category: "COMPETING_PROJECT_PROMOTION" }, async ({ calls, fixture }) => {
      const result = await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(), [deployment], new Date());
      assert.equal(result.handled, false);
      assert.equal(calls.some(c => c.method === "deleteMessage"), false);
    });
  }
});

test("failed deletion causes no warning, mute or strike", async () => {
  await runFixture({ failDelete: true, priorWarnings: 1 }, async ({ calls, fixture }) => {
    await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(), [deployment], new Date());
    assert.equal(calls.some(c => c.method === "deleteMessage"), true);
    assert.equal(calls.some(c => c.method === "sendMessage" || c.method === "restrictChatMember"), false);
    assert.equal(fixture.writes.some(w => w.table === "moderator_link_warning_state"), false);
  });
});

test("unknown role does not bypass confirmed phishing protection", async () => {
  await runFixture({ role: "unavailable", category: "PHISHING_OR_SCAM" }, async ({ calls, fixture }) => {
    await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(), [deployment], new Date());
    assert.equal(calls.some(c => c.method === "deleteMessage"), true);
    assert.equal(calls.some(c => c.method === "restrictChatMember"), true);
  });
});

test("mute is attempted before warning; failed mute is not claimed, and warning stays in its topic", async () => {
  await runFixture({ failMute: true, priorWarnings: 1 }, async ({ calls, fixture }) => {
    await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(), [deployment], new Date());
    const muted = calls.findIndex(c => c.method === "restrictChatMember");
    const warned = calls.findIndex(c => c.method === "sendMessage");
    assert.ok(muted >= 0 && warned > muted);
    assert.equal(Number(calls[warned].body.message_thread_id), 31);
    assert.doesNotMatch(String(calls[warned].body.text), /mute|take 10|minutes off/i);
  });
});

test("admin-ignore exits before the separate conversation task router", async () => {
  await runFixture({ role: "administrator" }, async ({ calls, fixture }) => {
    await handleHumanMessage(fixture.db as never, null, { id: "community", acknowledge_admin_mod: false }, { message_id: 42, chat: { id: -100123, type: "supergroup" }, text: "1" }, event("1"), false, createRequestTimer("test"), {});
    assert.equal(fixture.touched.includes("moderator_conversation_tasks"), false);
    assert.equal(calls.some(c => c.method === "sendMessage"), false);
    assert.ok(fixture.writes.some(w => w.value.reason === "engagement_suppressed_for_sender" || JSON.stringify(w.value).includes("engagement_suppressed_for_sender")));
  });
});

test("repeated DM nudges get a contextual spam warning, not an identity correction; a single nudge is left alone", async () => {
  const text = "Rhyleky check dm";
  const context = [40, 41].map(id => ({ platform_message_id: String(id), text, message_thread_id: 31, sender_type: "HUMAN", sender_platform_id: "7", sender_display_name: "Member", created_at: new Date(Date.now() - 20_000).toISOString() }));
  for (const previous of [[], context]) {
    await runFixture({ context: previous }, async ({ calls, fixture }) => {
      await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(text), [deployment], new Date());
      const warning = calls.find(c => c.method === "sendMessage");
      if (!previous.length) assert.equal(warning, undefined);
      else {
        assert.ok(warning);
        assert.match(String(warning.body.text), /DM nudges/);
        assert.doesNotMatch(String(warning.body.text), /not Rhyleky|not the dev|\[user\]/i);
      }
    });
  }
});

test("queued replies recheck admin-ignore and cancel on unavailable role or missing token", async () => {
  const text = "@watcher_bot how do I buy?";
  for (const role of ["administrator", "unavailable", "missing-token"]) {
    await runFixture({ role, context: [{ text, platform_message_id: "42", message_thread_id: 31 }] }, async ({ calls, fixture }) => {
      if (role === "missing-token") fixture.db.rpc = async () => ({ data: null as never, error: null });
      const now = new Date();
      await processDuePendingReply(fixture.db as never, {
        id: "pending", community_id: "community", panel_id: null, deployment_id: "dep", chat_id: "-100123", message_thread_id: 31,
        trigger_platform_message_id: "42", sender_platform_id: "7", sender_display_name: "Member", sender_username: "member",
        message_text: text, action_kind: "ANSWER", scheduled_for: now.toISOString(), created_at: new Date(now.getTime() - 60_000).toISOString(),
      }, now);
      assert.equal(calls.some(c => c.method === "sendMessage"), false);
      assert.ok(fixture.writes.some(w => w.table === "watch_pending_replies" && w.value.status === "cancelled" && w.value.cancel_reason === "engagement_suppressed_for_sender"), role);
    });
  }
});

test("private reports distinguish successful mute, failed mute, and failed public warning delivery", async () => {
  for (const failMute of [false, true]) {
    for (const failWarning of [false, true]) {
      await runFixture({ priorWarnings: 1, failMute, failWarning }, async ({ fixture }) => {
        await runLinkModeration(fixture.db as never, null, { id: "community", project_id: "project" }, "-100123", event(), [deployment], new Date());
        const report = fixture.writes.find(w => w.table === "watch_moderation_reports")?.value;
        assert.ok(report);
        assert.equal((report.action_types as string[]).includes("warning"), !failWarning);
        assert.equal(report.warning_number, failWarning ? null : 2);
        assert.equal(report.mute_minutes, failMute ? null : 10);
        const text = String(report.report_text);
        if (failMute) { assert.match(text, /Mute attempt failed/); assert.doesNotMatch(text, /User muted for/); }
        else assert.match(text, /User muted for 10 minutes/);
        if (failWarning) { assert.match(text, /Public warning delivery failed/); assert.doesNotMatch(text, /Warning 2 of/); }
        else assert.match(text, /Warning 2 of/);
      });
    }
  }
});

const officialMint = "So11111111111111111111111111111111111111112";
const differentMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const contractMemory = [{ platform_message_id: "100", revision: 100, message_thread_id: 99, status: "ready", source_url: "https://t.me/example/100", is_pinned: false, is_announcement: true,
  resources: [{ kind: "TOKEN_CONTRACT", url: null, status: "confirmed", quote: `Our official Solana token contract: ${officialMint}`, tokenContracts: { chain: "solana", addresses: [officialMint] } }] }];

test("actual pipeline deletes a different mint in Promotion despite a SAFE classifier result, with contextual warning and audit evidence", async () => {
  await runFixture({ policy: "promotion", category: "SAFE_RELEVANT_LINK", memory: contractMemory }, async ({ calls, fixture }) => {
    const result = await runLinkModeration(fixture.db as never, null, { id: "community", allow_solicitation: true }, "-100123", event(`sold half of\n${differentMint} at a 10x, thanks for the alpha`), [deployment], new Date());
    assert.equal(result.handled, true);
    assert.ok(calls.some(c => c.method === "deleteMessage"));
    const warning = calls.find(c => c.method === "sendMessage");
    assert.ok(warning);
    assert.match(String(warning.body.text), /isn't our official token address/);
    assert.doesNotMatch(String(warning.body.text), /Promotion|scam|\[user\]/i);
    assert.ok(fixture.writes.some(w => JSON.stringify(w.value).includes("sourceMessageId")));
  });
});

test("actual mismatch pipeline preserves matches, missing/failed memory, admins and unverified roles", async () => {
  const cases = [
    { text: officialMint, memory: contractMemory, role: "member" },
    { text: differentMint, memory: [], role: "member" },
    { text: differentMint, memory: [...contractMemory, { ...contractMemory[0], revision: 200, status: "failed", resources: [] }], role: "member" },
    { text: differentMint, memory: contractMemory, role: "administrator" },
    { text: differentMint, memory: contractMemory, role: "unavailable" },
  ];
  for (const c of cases) await runFixture({ ...c, category: "UNKNOWN_OR_AMBIGUOUS" }, async ({ calls, fixture }) => {
    const result = await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(c.text), [deployment], new Date());
    assert.equal(result.handled, false);
    assert.equal(calls.some(c => c.method === "deleteMessage" || c.method === "sendMessage"), false);
  });
});

test("failed mismatch deletion does not add a strike or issue a warning", async () => {
  await runFixture({ failDelete: true, memory: contractMemory }, async ({ calls, fixture }) => {
    await runLinkModeration(fixture.db as never, null, { id: "community" }, "-100123", event(differentMint), [deployment], new Date());
    assert.equal(calls.some(c => c.method === "sendMessage" || c.method === "restrictChatMember"), false);
    assert.equal(fixture.writes.some(w => w.table === "moderator_link_warning_state"), false);
  });
});
