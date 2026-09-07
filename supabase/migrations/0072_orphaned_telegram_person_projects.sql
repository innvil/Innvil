begin;

-- =========================================================================
-- Cleans up a second-order artifact of the SAME bug class migration 0071
-- fixed: `finalizeCommunityConnection` (community-runtime.ts, the shared
-- Panel-owner/`/start` connect core) never validated `membership.chat.type`
-- before auto-creating a Project for a brand-new Community connection --
-- unlike `watch-runtime.ts`'s `createAccountCommunity` (the standalone-Watch
-- path, already fixed). A private 1:1 Telegram chat with a PERSON (the
-- account holder's own conversation with their moderator's bot, or anyone
-- else's) could reach this function exactly like a real group, producing:
--
--   1. a `projects` row named after that person's Telegram username/display
--      name (`membership.chat.title ?? membership.chat.username`) -- e.g.
--      "KSolDegen"
--   2. a `communities` row with `chat_type = 'private'` pointing at it
--
-- Migration 0071 already deleted every `communities` row with
-- `chat_type = 'private'`, but only touched `communities` -- it never
-- looked at `projects`, so the Project auto-created alongside the deleted
-- Community was left behind, orphaned: a Panel-backed Project with zero
-- Communities, zero Watchers, zero Knowledge, and an empty Profile --
-- exactly what a "0 communities · 0 watchers" row on the Projects page is.
--
-- This migration (a) fixes the underlying code path so this can never
-- recur (see community-runtime.ts's new SUPPORTED_TELEGRAM_COMMUNITY_
-- CHAT_TYPES check in finalizeCommunityConnection, checked before ANY
-- Project/Community row is created), and (b) removes the leftover orphaned
-- Projects, deterministically and conservatively.
--
-- DETERMINISTIC SIGNAL, not a name match: grepped the entire codebase --
-- migration 0071 is the ONLY place a `communities` row is EVER deleted
-- anywhere in this application. `projects.panel_id` is only ever set by
-- `finalizeCommunityConnection`'s auto-create-on-first-connection path
-- (createStandaloneProject, the OTHER Project-creation path, always sets
-- panel_id: null). Under normal operation that function creates exactly one
-- Community in the same call, immediately after the Project -- so a
-- Panel-backed Project with ZERO Communities today can only exist because
-- its sole Community was later removed by 0071's private-chat cleanup (or,
-- far less likely, an unrelated transient insert failure between the two
-- inserts -- which would also be a genuinely empty, resource-less Project,
-- safe to remove for the same reason).
--
-- CONSERVATIVE GUARD, per the explicit "never destroy a Project the customer
-- actually started using, even without a Community" instruction: only
-- removes a Project that is ALSO completely empty of real content --
-- no Project Profile fields filled in (description/website/docs_url/
-- overview/contacts, migration 0058) and no Project Knowledge rows
-- (knowledge_sources.project_id, migration 0054/0057). A Project a customer
-- had already started configuring before ever connecting a Community is
-- never touched, even if it currently shows 0 Communities for a genuinely
-- unrelated reason.
--
-- The Telegram PERSON identity itself is untouched by this migration and
-- was ALREADY preserved by 0071's own backfill into `watch_telegram_links`
-- (account_id, telegram_user_id) at the time the private Community row was
-- removed -- deleting the orphaned Project here does not affect it.
-- =========================================================================

delete from projects p
where p.panel_id is not null
  and not exists (select 1 from communities c where c.project_id = p.id)
  and not exists (select 1 from knowledge_sources k where k.project_id = p.id)
  and coalesce(p.description, '') = ''
  and coalesce(p.website, '') = ''
  and coalesce(p.docs_url, '') = ''
  and coalesce(p.overview, '') = ''
  and coalesce(p.contacts, '{}'::jsonb) = '{}'::jsonb;

commit;
