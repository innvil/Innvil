-- Real per-account monthly (current subscription period) usage tracking
-- for the self-serve Media Moderation + add-on (MODERATOR_MEDIA_ADDON,
-- money.ts) -- mirrors 0084's watch_ai_response_usage exactly in shape,
-- since both are "real usage against a real monthly allowance, scoped to
-- the account's real current subscription period" concepts.
--
-- Unlike the AI Generation pool (always increments by exactly 1),
-- Media Moderation Units can increment by a VARIABLE amount per call --
-- 1 for a classified photo, or N for a video's N actually-classified
-- sampled frames -- so the RPC takes an explicit p_units parameter.
--
-- Scoped to direct-Watch accounts only (account_id, no panel_id) -- this
-- gate only ever applies to a real self-serve paidTier (see
-- community-runtime.ts's runMediaModeration); trial/enterprise/legacy
-- Panel-distributed accounts are never gated or metered by this table.
--
-- Keyed by (account_id, period_start) -- one row per real subscription
-- period, never a calendar month. A renewal naturally gets a fresh row at 0.

create table if not exists watch_media_moderation_usage (
  account_id    uuid not null,
  period_start  timestamptz not null,
  period_end    timestamptz not null,
  unit_count    integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (account_id, period_start)
);
create index if not exists idx_watch_media_moderation_usage_account on watch_media_moderation_usage (account_id);

alter table watch_media_moderation_usage enable row level security;
-- No policies: service-role only (runtime), same convention as
-- watch_ai_response_usage and every other Watch runtime-state table.

-- Atomic upsert-and-increment-by-N -- avoids a read-then-write race, and
-- lets one call cover an entire video's worth of sampled-frame units in a
-- single round trip rather than N separate increments.
create or replace function increment_watch_media_moderation_usage(
  p_account_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_units integer
)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into watch_media_moderation_usage (account_id, period_start, period_end, unit_count)
  values (p_account_id, p_period_start, p_period_end, p_units)
  on conflict (account_id, period_start)
  do update set unit_count = watch_media_moderation_usage.unit_count + p_units,
                updated_at = now()
  returning unit_count;
$$;

revoke all on function increment_watch_media_moderation_usage(uuid, timestamptz, timestamptz, integer) from anon, authenticated;
grant execute on function increment_watch_media_moderation_usage(uuid, timestamptz, timestamptz, integer) to service_role;
