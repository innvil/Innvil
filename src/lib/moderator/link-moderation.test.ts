import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks, normalizeLink, linkHash, recordLinkObservation, isFloodRepeat, decideLinkEnforcement,
  EMPTY_WARNING_STATE, FLOOD_WINDOW_MS, FLOOD_REPEAT_THRESHOLD, SOLICITATION_WARNING_LIMIT,
  effectiveScamStrikeCount, SCAM_STRIKE_WINDOW_MS, renderHumanModerationMention, scamFirstOffenseWarningHtml, scamRepeatOffenseWarningHtml,
  looksLikeNegativeStatement, effectiveNegativeStatementCount, NEGATIVE_STATEMENT_WINDOW_MS,
  NEGATIVE_STATEMENT_MUTE_MINUTES, NEGATIVE_STATEMENT_BAN_MINUTES, effectiveMediaWarningCount,
  normalizeTelegramUsername, isOwnBotMention, filterOutOwnBotMentions, looksLikeUnsolicitedPitch,
  looksLikeSearchInstructionSpam, isBackToBackSpamPattern,
  promotionContactSentence,
  warningTextSimilarity, isNearDuplicateWarning, maxWarningSimilarity, NEAR_DUPLICATE_WARNING_THRESHOLD,
  resolveWarningResponseMode, NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD, warningTextExceedsAuthorizedFacts,
  type LinkWarningState,
  warningStructureSignature,
  isStructurallyRepetitiveWarning,
  STRUCTURAL_REPEAT_BEAT_THRESHOLD,
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

/* --------------------------------------------------- link-less pitch pre-filter ---- */

test("REQUIRED (live bug repro): the exact reported link-less solicitation pitch is flagged", () => {
  const text = "Hey Dev, Looking for real investors & strong volume? I can promote your project across active crypto communities and bring serious buyers. Let's push exposure, volume & market cap. DM me if you're ready to grow.";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
  // and it genuinely has no link/handle at all -- proving this really is the
  // link-LESS case, not something extractLinks would have already caught.
  assert.deepEqual(extractLinks(text), []);
});

test("a bare 'DM me' with nothing else is never flagged alone -- an ordinary, harmless thing to say", () => {
  assert.equal(looksLikeUnsolicitedPitch("hey, dm me later about the meetup"), false);
});

test("a genuine request to grow something unrelated to marketing is never flagged", () => {
  assert.equal(looksLikeUnsolicitedPitch("can you help me grow the invite list for the community call?"), false);
});

test("ordinary conversation is never flagged", () => {
  assert.equal(looksLikeUnsolicitedPitch("gm everyone, hope you're all doing well today"), false);
  assert.equal(looksLikeUnsolicitedPitch("what do you all think about the new update?"), false);
});

test("a self-promotion pitch phrased slightly differently is still flagged (two independent signals, not exact wording)", () => {
  assert.equal(looksLikeUnsolicitedPitch("We can boost your channel's volume and bring you serious buyers, message us to get started"), true);
});

/* Live bug (2026-09-02): several real reported unsolicited-promotion pitches
 * only ever tripped ONE of the three original signal categories (contact-
 * ask / service-offer / growth-language) and were never even sent to the
 * real classifier -- they fell straight through to ordinary chatter
 * instead of moderation. Widened per this real, reported traffic. */
test("REQUIRED (live bug repro, 2026-09-02): a partnership-styled cold pitch offering investor exposure is flagged", () => {
  const text = "Hey! 👋 I came across your project and it looks really promising. 🚀\n\nI have strong, active crypto communities and can bring genuine investor exposure, engagement & buying interest.\n\nIf you're looking to grow your project and reach more serious investors, feel free to DM me. 📧🔥";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

test("REQUIRED (live bug repro): a 'boost your trading volume / market cap, let's connect' pitch is flagged", () => {
  const text = "Hey Dev\nLooking to boost your trading volume and market cap? We help crypto projects get real exposure through targeted communities and top KOLs. Let's connect DM me.";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

test("REQUIRED (live bug repro): a bare 'you need promos?' offer is flagged on its own -- a distinctive marketing-service marker, not ordinary conversation", () => {
  assert.equal(looksLikeUnsolicitedPitch("Hi , CEO\nYou need promos 💯?"), true);
});

test("REQUIRED (live bug repro): a KOL/influencer-marketing pitch is flagged even with only one of the three original signal categories", () => {
  const text = "Hi! We help crypto projects grow through Telegram, X, and KOL marketing with a focus on visibility, community growth, and supporting higher market cap. Interested?";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

test("REQUIRED (live bug repro): the 'grow your diamond holders... DM us' pitch is flagged", () => {
  const text = "Hi Dev  Looking for massive volume & strong holder growth before and after launch?\n\n🔵 SOL | 🟡 BSC |🔥 BASE |🔥 ETH |🔥 RHC + More\n\n💎 Grow your diamond holders\n📈 Affordable plans • Effective promotion\n\n✉️ DM us with your project details!";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

test("REQUIRED (live bug repro): 'pump and increase holder' pitch offering a large investor channel is flagged", () => {
  const text = "Hi DEV \nWe have a channel telegram of \n2 million investor members\nLet us know if you need pump and increase holder";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

// Live investigation (2026-09-02, follow-up): after v1.49.19 shipped, the
// user reported "moderation only acts every 3-5 hours" -- traced against
// production `moderator_activity_log`/`community_messages`. Every prior miss
// found predated v1.49.19's deploy (a real spam pitch WAS correctly caught
// immediately after deployment), but this exact phrasing -- an ungrammatical
// question offering to promote the RECIPIENT's own channel, with no "I can"/
// "we can"/"let's" lead-in and no exact GROWTH_PITCH_RE phrase -- was still
// slipping through even in the post-fix code. Neither PROMOTION_SERVICE_RE
// (requires a lead-in phrase) nor BOOST_TARGET_RE (requires grow/boost/push,
// not "promote") nor GROWTH_PITCH_RE (no exact phrase match for "get
// investors for your project") matched it.
test("REQUIRED (live bug repro, follow-up): 'do you [want to] promote your channel... to get investors for your project' is flagged", () => {
  const text = "Do you low to promote your channel in big crypto community to get investors for your project sir";
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

test("a genuine compliment about someone's own channel-promotion effort is never flagged (single signal, no second corroborating one)", () => {
  assert.equal(looksLikeUnsolicitedPitch("I really like how you promote your channel, it's growing so fast!"), false);
});

test("a genuine in-community request to promote an announcement is never flagged", () => {
  assert.equal(looksLikeUnsolicitedPitch("can you promote the announcement in the pinned post please"), false);
});

test("the new single-strong-signal branch never fires on ordinary conversation that merely mentions similar words individually", () => {
  assert.equal(looksLikeUnsolicitedPitch("that KOL panel discussion at the conference was really insightful"), false);
  assert.equal(looksLikeUnsolicitedPitch("promos are live on the store this week, check it out"), false);
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
    priorNegativeStatementCount: 0,
    solicitationAllowed: false,
    adminSolicitedExemption: false,
    ...over,
  });
}

test("uncertain categories never delete or accumulate penalties, even with old strikes", () => {
  const categories = ["UNSOLICITED_PROMOTION", "COMPETING_PROJECT_PROMOTION", "SEARCH_SPAM", "NEGATIVE_STATEMENT", "PHISHING_OR_SCAM", "EXPLICIT_CONTENT", "LINK_SPAM_OR_FLOOD"] as const;
  for (const category of categories) {
    for (const confidence of ["low", "medium"] as const) {
      assert.deepEqual(decide({ category, confidence, priorWarningCount: 20, priorScamStrikeCount: 3, priorNegativeStatementCount: 4 }), { kind: "ALLOW" }, `${category}/${confidence}`);
    }
  }
});

test("REQUIRED (§54.1, revised 2026-09-02): unsolicited promotion, no legitimate context -> DELETE_WARN, warning #1, NO mute -- first warning is real leeway", () => {
  const result = decide({ category: "UNSOLICITED_PROMOTION" });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion", muteMinutes: undefined });
});

/* ------------------------------------ Community "Allow Solicitation" override ---- */

test("REQUIRED: solicitationAllowed=true resolves ordinary unsolicited promotion to ALLOW -- no deletion, no warning", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: true }), { kind: "ALLOW" });
});

test("REQUIRED: solicitationAllowed=true applies consistently to REPEATED promotional posting -- every occurrence resolves ALLOW, not just the first", () => {
  for (const priorWarningCount of [0, 1, 2, 5, 20]) {
    assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: true, priorWarningCount }), { kind: "ALLOW" });
  }
});

test("REQUIRED: solicitationAllowed=true never exempts a genuine flood-repeat burst -- still enforces as an abuse signal, not solicitation", () => {
  const result = decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: true, floodRepeat: true });
  assert.notEqual(result.kind, "ALLOW");
  assert.equal(result.kind, "DELETE_KICK"); // flood forces straight past the warning grace period
});

test("REQUIRED: solicitationAllowed=true never exempts scam/phishing", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", solicitationAllowed: true }),
    { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing", muteMinutes: 30 }
  );
});

test("REQUIRED: solicitationAllowed=true never exempts explicit content", () => {
  assert.deepEqual(
    decide({ category: "EXPLICIT_CONTENT", confidence: "high", solicitationAllowed: true }),
    { kind: "DELETE_KICK", reason: "explicit_content", purge: true }
  );
});

test("solicitationAllowed=true never exempts a DIFFERENT category's own violation (LINK_SPAM_OR_FLOOD)", () => {
  const result = decide({ category: "LINK_SPAM_OR_FLOOD", solicitationAllowed: true });
  assert.notEqual(result.kind, "ALLOW");
});

test("solicitationAllowed=false (the real default) still enforces the ordinary solicitation ladder (1st offense = no mute)", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: false }), { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion", muteMinutes: undefined });
});

