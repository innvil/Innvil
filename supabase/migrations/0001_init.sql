-- =============================================================================
-- Innvil — Phase 3 foundation schema
-- Multi-tenant, bring-your-own-provider SMM panel maker.
-- Every operational row is scoped to a panel; RLS (0002_rls.sql) enforces access.
-- Money is numeric(12,4); balances change ONLY via apply_balance_change().
-- Provider API keys are encrypted with pgcrypto and only ever decrypted
-- server-side (service role) via get_provider_key().
-- =============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums (idempotent — safe to re-run the whole migration)
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('super_admin', 'panel_owner', 'staff', 'customer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type panel_status as enum ('draft', 'live', 'inactive', 'suspended', 'maintenance');
exception when duplicate_object then null; end $$;
do $$ begin
  create type provider_status as enum ('active', 'paused');
exception when duplicate_object then null; end $$;
do $$ begin
  create type service_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type markup_type as enum ('percent', 'multiplier', 'fixed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type order_status as enum (
    'pending', 'processing', 'in_progress', 'partial',
    'completed', 'canceled', 'failed', 'refunded'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type customer_status as enum ('active', 'banned', 'restricted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type payment_status as enum ('pending', 'approved', 'rejected', 'completed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type ticket_status as enum ('open', 'answered', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type balance_tx_type as enum ('deposit', 'order', 'refund', 'manual_adjust');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Shared updated_at trigger
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — 1:1 with auth.users, holds the platform role
-- ----------------------------------------------------------------------------
create table profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         user_role not null default 'panel_owner',
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile row when a new auth user signs up.
-- The trigger lives on auth.users, which the SQL-editor role may not own — if
-- creating it fails (insufficient privilege), the migration continues and the
-- app upserts the profile on first login instead (see auth wiring). Guarded so
-- it can never abort the whole migration.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;
do $$ begin
  execute 'drop trigger if exists trg_auth_user_created on auth.users';
  execute 'create trigger trg_auth_user_created after insert on auth.users '
       || 'for each row execute function handle_new_user()';
exception
  when insufficient_privilege then
    raise notice 'Skipped auth.users trigger (no ownership). Profiles will be upserted from app code.';
  when others then
    raise notice 'Skipped auth.users trigger: %', sqlerrm;
end $$;

-- ----------------------------------------------------------------------------
-- panels
-- ----------------------------------------------------------------------------
create table panels (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles (id) on delete cascade,
  name          text not null,
  subdomain     text not null unique,
  custom_domain text unique,
  status        panel_status not null default 'draft',
  theme         text,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_panels_owner on panels (owner_id);
create trigger trg_panels_updated before update on panels
  for each row execute function set_updated_at();

-- panel_members — staff/manager roles for a panel (§10)
create table panel_members (
  panel_id    uuid not null references panels (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  role        text not null default 'staff',
  permissions jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  primary key (panel_id, user_id)
);

-- customer_accounts — panel-scoped end users (a Supabase auth user can hold a
-- customer account on many panels). Balance is a cached value; the source of
-- truth is the balance_transactions ledger.
create table customer_accounts (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  user_id      uuid not null references profiles (id) on delete cascade,
  status       customer_status not null default 'active',
  balance      numeric(12,4) not null default 0,
  api_key_hash text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (panel_id, user_id)
);
create index idx_customer_accounts_panel on customer_accounts (panel_id);
create trigger trg_customer_accounts_updated before update on customer_accounts
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- providers — bring-your-own SMM provider. api_key_enc is pgcrypto-encrypted
-- and never selected by the client (see 0002_rls.sql column revoke).
-- ----------------------------------------------------------------------------
create table providers (
  id                uuid primary key default gen_random_uuid(),
  panel_id          uuid not null references panels (id) on delete cascade,
  name              text not null,
  api_url           text not null,
  api_key_enc       bytea,               -- pgp_sym_encrypt(key, secret)
  status            provider_status not null default 'active',
  balance           numeric(12,4),
  currency          text not null default 'USD',
  last_balance_sync timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_providers_panel on providers (panel_id);
create trigger trg_providers_updated before update on providers
  for each row execute function set_updated_at();

create table provider_categories (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references panels (id) on delete cascade,
  provider_id uuid references providers (id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create index idx_provider_categories_panel on provider_categories (panel_id);

-- ----------------------------------------------------------------------------
-- services — imported from a provider, marked up for sale (§2/§3)
-- ----------------------------------------------------------------------------
create table services (
  id                  uuid primary key default gen_random_uuid(),
  panel_id            uuid not null references panels (id) on delete cascade,
  provider_id         uuid references providers (id) on delete set null,
  provider_service_id text,
  category_id         uuid references provider_categories (id) on delete set null,
  name                text not null,
  type                text,
  platform            text,
  provider_rate       numeric(12,4) not null default 0,   -- cost per 1000
  markup_kind         markup_type not null default 'percent',
  markup_value        numeric(12,4) not null default 0,
  sell_rate           numeric(12,4) not null default 0,    -- price per 1000
  min                 integer not null default 1,
  max                 integer not null default 1000000,
  description         text,
  status              service_status not null default 'active',
  sort_order          integer not null default 0,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index idx_services_panel on services (panel_id);
create index idx_services_provider on services (provider_id);
create trigger trg_services_updated before update on services
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- orders + status history (§4/§5)
-- ----------------------------------------------------------------------------
create table orders (
  id                uuid primary key default gen_random_uuid(),
  panel_id          uuid not null references panels (id) on delete cascade,
  customer_id       uuid not null references customer_accounts (id) on delete cascade,
  service_id        uuid references services (id) on delete set null,
  provider_id       uuid references providers (id) on delete set null,
  link              text not null,
  quantity          integer not null,
  charge            numeric(12,4) not null default 0,   -- what the customer paid
  provider_cost     numeric(12,4) not null default 0,   -- what the provider charged
  profit            numeric(12,4) not null default 0,
  provider_order_id text,
  status            order_status not null default 'pending',
  start_count       integer,
  remains           integer,
  provider_payload  jsonb,
  provider_response jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_orders_panel on orders (panel_id);
create index idx_orders_customer on orders (customer_id);
create index idx_orders_status on orders (panel_id, status);
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

create table order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders (id) on delete cascade,
  status     order_status not null,
  note       text,
  created_at timestamptz not null default now()
);
create index idx_order_status_history_order on order_status_history (order_id);

-- ----------------------------------------------------------------------------
-- balance_transactions — the ledger; source of truth for customer balance (§6)
-- ----------------------------------------------------------------------------
create table balance_transactions (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  customer_id  uuid not null references customer_accounts (id) on delete cascade,
  amount       numeric(12,4) not null,        -- signed: +credit / -debit
  type         balance_tx_type not null,
  reason       text,
  admin_id     uuid references profiles (id) on delete set null,
  ref_order_id uuid references orders (id) on delete set null,
  balance_after numeric(12,4) not null,
  created_at   timestamptz not null default now()
);
create index idx_balance_tx_customer on balance_transactions (customer_id);

-- ----------------------------------------------------------------------------
-- payments / deposits (§7)
-- ----------------------------------------------------------------------------
create table payments (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references panels (id) on delete cascade,
  customer_id uuid not null references customer_accounts (id) on delete cascade,
  method      text not null,
  amount      numeric(12,4) not null,
  currency    text not null default 'USD',
  status      payment_status not null default 'pending',
  gateway     text,
  gateway_ref text,
  approved_by uuid references profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_payments_panel on payments (panel_id);
create trigger trg_payments_updated before update on payments
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- support tickets + FAQ (§8)
-- ----------------------------------------------------------------------------
create table tickets (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references panels (id) on delete cascade,
  customer_id uuid not null references customer_accounts (id) on delete cascade,
  subject     text not null,
  status      ticket_status not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_tickets_panel on tickets (panel_id);
create trigger trg_tickets_updated before update on tickets
  for each row execute function set_updated_at();

create table ticket_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets (id) on delete cascade,
  sender_id  uuid references profiles (id) on delete set null,
  is_staff   boolean not null default false,
  body       text not null,
  created_at timestamptz not null default now()
);
create index idx_ticket_messages_ticket on ticket_messages (ticket_id);

create table faq (
  id         uuid primary key default gen_random_uuid(),
  panel_id   uuid not null references panels (id) on delete cascade,
  question   text not null,
  answer     text not null,
  category   text,
  sort_order integer not null default 0,
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_faq_panel on faq (panel_id);
create trigger trg_faq_updated before update on faq
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- audit_logs
-- ----------------------------------------------------------------------------
create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  panel_id   uuid references panels (id) on delete cascade,
  actor_id   uuid references profiles (id) on delete set null,
  action     text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_panel on audit_logs (panel_id);

-- ----------------------------------------------------------------------------
-- Provider key encryption (pgcrypto). The symmetric secret is supplied by the
-- server (env PROVIDER_KEY_SECRET) at call time — it is NEVER stored in the DB.
-- Both functions are SECURITY DEFINER and locked down to the service role in
-- 0002_rls.sql, so a compromised anon/authenticated client cannot call them.
-- ----------------------------------------------------------------------------
-- search_path includes `extensions` because Supabase installs pgcrypto there;
-- without it, pgp_sym_encrypt/decrypt would be unresolved at call time.
create or replace function set_provider_key(p_provider uuid, p_key text, p_secret text)
returns void language sql security definer set search_path = public, extensions as $$
  update providers
     set api_key_enc = pgp_sym_encrypt(p_key, p_secret)
   where id = p_provider;
$$;

create or replace function get_provider_key(p_provider uuid, p_secret text)
returns text language sql security definer set search_path = public, extensions as $$
  select pgp_sym_decrypt(api_key_enc, p_secret)
    from providers
   where id = p_provider;
$$;

-- ----------------------------------------------------------------------------
-- apply_balance_change — the ONLY way customer balance moves. Locks the
-- customer row, applies the signed amount, writes a ledger row with the
-- resulting balance_after, and returns it. Atomic.
-- ----------------------------------------------------------------------------
create or replace function apply_balance_change(
  p_customer   uuid,
  p_amount     numeric,
  p_type       balance_tx_type,
  p_reason     text default null,
  p_admin      uuid default null,
  p_ref_order  uuid default null
)
returns balance_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_panel   uuid;
  v_balance numeric(12,4);
  v_row     balance_transactions;
begin
  -- lock the customer row for the duration of the transaction
  select panel_id, balance into v_panel, v_balance
    from customer_accounts
   where id = p_customer
   for update;

  if v_panel is null then
    raise exception 'customer_account % not found', p_customer;
  end if;

  v_balance := v_balance + p_amount;
  if v_balance < 0 then
    raise exception 'insufficient balance';
  end if;

  update customer_accounts set balance = v_balance where id = p_customer;

  insert into balance_transactions
    (panel_id, customer_id, amount, type, reason, admin_id, ref_order_id, balance_after)
  values
    (v_panel, p_customer, p_amount, p_type, p_reason, p_admin, p_ref_order, v_balance)
  returning * into v_row;

  return v_row;
end;
$$;
