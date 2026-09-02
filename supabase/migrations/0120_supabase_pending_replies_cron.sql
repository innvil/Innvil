-- Schedules the pending-Watcher-reply sweep via Supabase pg_cron (project
-- convention -- mirrors 0015/0026/0027/0034/0036/0056/0075/0095/0101's
-- exact pattern, shared vault app_url/cron_secret).
--
-- Runs every minute -- the finest granularity already proven safe in this
-- schema (0034's Binance-deposit poller). A pending reply's real send
-- therefore lands somewhere in the 120-180 second range after its
-- triggering message (worst case: scheduled right after a sweep tick just
-- ran, waits nearly a full extra minute for the next one) -- CANCELLATION
-- is NOT gated by this cadence at all (it happens synchronously, in the
-- same webhook invocation, the instant an admin/mod's message arrives), so
-- the only thing this cadence affects is how close to exactly 120 seconds
-- a genuinely-unanswered reply fires, never how quickly an admin's answer
-- suppresses it.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_pending_replies_sweep()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  app_url text;
  cron_secret text;
begin
  select decrypted_secret into app_url
  from vault.decrypted_secrets where name = 'app_url' order by created_at desc limit 1;

  select decrypted_secret into cron_secret
  from vault.decrypted_secrets where name = 'cron_secret' order by created_at desc limit 1;

  if coalesce(app_url, '') = '' then
    raise exception 'Missing vault secret: app_url';
  end if;
  if coalesce(cron_secret, '') = '' then
    raise exception 'Missing vault secret: cron_secret';
  end if;

  return net.http_get(
    url := rtrim(app_url, '/') || '/api/cron/pending-replies',
    params := jsonb_build_object('secret', cron_secret, 'source', 'supabase-cron'),
    timeout_milliseconds := 20000
  );
end;
$$;

revoke all on function public.trigger_pending_replies_sweep() from public;
grant execute on function public.trigger_pending_replies_sweep() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname = 'innvil-pending-replies-every-minute' limit 1;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-pending-replies-every-minute',
  '* * * * *',
  $$select public.trigger_pending_replies_sweep();$$
);
