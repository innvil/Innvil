-- Innvil Credit -- a reusable, account-owned (never Panel-owned), USD-
-- denominated prepaid service credit. Funded through the SAME supported
-- crypto gateways direct Watch checkout already uses (reuses
-- platform_deposits/platform_payment_gateways, a new `purpose` value, not a
-- second payment system). Explicitly NOT a crypto custody wallet: after
-- settlement the balance is a plain USD ledger amount, never a stored
-- coin/token quantity; no withdrawal, no transfer, no exchange exists.
--
-- Owned by the Innvil account (profiles.id) directly -- NOT by a Panel, NOT
-- Watch-specific -- so a future Innvil product can spend from the same
-- ledger without a migration. A direct Watch account with ZERO Panels can
-- fund and spend Innvil Credit.

begin;

-- ------------------------------------------------------- credit accounts ----

-- One row per Innvil account. balance_cents is a CACHED, transactionally-
-- maintained total -- innvil_credit_transactions is the authoritative
-- ledger; this column exists only so a balance read doesn't need to sum
-- the whole ledger every time. Only ever mutated by apply_innvil_credit_change
-- below (security definer), never directly by application code.
create table if not exists innvil_credit_accounts (
  account_id    uuid primary key references profiles (id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  updated_at    timestamptz not null default now()
);
alter table innvil_credit_accounts enable row level security;

-- ---------------------------------------------------- credit ledger ----

-- Immutable, append-only. amount_cents is signed (positive = credit,
-- negative = debit); balance_after_cents is the running total right after
-- this entry, for audit without re-summing. product_id is nullable and
-- generic (products.id) so a future non-Watch spend can reference its own
-- product without a schema change -- this pass only ever writes Watch's
-- product id or null (a pure top-up has no product).
create table if not exists innvil_credit_transactions (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references profiles (id) on delete cascade,
  type               text not null check (type in ('crypto_top_up', 'subscription_purchase', 'subscription_renewal', 'adjustment')),
  amount_cents       bigint not null,
  balance_after_cents bigint not null,
  product_id         uuid references products (id),
  -- For a crypto_top_up: the originating platform_deposits.id -- globally
  -- unique, so a duplicate webhook credit attempt for the SAME confirmed
  -- payment fails this unique index rather than double-crediting. For a
  -- compensating reversal (a debit that couldn't be reconciled with a
  -- subscription activation), the string "reversal:<original-tx-id>".
  payment_ref        text,
  description        text,
  created_at         timestamptz not null default now()
);
create unique index if not exists idx_innvil_credit_tx_payment_ref_unique
  on innvil_credit_transactions (payment_ref) where payment_ref is not null;
create index if not exists idx_innvil_credit_tx_account on innvil_credit_transactions (account_id, created_at desc);

alter table innvil_credit_transactions enable row level security;
-- No policies on either table -- service-role only, same convention as
-- every other Watch runtime/entitlement table. Customers never get direct
-- read/write access to these tables; Billing reads through a server action.

-- ------------------------------------------------- atomic balance mutation ----

-- The ONLY way balance_cents may change. Row-locks the account (creating it
-- on first use), applies the signed amount, rejects if it would go
-- negative (never allows overdraft, never partially applies), and writes
-- exactly one ledger row. A duplicate payment_ref raises a unique-violation
-- (23505), which aborts this ENTIRE function call -- including the balance
-- update already applied earlier in the same call -- so a duplicate
-- top-up credit is a clean, fully-rolled-back no-op, not a partial credit.
create or replace function apply_innvil_credit_change(
  p_account uuid,
  p_amount_cents bigint,
  p_type text,
  p_product uuid default null,
  p_payment_ref text default null,
  p_description text default null
) returns innvil_credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_row innvil_credit_transactions;
begin
  insert into innvil_credit_accounts (account_id, balance_cents)
  values (p_account, 0)
  on conflict (account_id) do nothing;

  select balance_cents into v_balance from innvil_credit_accounts where account_id = p_account for update;

  v_balance := v_balance + p_amount_cents;
  if v_balance < 0 then
    raise exception 'insufficient_credit';
  end if;

  update innvil_credit_accounts set balance_cents = v_balance, updated_at = now() where account_id = p_account;

  insert into innvil_credit_transactions (account_id, type, amount_cents, balance_after_cents, product_id, payment_ref, description)
  values (p_account, p_type, p_amount_cents, v_balance, p_product, p_payment_ref, p_description)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function apply_innvil_credit_change(uuid, bigint, text, uuid, text, text) from public, anon, authenticated;
grant execute on function apply_innvil_credit_change(uuid, bigint, text, uuid, text, text) to service_role;

-- ------------------------------------------------- credit top-up purpose ----

-- A THIRD platform_deposits purpose, alongside the existing panel_topup and
-- watch_subscription -- an Innvil Credit top-up has no panel AND no
-- product/plan (credit isn't Watch-specific), so it gets its own shape.
alter table platform_deposits drop constraint if exists platform_deposits_purpose_shape;
alter table platform_deposits drop constraint if exists platform_deposits_purpose_check;
alter table platform_deposits add constraint platform_deposits_purpose_shape check (
  (purpose = 'panel_topup' and panel_id is not null and product_id is null and plan is null)
  or
  (purpose = 'watch_subscription' and panel_id is null and product_id is not null and plan is not null)
  or
  (purpose = 'innvil_credit_topup' and panel_id is null and product_id is null and plan is null)
);
-- The original inline CHECK on the `purpose` column itself (added via
-- `add column ... check(...)` in migration 0067) only allowed
-- 'panel_topup'/'watch_subscription' -- widen it to include the new value.
-- Postgres's default auto-generated name for a column-level CHECK added
-- this way is `<table>_<column>_check`; dropped with IF EXISTS so this
-- migration stays safe even if the live name differs (the new named
-- constraint below is what actually governs writes going forward either way).
alter table platform_deposits drop constraint if exists platform_deposits_purpose_check;
alter table platform_deposits drop constraint if exists platform_deposits_purpose_values;
alter table platform_deposits add constraint platform_deposits_purpose_values check (
  purpose in ('panel_topup', 'watch_subscription', 'innvil_credit_topup')
);

commit;
