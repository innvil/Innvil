-- BYO Enterprise -- Phase 4.V.1 (2026-08-25): deployment-level attribution
-- on the existing BYO usage-telemetry ledger (watch_byo_ai_usage_events,
-- migration 0093). Closes part of the honest "still deferred" list from
-- Phase 4.V.1 -- until now the ledger recorded which account/community a
-- BYO-routed call belonged to, but never which specific Watcher deployment,
-- so the Usage page's "BYO calls" summary could only ever break down by
-- automation, never "which Watcher actually made these calls."
--
-- Additive/nullable, on delete set null (a deleted deployment must never
-- cascade-delete real historical telemetry -- the event still happened, it
-- just no longer has a live deployment to attribute to). Every call site
-- that records a BYO event already resolves a real deploymentId for the
-- separate, already-shipped usage-POLICY accounting (Phase 4.V.1, item 2) --
-- this migration just lets the same value be recorded on the telemetry
-- ledger too, threaded through in the accompanying code change.
alter table watch_byo_ai_usage_events
  add column if not exists deployment_id uuid references moderator_deployments (id) on delete set null;

create index if not exists idx_watch_byo_ai_usage_events_deployment on watch_byo_ai_usage_events (deployment_id, created_at desc);
