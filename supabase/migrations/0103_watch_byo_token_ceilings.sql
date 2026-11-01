-- BYO Enterprise usage POLICY -- token-based ceilings (Phase 4.V.1, item 1
-- off the honest deferred list, closed 2026-08-25 once aiComplete() gained a
-- real per-call token-count return path -- see src/lib/ai/client.ts's new
-- aiCompleteWithMeta()). A REQUEST limit and a TOKEN limit are independent,
-- optional dimensions of the SAME policy row (scope + kind + period, from
-- 0096/0098/0099) -- a customer may configure either, both, or neither; the
-- gate blocks if EITHER a configured request limit OR a configured token
-- limit is exhausted for its own current period. Never a separate/parallel
-- policy row, and never a new scope/kind axis -- this widens the existing
-- one, matching the shape a customer already understands (one ceiling per
-- scope, now with two optional dimensions instead of one).
--
-- Anthropic's real usage.input_tokens + usage.output_tokens (and DeepSeek's
-- OpenAI-compatible usage.prompt_tokens/completion_tokens) are now genuinely
-- observable per call -- token_limit counts INPUT + OUTPUT combined (the
-- customer's real total spend driver), never estimated/fabricated. A call
-- whose provider response didn't report usage (should not happen for either
-- real supported provider, but never assumed) increments used_tokens by 0,
-- never guessed.

alter table watch_byo_usage_policies
  add column if not exists token_limit int check (token_limit is null or token_limit > 0);

alter table watch_byo_usage_counters
  add column if not exists used_tokens int not null default 0;

create or replace function increment_watch_byo_usage(
  p_account_id uuid,
  p_scope_key text,
  p_period_key text,
  p_kind text default 'reactive',
  p_deployment_id uuid default null,
  p_tokens int default 0
)
returns table (request_count int, used_tokens int)
language sql
security definer
set search_path = public
as $$
  insert into watch_byo_usage_counters (account_id, scope_key, kind, period_key, deployment_id, request_count, used_tokens, updated_at)
  values (p_account_id, p_scope_key, p_kind, p_period_key, p_deployment_id, 1, greatest(coalesce(p_tokens, 0), 0), now())
  on conflict (account_id, scope_key, kind, period_key)
  do update set
    request_count = watch_byo_usage_counters.request_count + 1,
    used_tokens = watch_byo_usage_counters.used_tokens + greatest(coalesce(p_tokens, 0), 0),
    updated_at = now()
  returning request_count, used_tokens;
$$;

revoke all on function increment_watch_byo_usage(uuid, text, text, text, uuid, int) from public;
grant execute on function increment_watch_byo_usage(uuid, text, text, text, uuid, int) to service_role;

-- Drop the old (pre-token-ceiling) 5-arg overload, and its return-type-only
-- predecessor -- a distinct signature/return type in Postgres, would
-- otherwise be left stale alongside the new one.
drop function if exists increment_watch_byo_usage(uuid, text, text, text, uuid);
