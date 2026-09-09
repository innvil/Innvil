begin;

alter table public.communities add column if not exists moderation_notice_cooldown_minutes integer not null default 30
  check (moderation_notice_cooldown_minutes in (30, 60));

-- Separate actual violations from public delivery and successful restrictions.
create table if not exists public.watch_quiet_moderation_state (
  community_id uuid not null references public.communities(id) on delete cascade,
  platform_user_id text not null,
  cycle_id uuid not null default gen_random_uuid(),
  violation_count integer not null default 0,
  last_incident_at timestamptz,
  last_violation_at timestamptz,
  last_public_warning_at timestamptz,
  last_mute_at timestamptz,
  final_warning_at timestamptz,
  primary key (community_id, platform_user_id)
);
create table if not exists public.watch_quiet_moderation_events (
  community_id uuid not null references public.communities(id) on delete cascade,
  platform_message_id text not null,
  platform_user_id text not null,
  cycle_id uuid not null,
  topic_id bigint not null default 0,
  family text not null,
  created_at timestamptz not null default now(),
  stage integer not null,
  incident_claimed boolean not null,
  action text not null check (action in ('delete', 'mute', 'kick')),
  mute_minutes integer,
  notice_kind text check (notice_kind in ('reminder', 'repeat', 'final')),
  notice_reserved_until timestamptz,
  public_sent_at timestamptz,
  public_message_id text,
  mute_succeeded boolean not null default false,
  kick_succeeded boolean not null default false,
  finished_at timestamptz,
  primary key (community_id, platform_message_id)
);
alter table public.watch_quiet_moderation_state add column if not exists public_warning_count integer not null default 0;
create index if not exists watch_quiet_events_recent on public.watch_quiet_moderation_events(community_id, created_at desc);
create index if not exists watch_quiet_events_public on public.watch_quiet_moderation_events(community_id, topic_id, family, public_sent_at desc);
alter table public.watch_quiet_moderation_state enable row level security;
alter table public.watch_quiet_moderation_events enable row level security;
revoke all on public.watch_quiet_moderation_state, public.watch_quiet_moderation_events from public, anon, authenticated;

-- Called ONLY after a policy-confirmed ordinary violation was successfully deleted.
create or replace function public.claim_quiet_moderation(
  p_community_id uuid, p_user_id text, p_message_id text, p_topic_id bigint,
  p_family text, p_message_at timestamptz, p_legacy_count integer default 0
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.watch_quiet_moderation_state%rowtype;
  t timestamptz := clock_timestamp(); occurred timestamptz;
  stage integer; cooldown integer; action text; mute_minutes integer;
  notice text; suppressed text; held boolean := false;
begin
  if p_message_id is null or p_message_id !~ '^[0-9]{1,30}$' or p_user_id is null or p_user_id = ''
    or p_family is null or p_family not in ('promotion','competing_project','search_spam','dm_spam','token_contract_mismatch')
    or p_message_at is null then return jsonb_build_object('claimed',false,'reason','invalid_input'); end if;
  select moderation_notice_cooldown_minutes into cooldown from public.communities where id = p_community_id;
  if not found then return jsonb_build_object('claimed',false,'reason','unknown_community'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_community_id::text, 132));
  if exists(select 1 from public.watch_quiet_moderation_events where community_id=p_community_id and platform_message_id=p_message_id) then
    return jsonb_build_object('claimed',false,'reason','duplicate_message');
  end if;
  occurred := least(p_message_at,t);
  if occurred < t - interval '30 days' then return jsonb_build_object('claimed',false,'reason','stale_message'); end if;
  insert into public.watch_quiet_moderation_state(community_id,platform_user_id,violation_count)
    values(p_community_id,p_user_id,greatest(0,least(coalesce(p_legacy_count,0),4))) on conflict do nothing;
  select * into s from public.watch_quiet_moderation_state where community_id=p_community_id and platform_user_id=p_user_id for update;
  if s.last_violation_at < t - interval '30 days' then
    s.cycle_id := gen_random_uuid(); s.violation_count := 0;
    s.last_incident_at := null; s.last_public_warning_at := null; s.last_mute_at := null; s.final_warning_at := null; s.public_warning_count := 0;
  end if;
  -- One ordinary escalation per 30-second burst, across bots/topics/reasons.
  -- Confirmed flood handling is separate and never calls this function.
  if s.last_incident_at is not null and occurred <= s.last_incident_at + interval '30 seconds' then
    insert into public.watch_quiet_moderation_events(community_id,platform_message_id,platform_user_id,cycle_id,topic_id,family,stage,incident_claimed,action,finished_at)
      values(p_community_id,p_message_id,p_user_id,s.cycle_id,coalesce(p_topic_id,0),p_family,least(s.violation_count,5),false,'delete',t);
    return jsonb_build_object('claimed',false,'reason','same_incident');
  end if;
  s.violation_count := least(s.violation_count + 1, 1000000);
  stage := least(s.violation_count,5);
  action := case when stage = 1 then 'delete' when stage = 5 and s.final_warning_at < occurred then 'kick' else 'mute' end;
  mute_minutes := case when action <> 'mute' then null when stage=2 then 10 when stage=3 then 30 else 60 end;
  held := stage=5 and action<>'kick';
  notice := case when stage=1 then 'reminder' when stage=3 then 'repeat'
    when stage>=4 and action<>'kick' and s.final_warning_at is null then 'final' else null end;
  if notice is not null then
    if (select count(*) from public.watch_quiet_moderation_events where community_id=p_community_id
      and (public_sent_at > t - interval '10 minutes' or (notice_kind is not null and finished_at is null and created_at > t - interval '10 minutes'))) >= 3 then
      notice := null; suppressed := 'community_public_limit';
    elsif notice='reminder' and exists(select 1 from public.watch_quiet_moderation_events
      where community_id=p_community_id and topic_id=coalesce(p_topic_id,0) and family=p_family
        and (public_sent_at > t - make_interval(mins=>cooldown) or (notice_kind is not null and finished_at is null and created_at > t - make_interval(mins=>cooldown)))) then
      notice := null; suppressed := 'similar_spam_recently_addressed';
    end if;
  else suppressed := case when stage=2 then 'silent_second_offense' else 'silent_enforcement' end;
  end if;
  update public.watch_quiet_moderation_state set cycle_id=s.cycle_id, violation_count=s.violation_count,
    last_incident_at=occurred,last_violation_at=t,last_public_warning_at=s.last_public_warning_at,
    last_mute_at=s.last_mute_at,final_warning_at=s.final_warning_at,public_warning_count=s.public_warning_count
    where community_id=p_community_id and platform_user_id=p_user_id;
  delete from public.watch_quiet_moderation_events where community_id=p_community_id and created_at < t - interval '31 days';
  insert into public.watch_quiet_moderation_events(community_id,platform_message_id,platform_user_id,cycle_id,topic_id,family,
    stage,incident_claimed,action,mute_minutes,notice_kind,notice_reserved_until)
    values(p_community_id,p_message_id,p_user_id,s.cycle_id,coalesce(p_topic_id,0),p_family,stage,true,action,mute_minutes,notice,
      case when notice is not null then t + interval '60 seconds' end);
  return jsonb_build_object('claimed',true,'stage',stage,'violationCount',s.violation_count,'action',action,'muteMinutes',mute_minutes,
    'notice',notice,'suppressionReason',suppressed,'priorMuteAt',s.last_mute_at,'priorPublicWarningAt',s.last_public_warning_at,
    'priorPublicWarningCount',s.public_warning_count,'heldForFinalWarning',held);
