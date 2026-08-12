-- 0054_project_knowledge.sql
-- Phase 4.N (Project Knowledge, part A): shared, tenant-scoped source of
-- truth that powers Virtual Moderator Q&A grounding this pass (see
-- src/lib/moderator/knowledge.ts + chatter-generate.ts's "Project knowledge"
-- prompt block). AI Auto-Posting (which is meant to consume the SAME table)
-- is NOT built this pass -- see docs/moderator/project-knowledge-autoposting-spec.md
-- and the CLAUDE.md Phase 4.N entry for the full scope note.
--
-- scope_type/community_id exist from day one per the spec's own instruction
-- ("build the shared retrieval layer with an explicit scope field from the
-- start rather than retrofitting it later") -- only PROJECT-scope rows are
-- ever written by this pass's actions; COMMUNITY-scope is schema-ready but
-- unused until the separate Community Knowledge feature is built.

begin;

create table if not exists knowledge_sources (
  id           uuid primary key default gen_random_uuid(),
  panel_id     uuid not null references panels (id) on delete cascade,
  scope_type   text not null default 'PROJECT' check (scope_type in ('PROJECT', 'COMMUNITY')),
  community_id uuid references communities (id) on delete cascade,
  kind         text not null check (kind in ('overview', 'faq', 'fact', 'link', 'note')),
  title        text not null default '',
  content      text not null default '',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint knowledge_sources_scope_check check (
    (scope_type = 'PROJECT' and community_id is null) or
    (scope_type = 'COMMUNITY' and community_id is not null)
  )
);

create index if not exists idx_knowledge_sources_panel on knowledge_sources (panel_id) where active;
create index if not exists idx_knowledge_sources_community on knowledge_sources (community_id) where active and scope_type = 'COMMUNITY';

drop trigger if exists trg_knowledge_sources_updated on knowledge_sources;
create trigger trg_knowledge_sources_updated
  before update on knowledge_sources
  for each row execute function set_updated_at();

alter table knowledge_sources enable row level security;
-- No policies: service-role only (owner action + runtime retrieval), same
-- pattern as every other moderator config/runtime table (deployment_state,
-- moderator_link_warning_state, moderator_conversation_tasks, ...).

commit;
