begin;

-- =========================================================================
-- Real account-level General preferences for Innvil Watch -- backs the
-- "General" section of Settings (timezone + 12h/24h time display). Genuinely
-- separate from `communities.timezone` (migration 0055) -- that's a
-- PER-COMMUNITY scheduling input for Auto-Posting windows; this is the
-- account's own DISPLAY preference for how absolute timestamps read
-- wherever this account views them (starting with Profile's "Connected on"
-- date -- see watch-account-preferences.ts). Deliberately no other "General"
-- field is added here (no default-Project concept exists to prefer yet).
-- =========================================================================

create table if not exists watch_account_preferences (
  account_id   uuid primary key references profiles (id) on delete cascade,
  timezone     text not null default 'UTC',
  time_format  text not null default '24h' check (time_format in ('12h', '24h')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table watch_account_preferences enable row level security;
-- No policies -- service-role only, same convention as every other Watch
-- preferences/runtime table.

commit;
