-- ----------------------------------------------------------------------------
-- 0032 — Binance Pay (personal-account transaction reconciliation), per panel.
-- The owner connects their OWN read-only Binance key; customers pay the owner's
-- Pay ID and submit the transaction id; the server pulls the owner's Pay history,
-- matches, and credits the wallet. NOT an official merchant checkout.
-- ----------------------------------------------------------------------------

-- Local cache of the owner's Binance Pay history (per panel). Service-role only.
create table if not exists binance_pay_transactions (
  panel_id            uuid not null references panels (id) on delete cascade,
  transaction_id      text not null,
  order_type          text not null,
  transaction_time    timestamptz not null,
  amount              numeric(36, 8) not null,
  currency            text not null,
  receiver_binance_id text,
  payer_name          text,
  raw_payload         jsonb not null,
  first_seen_at       timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (panel_id, transaction_id)
);
create index if not exists idx_binance_tx_panel_time
  on binance_pay_transactions (panel_id, transaction_time desc);
create index if not exists idx_binance_tx_panel_cur_amt
  on binance_pay_transactions (panel_id, currency, amount);

-- Enable RLS with NO policies → only the service-role client (which bypasses RLS)
-- can read/write. The browser never touches this table.
alter table binance_pay_transactions enable row level security;

-- One Binance transaction can credit at most one deposit (dedupe / anti-replay).
alter table payments add column if not exists binance_tx_id text;
create unique index if not exists uq_payments_binance_tx
  on payments (binance_tx_id) where binance_tx_id is not null;
