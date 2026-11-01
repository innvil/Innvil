-- ============================================================================
-- 0022_owner_business_profile.sql
-- Per-owner business details that appear on the owner's earnings receipts
-- (legal name, address, registrant, business/registration number, tax id, …).
-- Owners edit these manually or auto-fill them from an uploaded registration
-- document (OCR happens client-side; the document itself is NOT stored).
-- Requires 0001 (profiles, set_updated_at). Idempotent — safe to re-run.
-- ============================================================================

create table if not exists owner_business_profiles (
  owner_id        uuid primary key references profiles (id) on delete cascade,
  legal_name      text,
  address         text,
  registrant      text,
  business_number text,
  tax_id          text,
  email           text,
  phone           text,
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_owner_business_profiles_updated on owner_business_profiles;
create trigger trg_owner_business_profiles_updated before update on owner_business_profiles
  for each row execute function set_updated_at();

alter table owner_business_profiles enable row level security;

drop policy if exists owner_business_profiles_own on owner_business_profiles;
create policy owner_business_profiles_own on owner_business_profiles for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
