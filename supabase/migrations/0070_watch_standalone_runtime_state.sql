-- 0070_watch_standalone_runtime_state.sql
--
-- Fixes a real gap left by 0069/the v1.25.0 runtime rewire: `resolveCommunity`
-- and the settings resolution were made standalone-aware, and every runtime
-- function's `panelId` PARAMETER was widened to `string | null` -- but
-- several tables those functions actually WRITE to were never made nullable,
-- meaning a standalone deployment reaching `recordCommunityMessage` (very
-- early in the pipeline -- right after sender classification, before
-- bot-ack/chatter even run) would hit a NOT NULL constraint violation and
-- silently fail (the webhook route's outer try/catch swallows it, returns
-- 200 to Telegram, logs an error -- so this was invisible without directly
-- checking Postgres error codes, not surfaced as a crash).
--
-- Every table here is a plain runtime-state/log table where panel_id is
-- ONLY ever a denormalized attribution column, never part of a unique
-- constraint or primary key (verified for each, not assumed) -- safe,
-- additive, same pattern as 0069.

-- `if exists` on every statement -- some of these tables come from later,
-- optional feature migrations (e.g. 0059_media_moderation.sql,
-- 0052_moderator_conversation_tasks.sql) that may not have been applied in
-- every environment yet. A table that doesn't exist here has nothing to fix
-- and is silently skipped rather than failing the whole migration.

begin;

alter table if exists community_messages alter column panel_id drop not null;
alter table if exists moderator_activity_log alter column panel_id drop not null;
alter table if exists moderator_link_warning_state alter column panel_id drop not null;
alter table if exists community_reactive_quota alter column panel_id drop not null;
alter table if exists moderator_media_dedup alter column panel_id drop not null;
alter table if exists moderator_conversation_tasks alter column panel_id drop not null;

commit;
