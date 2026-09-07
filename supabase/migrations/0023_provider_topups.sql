-- ============================================================================
-- 0023_provider_topups.sql
-- Auto-tracked provider top-ups. Innvil already pulls provider balances via the
-- API; when a provider's balance INCREASES between syncs, the owner funded it, so
-- fetchProviderBalance() records the increase here (delta). Only increases AFTER
-- the first observation are tracked (pre-Innvil balances are the baseline).
-- Powers the Provider-balances "top-up tracker": totals per week/bi-week/month +
-- a downloadable internal cost record (to weigh against earnings). provider_name
-- is snapshotted so records survive provider deletion. Requires 0001. Idempotent.
-- ============================================================================

create table if not exists provider_topups (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles (id) on delete cascade,
  provider_id   uuid references providers (id) on delete set null,
  provider_name text not null,
  amount        numeric(14,4) not null,
  currency      text not null default 'USD',
  note          text,
  topped_up_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_provider_topups_owner on provider_topups (owner_id, topped_up_at desc);

alter table provider_topups enable row level security;
drop policy if exists provider_topups_own on provider_topups;
create policy provider_topups_own on provider_topups for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
