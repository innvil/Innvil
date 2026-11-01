-- Telegram Forum topic id on every recorded message -- needed to scope
-- "is an admin/mod actively handling THIS topic/thread" (the pending-reply
-- scheduler's conversation-ownership check) and community-knowledge
-- retrieval to the right sub-channel, rather than the whole community's
-- flat message history. Nullable/absent for a non-forum chat, exactly
-- mirroring communities.message_thread_id usage elsewhere in this schema.
alter table community_messages
  add column if not exists message_thread_id integer;

create index if not exists idx_community_messages_topic_recent
  on community_messages (community_id, message_thread_id, created_at desc);
