/* =========================================================
   Telegram Forum topic policy — pure logic. Auto-discovered topics
   (message_thread_id + last-known display name) get an owner-assignable
   POLICY, keyed to the stable numeric thread id, never the display name —
   renaming "Promotion" to anything else must never break the policy, and
   the warning text must always use the CURRENT display name, not a stale
   stored one.

   DB-facing discovery/assignment lives in watch-runtime.ts /
   community-runtime.ts; this file only holds the policy vocabulary and the
   pure text-composition the warning message needs. */

export type CommunityTopicPolicy = "general" | "announcement" | "promotion" | "normal" | "custom";

export const COMMUNITY_TOPIC_POLICIES: CommunityTopicPolicy[] = ["general", "announcement", "promotion", "normal", "custom"];

export interface CommunityTopicRow {
  messageThreadId: number;
  topicName: string | null;
  policy: CommunityTopicPolicy;
}

/** Solicitation/promotion is allowed in a topic ONLY when its assigned
 *  policy is "promotion" — every other policy (including "custom", which is
 *  an owner-labeled non-promotion topic, e.g. "Support") is restricted.
 *  A message with no thread id at all (a plain, non-forum chat) has no
 *  topic to look up — the caller's own community-wide toggle governs that
 *  case, this function is never consulted for it. */
export function topicAllowsSolicitation(policy: CommunityTopicPolicy | null | undefined): boolean {
  return policy === "promotion";
}

/** Resolves the current topic's row from the community's known-topics list
 *  by thread id — the ONLY correct lookup key (never by name, which can be
 *  renamed at any time in Telegram without this codebase ever finding out
 *  except on the next message, which is exactly why the id is stored as
 *  the key and the name is just the last-observed label). */
export function findCommunityTopic(topics: CommunityTopicRow[], messageThreadId: number | null): CommunityTopicRow | null {
  if (messageThreadId == null) return null;
  return topics.find((t) => t.messageThreadId === messageThreadId) ?? null;
}

export function findPromotionTopic(topics: CommunityTopicRow[]): CommunityTopicRow | null {
  return topics.find((t) => t.policy === "promotion") ?? null;
}

/** A reasonable display label for a topic the owner hasn't named/assigned
 *  yet — NEVER exposes the raw numeric thread id to an end user (Telegram's
 *  own internal thread id means nothing to a real person reading a warning
 *  message; "topic 11623" reads as a bot/system artifact, exactly the
 *  generic-sounding wording this is meant to avoid). Falls back to a plain,
 *  natural "this topic" when the real name hasn't been learned yet (only
 *  discoverable from a forum_topic_created/edited service message) — the
 *  SAME graceful fallback already used when no topic row exists at all. */
export function topicDisplayName(topic: CommunityTopicRow | null): string {
  if (!topic) return "this topic";
  return topic.topicName?.trim() || (topic.policy === "general" ? "General" : "this topic");
}

/** A Telegram deep link straight to a specific topic, when a chat username
 *  is known (public supergroups only — Telegram's own https://t.me/c/... /
 *  https://t.me/<username>/<thread_id> topic-link scheme requires either a
 *  public @username or the internal numeric chat id in the "c/<id>" form;
 *  a private chat with neither exposed to us reliably has no safe link to
 *  build). Returns null rather than guessing — the caller falls back to
 *  naming the topic instead of linking it. */
export function buildTopicLink(chatUsername: string | null, chatId: string, messageThreadId: number): string | null {
  if (chatUsername) return `https://t.me/${chatUsername}/${messageThreadId}`;
  // Telegram's internal numeric chat ids for supergroups/channels are
  // reported with a "-100" prefix; the public "t.me/c/<id>/<thread>" deep
  // link form needs the id WITHOUT that prefix. A chat id that doesn't
  // match this shape (e.g. a plain group, which Telegram Forum topics
  // don't apply to anyway) has no reliable link to build.
  const match = /^-100(\d+)$/.exec(chatId);
  if (!match) return null;
  return `https://t.me/c/${match[1]}/${messageThreadId}`;
}

/** Composes the dynamic, topic-aware solicitation warning — the CURRENT
 *  topic's real display name is always used (never a hardcoded "General"/
 *  "Announcements"), and the Promotion topic (if one is configured) is
 *  named/linked as the correct place to post instead. Deterministic —
 *  never a model call, so an exact fact (which topic, which link, how many
 *  minutes) can never be garbled or invented. `muteMinutes` mirrors
 *  spamWarningMuteSentence's own convention: omitted (no mute) only for the
 *  very first offense. */
export function topicSolicitationWarningText(
  currentTopic: CommunityTopicRow | null,
  promotionTopic: CommunityTopicRow | null,
  promotionTopicLink: string | null,
  muteMinutes: number | undefined
): string {
  const here = topicDisplayName(currentTopic);
  const mutePart = muteMinutes ? ` This resulted in a ${muteMinutes}-minute mute.` : "";
  if (!promotionTopic) {
    return `Please do not send promotions in ${here}. Repeatedly sending promotional content here may result in a mute, and a 5th offense may result in a kick or ban.${mutePart}`;
  }
  const promoName = topicDisplayName(promotionTopic);
  const where = promotionTopicLink ? `${promoName} (${promotionTopicLink})` : promoName;
  return `Please do not send promotions in ${here}. If you want to promote a project, please use the ${where} topic instead. Repeatedly sending promotional content in ${here} may result in a mute, and a 5th offense may result in a kick or ban.${mutePart}`;
}
