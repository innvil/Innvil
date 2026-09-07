-- ============================================================================
-- 0016_platform_deposits.sql
-- Owner → Innvil top-ups: a panel owner pays Innvil (via the super-admin's
-- Cryptomus/NOWPayments platform gateways) to fund a panel's Innvil balance
-- (panels.settings.innvil_balance), which the 5% commission is drawn from.
-- The webhook credits the balance atomically. Idempotent — safe to re-run.
-- Requires 0001 (set_updated_at) and 0002 (is_super_admin).
-- ============================================================================

create table if not exists platform_deposits (
  id            uuid primary key default gen_random_uuid(),
  panel_id      uuid not null references panels (id) on delete cascade,
  owner_id      uuid not null,
  gateway       text not null,                 -- 'cryptomus' | 'nowpayments'
  paid_amount   numeric(14,4) not null,        -- what the owner pays
  credit_amount numeric(14,4) not null,        -- what gets credited (paid + promo bonus)
  currency      text not null default 'USD',
  status        text not null default 'pending', -- pending | completed
  gateway_ref   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_platform_deposits_panel on platform_deposits (panel_id);
create index if not exists idx_platform_deposits_owner on platform_deposits (owner_id);

drop trigger if exists trg_platform_deposits_updated on platform_deposits;
create trigger trg_platform_deposits_updated before update on platform_deposits
  for each row execute function set_updated_at();

-- Atomic credit of a panel's Innvil balance (row-level update; no read-modify-write race).
create or replace function credit_panel_innvil_balance(p_panel uuid, p_amount numeric)
returns numeric language sql security definer set search_path = public as $$
  update panels
     set settings = jsonb_set(
       coalesce(settings, '{}'::jsonb),
       '{innvil_balance}',
       to_jsonb(round(coalesce((settings->>'innvil_balance')::numeric, 0) + p_amount, 4))
     )
   where id = p_panel
  returning (settings->>'innvil_balance')::numeric;
$$;

-- RLS: owner reads own deposits; the crediting path uses the service role.
alter table platform_deposits enable row level security;
drop policy if exists platform_deposits_owner on platform_deposits;
create policy platform_deposits_owner on platform_deposits for select
  using (owner_id = auth.uid() or is_super_admin());

revoke all on function credit_panel_innvil_balance(uuid, numeric) from anon, authenticated;
grant execute on function credit_panel_innvil_balance(uuid, numeric) to service_role;
