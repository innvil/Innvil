-- BYO Enterprise -- Phase 2 (2026-08-24): real usage telemetry for calls
-- routed through a BYO account's own AI provider credential (see
-- watch-runtime.ts's resolveAccountAiRouting / watch-byo.ts).
--
-- A plain call/outcome LEDGER, not a token-cost accounting system -- per-
-- call token counts are a deliberate Phase-2 limitation (would require a
-- broader aiComplete() return-shape change across every existing caller,
-- see watch-byo-usage.ts's own doc comment). Records only what Innvil can
-- genuinely observe today: which account, which automation, which
-- provider/model, whether the call succeeded, and when.
--
-- Recorded fire-and-forget from community-runtime.ts (never awaited on the
-- critical path -- a telemetry write must never add latency to the
-- 30s-bounded Telegram webhook handler, and a write failure must never
-- break moderation/chatter).
create table if not exists watch_byo_ai_usage_events (
  id           bigint generated always as identity primary key,
  account_id   uuid not null references profiles (id) on delete cascade,
  community_id uuid references communities (id) on delete set null,
  automation   text not null,
  provider     text not null,
  model        text not null,
  ok           boolean not null,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_watch_byo_ai_usage_events_account on watch_byo_ai_usage_events (account_id, created_at desc);

alter table watch_byo_ai_usage_events enable row level security;
-- No policies: service-role only (runtime write + Usage-page read), same
-- convention as every other Watch runtime/usage table.
