-- ============================================================================
-- 0044_moderator_trial.sql
-- Innvil Virtual Moderator — free trial eligibility, tracked PER OWNER ACCOUNT
-- (not per panel). An owner who has already used their Virtual Moderator trial
-- on one panel must not get a fresh trial by creating another panel — every
-- other add-on in this repo (Campaign Automation, AI support) is subscribed
-- per panel, but trial abuse resistance specifically needs the account-level
-- unit, per product decision. One row per owner, ever.
-- Requires 0001 (profiles), 0043 (virtual_moderators, moderator_deployments).
-- ============================================================================

create table if not exists moderator_trial_usage (
  owner_id             uuid primary key references profiles (id) on delete cascade,
  panel_id             uuid references panels (id) on delete set null,
  virtual_moderator_id uuid references virtual_moderators (id) on delete set null,
  deployment_id        uuid references moderator_deployments (id) on delete set null,
  started_at           timestamptz not null default now(),
  ends_at              timestamptz not null
);

alter table moderator_trial_usage enable row level security;

drop policy if exists moderator_trial_usage_owner on moderator_trial_usage;
create policy moderator_trial_usage_owner on moderator_trial_usage for select
  using (owner_id = auth.uid() or is_super_admin());
-- Inserts/updates happen exclusively through service-role server actions
-- (trial activation must be idempotent and race-safe — see moderator/plan.ts),
-- so there is intentionally no client-writable policy here.
