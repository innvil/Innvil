/* =========================================================
   Pure copy + navigation-target helpers for the Community dashboard's
   solicitation/promotion guidance (no I/O — directly unit-tested). Kept as
   plain exported constants/functions rather than inline JSX strings so the
   exact wording and link targets are pinned and can't silently drift. */

/** Solicitation is OFF by default -- covers "DM me", service/project/
 *  referral promotion, and similar unsolicited promotional content. */
export const SOLICITATION_DEFAULT_OFF_GUIDANCE =
  "Solicitation and unsolicited promotion are OFF by default. " +
  "This includes things like “DM me” messages, service promotion, project promotion, referral promotion, and similar unsolicited promotional content.";

export const SOLICITATION_OPTIONS_GUIDANCE =
  "If you want to allow solicitation across your entire community, enable it in Solicitation Settings. " +
  "Otherwise, we recommend creating or assigning a dedicated Promotion topic. When a Promotion topic is configured, the Watcher can direct members there when they try to promote in General, Announcements, or other non-promotion topics.";

export const SOLICITATION_TOGGLE_HELPER_TEXT =
  "Solicitation is OFF by default. Turning this ON allows solicitation across the community, except where other moderation rules apply.";

export const PROMOTION_TOPIC_HELPER_TEXT =
  "Promotion topics allow solicitation in that topic even when solicitation is globally OFF.";

export const RECOMMENDED_SETUP_GUIDANCE =
  "Recommended setup: keep solicitation OFF globally and configure a Promotion topic. This keeps General and Announcement discussions clean while still giving members a dedicated place to promote.";

/** The exact, specific in-page anchor targets -- never a generic Settings
 *  link when a more precise destination exists. Both sections live on the
 *  SAME Community detail page's "Settings" tab (see
 *  app/communities/[id]/page.tsx) -- a link into a specific anchor ALSO
 *  switches to that tab via the shared `?tab=` query param WatchTabs
 *  already reads as its `defaultTab`. */
export const SOLICITATION_SETTINGS_ANCHOR_ID = "solicitation-settings";
export const PROMOTION_TOPIC_ANCHOR_ID = "promotion-topic";

export function solicitationSettingsHref(): string {
  return `?tab=settings#${SOLICITATION_SETTINGS_ANCHOR_ID}`;
}

export function promotionTopicHref(): string {
  return `?tab=settings#${PROMOTION_TOPIC_ANCHOR_ID}`;
}
