-- ============================================================================
-- Innvil Watch — Managed Enterprise entitlement representation.
--
-- Enterprise is deliberately NOT a self-serve ModeratorPlanTier value
-- (money.ts) -- its capacity is a variable, manually-provisioned Watcher
-- slot count (moderatorEnterpriseSlotPrice/moderatorEnterpriseIncluded
-- Communities), never one of the four fixed Bronze/Silver/Gold/Platinum
-- rows. It's represented the SAME way "trial" already is: a distinct
-- entitlement SOURCE alongside ModeratorPlanTier, resolved by
-- requireAccountWatchContext (watch-runtime.ts) via product_entitlements
-- .subscription_ref starting with "enterprise:", with the actual slot
-- count in this new column (never encoded into the ref string, and never
-- reusing the fixed CAPACITY/MODERATOR_COMMUNITY_CAPACITY lookup tables,
-- which have no "enterprise" entry by design).
-- ============================================================================

alter table product_entitlements add column if not exists enterprise_slots integer;

alter table product_entitlements drop constraint if exists product_entitlements_enterprise_slots_check;
alter table product_entitlements add constraint product_entitlements_enterprise_slots_check
  check (enterprise_slots is null or enterprise_slots >= 21);
