# Superadmin PR Generator — Implementation Plan (Phase 4.R)

## Scope
This plan is for implementing the roadmap item in [FUTURE_PLANS.txt](FUTURE_PLANS.txt) section "6) Superadmin PR Generator" and [CLAUDE.md](CLAUDE.md) section "Phase 4.R".

Goals:
- Add a superadmin-only PR workflow beside existing Blog generation.
- Keep Blog flow intact (no regressions).
- Support scheduled PR generation eligibility based on external publication date.
- Keep external publication manual (no auto-submit to openPR).

Hard constraints:
- Superadmin-only UI + backend authorization.
- No automatic external publishing.
- Claim/fact grounding + compliance review.
- Idempotent scheduler and race-safe generation.

## Existing Architecture To Reuse

### Already in codebase
- Superadmin action gating pattern: `src/lib/actions/blog-admin.ts` (`requireSuperAdmin`, `Result<T>` shape).
- AI generation orchestration pattern: `src/lib/blog/generate.ts` + `src/lib/ai/blog-writer.ts`.
- Cron route pattern: `app/api/cron/generate-blog/route.ts` with `CRON_SECRET` auth.
- Superadmin review UI pattern: `src/components/superadmin/BlogReview.tsx`.
- Migration conventions: incremental SQL files under `supabase/migrations/` with RLS + check constraints.

### Reuse strategy
- Keep PR generator as parallel system, not a modification of blog tables.
- Mirror naming/style from blog-admin and blog-generate modules for consistency.
- Reuse existing notification + cache refresh approach where helpful.

## Data Model (Proposed)

Create migration `0060_pr_generator.sql` with these tables:

1. `pr_campaigns`
- Purpose: scheduler configuration + cycle state.
- Columns:
  - `id uuid pk`
  - `name text not null default 'Default PR Campaign'`
  - `interval_days int not null default 30 check (interval_days >= 1)`
  - `active boolean not null default true`
  - `last_generated_at timestamptz`
  - `last_published_externally_at timestamptz`
  - `next_generation_date date` (derived checkpoint persisted for cheap scheduler checks)
  - `created_at/updated_at`

2. `press_releases`
- Purpose: PR lifecycle records.
- Columns:
  - `id uuid pk`
  - `campaign_id uuid fk -> pr_campaigns`
  - `title text not null`
  - `slug text not null unique`
  - `summary text not null default ''`
  - `body jsonb not null default '[]'::jsonb` (structured blocks)
  - `status text not null check in ('draft','reviewed','approved','published_externally','rejected')`
  - `source text not null default 'ai' check in ('ai','manual')`
  - `topic text`
  - `compliance_status text not null default 'pending' check in ('pending','pass','fail')`
  - `external_url text`
  - `external_publication_name text`
  - `external_publication_date date`
  - `external_headline text`
  - `external_notes text`
  - `published_externally_at timestamptz`
  - `published_externally_by uuid references profiles(id)`
  - `featured_article_id uuid references blog_posts(id)`
  - `created_at/updated_at`

3. `pr_fact_library`
- Purpose: superadmin-curated fact source.
- Columns:
  - `id uuid pk`
  - `title text not null`
  - `category text not null default 'general'`
  - `content text not null`
  - `source_url text`
  - `effective_from date`
  - `effective_to date`
  - `active boolean not null default true`
  - `created_by uuid references profiles(id)`
  - `created_at/updated_at`

4. `pr_claim_sources`
- Purpose: traceability mapping per PR claim.
- Columns:
  - `id uuid pk`
  - `press_release_id uuid fk -> press_releases on delete cascade`
  - `claim_text text not null`
  - `fact_library_id uuid references pr_fact_library(id)`
  - `source_url text`
  - `confidence numeric(5,2)`
  - `created_at`

5. `pr_compliance_reports`
- Purpose: review artifacts and decision trail.
- Columns:
  - `id uuid pk`
  - `press_release_id uuid fk -> press_releases on delete cascade`
  - `status text not null check in ('pass','fail')`
  - `checks jsonb not null default '{}'::jsonb` (unsupported claims, quote issues, promotional tone, similarity risk, keyword stuffing, etc.)
  - `summary text not null default ''`
  - `raw_feedback text`
  - `created_at`

### DB invariants to enforce
- Only one unpublished PR in blocking statuses per campaign for scheduler auto-mode:
  - partial unique index on `press_releases(campaign_id)` where status in ('draft','reviewed','approved').
- `published_externally` requires `external_url` non-null (check constraint via conditional expression).
- RLS enabled on all new tables.
  - Public: no access.
  - Superadmin: full access (matching blog pattern).

## Backend Module Plan

