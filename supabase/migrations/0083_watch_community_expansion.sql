-- Community Expansion -- a fixed, paid Watch subscription add-on, Gold/
-- Platinum only. Changes ONLY effective Community capacity (never Watcher
-- slots, never plan identity, never a separate product/plan id). No
-- independent renewal date: the add-on belongs to the SAME subscription
-- period as `product_entitlements` -- deliberately no period columns here.
--
-- At most ONE active row per account -- enforced at the DB level via a
-- partial unique index (account_id, addon_type) where status='active', not
-- just application code, so a duplicate purchase attempt can never create
-- a second active row and never increase capacity beyond the canonical max.
create table if not exists watch_subscription_addons (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references profiles (id) on delete cascade,
  addon_type           text not null check (addon_type in ('community_expansion')),
  status               text not null default 'active' check (status in ('active', 'removed')),
  -- Non-refunding cancellation: the add-on stays 'active' (capacity remains
  -- available -- it's already been paid for) until the NEXT renewal, at
  -- which point it's finalized to 'removed' and its price is no longer
  -- charged. Never a mid-cycle capacity reduction, never a refund.
  cancel_at_period_end boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists idx_watch_subscription_addons_active_unique
  on watch_subscription_addons (account_id, addon_type) where status = 'active';
create index if not exists idx_watch_subscription_addons_account on watch_subscription_addons (account_id);

alter table watch_subscription_addons enable row level security;
-- No policies -- service-role only, same convention as every other Watch
-- entitlement/billing table (product_entitlements, watch_trial_claims,
-- innvil_credit_accounts, ...). Customers never get direct read/write
-- access; every mutation goes through a server action.

-- A THIRD platform_deposits purpose for the direct-crypto MONTHLY add-on
-- checkout path (annual add-on purchase is Innvil-Credit-only by product
-- rule and never reaches platform_deposits at all). Same shape family as
-- watch_subscription -- no panel, a real product/plan.
alter table platform_deposits drop constraint if exists platform_deposits_purpose_shape;
alter table platform_deposits add constraint platform_deposits_purpose_shape check (
  (purpose = 'panel_topup' and panel_id is not null and product_id is null and plan is null)
  or
  (purpose = 'watch_subscription' and panel_id is null and product_id is not null and plan is not null)
  or
  (purpose = 'innvil_credit_topup' and panel_id is null and product_id is null and plan is null)
  or
  (purpose = 'watch_addon_purchase' and panel_id is null and product_id is not null and plan is not null)
);
alter table platform_deposits drop constraint if exists platform_deposits_purpose_values;
alter table platform_deposits add constraint platform_deposits_purpose_values check (
  purpose in ('panel_topup', 'watch_subscription', 'innvil_credit_topup', 'watch_addon_purchase')
);
