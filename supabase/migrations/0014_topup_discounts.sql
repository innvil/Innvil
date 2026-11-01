-- ============================================================================
-- 0014_topup_discounts.sql
-- Top-up promotion discounts:
-- - super-admin global defaults by payment category
-- - per-payment bonus amount persisted on payments (credited amount = amount + bonus)
-- ============================================================================

alter table if exists payments
  add column if not exists bonus_amount numeric(12,4) not null default 0;

alter table if exists payments
  drop constraint if exists payments_bonus_amount_nonnegative;

alter table if exists payments
  add constraint payments_bonus_amount_nonnegative check (bonus_amount >= 0);

create table if not exists platform_topup_discount_defaults (
  category   text primary key,
  discount_pct numeric(6,3),
  discount_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_topup_discount_defaults_category_ck
    check (category in ('card','ewallet','crypto','bank')),
  constraint platform_topup_discount_defaults_discount_pct_ck
    check (discount_pct is null or (discount_pct >= 0 and discount_pct <= 100)),
  constraint platform_topup_discount_defaults_discount_rules_array_ck
    check (jsonb_typeof(discount_rules) = 'array')
);

alter table if exists platform_topup_discount_defaults
  add column if not exists discount_rules jsonb not null default '[]'::jsonb;

alter table if exists platform_topup_discount_defaults
  drop constraint if exists platform_topup_discount_defaults_discount_rules_array_ck;

alter table if exists platform_topup_discount_defaults
  add constraint platform_topup_discount_defaults_discount_rules_array_ck
  check (jsonb_typeof(discount_rules) = 'array');

drop trigger if exists trg_platform_topup_discount_defaults_updated on platform_topup_discount_defaults;
create trigger trg_platform_topup_discount_defaults_updated
before update on platform_topup_discount_defaults
for each row execute function set_updated_at();

alter table platform_topup_discount_defaults enable row level security;

drop policy if exists platform_topup_discount_defaults_admin on platform_topup_discount_defaults;
create policy platform_topup_discount_defaults_admin
on platform_topup_discount_defaults
for all
using (is_super_admin())
with check (is_super_admin());
