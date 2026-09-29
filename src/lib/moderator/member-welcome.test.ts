import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMemberWelcome } from "./member-welcome";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";

const official = [{
  id: "1", messageThreadId: null, platformMessageId: "10", isAdminAuthor: true,
  isPinned: true, isAnnouncementTopic: true, kind: "TRADING" as const,
  url: "https://raydium.io/swap/?inputMint=token", text: "Official Raydium swap",
  createdAt: "2026-09-29T00:00:00.000Z",
}];

test("member welcome is persona-shaped, grounded, and includes only valid official links", () => {
  const text = buildMemberWelcome({
    members: [{ id: 1, firstName: "Mina" }],
    projectName: "Byte Humor",
    projectOverview: "A community-led Solana project.",
    persona: { ...DEFAULT_MODERATOR_PERSONA, slang: 80, emojiFrequency: 80 },
    allowSolicitation: false,
    officialMemory: [...official, { ...official[0], id: "bad", url: "javascript:alert(1)" }],
  });
  assert.match(text, /^hey Mina, welcome in — you are with Byte Humor now\./);
  assert.match(text, /A community-led Solana project\./);
  assert.match(text, /https:\/\/raydium\.io\/swap/);
  assert.doesNotMatch(text, /javascript:/);
  assert.match(text, /no unsolicited promos/i);
});

test("member welcome adapts safety guidance without turning into a generic help message", () => {
  const text = buildMemberWelcome({
    members: [{ id: 1, firstName: "Mina" }, { id: 2, username: "leo" }],
    projectName: "Innvil",
    projectOverview: null,
    persona: { ...DEFAULT_MODERATOR_PERSONA, formal: true, formality: 90 },
    allowSolicitation: true,
    officialMemory: [],
  });
  assert.match(text, /^Welcome, Mina and leo\. Glad to have you with Innvil\./);
  assert.match(text, /Keep it respectful/);
  assert.doesNotMatch(text, /unsolicited promos/i);
  assert.doesNotMatch(text, /How can I help/i);
});
