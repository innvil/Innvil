-- BYO Enterprise -- Phase 1: real entitlement representation + credential
-- storage. "BYO" (Bring Your Own [AI provider credential]) is a real,
-- priced Enterprise commercial mode (watch-enterprise.ts's WATCH_ENTERPRISE_
-- BYO_TIERS) that has existed as pricing copy only until now -- there was
-- no schema/storage/grant path at all.
--
-- api_source_mode is only meaningful for tier='enterprise' rows (subscription_ref
-- starting "enterprise:") -- NULL means Managed, matching the existing
-- documented default ("every tier==='enterprise' account today IS de facto
-- Managed"). Additive, no backfill needed.
alter table product_entitlements add column if not exists api_source_mode text;
alter table product_entitlements drop constraint if exists product_entitlements_api_source_mode_check;
alter table product_entitlements add constraint product_entitlements_api_source_mode_check
  check (api_source_mode is null or api_source_mode in ('managed', 'byo'));

-- The BYO account's own AI provider credential -- a SEPARATE table (not a
-- column on product_entitlements), mirroring telegram_bot_integrations'
-- own separate credential table for its own separate credential concept.
-- Encrypted the SAME way every other external credential in this schema
-- is (providers.api_key_enc, payment_gateways.api_key_enc,
-- platform_payment_gateways.api_key_enc, telegram_bot_integrations.
-- credential_enc) -- pgp_sym_encrypt/decrypt via PROVIDER_KEY_SECRET,
-- never a new/weaker storage mechanism.
--
-- STORING/RETRIEVING A CREDENTIAL HERE DOES NOT YET CHANGE ANY LIVE AI
-- CALL -- this is the data layer only. Wiring the actual moderation/
-- chatter/media-classification runtime to use it instead of Innvil's own
-- credential is a deliberately deferred, separate, safety-critical pass
-- (see src/lib/products/watch-byo.ts's own doc comment).
create table if not exists watch_byo_provider_credentials (
  account_id      uuid primary key references profiles (id) on delete cascade,
  provider        text not null check (provider in ('anthropic', 'openai')),
  credential_enc  bytea,
  base_url        text,
  model           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists trg_watch_byo_credentials_updated on watch_byo_provider_credentials;
create trigger trg_watch_byo_credentials_updated
  before update on watch_byo_provider_credentials
  for each row execute function set_updated_at();

alter table watch_byo_provider_credentials enable row level security;
-- No policies: service-role only (devops/admin action + future runtime
-- reads), same convention as every other Watch credential/runtime-state
-- table in this schema.

create or replace function set_watch_byo_credential(
  p_account_id uuid,
  p_provider text,
  p_key text,
  p_secret text,
  p_base_url text default null,
  p_model text default null
)
returns void language sql security definer set search_path = public, extensions as $$
  insert into watch_byo_provider_credentials (account_id, provider, credential_enc, base_url, model)
  values (p_account_id, p_provider, pgp_sym_encrypt(p_key, p_secret), p_base_url, p_model)
  on conflict (account_id) do update
    set provider = excluded.provider,
        credential_enc = excluded.credential_enc,
        base_url = excluded.base_url,
        model = excluded.model,
        updated_at = now();
$$;

create or replace function get_watch_byo_credential(p_account_id uuid, p_secret text)
returns table (provider text, api_key text, base_url text, model text)
language sql security definer set search_path = public, extensions as $$
  select provider, pgp_sym_decrypt(credential_enc, p_secret), base_url, model
    from watch_byo_provider_credentials
   where account_id = p_account_id;
$$;

revoke select (credential_enc) on watch_byo_provider_credentials from anon, authenticated;
revoke all on function set_watch_byo_credential(uuid, text, text, text, text, text) from anon, authenticated;
revoke all on function get_watch_byo_credential(uuid, text) from anon, authenticated;
grant execute on function set_watch_byo_credential(uuid, text, text, text, text, text) to service_role;
grant execute on function get_watch_byo_credential(uuid, text) to service_role;
