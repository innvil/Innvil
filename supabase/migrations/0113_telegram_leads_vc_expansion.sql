-- Extends the existing Telegram lead-research tool (migration 0107) to also
-- support VC (venture capital) leads sourced from a public website
-- directory (vcsheet.com), and adds a permanent exclusion list so a
-- removed lead is never silently re-added by a later scrape/import.

-- Non-Telegram sources need a real destination URL (a fund's own website),
-- not the hardcoded https://t.me/<username> construction the app already
-- uses for Telegram entries. `link` is nullable and additive -- every
-- existing Telegram-sourced row keeps working unchanged (the app falls back
-- to the t.me construction when link is null). `platform` distinguishes the
-- two categories of lead so the UI can label/filter them.
alter table public.telegram_leads add column if not exists link text;
alter table public.telegram_leads add column if not exists platform text not null default 'telegram'
  check (platform in ('telegram', 'website'));
create index if not exists telegram_leads_platform_idx on public.telegram_leads (platform);

-- Permanent removal record. `username` reuses the SAME unique identifier
-- telegram_leads itself already keys on (a Telegram @handle, or a VC Sheet
-- fund slug e.g. "andreessen-horowitz") -- deleting a lead inserts its
-- username here first, and every future scrape/import checks this table
-- before inserting a NEW row for that same username, so a removed lead can
-- never silently reappear.
create table if not exists public.telegram_lead_exclusions (
  username     text primary key,
  excluded_by  uuid references auth.users(id) on delete set null,
  excluded_at  timestamptz not null default now()
);

alter table public.telegram_lead_exclusions enable row level security;

drop policy if exists "telegram_lead_exclusions super admin all" on public.telegram_lead_exclusions;
create policy "telegram_lead_exclusions super admin all"
  on public.telegram_lead_exclusions for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));
