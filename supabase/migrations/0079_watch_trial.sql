-- Direct (Panel-less) Innvil Watch Free Trial — durable, one-time, account +
-- verified-Telegram-identity scoped claim. This table IS the atomic claim
-- arbiter (DB-level uniqueness, not an application "if eligible then
-- insert") AND the durable consumption record (never deleted on expiry or
-- on a later paid upgrade, so the trial can never be reclaimed).
--
-- `unique(account_id)` — one trial per Innvil account.
-- `unique(telegram_user_id)` — one trial per verified Telegram person, even
--   if a future relink/unlink feature ever lets identity move between
--   accounts (watch_telegram_links itself is already unique on
--   telegram_user_id alone as of migration 0071, so this is defense in
--   depth against that specific case, not the only thing preventing it
--   today).
--
-- Trial duration/capacity are NOT stored here — they're read live from the
-- existing canonical constants in src/lib/moderator/plan.ts
-- (TRIAL_DURATION_DAYS, TRIAL_CAPACITY, TRIAL_MAX_SAVED_MODERATORS),
-- already the trial precedent for the Panel-distributed Virtual Moderator
-- product. `ends_at` is computed and stored at claim time from that
-- duration so expiry is a plain timestamp comparison, server-authoritative,
-- no cron required.
create table if not exists watch_trial_claims (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references profiles (id) on delete cascade,
  telegram_user_id bigint not null unique,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table watch_trial_claims enable row level security;
-- No policies -- service-role only, same convention as every other Watch
-- runtime/entitlement table (product_entitlements, watch_telegram_links,
-- watch_abuse_signals, ...).
