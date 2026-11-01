-- =============================================================================
-- Storefront snapshot cache (panel <-> storefront shared backend state)
-- Purpose: provide a fast, server-backed snapshot for customer dashboard hydrate
-- without depending on client/server cookie timing races.
-- =============================================================================

create table if not exists storefront_customer_snapshots (
  customer_id uuid primary key references customer_accounts (id) on delete cascade,
  panel_id uuid not null references panels (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  balance numeric(12,4) not null default 0,
  deposits jsonb not null default '[]'::jsonb,
  orders jsonb not null default '[]'::jsonb,
  api_enabled boolean not null default true,
  api_has_key boolean not null default false,
  account_status customer_status not null default 'active',
  panel_status panel_status not null default 'draft',
  updated_at timestamptz not null default now()
);

create index if not exists idx_storefront_snapshots_panel_user
  on storefront_customer_snapshots (panel_id, user_id);

create index if not exists idx_storefront_snapshots_updated
  on storefront_customer_snapshots (updated_at desc);

create or replace function rebuild_storefront_snapshot(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ca record;
  v_deposits jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_api_enabled boolean := true;
begin
  select
    id,
    panel_id,
    user_id,
    status,
    balance,
    api_key_hash
  into ca
  from customer_accounts
  where id = p_customer;

  if not found then
    delete from storefront_customer_snapshots where customer_id = p_customer;
    return;
  end if;

  select coalesce(((p.settings -> 'customerApi' ->> 'enabled')::boolean), true)
  into v_api_enabled
  from panels p
  where p.id = ca.panel_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'amount', p.amount,
        'currency', p.currency,
        'status', p.status,
        'method', p.method,
        'createdAt', p.created_at
      )
      order by p.created_at desc
    ),
    '[]'::jsonb
  )
  into v_deposits
  from (
    select id, amount, currency, status, method, created_at
    from payments
    where customer_id = ca.id
    order by created_at desc
    limit 50
  ) p;

  select coalesce(
    jsonb_agg(o.obj order by o.created_at desc),
    '[]'::jsonb
  )
  into v_orders
  from (
    select
      ord.created_at,
      jsonb_build_object(
        'id', ord.id,
        'localId', coalesce(ord.local_id::text, left(ord.id::text, 8)),
        'serviceId', ord.service_id,
        'serviceNo', svc.local_id,
        'serviceName', coalesce(svc.name, 'Service'),
        'link', ord.link,
        'quantity', ord.quantity,
        'charge', ord.charge,
        'status', case
          when coalesce((ord.provider_response ->> 'held')::boolean, false) and ord.status = 'pending' then 'processing'
          else ord.status::text
        end,
        'createdAt', ord.created_at,
        'failReason', case
          when ord.status in ('failed', 'canceled', 'refunded') then coalesce(ord.provider_response ->> 'error', null)
          else null
        end,
        'comments', case
          when jsonb_typeof(ord.provider_payload -> 'comments') = 'array' then ord.provider_payload -> 'comments'
          else null
        end,
        'held', coalesce((ord.provider_response ->> 'held')::boolean, false)
      ) as obj
    from orders ord
    left join services svc on svc.id = ord.service_id
    where ord.customer_id = ca.id
    order by ord.created_at desc
    limit 200
  ) o;

  insert into storefront_customer_snapshots (
    customer_id,
    panel_id,
    user_id,
    balance,
    deposits,
    orders,
    api_enabled,
    api_has_key,
    account_status,
    panel_status,
    updated_at
  )
  select
    ca.id,
    ca.panel_id,
    ca.user_id,
    ca.balance,
    v_deposits,
    v_orders,
    v_api_enabled,
    (ca.api_key_hash is not null),
    ca.status,
    p.status,
    now()
  from panels p
  where p.id = ca.panel_id
  on conflict (customer_id)
  do update
  set
    panel_id = excluded.panel_id,
    user_id = excluded.user_id,
    balance = excluded.balance,
    deposits = excluded.deposits,
    orders = excluded.orders,
    api_enabled = excluded.api_enabled,
    api_has_key = excluded.api_has_key,
    account_status = excluded.account_status,
    panel_status = excluded.panel_status,
    updated_at = now();
end;
$$;

create or replace function trg_rebuild_storefront_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform rebuild_storefront_snapshot(coalesce(new.customer_id, old.customer_id));
  return null;
end;
$$;

create or replace function trg_rebuild_storefront_snapshot_customer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform rebuild_storefront_snapshot(coalesce(new.id, old.id));
  return null;
end;
$$;

drop trigger if exists trg_storefront_snapshot_on_customer_accounts on customer_accounts;
create trigger trg_storefront_snapshot_on_customer_accounts
after insert or update or delete on customer_accounts
for each row execute function trg_rebuild_storefront_snapshot_customer();

drop trigger if exists trg_storefront_snapshot_on_orders on orders;
create trigger trg_storefront_snapshot_on_orders
after insert or update or delete on orders
for each row execute function trg_rebuild_storefront_snapshot();

drop trigger if exists trg_storefront_snapshot_on_payments on payments;
create trigger trg_storefront_snapshot_on_payments
after insert or update or delete on payments
for each row execute function trg_rebuild_storefront_snapshot();

-- backfill for existing customer accounts
insert into storefront_customer_snapshots (customer_id, panel_id, user_id)
select id, panel_id, user_id
from customer_accounts
on conflict (customer_id) do nothing;

do $$
declare
  r record;
begin
  for r in select id from customer_accounts loop
    perform rebuild_storefront_snapshot(r.id);
  end loop;
end;
$$;

alter table storefront_customer_snapshots enable row level security;

drop policy if exists storefront_snapshot_customer_read on storefront_customer_snapshots;
create policy storefront_snapshot_customer_read
on storefront_customer_snapshots
for select
using (user_id = auth.uid());

drop policy if exists storefront_snapshot_admin_read on storefront_customer_snapshots;
create policy storefront_snapshot_admin_read
on storefront_customer_snapshots
for select
using (is_panel_member(panel_id) or is_super_admin());
