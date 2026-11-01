-- Enterprise Community Expansion (2026-08-22) -- represents the SELECTED
-- Community capacity package for a manually-provisioned Managed Enterprise
-- entitlement. NULL means "base package, no expansion" (8 Communities for
-- Managed). Validated server-side against the canonical package matrix in
-- src/lib/products/watch-enterprise-community.ts before ever being
-- persisted -- never a client-supplied value taken as authority.
--
-- Additive/backward-compatible: every existing Managed Enterprise
-- entitlement (enterprise_slots set, this column NULL) continues to resolve
-- to its existing base Community capacity with no migration of existing
-- data required.
alter table product_entitlements add column if not exists enterprise_community_capacity integer;
alter table product_entitlements drop constraint if exists product_entitlements_enterprise_community_capacity_check;
alter table product_entitlements add constraint product_entitlements_enterprise_community_capacity_check
  check (enterprise_community_capacity is null or enterprise_community_capacity >= 8);
