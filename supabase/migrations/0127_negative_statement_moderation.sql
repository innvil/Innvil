-- 0127_negative_statement_moderation.sql
-- New moderation category: an unfounded, mocking scam/rug/fraud accusation
-- about the project (e.g. "Scam Project 😂😂"), with no genuine question and
-- no substantive evidence behind it -- deliberately distinct from a real
-- question ("Is this a scam?"), which is never this category and continues
-- to be answered normally by ordinary chatter.
--
-- Explicit product decision (2026-09-05): a dedicated 3-strike ladder --
-- 1st offense deletes SILENTLY (no public warning at all); 2nd offense
-- deletes + warns + mutes for 30 minutes; the 3rd (and every subsequent)
-- offense bans for a fixed, TIME-BOUND 24 hours -- never a kick, never a
-- permanent ban. Structurally SEPARATE from every other counter already on
-- this row (warning_count is solicitation's own ladder; scam_strike_count is
-- scam-LINK's own; media_warning_count is media's own) -- an unfounded scam
-- ACCUSATION about the project is never conflated with any of those.
--
-- Same 30-day-inactivity expiry pattern as scam_strike_count/warning_at
-- (see effectiveNegativeStatementCount in link-moderation.ts) -- managed
-- entirely in application code, these two columns are plain state, not
-- computed/enforced at the DB level.

alter table moderator_link_warning_state
  add column if not exists negative_statement_count integer not null default 0,
  add column if not exists negative_statement_at timestamptz;