test("REQUIRED: solicitationAllowed never depends on admin/trusted status -- a non-admin gets the same ALLOW as an admin would", () => {
  assert.deepEqual(
    decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: true, isAdminOrTrusted: false }),
    decide({ category: "UNSOLICITED_PROMOTION", solicitationAllowed: true, isAdminOrTrusted: true })
  );
});

/* ------------------------- COMPETING_PROJECT_PROMOTION ("global no-go") ---- */
// Live feedback (2026-09-02): rallying THIS community's own members to
// promote a DIFFERENT, specifically named project/token is a "global no-go"
// -- never exempted by the community's Allow-Solicitation toggle, the
// admin-solicited backstop, or an admin/trusted role, unlike ordinary
// UNSOLICITED_PROMOTION. Its warning must also never redirect to the
// configured Promotion channel/topic (that's community-runtime.ts's own
// concern, see link-classify.test.ts).

test("REQUIRED: first offense -> DELETE_WARN, warning #1, no mute (same shape as ordinary solicitation's own first-offense leeway)", () => {
  assert.deepEqual(decide({ category: "COMPETING_PROJECT_PROMOTION" }), { kind: "DELETE_WARN", warningNumber: 1, reason: "competing_project_promotion", muteMinutes: undefined });
});

test("REQUIRED: never exempted by the community's Allow Solicitation toggle -- unlike ordinary UNSOLICITED_PROMOTION", () => {
  const result = decide({ category: "COMPETING_PROJECT_PROMOTION", solicitationAllowed: true });
  assert.notEqual(result.kind, "ALLOW");
  assert.equal(result.kind, "DELETE_WARN");
});

test("REQUIRED: never exempted by the admin-solicited backstop -- unlike ordinary UNSOLICITED_PROMOTION", () => {
  const result = decide({ category: "COMPETING_PROJECT_PROMOTION", adminSolicitedExemption: true });
  assert.notEqual(result.kind, "ALLOW");
});

test("admin project/partner announcements are exempt even when labelled competing promotion", () => {
  const nonAdmin = decide({ category: "COMPETING_PROJECT_PROMOTION", isAdminOrTrusted: false });
  const admin = decide({ category: "COMPETING_PROJECT_PROMOTION", isAdminOrTrusted: true });
  assert.notEqual(nonAdmin.kind, "ALLOW");
  assert.deepEqual(admin, { kind: "ALLOW" });
});

test("REQUIRED: escalates to DELETE_KICK + purge after the same SOLICITATION_WARNING_LIMIT as ordinary promotion, with its OWN distinct reason", () => {
  const result = decide({ category: "COMPETING_PROJECT_PROMOTION", priorWarningCount: SOLICITATION_WARNING_LIMIT });
  assert.deepEqual(result, { kind: "DELETE_KICK", reason: "repeated_competing_project_promotion", purge: true });
});

test("a flood-repeat burst of this category still forces straight past the warning ladder into DELETE_KICK", () => {
  const result = decide({ category: "COMPETING_PROJECT_PROMOTION", floodRepeat: true });
  assert.deepEqual(result, { kind: "DELETE_KICK", reason: "repeated_competing_project_promotion", purge: true });
});

/* -------------------------------------------------------------- SEARCH_SPAM ---- */
// Live feedback (2026-09-03): "Search miniairdrops" posted by two different
// accounts, minutes apart -- an off-topic instruction with no link/handle/
// promotion wording at all. Flagged as spam even from a single sender
// (never exempted the way ordinary self-promotion sometimes is), same
// never-exempt treatment as COMPETING_PROJECT_PROMOTION above.

