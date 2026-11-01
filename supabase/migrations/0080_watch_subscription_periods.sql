-- Real paid subscription periods for direct Watch entitlements. Additive
-- only -- `product_entitlements` is the generic, product-agnostic
-- entitlement table (migration 0066); adding period columns here (rather
-- than a second dedicated table) keeps ONE row = one source of truth per
-- (account, product), so "subscription says expired but entitlement says
-- active forever" can never happen by construction.
--
-- current_period_start/current_period_end are NULLABLE. A NULL
-- current_period_end means "no tracked period" -- this is the safe
-- compatibility state for every EXISTING paid row created before this
-- migration: they are NOT backfilled with a guessed date (there is no
-- deterministic way to derive one from activated_at alone, since the
-- billing period length was never tracked before now), and the runtime
-- resolver (watch-runtime.ts) treats a NULL current_period_end as
-- never-expiring -- an existing paid customer is never silently cut off by
-- this migration. Real period tracking begins on that account's NEXT
-- successful payment (renewal or plan change), which always sets a real
-- period going forward.
alter table product_entitlements add column if not exists current_period_start timestamptz;
alter table product_entitlements add column if not exists current_period_end timestamptz;
-- How the customer currently intends to pay their NEXT renewal. Stored now
-- so a future automatic-renewal scheduler has a real place to read from;
-- the UI does not yet expose a toggle for "innvil_credit" auto-renewal in
-- this pass (no scheduler/cron exists yet -- see CLAUDE.md), so every
-- account effectively stays 'manual_crypto' today regardless of this
-- column's value.
alter table product_entitlements add column if not exists renewal_mode text not null default 'manual_crypto'
  check (renewal_mode in ('manual_crypto', 'innvil_credit'));
