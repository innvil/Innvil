-- Atomic room-wide claims: several watcher webhooks cannot pile onto one post.
begin;
create table if not exists public.watch_ambient_reaction_claims (
  community_id uuid not null references public.communities(id) on delete cascade,
  platform_message_id text not null,
  created_at timestamptz not null default now(),
  primary key (community_id, platform_message_id)
);
create index if not exists watch_ambient_reaction_claims_time on public.watch_ambient_reaction_claims(community_id, created_at desc);
alter table public.watch_ambient_reaction_claims enable row level security;
revoke all on public.watch_ambient_reaction_claims from public, anon, authenticated;

create or replace function public.claim_watch_ambient_reaction(p_community_id uuid, p_message_id text, p_is_admin boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed_at timestamptz := clock_timestamp(); last_claim timestamptz; hourly_count bigint;
begin
  if p_message_id is null or p_message_id !~ '^[0-9]{1,30}$' then return false; end if;
  -- Transaction-scoped lock serializes all deployments in this community.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_community_id::text, 131));
  if exists(select 1 from public.watch_ambient_reaction_claims where community_id = p_community_id and platform_message_id = p_message_id) then return false; end if;
  select max(created_at), count(*) into last_claim, hourly_count from public.watch_ambient_reaction_claims
    where community_id = p_community_id and created_at > claimed_at - interval '1 hour';
  if hourly_count >= 60 or last_claim > claimed_at - make_interval(secs => case when p_is_admin then 10 else 20 end) then return false; end if;
  -- Retain dedup evidence for two days, including failed/declined classifications.
  delete from public.watch_ambient_reaction_claims where community_id = p_community_id and created_at < claimed_at - interval '2 days';
  insert into public.watch_ambient_reaction_claims values (p_community_id, p_message_id, claimed_at);
  return true;
end;
$$;
revoke all on function public.claim_watch_ambient_reaction(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_watch_ambient_reaction(uuid, text, boolean) to service_role;
commit;
