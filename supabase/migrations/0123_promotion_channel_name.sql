-- Corrected 2026-09-02, per explicit live feedback: the plain-text
-- Promotion-destination fallback (migration 0122) is meant to be REFERRED TO
-- BY NAME in a solicitation warning ("post that in our Promotion channel"),
-- never by reading a raw t.me link out as if it were a name. The owner now
-- sets a plain display NAME here; `promotion_channel_link` (0122) becomes an
-- OPTIONAL secondary field -- when present it's appended alongside the name
-- as a real clickable destination, exactly like the existing Forum-topic
-- redirect already does (name + optional link), never used as the name
-- itself.
alter table communities add column if not exists promotion_channel_name text;
