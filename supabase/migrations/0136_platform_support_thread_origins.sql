-- ============================================================================
-- 0136_platform_support_thread_origins.sql
-- Preserves a conversation's origin so automated welcomes never mix with
-- owner-initiated support work, even after further replies are added.
-- ============================================================================

begin;

alter table platform_support_threads
  add column if not exists origin_kind text not null default 'general';

alter table platform_support_threads
  drop constraint if exists platform_support_threads_origin_kind_check;
alter table platform_support_threads
  add constraint platform_support_threads_origin_kind_check
  check (origin_kind in ('general', 'onboarding_draft_nudge', 'onboarding_draft_followup'));

-- Backfill from the first message in each thread. The DISTINCT ON order makes
-- the result deterministic for historical messages created at the same time.
with first_messages as (
  select distinct on (thread_id) thread_id, kind
  from platform_support_messages
  order by thread_id, created_at asc, id asc
)
update platform_support_threads t
   set origin_kind = coalesce(f.kind, 'general')
  from first_messages f
 where t.id = f.thread_id;

create index if not exists idx_platform_support_threads_origin_status
  on platform_support_threads (origin_kind, status, last_message_at desc);

commit;
