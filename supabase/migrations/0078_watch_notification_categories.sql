begin;

-- =========================================================================
-- Splits the single "Needs Attention alerts" toggle (migration 0074) into
-- real, distinct categories -- backs the denser, grouped-row Notifications
-- UI. Maps 1:1 onto the ALREADY-REAL severity partition
-- `listAccountAttentionItems` (watch-runtime.ts) already computes, never a
-- new invented classification:
--   HIGH   -- a Community has no active Watcher at all
--   MEDIUM -- Watcher/Community capacity nearing the plan limit
--   LOW    -- a Watcher is undeployed or paused
--
-- Additive only -- `attention_alerts_enabled` (0074) is left in place
-- rather than dropped (this codebase's standing "additive migrations only"
-- convention), but is no longer read/written by the app going forward; the
-- three new columns are the real source of truth. Existing rows are
-- backfilled from the old single toggle so nobody's preference silently
-- resets.
-- =========================================================================

alter table watch_notification_preferences
  add column if not exists no_active_watcher_enabled boolean not null default true,
  add column if not exists capacity_warning_enabled  boolean not null default true,
  add column if not exists watcher_status_enabled     boolean not null default true;

update watch_notification_preferences
set no_active_watcher_enabled = attention_alerts_enabled,
    capacity_warning_enabled  = attention_alerts_enabled,
    watcher_status_enabled    = attention_alerts_enabled;

commit;
