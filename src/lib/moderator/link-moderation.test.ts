import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks, normalizeLink, linkHash, recordLinkObservation, isFloodRepeat, decideLinkEnforcement,
  EMPTY_WARNING_STATE, FLOOD_WINDOW_MS, FLOOD_REPEAT_THRESHOLD, PROMOTION_WARNING_LIMIT,
  effectiveScamStrikeCount, SCAM_STRIKE_WINDOW_MS, renderHumanModerationMention, scamFirstOffenseWarningHtml, scamRepeatOffenseWarningHtml,
  normalizeTelegramUsername, isOwnBotMention, filterOutOwnBotMentions,
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

/* --------------------------------------------------------- self-mention exemption ---- */
/* Live bug: a legitimate mention of a Watcher's OWN Telegram username was
   being extracted as a "link" candidate and deleted/warned as scam/promotion
   merely because it contained an @username. normalizeTelegramUsername /
   isOwnBotMention / filterOutOwnBotMentions are the fix -- a bare mention of
   one of the community's own deployed bot usernames is addressing, never a
   moderation candidate, while every OTHER link in the same message is left
   untouched. */

test("normalizeTelegramUsername strips a leading @, lowercases, and trims", () => {
  assert.equal(normalizeTelegramUsername("@MrPresWan_Bot"), "mrpreswan_bot");
  assert.equal(normalizeTelegramUsername("  mrpreswan_bot  "), "mrpreswan_bot");
  assert.equal(normalizeTelegramUsername("mrpreswan_bot"), "mrpreswan_bot");
});

test("REQUIRED (live bug): isOwnBotMention recognizes the Watcher's own username, case-insensitively, with or without a leading @", () => {
  assert.equal(isOwnBotMention("@mrpreswan_bot", ["MrPresWan_Bot"]), true);
  assert.equal(isOwnBotMention("@MRPRESWAN_BOT", ["mrpreswan_bot"]), true);
});

test("isOwnBotMention returns false for a candidate that isn't a bare @handle at all (a URL)", () => {
  assert.equal(isOwnBotMention("https://example.com", ["mrpreswan_bot"]), false);
});

test("isOwnBotMention returns false for an unrelated external handle", () => {
  assert.equal(isOwnBotMention("@some_random_scammer", ["mrpreswan_bot"]), false);
});

test("isOwnBotMention safely handles null/empty bot usernames (never crashes, never a false match)", () => {
  assert.equal(isOwnBotMention("@anything", [null, null]), false);
  assert.equal(isOwnBotMention("@anything", []), false);
});

test("REQUIRED (live bug repro): filterOutOwnBotMentions removes ONLY the self-mention, leaving the message with zero moderation candidates", () => {
  const links = extractLinks("@mrpreswan_bot hello");
  assert.deepEqual(links, ["@mrpreswan_bot"]);
  assert.deepEqual(filterOutOwnBotMentions(links, ["mrpreswan_bot"]), []);
});

test("REQUIRED: a self-mention in a normal sentence is still exempt", () => {
  const links = extractLinks("hey @mrpreswan_bot what do you think about this?");
  assert.deepEqual(filterOutOwnBotMentions(links, ["mrpreswan_bot"]), []);
});

test("REQUIRED (requirement 4 -- real threats still enforceable): a self-mention alongside a REAL phishing link only removes the self-mention, the phishing link remains a candidate", () => {
  const links = extractLinks("@mrpreswan_bot click https://totally-legit-wallet-drainer.xyz now!");
  const filtered = filterOutOwnBotMentions(links, ["mrpreswan_bot"]);
  assert.deepEqual(filtered, ["https://totally-legit-wallet-drainer.xyz"]);
});

test("REQUIRED (requirement 8 -- multi-Watcher): mentioning a DIFFERENT deployed Watcher's username is also exempt for every deployed bot, not just the one mentioned", () => {
  const links = extractLinks("@kwan_mod_bot what do you think?");
  // Simulates Test's own moderation pass in a community where both Kwan and
  // Test are deployed -- Test must never treat a mention of Kwan's username
  // as a spam signal just because it isn't Test's own username.
  assert.deepEqual(filterOutOwnBotMentions(links, ["kwan_mod_bot", "test1_mod_bot"]), []);
});