end;
$$;

-- Record the mute immediately, before slow generation, without consuming the
-- notice receipt. Idempotent; never attribute a failed operation as successful.
create or replace function public.record_quiet_moderation_restriction(p_community_id uuid,p_message_id text,p_mute_ok boolean,p_kick_ok boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e public.watch_quiet_moderation_events%rowtype; t timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_community_id::text,132));
  select * into e from public.watch_quiet_moderation_events where community_id=p_community_id and platform_message_id=p_message_id;
  if not found or not e.incident_claimed then return false; end if;
  update public.watch_quiet_moderation_events set mute_succeeded=mute_succeeded or (coalesce(p_mute_ok,false) and action='mute'),
    kick_succeeded=kick_succeeded or (coalesce(p_kick_ok,false) and action='kick') where community_id=p_community_id and platform_message_id=p_message_id;
  if p_mute_ok and e.action='mute' and not e.mute_succeeded then
    update public.watch_quiet_moderation_state set last_mute_at=t
      where community_id=p_community_id and platform_user_id=e.platform_user_id and cycle_id=e.cycle_id;
  end if;
  return true;
end;
$$;

-- Revalidate reservations immediately before sending; an expired lease cannot
-- bypass the global cap or send a stale warning after another violation.
create or replace function public.quiet_moderation_notice_valid(p_community_id uuid,p_message_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.watch_quiet_moderation_events e join public.watch_quiet_moderation_state s
    on s.community_id=e.community_id and s.platform_user_id=e.platform_user_id and s.cycle_id=e.cycle_id
    where e.community_id=p_community_id and e.platform_message_id=p_message_id and e.notice_kind is not null
      and e.finished_at is null and e.notice_reserved_until > now()
      and not exists(select 1 from public.watch_quiet_moderation_events newer where newer.community_id=e.community_id
        and newer.platform_user_id=e.platform_user_id and newer.cycle_id=e.cycle_id and newer.incident_claimed and newer.created_at > e.created_at));
$$;

create or replace function public.finish_quiet_moderation_notice(p_community_id uuid,p_message_id text,p_public_message_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e public.watch_quiet_moderation_events%rowtype; t timestamptz := clock_timestamp(); delivered boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_community_id::text,132));
  select * into e from public.watch_quiet_moderation_events where community_id=p_community_id and platform_message_id=p_message_id for update;
  if not found or not e.incident_claimed then return false; end if;
  if e.finished_at is not null then return true; end if;
  delivered := e.notice_kind is not null and p_public_message_id ~ '^[0-9]{1,30}$';
  update public.watch_quiet_moderation_events set finished_at=t, public_sent_at=case when delivered then t end,
    public_message_id=case when delivered then p_public_message_id end where community_id=p_community_id and platform_message_id=p_message_id;
  if delivered then
    update public.watch_quiet_moderation_state set last_public_warning_at=t,public_warning_count=public_warning_count+1,
      final_warning_at=case when e.notice_kind='final' then t else final_warning_at end
      where community_id=p_community_id and platform_user_id=e.platform_user_id and cycle_id=e.cycle_id;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_quiet_moderation(uuid,text,text,bigint,text,timestamptz,integer),
  public.record_quiet_moderation_restriction(uuid,text,boolean,boolean), public.quiet_moderation_notice_valid(uuid,text),
  public.finish_quiet_moderation_notice(uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_quiet_moderation(uuid,text,text,bigint,text,timestamptz,integer),
  public.record_quiet_moderation_restriction(uuid,text,boolean,boolean), public.quiet_moderation_notice_valid(uuid,text),
  public.finish_quiet_moderation_notice(uuid,text,text) to service_role;
commit;
