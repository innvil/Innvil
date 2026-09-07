-- Per-community override: should a Watcher's lightweight acknowledgement
-- behavior (a canned SHORT_ACK / a Telegram reaction, for genuinely trivial
-- content like "thanks", "got it", "lol") also apply to a message sent by a
-- Telegram admin/creator of this community, or only to an ordinary member?
--
-- Default OFF (false) for every existing row, mirroring migration 0112's
-- own "no community's live behavior changes merely because this migration
-- ran" discipline: a trivial message from an admin/mod resolves to SILENCE
-- (no reaction, no short reply) unless explicitly turned on here. This is
-- completely independent of bot_ack_mode (0046) -- that governs bot-to-bot
-- acknowledgement between Innvil moderators, this governs human-sender
-- acknowledgement scope. Neither setting affects genuine substantive
-- ANSWER/CASUAL_CHAT replies -- only the TRIVIAL/acknowledgement-only path
-- (see chatter-coordinator.ts's selectChatterAction).
alter table communities
  add column if not exists acknowledge_admin_mod boolean not null default false;
