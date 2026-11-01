-- Read-only, paginated Watch account directory. No public/authenticated RPC.
begin;

create or replace function public.superadmin_watch_users(
  p_actor uuid, p_search text default '', p_page integer default 1,
  p_page_size integer default 25, p_recent_days integer default 0
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (select 1 from public.profiles where id = p_actor and role = 'super_admin') then
    raise exception 'Super admin only' using errcode = '42501';
  end if;
  with watch_entitlements as materialized (
    select e.* from public.product_entitlements e
    join public.products p on p.id = e.product_id and p.slug = 'watch'
  ), watcher_owners as materialized (
    select v.id, coalesce(v.account_id, p.owner_id) as account_id, v.created_at
    from public.virtual_moderators v left join public.panels p on p.id = v.panel_id
  ), evidence as (
    -- Signup origin is analytics only, NEVER a permission/entitlement grant.
    select u.id as account_id, u.created_at as seen_at from auth.users u
      where u.raw_user_meta_data->>'signup_product' = 'watch'
    union all select account_id, created_at from watch_entitlements
    union all select account_id, started_at from public.watch_trial_claims
    union all select account_id, created_at from public.watch_telegram_links
    union all select account_id, created_at from public.watch_account_preferences
    union all select account_id, created_at from watcher_owners
  ), first_seen as (
    select account_id, min(seen_at) as seen_at from evidence
    where account_id is not null group by account_id
  ), accounts as materialized (
    select u.id, coalesce(p.display_name, u.raw_user_meta_data->>'display_name') as display_name,
      u.email, u.created_at as registered_at, u.email_confirmed_at is not null as email_confirmed,
      f.seen_at as first_watch_at,
      case when u.raw_user_meta_data->>'signup_product' = 'watch' then 'signup' else 'activity' end as discovery,
      exists(select 1 from public.watch_telegram_links l where l.account_id = u.id) as telegram_verified,
      e.status as subscription_status, nullif(split_part(e.subscription_ref, ':', 1), '') as tier,
      coalesce(e.subscription_ref like '%:devops:%', false) as manual_grant,
      e.current_period_end, t.ends_at as trial_ends_at,
      (select count(*) from watcher_owners w where w.account_id = u.id) as watcher_count,
      case
        when e.status = 'active' and (e.current_period_end is null or e.current_period_end > now()) then 'subscription'
        when t.ends_at > now() then 'trial'
        when e.status = 'cancelled' then 'cancelled'
        when e.status = 'inactive' then 'inactive'
        when e.current_period_end <= now() or t.ends_at <= now() then 'expired'
        else 'onboarding'
      end as access_status
    from first_seen f join auth.users u on u.id = f.account_id
    left join public.profiles p on p.id = u.id
    left join watch_entitlements e on e.account_id = u.id
    left join public.watch_trial_claims t on t.account_id = u.id
  ), filtered as materialized (
    select * from accounts
    where (coalesce(p_search, '') = '' or position(lower(left(p_search, 120)) in lower(coalesce(email, '') || ' ' || coalesce(display_name, '') || ' ' || id::text)) > 0)
      and (coalesce(p_recent_days, 0) not in (7, 30) or first_watch_at >= now() - make_interval(days => p_recent_days))
  ), page_rows as (
    select * from filtered order by first_watch_at desc, id
    limit greatest(1, least(coalesce(p_page_size, 25), 100))
    offset ((greatest(1, least(coalesce(p_page, 1), 100000)) - 1)::bigint * greatest(1, least(coalesce(p_page_size, 25), 100)))
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'summary', (select jsonb_build_object('total', count(*),
      'new7Days', count(*) filter (where first_watch_at >= now() - interval '7 days'),
      'new30Days', count(*) filter (where first_watch_at >= now() - interval '30 days'),
      'activeSubscriptions', count(*) filter (where access_status = 'subscription'),
      'activeTrials', count(*) filter (where access_status = 'trial')) from accounts),
    'users', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'displayName', display_name, 'email', email, 'registeredAt', registered_at,
      'emailConfirmed', email_confirmed, 'firstWatchAt', first_watch_at, 'discovery', discovery,
      'telegramVerified', telegram_verified, 'subscriptionStatus', subscription_status,
      'tier', tier, 'manualGrant', manual_grant, 'periodEnd', current_period_end,
      'trialEndsAt', trial_ends_at, 'watcherCount', watcher_count, 'accessStatus', access_status
    ) order by first_watch_at desc, id) from page_rows), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.superadmin_watch_users(uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.superadmin_watch_users(uuid, text, integer, integer, integer) to service_role;
commit;
