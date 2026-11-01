-- ============================================================================
-- 0030_automation_profiles.sql
-- Customer automation profile (v2): per (panel, customer), the keyword→service→qty
-- slots the customer configures. Fired by the campaign fan-out. Replaces the owner
-- preset model (campaign_service_presets from 0028 is now unused).
-- Requires 0001 (panels, customer_accounts, set_updated_at) and 0002 helpers. Idempotent.
-- ============================================================================

create table if not exists automation_profiles (
  id          uuid primary key default gen_random_uuid(),
  panel_id    uuid not null references panels (id) on delete cascade,
  customer_id uuid not null references customer_accounts (id) on delete cascade,
  config      jsonb not null default '{"platforms":{}}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (panel_id, customer_id)
);
create index if not exists idx_automation_profiles_panel on automation_profiles (panel_id);

drop trigger if exists trg_automation_profiles_updated on automation_profiles;
create trigger trg_automation_profiles_updated before update on automation_profiles
  for each row execute function set_updated_at();

alter table automation_profiles enable row level security;

drop policy if exists automation_profiles_access on automation_profiles;
create policy automation_profiles_access on automation_profiles for all
  using (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  )
  with check (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  );
