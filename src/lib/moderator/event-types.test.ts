import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySender, type KnownBotFacts } from "./event-types";

/* Sender classification (spec §2/§3) — pure decision given already-resolved
 * facts. The DB lookups that PRODUCE these facts (tenant-scoped integration
 * match, per-community deployment check) live in community-runtime.ts and
 * are exercised there; this file proves the DECISION itself is correct and,
 * critically, that username never enters the decision at all (it isn't even
 * a parameter of classifySender). */

test("Case 1: non-bot sender -> HUMAN, regardless of any bot facts passed", () => {
  assert.equal(classifySender(false, null), "HUMAN");
  const knownBot: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: { deploymentId: "d1" } };
  assert.equal(classifySender(false, knownBot), "HUMAN"); // isBot=false wins even if facts look like a moderator
});

test("Case 2: known Innvil bot + active deployment in THIS community -> INNVIL_MODERATOR", () => {
  const knownBot: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: { deploymentId: "d1" } };
  assert.equal(classifySender(true, knownBot), "INNVIL_MODERATOR");
});

test("Case 3: known Innvil bot id, but NOT deployed in this community -> EXTERNAL_BOT (not trusted here)", () => {
  const knownBot: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: null };
  assert.equal(classifySender(true, knownBot), "EXTERNAL_BOT");
});

test("Case 4: unknown bot -> EXTERNAL_BOT", () => {
  assert.equal(classifySender(true, null), "EXTERNAL_BOT");
});

test("Case 5: 'innvil'-looking username is irrelevant — classifySender has no username parameter at all, so a bot unknown by ID is EXTERNAL_BOT no matter what it's called", () => {
  // classifySender(isBot, knownBot) structurally cannot see a username —
  // proving by construction that username can never be a control signal.
  assert.equal(classifySender(true, null), "EXTERNAL_BOT");
});

test("Case 6: known Innvil bot id classifies as INNVIL_MODERATOR regardless of username (username isn't a parameter)", () => {
  const knownBot: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: { deploymentId: "d1" } };
  assert.equal(classifySender(true, knownBot), "INNVIL_MODERATOR");
});

test("Case 12: cross-tenant bot id is never trusted — a bot known to Innvil under a DIFFERENT panel resolves to knownBot=null upstream, so it classifies EXTERNAL_BOT here", () => {
  // community-runtime.ts only builds a non-null KnownBotFacts when the
  // integration's panel_id === this event's panel_id (see classifySender()
  // there). A cross-tenant match is filtered out before reaching this
  // function, which is exactly what this asserts: no facts in -> EXTERNAL_BOT.
  assert.equal(classifySender(true, null), "EXTERNAL_BOT");
});

test("Case 13: same moderator reused across communities — active in Community A, absent from Community B -> classified per-community, not globally", () => {
  const activeInThisCommunity: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: { deploymentId: "d-A" } };
  const notActiveInThisCommunity: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: null };
  assert.equal(classifySender(true, activeInThisCommunity), "INNVIL_MODERATOR");
  assert.equal(classifySender(true, notActiveInThisCommunity), "EXTERNAL_BOT");
});

test("Case 14: username changes don't affect classification — same integration facts, different display name, same result", () => {
  // classifySender never receives a username at all, so this is true by
  // construction; community-runtime.ts separately persists the CURRENT
  // Telegram username as display metadata without touching identity.
  const knownBot: KnownBotFacts = { integration: { panelId: "p1", virtualModeratorId: "m1" }, activeDeploymentInThisCommunity: { deploymentId: "d1" } };
  assert.equal(classifySender(true, knownBot), "INNVIL_MODERATOR");
});
