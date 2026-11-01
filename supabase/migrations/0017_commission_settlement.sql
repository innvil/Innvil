-- ============================================================================
-- 0017_commission_settlement.sql
-- Innvil's 5% platform commission is settled PER completed order. When an order
-- becomes `completed`, deduct 5% of its charge from the panel's Innvil balance
-- (panels.settings.innvil_balance) — the balance funded by owner→Innvil top-ups
-- (0016). Idempotent via orders.commission_amount (NULL = not yet settled), so
-- the sync engine can safely sweep completed+unsettled orders every pass.
-- Requires 0001 (orders, panels, order_status enum) and the 0016 balance convention.
-- Idempotent — safe to re-run.
-- ============================================================================

-- NULL = commission not yet charged for this order; a number = amount already taken.
alter table orders add column if not exists commission_amount numeric(14,4);

-- Atomically settle one order's commission:
--   * locks the order row,
--   * only charges `completed` orders that haven't been charged yet,
--   * stamps orders.commission_amount and debits the panel's innvil_balance,
--   * returns the panel's new balance (NULL when nothing was charged).
create or replace function settle_order_commission(p_order uuid, p_rate numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_panel      uuid;
  v_charge     numeric;
  v_status     order_status;
  v_already    numeric;
  v_commission numeric;
  v_balance    numeric;
begin
  select panel_id, charge, status, commission_amount
    into v_panel, v_charge, v_status, v_already
    from orders where id = p_order for update;

  if not found then return null; end if;
  if v_already is not null then return null; end if;    -- already settled (idempotent)
  if v_status <> 'completed' then return null; end if;   -- only completed orders earn commission

  v_commission := round(coalesce(v_charge, 0) * coalesce(p_rate, 0), 4);
  update orders set commission_amount = v_commission where id = p_order;

  update panels
     set settings = jsonb_set(
       coalesce(settings, '{}'::jsonb),
       '{innvil_balance}',
       to_jsonb(round(coalesce((settings->>'innvil_balance')::numeric, 0) - v_commission, 4))
     )
   where id = v_panel
  returning (settings->>'innvil_balance')::numeric into v_balance;

  return v_balance;
end;
$$;

revoke all on function settle_order_commission(uuid, numeric) from anon, authenticated;
grant execute on function settle_order_commission(uuid, numeric) to service_role;
