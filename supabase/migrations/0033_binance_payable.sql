-- ----------------------------------------------------------------------------
-- 0033 — Binance Pay Phase 2: unique payable amount (attribution / anti-theft).
-- Each pending Binance deposit is assigned a unique amount (base + a tiny tail) so a
-- transaction can be matched to exactly one deposit intent by amount + receiver + time
-- window — enabling hands-free auto-credit and preventing another user from claiming a
-- transaction that isn't theirs.
-- ----------------------------------------------------------------------------
alter table payments add column if not exists binance_payable numeric(36, 8);

-- Fast lookup of a panel's still-open Binance deposits (poller + amount match).
create index if not exists idx_payments_binance_pending
  on payments (panel_id, binance_payable)
  where gateway = 'binance_pay' and status = 'pending';
