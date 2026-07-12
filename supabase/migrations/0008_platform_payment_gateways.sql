-- ============================================================================
-- 0008_platform_payment_gateways.sql
-- PLATFORM-level payment gateways (Innvil's own, configured by the super admin).
-- These are how PANEL OWNERS pay Innvil (top up their commission balance) — the
-- mirror of panel_payment_gateways, but there's exactly one platform, so the row
-- is keyed by `gateway` alone. Secrets are pgcrypto-encrypted and only decrypted
-- server-side (service role). Idempotent — safe to re-run.
-- Requires 0001 (pgcrypto, set_updated_at) and 0002 (is_super_admin).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists platform_payment_gateways (
  id           uuid primary key default gen_random_uuid(),
  gateway      text not null unique,          -- 'cryptomus' | 'nowpayments'
  api_key_enc  bytea,                          -- pgp_sym_encrypt(JSON of secrets, secret)
  status       text not null default 'active',
  config       jsonb not null default '{}',    -- non-secret public fields
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_platform_payment_gateways_updated on platform_payment_gateways;
create trigger trg_platform_payment_gateways_updated before update on platform_payment_gateways
  for each row execute function set_updated_at();

-- Key encryption (mirror set_gateway_key / get_gateway_key). The symmetric secret
-- is supplied by the server at call time and never stored.
create or replace function set_platform_gateway_key(p_row uuid, p_key text, p_secret text)
returns void language sql security definer set search_path = public, extensions as $$
  update platform_payment_gateways
     set api_key_enc = pgp_sym_encrypt(p_key, p_secret)
   where id = p_row;
$$;

create or replace function get_platform_gateway_key(p_row uuid, p_secret text)
returns text language sql security definer set search_path = public, extensions as $$
  select pgp_sym_decrypt(api_key_enc, p_secret)
    from platform_payment_gateways
   where id = p_row;
$$;

-- RLS: super admin only (defense in depth; actions also use service role + code authz).
alter table platform_payment_gateways enable row level security;

drop policy if exists platform_payment_gateways_admin on platform_payment_gateways;
create policy platform_payment_gateways_admin on platform_payment_gateways for all
  using (is_super_admin())
  with check (is_super_admin());

-- The encrypted key column is never readable by clients; keys go through the RPCs.
revoke select (api_key_enc) on platform_payment_gateways from anon, authenticated;
revoke all on function set_platform_gateway_key(uuid, text, text) from anon, authenticated;
revoke all on function get_platform_gateway_key(uuid, text)       from anon, authenticated;
grant execute on function set_platform_gateway_key(uuid, text, text) to service_role;
grant execute on function get_platform_gateway_key(uuid, text)       to service_role;
