-- ============================================================================
-- 0021_commission_reversal.sql
-- When a COMPLETED order (whose 5% commission was already settled off the panel's
-- innvil_balance) is refunded, Innvil shouldn't keep the commission. This reverses
-- it: credits the (proportional) commission back to the panel's innvil_balance and
-- reduces orders.commission_amount so "commission charged" reflects the net take.
-- No-ops when the order had no settled commission (commission_amount null/<=0).
-- p_fraction = share of the order being refunded (1 = full refund). Idempotent-ish:
-- it only ever gives back what's currently recorded as charged.
-- Requires 0017 (commission_amount) + 0020 (commission_settled_at). Safe to re-run.
-- ============================================================================

create or replace function reverse_order_commission(p_order uuid, p_fraction numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_panel   uuid;
  v_amt     numeric;
  v_reverse numeric;
  v_balance numeric;
begin
  select panel_id, commission_amount into v_panel, v_amt
    from orders where id = p_order for update;
  if not found then return null; end if;
  if v_amt is null or v_amt <= 0 then return null; end if;   -- nothing was settled

  v_reverse := round(v_amt * least(greatest(coalesce(p_fraction, 1), 0), 1), 4);
  if v_reverse <= 0 then return null; end if;

  update orders set commission_amount = round(v_amt - v_reverse, 4) where id = p_order;

  update panels
     set settings = jsonb_set(
       coalesce(settings, '{}'::jsonb),
       '{innvil_balance}',
       to_jsonb(round(coalesce((settings->>'innvil_balance')::numeric, 0) + v_reverse, 4))
     )
   where id = v_panel
  returning (settings->>'innvil_balance')::numeric into v_balance;

  return v_balance;
end;
$$;

revoke all on function reverse_order_commission(uuid, numeric) from anon, authenticated;
grant execute on function reverse_order_commission(uuid, numeric) to service_role;
