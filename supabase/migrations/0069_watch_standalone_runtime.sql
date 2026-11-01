-- 0069_watch_standalone_runtime.sql
--
-- Extends the neutral-ownership architecture (migration 0066, which stopped
-- at `projects`) one layer deeper: Communities, Watchers (`virtual_moderators`),
-- and Deployments (`moderator_deployments`) can now be owned directly by an
-- Innvil account with NO Panel at all -- the concrete next step the
-- ownership.ts doc comment already flagged ("Communities/Watchers still
-- require a Panel-distributed deployment path today ... documented next
-- step, not built this pass").
--
-- Additive/backfill only. No destructive drops. Every existing Panel-backed
-- row keeps working completely unchanged -- panel_id stays populated on all
-- of them, nothing here reassigns or nulls out existing data.
--
-- SCOPE, stated plainly: this migration covers the OWNERSHIP/CREATION layer
-- (who owns a Watcher/Community/Deployment, and can a standalone one be
-- created at all). It does NOT touch the live Telegram message-processing
-- pipeline's state tables (community_messages, moderator_spam_hits,
-- moderator_activity_log, moderator_link_warning_state, community_reactive_quota,
-- knowledge_sources, auto_post_windows/occurrences, moderator_media_dedup,
-- moderator_conversation_tasks) -- those all remain panel_id NOT NULL.
-- Rewiring the actual webhook entrypoint (resolveCommunity and everything
-- downstream of it) to resolve tenant identity without a panel_id is a
-- separate, deeper, higher-risk change against LIVE production Telegram
-- webhook traffic for every existing paying customer -- deliberately not
-- attempted in this pass. See CLAUDE.md for the full scope note.

begin;

-- ------------------------------------------------------- virtual_moderators ----
-- Neutral owner: account_id (profiles.id), parallel to panel_id. A Watcher
-- must have AT LEAST ONE owner reference (never orphaned); a standalone
-- direct-Watch Watcher has account_id set and panel_id null.

alter table virtual_moderators add column if not exists account_id uuid references profiles (id) on delete cascade;
alter table virtual_moderators alter column panel_id drop not null;
alter table virtual_moderators drop constraint if exists virtual_moderators_owner_check;
alter table virtual_moderators add constraint virtual_moderators_owner_check
  check (panel_id is not null or account_id is not null);
create index if not exists idx_virtual_moderators_account on virtual_moderators (account_id);

-- --------------------------------------------------- telegram integrations ----
-- Ownership already derives from virtual_moderator_id (unique, NOT NULL) --
-- no new owner column needed (parent-derived, per the "don't add account_id
-- indiscriminately" instruction). panel_id becomes optional; the existing
-- unique(panel_id, telegram_bot_id) constraint doesn't protect the
-- standalone (panel_id null) case, since Postgres treats every NULL as
-- distinct in a plain UNIQUE constraint -- add a partial index for it.

alter table telegram_bot_integrations alter column panel_id drop not null;
create unique index if not exists idx_telegram_bot_integrations_standalone_bot
  on telegram_bot_integrations (telegram_bot_id) where panel_id is null;

alter table telegram_provisioning_attempts alter column panel_id drop not null;

-- ------------------------------------------------------------- communities ----
-- Ownership derives from project_id -> projects.account_id (already
-- established, migration 0066) -- no new column needed here either.
-- Same NULL-uniqueness gap as above for the existing
-- unique(panel_id, platform, chat_id) constraint; add the standalone
-- partial-unique equivalent (a given Telegram chat can only be ONE
-- standalone community, same as it can only be one community per panel).

alter table communities alter column panel_id drop not null;
create unique index if not exists idx_communities_standalone_chat
  on communities (platform, chat_id) where panel_id is null;

-- ------------------------------------------------------- moderator_deployments ----
-- unique(moderator_id, community_id) never involved panel_id -- no fix
-- needed there. Ownership derives from moderator_id (account_id) and/or
-- community_id -> project_id -> account_id.

alter table moderator_deployments alter column panel_id drop not null;

-- ------------------------------------------------- moderator_spam_hits fix ----
-- panel_id was part of the PRIMARY KEY here, which is genuinely redundant:
-- community_id alone already uniquely determines the owning tenant (a
-- community belongs to exactly one owner). Under a nullable panel_id the
-- old composite PK would let two DIFFERENT standalone communities' spam
-- state collide as "the same row" whenever panel_id is null for both AND
-- (community_id, sender_platform_id) happened to match across tenants --
-- impossible in practice (community_id is already tenant-unique), but the
-- PK is corrected to what it should have been regardless, per the explicit
-- "add consistency constraints where appropriate" instruction.

alter table moderator_spam_hits drop constraint if exists moderator_spam_hits_pkey;
alter table moderator_spam_hits alter column panel_id drop not null;
alter table moderator_spam_hits add primary key (community_id, sender_platform_id);

commit;
