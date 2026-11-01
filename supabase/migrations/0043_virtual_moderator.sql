-- ============================================================================
-- 0043_virtual_moderator.sql
-- Innvil Virtual Moderator — domain foundation.
--
-- Replaces the collapsed single-JSON-blob prototype (old panels.settings.moderator
-- + the original moderator_spam_hits) with a real relational domain:
--
--   virtual_moderators          reusable moderator identity/persona (tenant-owned)
--   telegram_bot_integrations   the subscriber-owned Telegram bot credential (1:1 moderator)
--   telegram_provisioning_attempts  correlates the Managed-Bot deep-link handoff back to a draft
--   communities                 a Telegram chat/channel Innvil knows about
--   moderator_deployments       ONE moderator assigned to ONE community (Active Mod Slot unit)
--   deployment_state            per-deployment runtime/social-pacing state
--   moderator_spam_hits         moderation strikes, scoped by community + sender (not deployment)
--   moderator_activity_log      operational decision log (reason codes, not hidden reasoning)
--
-- Tenant unit = panels (Innvil's existing tenant/account concept). Encryption
-- reuses the pgcrypto pattern from 0005_payment_gateways.sql (PROVIDER_KEY_SECRET,
-- same secret already used for provider credentials — no new encryption system).
-- Requires 0001 (pgcrypto, set_updated_at) and 0002 (is_panel_member, is_super_admin).
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- moderators ----

create table if not exists virtual_moderators (
  id                    uuid primary key default gen_random_uuid(),
  panel_id              uuid not null references panels (id) on delete cascade,
  name                  text not null,
  status                text not null default 'draft'
                          check (status in ('draft', 'active', 'paused', 'archived')),
  persona               jsonb not null default '{}',   -- ModeratorPersona (tone, language, humor, custom instructions...)
  provisioning_status   text not null default 'draft'
                          check (provisioning_status in (
                            'draft', 'telegram_confirmation_pending', 'telegram_created',
                            'credential_setup', 'bot_ready', 'community_setup_required', 'active',
                            'cancelled', 'username_unavailable', 'telegram_creation_failed',
                            'credential_setup_failed', 'expired', 'requires_retry'
                          )),
  provisioning_draft    jsonb not null default '{}',   -- pre-creation fields (requested username, avatar, preset)
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_virtual_moderators_panel on virtual_moderators (panel_id);

drop trigger if exists trg_virtual_moderators_updated on virtual_moderators;
create trigger trg_virtual_moderators_updated before update on virtual_moderators
  for each row execute function set_updated_at();

-- ------------------------------------------------------- telegram integrations ----
-- The subscriber-owned bot identity (@mika_mod_bot). One per VirtualModerator.
-- credential_enc is the managed-bot token (from getManagedBotToken) OR a
-- BotFather-pasted token (fallback path) — same encrypted column either way.

create table if not exists telegram_bot_integrations (
  id                    uuid primary key default gen_random_uuid(),
  panel_id              uuid not null references panels (id) on delete cascade,
  virtual_moderator_id  uuid not null unique references virtual_moderators (id) on delete cascade,
  telegram_bot_id       bigint,
  username              text,
  source                text not null default 'managed' check (source in ('managed', 'botfather')),
  manager_relationship  text not null default 'pending'
                          check (manager_relationship in ('pending', 'active', 'revoked', 'unknown')),
  credential_enc        bytea,                          -- pgp_sym_encrypt(bot token, secret)
  last_verified_at      timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (panel_id, telegram_bot_id)
);
create index if not exists idx_telegram_bot_integrations_panel on telegram_bot_integrations (panel_id);

drop trigger if exists trg_telegram_bot_integrations_updated on telegram_bot_integrations;
create trigger trg_telegram_bot_integrations_updated before update on telegram_bot_integrations
  for each row execute function set_updated_at();

-- Key encryption (mirrors set_provider_key / set_gateway_key). Never store the secret.
create or replace function set_telegram_bot_key(p_row uuid, p_key text, p_secret text)
returns void language sql security definer set search_path = public, extensions as $$
  update telegram_bot_integrations
     set credential_enc = pgp_sym_encrypt(p_key, p_secret)
   where id = p_row;
$$;

create or replace function get_telegram_bot_key(p_row uuid, p_secret text)
returns text language sql security definer set search_path = public, extensions as $$
  select pgp_sym_decrypt(credential_enc, p_secret)
    from telegram_bot_integrations
   where id = p_row;
$$;

revoke select (credential_enc) on telegram_bot_integrations from anon, authenticated;
revoke all on function set_telegram_bot_key(uuid, text, text) from anon, authenticated;
revoke all on function get_telegram_bot_key(uuid, text)       from anon, authenticated;
grant execute on function set_telegram_bot_key(uuid, text, text) to service_role;
grant execute on function get_telegram_bot_key(uuid, text)       to service_role;

-- ------------------------------------------------- provisioning correlation ----
-- Telegram's managed-bot deep link (t.me/newbot/<manager>/<suggested_username>)
-- carries no custom correlation param, so the Manager Bot's webhook must match
-- an incoming ManagedBotCreated update back to the draft that requested it. We
-- match on suggested_username + a short expiry window (usernames are globally
-- unique on Telegram, so this is a safe best-effort correlation key).

create table if not exists telegram_provisioning_attempts (
  id                    uuid primary key default gen_random_uuid(),
  panel_id              uuid not null references panels (id) on delete cascade,
  virtual_moderator_id  uuid not null references virtual_moderators (id) on delete cascade,
  suggested_username    text not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'matched', 'expired', 'cancelled')),
  matched_telegram_bot_id bigint,
  matched_at            timestamptz,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now()
);
create index if not exists idx_telegram_provisioning_lookup
  on telegram_provisioning_attempts (suggested_username, status);
