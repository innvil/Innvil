-- Schedules the Binance Pay deposit poller via Supabase pg_cron (project convention).
-- Mirrors 0015 (order-sync), 0026 (blog) and 0027 (bill-addons).
--
-- For every panel with an open Binance deposit, syncs the owner's Pay history and
-- auto-credits any deposit whose unique payable amount matches an incoming transaction.
-- Runs every minute (deposits expire in 10 minutes, so a tight cadence keeps auto-credit
-- responsive). Safe to run frequently — it only touches panels with open deposits.
--
-- Prereqs (same vault secrets as the other crons): `app_url` + `cron_secret`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_binance_sync()
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
    url := rtrim(app_url, '/') || '/api/cron/binance-sync',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.trigger_binance_sync() from public;
grant execute on function public.trigger_binance_sync() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-binance-sync'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-binance-sync',
  '* * * * *',
  $$select public.trigger_binance_sync();$$
);
