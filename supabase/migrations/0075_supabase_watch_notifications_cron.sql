-- Schedules the Innvil Watch "Needs Attention" digest cron via Supabase
-- pg_cron (project convention). Mirrors 0015/0026/0027/0034/0036/0056/0061.
--
-- Hourly is safe: the sweep itself (sweepAttentionNotifications,
-- watch-notifications.ts) enforces the real per-account 24h minimum
-- interval and only ever sends when there's real, current attention data
-- -- an hourly cron just means a new digest goes out close to whenever an
-- account's window opens, never that anyone is emailed hourly.
--
-- Prereqs (same vault secrets as the other crons): `app_url` + `cron_secret`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_watch_notifications()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  app_url text;
  cron_secret text;
begin
  select decrypted_secret
  into app_url
  from vault.decrypted_secrets
  where name = 'app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  order by created_at desc
  limit 1;

  if coalesce(app_url, '') = '' then
    raise exception 'Missing vault secret: app_url';
  end if;

  if coalesce(cron_secret, '') = '' then
    raise exception 'Missing vault secret: cron_secret';
  end if;

  return net.http_get(
    url := rtrim(app_url, '/') || '/api/cron/watch-notifications',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.trigger_watch_notifications() from public;
grant execute on function public.trigger_watch_notifications() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-watch-notifications'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-watch-notifications',
  '0 * * * *',
  $$select public.trigger_watch_notifications();$$
);
