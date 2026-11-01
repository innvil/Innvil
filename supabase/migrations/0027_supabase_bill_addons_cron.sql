-- Schedules the add-on / plan recurring-billing cron via Supabase pg_cron
-- (project convention). Mirrors 0015 (order-sync) and 0026 (blog).
--
-- Charges due Customer AI Support add-ons and Campaign Automation plans from each
-- panel's Innvil balance; pauses/lapses them when a panel can't cover the charge.
-- Runs daily at 06:00 UTC and only bills subscriptions whose next-charge date has
-- passed, so running daily is safe.
--
-- Prereqs (same vault secrets as the other crons): `app_url` + `cron_secret`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_bill_addons()
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
    url := rtrim(app_url, '/') || '/api/cron/bill-addons',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.trigger_bill_addons() from public;
grant execute on function public.trigger_bill_addons() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-bill-addons'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-bill-addons',
  '0 6 * * *',
  $$select public.trigger_bill_addons();$$
);
