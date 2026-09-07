import test from "node:test";
import assert from "node:assert/strict";
import {
  topicAllowsSolicitation, findCommunityTopic, findPromotionTopic, buildTopicLink, topicSolicitationWarningText,
  hasKnownTopicName, topicDisplayName,
  type CommunityTopicRow,
} from "./community-topics";

const general: CommunityTopicRow = { messageThreadId: 1, topicName: "General", customName: null, policy: "general" };
const announcements: CommunityTopicRow = { messageThreadId: 2, topicName: "Announcements", customName: null, policy: "announcement" };
const promotion: CommunityTopicRow = { messageThreadId: 3, topicName: "Promotion", customName: null, policy: "promotion" };
const topics = [general, announcements, promotion];

test("REQUIRED: only the 'promotion' policy allows solicitation -- general/announcement/normal/custom all restrict", () => {
  assert.equal(topicAllowsSolicitation("promotion"), true);
  assert.equal(topicAllowsSolicitation("general"), false);
  assert.equal(topicAllowsSolicitation("announcement"), false);
  assert.equal(topicAllowsSolicitation("normal"), false);
  assert.equal(topicAllowsSolicitation("custom"), false);
  assert.equal(topicAllowsSolicitation(null), false);
  assert.equal(topicAllowsSolicitation(undefined), false);
});

test("REQUIRED (§16): findCommunityTopic looks up by the stable numeric thread id, not by name", () => {
  assert.deepEqual(findCommunityTopic(topics, 3), promotion);
  assert.deepEqual(findCommunityTopic(topics, 1), general);
  assert.equal(findCommunityTopic(topics, 999), null);
  assert.equal(findCommunityTopic(topics, null), null);
});

test("REQUIRED (§16): renaming a topic (topicName changes) never breaks the lookup -- the id is unchanged", () => {
  const renamedPromotion: CommunityTopicRow = { ...promotion, topicName: "🔥 Shill Zone" };
  const renamedTopics = [general, announcements, renamedPromotion];
  const found = findCommunityTopic(renamedTopics, 3);
  assert.equal(found?.policy, "promotion");
  assert.equal(found?.topicName, "🔥 Shill Zone");
});

test("findPromotionTopic finds the one topic assigned the promotion policy, null when none exists", () => {
  assert.deepEqual(findPromotionTopic(topics), promotion);
  assert.equal(findPromotionTopic([general, announcements]), null);
});

test("buildTopicLink prefers a public @username link when the chat has one", () => {
  assert.equal(buildTopicLink("myproject", "-1001234567890", 3), "https://t.me/myproject/3");
});

test("buildTopicLink falls back to the internal numeric-id t.me/c/ form for a private supergroup", () => {
  assert.equal(buildTopicLink(null, "-1001234567890", 3), "https://t.me/c/1234567890/3");
});

test("buildTopicLink returns null when neither a username nor a recognizable supergroup id shape is available -- never fabricates a link", () => {
  assert.equal(buildTopicLink(null, "12345", 3), null);
});

/* -------------------------------------------- topicSolicitationWarningText ---- */

test("REQUIRED (§6): warning names the ACTUAL current topic, not a hardcoded General/Announcements", () => {
  const text = topicSolicitationWarningText(general, promotion, "https://t.me/myproject/3", undefined);
  assert.match(text, /Please do not send promotions in General\./);
  assert.match(text, /use the Promotion \(https:\/\/t\.me\/myproject\/3\) topic instead/);
  assert.match(text, /5th offense may result in a kick or ban/);
});

test("warning correctly names Announcements when that's the current topic -- proves it's dynamic, not a fixed string", () => {
  const text = topicSolicitationWarningText(announcements, promotion, null, undefined);
  assert.match(text, /Please do not send promotions in Announcements\./);
  assert.match(text, /promotional content in Announcements may result in a mute/);
});

test("when no Promotion topic is configured at all, the warning still names the current topic without a dangling reference", () => {
  const text = topicSolicitationWarningText(general, null, null, undefined);
  assert.match(text, /Please do not send promotions in General\./);
  assert.doesNotMatch(text, /Promotion/);
});

test("a renamed Promotion topic is referenced by its CURRENT display name in the warning", () => {
  const renamed: CommunityTopicRow = { ...promotion, topicName: "Shill Here" };
  const text = topicSolicitationWarningText(general, renamed, null, undefined);
  assert.match(text, /use the Shill Here topic instead/);
});

