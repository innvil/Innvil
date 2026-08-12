-- 0055_autopost.sql
-- Phase 4.N part B: AI Telegram Auto-Posting, per-moderator posting windows.
-- See docs/moderator/project-knowledge-autoposting-spec.md's "AUTO-POSTING
-- UPDATE -- Per-Moderator Posting Windows" section (supersedes the base
-- spec's earlier §13-15/§24): each Virtual Moderator IS the visible
-- Telegram publisher for its own assigned window -- there is no generic
-- Innvil publishing bot.
--
-- communities.timezone is a REAL addition (no per-community timezone field
-- existed anywhere in the schema before this -- the reactive quota system
-- (v1.7.0) uses UTC-calendar-day as a stand-in specifically because nothing
-- better existed). Auto-posting windows are meaningless without real local
-- hour-of-day semantics (a "5am-12pm" window that's actually UTC would post
-- at the wrong local hours for a non-UTC community), so this migration adds
-- the genuine column rather than reusing the UTC stand-in.
--
-- Overnight windows (e.g. 22:00-02:00) are REJECTED at the application layer
-- (see autopost.ts's validateWindow) rather than implemented ambiguously,
-- per the spec's own explicit fallback instruction (§8 of the update
-- section: "if the existing scheduler cannot safely support this yet,
-- reject rather than implementing ambiguous behavior").

begin;

alter table communities add column if not exists timezone text not null default 'UTC';

create table if not exists auto_post_windows (
  id                      uuid primary key default gen_random_uuid(),
  panel_id                uuid not null references panels (id) on delete cascade,
  community_id            uuid not null references communities (id) on delete cascade,
  moderator_deployment_id uuid not null references moderator_deployments (id) on delete cascade,
  start_local_time        text not null, -- "HH:MM", 24h, community's own timezone
  end_local_time          text not null, -- "HH:MM", 24h; must be strictly after start_local_time (no overnight support -- see header)
  enabled                 boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_auto_post_windows_community on auto_post_windows (community_id) where enabled;
create index if not exists idx_auto_post_windows_deployment on auto_post_windows (moderator_deployment_id);

drop trigger if exists trg_auto_post_windows_updated on auto_post_windows;
create trigger trg_auto_post_windows_updated
  before update on auto_post_windows
  for each row execute function set_updated_at();

-- One row per (window, local calendar day) -- the unique constraint IS the
-- "at most one occurrence per window per day" guarantee (spec §5). The
-- random scheduled_for is generated ONCE when the row is created and never
-- recomputed (spec §5's own critical warning against re-rolling per cron
-- tick).
create table if not exists auto_post_occurrences (
  id                    uuid primary key default gen_random_uuid(),
  auto_post_window_id   uuid not null references auto_post_windows (id) on delete cascade,
  local_date            date not null,
  scheduled_for         timestamptz not null,
  status                text not null default 'scheduled'
                          check (status in ('scheduled', 'generating', 'generated', 'publishing', 'published', 'publish_failed', 'failed', 'missed', 'cancelled')),
  generated_title       text,
  generated_content     text,
  published_message_id text,
  published_at          timestamptz,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (auto_post_window_id, local_date)
);
create index if not exists idx_auto_post_occurrences_window on auto_post_occurrences (auto_post_window_id);
create index if not exists idx_auto_post_occurrences_due on auto_post_occurrences (status, scheduled_for) where status = 'scheduled';

drop trigger if exists trg_auto_post_occurrences_updated on auto_post_occurrences;
create trigger trg_auto_post_occurrences_updated
  before update on auto_post_occurrences
  for each row execute function set_updated_at();

alter table auto_post_windows enable row level security;
alter table auto_post_occurrences enable row level security;
-- No policies: service-role only (owner action + cron sweep), same pattern
-- as every other moderator config/runtime table.

commit;
