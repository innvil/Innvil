-- ============================================================================
-- 0011_order_status_duplicate.sql
-- Adds a 'duplicate' order status. Duplicate orders (same customer + service +
-- link as an existing live order) are parked here instead of being sent to the
-- provider, so the owner can review and mass-cancel (refund) them.
-- Idempotent — safe to re-run.
-- ============================================================================

alter type order_status add value if not exists 'duplicate';
