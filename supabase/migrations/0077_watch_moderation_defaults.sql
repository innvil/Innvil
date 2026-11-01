begin;

-- =========================================================================
-- Real account-level Moderation Defaults for Innvil Watch -- backs the
-- "Moderation Defaults" section of Settings, and the actual inheritance
-- behavior: a newly-created Watcher (createAccountWatcher, watch-runtime.ts)
-- now starts from THIS account's own configured default persona instead of
-- always the same hardcoded DEFAULT_MODERATOR_PERSONA.
--
-- Reuses the exact same `ModeratorPersona` jsonb shape already stored on
-- `virtual_moderators.persona` (migration 0043) -- never a second persona
-- schema. `normalizeModeratorPersona()` (moderator/domain.ts) already
-- degrades any partial/invalid jsonb back to safe defaults, so this table
-- can reuse that same normalization on read.
--
-- Deliberately does NOT store per-Community moderation toggles (bot_ack_
-- mode, media moderation, Auto-Posting) as an account-wide default -- those
-- are genuinely per-Community operational settings a Community's own
-- Telegram membership/rights determine, not something that makes sense to
-- silently apply to a brand-new Community connection. Scoped to persona
-- only, matching the concrete, real "new Watchers start from a real
-- default" behavior this migration actually wires up.
-- =========================================================================

create table if not exists watch_moderation_defaults (
  account_id  uuid primary key references profiles (id) on delete cascade,
  persona     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table watch_moderation_defaults enable row level security;
-- No policies -- service-role only, same convention as every other Watch
-- preferences/runtime table.

commit;
