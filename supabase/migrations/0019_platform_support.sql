-- ============================================================================
-- 0019_platform_support.sql
-- Owner → Innvil support. Panel owners send support messages to the platform;
-- the super admin reads/resolves them in /superadmin and gets an email copy at
-- the configured support address (platform_settings.support_email) or, failing
-- that, the super-admin account email(s). Idempotent — safe to re-run.
-- Requires 0001 (profiles, set_updated_at) and 0002 (is_super_admin).
-- ============================================================================

create table if not exists platform_support_messages (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles (id) on delete cascade,
  owner_email text,
  subject     text not null,
  body        text not null,
  status      text not null default 'open',   -- open | resolved
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_platform_support_owner on platform_support_messages (owner_id);
create index if not exists idx_platform_support_status on platform_support_messages (status, created_at desc);

drop trigger if exists trg_platform_support_updated on platform_support_messages;
create trigger trg_platform_support_updated before update on platform_support_messages
  for each row execute function set_updated_at();

alter table platform_support_messages enable row level security;

drop policy if exists platform_support_owner_ins on platform_support_messages;
create policy platform_support_owner_ins on platform_support_messages for insert
  with check (owner_id = auth.uid());

drop policy if exists platform_support_read on platform_support_messages;
create policy platform_support_read on platform_support_messages for select
  using (owner_id = auth.uid() or is_super_admin());

drop policy if exists platform_support_super_upd on platform_support_messages;
create policy platform_support_super_upd on platform_support_messages for update
  using (is_super_admin()) with check (is_super_admin());
