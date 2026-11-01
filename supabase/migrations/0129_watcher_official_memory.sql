-- Append-only source revisions. A failed/new extraction never leaves an old
-- revision authoritative. Service-role only; no user-controlled role claims.
create table if not exists watch_official_memory_sources (
  community_id uuid not null references communities(id) on delete cascade,
  platform_message_id text not null,
  revision bigint not null check (revision > 0),
  content_hash text not null,
  sender_platform_id text not null,
  verified_by_platform_id text not null,
  message_thread_id integer,
  source_url text,
  text text not null,
  urls jsonb not null default '[]'::jsonb check (jsonb_typeof(urls) = 'array'),
  is_pinned boolean not null default false,
  is_announcement boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  observed_at timestamptz not null default now(),
  primary key (community_id, platform_message_id, revision, content_hash)
);
alter table watch_official_memory_sources enable row level security;
create index if not exists idx_watch_memory_pending on watch_official_memory_sources(community_id, status, observed_at);

revoke all on watch_official_memory_sources from anon, authenticated;
grant all on watch_official_memory_sources to service_role;
