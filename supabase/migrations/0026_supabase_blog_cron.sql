-- Schedules the AI blog-draft generation cron via Supabase pg_cron (project
-- convention — not vercel.json). Mirrors 0015_supabase_order_sync_cron.sql.
--
-- Prereqs (same as the order-sync cron):
--   * Vault secrets `app_url` (e.g. https://innvil.cloud) and `cron_secret`
--     (must equal the CRON_SECRET env var the app reads).
--   * ANTHROPIC_API_KEY set on the app so generation can run.
--
-- Generates ONE draft per day at 09:00 UTC. Nothing is auto-published — a super
-- admin reviews + publishes from /superadmin → Blog.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.trigger_blog_generation()
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

  -- Long timeout: generation calls the AI model and can take 30–60s. Keeping the
  -- pg_net connection open until the app responds ensures the draft is written.
  return net.http_get(
    url := rtrim(app_url, '/') || '/api/cron/generate-blog',
    params := jsonb_build_object(
      'secret', cron_secret,
      'source', 'supabase-cron'
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function public.trigger_blog_generation() from public;
grant execute on function public.trigger_blog_generation() to postgres;

-- Replace any existing job of the same name (e.g. a misconfigured earlier one).
do $$
declare
  existing_job_id bigint;
begin
  select jobid into existing_job_id
  from cron.job
  where jobname = 'innvil-generate-blog'
  limit 1;

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'innvil-generate-blog',
  '0 9 * * *',
  $$select public.trigger_blog_generation();$$
);
