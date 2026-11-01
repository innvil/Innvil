-- Annual billing via DIRECT payment (crypto: Cryptomus/NOWPayments/Binance
-- Pay), at its own 5% discount -- independent of the existing Innvil-
-- Credit-only annual path (10%, product_entitlements.billing_interval,
-- migration 0082). `platform_deposits` needs the SAME concept so the
-- async webhook settlement (platform.ts / watch-binance.ts) knows which
-- price/interval a pending crypto payment was actually for.
--
-- Every row created before this migration was created exclusively through
-- the monthly-only direct-payment paths -- 'monthly' is therefore the
-- deterministically correct backfill for 100% of existing rows (both
-- watch_subscription and every other purpose, e.g. panel_topup, for which
-- this column is simply unused/irrelevant), not a guess.
alter table platform_deposits add column if not exists billing_interval text not null default 'monthly'
  check (billing_interval in ('monthly', 'annual'));
