-- BYO Enterprise usage POLICY (Phase 4.V) -- customer-owned, self-configured
-- ceilings on top of an already-stored BYO credential (0092/0093). A
-- genuinely SEPARATE concept from Innvil's own commercial plan config
-- (money.ts/product_entitlements) -- this never mutates either, and Innvil
-- never enforces its own limit here; it's the customer capping their OWN
-- provider spend.
--
-- Hierarchical: account-wide (community_id null) and per-Community (scoped
-- to the exact scope_key -- see below) -- the TIGHTEST configured limit
-- wins (resolved in watch-byo-usage-policy.ts, never here). Deployment/
-- Watcher-level granularity is deliberately NOT built this pass (documented
-- scope-down, matching Phase 2's own precedent for BYO telemetry) -- a
-- reasonable future refinement, not a silent gap.
--
-- Unit counted: REQUESTS per period (not tokens) -- the same pragmatic
-- scope decision already made for watch_byo_ai_usage_events (0093):
-- aiComplete()'s current return shape doesn't expose a real token count to
-- every caller, and fabricating one would be dishonest. "Messages per
-- period" and "requests per period" are the same thing here, since one
-- generated reply = one AI call.

create table if not exists watch_byo_usage_policies (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references profiles (id) on delete cascade,
  -- null = account-wide policy. Set = scoped to exactly one Community.
  community_id   uuid references communities (id) on delete cascade,
  period         text not null check (period in ('daily', 'monthly')),
  request_limit  int not null check (request_limit > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- At most ONE account-wide policy per account...
create unique index if not exists watch_byo_usage_policies_account_uidx
  on watch_byo_usage_policies (account_id)
  where community_id is null;

-- ...and at most ONE policy per (account, Community) pair.
create unique index if not exists watch_byo_usage_policies_community_uidx
  on watch_byo_usage_policies (account_id, community_id)
  where community_id is not null;

alter table watch_byo_usage_policies enable row level security;
-- No policies: service-role only (owner action layer + the runtime gate),
-- same convention as every other Watch config/runtime table.

-- The atomic per-scope-per-period counter. `scope_key` is NEVER null (the
-- literal string '__account__' stands in for the account-wide scope) so it
-- can safely be part of the primary key -- Postgres PK columns are
-- implicitly NOT NULL, and a nullable community_id couldn't have been used
-- directly here.
create table if not exists watch_byo_usage_counters (
  account_id     uuid not null references profiles (id) on delete cascade,
  scope_key      text not null,
  period_key     text not null,
  request_count  int not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (account_id, scope_key, period_key)
);

alter table watch_byo_usage_counters enable row level security;

-- Atomic upsert-and-increment -- mirrors increment_watch_ai_response_usage/
-- increment_community_reactive_quota's exact single-statement pattern, so
-- concurrent increments for the same scope+period can never lose a count.
create or replace function increment_watch_byo_usage(
  p_account_id uuid,
  p_scope_key text,
  p_period_key text
)
returns int
language sql
security definer
set search_path = public
as $$
  insert into watch_byo_usage_counters (account_id, scope_key, period_key, request_count, updated_at)
  values (p_account_id, p_scope_key, p_period_key, 1, now())
  on conflict (account_id, scope_key, period_key)
  do update set request_count = watch_byo_usage_counters.request_count + 1, updated_at = now()
  returning request_count;
$$;

revoke all on function increment_watch_byo_usage(uuid, text, text) from public;
grant execute on function increment_watch_byo_usage(uuid, text, text) to service_role;
