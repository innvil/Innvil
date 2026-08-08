-- 0049_community_message_dedup.sql
-- Cross-bot dedup for community_messages. When more than one Innvil-managed
-- bot is deployed in the same Telegram community (Group Privacy Mode off),
-- Telegram delivers a single real message to EVERY deployed bot's own
-- webhook independently — each with its own update_id, so the existing
-- telegram_processed_updates dedup (keyed by integration_id + update_id)
-- never catches it. Without this, community-runtime.ts processed the same
-- human message once per deployed bot: duplicate community_messages rows,
-- duplicate moderator_activity_log rows, and — the visible bug — the
-- winning deployment sending its OWN reply twice (confirmed live: two
-- identical "yeah I'm here, what's up?" messages back-to-back from the same
-- bot, Telegram collapsing the second bubble's avatar into a blank gap).
--
-- platform_message_id is assigned by Telegram per-chat (not per-bot), so
-- every bot's webhook observes the SAME id for the same real message —
-- making (community_id, platform_message_id) a safe, exact dedup key. The
-- application (recordCommunityMessage) now does an insert-and-detect-
-- duplicate: whichever bot's webhook reaches the insert first "claims" the
-- message and proceeds to bot-ack/chatter; every other bot's webhook sees a
-- conflict and returns immediately, matching the isDuplicateUpdate pattern
-- already used for telegram_processed_updates.

begin;

-- Existing test data already has duplicate (community_id, platform_message_id)
-- rows from before this fix (both bots' webhooks recording the same message) —
-- collapse to the earliest row per pair before the unique index can be added.
delete from community_messages a
  using community_messages b
  where a.community_id = b.community_id
    and a.platform_message_id = b.platform_message_id
    and a.id > b.id;

create unique index if not exists idx_community_messages_dedup
  on community_messages (community_id, platform_message_id);

commit;
