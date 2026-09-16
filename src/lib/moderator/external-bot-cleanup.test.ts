import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isExternalBotCleanupCandidate } from "./external-bot-cleanup";
import { runExternalBotCleanup, type TelegramMessage } from "./community-runtime";
import { buildStandaloneModeratorSettings } from "@/src/lib/products/watch-runtime";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";
import type { CommunityEvent } from "./event-types";

const sender = { isBot: true, senderType: "EXTERNAL_BOT" as const, platformUserId: "442", displayName: "RemoveJoinGroupMsgBot", verifiedRole: "admin" as const };
const candidate = { enabled: true, claimed: true, chatType: "supergroup", hasSenderChat: false, sender, receivingBotId: 900 };
const message: TelegramMessage = { message_id: 71, chat: { id: -1001, type: "supergroup" }, from: { id: 442, is_bot: true }, text: "Get an ad-free license to disable future credit messages." };
const event: CommunityEvent = { panelId: null, communityId: "c1", integrationId: "i1", messageId: "71", sender, timestamp: new Date().toISOString(), text: message.text!, replyToMessageId: null, messageThreadId: null, origin: "HUMAN", interactionDepth: 0, causationMessageId: null };

test("opt-in cleanup recognizes platform bot identity, not names, forwards or human admin roles", () => {
  assert.equal(isExternalBotCleanupCandidate(candidate), true, "third-party bot admins are included");
  for (const change of [{ enabled: false }, { enabled: undefined }, { enabled: null }, { claimed: false },
    { chatType: "private" }, { chatType: "channel" }, { hasSenderChat: true }, { receivingBotId: 442 },
    { sender: { ...sender, isBot: false, senderType: "HUMAN" as const } },
    { sender: { ...sender, senderType: "INNVIL_MODERATOR" as const } },
    { sender: { ...sender, platformUserId: "channel:-1001" } }]) {
    assert.equal(isExternalBotCleanupCandidate({ ...candidate, ...change }), false);
  }
});

type Row = Record<string, unknown>;
function fixture(opts: { known?: boolean; identityError?: boolean; identityNull?: boolean; noDeployment?: boolean; noToken?: boolean; quotaExhausted?: boolean } = {}) {
  const writes: Array<{ table: string; value: Row }> = [];
  const reads: string[] = [];
  const rpcCalls: string[] = [];
  const db = {
    from(table: string) {
      reads.push(table);
      const filters: Array<[string, unknown]> = [];
      let value: Row | undefined;
      const result = () => {
        if (value) { writes.push({ table, value }); return { data: [], error: null }; }
        if (table === "telegram_bot_integrations") {
          if (filters.some(([key]) => key === "telegram_bot_id")) return { data: opts.identityNull ? null : opts.known ? [{ id: "known-watcher" }] : [], error: opts.identityError ? { message: "lookup failed" } : null };
          return { data: [{ id: "i1", virtual_moderator_id: "m1", username: "our_watcher" }], error: null };
        }
        if (table === "moderator_deployments") return { data: opts.noDeployment ? [] : [{ id: "d1", moderator_id: "m1", created_at: "2026-01-01", virtual_moderators: { name: "Watcher", persona: DEFAULT_MODERATOR_PERSONA } }], error: null };
        if (table === "community_reactive_quota") return { data: [{ reactive_count: opts.quotaExhausted ? 100 : 0 }], error: null };
        throw new Error(`Unexpected database read: ${table}`);
      };
      const chain = {
        select() { return chain; }, eq(k: string, v: unknown) { filters.push([k,v]); return chain; },
        in() { return chain; }, order() { return chain; }, limit() { return chain; },
        update(v: Row) { value = v; return chain; }, insert(v: Row) { value = v; return chain; },
        async maybeSingle() { const r = result(); return { ...r, data: r.data?.[0] ?? null }; },
        then(resolve: (r: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return chain;
    },
    async rpc(name: string) { rpcCalls.push(name); assert.equal(name, "get_telegram_bot_key", "no strike or restriction RPC"); return { data: opts.noToken ? null : "test-token", error: null }; },
  };
  return { db, writes, reads, rpcCalls };
}

async function exercise(opts: Parameters<typeof fixture>[0] & { failDelete?: boolean; throwDelete?: boolean; claimed?: boolean; enabled?: boolean; settings?: unknown; senderChat?: boolean } = {}) {
  const f = fixture(opts);
  const calls: Array<{ url: string; body: Record<string,string> }> = [];
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.PROVIDER_KEY_SECRET;
  process.env.PROVIDER_KEY_SECRET = "test-only";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: Object.fromEntries(new URLSearchParams(String(init?.body))) });
    assert.match(String(url), /\/deleteMessage$/, "never warn, mute, kick, look up admin role, react or invoke AI");
    if (opts.throwDelete) throw new Error("network failure");
    return new Response(JSON.stringify(opts.failDelete ? { ok: false, description: "permission denied" } : { ok: true, result: true }), { status: 200 });
  };
  try {
    await runExternalBotCleanup(f.db as never, null, { id: "c1", remove_external_bot_messages: opts.enabled ?? true },
      { ...message, ...(opts.senderChat ? { sender_chat: message.chat } : {}) }, event,
      opts.settings === undefined ? buildStandaloneModeratorSettings("standard") : opts.settings,
      opts.claimed ?? true, 900);
  } finally { globalThis.fetch = previousFetch; if (previousSecret === undefined) delete process.env.PROVIDER_KEY_SECRET; else process.env.PROVIDER_KEY_SECRET = previousSecret; }
  return { ...f, calls };
}

