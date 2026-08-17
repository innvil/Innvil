-- 0068_watch_binance_pay.sql
--
-- Direct Watch payment via Binance Pay -- Innvil's OWN platform-level
-- Binance account (super admin -> Platform payments -> Binance Pay),
-- verified by the customer submitting a Binance transaction/order id.
-- Mirrors the existing PANEL-level Binance Pay claim-by-transaction-id
-- pattern (migrations 0032/0039/0040) but scoped to `platform_deposits`
-- (Innvil's own account) instead of a panel owner's `payments` table --
-- additive only, does not touch those tables/migrations.

begin;

alter table platform_deposits add column if not exists binance_tx_id text;
create unique index if not exists idx_platform_deposits_binance_tx
  on platform_deposits (binance_tx_id) where binance_tx_id is not null;

commit;