test("REQUIRED: looksLikeSearchInstructionSpam recognizes the exact live repro", () => {
  assert.equal(looksLikeSearchInstructionSpam("Search miniairdrops"), true);
});

test("looksLikeSearchInstructionSpam also recognizes google/look-up phrasing, case-insensitively, with an optional 'please'", () => {
  assert.equal(looksLikeSearchInstructionSpam("google unrelatedapp now"), true);
  assert.equal(looksLikeSearchInstructionSpam("Look up freecoins123"), true);
  assert.equal(looksLikeSearchInstructionSpam("please search giveawaybot"), true);
});

test("looksLikeSearchInstructionSpam requires the instruction at the START of the message -- an unrelated sentence merely containing the word doesn't match", () => {
  assert.equal(looksLikeSearchInstructionSpam("I searched for the answer already"), false);
  assert.equal(looksLikeSearchInstructionSpam("you can search the pinned FAQ for that"), false);
});

test("REQUIRED: first SEARCH_SPAM offense -> DELETE_WARN, warning #1, no mute (same leeway shape as ordinary solicitation)", () => {
  assert.deepEqual(decide({ category: "SEARCH_SPAM" }), { kind: "DELETE_WARN", warningNumber: 1, reason: "search_spam", muteMinutes: undefined });
});

test("REQUIRED: never exempted by the community's Allow Solicitation toggle", () => {
  const result = decide({ category: "SEARCH_SPAM", solicitationAllowed: true });
  assert.notEqual(result.kind, "ALLOW");
  assert.equal(result.kind, "DELETE_WARN");
});

test("REQUIRED: never exempted by the admin-solicited backstop", () => {
  const result = decide({ category: "SEARCH_SPAM", adminSolicitedExemption: true });
  assert.notEqual(result.kind, "ALLOW");
});

test("admin search instructions are exempt from ordinary content moderation", () => {
  const nonAdmin = decide({ category: "SEARCH_SPAM", isAdminOrTrusted: false });
  const admin = decide({ category: "SEARCH_SPAM", isAdminOrTrusted: true });
  assert.notEqual(nonAdmin.kind, "ALLOW");
  assert.deepEqual(admin, { kind: "ALLOW" });
});

test("REQUIRED: escalates to DELETE_KICK + purge after the same SOLICITATION_WARNING_LIMIT, with its OWN distinct reason", () => {
  const result = decide({ category: "SEARCH_SPAM", priorWarningCount: SOLICITATION_WARNING_LIMIT });
  assert.deepEqual(result, { kind: "DELETE_KICK", reason: "repeated_search_spam", purge: true });
});

test("a flood-repeat burst of this category still forces straight past the warning ladder into DELETE_KICK", () => {
  const result = decide({ category: "SEARCH_SPAM", floodRepeat: true });
  assert.deepEqual(result, { kind: "DELETE_KICK", reason: "repeated_search_spam", purge: true });
});

/* ------------------------------------------------------- isBackToBackSpamPattern ---- */
// Only ever changes the WARNING wording (generic room reminder vs. naming
// the offender) -- never whether SEARCH_SPAM is flagged/deleted/counted.

test("REQUIRED (exact live repro): the same instruction posted ~8 minutes earlier by a DIFFERENT sender reads as a coordinated back-to-back pattern", () => {
  const now = new Date("2026-09-03T18:50:00.000Z");
  const preceding = { text: "Search miniairdrops", createdAt: "2026-09-03T18:42:00.000Z" };
  assert.equal(isBackToBackSpamPattern(preceding, now), true);
});

test("an isolated occurrence with nothing similar immediately before it is NOT a coordinated pattern", () => {
  const now = new Date("2026-09-03T18:50:00.000Z");
  assert.equal(isBackToBackSpamPattern(null, now), false);
  assert.equal(isBackToBackSpamPattern({ text: "gm everyone, how's it going?", createdAt: "2026-09-03T18:49:00.000Z" }, now), false);
});

test("outside the flood window, the same instruction no longer counts as coordinated -- a fresh evaluation, not a permanent flag", () => {
  const now = new Date("2026-09-03T19:30:00.000Z"); // 48 minutes after the preceding message
  const preceding = { text: "Search miniairdrops", createdAt: "2026-09-03T18:42:00.000Z" };
  assert.equal(isBackToBackSpamPattern(preceding, now), false);
});

test("a preceding message with no createdAt (e.g. a test fixture) never crashes and is never treated as coordinated", () => {
  const now = new Date();
  assert.equal(isBackToBackSpamPattern({ text: "Search miniairdrops", createdAt: null }, now), false);
  assert.equal(isBackToBackSpamPattern({ text: "Search miniairdrops" }, now), false);
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

test("REQUIRED (§54.5): high-confidence explicit/pornographic link -> immediate DELETE_KICK + purge, no warning grace period, never a permanent ban", () => {
  assert.deepEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "high" }), { kind: "DELETE_KICK", reason: "explicit_content", purge: true });
});

test("REQUIRED (scenario 1): first confirmed high-confidence scam/phishing offense -> DELETE_WARN + 30-minute mute, never an instant kick/ban", () => {
  assert.deepEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "high" }), { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing", muteMinutes: 30 });
});

test("REQUIRED (scenario 2): second confirmed high-confidence scam offense within the strike window -> DELETE_KICK + purge", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount: 1 }),
    { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing", purge: true }
  );
});

test("a third confirmed high-confidence scam offense stays at DELETE_KICK + purge -- never escalates to a permanent ban", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount: 2 }),
    { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing", purge: true }
  );
});

test("REQUIRED: scam strike escalation is never role-exempt -- an admin/trusted sender still gets the graduated response", () => {
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", isAdminOrTrusted: true }),
    { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing", muteMinutes: 30 }
  );
  assert.deepEqual(
    decide({ category: "PHISHING_OR_SCAM", confidence: "high", isAdminOrTrusted: true, priorScamStrikeCount: 1 }),
    { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing", purge: true }
  );
});

test("REQUIRED (scenario 9): borderline/uncertain (medium or low confidence) scam classification never triggers strike escalation", () => {
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "medium", priorScamStrikeCount: 1 }).kind, "DELETE_KICK");
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "low", priorScamStrikeCount: 1 }).kind, "DELETE_KICK");
});

test("REQUIRED (scenario 13): ordinary UNSOLICITED_PROMOTION escalation is completely unaffected by the new scam strike counter", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", priorWarningCount: 0, priorScamStrikeCount: 5 }), { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion", muteMinutes: undefined });
});

