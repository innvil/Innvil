-- -----------------------------------------------------------------------------
-- 0040 — Binance Pay Order ID persistence
-- Stores the app-visible Binance C2C Order ID separately from transaction_id.
-- Keeps transaction_id as the internal idempotency key.
-- -----------------------------------------------------------------------------

alter table binance_pay_transactions
  add column if not exists order_id text;

update binance_pay_transactions
   set order_id = nullif(raw_payload->>'orderId', '')
 where order_id is null
   and raw_payload ? 'orderId'
   and nullif(raw_payload->>'orderId', '') is not null;

create index if not exists idx_binance_tx_panel_order
  on binance_pay_transactions (panel_id, order_id)
  where order_id is not null;

create unique index if not exists uq_binance_tx_panel_order
  on binance_pay_transactions (panel_id, order_id)
  where order_id is not null;

alter table payments
  add column if not exists binance_order_id text;

update payments p
   set binance_order_id = tx.order_id
  from binance_pay_transactions tx
 where p.gateway = 'binance_pay'
   and p.panel_id = tx.panel_id
   and p.binance_tx_id = tx.transaction_id
   and p.binance_order_id is null
   and tx.order_id is not null;

create unique index if not exists uq_payments_binance_order
  on payments (binance_order_id) where binance_order_id is not null;

create unique index if not exists uq_payments_binance_tx
  on payments (binance_tx_id) where binance_tx_id is not null;

drop function if exists claim_binance_payment(uuid, uuid, text, numeric, numeric, text);

create or replace function claim_binance_payment(
  p_payment_id uuid,
  p_customer_id uuid,
  p_order_id text,
  p_tx_id text,
  p_bonus_amount numeric,
  p_credit_amount numeric,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_payment_id uuid;
begin
  select status
    into v_status
    from payments
   where id = p_payment_id
     and customer_id = p_customer_id
   for update;

  if not found then
    return 'DEPOSIT_NOT_OPEN';
  end if;

  if v_status = 'completed' then
    return 'PAYMENT_ALREADY_CREDITED';
  end if;

  if exists (
    select 1
      from payments
     where binance_order_id = p_order_id
       and id <> p_payment_id
  ) then
    return 'ORDER_ID_ALREADY_USED';
  end if;

  if exists (
    select 1
      from payments
     where binance_tx_id = p_tx_id
       and id <> p_payment_id
  ) then
    return 'PAYMENT_ALREADY_CREDITED';
  end if;

  begin
    update payments
       set status = 'completed',
           binance_order_id = p_order_id,
           binance_tx_id = p_tx_id,
           bonus_amount = p_bonus_amount
     where id = p_payment_id
       and customer_id = p_customer_id
       and status = 'pending'
     returning id into v_payment_id;

    if v_payment_id is null then
      select status
        into v_status
        from payments
       where id = p_payment_id
         and customer_id = p_customer_id;

      if v_status = 'completed' then
        return 'PAYMENT_ALREADY_CREDITED';
      end if;

      return 'DEPOSIT_NOT_OPEN';
    end if;

    perform apply_balance_change(
      p_customer_id,
      p_credit_amount,
      'deposit',
      p_reason,
      null,
      null
    );

    return 'OK';
  exception
    when unique_violation then
      if exists (
        select 1
          from payments
         where binance_order_id = p_order_id
           and id <> p_payment_id
      ) then
        return 'ORDER_ID_ALREADY_USED';
      end if;

      return 'PAYMENT_ALREADY_CREDITED';
    when others then
      return 'CREDIT_FAILED';
  end;
end;
$$;

revoke all on function claim_binance_payment(uuid, uuid, text, text, numeric, numeric, text)
  from anon, authenticated;
grant execute on function claim_binance_payment(uuid, uuid, text, text, numeric, numeric, text)
  to service_role;