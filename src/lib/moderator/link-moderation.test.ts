import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks, normalizeLink, linkHash, recordLinkObservation, isFloodRepeat, decideLinkEnforcement,
  EMPTY_WARNING_STATE, FLOOD_WINDOW_MS, FLOOD_REPEAT_THRESHOLD, PROMOTION_WARNING_LIMIT,
  type LinkWarningState,
} from "./link-moderation";

/**
 * Phase 4.M (C)-(E): intelligent external-link moderation is a SEPARATE
 * decision from Natural Chatter (spec §18) -- pure policy layer, no AI, no
 * I/O. Classification (link-classify.ts) informs this; it never decides
 * alone (spec §42, "don't use LLM as sole ban authority").
 */

/* ---------------------------------------------------------- extraction/normalization ---- */

test("extractLinks finds a plain https URL", () => {
  assert.deepEqual(extractLinks("check this out https://example.com/page"), ["https://example.com/page"]);
});

test("extractLinks finds a Telegram @handle reference", () => {
  assert.deepEqual(extractLinks("join our group @othergroup"), ["@othergroup"]);
});

test("extractLinks finds multiple distinct links, deduped, order-preserving", () => {
  assert.deepEqual(
    extractLinks("see https://a.com and https://b.com, also https://a.com again"),
    ["https://a.com", "https://b.com"]
  );
});

test("extractLinks returns empty for an ordinary message with no links", () => {
  assert.deepEqual(extractLinks("hey how's everyone doing today"), []);
});

test("normalizeLink strips common tracking params without changing destination", () => {
  assert.equal(normalizeLink("https://Example.com/Path?utm_source=x&id=5"), "example.com/path?id=5");
});

test("normalizeLink strips a trailing slash", () => {
  assert.equal(normalizeLink("https://example.com/page/"), "example.com/page");
});

test("normalizeLink lowercases the hostname but preserves path casing beyond simple normalization consistently", () => {
  assert.equal(normalizeLink("https://EXAMPLE.com/page"), normalizeLink("https://example.com/page"));
});

test("normalizeLink treats different paths on the same host as different destinations", () => {
  assert.notEqual(normalizeLink("https://example.com/a"), normalizeLink("https://example.com/b"));
});

test("linkHash is stable for the same normalized link and differs for different ones", () => {
  assert.equal(linkHash("https://example.com/a?utm_source=x"), linkHash("https://example.com/a?utm_medium=y"));
  assert.notEqual(linkHash("https://example.com/a"), linkHash("https://example.com/b"));
});

/* -------------------------------------------------------------------- flood window ---- */

test("REQUIRED (spec §54.6): the same link repeated rapidly (well within the flood window, several times) classifies as a flood repeat", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hash = linkHash("https://t.me/othergroup");
  let state = EMPTY_WARNING_STATE;
  state = recordLinkObservation(state, hash, new Date(now.getTime() + 0));
  state = recordLinkObservation(state, hash, new Date(now.getTime() + 10_000));
  state = recordLinkObservation(state, hash, new Date(now.getTime() + 20_000));
  assert.equal(isFloodRepeat(state), true);
});

test("REQUIRED (spec §54.7): a legitimate AMA request repeated ~35 minutes later is a FRESH evaluation, not automatically flagged as flood", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hash = linkHash("https://projectxyz.com");
  let state = recordLinkObservation(EMPTY_WARNING_STATE, hash, now);
  state = recordLinkObservation(state, hash, new Date(now.getTime() + 35 * 60_000));
  assert.equal(isFloodRepeat(state), false); // window reset -- window counter starts over, not a flood
});

test("REQUIRED (spec §31): 30 minutes only changes the RAPID-FLOOD interpretation -- it does NOT erase warningCount (long-term history)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hash = linkHash("https://t.me/othergroup");
  let state: LinkWarningState = { ...EMPTY_WARNING_STATE, warningCount: 2 };
  state = recordLinkObservation(state, hash, new Date(now.getTime() + 40 * 60_000)); // well past the flood window
  assert.equal(isFloodRepeat(state), false);
  assert.equal(state.warningCount, 2, "warningCount must survive untouched -- flood-window logic never resets it");
});

test("a DIFFERENT link posted right after does not count toward the same flood streak", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  let state = recordLinkObservation(EMPTY_WARNING_STATE, linkHash("https://a.com"), now);
  state = recordLinkObservation(state, linkHash("https://b.com"), new Date(now.getTime() + 5_000));
  assert.equal(state.recentLinkCountInWindow, 1);
  assert.equal(isFloodRepeat(state), false);
});

test("exactly at the flood window boundary is treated as a fresh window (strict less-than)", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const hash = linkHash("https://t.me/othergroup");
  let state = recordLinkObservation(EMPTY_WARNING_STATE, hash, now);
  state = recordLinkObservation(state, hash, new Date(now.getTime() + FLOOD_WINDOW_MS));
  assert.equal(state.recentLinkCountInWindow, 1);
});

test("FLOOD_REPEAT_THRESHOLD and FLOOD_WINDOW_MS are the documented values", () => {
  assert.equal(FLOOD_REPEAT_THRESHOLD, 3);
  assert.equal(FLOOD_WINDOW_MS, 30 * 60_000);
});