test("a real mute duration is stated explicitly when the enforcement includes one", () => {
  const text = topicSolicitationWarningText(general, promotion, null, 30);
  assert.match(text, /30-minute mute/);
});

test("first offense (no real mute applied) still previews the escalation policy generically -- never states a SPECIFIC mute duration when none was actually applied", () => {
  const text = topicSolicitationWarningText(general, promotion, null, undefined);
  assert.doesNotMatch(text, /minute mute/); // no "This resulted in a N-minute mute." sentence
  assert.match(text, /may result in a mute/); // the general policy-preview language is fine
});

test("a warning WITH a real applied mute states the exact duration, distinct from the generic policy-preview language", () => {
  const text = topicSolicitationWarningText(general, promotion, null, 10);
  assert.match(text, /This resulted in a 10-minute mute\./);
});

test("a non-forum message (currentTopic null) still produces a sensible generic warning, never a raw thread id", () => {
  const text = topicSolicitationWarningText(null, null, null, undefined);
  assert.match(text, /this topic/);
  assert.doesNotMatch(text, /\bthread \d+\b/);
});

// Corrected 2026-09-02, per explicit live feedback ("It should not mention
// topic ID, it should mention the name") -- a raw numeric Telegram thread id
// reads as a bot/system artifact to a real person, never a natural warning.
// An unnamed topic (its real display name was never learned from a
// forum_topic_created/edited event) now falls back to a plain "this topic"
// phrase -- the SAME graceful fallback already used when no topic row
// exists at all -- rather than ever surfacing the bare numeric id.
test("never exposes a raw numeric thread id for an UNNAMED topic -- falls back to the same plain 'this topic' phrase used when no topic is known at all", () => {
  const unnamed: CommunityTopicRow = { messageThreadId: 7, topicName: null, customName: null, policy: "normal" };
  const text = topicSolicitationWarningText(unnamed, promotion, null, undefined);
  assert.doesNotMatch(text, /\btopic 7\b/);
  assert.doesNotMatch(text, /\b7\b/);
  assert.match(text, /this topic/);
});

/* --------------------------------------------------------- hasKnownTopicName ---- */
// Live feedback (2026-09-02): "it does not understand the [this topic] in
// moderation, instead of promotion name, it says this topic" -- a caller
// deciding whether it has a REAL, statable destination name must never infer
// that from topicDisplayName's return value alone, since that function
// always returns SOME string, including the generic "this topic"/"General"
// placeholder labels. hasKnownTopicName is the dedicated signal for that.

test("REQUIRED: hasKnownTopicName is true for a topic with a real auto-observed name", () => {
  assert.equal(hasKnownTopicName(promotion), true);
});

test("REQUIRED: hasKnownTopicName is true for a topic with only an owner-typed customName (no auto-observed name)", () => {
  const owned: CommunityTopicRow = { messageThreadId: 9, topicName: null, customName: "Promo Zone", policy: "promotion" };
  assert.equal(hasKnownTopicName(owned), true);
});

test("REQUIRED: a customName override wins over the auto-observed topicName", () => {
  const overridden: CommunityTopicRow = { messageThreadId: 3, topicName: "Promotion", customName: "Shill Zone", policy: "promotion" };
  assert.equal(topicDisplayName(overridden), "Shill Zone");
  assert.equal(hasKnownTopicName(overridden), true);
});

test("REQUIRED: hasKnownTopicName is false for a topic with neither a real name nor a customName -- even though topicDisplayName still returns a placeholder string", () => {
  const unnamed: CommunityTopicRow = { messageThreadId: 7, topicName: null, customName: null, policy: "normal" };
  assert.equal(hasKnownTopicName(unnamed), false);
  assert.equal(typeof topicDisplayName(unnamed), "string");
  assert.match(topicDisplayName(unnamed), /this topic/);
});

test("hasKnownTopicName is false for a null topic (no row at all)", () => {
  assert.equal(hasKnownTopicName(null), false);
});

test("a whitespace-only customName does not count as a known name -- must not fall through to a blank/whitespace 'name'", () => {
  const blank: CommunityTopicRow = { messageThreadId: 8, topicName: null, customName: "   ", policy: "promotion" };
  assert.equal(hasKnownTopicName(blank), false);
});
