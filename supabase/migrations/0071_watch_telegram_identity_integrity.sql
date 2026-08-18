begin;

-- =========================================================================
-- Telegram PERSON identity vs. Telegram COMMUNITY resource -- these are two
-- fundamentally different concepts that were never enforced as distinct at
-- the database level:
--
--   1. TELEGRAM USER IDENTITY (a person) -- watch_telegram_links
--      (account_id, telegram_user_id). Anti-abuse / account-linking only.
--
--   2. TELEGRAM COMMUNITY (a group/supergroup/channel Watchers operate in)
--      -- communities (project_id, chat_id, chat_type).
--
-- Nothing previously stopped a private 1:1 Telegram chat (chat_type =
-- 'private', chat_id = the OTHER PARTY's numeric Telegram user id) from
-- being inserted into `communities` through connectAccountCommunity() --
-- the application code now rejects this going forward (watch-runtime.ts's
-- createAccountCommunity), but this migration also (a) tightens
-- watch_telegram_links so one verified Telegram person can never link to
-- more than one Innvil account, and (b) safely removes any EXISTING
-- communities row that is deterministically provable to be a private chat
-- (chat_type = 'private' was persisted directly from Telegram's own trusted
-- getChat response at creation time -- this is not a guess).
--
-- NOTE (fixed after a live run failed): the CHECK constraint below must be
-- added AFTER the private-row cleanup, not before -- a CHECK constraint is
-- validated against every EXISTING row at ALTER TABLE time, so adding it
-- while 'private' rows were still present made the whole transaction fail
-- and roll back. It's also added NOT VALID: this codebase has no live
-- visibility into whether some OTHER legacy chat_type value (a typo, an old
-- format) might also exist beyond the one deterministically-known-bad case
-- this migration cleans up -- NOT VALID enforces the rule for every future
-- INSERT/UPDATE without requiring every historical row to already satisfy
-- it, which matches the explicit "do not guess / do not destroy data that
-- can't be confidently classified" instruction. Once you've confirmed no
-- other legacy communities row violates it, you can tighten it later with
-- `alter table communities validate constraint
-- communities_telegram_chat_type_supported;` -- optional, not required for
-- this migration or the application-level fix to work.
-- =========================================================================

-- ---- 1. One verified Telegram person -> at most one Innvil account -------
--
-- Was: unique(account_id, telegram_user_id) only -- deliberately allowed the
-- SAME telegram_user_id to link to MULTIPLE accounts, treating cross-account
-- reuse as a DETECTION signal rather than preventing it outright. Per
-- explicit product decision, this is now a hard PREVENTION rule: the same
-- verified Telegram numeric user id may never be linked to more than one
-- Innvil account, full stop. Safe to add directly -- linkTelegramIdentity()
-- has no live callers yet (grepped: only referenced from its own test file),
-- so this table has never actually been written to in production.
alter table watch_telegram_links
  add constraint watch_telegram_links_tg_user_unique unique (telegram_user_id);

-- ---- 2. Backfill: reclassify existing private-chat rows deterministically -
--
-- Only rows with chat_type = 'private' are touched -- this is real, trusted
-- metadata captured directly from Telegram's own getChat response at the
-- time the row was created (connectAccountCommunity), never inferred from
-- chat_id sign/shape/username. Any community with chat_type IS NULL or any
-- other value is left completely untouched, per the explicit "if ownership/
-- classification cannot be determined confidently, do not guess" rule.

-- 2a. Preserve the Telegram identity: link the account that owned the
-- misclassified "community" to the Telegram person it actually represents
-- (chat_id IS that person's numeric Telegram user id for a private chat).
-- ON CONFLICT DO NOTHING respects the one-account-per-identity constraint
-- just added above -- if that Telegram person is somehow already linked to
-- a different account, this simply does not overwrite it (no silent
-- identity transfer), leaving it for manual review.
insert into watch_telegram_links (account_id, telegram_user_id, verified_at)
select distinct
  p.account_id,
  c.chat_id::bigint,
  c.created_at
from communities c
join projects p on p.id = c.project_id
where c.platform = 'telegram'
  and c.chat_type = 'private'
  and p.account_id is not null
  and c.chat_id ~ '^-?[0-9]+$'
on conflict (telegram_user_id) do nothing;

-- 2b. Remove the invalid Community rows. Every table that references
-- communities.id (moderator_deployments, community_messages,
-- moderator_activity_log, community_reactive_quota,
-- moderator_conversation_tasks, moderator_link_warning_state,
-- knowledge_sources, auto_post_windows, moderator_media_dedup) already has
-- `on delete cascade` on that FK (verified against migrations 0043/0047/
-- 0050/0052/0053/0054/0055/0059) -- a plain delete here safely cleans up
-- every dependent row without a manual cascade, and never touches a
-- genuinely valid Community (chat_type <> 'private').
delete from communities
where platform = 'telegram'
  and chat_type = 'private';

-- ---- 3. Community chat_type, when known, must be a real Community type ---
--
-- Mirrors the application-level guard in createAccountCommunity(). Scoped to
-- platform = 'telegram' only (the sole platform this table is used for
-- today) so a future non-Telegram platform's own type vocabulary is never
-- constrained by this. A NULL chat_type is left unconstrained -- rows
-- created before this field existed have no trustworthy classification
-- either way, and this migration must never destroy a real Community.
-- NOT VALID -- see the note at the top of this file for why.
alter table communities
  add constraint communities_telegram_chat_type_supported check (
    platform <> 'telegram' or chat_type is null or chat_type in ('group', 'supergroup', 'channel')
  ) not valid;

commit;
