-- ----------------------------------------------------------------------------
-- 0031 — Automated welcome message for new customers.
-- Marks the auto-created welcome ticket (kind='welcome') and tracks the one-time
-- "reply to claim your free credit" bonus so it can only ever be granted once.
-- The welcome copy + toggles live in panels.settings.welcome (JSONB, no column).
-- ----------------------------------------------------------------------------
alter table support_tickets add column if not exists kind text not null default 'general';
alter table support_tickets add column if not exists welcome_bonus_granted boolean not null default false;