test("an arbitrary external @username with no other suspicious content is NOT removed by this exemption (it's still a real candidate -- classification, not extraction, is what must judge it fairly)", () => {
  const links = extractLinks("@totally_unrelated_person said hi");
  assert.deepEqual(filterOutOwnBotMentions(links, ["mrpreswan_bot"]), ["@totally_unrelated_person"]);
});

test("filterOutOwnBotMentions is a no-op when no bot usernames are known (never accidentally exempts everything)", () => {
  const links = extractLinks("@somebody hello https://example.com");
  assert.deepEqual(filterOutOwnBotMentions(links, [null, null]), links);
  assert.deepEqual(filterOutOwnBotMentions(links, []), links);
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
    priorScamStrikeCount: 0,
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

test("REQUIRED (scenario 1): first confirmed high-confidence scam/phishing offense -> DELETE_WARN, never an instant ban", () => {
  assert.deepEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "high" }), { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing" });
});

test("REQUIRED (scenario 2): second confirmed high-confidence scam offense within the strike window -> DELETE_KICK", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount: 1 }),
    { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing" }
  );
});

test("a third confirmed high-confidence scam offense falls back to the existing stronger DELETE_BAN path, not a new punishment engine", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount: 2 }),
    { kind: "DELETE_BAN", reason: "repeated_scam_or_phishing" }
  );
});

test("REQUIRED: scam strike escalation is never role-exempt -- an admin/trusted sender still gets the graduated response", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", isAdminOrTrusted: true }),
    { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing" }
  );
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", isAdminOrTrusted: true, priorScamStrikeCount: 1 }),
    { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing" }
  );
});

test("REQUIRED (scenario 9): borderline/uncertain (medium or low confidence) scam classification never triggers strike escalation", () => {
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "medium", priorScamStrikeCount: 1 }).kind, "DELETE_KICK");
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "low", priorScamStrikeCount: 1 }).kind, "DELETE_KICK");
});

test("REQUIRED (scenario 13): ordinary UNSOLICITED_PROMOTION escalation is completely unaffected by the new scam strike counter", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", priorWarningCount: 0, priorScamStrikeCount: 5 }), { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion" });
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

/* ------------------------------------------------------- scam strike expiry ---- */

test("REQUIRED (scenario 3): a strike well outside the 30-day window reads as 0 -- a later scam offense behaves as first offense again", () => {
  const strikeAt = "2026-01-01T00:00:00Z";
  const now = new Date(new Date(strikeAt).getTime() + SCAM_STRIKE_WINDOW_MS + 1);
  assert.equal(effectiveScamStrikeCount(1, strikeAt, now), 0);
});

test("a strike still within the 30-day window is fully in effect", () => {
  const strikeAt = "2026-01-01T00:00:00Z";
  const now = new Date(new Date(strikeAt).getTime() + SCAM_STRIKE_WINDOW_MS - 1);
  assert.equal(effectiveScamStrikeCount(1, strikeAt, now), 1);
});

test("no prior strike at all (never violated) -> 0, regardless of stored count", () => {
  assert.equal(effectiveScamStrikeCount(1, null, new Date()), 0);
});

test("exactly at the window boundary is treated as expired (strict less-than, same convention as the flood window)", () => {
  const strikeAt = "2026-01-01T00:00:00Z";
  const now = new Date(new Date(strikeAt).getTime() + SCAM_STRIKE_WINDOW_MS);
  assert.equal(effectiveScamStrikeCount(1, strikeAt, now), 0);
});

test("SCAM_STRIKE_WINDOW_MS is 30 days", () => {
  assert.equal(SCAM_STRIKE_WINDOW_MS, 30 * 24 * 60 * 60_000);
});

test("REQUIRED (scenario 3, end-to-end via decide()): an expired strike means the next scam offense is treated as a fresh first offense (DELETE_WARN, not DELETE_KICK)", () => {
  const strikeAt = "2026-01-01T00:00:00Z";
  const now = new Date(new Date(strikeAt).getTime() + SCAM_STRIKE_WINDOW_MS + 1);
  const priorScamStrikeCount = effectiveScamStrikeCount(1, strikeAt, now);
  assert.deepEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount }), { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing" });
});

/* --------------------------------------------------- identity/mention rendering ---- */

test("REQUIRED (human warning WITH username): renderHumanModerationMention prefers a real @username mention when one exists", () => {
  const mention = renderHumanModerationMention("999", "jon_arthur1", "Jon Arthur");
  assert.equal(mention, "@jon_arthur1");
});

