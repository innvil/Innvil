import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMessageLinks, httpMessageLinks, exactResourceKey, serializeLinkProjectContext } from "./link-context";

test("hidden caption/text links survive extraction and UTF-16 offsets", () => {
  assert.deepEqual(extractMessageLinks("🔥 buy here", [{ type: "text_link", offset: 3, length: 8, url: "https://raydium.io/swap/?outputMint=BYTE" }]), ["https://raydium.io/swap/?outputMint=BYTE"]);
  assert.deepEqual(extractMessageLinks("🔥 https://x.com/a", [{ type: "url", offset: 3, length: 15 }]), ["https://x.com/a"]);
});

test("resource identity preserves trade parameters and does not trust a shared host", () => {
  assert.deepEqual(httpMessageLinks(["bytehumor.com/docs", "@ByteHumor", "https://raydium.io/swap/?outputMint=BYTE"]), ["https://bytehumor.com/docs", "https://raydium.io/swap/?outputMint=BYTE"]);
  assert.notEqual(exactResourceKey("https://raydium.io/swap/?outputMint=BYTE"), exactResourceKey("https://raydium.io/swap/?outputMint=FAKE"));
  assert.notEqual(exactResourceKey("https://x.com/official/status/1"), exactResourceKey("https://x.com/scammer/status/1"));
  assert.equal(exactResourceKey("https://official:password@evil.test"), null);
});

test("project, policy and untrusted page evidence are distinct and bounded", () => {
  const context = JSON.parse(serializeLinkProjectContext({ project: { name: "Byte Humor", overview: "x".repeat(10000) }, resources: [], senderRole: "member", topic: { name: "Promotion", solicitationAllowed: true }, links: [{ url: "https://x.com/thirdparty/status/1", status: "unavailable" }] }));
  assert.equal(context.project.name, "Byte Humor");
  assert.equal(context.project.overview.length, 5000);
  assert.equal(context.topic.solicitationAllowed, true);
  assert.equal(context.untrustedPageEvidence[0].status, "unavailable");
  assert.match(serializeLinkProjectContext(), /Do not infer unrelatedness/);
});
