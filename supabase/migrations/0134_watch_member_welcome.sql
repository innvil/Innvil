-- 0134_watch_member_welcome.sql
--
-- Innvil Watch member welcomes:
-- * Explicitly opt-in for each ordinary community (never enabled by default).
-- * One durable claim per Telegram service-message, shared by all Watchers
--   deployed to the same community, so a multi-Watcher deployment can never
--   greet the same join event several times.

begin;

alter table communities
  add column if not exists welcome_new_members boolean not null default false;

create table if not exists watch_member_welcome_events (
  community_id uuid not null references communities(id) on delete cascade,
  platform_message_id text not null,
  integration_id uuid not null references telegram_bot_integrations(id) on delete cascade,
  member_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(member_ids) = 'array'),
  created_at timestamptz not null default now(),
  primary key (community_id, platform_message_id)
);

alter table watch_member_welcome_events enable row level security;
revoke all on table watch_member_welcome_events from anon, authenticated;
grant all on table watch_member_welcome_events to service_role;

commit;
