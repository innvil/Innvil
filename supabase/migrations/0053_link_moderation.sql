-- 0053_link_moderation.sql
-- Phase 4.M (C)-(F): intelligent external-link moderation, spam vs.
-- legitimate-follow-up distinction, warning escalation, and configurable
-- collab/AMA contact routing. Moderation is a SEPARATE decision from
-- Natural Chatter (spec §18/§45/§50) -- it runs independent of, and is
-- never disabled by, the reactive chatter quota.
--
-- Per-(community, Telegram user) state, mirroring deployment_state's shape:
--   warning_count               long-term violation count (3-strike escalation, spec §25)
--   last_violation_at           for audit/inspection
--   recent_link_hash/_at/_count_in_window   short-term FLOOD detection only
--     (spec §30-31: this window changes the rapid-flood INTERPRETATION, it
--     never resets warning_count -- the two are deliberately separate columns,
--     never merged into one counter)
--
-- collab_contact on communities mirrors the existing bot_ack_mode column's
-- pattern exactly (same per-community settings convention, spec §34).

begin;

alter table communities
  add column if not exists collab_contact text;

create table if not exists moderator_link_warning_state (
  panel_id                    uuid not null references panels (id) on delete cascade,
  community_id                uuid not null references communities (id) on delete cascade,
  platform_user_id            text not null,
  warning_count               integer not null default 0,
  last_violation_at           timestamptz,
  last_violation_kind         text,
  recent_link_hash            text,
  recent_link_at              timestamptz,
  recent_link_count_in_window integer not null default 0,
  updated_at                  timestamptz not null default now(),
  primary key (community_id, platform_user_id)
);
create index if not exists idx_moderator_link_warning_state_panel on moderator_link_warning_state (panel_id);

drop trigger if exists trg_moderator_link_warning_state_updated on moderator_link_warning_state;
create trigger trg_moderator_link_warning_state_updated
  before update on moderator_link_warning_state
  for each row execute function set_updated_at();

alter table moderator_link_warning_state enable row level security;
-- No policies: service-role only (webhook/runtime), same pattern as every
-- other pure runtime-state table in this schema (deployment_state,
-- community_messages, moderator_conversation_tasks).

commit;
