-- 0052_moderator_conversation_tasks.sql
-- Temporary conversational task state for Virtual Moderators (e.g. "let's
-- all count, I'll start with 1"). Normal group chat stays turn-free (see
-- chatter-coordinator.ts) -- this is the SEPARATE, explicit mechanism for
-- when a human establishes a multi-step shared activity that must be
-- remembered and enforced across several messages/participants.
--
-- Persisted (not process memory) because Telegram webhook invocations are
-- stateless/serverless -- a task spans multiple messages, possibly handled
-- by different function invocations, and must survive between them.
--
-- Scoped per COMMUNITY: v1 policy is exactly ONE active/paused structured
-- task per community (a group activity like "let's all count" is a ROOM
-- event, not a private one -- and a second, unrelated task starting mid-way
-- must never silently merge with the first). Enforced at the DB level via
-- the partial unique index below, not just in application code.
--
-- `state` holds the full domain object (src/lib/moderator/task-state.ts's
-- ConversationTask) as JSONB -- same "typed domain object in a jsonb column"
-- pattern already used for virtual_moderators.persona /
-- moderator_deployments.overrides in 0043. Kept generic (a `type` field
-- inside `state` discriminates SEQUENCE from future task kinds) so adding a
-- new task type later does not require a schema change.

begin;

create table if not exists moderator_conversation_tasks (
  id                        uuid primary key default gen_random_uuid(),
  panel_id                  uuid not null references panels (id) on delete cascade,
  community_id              uuid not null references communities (id) on delete cascade,
  status                    text not null default 'ACTIVE'
                              check (status in ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED')),
  state                     jsonb not null,
  created_from_message_id   text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- The actual "one active structured task per community" enforcement --
-- ACTIVE and PAUSED both count as "in progress" for this purpose.
create unique index if not exists idx_moderator_conversation_tasks_one_live
  on moderator_conversation_tasks (community_id)
  where status in ('ACTIVE', 'PAUSED');

create index if not exists idx_moderator_conversation_tasks_panel
  on moderator_conversation_tasks (panel_id);

drop trigger if exists trg_moderator_conversation_tasks_updated on moderator_conversation_tasks;
create trigger trg_moderator_conversation_tasks_updated
  before update on moderator_conversation_tasks
  for each row execute function set_updated_at();

alter table moderator_conversation_tasks enable row level security;
-- No policies: service-role only (webhook/runtime), same pattern as the
-- other pure runtime-state tables in this schema (deployment_state,
-- community_messages, telegram_processed_updates).

commit;