test("real cleanup action silently deletes a bot-admin ad and writes no human enforcement history", async () => {
  const result = await exercise();
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0].body, { chat_id: "-1001", message_id: "71" });
  assert.deepEqual(result.rpcCalls, ["get_telegram_bot_key"]);
  assert.ok(result.writes.every(w => ["community_messages", "moderator_activity_log"].includes(w.table)));
  assert.equal(result.writes.find(w => w.table === "moderator_activity_log")?.value.decision, "EXTERNAL_BOT_DELETED");
  assert.equal(result.writes.find(w => w.table === "community_messages")?.value.text, "[Third-party bot message removed]");
});

test("off, duplicate claim, no entitlement, no active watcher and synthetic sender are no-ops", async () => {
  for (const opts of [{ enabled: false }, { claimed: false }, { settings: null }, { noDeployment: true }, { senderChat: true }]) {
    const result = await exercise(opts);
    assert.equal(result.calls.length, 0);
    assert.equal(result.writes.length, 0);
  }
});

test("known Innvil bots including paused deployments are preserved; identity uncertainty never deletes", async () => {
  for (const opts of [{ known: true }, { identityError: true }, { identityNull: true }]) {
    const result = await exercise(opts);
    assert.equal(result.calls.length, 0);
    assert.equal(result.rpcCalls.length, 0);
    if (!opts.known) assert.equal(result.writes[0].value.decision, "EXTERNAL_BOT_CLEANUP_SKIPPED");
  }
});

test("trial cleanup respects the existing exhausted-quota pause without consuming quota itself", async () => {
  const settings = { addons: { moderator: { tier: null, trial: { startedAt: new Date(Date.now() - 86400000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() } } } };
  const paused = await exercise({ settings, quotaExhausted: true });
  assert.equal(paused.calls.length, 0);
  assert.equal(paused.writes.length, 0);
  const active = await exercise({ settings });
  assert.equal(active.calls.length, 1);
  assert.deepEqual(active.rpcCalls, ["get_telegram_bot_key"]);
});

test("permission errors, missing token and network errors are logged as failed deletion, never as success or a warning", async () => {
  for (const opts of [{ failDelete: true }, { noToken: true }, { throwDelete: true }]) {
    const result = await exercise(opts);
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].value.decision, "EXTERNAL_BOT_DELETE_FAILED");
    assert.equal(result.writes[0].value.deleted, undefined);
    assert.equal((result.writes[0].value.meta as Row).deleted, false);
  }
});

test("webhook cleanup follows the cross-watcher claim and terminates before memory or human moderation", () => {
  const source = readFileSync(new URL("./community-runtime.ts", import.meta.url), "utf8");
  const entry = source.slice(source.indexOf("export async function handleCommunityUpdate"));
  const claim = entry.indexOf("const { claimed } = await recordCommunityMessage");
  const branch = entry.indexOf('if (sender.senderType === "EXTERNAL_BOT")');
  const edit = entry.indexOf("const isEditedMessage");
  assert.ok(claim >= 0 && branch > claim && edit > branch);
  assert.match(entry.slice(branch, edit), /runExternalBotCleanup[\s\S]*return;/);
});

test("cleanup toggle opens setup before enabling, supports cancellation and preserves saved state on failure", () => {
  const source = readFileSync(new URL("../../components/watch/ExternalBotCleanupToggle.tsx", import.meta.url), "utf8");
  const toggle = source.slice(source.indexOf("function toggle()"), source.indexOf("return <div"));
  assert.match(toggle, /if \(enabled\) \{ void save\(false\); return; \}/);
  assert.match(toggle, /setPendingEnable\(true\)/);
  assert.match(toggle, /setShowInstructions\(true\)/);
  assert.doesNotMatch(toggle, /save\(true\)|setCommunityRemoveExternalBotMessages/);
  assert.match(source, /pendingEnable &&[\s\S]*onClick=\{\(\) => void save\(true\)\}/);
  assert.match(source, /setPendingEnable\(false\); setShowInstructions\(false\); setError\(null\)/);
  assert.match(source, /if \(result.ok\) \{ setEnabled\(next\);/);
});

test("cleanup setup explains Telegram prerequisites and limitations and remains accessible", () => {
  const source = readFileSync(new URL("../../components/watch/ExternalBotCleanupToggle.tsx", import.meta.url), "utf8");
  for (const text of ["Bot-to-Bot Communication Mode", "Delete messages", "each active Watcher", "All third-party bot posts", "cannot restore deleted posts", "No bot token is needed here", "View setup instructions", "https://t.me/BotFather"]) assert.ok(source.includes(text), text);
  assert.match(source, /aria-expanded=\{showInstructions\}/);
  assert.match(source, /aria-controls=\{instructionsId\}/);
  assert.match(source, /headingRef.current\?\.focus\(\)/);
});
