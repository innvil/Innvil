-- BYO Enterprise usage POLICY -- reactive vs. proactive ceiling split
-- (Phase 4.V.1, first item off the honest deferred list from CLAUDE.md).
--
-- Until now, watch_byo_usage_policies/watch_byo_usage_counters (0096) had
-- exactly ONE counter dimension: "requests per period" -- shared, undifferentiated,
-- between reactive chatter replies (community-runtime.ts) and, once Watcher
-- Presence Scheduling (0094/0095) shipped, unprompted scheduled presence
-- transition messages (presence-runtime.ts). A customer could not cap one
-- independently of the other, and the presence sweep never even RECORDED
-- against the shared counter -- an asymmetry (gated by the reactive count,
-- but never itself consuming it), not a real reactive/proactive distinction.
--
-- This migration adds an explicit `kind` dimension: 'reactive' (a real
-- triggering human message exists -- chatter ANSWER/CASUAL_CHAT) vs.
-- 'proactive' (unprompted, scheduler-driven -- currently only Watcher
-- Presence Scheduling; Auto-Posting is Panel-only and structurally
-- unreachable for BYO, see watch-runtime.ts's own doc comments). A customer
-- may now configure a real reactive ceiling and a real proactive ceiling
-- independently, at the same account/Community scope.
--
-- Additive, backward-compatible: every existing row (there are none of real
-- consequence yet -- this whole feature is days old) defaults to 'reactive',
-- which is the exact semantic every prior row/counter already represented
-- (the only kind of BYO call that existed before Presence Scheduling shipped).

alter table watch_byo_usage_policies
  add column if not exists kind text not null default 'reactive'
    check (kind in ('reactive', 'proactive'));

alter table watch_byo_usage_counters
  add column if not exists kind text not null default 'reactive'
    check (kind in ('reactive', 'proactive'));

-- Re-scope the two partial unique indexes to also include `kind` -- a
-- reactive AND a proactive policy may now coexist at the same scope.
drop index if exists watch_byo_usage_policies_account_uidx;
drop index if exists watch_byo_usage_policies_community_uidx;

create unique index if not exists watch_byo_usage_policies_account_uidx
  on watch_byo_usage_policies (account_id, kind)
  where community_id is null;

create unique index if not exists watch_byo_usage_policies_community_uidx
  on watch_byo_usage_policies (account_id, community_id, kind)
  where community_id is not null;

-- Widen the counter's primary key to include `kind` -- a reactive and a
-- proactive counter for the SAME (account, scope, period) are now genuinely
-- separate rows, never merged.
alter table watch_byo_usage_counters drop constraint if exists watch_byo_usage_counters_pkey;
alter table watch_byo_usage_counters add primary key (account_id, scope_key, kind, period_key);

-- Atomic upsert-and-increment, now kind-aware -- same single-statement
-- upsert-on-conflict shape as before, just one more key column. The old
-- 3-arg signature is a DISTINCT overload in Postgres (function identity
-- includes the parameter list) -- drop it explicitly so no stale version
-- referencing the old (now-widened) primary key is left behind.
drop function if exists increment_watch_byo_usage(uuid, text, text);

create or replace function increment_watch_byo_usage(
  p_account_id uuid,
  p_scope_key text,
  p_period_key text,
  p_kind text default 'reactive'
)
returns int
language sql
security definer
set search_path = public
as $$
  insert into watch_byo_usage_counters (account_id, scope_key, kind, period_key, request_count, updated_at)
  values (p_account_id, p_scope_key, p_kind, p_period_key, 1, now())
  on conflict (account_id, scope_key, kind, period_key)
  do update set request_count = watch_byo_usage_counters.request_count + 1, updated_at = now()
  returning request_count;
$$;

revoke all on function increment_watch_byo_usage(uuid, text, text, text) from public;
grant execute on function increment_watch_byo_usage(uuid, text, text, text) to service_role;
