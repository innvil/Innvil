-- 0095_supabase_watch_presence_cron.sql
-- Schedules the Watcher Presence Scheduling sweep (Phase 4.U) — mirrors
-- 0015/0026/0027/0034/0036/0056's exact pattern (shared vault app_url/
-- cron_secret). Every 5 minutes, matching Auto-Posting's own cadence.

create or replace function public.trigger_watch_presence_sweep()
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
    url := rtrim(app_url, '/') || '/api/cron/watch-presence',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.trigger_watch_presence_sweep() from public;
grant execute on function public.trigger_watch_presence_sweep() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-watch-presence-every-5-min'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-watch-presence-every-5-min',
  '*/5 * * * *',
  $$select public.trigger_watch_presence_sweep();$$
);
