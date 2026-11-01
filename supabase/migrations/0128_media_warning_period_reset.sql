-- 0128_media_warning_period_reset.sql
-- Media moderation's own strike counter (media_warning_count) previously had
-- no expiry mechanism at all -- unlike every other counter on this row
-- (warning_count / scam_strike_count / negative_statement_count, all of
-- which reset on a rolling 30-day-since-last-offense window), a repeated
-- borderline-explicit-media violation accumulated permanently.
--
-- Explicit product decision (2026-09-05): media's counter renews together
-- with the account's TIERED PLAN billing period instead -- "however many
-- [strikes] they had, even if 1 or the max, it resets" once the plan
-- renews, mirroring the Media Moderation Unit ALLOWANCE's own existing
-- full-reset-no-carryover behavior (getWatchMediaModerationUsage is keyed
-- by period_start, so a new period always starts usage at 0 regardless of
-- how much of the prior period's allowance was used).
--
-- See effectiveMediaWarningCount in link-moderation.ts -- a stored warning
-- from before the account's current billing-period start reads as 0 (a full
-- reset), computed entirely in application code; this column is plain state.

alter table moderator_link_warning_state
  add column if not exists media_warning_at timestamptz;