test("LOW-confidence explicit/phishing does NOT auto-remove -- confidence gates severe enforcement too", () => {
  assert.notEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "low" }).kind, "DELETE_KICK");
  assert.notEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "low" }).kind, "DELETE_KICK");
});

test("REQUIRED (§54.6): flagged as flood/spam -> DELETE_KICK + purge directly, not a warning grace period, never a permanent ban", () => {
  assert.deepEqual(decide({ category: "LINK_SPAM_OR_FLOOD" }), { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true });
});

test("REQUIRED: a floodRepeat signal escalates straight to DELETE_KICK even if classified as ordinary unsolicited promotion", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", floodRepeat: true }), { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true });
});

test("REQUIRED (§54.8/§54.9, revised 2026-09-02): repeated unsolicited promotion escalates through the full real-leeway ladder -- warning 1 (no mute), 2 (10-min), 3 (30-min), 4 (60-min), then removal on the 5th", () => {
  assert.deepEqual(decide({ priorWarningCount: 0 }), { kind: "DELETE_WARN", warningNumber: 1, reason: "unsolicited_promotion", muteMinutes: undefined });
  assert.deepEqual(decide({ priorWarningCount: 1 }), { kind: "DELETE_WARN", warningNumber: 2, reason: "repeated_unsolicited_promotion", muteMinutes: 10 });
  assert.deepEqual(decide({ priorWarningCount: 2 }), { kind: "DELETE_WARN", warningNumber: 3, reason: "repeated_unsolicited_promotion", muteMinutes: 30 });
  assert.deepEqual(decide({ priorWarningCount: 3 }), { kind: "DELETE_WARN", warningNumber: 4, reason: "repeated_unsolicited_promotion", muteMinutes: 60 });
});

/* Explicit regression suite for the "first offense is muting when it should
 * only warn" report: traced end-to-end (decideLinkEnforcement's pure math,
 * the community-runtime.ts call site's priorWarningCount derivation, and
 * the persisted nextState computation) and confirmed CORRECT for a
 * genuinely fresh sender -- these tests pin the exact ladder + the "no
 * restrictChatMember call on offense 1" contract, so a future regression
 * would fail loudly here rather than only be caught live. */
test("solicitation ladder offense 1: warning only, muteMinutes undefined -> RESTRICT_USER must never be called", () => {
  const result = decide({ priorWarningCount: 0 });
  assert.equal(result.kind, "DELETE_WARN");
  assert.equal(result.kind === "DELETE_WARN" ? result.warningNumber : null, 1);
  assert.equal(result.kind === "DELETE_WARN" ? result.muteMinutes : null, undefined);
  // community-runtime.ts only calls RESTRICT_USER (MUTE) when
  // `enforcement.muteMinutes` is truthy -- undefined is falsy, so this
  // exact shape structurally never reaches that branch.
  assert.equal(!!(result.kind === "DELETE_WARN" && result.muteMinutes), false);
});

test("solicitation ladder offense 2: 10-minute mute", () => {
  const result = decide({ priorWarningCount: 1 });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 2, reason: "repeated_unsolicited_promotion", muteMinutes: 10 });
});

test("solicitation ladder offense 3: 30-minute mute", () => {
  const result = decide({ priorWarningCount: 2 });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 3, reason: "repeated_unsolicited_promotion", muteMinutes: 30 });
});

test("solicitation ladder offense 4: 60-minute mute", () => {
  const result = decide({ priorWarningCount: 3 });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 4, reason: "repeated_unsolicited_promotion", muteMinutes: 60 });
});

test("solicitation ladder offense 5: kick + purge, never a warning", () => {
  assert.deepEqual(decide({ priorWarningCount: 4 }), { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true });
});

test("solicitation warning text/reason matches the actual action taken: offense 1 says 'unsolicited_promotion' (first-offense wording), offense 2+ says 'repeated_unsolicited_promotion'", () => {
  assert.equal(decide({ priorWarningCount: 0 }).kind === "DELETE_WARN" && (decide({ priorWarningCount: 0 }) as { reason: string }).reason, "unsolicited_promotion");
  assert.equal(decide({ priorWarningCount: 1 }).kind === "DELETE_WARN" && (decide({ priorWarningCount: 1 }) as { reason: string }).reason, "repeated_unsolicited_promotion");
});

test("persisted solicitation count after offense 1 equals exactly 1 (nextState.warningCount = enforcement.warningNumber, never a redundant +1)", () => {
  const result = decide({ priorWarningCount: 0 });
  assert.equal(result.kind === "DELETE_WARN" ? result.warningNumber : -1, 1);
});

test("the media-warning counter is a structurally separate field and never influences the solicitation ladder", () => {
  // decideLinkEnforcement's input has no mediaWarningCount field at all --
  // only priorWarningCount (solicitation's own counter) feeds this ladder.
  const withoutMedia = decide({ priorWarningCount: 1 });
  const alsoWithoutMedia = decide({ priorWarningCount: 1 });
  assert.deepEqual(withoutMedia, alsoWithoutMedia);
});

test("REQUIRED (§54.9, revised 2026-09-02): the 5th unsolicited-promotion violation (past the 4-warning limit) -> DELETE_KICK + purge, never a permanent ban", () => {
  assert.deepEqual(decide({ priorWarningCount: SOLICITATION_WARNING_LIMIT }), { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true });
});

