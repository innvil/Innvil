-- 0060_pr_generator.sql
-- Superadmin PR generator foundation (Phase A):
-- - PR campaigns/settings
-- - Press release lifecycle records
-- - Fact library + compliance/report traces
-- Safe to re-run.

begin;

create table if not exists public.pr_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default PR Campaign',
  interval_days int not null default 30 check (interval_days >= 1),
  active boolean not null default true,
  last_generated_at timestamptz,
  last_published_externally_at timestamptz,
  next_generation_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.press_releases (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.pr_campaigns(id) on delete cascade,
  title text not null,
  slug text not null unique,
  summary text not null default '',
  body jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'approved', 'published_externally', 'rejected')),
  source text not null default 'manual' check (source in ('ai', 'manual')),
  topic text,
  compliance_status text not null default 'pending' check (compliance_status in ('pending', 'pass', 'fail')),
  external_url text,
  external_publication_name text,
  external_publication_date date,
  external_headline text,
  external_notes text,
  published_externally_at timestamptz,
  published_externally_by uuid references public.profiles(id) on delete set null,
  featured_article_id uuid references public.blog_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pr_external_url_when_published check (
    status <> 'published_externally' or (external_url is not null and length(trim(external_url)) > 0)
  )
);

create table if not exists public.pr_fact_library (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'general',
  content text not null,
  source_url text,
  effective_from date,
  effective_to date,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pr_claim_sources (
  id uuid primary key default gen_random_uuid(),
  press_release_id uuid not null references public.press_releases(id) on delete cascade,
  claim_text text not null,
  fact_library_id uuid references public.pr_fact_library(id) on delete set null,
  source_url text,
  confidence numeric(5,2),
  created_at timestamptz not null default now()
);

create table if not exists public.pr_compliance_reports (
  id uuid primary key default gen_random_uuid(),
  press_release_id uuid not null references public.press_releases(id) on delete cascade,
  status text not null check (status in ('pass', 'fail')),
  checks jsonb not null default '{}'::jsonb,
  summary text not null default '',
  raw_feedback text,
  created_at timestamptz not null default now()
);

create index if not exists idx_press_releases_campaign_status_created
  on public.press_releases (campaign_id, status, created_at desc);
create index if not exists idx_press_releases_external_date
  on public.press_releases (external_publication_date desc);
create index if not exists idx_pr_fact_library_active
  on public.pr_fact_library (active, created_at desc);
create index if not exists idx_pr_claim_sources_press_release
  on public.pr_claim_sources (press_release_id);
create index if not exists idx_pr_compliance_reports_press_release
  on public.pr_compliance_reports (press_release_id, created_at desc);

-- Keep updated_at maintained using the existing helper from 0001_init.
drop trigger if exists trg_pr_campaigns_updated on public.pr_campaigns;
create trigger trg_pr_campaigns_updated before update on public.pr_campaigns
  for each row execute function public.set_updated_at();

drop trigger if exists trg_press_releases_updated on public.press_releases;
create trigger trg_press_releases_updated before update on public.press_releases
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pr_fact_library_updated on public.pr_fact_library;
create trigger trg_pr_fact_library_updated before update on public.pr_fact_library
  for each row execute function public.set_updated_at();

alter table public.pr_campaigns enable row level security;
alter table public.press_releases enable row level security;
alter table public.pr_fact_library enable row level security;
alter table public.pr_claim_sources enable row level security;
alter table public.pr_compliance_reports enable row level security;

-- Superadmin-only access.
drop policy if exists pr_campaigns_super_admin_all on public.pr_campaigns;
create policy pr_campaigns_super_admin_all
  on public.pr_campaigns for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists press_releases_super_admin_all on public.press_releases;
create policy press_releases_super_admin_all
  on public.press_releases for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists pr_fact_library_super_admin_all on public.pr_fact_library;
create policy pr_fact_library_super_admin_all
  on public.pr_fact_library for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists pr_claim_sources_super_admin_all on public.pr_claim_sources;
create policy pr_claim_sources_super_admin_all
  on public.pr_claim_sources for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists pr_compliance_reports_super_admin_all on public.pr_compliance_reports;
create policy pr_compliance_reports_super_admin_all
  on public.pr_compliance_reports for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Ensure there is always one default campaign for v1 workflows.
insert into public.pr_campaigns (id, name, interval_days, active)
select gen_random_uuid(), 'Default PR Campaign', 30, true
where not exists (select 1 from public.pr_campaigns);

commit;
