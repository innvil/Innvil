-- Splits media moderation's warning/strike counter OFF of
-- moderator_link_warning_state.warning_count, which is now EXCLUSIVELY
-- unsolicited-promotion/solicitation's own counter (matching its own
-- pre-existing doc comment in link-moderation.ts, which described it that
-- way even while media moderation was also silently reading/writing it --
-- a real cross-domain conflation this migration removes).
--
-- Historical counts are NOT migrated/split retroactively -- a merged count
-- was never a correct count for either domain individually, so there is
-- nothing meaningful to preserve; every user's counters simply start fresh
-- in their now-correctly-separated column going forward. This is a
-- one-time, disclosed reset of enforcement-history granularity, not a data
-- loss of anything that was ever accurate.
alter table moderator_link_warning_state
  add column if not exists media_warning_count integer not null default 0;
