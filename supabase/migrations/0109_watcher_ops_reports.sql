-- Watcher Ops moderation-reporting expansion (2026-08-27) -- extends the
-- existing private Escalation Group (migration 0108) from a knowledge-only
-- channel into the project's real moderation operations/audit channel.
-- Watchers now also report structured moderation actions (warnings,
-- temporary mutes, kicks, message purges, scam/NSFW removals, and
-- permission failures) there, alongside the existing unresolved-question
-- escalation workflow.
--
-- The structured event is the source of truth (never generated prose) --
-- every column here mirrors watcher-ops-report.ts's ModerationReportEvent
-- 1:1, so a future dashboard/filtering view never has to parse text.
--
-- BILLING: unaffected by this migration -- an Escalation Group still never
-- consumes a Watcher slot or counts toward the plan's Community allowance
-- (see 0108's own comment); nothing here changes that.

begin;

-- media-moderation.ts's decideMediaEnforcement now produces DELETE_KICK
-- (never DELETE_BAN) for a confirmed explicit result -- widen the dedup
-- table's own check constraint to match, so the real enforcement kind can
-- actually be cached. `if exists` (same convention already used by
-- migration 0070 for this same table) makes this a no-op rather than a
-- hard failure on a database where migration 0059_media_moderation.sql
-- (the one that CREATES moderator_media_dedup) hasn't been applied yet --
-- widening a constraint on a table that doesn't exist is meaningless, not
-- something worth blocking this whole migration over. If 0059 is applied
-- LATER, it creates the table with its own (narrower, pre-DELETE_KICK)
-- constraint -- run migration 0059 BEFORE 0109 to get the widened
-- constraint in one pass, or re-run just this ALTER block manually after.
alter table if exists moderator_media_dedup drop constraint if exists moderator_media_dedup_enforcement_kind_check;
alter table if exists moderator_media_dedup add constraint moderator_media_dedup_enforcement_kind_check
  check (enforcement_kind in ('ALLOW', 'DELETE_WARN', 'DELETE_KICK', 'DELETE_BAN'));

create table if not exists watch_moderation_reports (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references projects (id) on delete cascade,
  source_community_id         uuid not null references communities (id) on delete cascade,
  -- The Escalation Group this report was sent (or attempted) to -- nullable
  -- is never possible in practice today (sendModerationReport only ever
  -- inserts once a real target resolves), kept as `not null` to match.
  escalation_community_id     uuid not null references communities (id) on delete cascade,
  watcher_id                  uuid not null references virtual_moderators (id) on delete cascade,
  platform_user_id            text not null,
  username                    text,
  display_name                text,
  violation_category          text not null check (violation_category in ('spam', 'scam_link', 'nsfw', 'explicit_link')),
  warning_number               integer,
  warning_limit                integer,
  mute_minutes                 integer,
  -- Ordered list of ModerationActionKind values this specific report covers
  -- (e.g. '["temporary_mute","message_purge"]') -- jsonb array, never a
  -- second free-text summary of the same facts.
  action_types                jsonb not null default '[]'::jsonb,
  purged_count                integer,
  purge_failed                boolean not null default false,
  telegram_action_failed      boolean not null default false,
  telegram_failure_reason     text,
  previous_enforcement_summary jsonb not null default '[]'::jsonb,
  -- The exact deterministic text actually sent (or that would have been
  -- sent) -- kept for audit/debugging, never re-parsed as the source of
  -- truth (the structured columns above are).
  report_text                  text not null,
  escalation_message_id        text,
  sent                         boolean not null default false,
  created_at                   timestamptz not null default now()
);
create index if not exists idx_watch_moderation_reports_project on watch_moderation_reports (project_id, created_at desc);
create index if not exists idx_watch_moderation_reports_user on watch_moderation_reports (source_community_id, platform_user_id, created_at desc);

alter table watch_moderation_reports enable row level security;
-- Service-role only, matching every other Watch runtime table -- tenancy is
-- enforced in application code via project_id, never client-side RLS.

commit;
