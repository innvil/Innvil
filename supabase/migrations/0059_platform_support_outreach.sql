-- 0059_platform_support_outreach.sql
-- Extends platform_support_messages for super-admin outreach and automated
-- onboarding nudges to newly-created draft panel owners.
-- Safe to re-run.

begin;

alter table platform_support_messages
  add column if not exists direction text,
  add column if not exists kind text,
  add column if not exists sender_id uuid references profiles (id) on delete set null;

update platform_support_messages
   set direction = coalesce(direction, 'inbound'),
       kind = coalesce(kind, 'general');

alter table platform_support_messages
  alter column direction set default 'inbound',
  alter column direction set not null,
  alter column kind set default 'general',
  alter column kind set not null;

alter table platform_support_messages
  drop constraint if exists platform_support_direction_check;
alter table platform_support_messages
  add constraint platform_support_direction_check check (direction in ('inbound', 'outbound'));

alter table platform_support_messages
  drop constraint if exists platform_support_kind_check;
alter table platform_support_messages
  add constraint platform_support_kind_check check (kind in ('general', 'onboarding_draft_nudge', 'onboarding_draft_followup'));

create index if not exists idx_platform_support_owner_direction
  on platform_support_messages (owner_id, direction, created_at desc);
create index if not exists idx_platform_support_direction_status
  on platform_support_messages (direction, status, created_at desc);

commit;