1. `src/lib/actions/pr-admin.ts` (new)
- `listPressReleases()`
- `getPRGeneratorSettings()` / `setPRGeneratorSettings(intervalDays, active)`
- `generatePRNow({ force?: boolean, topic?: string })`
- `markPRReviewed(id)`
- `approvePR(id)`
- `rejectPR(id, reason)`
- `markPublishedExternally(id, payload)`
- `createFeaturedArticleDraftFromPR(id)`
- `listPRFactLibrary()` / `createPRFact()` / `updatePRFact()` / `deletePRFact()`
- all gated by `requireSuperAdmin()` pattern.

2. `src/lib/pr/generate.ts` (new)
- `runScheduledPRGeneration()`
- `generatePRForTopic()`
- `computeNextGenerationDate()`
- Uses fact library retrieval and compliance pass before final draft insert.

3. `src/lib/ai/pr-writer.ts` (new)
- Prompt + strict JSON contract for PR draft.
- Explicit anti-fabrication constraints.
- Includes openPR press-code guidance language.

4. `src/lib/ai/pr-compliance.ts` (new)
- Structured compliance checks:
  - unsupported claims
  - unverifiable stats/awards/partnerships
  - quote authenticity risk
  - promotional-over-editorial risk
  - duplicate angle/similarity
  - keyword stuffing
- Returns report object for `pr_compliance_reports`.

5. Cron route `app/api/cron/generate-pr/route.ts` (new)
- same auth model as blog cron (`CRON_SECRET`, GET + Bearer support).
- calls `runScheduledPRGeneration()`.
- idempotent response if blocked by status/interval.

## Scheduler and Idempotency Rules

Eligibility:
- Base date is latest externally published date, not generation date.
- `eligible_today = today >= next_generation_date`.

Blocking by default:
- If latest PR in same campaign is `draft|reviewed|approved`, scheduler does not generate a new one.

Manual override:
- `generatePRNow(force=true)` bypasses the blocking guard only after UI warning confirmation.

Race safety:
- In scheduler entrypoint, acquire transactional guard using either:
  - `pg_advisory_xact_lock` (preferred lightweight), or
  - insert into lock table with unique key per day/campaign.

## UI Plan (Superadmin)

Add `PR Review` pane (new component):
- File: `src/components/superadmin/PRReview.tsx`.
- Integrate into existing superadmin content generation area next to Blog.

Sections:
1. Generator controls
- interval days, active toggle, next eligible date, generate-now button.

2. Draft queue
- Draft/Reviewed/Approved cards with actions.

3. Published externally log
- URL, publication name/date/headline, notes.

4. Fact Library manager
- CRUD table with active/inactive flag.

5. Compliance report panel
- pass/fail summary + detailed issues per draft.

6. Optional featured-article creation
- button appears only when PR status is `published_externally`.

## Featured Article Integration

Use existing blog system:
- Convert PR summary into a blog draft row in `blog_posts`.
- Include source link to external publication.
- Never auto-publish; keep `status='draft'`.

## Delivery Phases

### Phase A — Foundation
- Migration `0060_pr_generator.sql`.
- Basic CRUD actions for PR records + settings + external publication metadata.
- Minimal PR review UI list.

### Phase B — Generation + Compliance
- AI writer module + compliance module.
- Fact library retrieval and claim mapping.
- Draft generation and review transitions.

### Phase C — Scheduler + Featured Article
- Cron route + migration `0061_supabase_pr_cron.sql`.
- Idempotency/race safety hardening.
- Featured-article draft bridge.

### Phase D — Quality and guardrails
- Add tests and observability.
- Hard fail on unsafe/unverified claims.
- Similarity checks to avoid repetitive PRs.

## Test Plan

1. Unit tests
- `computeNextGenerationDate` interval logic.
- blocking rule for unpublished statuses.
- external publication metadata validation.
- claim traceability persistence.

2. Integration-style action tests
- superadmin-only authorization.
- generate-now override behavior.
- mark-published updates next schedule baseline correctly.

3. Cron tests
- unauthorized request blocked.
- idempotent duplicate-run behavior.
- locked/busy cycle returns safe no-op.

4. Compliance tests
- fabricated claim detection and fail status.
- quote/stat/award checks.

## Implementation Order (Concrete)

1. Add migration `0060_pr_generator.sql`.
2. Add `pr-admin.ts` action layer (CRUD + transitions only, no AI yet).
3. Add `PRReview.tsx` with manual workflow first.
4. Add `pr-writer.ts` + `pr-compliance.ts` + `pr/generate.ts`.
5. Add cron route and schedule migration `0061_supabase_pr_cron.sql`.
6. Add featured-article bridge into existing blog drafts.
7. Add tests and rollout guards.

## Open Decisions Before Coding

1. Single campaign only vs multi-campaign support at v1.
- Recommendation: v1 single default campaign, schema supports multi later.

2. PR body storage format.
- Recommendation: structured JSON blocks (same philosophy as blog sections) for editing consistency.

3. Compliance strictness on first pass.
- Recommendation: fail-closed for high-risk claims, single auto-regenerate attempt, then manual intervention.

4. Similarity check strategy.
- Recommendation: start with lexical overlap + topic fingerprint; upgrade to embedding-based later if needed.
