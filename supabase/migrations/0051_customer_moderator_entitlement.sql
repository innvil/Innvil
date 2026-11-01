-- 0051_customer_moderator_entitlement.sql
-- Product/entitlement correction: the customer-facing AI Moderator product
-- lives in the panel STOREFRONT, purchased by a PANEL CUSTOMER, not the
-- panel owner. The pre-existing owner-facing trial/plan machinery
-- (moderator/plan.ts, panels.settings.addons.moderator, moderator_trial_usage
-- keyed by owner_id) is untouched here -- it's a separate, older prototype
-- surface (Phase 2 will fold/replace it). This migration adds the NEW
-- customer-scoped ownership + entitlement model.
--
-- virtual_moderators.customer_id: nullable. NULL = an owner-created/dev
-- moderator (the existing model); set = customer-owned (the new storefront
-- product). Both can coexist during the migration.
--
-- customer_moderator_entitlement: one row per (panel, customer) -- their
-- trial state AND/OR paid subscription state. Trial has a FIXED window
-- (trial_started_at/trial_ends_at, set once, never recomputed) -- "paused"
-- for a WALLET-qualified trial whose balance dropped below $10 is a LIVE,
-- derived check (qualification source + current wallet balance), not a
-- stored state transition, so there's no separate "paused_at" column and no
-- way to accidentally extend the window by toggling a flag.

alter table virtual_moderators
  add column if not exists customer_id uuid references customer_accounts (id) on delete cascade;
create index if not exists idx_virtual_moderators_customer on virtual_moderators (customer_id);

create table if not exists customer_moderator_entitlement (
  panel_id                    uuid not null references panels (id) on delete cascade,
  customer_id                 uuid not null references customer_accounts (id) on delete cascade,
  -- Paid subscription state (null tier = no active paid plan).
  tier                        text check (tier in ('basic', 'standard', 'premium', 'pro')),
  since                       timestamptz,
  last_charge_at              timestamptz,
  next_charge_at              timestamptz,
  lapsed                      boolean not null default false,
  -- Trial state. trial_started_at not null = the trial has been used (once,
  -- ever, for this customer on this panel) -- whether it's currently active,
  -- expired, or wallet-paused is derived at read time, never re-stored.
  trial_started_at            timestamptz,
  trial_ends_at                timestamptz,
  trial_qualification_source  text check (trial_qualification_source in ('ESTABLISHED', 'HIGH_VALUE', 'WALLET')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  primary key (panel_id, customer_id)
);
create index if not exists idx_customer_moderator_entitlement_panel on customer_moderator_entitlement (panel_id);

drop trigger if exists trg_customer_moderator_entitlement_updated on customer_moderator_entitlement;
create trigger trg_customer_moderator_entitlement_updated before update on customer_moderator_entitlement
  for each row execute function set_updated_at();

alter table customer_moderator_entitlement enable row level security;
drop policy if exists customer_moderator_entitlement_owner on customer_moderator_entitlement;
create policy customer_moderator_entitlement_owner on customer_moderator_entitlement for select
  using (panel_id in (select id from panels where owner_id = auth.uid()) or is_super_admin());
-- Writes (start trial / subscribe / cancel) go through service-role actions
-- only, same pattern as automator_subscriptions -- no customer-role INSERT/
-- UPDATE policy; the storefront customer session never writes this table
-- directly.

-- Atomic charge: debit the customer's wallet the full subscription price,
-- credit the panel's Innvil balance with the owner's commission share (the
-- remainder is Innvil's own revenue, realized implicitly by never being
-- credited anywhere -- same pattern as the 5% order-commission model).
-- apply_balance_change already row-locks the customer and raises on
-- insufficient balance; wrapping both mutations in one function call makes
-- them one transaction -- if the debit fails, the credit never happens.
create or replace function charge_customer_for_moderator_subscription(
  p_customer_id uuid,
  p_panel_id uuid,
  p_amount numeric,
  p_owner_share numeric,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  perform apply_balance_change(p_customer_id, -p_amount, 'order', p_reason, null, null);
  if p_owner_share > 0 then
    perform credit_panel_innvil_balance(p_panel_id, p_owner_share);
  end if;
  return 'OK';
exception
  when others then
    if sqlerrm = 'insufficient balance' then
      return 'INSUFFICIENT_BALANCE';
    end if;
    return 'CHARGE_FAILED';
end;
$$;

revoke all on function charge_customer_for_moderator_subscription(uuid, uuid, numeric, numeric, text) from anon, authenticated;
grant execute on function charge_customer_for_moderator_subscription(uuid, uuid, numeric, numeric, text) to service_role;
