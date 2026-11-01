-- 0067_watch_direct_payment.sql
--
-- Direct (Panel-less) Innvil Watch payment + a lightweight, layered Watch
-- anti-abuse identity model. Additive only -- does not touch migration 0066.
--
-- REUSES the EXISTING platform_payment_gateways/platform_deposits system
-- (migrations 0008/0016) that already powers owner->Innvil top-ups via
-- Cryptomus/NOWPayments, rather than building a second payment system.
-- `platform_deposits.owner_id` was ALREADY a plain account/user id (not
-- FK-declared to panels at all) -- it's the exact "account, not Panel"
-- identity this phase needs, just never used for anything but panel
-- top-ups until now.

begin;

-- ---------------------------------------------------- direct Watch payment ----

-- `purpose` distinguishes the EXISTING owner-panel-topup flow (unchanged
-- behavior, default) from a NEW direct-Watch-subscription flow. `panel_id`
-- becomes optional -- a direct Watch payment has no Panel at all.
alter table platform_deposits add column if not exists purpose text not null default 'panel_topup'
  check (purpose in ('panel_topup', 'watch_subscription'));
alter table platform_deposits alter column panel_id drop not null;
alter table platform_deposits add column if not exists product_id uuid references products (id);
alter table platform_deposits add column if not exists plan text; -- internal tier id, e.g. 'basic'/'standard'/'premium'/'pro'/'enterprise'

-- A watch_subscription deposit must have a product/plan and no panel; a
-- panel_topup deposit must have a panel and no product/plan -- enforced at
-- the DB level so the two purposes can never be confused mid-migration.
alter table platform_deposits drop constraint if exists platform_deposits_purpose_shape;
alter table platform_deposits add constraint platform_deposits_purpose_shape check (
  (purpose = 'panel_topup' and panel_id is not null and product_id is null and plan is null)
  or
  (purpose = 'watch_subscription' and panel_id is null and product_id is not null and plan is not null)
);

create index if not exists idx_platform_deposits_owner_purpose on platform_deposits (owner_id, purpose);

-- --------------------------------------------------- Watch anti-abuse model ----

-- Links an Innvil account to a VERIFIED Telegram numeric user id (never a
-- username -- usernames are mutable). One account may link multiple
-- Telegram identities over time (rare but possible); the same Telegram
-- identity linking to MULTIPLE accounts is exactly the cross-account abuse
-- signal this table exists to detect -- so this is intentionally NOT
-- unique on telegram_user_id alone, only on the (account, identity) pair.
create table if not exists watch_telegram_links (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references profiles (id) on delete cascade,
  telegram_user_id bigint not null,
  verified_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (account_id, telegram_user_id)
);
create index if not exists idx_watch_telegram_links_account on watch_telegram_links (account_id);
create index if not exists idx_watch_telegram_links_telegram_user on watch_telegram_links (telegram_user_id);

alter table watch_telegram_links enable row level security;

-- Generic, typed abuse/limited-offer-consumption record. Deliberately NOT a
-- flexible rules engine -- `abuse_type` is a small, explicit enum; `scope`
-- says which identity dimension the record is keyed against. `ip_hash`
-- (never a raw IP) is a SECONDARY signal only, per explicit instruction --
-- nothing in the application layer may treat it as a primary identity.
create table if not exists watch_abuse_signals (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid references profiles (id) on delete cascade,
  telegram_user_id     bigint,
  telegram_community_id text,
  payment_ref          text,
  ip_hash              text,
  abuse_type           text not null check (abuse_type in ('trial_consumed', 'promo_consumed', 'payment_failed', 'flagged_pattern')),
  scope                text not null check (scope in ('account', 'telegram_identity', 'community', 'payment')),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz
);
create index if not exists idx_watch_abuse_account on watch_abuse_signals (account_id);
create index if not exists idx_watch_abuse_telegram_user on watch_abuse_signals (telegram_user_id);
create index if not exists idx_watch_abuse_type on watch_abuse_signals (abuse_type);

alter table watch_abuse_signals enable row level security;
-- No policies on either new table: service-role only (server actions
-- enforce ownership/scope in code), same convention as every other
-- tenant-scoped table in this schema.

commit;
