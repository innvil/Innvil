-- 0059_media_moderation.sql
-- Direct photo/video moderation (Phase 4.M media moderation extension).
-- Reuses the existing moderation action/decision abstraction
-- (link-moderation.ts's ModerationEnforcement, extended with two new
-- reason values -- no schema change needed for that part, it's a TypeScript
-- union). This migration only adds dedup state: Telegram's file_unique_id
-- is stable per actual file content (not per message), so the same photo/
-- video re-sent, forwarded, or redelivered by a Telegram retry is never
-- reprocessed -- mirrors telegram_processed_updates' exact pattern (insert-
-- as-claim, unique constraint does the dedup work).

begin;

create table if not exists moderator_media_dedup (
  id                uuid primary key default gen_random_uuid(),
  panel_id          uuid not null references panels (id) on delete cascade,
  community_id      uuid not null references communities (id) on delete cascade,
  file_unique_id    text not null,
  verdict           text not null check (verdict in ('safe', 'uncertain', 'explicit', 'error')),
  enforcement_kind  text not null check (enforcement_kind in ('ALLOW', 'DELETE_WARN', 'DELETE_BAN')),
  created_at        timestamptz not null default now(),
  unique (community_id, file_unique_id)
);
create index if not exists idx_moderator_media_dedup_panel on moderator_media_dedup (panel_id);

alter table moderator_media_dedup enable row level security;
-- No policies: service-role only (webhook runtime), same pattern as every
-- other pure runtime-state table in this schema.

commit;
