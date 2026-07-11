-- ============================================================================
-- 0005_payment_gateways.sql
-- Per-panel payment gateway credentials (bring-your-own, like providers).
-- The gateway API key is pgcrypto-encrypted and only ever decrypted server-side
-- (service role) via get_gateway_key(). Idempotent — safe to re-run.
-- Requires 0001 (pgcrypto, set_updated_at) and 0002 (is_panel_member, is_super_admin).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists panel_payment_gateways (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  gateway      text not null,                 -- 'cryptomus'
  merchant_id  text,                          -- merchant uuid (not secret)
  api_key_enc  bytea,                         -- pgp_sym_encrypt(payment api key, secret)
  status       text not null default 'active',
  config       jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (panel_id, gateway)
);
create index if not exists idx_panel_payment_gateways_panel on panel_payment_gateways (panel_id);

drop trigger if exists trg_panel_payment_gateways_updated on panel_payment_gateways;
create trigger trg_panel_payment_gateways_updated before update on panel_payment_gateways
  for each row execute function set_updated_at();

-- Key encryption (mirror set_provider_key / get_provider_key). The symmetric
-- secret is supplied by the server at call time and never stored.
create or replace function set_gateway_key(p_row uuid, p_key text, p_secret text)
returns void language sql security definer set search_path = public, extensions as $$
  update panel_payment_gateways
     set api_key_enc = pgp_sym_encrypt(p_key, p_secret)
   where id = p_row;
$$;

create or replace function get_gateway_key(p_row uuid, p_secret text)
returns text language sql security definer set search_path = public, extensions as $$
  select pgp_sym_decrypt(api_key_enc, p_secret)
    from panel_payment_gateways
   where id = p_row;
$$;

-- RLS: panel admins only (defense in depth; admin actions use service role + code authz).
alter table panel_payment_gateways enable row level security;

drop policy if exists panel_payment_gateways_admin on panel_payment_gateways;
create policy panel_payment_gateways_admin on panel_payment_gateways for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

-- The encrypted key column is never readable by clients; keys go through the RPCs.
revoke select (api_key_enc) on panel_payment_gateways from anon, authenticated;
revoke all on function set_gateway_key(uuid, text, text) from anon, authenticated;
revoke all on function get_gateway_key(uuid, text)       from anon, authenticated;
grant execute on function set_gateway_key(uuid, text, text) to service_role;
grant execute on function get_gateway_key(uuid, text)       to service_role;