/* -------------------------------------------------------- decideLinkEnforcement policy ---- */
// Maps directly onto spec §54's 14 required scenarios.

function decide(over: Partial<Parameters<typeof decideLinkEnforcement>[0]>) {
  return decideLinkEnforcement({
    category: "UNSOLICITED_PROMOTION",
    confidence: "high",
    isAdminOrTrusted: false,
    floodRepeat: false,
    priorWarningCount: 0,
    ...over,
  });
}

test("REQUIRED (§54.1): unsolicited promotion, no legitimate context -> DELETE_WARN, warning #1", () => {
  const result = decide({ category: "UNSOLICITED_PROMOTION" });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion" });
});

test("REQUIRED (§54.2): a genuine AMA proposal -> ALLOW", () => {
  assert.deepEqual(decide({ category: "AMA_REQUEST" }), { kind: "ALLOW" });
});

test("REQUIRED (§54.3): a legitimate collab guest-group link -> ALLOW", () => {
  assert.deepEqual(decide({ category: "COLLABORATION_REQUEST" }), { kind: "ALLOW" });
});

test('REQUIRED (§54.4): "leave this group and join ours" -> DELETE_WARN', () => {
  const result = decide({ category: "UNSOLICITED_PROMOTION" });
  assert.equal(result.kind, "DELETE_WARN");
});

test("REQUIRED (§54.5): high-confidence explicit/pornographic link -> immediate DELETE_BAN, no warning grace period", () => {
  assert.deepEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "high" }), { kind: "DELETE_BAN", reason: "explicit_content" });
});

test("high-confidence phishing/scam link -> immediate DELETE_BAN", () => {
  assert.deepEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "high" }), { kind: "DELETE_BAN", reason: "phishing" });
});

test("LOW-confidence explicit/phishing does NOT auto-ban -- confidence gates severe enforcement too", () => {
  assert.notEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "low" }).kind, "DELETE_BAN");
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "low" }).kind, "DELETE_BAN");
});

test("REQUIRED (§54.6): flagged as flood/spam -> DELETE_BAN directly, not a 3-warning grace period", () => {
  assert.deepEqual(decide({ category: "LINK_SPAM_OR_FLOOD" }), { kind: "DELETE_BAN", reason: "flood" });
});

test("REQUIRED: a floodRepeat signal escalates straight to DELETE_BAN even if classified as ordinary unsolicited promotion", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", floodRepeat: true }), { kind: "DELETE_BAN", reason: "flood" });
});

test("REQUIRED (§54.8/§54.9): repeated unsolicited promotion continues escalating warning counts, non-flood", () => {
  assert.deepEqual(decide({ priorWarningCount: 1 }), { kind: "DELETE_WARN", warningNumber: 2, reason: "repeated_unsolicited_promotion" });
  assert.deepEqual(decide({ priorWarningCount: 2 }), { kind: "DELETE_WARN", warningNumber: 3, reason: "repeated_unsolicited_promotion" });
});

test("REQUIRED (§54.9): the 4th unsolicited-promotion violation (past the 3-warning limit) -> DELETE_BAN", () => {
  assert.deepEqual(decide({ priorWarningCount: PROMOTION_WARNING_LIMIT }), { kind: "DELETE_BAN", reason: "repeated_unsolicited_promotion" });
});

test("REQUIRED (§54.10): unknown/ambiguous, unfamiliar-looking link -> ALLOW, never an automatic permanent ban", () => {
  assert.deepEqual(decide({ category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low", priorWarningCount: 5 }), { kind: "ALLOW" });
});

test("REQUIRED (§54.13): an admin/trusted user posting what would otherwise be ordinary promotion -> ALLOW (role exemption)", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", isAdminOrTrusted: true }), { kind: "ALLOW" });
});

test("admin/trusted exemption does NOT apply to severe content -- safety is never role-exempt", () => {
  assert.deepEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "high", isAdminOrTrusted: true }), { kind: "DELETE_BAN", reason: "explicit_content" });
});

test("admin/trusted exemption does NOT apply to an obvious flood/spam signal either", () => {
  assert.deepEqual(decide({ category: "LINK_SPAM_OR_FLOOD", isAdminOrTrusted: true }), { kind: "DELETE_BAN", reason: "flood" });
});

test("a SAFE_RELEVANT_LINK is always ALLOW regardless of history", () => {
  assert.deepEqual(decide({ category: "SAFE_RELEVANT_LINK", priorWarningCount: 5, floodRepeat: true }), { kind: "ALLOW" });
});

test("an APPROVED_PARTNER_LINK is always ALLOW", () => {
  assert.deepEqual(decide({ category: "APPROVED_PARTNER_LINK" }), { kind: "ALLOW" });
});

test("a PARTNERSHIP_REQUEST is ALLOW, same as COLLABORATION_REQUEST/AMA_REQUEST", () => {
  assert.deepEqual(decide({ category: "PARTNERSHIP_REQUEST" }), { kind: "ALLOW" });
});
