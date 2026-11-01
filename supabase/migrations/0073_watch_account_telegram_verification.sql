begin;

-- =========================================================================
-- Native (Panel-independent) account -> Telegram person verification for
-- Innvil Watch. Extends the EXISTING canonical identity model
-- (watch_telegram_links, migration 0067/0071) rather than creating a second
-- one -- this table only ever holds SHORT-LIVED verification ATTEMPTS; the
-- durable identity link is still written to watch_telegram_links by the
-- existing linkTelegramIdentity() function.
--
-- Mirrors the already-proven telegram_setup_sessions pattern (migration
-- 0064, Panel-scoped group-connect `/start` tokens) -- same shape (token,
-- expiry, single-use consumption via a conditional status update), but
-- deliberately a SEPARATE table: that one is scoped to a Panel + a
-- Watcher's bot integration (a GROUP-connect flow); this one is scoped to
-- an Innvil account only, consumed by the platform-wide official
-- innvil_bot_manager bot (a PERSONAL identity-verification flow). Keeping
-- them separate keeps "verify a person" structurally distinct from
-- "connect a bot to a group", per the explicit instruction never to
-- combine those two concepts.
-- =========================================================================

create table if not exists watch_telegram_verification_attempts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references profiles (id) on delete cascade,
  -- sha256 hex of the actual `/start` token -- the plaintext token is
  -- returned to the browser once (to build the t.me deep link) and never
  -- stored; only its hash is persisted, so a DB read alone can never yield
  -- a usable token.
  token_hash   text not null unique,
  status       text not null default 'pending' check (status in ('pending', 'consumed', 'cancelled')),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_watch_tg_verification_account on watch_telegram_verification_attempts (account_id) where status = 'pending';

alter table watch_telegram_verification_attempts enable row level security;
-- No policies -- service-role only, same convention as every other
-- moderator/runtime table in this schema (verification attempts are never
-- read/written directly by a browser-side Supabase client).

-- Telegram username metadata, captured for the FIRST time now that a real
-- live caller (the verification flow this migration supports) actually
-- has trusted username data to store. watch_telegram_links previously had
-- no such column at all (confirmed by schema review) -- nullable, since a
-- Telegram person can have no username, and every pre-existing row (from
-- migration 0071's historical backfill) genuinely has none to backfill.
alter table watch_telegram_links add column if not exists telegram_username text;

commit;
