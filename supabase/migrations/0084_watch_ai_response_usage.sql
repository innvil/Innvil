-- 0084_watch_ai_response_usage.sql
-- Real per-account monthly (current subscription period) usage tracking
-- for the pooled AI-generated CONVERSATIONAL response allowance
-- (MODERATOR_AI_RESPONSE_POOL, money.ts) -- that constant existed since the
-- v1.13.0 pricing revision but was explicitly documented as "not yet
-- enforced (no usage counter exists)". This is that counter.
--
-- Scoped to direct-Watch accounts only (account_id, no panel_id) --
-- MODERATOR_AI_RESPONSE_POOL is read by the Usage page (app/usage/page.tsx),
-- which is itself a Watch-only, zero-Panel route; the legacy Panel-
-- distributed Virtual Moderator system has its own separate commercial
-- model and is NOT touched by this migration.
--
-- Keyed by (account_id, period_start) -- one row per real subscription
-- period (product_entitlements.current_period_start/end, monthly or
-- annual), never a calendar month. A period rollover (renewal) naturally
-- gets a fresh row with count 0 -- no reset logic needed anywhere.

create table if not exists watch_ai_response_usage (
  account_id      uuid not null,
  period_start    timestamptz not null,
  period_end      timestamptz not null,
  response_count  integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (account_id, period_start)
);
create index if not exists idx_watch_ai_response_usage_account on watch_ai_response_usage (account_id);

alter table watch_ai_response_usage enable row level security;
-- No policies: service-role only (runtime), same convention as every other
-- Watch runtime-state table (community_reactive_quota, deployment_state).

-- Atomic upsert-and-increment -- avoids a read-then-write race between
-- concurrent responders (e.g. a multi-Watcher "@everyone" fan-out) or
-- retried webhook deliveries. Only ever called AFTER a conversational AI
-- response has actually been sent successfully.
create or replace function increment_watch_ai_response_usage(
  p_account_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into watch_ai_response_usage (account_id, period_start, period_end, response_count)
  values (p_account_id, p_period_start, p_period_end, 1)
  on conflict (account_id, period_start)
  do update set response_count = watch_ai_response_usage.response_count + 1,
                updated_at = now()
  returning response_count;
$$;

revoke all on function increment_watch_ai_response_usage(uuid, timestamptz, timestamptz) from anon, authenticated;
grant execute on function increment_watch_ai_response_usage(uuid, timestamptz, timestamptz) to service_role;
