-- A plain-text fallback promotion destination for communities that have no
-- Telegram Forum topic structure at all (an ordinary group/supergroup has
-- no "topics" to assign a Promotion policy to -- watch_community_topics'
-- message_thread_id is always null there, so the existing Forum-topic-based
-- Promotion redirect is structurally inapplicable). This is a manually
-- configured separate Telegram destination (e.g. a dedicated promotions
-- group/channel link or @handle) the owner sets once; used as the
-- solicitation warning's redirect target whenever no Forum-topic-based
-- Promotion topic is configured/applicable. Never auto-derived or guessed.
alter table communities add column if not exists promotion_channel_link text;
