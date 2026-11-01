import { test } from "node:test";
import assert from "node:assert/strict";
import { captureOfficialMemory, type CaptureOfficialSource } from "./official-memory-runtime";

const source: CaptureOfficialSource = { communityId: "c1", platformMessageId: "42", senderId: "7", revision: 1788825600, messageThreadId: 3,
  sourceUrl: "https://t.me/bytehumors/42", text: "Our Raydium market is live", urls: ["https://raydium.io/swap/?outputMint=BYTE"],
  isPinned: false, isAnnouncement: true, verifiedAdmin: true };

test("unverified regular member cannot create official memory", async () => {
  const db = { from() { throw Error("must not persist"); } };
  assert.equal(await captureOfficialMemory(db as never, { ...source, verifiedAdmin: false }, null, { required: false, credential: null }), false);
});

test("source is persisted before AI; unavailable BYO cannot fall back to platform credentials", async () => {
  const operations: Array<Record<string, unknown>> = [];
  const db = { from(table: string) {
    assert.equal(table, "watch_official_memory_sources");
    return { insert: async (row: Record<string, unknown>) => { operations.push(row); return { error: null }; },
      update: (row: Record<string, unknown>) => ({ match: async () => { operations.push(row); return { error: null }; } }) };
  } };
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("no model call authorized"); };
  try {
    assert.equal(await captureOfficialMemory(db as never, source, { name: "Byte Humor", overview: "BYTE" }, { required: true, credential: null }), true);
    assert.equal(operations[0].platform_message_id, "42");
    assert.equal(operations[0].revision, source.revision);
    assert.equal(operations[0].is_pinned, false);
    assert.deepEqual(operations[1], { status: "failed", resources: [] });
  } finally { globalThis.fetch = previous; }
});

test("real extraction request uses per-link purposes and persists only validated output", async () => {
  const writes: unknown[] = [];
  const db = { from() { return { insert: async () => ({ error: null }), update: (row: unknown) => ({ match: async () => { writes.push(row); return { error: null }; } }) }; } };
  const originalFetch = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([{ url: source.urls[0], kind: "TRADING", status: "confirmed", quote: source.text }]) } }] }), { status: 200 });
  };
  try {
    await captureOfficialMemory(db as never, source, { name: "Byte Humor", overview: "BYTE" }, { required: true, credential: { provider: "openai", apiKey: "test", model: "test-model", baseUrl: "https://api.openai.com/v1" } });
    assert.match(requestBody, /admin POSTING a link is NOT sufficient endorsement/);
    assert.match(requestBody, /CHART is price\/chart analytics/);
    assert.match(requestBody, /Byte Humor/);
    assert.deepEqual(writes, [{ status: "ready", resources: [{ url: source.urls[0], kind: "TRADING", status: "confirmed", quote: source.text }] }]);
  } finally { globalThis.fetch = originalFetch; }
});

test("verified admin contract capture persists a typed chain-scoped address set", async () => {
  const mint = "So11111111111111111111111111111111111111112";
  const text = `Our official Solana token contract is ${mint}`;
  const resource = { url: null, kind: "TOKEN_CONTRACT", status: "confirmed", quote: text, tokenContracts: { chain: "solana", addresses: [mint] } };
  const writes: unknown[] = [];
  const db = { from() { return { insert: async () => ({ error: null }), update: (row: unknown) => ({ match: async () => { writes.push(row); return { error: null }; } }) }; } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.match(String(init?.body), /COMPLETE endorsed address set/);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify([resource]) } }] }), { status: 200 });
  };
  try {
    await captureOfficialMemory(db as never, { ...source, text, urls: [] }, { name: "Byte Humor", overview: "BYTE" },
      { required: true, credential: { provider: "openai", apiKey: "test", model: "test-model", baseUrl: "https://api.openai.com/v1" } });
    assert.deepEqual(writes, [{ status: "ready", resources: [resource] }]);
  } finally { globalThis.fetch = originalFetch; }
});
