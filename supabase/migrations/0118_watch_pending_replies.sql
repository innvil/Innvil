-- Real, persisted "wait 120 seconds, give a human the first opportunity"
-- Watcher-reply scheduling (see src/lib/moderator/pending-reply.ts). Never
-- an in-memory timer -- Telegram webhooks are one-shot/stateless, so this
-- table + a pg_cron sweep IS the scheduler; it survives a server restart
-- and a new invocation by construction (there's no in-process state to
-- lose).
--
-- `unique(community_id, trigger_platform_message_id)` is defense-in-depth
-- against duplicate scheduling -- the PRIMARY guarantee against a duplicate
-- Telegram webhook delivery creating two pending replies for the same real
-- message is the pre-existing community_messages claim-race (migration
-- 0049's unique index), which already ensures only ONE webhook invocation
-- ever reaches the point where a pending reply would be scheduled for a
-- given message; this constraint just makes that guarantee hold at the DB
-- level too, in case of a retry landing between the claim and this insert.
create table if not exists watch_pending_replies (
  id                         uuid primary key default gen_random_uuid(),
  community_id               uuid not null references communities(id) on delete cascade,
  panel_id                   uuid references panels(id) on delete cascade,
  deployment_id              uuid not null references moderator_deployments(id) on delete cascade,
  chat_id                    text not null,
  message_thread_id          integer,
  trigger_platform_message_id text not null,
  sender_platform_id         text not null,
  sender_display_name        text,
  sender_username            text,
  message_text               text not null,
  action_kind                text not null check (action_kind in ('ANSWER', 'CASUAL_CHAT')),
  status                     text not null default 'pending'
                               check (status in ('pending', 'sending', 'sent', 'cancelled', 'expired', 'failed')),
  cancel_reason              text,
  scheduled_for              timestamptz not null,
  created_at                 timestamptz not null default now(),
  resolved_at                timestamptz,
  unique(community_id, trigger_platform_message_id)
);

create index if not exists idx_watch_pending_replies_due
  on watch_pending_replies(status, scheduled_for)
  where status = 'pending';

create index if not exists idx_watch_pending_replies_topic_pending
  on watch_pending_replies(community_id, message_thread_id)
  where status = 'pending';

alter table watch_pending_replies enable row level security;
-- No policies: service-role only, same convention as every other Watch
-- runtime state table in this schema.
