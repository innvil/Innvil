-- Watcher Presence Scheduling (Phase 4.U, 2026-08-25) -- deployed Watchers
-- auto-stagger being "conversationally present," sending a persona-voiced
-- arrival/departure message on a schedule. Full spec:
-- docs/moderator/watcher-presence-scheduling-spec.md.
--
-- Ownership: a Presence Schedule belongs to the DEPLOYMENT (Watcher <->
-- Community assignment), never the Watcher Profile (reusable across future
-- multi-Community deployments) and never a Community-owned/shared persona.
-- Ownership is derivable through the SAME existing chain every other Watch
-- table uses: moderator_deployments -> community_id -> communities.project_id
-- -> projects.account_id (resolveDeploymentTenant, watch-runtime.ts) -- zero-
-- Panel compatible, no synthetic Panel, no new ownership column needed here.
--
-- Three tables, deliberately kept to this minimum (per the spec's own
-- "do not blindly implement every concept as a separate table" instruction):
--   1. community_presence_settings -- community-WIDE settings (mode, stagger
--      cadence, coverage window, announce-message toggles). One row per
--      community, lazily created on first configuration.
--   2. deployment_presence_config -- per-deployment schedule config. The
--      runtime ALWAYS reads the three resolved columns (anchor_utc,
--      active_minutes, cycle_minutes) directly, regardless of whether they
--      were populated by the Recommended formula or a Custom override --
--      "mode" only matters for the UI/write path, never the runtime hot path.
--   3. deployment_presence_state -- the persisted RUNTIME state + idempotency
--      identity (current_interval_key). A repeated cron tick within the same
--      logical interval is a guaranteed no-op by comparing this column --
--      this is what makes a transition fire "at most once for the same
--      logical occurrence" (spec's hard idempotency requirement).
--
-- IMPORTANT (spec's own explicit requirement): every existing deployment
-- defaults to presence scheduling OFF (enabled default false, no backfill
-- inserts here) -- this migration must never cause a live Watcher to start
-- sending unsolicited social messages merely because it ran.

create table if not exists community_presence_settings (
  community_id            uuid primary key references communities (id) on delete cascade,
  mode                    text not null default 'recommended' check (mode in ('recommended', 'custom')),
  stagger_minutes         int not null default 120,
  -- The fixed UTC instant computeRecommendedSchedule() anchors every
  -- deployment's rotation to. Recomputed ONLY by an explicit "Reset to
  -- Recommended"/first-enable action (watch-presence.ts) -- never
  -- implicitly on an unrelated settings save, so an already-running
  -- rotation's timing never silently shifts.
  reference_utc           timestamptz,
  coverage_start_minutes  int,
  coverage_end_minutes    int,
  announce_start          boolean not null default true,
  announce_return         boolean not null default true,
  announce_end            boolean not null default true,
  updated_at              timestamptz not null default now()
);

create table if not exists deployment_presence_config (
  id              uuid primary key default gen_random_uuid(),
  deployment_id   uuid not null unique references moderator_deployments (id) on delete cascade,
  enabled         boolean not null default false,
  order_index     int not null default 0,
  anchor_utc      timestamptz,
  active_minutes  int,
  cycle_minutes   int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists deployment_presence_state (
  deployment_id         uuid primary key references moderator_deployments (id) on delete cascade,
  state                 text not null default 'away' check (state in ('active', 'away')),
  current_interval_key  text,
  last_transition_at    timestamptz,
  updated_at            timestamptz not null default now()
);

alter table community_presence_settings enable row level security;
alter table deployment_presence_config enable row level security;
alter table deployment_presence_state enable row level security;
-- No policies on any of the three: service-role only (owner action layer +
-- cron sweep), same convention as every other Watch runtime/config table.
