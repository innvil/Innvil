-- 0063_scam_strikes.sql
--
-- Graduated scam/phishing enforcement (extends the existing link-moderation
-- warning-state model, not a new table): first confirmed high-confidence
-- scam/phishing offense -> DELETE_WARN; second within a 30-day strike
-- window -> DELETE_KICK; third+ -> falls back to the existing DELETE_BAN
-- path. Reuses moderator_link_warning_state (already scoped by
-- community_id + platform_user_id, exactly the required strike scope) --
-- scam strikes are a NEW, separate counter from the existing
-- warning_count (unsolicited-promotion's own 3-strike counter), never
-- conflated with it.

begin;

alter table moderator_link_warning_state add column if not exists scam_strike_count integer not null default 0;
alter table moderator_link_warning_state add column if not exists scam_strike_at timestamptz;

commit;
