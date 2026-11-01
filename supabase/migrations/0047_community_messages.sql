-- 0047_community_messages.sql
-- Bounded recent-context log for Reactive Natural Chatter. Every community
-- runtime event (human, Innvil moderator, or external bot) gets a row so the
-- decision/generation pipeline can retrieve a short recent window instead of
-- reacting to one message in isolation — required to tell "two humans are
-- already mid-conversation" from "this message is actually addressed to me."
-- Not a durable transcript/analytics store: read as a rolling window (ORDER
-- BY created_at DESC LIMIT N), not indefinitely retained.

begin;

create table if not exists community_messages (
  id                bigint generated always as identity primary key,
  panel_id          uuid not null references panels (id) on delete cascade,
  community_id      uuid not null references communities (id) on delete cascade,
  platform_message_id text not null,
  sender_type       text not null check (sender_type in ('HUMAN', 'INNVIL_MODERATOR', 'EXTERNAL_BOT')),
  sender_platform_id text,
  sender_display_name text,
  -- Set only when sender_type = INNVIL_MODERATOR: which deployment sent it,
  -- so a later reply-to-this-message can be recognized as directed at THAT bot.
  deployment_id     uuid references moderator_deployments (id) on delete set null,
  text              text not null default '',
  reply_to_platform_message_id text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_community_messages_recent
  on community_messages (community_id, created_at desc);

alter table community_messages enable row level security;
-- No policies: service-role only (webhook/runtime), same as other pure
-- runtime-state tables in this schema (telegram_processed_updates).

commit;
