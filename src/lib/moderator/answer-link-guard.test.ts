import { test } from "node:test";
import assert from "node:assert/strict";
import { answerLinksAreGrounded } from "./answer-link-guard";
import type { CommunityKnowledgeGrounding } from "./community-message-knowledge";
const buy = "https://raydium.io/swap/?outputMint=BYTE";
const grounding: CommunityKnowledgeGrounding = { facts: [], pinnedReference: null, whitepaperLink: null,
  otherResources: [{ kind: "TRADING", url: buy }, { kind: "CHART", url: "https://dexscreener.com/solana/byte" }] };

test("buy replies use the exact trading URL, never a chart or synthesized token parameter", () => {
  assert.equal(answerLinksAreGrounded(`Buy here: ${buy}`, "How do I buy?", grounding), true);
  assert.equal(answerLinksAreGrounded("https://raydium.io/swap/?outputMint=WRONG", "How do I buy?", grounding), false);
  assert.equal(answerLinksAreGrounded("https://dexscreener.com/solana/byte", "How do I buy?", grounding), false);
  assert.equal(answerLinksAreGrounded("https://dexscreener.com/solana/byte", "Where's the chart?", grounding), true);
});

test("known host alone and a model-created buying URL are not grounding", () => {
  assert.equal(answerLinksAreGrounded(buy, "How do I buy?"), false);
  assert.equal(answerLinksAreGrounded("Check https://example.com", "Where are docs?", null, ["Docs: https://example.com"]), true);
});

test("bare destinations cannot bypass exact answer-link grounding", () => {
  assert.equal(answerLinksAreGrounded("Buy on fake-buy-site.com", "How do I buy?", grounding), false);
  assert.equal(answerLinksAreGrounded("raydium.io/swap/?outputMint=WRONG", "How do I buy?", grounding), false);
  assert.equal(answerLinksAreGrounded("raydium.io/swap/?outputMint=BYTE", "How do I buy?", grounding), true);
  assert.equal(answerLinksAreGrounded("dexscreener.com/solana/byte", "How do I buy?", grounding), false);
  assert.equal(answerLinksAreGrounded("Docs: example.com/docs", "Where are docs?", null, ["https://example.com/docs"]), true);
  assert.equal(answerLinksAreGrounded("https://user:secret@example.com/docs", "Where are docs?", null, ["https://example.com/docs"]), false);
});
