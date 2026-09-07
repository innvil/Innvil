-- ============================================================================
-- 0020_commission_brackets.sql
-- Volume commission discounts + a per-panel daily commission cap.
--   * panels.settings.commission_rate  — optional per-panel rate (super admin sets
--       it, down to 1%); defaults to the flat 5% passed by the caller.
--   * orders.commission_settled_at      — when commission was charged (for the cap).
--   * $100 per-panel per-DAY cap         — Innvil never takes more than $100/day from
--       one panel; once hit, further completed orders that day settle at $0.
-- Rewrites settle_order_commission() accordingly (same signature; sync.ts unchanged).
-- Requires 0017 (orders.commission_amount) + 0016 (innvil_balance). Idempotent.
-- ============================================================================

alter table orders add column if not exists commission_settled_at timestamptz;

create or replace function settle_order_commission(p_order uuid, p_rate numeric)
returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_panel      uuid;
  v_charge     numeric;
  v_status     order_status;
  v_already    numeric;
  v_rate       numeric;
  v_full       numeric;
  v_today      numeric;
  v_room       numeric;
  v_amount     numeric;
  v_balance    numeric;
begin
  select panel_id, charge, status, commission_amount
    into v_panel, v_charge, v_status, v_already
    from orders where id = p_order for update;

  if not found then return null; end if;
  if v_already is not null then return null; end if;    -- already settled (idempotent)
  if v_status <> 'completed' then return null; end if;   -- only completed orders earn commission

  -- Per-panel rate (super admin can discount down to 1%); fall back to the caller's rate.
  select coalesce((settings->>'commission_rate')::numeric, p_rate, 0.05)
    into v_rate from panels where id = v_panel;
  v_rate := greatest(coalesce(v_rate, 0), 0);
  v_full := round(coalesce(v_charge, 0) * v_rate, 4);

  -- $100 per-panel per-day cap: only charge up to the remaining room for today.
  select coalesce(sum(commission_amount), 0) into v_today
    from orders
   where panel_id = v_panel and commission_settled_at >= date_trunc('day', now());
  v_room := greatest(100 - v_today, 0);
  v_amount := least(v_full, v_room);
  if v_amount < 0 then v_amount := 0; end if;

  update orders
     set commission_amount = v_amount, commission_settled_at = now()
   where id = p_order;

  update panels
     set settings = jsonb_set(
       coalesce(settings, '{}'::jsonb),
       '{innvil_balance}',
       to_jsonb(round(coalesce((settings->>'innvil_balance')::numeric, 0) - v_amount, 4))
     )
   where id = v_panel
  returning (settings->>'innvil_balance')::numeric into v_balance;

  return v_balance;
end;
$$;

revoke all on function settle_order_commission(uuid, numeric) from anon, authenticated;
grant execute on function settle_order_commission(uuid, numeric) to service_role;