create index if not exists idx_telegram_provisioning_panel
  on telegram_provisioning_attempts (panel_id);

-- ----------------------------------------------------------------- communities ----

create table if not exists communities (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  platform     text not null default 'telegram',
  chat_id      text not null,                 -- Telegram chat id (string; groups are negative)
  handle       text,
  title        text,
  chat_type    text,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (panel_id, platform, chat_id)
);
create index if not exists idx_communities_panel on communities (panel_id);

drop trigger if exists trg_communities_updated on communities;
create trigger trg_communities_updated before update on communities
  for each row execute function set_updated_at();

-- ------------------------------------------------------- moderator deployments ----
-- ONE VirtualModerator assigned to ONE Community = 1 Active Mod Slot.

create table if not exists moderator_deployments (
  id             uuid primary key default gen_random_uuid(),
  panel_id       uuid not null references panels (id) on delete cascade,
  moderator_id   uuid not null references virtual_moderators (id) on delete cascade,
  community_id   uuid not null references communities (id) on delete cascade,
  enabled        boolean not null default true,
  role           text not null default 'general'
                   check (role in ('general', 'chatter', 'moderation', 'engagement', 'content', 'business_knowledge')),
  overrides      jsonb not null default '{}',   -- persona/behavior overrides for this deployment
  health         jsonb not null default '{}',   -- {present, canSend, canDelete, canRestrict, checkedAt}
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (moderator_id, community_id)
);
create index if not exists idx_moderator_deployments_panel on moderator_deployments (panel_id);
create index if not exists idx_moderator_deployments_community on moderator_deployments (community_id);
create index if not exists idx_moderator_deployments_enabled
  on moderator_deployments (panel_id) where enabled = true;

drop trigger if exists trg_moderator_deployments_updated on moderator_deployments;
create trigger trg_moderator_deployments_updated before update on moderator_deployments
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------- deployment state ----

create table if not exists deployment_state (
  deployment_id            uuid primary key references moderator_deployments (id) on delete cascade,
  last_spoke_at            timestamptz,
  messages_recent          integer not null default 0,
  consecutive_messages     integer not null default 0,
  proactive_actions_today  integer not null default 0,
  last_proactive_at        timestamptz,
  topic_summary            text,
  updated_at               timestamptz not null default now()
);

