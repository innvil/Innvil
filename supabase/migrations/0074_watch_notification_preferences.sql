begin;

-- =========================================================================
-- Real account-level notification preferences for Innvil Watch -- backs the
-- "Notifications" section of Settings. Deliberately scoped to the ONE
-- signal this codebase can already compute honestly today: Needs Attention
-- (a Community with no active Watcher, or Watcher/Community capacity
-- nearing the plan limit -- listAccountAttentionItems in watch-runtime.ts,
-- already real, already shown on Overview). No preference for "failed
-- Auto-Posts" or "billing notices" is added -- neither has any real trigger
-- anywhere in this codebase yet (Auto-Posting has no account-scoped backend
-- at all; there's no subscription-lifecycle event that fires today), and
-- shipping a toggle with nothing behind it is exactly what this product's
-- own conventions forbid.
-- =========================================================================

create table if not exists watch_notification_preferences (
  account_id                uuid primary key references profiles (id) on delete cascade,
  attention_alerts_enabled  boolean not null default true,
  last_digest_sent_at       timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table watch_notification_preferences enable row level security;
-- No policies -- service-role only, same convention as every other Watch
-- runtime/preferences table (read/written exclusively via server actions
-- and the cron sweep, never a browser-side Supabase client).

commit;
