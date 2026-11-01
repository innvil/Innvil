-- ============================================================================
-- 0018_platform_settings.sql
-- A tiny key/value store for platform-wide (super-admin) settings. First use:
-- the landing-page walkthrough video URL the super admin sets, which the public
-- Innvil landing renders in its "See how it works" slot.
-- Writes are super-admin only; reads for public-facing values go through the
-- service-role server actions. Idempotent — safe to re-run.
-- Requires 0002 (is_super_admin) and 0001 (set_updated_at).
-- ============================================================================

create table if not exists platform_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_platform_settings_updated on platform_settings;
create trigger trg_platform_settings_updated before update on platform_settings
  for each row execute function set_updated_at();

alter table platform_settings enable row level security;

-- Super admins manage settings directly; everything else reads via service role.
drop policy if exists platform_settings_super on platform_settings;
create policy platform_settings_super on platform_settings for all
  using (is_super_admin()) with check (is_super_admin());
