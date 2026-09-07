-- Schedules AI PR draft generation via Supabase pg_cron + pg_net.
-- Generates at most one draft per run only when eligible:
-- - Campaign active
-- - next_generation_date is due
-- - No unpublished PR in draft/reviewed/approved
--
-- Prereqs:
--   * Vault secret `app_url` (e.g. https://innvil.cloud)
--   * Vault secret `cron_secret` (same as app CRON_SECRET)
--   * AI env configured in app deployment (ANTHROPIC_API_KEY / model config)

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_pr_generation()
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
    url := rtrim(app_url, '/') || '/api/cron/generate-pr',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_pr_generation() from public;
grant execute on function public.trigger_pr_generation() to postgres;

do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-generate-pr'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

-- Daily schedule. Eligibility is checked inside the app logic,
-- so a daily trigger is sufficient and avoids cron drift complexity.
select cron.schedule(
  'innvil-generate-pr',
  '0 8 * * *',
  $$select public.trigger_pr_generation();$$
);
