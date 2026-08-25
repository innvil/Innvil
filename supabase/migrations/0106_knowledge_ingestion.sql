-- 0106_knowledge_ingestion.sql
-- Real Project Knowledge ingestion (URL fetch + PDF upload), and zero-Panel
-- support for knowledge_sources -- two related, additive changes.
--
-- ROOT CAUSE #1 (why a Project Knowledge URL was only ever stored as a bare
-- string): knowledge_sources had NO ingestion-state columns at all --
-- source_type/source_url/status/content_hash didn't exist, so there was
-- literally nowhere to persist "this URL was fetched and its content is X."
-- A URL "entry" was indistinguishable from a plain hand-typed Fact/Note row.
--
-- ROOT CAUSE #2 (why a standalone/zero-Panel Project could never actually
-- write a knowledge_sources row at all, only the legacy `projects.overview`
-- column): `panel_id` has been `NOT NULL` since migration 0054 and was
-- never revisited when the rest of the Watch schema (communities,
-- moderator_deployments, virtual_moderators, ...) was made nullable for
-- standalone accounts in migration 0069. Ownership for a PROJECT/COMMUNITY
-- -scope row already derives safely through project_id/community_id (see
-- knowledge.ts's own file header) -- panel_id here is legacy attribution
-- only, exactly the same class of fix as 0069.

begin;

alter table knowledge_sources alter column panel_id drop not null;

-- 'document' (PDF-derived) is a new kind, alongside the 5 existing ones.
alter table knowledge_sources drop constraint if exists knowledge_sources_kind_check;
alter table knowledge_sources add constraint knowledge_sources_kind_check
  check (kind in ('overview', 'faq', 'fact', 'link', 'note', 'document'));

-- Ingestion metadata. A manually-typed Fact/FAQ/Note/Overview row has
-- source_type='text' and every ingestion field null/default -- byte-
-- identical to how it already worked before this migration, no backfill
-- needed for existing rows.
alter table knowledge_sources add column if not exists source_type text not null default 'text'
  check (source_type in ('text', 'url', 'pdf'));
-- The trusted source URL an owner explicitly submitted (source_type='url')
-- -- kept as attribution metadata even after extraction, never overwritten
-- by a redirect target (the ORIGINAL submitted URL, not wherever it
-- ultimately resolved to after following redirects).
alter table knowledge_sources add column if not exists source_url text;
-- Supabase Storage object path for a PDF upload (source_type='pdf'). Never
-- a customer-facing value -- the UI must never render this raw key.
alter table knowledge_sources add column if not exists storage_path text;
alter table knowledge_sources add column if not exists status text not null default 'ready'
  check (status in ('pending', 'ready', 'failed'));
-- A short, safe-to-display failure reason -- never a raw stack trace/
-- internal error/secret (enforced in application code, see
-- knowledge-ingestion.ts).
alter table knowledge_sources add column if not exists error text;
-- sha256 of the extracted content -- lets a manual Refresh skip creating
-- duplicate chunk rows when the source genuinely hasn't changed.
alter table knowledge_sources add column if not exists content_hash text;
alter table knowledge_sources add column if not exists fetched_at timestamptz;
-- Groups every chunk derived from ONE ingested url/pdf source (a single
-- long document becomes N knowledge_sources rows, all sharing this id, so
-- the EXISTING per-row relevance scorer -- retrieveRelevantKnowledge,
-- knowledge.ts, completely unchanged by this migration -- can rank/retrieve
-- individual chunks instead of one giant blob). Null for a manually-typed
-- text entry (source_type='text'), which is its own single, ungrouped row,
-- exactly as before this migration.
alter table knowledge_sources add column if not exists ingestion_id uuid;
alter table knowledge_sources add column if not exists chunk_index int;

create index if not exists idx_knowledge_sources_ingestion on knowledge_sources (ingestion_id) where ingestion_id is not null;

commit;
