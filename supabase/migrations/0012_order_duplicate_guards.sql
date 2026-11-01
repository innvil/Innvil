-- 0012_order_duplicate_guards.sql
-- Enforce duplicate prevention at DB level for active orders:
-- same customer + panel + normalized link + (service OR category).

begin;

-- Normalize links in one place so app and DB checks can converge.
create or replace function normalize_order_link(p_link text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_link, '')), '^https?://', ''),
        '^www\\.',
        ''
      ),
      '[?#].*$',
      ''
    ),
    '/+$',
    ''
  )
$$;

-- Snapshot service category at order-time so we can enforce link+category
-- also for older rows.
alter table orders
  add column if not exists service_category_id uuid references provider_categories (id) on delete set null;

update orders o
set service_category_id = s.category_id
from services s
where o.service_id = s.id
  and o.service_category_id is null;

-- Before creating unique indexes, park existing active duplicates as 'duplicate'
-- so index creation succeeds.
with ranked as (
  select
    o.id,
    row_number() over (
      partition by o.panel_id, o.customer_id, normalize_order_link(o.link), o.service_id
      order by o.created_at asc, o.id asc
    ) as rn
  from orders o
  where o.service_id is not null
    and o.status in ('pending', 'processing', 'in_progress', 'partial', 'completed')
), to_mark as (
  select id from ranked where rn > 1
)
update orders o
set
  status = 'duplicate',
  provider_response = coalesce(o.provider_response, '{}'::jsonb) || jsonb_build_object(
    'duplicate', true,
    'reason', 'Backfill: duplicate by link + service',
    'migration', '0012'
  )
from to_mark t
where o.id = t.id;

insert into order_status_history (order_id, status, note)
select o.id, 'duplicate', 'Backfill duplicate flag (migration 0012): same link + same service.'
from orders o
where o.status = 'duplicate'
  and not exists (
    select 1
    from order_status_history h
    where h.order_id = o.id
      and h.status = 'duplicate'
      and h.note like 'Backfill duplicate flag (migration 0012): same link + same service.%'
  );

with ranked as (
  select
    o.id,
    row_number() over (
      partition by o.panel_id, o.customer_id, normalize_order_link(o.link), o.service_category_id
      order by o.created_at asc, o.id asc
    ) as rn
  from orders o
  where o.service_category_id is not null
    and o.status in ('pending', 'processing', 'in_progress', 'partial', 'completed')
), to_mark as (
  select id from ranked where rn > 1
)
update orders o
set
  status = 'duplicate',
  provider_response = coalesce(o.provider_response, '{}'::jsonb) || jsonb_build_object(
    'duplicate', true,
    'reason', 'Backfill: duplicate by link + category',
    'migration', '0012'
  )
from to_mark t
where o.id = t.id;

insert into order_status_history (order_id, status, note)
select o.id, 'duplicate', 'Backfill duplicate flag (migration 0012): same link + same category.'
from orders o
where o.status = 'duplicate'
  and not exists (
    select 1
    from order_status_history h
    where h.order_id = o.id
      and h.status = 'duplicate'
      and h.note like 'Backfill duplicate flag (migration 0012): same link + same category.%'
  );

create unique index if not exists uq_orders_active_link_service
  on orders (panel_id, customer_id, normalize_order_link(link), service_id)
  where service_id is not null
    and status in ('pending', 'processing', 'in_progress', 'partial', 'completed');

create unique index if not exists uq_orders_active_link_category
  on orders (panel_id, customer_id, normalize_order_link(link), service_category_id)
  where service_category_id is not null
    and status in ('pending', 'processing', 'in_progress', 'partial', 'completed');

create index if not exists idx_orders_service_category
  on orders (service_category_id);

commit;
