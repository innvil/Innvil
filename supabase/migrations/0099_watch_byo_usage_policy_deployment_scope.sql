-- BYO Enterprise usage POLICY -- real 3-level hierarchy (Phase 4.V.1, item 2
-- off the honest deferred list): account -> Community -> Watcher/Deployment,
-- tightest configured ceiling wins. Extends 0096 (account+Community) and
-- 0098 (reactive/proactive kind split) with a genuine per-deployment scope,
-- so a customer can cap one specific Watcher's own BYO spend independently
-- of its Community or the whole account.
--
-- A policy row is scoped to EXACTLY ONE of {account-wide, Community,
-- deployment} -- never Community AND deployment together (there's no
-- meaningful "this Community, but only for this Watcher" combination in a
-- single row; a deployment-scoped policy already implies its own Community
-- by construction, via moderator_deployments.community_id).
--
-- SCOPE-KEY FORMAT CHANGE: counters now use an explicit, unambiguous
-- prefix per scope kind ('account:__' / 'community:<id>' / 'deployment:<id>')
-- instead of a bare id, so a community id and a deployment id (both real
-- UUIDs from different tables) can never collide in this shared column even
-- in principle, not just by UUID-collision improbability. This table has no
-- real production usage yet (a days-old feature, confirmed via the live
-- Supabase project before this migration was written) -- any already-accrued
-- counter under the OLD bare-id format is intentionally left unmigrated
-- (negligible, and a fresh period starts at 0 regardless).

alter table watch_byo_usage_policies
  add column if not exists deployment_id uuid references moderator_deployments (id) on delete cascade;

alter table watch_byo_usage_policies
  add constraint watch_byo_usage_policies_scope_check
  check (community_id is null or deployment_id is null);

drop index if exists watch_byo_usage_policies_account_uidx;
drop index if exists watch_byo_usage_policies_community_uidx;

-- Account-wide: no Community, no deployment.
create unique index if not exists watch_byo_usage_policies_account_uidx
  on watch_byo_usage_policies (account_id, kind)
  where community_id is null and deployment_id is null;

-- Community-scoped: a Community, no deployment.
create unique index if not exists watch_byo_usage_policies_community_uidx
  on watch_byo_usage_policies (account_id, community_id, kind)
  where community_id is not null and deployment_id is null;

-- Deployment-scoped: NEW -- one Watcher's own deployment.
create unique index if not exists watch_byo_usage_policies_deployment_uidx
  on watch_byo_usage_policies (account_id, deployment_id, kind)
  where deployment_id is not null;

alter table watch_byo_usage_counters
  add column if not exists deployment_id uuid references moderator_deployments (id) on delete cascade;

-- The counter's identity is still the single scope_key text column (never a
-- second key column) -- callers now format it as 'account:__'/'community:<id>'/
-- 'deployment:<id>' (watch-byo-usage-policy.ts's scopeKeyFor). deployment_id
-- itself is kept as a plain denormalized attribute (not part of the PK) for
-- readability when inspecting the table directly -- scope_key remains the
-- real uniqueness/lookup key, unchanged shape from 0096/0098.

create or replace function increment_watch_byo_usage(
  p_account_id uuid,
  p_scope_key text,
  p_period_key text,
  p_kind text default 'reactive',
  p_deployment_id uuid default null
)
returns int
language sql
security definer
set search_path = public
as $$
  insert into watch_byo_usage_counters (account_id, scope_key, kind, period_key, deployment_id, request_count, updated_at)
  values (p_account_id, p_scope_key, p_kind, p_period_key, p_deployment_id, 1, now())
  on conflict (account_id, scope_key, kind, period_key)
  do update set request_count = watch_byo_usage_counters.request_count + 1, updated_at = now()
  returning request_count;
$$;

revoke all on function increment_watch_byo_usage(uuid, text, text, text, uuid) from public;
grant execute on function increment_watch_byo_usage(uuid, text, text, text, uuid) to service_role;

-- Drop the old (pre-deployment-scope) 4-arg overload -- a distinct signature
-- in Postgres, would otherwise be left stale alongside the new 5-arg one.
drop function if exists increment_watch_byo_usage(uuid, text, text, text);
