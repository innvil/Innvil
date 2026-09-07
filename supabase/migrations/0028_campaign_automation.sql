-- ============================================================================
-- 0028_campaign_automation.sql
-- Campaign Automation (the "Automator") — Phase 2 foundation.
--   * campaign_service_presets — OWNER config: for a (platform, tier), which of the
--     panel's services to auto-order for each service_type, and how many.
--   * campaigns / campaign_items — a CUSTOMER's bulk run: many links fanned out into
--     one order per (link × preset), each item tracking the resulting order(s).
-- Actions run with the service role + code authz; RLS here is defense in depth.
-- Requires 0001 (panels, customer_accounts, services, set_updated_at) and
-- 0002 (is_panel_member, is_super_admin). Idempotent — safe to re-run.
-- ============================================================================

do $$ begin
  create type campaign_status as enum ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_item_status as enum ('pending', 'ordered', 'partial', 'skipped', 'failed');
exception when duplicate_object then null; end $$;

-- OWNER preset: platform + tier + service_type → a panel service + quantity.
create table if not exists campaign_service_presets (
  id            uuid primary key default gen_random_uuid(),
  panel_id      uuid not null references panels (id) on delete cascade,
  platform      text not null,                 -- instagram | tiktok | youtube | x | ...
  tier          text not null default 'regular', -- 'regular' | 'priority'
  service_type  text not null,                 -- likes | views | followers | comments | ...
  service_id    uuid references services (id) on delete set null,
  quantity      integer not null default 0,
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (panel_id, platform, tier, service_type)
);
create index if not exists idx_campaign_presets_panel on campaign_service_presets (panel_id, platform, tier);

-- CUSTOMER campaign run (header).
create table if not exists campaigns (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  customer_id  uuid not null references customer_accounts (id) on delete cascade,
  tier         text not null default 'regular',
  status       campaign_status not null default 'pending',
  total_links  integer not null default 0,
  total_charge numeric(14,4) not null default 0,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_campaigns_panel on campaigns (panel_id);
create index if not exists idx_campaigns_customer on campaigns (customer_id, created_at desc);

-- Per-link result within a campaign.
create table if not exists campaign_items (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id) on delete cascade,
  link        text not null,
  platform    text,                            -- detected platform (null = unknown)
  status      campaign_item_status not null default 'pending',
  order_ids   jsonb not null default '[]'::jsonb,  -- ids in `orders` fanned out for this link
  charge      numeric(14,4) not null default 0,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_campaign_items_campaign on campaign_items (campaign_id, created_at);

drop trigger if exists trg_campaign_presets_updated on campaign_service_presets;
create trigger trg_campaign_presets_updated before update on campaign_service_presets
  for each row execute function set_updated_at();

drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table campaign_service_presets enable row level security;
alter table campaigns enable row level security;
alter table campaign_items enable row level security;

-- Presets: owner/staff + super admin only (customers never read presets directly).
drop policy if exists campaign_presets_access on campaign_service_presets;
create policy campaign_presets_access on campaign_service_presets for all
  using (is_panel_member(panel_id) or is_super_admin())
  with check (is_panel_member(panel_id) or is_super_admin());

-- Campaigns: panel members, super admin, or the owning customer.
drop policy if exists campaigns_access on campaigns;
create policy campaigns_access on campaigns for all
  using (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  )
  with check (
    is_panel_member(panel_id) or is_super_admin()
    or customer_id in (select id from customer_accounts where user_id = auth.uid())
  );

drop policy if exists campaign_items_access on campaign_items;
create policy campaign_items_access on campaign_items for all
  using (
    exists (
      select 1 from campaigns c
      where c.id = campaign_id
        and (
          is_panel_member(c.panel_id) or is_super_admin()
          or c.customer_id in (select id from customer_accounts where user_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from campaigns c
      where c.id = campaign_id
        and (
          is_panel_member(c.panel_id) or is_super_admin()
          or c.customer_id in (select id from customer_accounts where user_id = auth.uid())
        )
    )
  );
