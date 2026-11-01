-- ============================================================================
-- 0046_bot_acknowledgement.sql
-- Innvil Virtual Moderator — foundation for "Innvil Moderator Acknowledgement"
-- (bounded bot-to-bot acknowledgement between Innvil-managed moderators
-- deployed in the SAME community) + the update-idempotency ledger the
-- community-runtime webhook needs regardless of this feature.
--
--   communities.bot_ack_mode      per-community setting (§25), default OFF
--   deployment_state.*            bot-ack pacing counters (§17), reusing the
--                                 existing per-deployment pacing table rather
--                                 than a new one
--   telegram_processed_updates    Telegram update_id dedup ledger (§18) —
--                                 shared by ALL community-runtime event
--                                 handling, not bot-ack-specific
-- ============================================================================

begin;

alter table communities
  add column if not exists bot_ack_mode text not null default 'off'
    check (bot_ack_mode in ('off', 'reactions_only', 'acknowledgements', 'role_handoffs'));

alter table deployment_state
  add column if not exists last_bot_ack_at timestamptz,
  add column if not exists bot_acks_today integer not null default 0,
  add column if not exists bot_acks_day date;

create table if not exists telegram_processed_updates (
  integration_id uuid not null references telegram_bot_integrations (id) on delete cascade,
  update_id      bigint not null,
  created_at     timestamptz not null default now(),
  primary key (integration_id, update_id)
);
create index if not exists idx_telegram_processed_updates_created
  on telegram_processed_updates (created_at);

alter table telegram_processed_updates enable row level security;
-- No policies: service-role only (webhook handler), same as other pure
-- infra/dedup tables in this schema. Owners never need to read this.

commit;