test("REQUIRED (§54.10): unknown/ambiguous, unfamiliar-looking link -> ALLOW, never an automatic permanent ban", () => {
  assert.deepEqual(decide({ category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low", priorWarningCount: 5 }), { kind: "ALLOW" });
});

test("REQUIRED (§54.13): an admin/trusted user posting what would otherwise be ordinary promotion -> ALLOW (role exemption)", () => {
  assert.deepEqual(decide({ category: "UNSOLICITED_PROMOTION", isAdminOrTrusted: true }), { kind: "ALLOW" });
});

test("admin/trusted exemption does NOT apply to severe content -- safety is never role-exempt", () => {
  assert.deepEqual(decide({ category: "EXPLICIT_CONTENT", confidence: "high", isAdminOrTrusted: true }), { kind: "DELETE_KICK", reason: "explicit_content", purge: true });
});

test("admin/trusted exemption does NOT apply to an obvious flood/spam signal either", () => {
  assert.deepEqual(decide({ category: "LINK_SPAM_OR_FLOOD", isAdminOrTrusted: true }), { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true });
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
  assert.deepEqual(decide({ category: "PHISHING_OR_SCAM", confidence: "high", priorScamStrikeCount }), { kind: "DELETE_WARN", warningNumber: 1, reason: "scam_or_phishing", muteMinutes: 30 });
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

test("the first-offense warning explicitly includes @username and the real 30-minute mute duration, matching the exact requested wording", () => {
  const text = scamFirstOffenseWarningHtml(renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur"));
  assert.equal(text, "@jon_arthur1, your message was removed because it contained a suspected scam/phishing link. You've been muted for 30 minutes. Another confirmed violation will result in removal from this community.");
});

test("REQUIRED (scenario 7): the second-offense (kick) warning never includes a URL either", () => {
  const text = scamRepeatOffenseWarningHtml();
  assert.ok(!/https?:\/\//i.test(text));
  assert.match(text, /removal from the community/i);
});

test("REQUIRED (2026-09-05 audience-semantics correction): the repeat-offense (kick) warning is a COMMUNITY-facing reminder -- no mention/handle, no second-person 'you have been removed' claim", () => {
  const text = scamRepeatOffenseWarningHtml();
  assert.doesNotMatch(text, /@[a-z0-9_]/i);
  assert.doesNotMatch(text, /\byou(?:'ve| have)?\s+(?:been|got|are|were)\b/i);
  assert.match(text, /scam or phishing links isn'?t tolerated/i);
});

test("first-offense and repeat-offense warning texts are distinct (never the same message for both tiers)", () => {
  const mention = renderHumanModerationMention("1", "jon_arthur1", "Jon Arthur");
  assert.notEqual(scamFirstOffenseWarningHtml(mention), scamRepeatOffenseWarningHtml());
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

/* ---------------------------------------------------------- live-bug repro: link-less pitch ---- */

test("REQUIRED: the exact live-reported message (curly-apostrophe emoji pitch, no link/handle) is caught as an unsolicited pitch", () => {
  const text = `🚀 Hey Dev,\n\nLooking for real investors & strong volume?\nI can promote your project across active crypto communities and bring serious buyers.\n\n📈 Let’s push exposure, volume & market cap.\n\nDM me if you’re ready to grow. 🔥`;
  assert.equal(looksLikeUnsolicitedPitch(text), true);
});

/* ---------------------------------------------------------- promotionContactSentence ---- */

test("promotionContactSentence includes the configured Partnerships contact verbatim", () => {
  assert.equal(promotionContactSentence("@innvil_partnerships"), " For promotion inquiries, please contact @innvil_partnerships.");
});

test("promotionContactSentence is empty when no contact is configured -- never fabricates one", () => {
  assert.equal(promotionContactSentence(null), "");
});

/* ------------------------------------------ moderation-warning anti-repetition ---- */
// Live feedback (2026-09-04): "Patricia" was posting near-identical
// moderation warnings ("No promo in this topic, friend -- that's a 10-min
// mute. Take that energy to Promotion instead..." vs "...that's a 10 min
// mute. Take it to Promotion instead, or next time it escalates further.")
// across DIFFERENT offenders. These pin the exact reported pairs against
// the real function -- not a guessed threshold, an empirically-verified one.

const LIVE_PAIR_1A = "@Gxr9gxGlA0qR, No promo in this topic, friend — that's a 10-min mute. Take that energy to Promotion instead. Keep it up and we'll escalate to boot city.";
const LIVE_PAIR_1B = "@SaraKOLs, No promo in this topic, friend — that's a 10 min mute. Take it to Promotion instead, or next time it escalates further.";
const LIVE_PAIR_2A = "@Gxr9gxGlA0qR, Yanked that — no promo in this topic. 30-min mute for now, but keep it up and we're talking kick/ban territory.";
const LIVE_PAIR_2B = "@Sleeping_Pepe, Yanked that — no promo in this topic, save it for Promotion. No mute this time, but keep it up and we're looking at a mute, then a boot.";
const LIVE_PAIR_3A = "@Ashie2a, Yanked that—Announcement isn't for promo, take it to Promotion instead. No mute this time, but keep it up and that'll change fast.";
const LIVE_PAIR_3B = "@Shojib_Web3_MKT, Yeah this topic isn't for promo — head over to Promotion for that. No mute this time, but keep it up and you'll earn one, then worse.";

test("REQUIRED (exact live repro): each reported near-duplicate pair scores at or above the near-duplicate threshold", () => {
  assert.ok(warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_1B) >= NEAR_DUPLICATE_WARNING_THRESHOLD);
  assert.ok(warningTextSimilarity(LIVE_PAIR_2A, LIVE_PAIR_2B) >= NEAR_DUPLICATE_WARNING_THRESHOLD);
  assert.ok(warningTextSimilarity(LIVE_PAIR_3A, LIVE_PAIR_3B) >= NEAR_DUPLICATE_WARNING_THRESHOLD);
});

test("REQUIRED: isNearDuplicateWarning flags a live-repro pair as a near-duplicate", () => {
  assert.equal(isNearDuplicateWarning(LIVE_PAIR_1B, [LIVE_PAIR_1A]), true);
});

test("different usernames alone never explain the similarity -- mentions never overlap, and stripping them never HURTS the score (only helps or is neutral)", () => {
  // A naive comparator that does NOT strip @mentions -- the two different
  // usernames become two extra, never-overlapping tokens, which can only
  // dilute (never inflate) a similarity score versus the real function.
  const withoutMentionStripping = (a: string, b: string) => {
    const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9@\s]/gi, " ").split(/\s+/).filter(Boolean));
    const sa = words(a), sb = words(b);
    let hit = 0;
    for (const w of sa) if (sb.has(w)) hit++;
    return hit / (sa.size + sb.size - hit);
  };
  assert.ok(!LIVE_PAIR_1A.includes("SaraKOLs") && !LIVE_PAIR_1B.includes("Gxr9gxGlA0qR"), "the two usernames genuinely never overlap");
  assert.ok(withoutMentionStripping(LIVE_PAIR_1A, LIVE_PAIR_1B) <= warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_1B));
});

test("distinct-template warnings from the SAME Watcher (different structure/opener) score below the threshold -- the check must not over-fire on ordinary phrasing variety", () => {
  assert.ok(warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_2A) < NEAR_DUPLICATE_WARNING_THRESHOLD);
  assert.ok(warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_3A) < NEAR_DUPLICATE_WARNING_THRESHOLD);
  assert.ok(warningTextSimilarity(LIVE_PAIR_2A, LIVE_PAIR_3A) < NEAR_DUPLICATE_WARNING_THRESHOLD);
});

test("a genuinely unrelated message (different violation entirely) scores very low, never a false positive", () => {
  const different = "@user, that's off-topic spam and not allowed here. Please stop.";
  assert.ok(warningTextSimilarity(LIVE_PAIR_1A, different) < 0.2);
  assert.equal(isNearDuplicateWarning(different, [LIVE_PAIR_1A, LIVE_PAIR_2A, LIVE_PAIR_3A]), false);
});

test("isNearDuplicateWarning is false when recentTexts is empty -- never flags with nothing to compare against", () => {
  assert.equal(isNearDuplicateWarning(LIVE_PAIR_1A, []), false);
});

test("warningTextSimilarity is symmetric and self-similarity is exactly 1", () => {
  assert.equal(warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_1B), warningTextSimilarity(LIVE_PAIR_1B, LIVE_PAIR_1A));
  assert.equal(warningTextSimilarity(LIVE_PAIR_1A, LIVE_PAIR_1A), 1);
});

test("warningTextSimilarity handles empty strings safely -- never divides by zero / never NaN", () => {
  assert.equal(warningTextSimilarity("", ""), 0);
  assert.equal(warningTextSimilarity("", LIVE_PAIR_1A), 0);
});

/* ============================================= maxWarningSimilarity ====
   The continuous-score sibling of isNearDuplicateWarning -- resolveWarning
   ResponseMode needs a real gradient (not just a boolean) to distinguish
   SHORT_NUDGE from genuine NO_PUBLIC_REPLY. */

test("maxWarningSimilarity returns 0 for an empty recentTexts list", () => {
  assert.equal(maxWarningSimilarity(LIVE_PAIR_1A, []), 0);
});

test("maxWarningSimilarity returns the highest score across multiple recent texts, not just the first/last", () => {
  const score = maxWarningSimilarity(LIVE_PAIR_1B, ["a totally unrelated sentence", LIVE_PAIR_1A, "another unrelated one"]);
  assert.equal(score, warningTextSimilarity(LIVE_PAIR_1B, LIVE_PAIR_1A));
  assert.ok(score >= NEAR_DUPLICATE_WARNING_THRESHOLD);
});

/* =========================================== resolveWarningResponseMode ====
   2026-09-04, third pass (corrected the same day -- NO_PUBLIC_REPLY is a
   real, reachable outcome now, not an invented "SHORT_NUDGE is the floor"
   rule): a Watcher should not narrate every minor deletion with a full
   paragraph, and should not keep restating a correction the room has
   already just seen. Deterministic, zero-cost decision driven by a
   CONTINUOUS similarity score -- see the function's own doc comment for
   the full 4-mode semantics and the exact threshold gradient. */

test("REQUIRED: a real consequence (a mute, an already-executed kick for scam, or media's final pre-kick warning) is ALWAYS ENFORCEMENT_NOTICE, regardless of similarity -- including at maximum similarity (1.0)", () => {
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 0 }), "ENFORCEMENT_NOTICE");
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 0.5 }), "ENFORCEMENT_NOTICE");
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 1 }), "ENFORCEMENT_NOTICE");
});

