-- 0057_projects.sql
-- Corrects the knowledge hierarchy to Panel -> Project -> Community.
--
-- Root cause this fixes: knowledge_sources' "PROJECT" scope (migration 0054)
-- only ever carried panel_id -- it was accidentally PANEL-wide from the
-- start (the assumption "one panel = one project" doesn't hold once a panel
-- owns multiple distinct projects, e.g. one KaJ Labs panel running Litho,
-- Thanos Wallet, and Ignite DEX as separate projects with separate
-- communities). A community in one project must never retrieve knowledge
-- belonging to a different project under the same panel.
--
-- New entity: projects (belongs to panel, has many communities, has many
-- PROJECT-scope knowledge entries). communities.project_id is the new
-- ownership link.
--
-- Migration strategy for existing data (deliberately conservative, per the
-- explicit instruction not to silently merge or duplicate ambiguous data):
--   - Every EXISTING community gets its OWN new project (1 project per
--     community, named after the community) -- this never merges two
--     communities that might actually be different projects, which would be
--     an unsafe assumption for a panel with multiple communities. Owners can
--     manually consolidate later (change a community's project) once that
--     UI exists; nothing here forces a merge.
--   - Existing scope_type='PROJECT' knowledge_sources rows were genuinely
--     panel-wide (they never had a community/project distinction at all),
--     so they're reclassified to the new scope_type='ORGANIZATION' rather
--     than being assigned to any one project -- assigning panel-wide facts
--     to a single arbitrary project would silently misattribute them.

begin;

create table if not exists projects (
  id         uuid primary key default gen_random_uuid(),
  panel_id   uuid not null references panels (id) on delete cascade,
  name       text not null default 'Project',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_panel on projects (panel_id);

drop trigger if exists trg_projects_updated on projects;
create trigger trg_projects_updated
  before update on projects
  for each row execute function set_updated_at();

alter table communities add column if not exists project_id uuid references projects (id) on delete restrict;

-- Backfill: one new project per existing community that doesn't have one yet.
do $$
declare
  c record;
  new_project_id uuid;
begin
  for c in select id, panel_id, title, handle from communities where project_id is null loop
    insert into projects (panel_id, name)
    values (c.panel_id, coalesce(c.title, c.handle, 'Project'))
    returning id into new_project_id;

    update communities set project_id = new_project_id where id = c.id;
  end loop;
end
$$;

alter table communities alter column project_id set not null;

alter table knowledge_sources add column if not exists project_id uuid references projects (id) on delete cascade;

-- Reclassify the old panel-wide "PROJECT" rows as ORGANIZATION -- see header.
update knowledge_sources set scope_type = 'ORGANIZATION' where scope_type = 'PROJECT';

alter table knowledge_sources drop constraint if exists knowledge_sources_scope_check;
alter table knowledge_sources add constraint knowledge_sources_scope_check check (
  (scope_type = 'ORGANIZATION' and project_id is null and community_id is null) or
  (scope_type = 'PROJECT' and project_id is not null and community_id is null) or
  (scope_type = 'COMMUNITY' and community_id is not null)
);
alter table knowledge_sources drop constraint if exists knowledge_sources_scope_type_check;
alter table knowledge_sources add constraint knowledge_sources_scope_type_check check (scope_type in ('ORGANIZATION', 'PROJECT', 'COMMUNITY'));

create index if not exists idx_knowledge_sources_project on knowledge_sources (project_id) where active and scope_type = 'PROJECT';

alter table projects enable row level security;
-- No policies: service-role only, same pattern as every other moderator config table.

commit;
