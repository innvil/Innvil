-- 0125_community_message_moderation_warning_origin.sql
-- Live feedback (2026-09-04): a Watcher's moderation warnings sounded
-- generic and repeated the same skeleton across offenders. Fixing that
-- required scoping anti-repetition context to this Watcher's OWN RECENT
-- MODERATION WARNINGS specifically -- but community_messages carried no
-- column distinguishing a moderation-warning send from an ordinary Natural
-- Chatter reply (both are sender_type='INNVIL_MODERATOR' rows with an
-- identical shape). Rather than adding a new table/tracking mechanism, this
-- reuses the ALREADY-EXISTING `origin` column (migration 0048, originally
-- added for a different, orthogonal purpose: bot-ack loop prevention) by
-- widening its check constraint to allow a new tag, 'MODERATION_WARNING',
-- set only by the runtime's moderation-warning insert call sites (see
-- community-runtime.ts's recentOwnModeratorMessages).
--
-- Also fixes a real, separate, pre-existing latent bug found while touching
-- this exact constraint: community-runtime.ts's recordBotAckReply has
-- always written origin='COMMUNITY_HANDOFF' for a COMMUNITY_HANDOFF-kind
-- bot-ack reply, but that value was never actually in this column's allowed
-- list -- any such insert would have failed outright at the database level.
-- Adding it here costs nothing extra (same ALTER statement) and closes a
-- real gap discovered incidentally, not a new, separate work item.

begin;

alter table community_messages drop constraint if exists community_messages_origin_check;
alter table community_messages add constraint community_messages_origin_check
  check (origin in ('HUMAN', 'PROACTIVE', 'BOT_ACK', 'COMMUNITY_HANDOFF', 'MODERATION_WARNING'));

commit;
