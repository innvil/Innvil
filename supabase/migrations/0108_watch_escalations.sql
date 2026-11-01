-- Shared Escalation Group (Phase 1) -- a confidence-gated human-in-the-loop
-- system: when a Watcher's ANSWER generation has NO relevant Project
-- Knowledge for a question, it escalates to a private Telegram group the
-- project configures instead of hallucinating. An authorized admin (real
-- Telegram admin/creator status in that group -- Phase 1's authorization
-- check) replies there; the approved answer is relayed back to the
-- original community, and may optionally be promoted to permanent Project
-- Knowledge (with an optional expiration date) via the dashboard.
--
-- CRITICAL BILLING RULE: an Escalation Group is a real `communities` row
-- (reuses the exact same Telegram-membership-verified connect flow as an
-- ordinary community), tagged via `connection_type`. It is NOT a customer-
-- facing deployment -- Watch-only counting code (watch-runtime.ts) filters
-- to `connection_type = 'community'` before computing Watcher-slot usage
-- and the plan's Community allowance, so connecting/deploying into an
-- escalation group never consumes a slot or counts toward the community cap.

alter table communities add column if not exists connection_type text not null default 'community'
  check (connection_type in ('community', 'escalation_group'));

-- Approved-answer knowledge reuses knowledge_sources verbatim (flows through
-- the EXISTING retrieval/scoring pipeline for free) -- a new 'escalation_answer'
-- kind, plus an optional expiration for time-sensitive facts (launch dates,
-- claim windows, etc.). A knowledge_sources row with expires_at in the past
-- is never retrieved as current (see knowledge.ts).
alter table knowledge_sources drop constraint if exists knowledge_sources_kind_check;
alter table knowledge_sources add constraint knowledge_sources_kind_check
  check (kind in ('overview', 'faq', 'fact', 'link', 'note', 'document', 'escalation_answer'));
alter table knowledge_sources add column if not exists expires_at timestamptz;

create table if not exists watch_escalations (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references projects (id) on delete cascade,
  escalation_community_id     uuid not null references communities (id) on delete cascade,
  source_community_id         uuid not null references communities (id) on delete cascade,
  watcher_id                  uuid not null references virtual_moderators (id) on delete cascade,
  asker_platform_user_id      text not null,
  asker_display_name          text,
  source_message_id           text not null,
  question_text               text not null,
  -- The Telegram message_id of OUR posted escalation card in the escalation
  -- group -- set once sent; a reply to THIS message id is how we recognize
  -- an admin's answer belongs to this escalation.
  escalation_message_id       text,
  status                      text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer_text                 text,
  answered_by_platform_user_id text,
  answered_at                 timestamptz,
  -- Set once an admin's answer is promoted to permanent Project Knowledge
  -- (the dashboard's "Save as Project Knowledge" action) -- tracks both
  -- "has this already been promoted" (never create a duplicate
  -- knowledge_sources row for the same escalation) and lets the dashboard
  -- link back to the resulting entry. NULL means not yet promoted -- a
  -- one-time answer that's never saved for reuse.
  knowledge_source_id         uuid references knowledge_sources (id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_watch_escalations_project on watch_escalations (project_id, created_at desc);
create index if not exists idx_watch_escalations_open_lookup
  on watch_escalations (escalation_community_id, escalation_message_id) where status = 'open';

drop trigger if exists trg_watch_escalations_updated on watch_escalations;
create trigger trg_watch_escalations_updated
  before update on watch_escalations
  for each row execute function set_updated_at();

alter table watch_escalations enable row level security;
-- Service-role only, matching every other Watch runtime table -- tenancy is
-- enforced in application code via project_id, never client-side RLS.
