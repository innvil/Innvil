-- 0058_project_profile.sql
-- Simplifies the Project/Community/Organization knowledge UX (which was too
-- fragmented -- three equally-prominent "knowledge systems") into a single
-- Project Profile centered on the `projects` table, per the explicit
-- follow-up correction. The Panel -> Project -> Community relationship
-- (migration 0057) is UNCHANGED and preserved.
--
-- Structured fields (name, description, website, docs, overview) live as
-- real columns on `projects` -- these are always-present, frequently-read
-- single values, not open-ended data, so plain columns fit better than
-- jsonb here (the codebase already uses plain columns for exactly this
-- shape elsewhere, e.g. communities.title/handle).
--
-- `contacts` is jsonb -- a small, bounded set of well-known keys (support,
-- partnerships, sales, technical_support) with room for future custom
-- contacts without another migration, matching the existing precedent of
-- jsonb config columns elsewhere in this schema (panels.settings,
-- moderator_deployments.overrides, virtual_moderators.persona).
--
-- No data is destroyed: existing ORGANIZATION-scope knowledge_sources rows
-- (the old panel-wide facts reclassified in migration 0057) are left
-- exactly as they are -- they simply stop being a prominent UI card. The
-- owner can migrate a fact like the old "Support Contact" into the new
-- structured `contacts.support` field themselves once Project Profile ships,
-- since that mapping isn't deterministic to do automatically (an
-- organization-wide fact may or may not actually belong to any one project).

begin;

alter table projects add column if not exists description text not null default '';
alter table projects add column if not exists website text not null default '';
alter table projects add column if not exists docs_url text not null default '';
alter table projects add column if not exists overview text not null default '';
alter table projects add column if not exists contacts jsonb not null default '{}'::jsonb;

commit;