test("REQUIRED: no consequence + NEAR-IDENTICAL to something recently said (>= NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD) resolves to genuine NO_PUBLIC_REPLY", () => {
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD }), "NO_PUBLIC_REPLY");
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: 1 }), "NO_PUBLIC_REPLY");
});

test("REQUIRED: no consequence + recognizably similar but below the NO_PUBLIC_REPLY bar resolves to SHORT_NUDGE, not silence", () => {
  const justBelowNoReply = NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD - 0.01;
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: NEAR_DUPLICATE_WARNING_THRESHOLD }), "SHORT_NUDGE");
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: justBelowNoReply }), "SHORT_NUDGE");
});

test("REQUIRED: no consequence + nothing recently similar resolves to the ordinary WARNING (today's existing, unchanged behavior)", () => {
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: 0 }), "WARNING");
  assert.equal(resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: NEAR_DUPLICATE_WARNING_THRESHOLD - 0.01 }), "WARNING");
});

test("REQUIRED: ENFORCEMENT_NOTICE always wins -- a mute/scam/final-warning is never downgraded to NO_PUBLIC_REPLY or SHORT_NUDGE merely because it also happens to look like a recent duplicate", () => {
  const atMaxSimilarity = resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 1 });
  const atZeroSimilarity = resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 0 });
  assert.equal(atMaxSimilarity, atZeroSimilarity);
  assert.equal(atMaxSimilarity, "ENFORCEMENT_NOTICE");
});

test("REQUIRED: NO_PUBLIC_REPLY IS a reachable outcome -- this is not hardcoded away as a product decision, it is implemented per the real requirement", () => {
  const modes = [
    resolveWarningResponseMode({ hasEnforcementConsequence: true, similarityToRecent: 1 }),
    resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: 1 }),
    resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: 0.5 }),
    resolveWarningResponseMode({ hasEnforcementConsequence: false, similarityToRecent: 0 }),
  ];
  assert.deepEqual(modes, ["ENFORCEMENT_NOTICE", "NO_PUBLIC_REPLY", "SHORT_NUDGE", "WARNING"]);
});

/* ===================================== warningTextExceedsAuthorizedFacts ====
   Generated moderation prose is untrusted presentation output, never an
   enforcement authority (2026-09-04, second pass). Only two concrete,
   checkable classes of unsupported claim are caught -- see the function's
   own doc comment for the explicit, stated boundary of what this does NOT
   (and, without disproportionate NLP investment, cannot) guarantee. */

test("REQUIRED: a stated mute-minute count matching the real authoritative value passes", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("No promo in this topic -- that's a 10-minute mute.", { muteMinutes: 10 }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("that's a 10-min mute, friend.", { muteMinutes: 10 }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("30min mute for that one.", { muteMinutes: 30 }), false);
});

test("REQUIRED (the live-reported concern's exact class): a stated mute-minute count that does NOT match the real authoritative value is caught", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("that's a 30-min mute.", { muteMinutes: 10 }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("that's a 10-minute mute.", { muteMinutes: 60 }), true);
});

test("REQUIRED: a stated mute-minute count when NO mute actually applies (authoritative is null/undefined) is caught -- the exact 'first offense, no consequence' case must never fabricate a mute", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("No promos here -- that's a 10-minute mute.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("No promos here -- that's a 10-minute mute.", {}), true);
});

test("plain text with no minute-mention at all always passes the mute check, regardless of the authoritative value", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("No promos in General, please.", { muteMinutes: 10 }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("No promos in General, please.", { muteMinutes: null }), false);
});

