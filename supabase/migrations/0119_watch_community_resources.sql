-- Community message knowledge index (see
-- src/lib/moderator/community-message-knowledge.ts) -- facts/links
-- extracted from a community's OWN admin/mod-authored Telegram messages
-- (pinned posts, announcements, official links), so a deferred Watcher
-- reply can ground itself in what the community already established
-- instead of a generic response. Populated going forward only -- existing
-- message history is not retroactively backfilled/indexed.
create table if not exists watch_community_resources (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references communities(id) on delete cascade,
  message_thread_id   integer,
  platform_message_id text not null,
  sender_platform_id  text,
  is_admin_author     boolean not null default false,
  is_pinned           boolean not null default false,
  is_announcement_topic boolean not null default false,
  kind                text not null default 'OTHER'
                        check (kind in (
                          'WEBSITE', 'WHITEPAPER', 'DOCUMENTATION', 'ROADMAP', 'FAQ', 'ANNOUNCEMENT',
                          'PRESALE', 'TOKEN_INFORMATION', 'SOCIAL', 'PARTNERSHIP_CONTACT', 'PROJECT_STATUS', 'OTHER'
                        )),
  -- Null for a pure text fact extracted from a message with no link.
  url                 text,
  text                text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(community_id, platform_message_id, coalesce(url, ''))
);

create index if not exists idx_watch_community_resources_recent
  on watch_community_resources(community_id, created_at desc);
create index if not exists idx_watch_community_resources_pinned
  on watch_community_resources(community_id, is_pinned)
  where is_pinned = true;

alter table watch_community_resources enable row level security;
-- No policies: service-role only, same convention as every other Watch
-- runtime state table in this schema.
