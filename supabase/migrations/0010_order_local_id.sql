-- ============================================================================
-- 0010_order_local_id.sql
-- Per-panel sequential order numbers (1, 2, 3…) so customers/owners see a clean
-- "#1" instead of a UUID fragment. Mirrors services.local_id. Assigned by a
-- BEFORE INSERT trigger under a per-panel advisory lock (race-safe). Backfills
-- existing orders by creation time. Idempotent — safe to re-run.
-- Requires 0001 (orders table).
-- ============================================================================

alter table orders add column if not exists local_id integer;

-- Backfill existing rows: number each panel's orders by created_at.
with ranked as (
  select id, row_number() over (partition by panel_id order by created_at, id) as rn
  from orders
  where local_id is null
)
update orders o set local_id = r.rn
  from ranked r
 where o.id = r.id and o.local_id is null;

create index if not exists idx_orders_panel_local on orders (panel_id, local_id);

-- Assign the next per-panel number on insert. The advisory lock serializes
-- concurrent inserts for the SAME panel so two orders can't grab the same number.
create or replace function set_order_local_id()
returns trigger language plpgsql as $$
begin
  if new.local_id is null then
    perform pg_advisory_xact_lock(hashtext('order_local_id:' || new.panel_id::text));
    select coalesce(max(local_id), 0) + 1 into new.local_id from orders where panel_id = new.panel_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_local_id on orders;
create trigger trg_orders_local_id before insert on orders
  for each row execute function set_order_local_id();
