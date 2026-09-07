-- 0126_link_enforcement_notice_dedup.sql
-- Fix: a rapid burst of scam/phishing (or spam) messages from the SAME
-- person raced the read-then-write of moderator_link_warning_state --
-- loadLinkWarningState/persistLinkWarningState is a plain SELECT followed
-- later by a plain UPSERT, with no atomicity between the two. When several
-- messages from one sender arrive within a very short window (a classic
-- scam-bot flooding pattern), each webhook invocation independently reads
-- the SAME stale prior strike/warning count, independently computes the
-- SAME escalation decision, and independently sends its own copy of the
-- resulting notice -- live-observed as THREE separate "you have been
-- removed from this community" messages for what was really one escalation
-- event (mute, then exactly one kick).
--
-- Fix: an atomic claim, keyed by (community_id, platform_user_id, reason),
-- that only the FIRST caller within a short dedup window can win. The
-- underlying Telegram moderation action itself (mute/kick) is NEVER gated
-- by this claim -- it always executes, since a duplicated mute/kick call is
-- silently idempotent to Telegram and invisible to the community, and the
-- offender must always actually end up restricted/removed regardless of any
-- race. Only the VISIBLE aftermath of a claim loss (the generated warning
-- text + SEND_TEXT, the message purge, and the internal Watcher Ops report)
-- is skipped -- "only say 1 [notice], from the same person," per explicit
-- product feedback (a live-reported bug, three duplicate kick notices for
-- one person within about a minute).
--
-- Reuses the SAME per-(community,user) row every other link-moderation
-- counter already lives on, rather than a new table -- these two columns
-- are managed EXCLUSIVELY by claim_link_enforcement_notice() below, never
-- read or written directly by application code.

begin;

alter table moderator_link_warning_state
  add column if not exists last_notice_reason text,
  add column if not exists last_notice_at timestamptz;

create or replace function claim_link_enforcement_notice(
  p_community_id uuid,
  p_platform_user_id text,
  p_reason text,
  p_now timestamptz,
  p_dedup_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_won boolean;
begin
  insert into moderator_link_warning_state (community_id, platform_user_id, last_notice_reason, last_notice_at)
  values (p_community_id, p_platform_user_id, p_reason, p_now)
  on conflict (community_id, platform_user_id) do update
    set last_notice_reason = excluded.last_notice_reason,
        last_notice_at = excluded.last_notice_at
    where moderator_link_warning_state.last_notice_at is null
       or moderator_link_warning_state.last_notice_reason is distinct from excluded.last_notice_reason
       or moderator_link_warning_state.last_notice_at < p_now - make_interval(secs => p_dedup_window_seconds)
  returning true into v_won;
  return coalesce(v_won, false);
end;
$$;

commit;
