-- 0111_watch_pending_tier.sql
-- Adds a scheduled-downgrade slot to a direct Watch entitlement.
--
-- A downgrade never takes effect immediately (no immediate charge, no
-- immediate capacity/tier change) -- it's recorded here and only actually
-- applied at the account's own next renewal (see purchaseWatchWithCredit /
-- sweepWatchAutoRenewals). Free-text, same encoding convention as
-- subscription_ref's own tier segment (validated in application code via
-- parseEntitlementTier, never a DB-level enum) so it never needs its own
-- migration if a new self-serve tier is added later.
--
-- Every real activation (activateWatchEntitlement) clears this back to
-- NULL unconditionally -- a fresh purchase/upgrade, or the scheduled
-- downgrade actually taking effect, both supersede whatever was queued.

alter table product_entitlements add column if not exists pending_tier text;
