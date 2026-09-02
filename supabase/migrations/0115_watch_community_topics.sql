-- Auto-discovered Telegram Forum topics + owner-assignable policy.
-- Supersedes the earlier, never-shipped `communities.solicitation_topic_ids`
-- draft (an uncommitted raw-id allow-list) with a real per-topic policy
-- table: every topic the bot ever observes a message in gets a row here
-- (auto-discovery), and the owner assigns a policy to it from a picker
-- rather than hunting for a raw numeric message_thread_id.
--
-- Keyed by the STABLE numeric message_thread_id, never the display name --
-- renaming a topic in Telegram must never change its assigned policy.
-- `topic_name` is only ever the last-OBSERVED display name (best-effort,
-- refreshed whenever a message in that topic is processed), purely for the
-- owner UI and for composing warning text -- it is never the lookup key.
create table if not exists watch_community_topics (
  id                 uuid primary key default gen_random_uuid(),
  community_id       uuid not null references communities(id) on delete cascade,
  message_thread_id  integer not null,
  topic_name         text,
  -- 'general'/'announcement' are typically auto-suggested for Telegram's
  -- own implicit General topic and any topic literally named
  -- "Announcements", but that's a UI convenience only -- the owner can
  -- reassign any topic to any policy. 'normal' = no special treatment
  -- (restricted, like general/announcement, for solicitation purposes).
  -- 'promotion' is the ONE policy that overrides the community-wide
  -- solicitation toggle. 'custom' = owner-labeled, non-promotion.
  policy             text not null default 'normal'
                       check (policy in ('general', 'announcement', 'promotion', 'normal', 'custom')),
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique(community_id, message_thread_id)
);
create index if not exists idx_watch_community_topics_community
  on watch_community_topics(community_id);

alter table watch_community_topics enable row level security;
-- No policies: service-role only (webhook/runtime + owner actions all go
-- through the service-role client with code-level ownership checks), same
-- convention as every other Watch runtime table in this schema.
