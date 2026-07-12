-- ============================================================================
-- 0009_support_tickets.sql
-- Per-panel customer support tickets + threaded messages.
-- A customer opens a ticket on the panel they belong to; the panel owner replies.
-- Actions run with the service role + code authz; RLS here is defense in depth.
-- Requires 0001 (customer_accounts, panels, set_updated_at) and
-- 0002 (is_panel_member, is_super_admin). Idempotent — safe to re-run.
-- ============================================================================

do $$ begin
  create type ticket_status as enum ('open', 'answered', 'closed');
exception when duplicate_object then null; end $$;

create table if not exists support_tickets (
  id              uuid primary key default gen_random_uuid(),
  panel_id        uuid not null references panels (id) on delete cascade,
  customer_id     uuid not null references customer_accounts (id) on delete cascade,
  subject         text not null,
  status          ticket_status not null default 'open',
  -- who sent the most recent message: 'customer' | 'owner' (drives unread badges)
  last_sender     text not null default 'customer',
  customer_unread boolean not null default false,
  owner_unread    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists idx_support_tickets_panel on support_tickets (panel_id);
create index if not exists idx_support_tickets_customer on support_tickets (customer_id);

create table if not exists support_ticket_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references support_tickets (id) on delete cascade,
  sender_role text not null,               -- 'customer' | 'owner'
  sender_id   uuid,                         -- auth.users id of the sender (best-effort)
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ticket_messages_ticket on support_ticket_messages (ticket_id, created_at);

drop trigger if exists trg_support_tickets_updated on support_tickets;
create trigger trg_support_tickets_updated before update on support_tickets
  for each row execute function set_updated_at();

-- RLS: panel members (owner/staff), super admin, or the ticket's own customer.
alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;

drop policy if exists support_tickets_access on support_tickets;
create policy support_tickets_access on support_tickets for all
  using (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  )
  with check (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  );

drop policy if exists support_ticket_messages_access on support_ticket_messages;
create policy support_ticket_messages_access on support_ticket_messages for all
  using (
    exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (
          is_panel_member(t.panel_id) or is_super_admin()
          or t.customer_id in (select id from customer_accounts where user_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from support_tickets t
      where t.id = ticket_id
        and (
          is_panel_member(t.panel_id) or is_super_admin()
          or t.customer_id in (select id from customer_accounts where user_id = auth.uid())
        )
    )
  );
