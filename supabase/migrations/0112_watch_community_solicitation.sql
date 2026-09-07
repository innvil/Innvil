-- Spam/Promotion handling correction: a real, per-Community "Allow
-- Solicitation" override. Default OFF (false) for every existing row, so
-- no community's live moderation behavior changes merely because this
-- migration ran -- the enforcement policy (link-moderation.ts's
-- decideLinkEnforcement) only relaxes UNSOLICITED_PROMOTION handling when
-- a community explicitly opts in. All other moderation (spam-flood,
-- scam/phishing, explicit content, admin exemption) is completely
-- unaffected by this column.
alter table communities
  add column if not exists allow_solicitation boolean not null default false;