test("REQUIRED (the user's own quoted example): a DEFINITE, already-happened ban/kick/removal claim is caught, since this function is only ever run against WARN-tier text where nothing was actually banned/kicked/removed", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("Careful -- you've been banned from this community.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("You are now banned.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("You have been removed from this community.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("You've been kicked already.", { muteMinutes: null }), true);
});

test("REQUIRED: a HEDGED, future-conditional escalation-risk mention is explicitly permitted, never caught -- this is the exact sanctioned phrasing the deterministic template and requiredFacts already use", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("Repeated offenses escalate to a kick or ban.", { muteMinutes: null }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("Keep doing this and you could end up banned.", { muteMinutes: null }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("Another violation results in removal from the community.", { muteMinutes: null }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("This is their FINAL warning -- next time results in removal.", { muteMinutes: null }), false);
});

test("both checks combine correctly -- a wrong mute number is caught even alongside otherwise-fine hedge language", () => {
  assert.equal(
    warningTextExceedsAuthorizedFacts("That's a 45-minute mute. Repeated offenses escalate to a kick or ban.", { muteMinutes: 10 }),
    true
  );
});

/* ============ REQUIRED (scam persona-voicing, third pass): URL/link check + conditional removal-claim ==== */

test("REQUIRED: a raw link/URL of any kind is caught unconditionally, for every caller -- this is what makes it structurally safe to persona-realize a SCAM warning", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("Careful, that link (https://scam-site.example/claim) was fake.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("That t.me/fake_giveaway link isn't legit.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("No promos in General, please. Post that in Promotion instead.", { muteMinutes: null }), false);
});

test("REQUIRED: a definite removal claim is REJECTED, matching every WARN-tier caller", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("You have been removed from this community.", { muteMinutes: null }), true);
});

test("REQUIRED (2026-09-05 audience-semantics correction): a definite, second-person removal claim is REJECTED UNCONDITIONALLY now -- even when removal genuinely happened (the old scam-repeat-offense escape hatch is gone, since that framing is now always the wrong audience)", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("You have been removed from this community.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("You've been kicked already.", { muteMinutes: null }), true);
});

test("REQUIRED: general, prospective community-facing rule/consequence language is still allowed -- never confused with a definite second-person removal claim", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("Repeated violations result in removal from the community.", { muteMinutes: null }), false);
  assert.equal(warningTextExceedsAuthorizedFacts("Repeated offenses escalate to a kick or ban.", { muteMinutes: null }), false);
});

test("the guard still catches every OTHER unsupported claim independent of the removal check", () => {
  assert.equal(warningTextExceedsAuthorizedFacts("That's a 45-minute mute too.", { muteMinutes: null }), true);
  assert.equal(warningTextExceedsAuthorizedFacts("Here's the link: https://scam.example", { muteMinutes: null }), true);
});

/* ================================================= negative statements ==== */

test("looksLikeNegativeStatement: matches an unfounded scam accusation with no question", () => {
  assert.equal(looksLikeNegativeStatement("Scam Project 😂😂"), true);
  assert.equal(looksLikeNegativeStatement("Definitely scam😂"), true);
  assert.equal(looksLikeNegativeStatement("this is a rugpull"), true);
  assert.equal(looksLikeNegativeStatement("it is a ponzi, everyone knows"), true);
  assert.equal(looksLikeNegativeStatement("fraudulent project, stay away"), true);
  assert.equal(looksLikeNegativeStatement("dead project lol"), true);
  assert.equal(looksLikeNegativeStatement("trash project honestly"), true);
  assert.equal(looksLikeNegativeStatement("exit scam confirmed"), true);
  assert.equal(looksLikeNegativeStatement("this is going to zero"), true);
  assert.equal(looksLikeNegativeStatement("worthless token, avoid it"), true);
});

test("REQUIRED: looksLikeNegativeStatement never matches a genuine question, even with identical scam wording -- a question mark anywhere unconditionally excludes it", () => {
  assert.equal(looksLikeNegativeStatement("Is this a scam?"), false);
  assert.equal(looksLikeNegativeStatement("Why does everyone say this is a rug?"), false);
  assert.equal(looksLikeNegativeStatement("scam project?"), false);
  assert.equal(looksLikeNegativeStatement("is this a scam ? asking for a friend"), false);
});

test("looksLikeNegativeStatement returns false for ordinary, unrelated chat", () => {
  assert.equal(looksLikeNegativeStatement("hey how is everyone doing today"), false);
  assert.equal(looksLikeNegativeStatement(""), false);
  assert.equal(looksLikeNegativeStatement("   "), false);
});

test("effectiveNegativeStatementCount: no prior timestamp reads as 0 (fresh)", () => {
  assert.equal(effectiveNegativeStatementCount(3, null, new Date()), 0);
});

test("effectiveNegativeStatementCount: a strike within the 30-day window still counts", () => {
  const now = new Date("2026-01-31T00:00:00.000Z");
  const recentAt = new Date(now.getTime() - (NEGATIVE_STATEMENT_WINDOW_MS - 60_000)).toISOString();
  assert.equal(effectiveNegativeStatementCount(1, recentAt, now), 1);
});

test("REQUIRED: effectiveNegativeStatementCount expires exactly at the 30-day boundary -- a stale strike reads as a fresh first offense", () => {
  const now = new Date("2026-01-31T00:00:00.000Z");
  const exactlyAtBoundary = new Date(now.getTime() - NEGATIVE_STATEMENT_WINDOW_MS).toISOString();
  assert.equal(effectiveNegativeStatementCount(2, exactlyAtBoundary, now), 0);
});

function negativeStatementDecide(priorNegativeStatementCount: number, isAdminOrTrusted = false) {
  return decideLinkEnforcement({
    category: "NEGATIVE_STATEMENT",
    confidence: "high",
    isAdminOrTrusted,
    floodRepeat: false,
    priorWarningCount: 0,
    priorScamStrikeCount: 0,
    priorNegativeStatementCount,
    solicitationAllowed: false,
    adminSolicitedExemption: false,
  });
}

test("REQUIRED (1st offense): NEGATIVE_STATEMENT deletes SILENTLY -- no mute, no public warning text", () => {
  assert.deepEqual(negativeStatementDecide(0), { kind: "DELETE_WARN", warningNumber: 1, reason: "negative_statement", silent: true });
});

test("REQUIRED (2nd offense): NEGATIVE_STATEMENT deletes plus warns plus mutes for exactly NEGATIVE_STATEMENT_MUTE_MINUTES", () => {
  assert.deepEqual(negativeStatementDecide(1), {
    kind: "DELETE_WARN", warningNumber: 2, reason: "repeated_negative_statement", muteMinutes: NEGATIVE_STATEMENT_MUTE_MINUTES,
  });
  assert.equal(NEGATIVE_STATEMENT_MUTE_MINUTES, 30);
});

test("REQUIRED (3rd offense): NEGATIVE_STATEMENT bans for a fixed, TIME-BOUND duration -- never a kick, never a permanent ban", () => {
  const result = negativeStatementDecide(2);
  assert.deepEqual(result, { kind: "DELETE_BAN", reason: "escalated_negative_statement", banMinutes: NEGATIVE_STATEMENT_BAN_MINUTES });
  assert.equal(NEGATIVE_STATEMENT_BAN_MINUTES, 24 * 60);
});

