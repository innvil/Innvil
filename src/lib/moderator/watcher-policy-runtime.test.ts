import { test } from "node:test";
import assert from "node:assert/strict";
import { runLinkModeration, handleHumanMessage, createRequestTimer, type ChatterDeployment } from "./community-runtime";
import type { CommunityEvent } from "./event-types";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";

const deployment: ChatterDeployment = { deploymentId: "dep", moderatorId: "mod", moderatorName: "Patricia", persona: DEFAULT_MODERATOR_PERSONA, botUsername: "watcher_bot", createdAt: "2026-01-01T00:00:00Z" };
const pitch = "Hello dev, we promote your project to investors. DM me to get started.";
function event(text = pitch): CommunityEvent {
  return { panelId: null, communityId: "community", integrationId: "integration", messageId: "42", sender: { platformUserId: "7", isBot: false, senderType: "HUMAN", displayName: "Member", username: "member" },
    timestamp: new Date().toISOString(), text, replyToMessageId: null, messageThreadId: 31, origin: "HUMAN", interactionDepth: 0, causationMessageId: null };
}

function database(topicPolicy = "normal", priorWarnings = 0) {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const touched: string[] = [];
  const db = {
    from(table: string) {
      touched.push(table);
      const rows = table === "moderator_deployments" ? [{ id: "dep", moderator_id: "mod", created_at: deployment.createdAt, virtual_moderators: { name: "Patricia", persona: DEFAULT_MODERATOR_PERSONA } }]
        : table === "telegram_bot_integrations" ? [{ id: "integration", virtual_moderator_id: "mod", username: "watcher_bot" }]
        : table === "watch_community_topics" ? [{ message_thread_id: 31, topic_name: "Promotion", custom_name: null, policy: topicPolicy }]
        : table === "moderator_link_warning_state" && priorWarnings ? [{ warning_count: priorWarnings, warning_at: new Date().toISOString() }] : [];
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

async function runFixture(opts: { policy?: string; role?: string; category?: string; priorWarnings?: number; failDelete?: boolean; failMute?: boolean }, fn: (result: { calls: Array<{ method: string; body: Record<string, unknown> }>; fixture: ReturnType<typeof database> }) => Promise<void>) {
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
        : (method === "deleteMessage" && opts.failDelete) || (method === "restrictChatMember" && opts.failMute) ? { ok: false, description: "permission denied" }
        : { ok: true, result: method === "sendMessage" ? { message_id: 88 } : true }
      : { content: [{ type: "text", text: `CATEGORY: ${opts.category ?? "UNSOLICITED_PROMOTION"}\nCONFIDENCE: high` }] };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  try { await fn({ calls, fixture: database(opts.policy, opts.priorWarnings) }); }
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
