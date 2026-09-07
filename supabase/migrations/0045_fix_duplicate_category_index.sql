-- 0045_fix_duplicate_category_index.sql
-- Fix: uq_orders_active_link_category blocked ANY two active orders sharing
-- the same link + category, even with DIFFERENT service_id. That's wrong —
-- duplicate identity must be link + category + service_id, so ordering a
-- different service under the same category for the same link is allowed
-- (e.g. 1000 Twitter Followers + 500 Twitter Views on the same post, both
-- "twitter" category, must both be orderable). uq_orders_active_link_service
-- already enforces the real "same service ordered twice" rule; this index
-- was strictly over-broad on top of it.
--
-- Active-order predicate (pending/processing/in_progress) preserved exactly
-- as-is from 0042 — completed/canceled/failed/refunded/duplicate orders are
-- intentionally NOT blocking, unchanged.

begin;

-- Safety check: the new index's key (link, category, service_id) is a
-- superset of uq_orders_active_link_service's key (link, service_id), and
-- service_category_id is a deterministic snapshot of a service's category —
-- so no row can violate the new constraint that doesn't already violate the
-- existing service-level one (which already holds). This should always find
-- zero rows; abort loudly instead of silently creating a broken index if not.
do $$
declare
  violation_count integer;
begin
  select count(*) into violation_count
  from (
    select panel_id, customer_id, normalize_order_link(link), service_category_id, service_id
    from orders
    where service_category_id is not null
      and service_id is not null
      and status in ('pending', 'processing', 'in_progress')
    group by panel_id, customer_id, normalize_order_link(link), service_category_id, service_id
    having count(*) > 1
  ) dupes;

  if violation_count > 0 then
    raise exception 'Cannot create uq_orders_active_link_category_service: % existing row group(s) would violate it. Resolve manually first.', violation_count;
  end if;
end $$;

drop index if exists uq_orders_active_link_category;

create unique index uq_orders_active_link_category_service
  on orders (panel_id, customer_id, normalize_order_link(link), service_category_id, service_id)
  where service_category_id is not null
    and service_id is not null
    and status in ('pending', 'processing', 'in_progress');

commit;
