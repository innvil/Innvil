-- ============================================================================
-- 0035_watched_accounts.sql
-- Automator R5b — watched accounts (Business+ / full-auto). Feed-based: the customer
-- registers an RSS/Atom feed per account they want to auto-order on. A cron polls each
-- feed and fans new post links out through the customer's automation profile.
-- Requires 0001 (panels, customer_accounts, set_updated_at) + 0002 helpers. Idempotent.
-- ============================================================================

create table if not exists watched_accounts (
  id             uuid primary key default gen_random_uuid(),
  panel_id       uuid not null references panels (id) on delete cascade,
  customer_id    uuid not null references customer_accounts (id) on delete cascade,
  label          text not null default '',
  feed_url       text not null,
  -- The newest item link seen so far; anything above it in a later poll is "new".
  last_item_url  text,
  last_checked_at timestamptz,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_watched_accounts_panel on watched_accounts (panel_id);
create index if not exists idx_watched_accounts_active on watched_accounts (active) where active;

drop trigger if exists trg_watched_accounts_updated on watched_accounts;
create trigger trg_watched_accounts_updated before update on watched_accounts
  for each row execute function set_updated_at();

alter table watched_accounts enable row level security;

drop policy if exists watched_accounts_access on watched_accounts;
create policy watched_accounts_access on watched_accounts for all
  using (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  )
  with check (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  );
