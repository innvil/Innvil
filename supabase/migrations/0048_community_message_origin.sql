-- 0048_community_message_origin.sql
-- Bot-ack loop-prevention gap fix: community-runtime.ts previously hardcoded
-- every INBOUND CommunityEvent to origin="HUMAN"/interactionDepth=0, even
-- when the message being classified was itself an Innvil moderator's own
-- bot-ack reply. That made the coordinator's hard loop-prevention gates
-- (origin === "BOT_ACK", interactionDepth >= MAX_BOT_INTERACTION_DEPTH)
-- unreachable in practice -- confirmed live: a bot-ack SEND_TEXT reply,
-- re-delivered to the OTHER bot's webhook, was evaluated as a fresh
-- depth-0 human-equivalent event. These columns let the runtime persist the
-- true origin/depth of an outbound bot-ack reply so a later inbound
-- classification of that SAME message (by platform_message_id) can resolve
-- it correctly instead of defaulting.
--
-- origin is left NULL for every ordinary recorded message (human messages,
-- natural-chatter replies, proactive posts) -- only the bot-ack runtime path
-- sets it, and only for SEND_TEXT acknowledgements (REACT never produces a
-- new "message" a webhook could re-classify, so there's nothing to track).

begin;

alter table community_messages
  add column if not exists origin text check (origin in ('HUMAN', 'PROACTIVE', 'BOT_ACK')),
  add column if not exists interaction_depth integer not null default 0;

commit;
