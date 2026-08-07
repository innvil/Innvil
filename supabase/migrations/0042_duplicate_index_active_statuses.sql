-- 0042_duplicate_index_active_statuses.sql
-- Align DB duplicate guard indexes with runtime logic.
-- Active duplicate blocking is pending/processing/in_progress only.

begin;

drop index if exists uq_orders_active_link_service;
create unique index uq_orders_active_link_service
  on orders (panel_id, customer_id, normalize_order_link(link), service_id)
  where service_id is not null
    and status in ('pending', 'processing', 'in_progress');

drop index if exists uq_orders_active_link_category;
create unique index uq_orders_active_link_category
  on orders (panel_id, customer_id, normalize_order_link(link), service_category_id)
  where service_category_id is not null
    and status in ('pending', 'processing', 'in_progress');

commit;