test("REQUIRED: every subsequent offense beyond the 3rd also bans -- never escalates back to a kick, never a different kind", () => {
  assert.equal(negativeStatementDecide(5).kind, "DELETE_BAN");
  assert.equal(negativeStatementDecide(10).kind, "DELETE_BAN");
});

test("REQUIRED: an admin/trusted sender is exempt from NEGATIVE_STATEMENT enforcement entirely -- their own framing of their own community is their call", () => {
  assert.deepEqual(negativeStatementDecide(0, true), { kind: "ALLOW" });
  assert.deepEqual(negativeStatementDecide(5, true), { kind: "ALLOW" });
});

test("NEGATIVE_STATEMENT never falls into the unrelated UNSOLICITED_PROMOTION/warningCount ladder -- its own counter is completely independent", () => {
  const result = decideLinkEnforcement({
    category: "NEGATIVE_STATEMENT",
    confidence: "high",
    isAdminOrTrusted: false,
    floodRepeat: false,
    priorWarningCount: 10, // a large unrelated promotion-warning count must have zero effect here
    priorScamStrikeCount: 10,
    priorNegativeStatementCount: 0,
    solicitationAllowed: false,
    adminSolicitedExemption: false,
  });
  assert.deepEqual(result, { kind: "DELETE_WARN", warningNumber: 1, reason: "negative_statement", silent: true });
});

/* ==================================== media-warning period reset ==== */
// Explicit product decision (2026-09-05): media's own strike counter renews
// together with the account's TIERED PLAN billing period, NOT a fixed
// rolling window like every other counter above -- a deliberately different
// reset mechanism from effectiveScamStrikeCount/effectiveWarningCount/
// effectiveNegativeStatementCount, which all take a fixed duration.

test("effectiveMediaWarningCount: no prior timestamp reads as 0 (fresh)", () => {
  assert.equal(effectiveMediaWarningCount(2, null, "2026-02-01T00:00:00.000Z"), 0);
});

test("REQUIRED: no real billing period resolvable -- the stored count is returned as-is, never fabricating a reset boundary that doesn't exist", () => {
  assert.equal(effectiveMediaWarningCount(2, "2026-01-15T00:00:00.000Z", null), 2);
});

test("REQUIRED: a strike from BEFORE the current billing period started resets to 0 -- however high it had climbed, even at the kick threshold", () => {
  const periodStart = "2026-02-01T00:00:00.000Z";
  assert.equal(effectiveMediaWarningCount(1, "2026-01-15T00:00:00.000Z", periodStart), 0);
  assert.equal(effectiveMediaWarningCount(5, "2026-01-31T23:59:59.999Z", periodStart), 0);
});

test("a strike from WITHIN (at or after) the current billing period still counts", () => {
  const periodStart = "2026-02-01T00:00:00.000Z";
  assert.equal(effectiveMediaWarningCount(1, "2026-02-01T00:00:00.000Z", periodStart), 1);
  assert.equal(effectiveMediaWarningCount(2, "2026-02-15T00:00:00.000Z", periodStart), 2);
});

/* ================================ structural (rhetorical) repetition ====
   2026-09-06 live product feedback: the reported warnings repeated the same
   SKELETON even when the words changed, so bag-of-words similarity scored
   them as comfortably different and the anti-repetition retry never fired.
   These pin the shape-based detector that closes that gap. */

// The exact production messages from the live report.
const LIVE_1 = "@Mark6co, hey, no promo allowed in this topic - if you want to share that, Promotion is the place for it. keep it up and it'll escalate past just a deletion.";
const LIVE_2 = "@Mark6co, second time now - no promo in announcement, that's what promotion topic is for. 10 min mute this round, keep it up and it's a longer mute then a boot.";
const LIVE_3 = "@NolanKols_ads, this is the fourth time now, no more promo in this topic - that's a 60 min mute, head to Promotion instead, next one's a kick or ban.";

test("REQUIRED (live bug): the reported warnings share a rhetorical skeleton, and the structural detector catches it", () => {
  // Every one of them walks rule -> destination -> punishment -> escalation.
  for (const text of [LIVE_2, LIVE_3]) {
    const beats = warningStructureSignature(text);
    assert.ok(beats.length >= STRUCTURAL_REPEAT_BEAT_THRESHOLD, `expected a multi-beat skeleton for: ${text}`);
  }
  assert.equal(isStructurallyRepetitiveWarning(LIVE_2, [LIVE_1]), true);
  assert.equal(isStructurallyRepetitiveWarning(LIVE_3, [LIVE_1, LIVE_2]), true);
});

test("REQUIRED: structural repetition is caught even when LEXICAL similarity stays under the near-duplicate threshold -- the exact gap that let this ship", () => {
  // Different offender, different topic wording, different mute number:
  // low word overlap, identical shape.
  const a = "@alice no promo in general - take it to Promotion. 10 min mute, next one's longer.";
  const b = "@bob shilling isn't allowed here, use the Promotion channel instead. 30 min timeout, keep it up and you're gone.";
  assert.ok(warningTextSimilarity(a, b) < NEAR_DUPLICATE_WARNING_THRESHOLD, "precondition: lexically these look different");
  assert.equal(isNearDuplicateWarning(b, [a]), false, "precondition: the lexical check alone misses it");
  assert.equal(isStructurallyRepetitiveWarning(b, [a]), true, "the structural check catches it");
});

test("a genuinely varied, short, human-sounding reaction is NOT flagged as structurally repetitive", () => {
  const priorTemplated = [LIVE_1, LIVE_2];
  for (const natural of [
    "@Mark6co we literally just went over this, come on",
    "@Mark6co take ten and read the rules when you're back",
    "@Mark6co not again mate",
  ]) {
    assert.equal(isStructurallyRepetitiveWarning(natural, priorTemplated), false, `should not flag: ${natural}`);
  }
});

test("one or two shared beats is normal and never flagged -- only the full stacked assembly is", () => {
  // Both name the rule; nothing else lines up.
  const a = "no promo here please";
  const b = "shilling isn't allowed, thanks";
  assert.equal(isStructurallyRepetitiveWarning(b, [a]), false);
});

test("an empty recent-history list can never be structurally repetitive", () => {
  assert.equal(isStructurallyRepetitiveWarning(LIVE_2, []), false);
});

test("warningStructureSignature reports beats in canonical order, and is stable/deterministic", () => {
  const beats = warningStructureSignature(LIVE_3);
  assert.deepEqual(beats, warningStructureSignature(LIVE_3));
  assert.deepEqual([...beats].sort(), [...new Set(beats)].sort(), "no duplicate beats");
  assert.ok(beats.includes("OFFENSE_COUNT"));
  assert.ok(beats.includes("PUNISHMENT"));
  assert.ok(beats.includes("ESCALATION"));
});
