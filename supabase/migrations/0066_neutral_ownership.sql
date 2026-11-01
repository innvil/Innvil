-- 0066_neutral_ownership.sql
--
-- Phase 4.T continued: corrects the resource-ownership model so Watch is no
-- longer architecturally underneath Panel/Forge. Additive/backfill only --
-- no destructive drops, `projects.panel_id` stays intact for legacy
-- compatibility.
--
-- NEUTRAL OWNER: reuses the EXISTING account concept (`profiles.id`, the
-- authenticated Innvil user) rather than inventing a new organizations/
-- workspaces table -- `panels.owner_id` already references `profiles(id)`,
-- so the "Innvil Account" the architecture doc asks for already exists; it
-- was simply never referenced from `projects` directly. This is the
-- smallest coherent neutral owner, per the explicit "do not create a new
-- system just because the names sound cleaner" instruction.

begin;

-- ---------------------------------------------------------- neutral owner ----

alter table projects add column if not exists account_id uuid references profiles (id) on delete cascade;

-- Backfill deterministically from the EXISTING, unambiguous Panel -> owner
-- relationship. panels.owner_id is NOT NULL (migration 0001), so every
-- legacy project with a panel_id resolves to exactly one account -- no
-- guessing, no default/random owner.
update projects p
set account_id = panels.owner_id
from panels
where p.panel_id = panels.id
  and p.account_id is null;

-- Every legacy row is now backfilled (panel_id was NOT NULL on every
-- existing project, and every panel has an owner). Going forward, panel_id
-- becomes OPTIONAL (a Watch-only project has none) while account_id is the
-- one thing every project must always have.
alter table projects alter column account_id set not null;
alter table projects alter column panel_id drop not null;

create index if not exists idx_projects_account on projects (account_id);

-- Consistency guard: if a project has BOTH an account_id and a panel_id,
-- they must refer to the same tenant (panels.owner_id = projects.account_id).
-- Implemented as a trigger (not a CHECK) since it requires a cross-table
-- lookup -- prevents the exact "project.account_id = Account A,
-- project.panel_id = Panel owned by Account B" ambiguity the architecture
-- doc explicitly calls out.
create or replace function validate_project_owner_consistency()
returns trigger
language plpgsql
as $$
declare
  panel_owner uuid;
begin
  if new.panel_id is not null then
    select owner_id into panel_owner from panels where id = new.panel_id;
    if panel_owner is null then
      raise exception 'validate_project_owner_consistency: panel % not found', new.panel_id;
    end if;
    if panel_owner <> new.account_id then
      raise exception 'validate_project_owner_consistency: project.account_id (%) does not match panels.owner_id (%) for panel %', new.account_id, panel_owner, new.panel_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_projects_owner_consistency on projects;
create trigger trg_projects_owner_consistency
  before insert or update on projects
  for each row execute function validate_project_owner_consistency();

-- ------------------------------------------------- generic product entitlement ----

-- Answers "does this account own/have access to this official Innvil
-- product?" -- deliberately generic (works identically for Forge/Watch/
-- Herald/future products), and deliberately NOT a second billing system:
-- product-specific plan/subscription/pricing logic stays entirely in that
-- product's own existing tables (Watch's stays in panels.settings /
-- customer_moderator_entitlement, completely untouched by this migration).
-- This table only answers the yes/no ownership question at the account
-- level; a `subscription_ref` column lets it POINT at product-specific
-- billing state without duplicating it.
create table if not exists product_entitlements (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references profiles (id) on delete cascade,
  product_id       uuid not null references products (id) on delete cascade,
  status           text not null default 'active' check (status in ('active', 'trial', 'inactive', 'cancelled')),
  subscription_ref text,                              -- optional pointer to product-specific billing/plan state; never a second source of truth
  activated_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (account_id, product_id)
);
create index if not exists idx_product_entitlements_account on product_entitlements (account_id);
create index if not exists idx_product_entitlements_product on product_entitlements (product_id);

drop trigger if exists trg_product_entitlements_updated on product_entitlements;
create trigger trg_product_entitlements_updated
  before update on product_entitlements
  for each row execute function set_updated_at();

alter table product_entitlements enable row level security;
-- No policies: service-role only (server actions enforce ownership in code,
-- same convention as every other tenant-scoped table in this schema).

commit;
