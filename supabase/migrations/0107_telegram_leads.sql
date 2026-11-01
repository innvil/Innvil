-- Telegram community lead list for Innvil's own marketing outreach (super-admin
-- only). This table stores REFERENCES to publicly-listed Telegram channels/groups
-- sourced from third-party PUBLIC directory sites (e.g. tlgrm.eu's own public
-- category listing pages) -- it never scrapes Telegram itself, never accesses
-- private/joined-group data, and this feature never sends any message anywhere.
-- It is a manual-outreach research tool: a super admin runs a scrape (or pastes a
-- manually-researched CSV) to populate this list, then works it by hand, tracking
-- status/notes per lead. No automated messaging exists anywhere in this feature.

create table if not exists public.telegram_leads (
  id               uuid primary key default gen_random_uuid(),
  source           text not null default 'manual',
  category         text,
  name             text not null,
  username         text not null,
  subscriber_count integer,
  description      text,
  status           text not null default 'new'
                     check (status in ('new','contacted','responded','declined','converted','invalid')),
  notes            text,
  contacted_at     timestamptz,
  contacted_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (username)
);
create index if not exists telegram_leads_status_idx on public.telegram_leads (status, created_at desc);
create index if not exists telegram_leads_category_idx on public.telegram_leads (category);

alter table public.telegram_leads enable row level security;

drop policy if exists "telegram_leads super admin all" on public.telegram_leads;
create policy "telegram_leads super admin all"
  on public.telegram_leads for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));
