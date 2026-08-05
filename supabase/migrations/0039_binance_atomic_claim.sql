-- ----------------------------------------------------------------------------
-- 0039 — Binance Pay atomic claim + wallet credit
-- Ensures transaction-id claim and balance credit happen in one DB transaction.
-- ----------------------------------------------------------------------------

create or replace function claim_binance_payment(
  p_payment_id uuid,
  p_customer_id uuid,
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
  v_payment_id uuid;
begin
  begin
    update payments
       set status = 'completed',
           binance_tx_id = p_tx_id,
           bonus_amount = p_bonus_amount
     where id = p_payment_id
       and customer_id = p_customer_id
       and status = 'pending'
     returning id into v_payment_id;

    if v_payment_id is null then
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
      return 'TRANSACTION_ALREADY_USED';
    when others then
      return 'CREDIT_FAILED';
  end;
end;
$$;

revoke all on function claim_binance_payment(uuid, uuid, text, numeric, numeric, text)
  from anon, authenticated;
grant execute on function claim_binance_payment(uuid, uuid, text, numeric, numeric, text)
  to service_role;