-- ----------------------------------------------------------------- moderation state ----
-- Scoped by panel + community + sender (the Telegram user), NOT by deployment:
-- a spam strike is a community-policy fact about a member, independent of which
-- deployed moderator happened to catch it. `last_deployment_id` records WHO acted
-- for audit purposes only — it is not part of the enforcement key.

create table if not exists moderator_spam_hits (
  panel_id           uuid not null references panels (id) on delete cascade,
  community_id       uuid not null references communities (id) on delete cascade,
  sender_platform_id text not null,
  hit_count          integer not null default 0,
  last_message_id    text,
  last_hit_at        timestamptz not null default now(),
  banned_at          timestamptz,
  last_reason        text,
  last_deployment_id uuid references moderator_deployments (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (panel_id, community_id, sender_platform_id)
);
create index if not exists idx_moderator_spam_hits_community
  on moderator_spam_hits (panel_id, community_id);
create index if not exists idx_moderator_spam_hits_banned
  on moderator_spam_hits (panel_id, community_id, banned_at);

-- ----------------------------------------------------------------- activity log ----
-- Structured operational log (§33): reason CODES, never hidden model chain-of-thought.

create table if not exists moderator_activity_log (
  id             bigint generated always as identity primary key,
  panel_id       uuid not null references panels (id) on delete cascade,
  community_id   uuid references communities (id) on delete set null,
  deployment_id  uuid references moderator_deployments (id) on delete set null,
  event_type     text not null,      -- normalized CommunityEvent type
  decision       text not null,      -- IGNORE / REACT / CHAT_REPLY / WARN / DELETE / RESTRICT / ...
  reason_code    text,
  model          text,
  delivery_status text,
  meta           jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index if not exists idx_moderator_activity_log_panel
  on moderator_activity_log (panel_id, created_at desc);
create index if not exists idx_moderator_activity_log_community
  on moderator_activity_log (community_id, created_at desc);

-- ---------------------------------------------------------------------- RLS ----
-- Defense in depth (owner actions use the service-role client + code-level
-- ownership checks, same pattern as panels/providers elsewhere in this repo).

alter table virtual_moderators             enable row level security;
alter table telegram_bot_integrations      enable row level security;
alter table telegram_provisioning_attempts enable row level security;
alter table communities                    enable row level security;
alter table moderator_deployments          enable row level security;
alter table deployment_state               enable row level security;
alter table moderator_spam_hits            enable row level security;
alter table moderator_activity_log         enable row level security;

drop policy if exists virtual_moderators_admin on virtual_moderators;
create policy virtual_moderators_admin on virtual_moderators for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists telegram_bot_integrations_admin on telegram_bot_integrations;
create policy telegram_bot_integrations_admin on telegram_bot_integrations for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists telegram_provisioning_attempts_admin on telegram_provisioning_attempts;
create policy telegram_provisioning_attempts_admin on telegram_provisioning_attempts for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists communities_admin on communities;
create policy communities_admin on communities for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists moderator_deployments_admin on moderator_deployments;
create policy moderator_deployments_admin on moderator_deployments for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists deployment_state_admin on deployment_state;
create policy deployment_state_admin on deployment_state for all
  using (exists (
    select 1 from moderator_deployments d
     where d.id = deployment_state.deployment_id
       and (is_panel_member(d.panel_id) or is_super_admin())
  ))
  with check (exists (
    select 1 from moderator_deployments d
     where d.id = deployment_state.deployment_id
       and (is_panel_member(d.panel_id) or is_super_admin())
  ));

drop policy if exists moderator_spam_hits_admin on moderator_spam_hits;
create policy moderator_spam_hits_admin on moderator_spam_hits for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

drop policy if exists moderator_activity_log_admin on moderator_activity_log;
create policy moderator_activity_log_admin on moderator_activity_log for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());
