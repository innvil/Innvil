-- ============================================================================
-- 0135_platform_support_threads.sql
-- Turns the legacy one-way Innvil support mailbox into an in-app conversation.
-- Existing messages are preserved: each legacy row becomes the first message in
-- its own thread, so historical owner questions remain replyable.
-- ============================================================================

begin;

create table if not exists platform_support_threads (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references profiles (id) on delete cascade,
  owner_email     text,
  subject         text not null,
  status          text not null default 'open' check (status in ('open', 'resolved')),
  owner_unread    boolean not null default false,
  innvil_unread   boolean not null default false,
  last_direction  text not null default 'inbound' check (last_direction in ('inbound', 'outbound')),
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_platform_support_threads_owner
  on platform_support_threads (owner_id, last_message_at desc);
create index if not exists idx_platform_support_threads_innvil_unread
  on platform_support_threads (innvil_unread, last_message_at desc)
  where innvil_unread = true;
create index if not exists idx_platform_support_threads_owner_unread
  on platform_support_threads (owner_id, owner_unread, last_message_at desc)
  where owner_unread = true;

drop trigger if exists trg_platform_support_threads_updated on platform_support_threads;
create trigger trg_platform_support_threads_updated before update on platform_support_threads
  for each row execute function set_updated_at();

alter table platform_support_threads enable row level security;

drop policy if exists platform_support_threads_read on platform_support_threads;
create policy platform_support_threads_read on platform_support_threads for select
  using (owner_id = auth.uid() or is_super_admin());

drop policy if exists platform_support_threads_owner_insert on platform_support_threads;
create policy platform_support_threads_owner_insert on platform_support_threads for insert
  with check (owner_id = auth.uid() or is_super_admin());

drop policy if exists platform_support_threads_update on platform_support_threads;
create policy platform_support_threads_update on platform_support_threads for update
  using (owner_id = auth.uid() or is_super_admin())
  with check (owner_id = auth.uid() or is_super_admin());

alter table platform_support_messages
  add column if not exists thread_id uuid,
  add column if not exists sender_id uuid references profiles (id) on delete set null;

-- Each legacy message is a complete, still-replyable conversation.  Its own ID
-- is reused as the thread ID, making the backfill deterministic and idempotent.
insert into platform_support_threads (
  id, owner_id, owner_email, subject, status, owner_unread, innvil_unread, last_direction,
  last_message_at, created_at, updated_at
)
select
  m.id,
  m.owner_id,
  m.owner_email,
  m.subject,
  case when m.status = 'resolved' then 'resolved' else 'open' end,
  coalesce(m.direction, 'inbound') = 'outbound',
  coalesce(m.direction, 'inbound') = 'inbound',
  coalesce(m.direction, 'inbound'),
  m.created_at,
  m.created_at,
  m.updated_at
from platform_support_messages m
where m.thread_id is null
on conflict (id) do nothing;

update platform_support_messages
   set thread_id = id
 where thread_id is null;

alter table platform_support_messages
  alter column thread_id set not null;

alter table platform_support_messages
  drop constraint if exists platform_support_messages_thread_id_fkey;
alter table platform_support_messages
  add constraint platform_support_messages_thread_id_fkey
  foreign key (thread_id) references platform_support_threads (id) on delete cascade;

create index if not exists idx_platform_support_messages_thread
  on platform_support_messages (thread_id, created_at asc);

commit;