test("the @username mention is plain text -- never wrapped in an HTML anchor", () => {
  const mention = renderHumanModerationMention("999", "jon_arthur1", "Jon Arthur");
  assert.ok(!mention.includes("<a "));
});

test("REQUIRED (human warning WITHOUT username): falls back to a stable tg://user id-based mention, never a missing/unaddressed warning", () => {
  const mention = renderHumanModerationMention("123456789", null, "Alice");
  assert.match(mention, /^<a href="tg:\/\/user\?id=123456789">Alice<\/a>$/);
  assert.ok(!mention.includes("@"));
});

test("the id-based fallback falls back to a generic label when the sender has no display name either", () => {
  const mention = renderHumanModerationMention("123456789", null, null);
  assert.match(mention, /^<a href="tg:\/\/user\?id=123456789">there<\/a>$/);
});

test("REQUIRED (escaping): the id-based fallback escapes HTML-significant characters in a user-controlled display name", () => {
  const mention = renderHumanModerationMention("1", null, '<script>alert("x")</script>');
  assert.ok(!mention.includes("<script>"));
  assert.match(mention, /&lt;script&gt;/);
});

test("an empty-string username is treated the same as no username at all", () => {
  const mention = renderHumanModerationMention("1", "", "Alice");
  assert.match(mention, /^<a href="tg:\/\/user\?id=1">Alice<\/a>$/);
});

test("REQUIRED (scenario 7): the first-offense scam warning never includes a URL", () => {
  const text = scamFirstOffenseWarningHtml(renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur"));
  assert.ok(!/https?:\/\//i.test(text));
  assert.match(text, /suspected scam\/phishing link/i);
  assert.match(text, /removal from this community/i);
});

test("the first-offense warning explicitly includes @username when the sender has one, matching the exact requested wording", () => {
  const text = scamFirstOffenseWarningHtml(renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur"));
  assert.equal(text, "@jon_arthur1, your message was removed because it contained a suspected scam/phishing link. Do not post scam, wallet-drainer, or fake reward links. Repeated violations may result in removal from this community.");
});

test("REQUIRED (scenario 7): the second-offense (kick) warning never includes a URL either", () => {
  const text = scamRepeatOffenseWarningHtml(renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur"));
  assert.ok(!/https?:\/\//i.test(text));
  assert.match(text, /removed from this community/i);
});

test("the repeat-offense warning explicitly includes @username, matching the exact requested wording", () => {
  const text = scamRepeatOffenseWarningHtml(renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur"));
  assert.equal(text, "@jon_arthur1, another scam/phishing link was detected. You have been removed from this community.");
});

test("first-offense and repeat-offense warning texts are distinct (never the same message for both tiers)", () => {
  const mention = renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur");
  assert.notEqual(scamFirstOffenseWarningHtml(mention), scamRepeatOffenseWarningHtml(mention));
});

/* ------------------------------------------------- scheme-less domain extraction ---- */

test("REQUIRED (live repro): a scheme-less scam domain (no https://) is still extracted as a link candidate", () => {
  assert.deepEqual(extractLinks("Open your SOLANA mystery box mysteryboxsol.live claim your rewards"), ["mysteryboxsol.live"]);
});

test("a scheme-less domain with a path is extracted whole", () => {
  assert.deepEqual(extractLinks("check mysteryboxsol.live/claim now"), ["mysteryboxsol.live/claim"]);
});

test("a scheme-less domain is not double-counted when the same link also appears with https://", () => {
  assert.deepEqual(extractLinks("mysteryboxsol.live or https://mysteryboxsol.live"), ["https://mysteryboxsol.live"]);
});

test("REQUIRED (false-positive guard): common abbreviations like e.g./i.e./etc. are never extracted as links", () => {
  assert.deepEqual(extractLinks("e.g. this is a good point, i.e. exactly what I meant, etc."), []);
});

test("REQUIRED (false-positive guard): a decimal number is never extracted as a link", () => {
  assert.deepEqual(extractLinks("the ratio is about 3.14 or so"), []);
});

test("REQUIRED (false-positive guard): a software version number is never extracted as a link", () => {
  assert.deepEqual(extractLinks("we shipped v2.0 of the app today"), []);
});

test("a bare domain with an unrecognized/non-allowlisted TLD is not extracted (avoids over-broad matching)", () => {
  assert.deepEqual(extractLinks("check out somefile.exe or randomword.zzz"), []);
});
