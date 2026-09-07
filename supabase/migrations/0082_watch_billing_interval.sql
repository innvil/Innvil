-- Annual billing (Innvil-Credit-only) is a BILLING INTERVAL on the existing
-- plan identity -- never a second product/plan id ("Silver Annual" etc.).
-- Additive column on the same product_entitlements row every other paid-
-- period field already lives on (migrations 0080/0081).
--
-- Every row created before this migration was created exclusively through
-- the monthly-only crypto/credit purchase paths -- 'monthly' is therefore
-- the deterministically correct backfill for 100% of existing paid rows,
-- not a guess.
alter table product_entitlements add column if not exists billing_interval text not null default 'monthly'
  check (billing_interval in ('monthly', 'annual'));
