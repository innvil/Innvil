-- -----------------------------------------------------------------------------
-- 0041 — Superadmin payment-history visibility archive
-- Visibility-only archive metadata for payment-history surfaces.
-- Does NOT modify payment status/amount, wallet balances, ledger rows, Binance IDs,
-- reconciliation data, or duplicate-prevention records.
-- -----------------------------------------------------------------------------

alter table payments
  add column if not exists superadmin_hidden_at timestamptz,
  add column if not exists superadmin_hidden_by uuid,
  add column if not exists superadmin_hidden_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payments_superadmin_hidden_by_fkey'
  ) then
    alter table payments
      add constraint payments_superadmin_hidden_by_fkey
      foreign key (superadmin_hidden_by)
      references profiles (id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_payments_visible_history
  on payments (panel_id, customer_id, created_at desc)
  where superadmin_hidden_at is null;

create index if not exists idx_payments_archived_at
  on payments (superadmin_hidden_at desc)
  where superadmin_hidden_at is not null;

create index if not exists idx_payments_archived_by
  on payments (superadmin_hidden_by)
  where superadmin_hidden_at is not null;

-- Storefront snapshot rebuild must hide archived payments from customer history.
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
      and superadmin_hidden_at is null
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
