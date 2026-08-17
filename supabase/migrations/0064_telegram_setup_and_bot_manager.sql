-- 0064_telegram_setup_and_bot_manager.sql
--
-- Phase 4.O (Telegram AI Moderator onboarding automation) + Phase 4.Q
-- (innvil_bot_manager -- Innvil's own product-facing bot). See
-- docs/moderator/telegram-bot-to-bot-onboarding-spec.md and
-- docs/moderator/innvil-bot-manager-spec.md.

begin;

-- ---------------------------------------------------------------- 4.O ----

-- Bot-to-Bot Communication Mode verification state (spec §13/§15) -- never
-- fabricated as "verified" from a checkbox; only set to verified_by_delivery
-- after an ACTUAL successful bot-ack delivery for this deployment.
alter table moderator_deployments add column if not exists bot_to_bot_status text not null default 'not_tested'
  check (bot_to_bot_status in ('not_tested', 'ready_for_test', 'verified_by_delivery', 'failed'));

-- Correlates an "Add to Telegram group" deep link (opaque startgroup
-- payload, spec §6) back to the Innvil deployment that initiated it --
-- deliberately NOT the visible startgroup value itself (which is just a
-- short random token, no tenant data), same principle as
-- telegram_provisioning_attempts' bot-CREATION correlation, but for
-- COMMUNITY-ADD correlation instead (a different step in the flow).
create table if not exists telegram_setup_sessions (
  id                uuid primary key default gen_random_uuid(),
  token             text not null unique, -- short opaque value actually placed in the startgroup param
  panel_id          uuid not null references panels (id) on delete cascade,
  virtual_moderator_id uuid not null references virtual_moderators (id) on delete cascade,
  initiator         text not null check (initiator in ('owner', 'customer')),
  customer_account_id uuid references customer_accounts (id) on delete cascade,
  status            text not null default 'pending' check (status in ('pending', 'consumed', 'expired', 'cancelled')),
  consumed_at       timestamptz,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);
create index if not exists idx_telegram_setup_sessions_token on telegram_setup_sessions (token);
create index if not exists idx_telegram_setup_sessions_panel on telegram_setup_sessions (panel_id);

alter table telegram_setup_sessions enable row level security;
-- No policies: service-role only (webhook/runtime), same pattern as every
-- other pure runtime-state table in this schema.

-- ---------------------------------------------------------------- 4.Q ----

-- Dedup ledger for innvil_bot_manager's OWN webhook -- a separate credential
-- from telegram_bot_integrations (this bot has no subscriber-owned
-- integration row to key telegram_processed_updates' FK against), same
-- insert-or-detect-duplicate pattern otherwise.
create table if not exists bot_manager_processed_updates (
  update_id  bigint primary key,
  created_at timestamptz not null default now()
);
create index if not exists idx_bot_manager_processed_updates_created
  on bot_manager_processed_updates (created_at);
alter table bot_manager_processed_updates enable row level security;

-- Every Telegram destination innvil_bot_manager is authorized to post into
-- or answer product questions in (spec "1. Proactive marketing messages").
create table if not exists bot_manager_chats (
  id                  uuid primary key default gen_random_uuid(),
  chat_id             text not null unique,
  chat_type           text not null check (chat_type in ('private', 'group', 'supergroup', 'channel')),
  title               text,
  marketing_enabled   boolean not null default true,
  support_enabled     boolean not null default true,
  joined_at           timestamptz not null default now(),
  last_marketing_message_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_bot_manager_chats_updated on bot_manager_chats;
create trigger trg_bot_manager_chats_updated
  before update on bot_manager_chats
  for each row execute function set_updated_at();

-- Approved-campaign-only sending (spec "9. Campaign controls, not
-- unrestricted auto-posting") -- AI may help write the copy, but nothing
-- sends until a superadmin sets approved = true.
create table if not exists bot_manager_campaigns (
  id              uuid primary key default gen_random_uuid(),
  campaign_type   text not null check (campaign_type in ('marketing_broadcast', 'product_announcement', 'release_update', 'service_notice', 'educational_tip')),
  message         text not null,
  target_audience text not null default 'all' check (target_audience in ('all', 'private_users', 'groups', 'channels')),
  status          text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  approved        boolean not null default false,
  approved_by     uuid references auth.users (id),
  approved_at     timestamptz,
  scheduled_at    timestamptz,
  sent_at         timestamptz,
  created_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_bot_manager_campaigns_updated on bot_manager_campaigns;
create trigger trg_bot_manager_campaigns_updated
  before update on bot_manager_campaigns
  for each row execute function set_updated_at();

-- Per-chat send log -- idempotency for a campaign sweep (never double-send
-- to the same chat for the same campaign on a retried/overlapping sweep)
-- and the "pacing / duplication checks" step from the spec's final
-- architecture diagram.
create table if not exists bot_manager_campaign_sends (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references bot_manager_campaigns (id) on delete cascade,
  chat_id      text not null,
  sent_at      timestamptz not null default now(),
  telegram_message_id text,
  error        text,
  unique (campaign_id, chat_id)
);

alter table bot_manager_chats enable row level security;
alter table bot_manager_campaigns enable row level security;
alter table bot_manager_campaign_sends enable row level security;
-- No policies on any of the three: service-role only (webhook/cron/
-- superadmin-action runtime), same pattern as every platform-wide
-- (non-panel-scoped) table in this schema.

commit;
