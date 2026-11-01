-- AI blog autopilot: DB-backed posts (draft → human-approved → published) + a
-- topic queue the super admin curates for the writer. The 3 hand-written cornerstone
-- guides stay in code (src/data/blog-posts.ts) and are merged with published rows at
-- read time — this table only holds AI-drafted / additional posts.

create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  description   text not null default '',
  tag           text not null default 'Guide',
  keywords      text[] not null default '{}',
  intro         text not null default '',
  sections      jsonb not null default '[]'::jsonb,   -- [{ h2, blocks: [...] }]
  cta           jsonb,                                 -- { heading, text } | null
  related       text[] not null default '{}',
  read_minutes  int not null default 5,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  source        text not null default 'ai'   check (source in ('ai','manual')),
  topic         text,                                  -- the queue topic it was generated from
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists blog_posts_status_pub_idx on public.blog_posts (status, published_at desc);

create table if not exists public.blog_topics (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null,
  keywords   text[] not null default '{}',
  status     text not null default 'pending' check (status in ('pending','used','skipped')),
  priority   int not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists blog_topics_status_idx on public.blog_topics (status, priority desc, created_at);

alter table public.blog_posts  enable row level security;
alter table public.blog_topics enable row level security;

-- Public can read only published posts (defense in depth; the SSR pages read via the
-- service role, but this keeps the anon client safe if ever used directly).
drop policy if exists "blog_posts public read published" on public.blog_posts;
create policy "blog_posts public read published"
  on public.blog_posts for select
  using (status = 'published');

-- Super admins can manage everything. (Server actions still gate in code and use the
-- service role, but this lets an authenticated super-admin client work too.)
drop policy if exists "blog_posts super admin all" on public.blog_posts;
create policy "blog_posts super admin all"
  on public.blog_posts for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));

drop policy if exists "blog_topics super admin all" on public.blog_topics;
create policy "blog_topics super admin all"
  on public.blog_topics for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin'));
