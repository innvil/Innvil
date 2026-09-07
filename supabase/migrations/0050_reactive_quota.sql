-- 0050_reactive_quota.sql
-- Phase 4.M (B): trial reactive response entitlement -- 20 successfully
-- executed reactive conversational text responses (CASUAL_CHAT/ANSWER/
-- SHORT_ACK) per community per local community day, for the 7-Day Full AI
-- Mod Trial only. Separate from the existing (not-yet-enforced) proactive
-- quota on deployment_state, and separate from moderation, which never
-- consumes or is blocked by this.
--
-- Scoped per COMMUNITY (not per deployment/moderator), matching the spec's
-- explicit wording -- several deployments in the same community share one
-- pool. "Local community day" would ideally use a per-community timezone,
-- but no such field exists anywhere in the schema yet (Proactive Mode,
-- which the spec pointed at for "existing timezone infrastructure," was
-- never built beyond reserved columns) -- so this uses UTC calendar days
-- for now. Revisit if/when a real per-community timezone is introduced.

create table if not exists community_reactive_quota (
  panel_id       uuid not null references panels (id) on delete cascade,
  community_id   uuid not null references communities (id) on delete cascade,
  quota_day      date not null,
  reactive_count integer not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (community_id, quota_day)
);
create index if not exists idx_community_reactive_quota_panel on community_reactive_quota (panel_id);

alter table community_reactive_quota enable row level security;
-- No policies: service-role only (runtime), same pattern as other pure
-- runtime-state tables (telegram_processed_updates, deployment_state).

-- Atomic upsert-and-increment -- avoids a read-then-write race between
-- concurrent webhook deliveries. Only ever called AFTER a reactive text
-- response has actually been sent successfully; the pre-generation "is
-- there quota left" check is a plain read, not this function.
create or replace function increment_community_reactive_quota(
  p_panel_id uuid,
  p_community_id uuid,
  p_quota_day date
)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into community_reactive_quota (panel_id, community_id, quota_day, reactive_count)
  values (p_panel_id, p_community_id, p_quota_day, 1)
  on conflict (community_id, quota_day)
  do update set reactive_count = community_reactive_quota.reactive_count + 1,
                updated_at = now()
  returning reactive_count;
$$;

revoke all on function increment_community_reactive_quota(uuid, uuid, date) from anon, authenticated;
grant execute on function increment_community_reactive_quota(uuid, uuid, date) to service_role;
