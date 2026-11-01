-- 0062_communities_unique_index_fix.sql
--
-- Live incident fix: resolveCommunity (community-runtime.ts) has been upserting
-- into `communities` with `onConflict: "panel_id,platform,chat_id"` since
-- migration 0043 first defined `unique (panel_id, platform, chat_id)` -- but
-- live diagnostics (2026-08-17) proved that constraint does not actually exist
-- on the production database. Every upsert for an ALREADY-CONNECTED community
-- was therefore attempting a fresh INSERT (never recognized as a conflict),
-- which fails on the `project_id` NOT NULL constraint (added in migration 0057)
-- with `23502 null value in column "project_id"` -- resolveCommunity silently
-- returned null on every such failure (now logs the real error, see the same
-- commit), so every human message in an EXISTING connected community was
-- silently dropped before ever reaching moderation/chatter logic. New
-- communities were unaffected only because connectCommunity's own INSERT
-- path (actions/moderator.ts) supplies project_id directly, not via this
-- upsert.
--
-- This migration restores the missing unique index. A plain unique INDEX
-- (not a named table CONSTRAINT) is sufficient for Postgres to recognize an
-- ON CONFLICT target -- doesn't require guessing at how the original
-- constraint was lost. Idempotent: safe to run whether or not a constraint
-- with the same effective columns already exists under a different name (a
-- genuine duplicate unique index is a no-op for correctness, only a small
-- amount of redundant storage -- acceptable to leave rather than risk
-- dropping something by name that we're not certain is the right one).

begin;

create unique index if not exists communities_panel_platform_chat_uidx
  on communities (panel_id, platform, chat_id);

commit;
