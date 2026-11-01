import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOfficialMemory, currentOfficialMemoryItems, type OfficialMemorySource, type OfficialMemoryResource } from "./official-memory";
import { buildCommunityKnowledgeGrounding } from "./community-message-knowledge";

const buy = "https://raydium.io/swap/?outputMint=BYTE";
const chart = "https://dexscreener.com/solana/byte";
function source(id: string, revision: number, resources: OfficialMemoryResource[], extra: Partial<OfficialMemorySource> = {}): OfficialMemorySource {
  return { platform_message_id: id, revision, message_thread_id: 23, source_url: `https://t.me/bytehumors/${id}`, is_pinned: false, is_announcement: true, resources, ...extra };
}
const resource = (url = buy, kind: OfficialMemoryResource["kind"] = "TRADING"): OfficialMemoryResource => ({ url, kind, status: "confirmed", quote: "Our Raydium market is live" });

test("extractor cannot invent URLs, facts, kinds or unobserved destinations", () => {
  assert.ok(parseOfficialMemory(JSON.stringify([resource()]), "Our Raydium market is live", [buy]));
  assert.equal(parseOfficialMemory(JSON.stringify([resource("https://evil.test")]), "Our Raydium market is live", [buy]), null);
  assert.equal(parseOfficialMemory(JSON.stringify([resource()]), "Is this a fake Raydium link?", [buy]), null);
  assert.equal(parseOfficialMemory(JSON.stringify([{ ...resource(), kind: "BUY_NOW" }]), "Our Raydium market is live", [buy]), null);
  assert.deepEqual(parseOfficialMemory("[]", "Is this safe?", [buy]), []);
});

test("an unpinned admin listing answers how-to-buy with exact link across topics", () => {
  const items = currentOfficialMemoryItems([source("42", 1788825600, [resource(), resource(chart, "CHART")])]);
  const answer = buildCommunityKnowledgeGrounding("How do I buy?", items);
  assert.ok(answer);
  assert.equal(answer.facts[0].text, "Our Raydium market is live");
  assert.equal(answer.otherResources.find(r => r.kind === "TRADING")?.url, buy);
  assert.equal(items[0].sourceUrl, "https://t.me/bytehumors/42");
});

test("new endorsed buying URL supersedes an older pinned URL", () => {
  const items = currentOfficialMemoryItems([source("1", 100, [resource("https://old.test/buy")], { is_pinned: true }), source("2", 200, [resource()])]);
  assert.deepEqual(items.map(i => i.url), [buy]);
});

test("withdrawn or unresolved buying URLs never resurrect even older destinations", () => {
  const old = source("1", 100, [resource("https://old.test/buy")]);
  const announced = source("2", 200, [resource()]);
  const withdrawn = source("3", 300, [{ ...resource(), status: "retracted", kind: "OTHER" }]);
  assert.deepEqual(currentOfficialMemoryItems([old, announced, withdrawn]), []);
  assert.deepEqual(currentOfficialMemoryItems([old, announced, source("2", 300, [], { status: "failed" })]), []);
  assert.deepEqual(currentOfficialMemoryItems([old, announced, source("2", 300, [])]), []);
});

test("ambiguous same-time destinations and conflicting same-second edits are withheld", () => {
  assert.deepEqual(currentOfficialMemoryItems([source("1", 200, [resource()]), source("2", 200, [resource("https://other.test")])]), []);
  assert.deepEqual(currentOfficialMemoryItems([source("1", 200, [resource()], { content_hash: "a" }), source("1", 200, [resource("https://other.test")], { content_hash: "b" })]), []);
});
