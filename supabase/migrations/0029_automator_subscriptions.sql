-- ============================================================================
-- 0029_automator_subscriptions.sql
-- Customer-facing Automator subscription ($6.99/mo, hard-coded). The customer pays
-- from their panel wallet; the amount is 100% the OWNER's revenue (charged as an
-- 'order'-type balance change — no provider payout — so it lands in owner earnings).
-- Requires 0001 (panels, customer_accounts, set_updated_at) and 0002 (is_panel_member,
-- is_super_admin). Idempotent.
-- ============================================================================

create table if not exists automator_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  panel_id       uuid not null references panels (id) on delete cascade,
  customer_id    uuid not null references customer_accounts (id) on delete cascade,
  active         boolean not null default false,
  since          timestamptz,
  last_charge_at timestamptz,
  next_charge_at timestamptz,
  -- true when a scheduled renewal failed for low wallet balance (paused until funded).
  lapsed         boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (panel_id, customer_id)
);
create index if not exists idx_automator_subs_panel on automator_subscriptions (panel_id);
create index if not exists idx_automator_subs_due on automator_subscriptions (next_charge_at) where active;

drop trigger if exists trg_automator_subs_updated on automator_subscriptions;
create trigger trg_automator_subs_updated before update on automator_subscriptions
  for each row execute function set_updated_at();

alter table automator_subscriptions enable row level security;

drop policy if exists automator_subs_access on automator_subscriptions;
create policy automator_subs_access on automator_subscriptions for all
  using (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  )
  with check (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  );
