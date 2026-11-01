-- BYO Enterprise usage telemetry -- real token counts + call duration
-- (Phase 4.V.1, items 1 and 3 off the honest deferred list, closed
-- 2026-08-25 once aiComplete() gained a real per-call usage return path --
-- see src/lib/ai/client.ts's new aiCompleteWithMeta()). Additive/nullable
-- on watch_byo_ai_usage_events (migration 0093) -- an event with no
-- observed usage (e.g. a call site with no clean usage signal to report)
-- simply has null values here, never a fabricated 0 that would look like a
-- genuinely free call.

alter table watch_byo_ai_usage_events
  add column if not exists input_tokens int,
  add column if not exists output_tokens int,
  add column if not exists duration_ms int;
