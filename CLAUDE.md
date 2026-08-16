# Innvil — Project Documentation

## Overview

Innvil is a **no-code white-label SMM panel builder** built with Next.js + Supabase + Vercel. Users create independent, white-label SMM panels with their own subdomain, storefront, customer dashboard, and wallet. Innvil charges a **5% commission only** on completed orders — no monthly rent, no setup fees.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16.2+ (App Router, Turbopack) |
| UI Components | React 19+ with Lucide icons |
| Charts | Recharts |
| Styling | Tailwind CSS |
| Backend/Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | Vercel |
| State Management | React hooks (useState/useContext) |

> Upgraded from Next.js 14 / React 18 on 2026-07-07 — Next 14.x stopped receiving
> security patches (Vercel's May 2026 advisory cluster only patches 15.5.18+/16.2.6+).
> See CLAUDE_PROGRESS.txt for the full upgrade log.

---

## Terminology

| Term | Definition |
|------|------------|
| **Innvil** | The platform itself — the panel builder |
| **Panel** | A white-label SMM storefront created by a user |
| **Panel Owner** | A user who creates and manages a panel |
| **Customer** | End user who registers on a panel to order SMM services |
| **Provider** | The SMM API provider a panel owner connects to (bring-your-own) |
| **Floor/Price Floor** | Minimum price enforced by the provider — panel owners cannot price below it |
| **Markup** | The percentage added above the provider's floor price |
| **Live Panel** | A customer-facing panel storefront |
| **Super Admin** | Innvil platform administrator — never visible to panel owners or customers |

---

## Coding Standards

### Component Structure
- Use functional components with React hooks
- Keep components focused and single-purpose
- Co-locate component-specific styles when possible
- Use `.jsx` for components, `.js` for utilities and data

### Naming Conventions
- Components: PascalCase (`PanelAdmin`, `StatusBadge`)
- Functions/Variables: camelCase (`handleStatusChange`, `panelStatuses`)
- Constants: SCREAMING_SNAKE_CASE for configuration objects (`PANEL_STATUSES`)
- CSS classes: lowercase with hyphens (BEM-ish via Tailwind)

### Styling
- Use Tailwind CSS utility classes
- Custom styles via `GlobalStyle` component (inline `<style>` tag)
- Design tokens defined in `src/styles/globals.css`

### State Management
- Local state: `useState` for component-level state
- Cross-component state: props drilling for simple cases
- Consider Context API or Zustand for complex shared state

---

## Architecture

```
innvil/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Root — REAL auth-driven (signed out→public/login,
│   │                      #   signed in→dashboard). Dev switcher at /?preview=1
│   ├── PreviewSwitcher.tsx# The old world-switcher harness (dev only)
│   ├── p/[subdomain]/     # REAL customer storefront (page.tsx + Storefront.tsx)
│   ├── layout.tsx         # Root layout with fonts
│   └── globals.css        # Tailwind + design tokens
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── ui/            # Base components (Card, Toggle, Pill, etc.)
│   │   ├── panels/        # Innvil app, Super Admin (index.tsx)
│   │   │   └── admin/     # Panel Owner admin: PanelAdmin shell, AdminTabs, CustomerDrawer
│   │   │                  # (Categories merged into the Services "Catalog" tab)
│   │   └── customer/      # Customer-facing experience (Phase 1)
│   │       ├── index.tsx            # CustomerPanel — status-aware entry
│   │       ├── CustomerLanding.tsx  # White-label landing (auth only)
│   │       ├── CustomerDashboard.tsx# Dashboard/Orders/Wallet/Tickets/API/Profile
│   │       ├── NewOrder.tsx         # Progressive order form + smart search
│   │       └── PlatformIcons.tsx    # Monochrome brand glyphs + platform buttons
│   ├── data/              # Mock data and constants
│   ├── types/             # Shared TS interfaces (index.ts) + DB row types (db.ts)
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   │   └── supabase/      # client.ts, server.ts, admin.ts, middleware.ts, constants.ts
│   │                      #   (storefront uses a separate session cookie)
│   └── styles/            # Global CSS and design tokens
├── supabase/
│   ├── migrations/        # 0001_init (schema), 0002_rls (policies),
│   │                      # 0003 (category parent_id), 0004 (services.local_id),
│   │                      # 0005 (panel_payment_gateways + gateway key RPCs)
│   └── README.md          # how to apply migrations + env
├── middleware.ts          # Supabase session refresh
├── public/                # Static assets
├── .env.local.example     # Environment variables template
├── package.json
├── tailwind.config.ts
├── next.config.js
└── CLAUDE.md
```

---

## Panel Statuses

| Status | Customer Can Browse | Customer Can Order | Description |
|--------|--------------------|--------------------|-------------|
| `draft` | No | No | Panel is being set up. Not visible to customers. |
| `live` | Yes | Yes | Fully operational. |
| `inactive` | Yes | No | Browsable, login, dashboard, history, wallet balance, deposits. No new orders. |
| `suspended` | No | No | Offline. Panel owner must contact Innvil support. |
| `maintenance` | No | No | Temporarily offline. Auto-returns to previous status. |

---

## Recent Updates

### 2026-08-17 — Direct photo/video moderation (media safety) for Virtual Moderator (v1.19.0)
- **New capability, extends the EXISTING moderation abstraction, not a parallel engine.** `link-moderation.ts`'s
  `ModerationEnforcement` (ALLOW / DELETE_WARN / DELETE_BAN) is reused verbatim for media — gained two new
  reasons (`explicit_content_borderline` for a warn, `repeated_explicit_content` for the escalated ban) rather
  than a second competing enforcement type. Investigated first (per explicit instruction): confirmed no
  existing NSFW/vision/media-download dependency or infrastructure anywhere in this codebase before writing
  any code.
- **`src/lib/moderator/media-moderation.ts` (NEW, pure, no I/O)** — the policy layer. `MediaSafetyVerdict`
  (safe/uncertain/explicit) + `MediaSafetyConfidence` (low/medium/high) from a classifier call, structurally
  separate from `MediaFailureKind` (provider_unconfigured/provider_error/provider_timeout/download_failed/
  unsupported_media/too_large/duration_exceeded/decode_failed) so a classifier failure can never be silently
  read as "explicit" — `decideMediaEnforcement()` resolves EVERY failure kind to `ALLOW`, always, regardless of
  prior warning history. High-confidence explicit → immediate `DELETE_BAN` (never role-exempt, same severity
  class as an explicit link); borderline (explicit-but-not-high, or uncertain-at-high-confidence) → 3-strike
  `DELETE_WARN`/`DELETE_BAN` escalation reusing link moderation's own `PROMOTION_WARNING_LIMIT`; safe (any
  confidence) → `ALLOW`, no action.
- **Bounded video sampling, never frame-by-frame.** `computeSamplePositions(durationMs)` spreads
  `MAX_VIDEO_SAMPLE_FRAMES = 5` sample points evenly across the clip regardless of duration (a 30-second and a
  6-hour video both sample the same flat count — cost never scales with length), always including points past
  the very first second so a user can't evade detection by only putting safe content up front.
  `aggregateFrameResults()` — the strongest (most explicit) genuine verdict across sampled frames wins; a
  frame-level failure never contributes an "explicit" signal; if every sampled frame failed, the AGGREGATE is
  itself a failure (never silently safe or explicit). `isEarlyExitResult()` short-circuits sampling the instant
  a high-confidence explicit frame is found — never wastes classifier calls sampling the rest of a clearly
  explicit video.
- **`src/lib/moderator/media-safety-provider.ts` (NEW)** — `classifyImageBytes(bytes, mimeType)`, a deliberately
  REPLACEABLE HTTP adapter (send image bytes, get back `{verdict, confidence, reason?}`), **NOT wired to any
  specific vendor** — per explicit instruction not to arbitrarily couple to a vendor when none already exists in
  this codebase. Reads `MEDIA_SAFETY_PROVIDER_URL`/`MEDIA_SAFETY_PROVIDER_API_KEY`/`MEDIA_SAFETY_TIMEOUT_MS`
  (default 10s); unconfigured/non-2xx/malformed-response/timeout/network-error all resolve to a distinct,
  named failure — never a fabricated verdict. **The feature is a no-op (always ALLOW) until a real vendor is
  configured.**
- **Telegram file download** (`telegram-client.ts`) — new `getTelegramFile`/`downloadTelegramFileBuffer`
  (`TELEGRAM_MAX_DOWNLOADABLE_BYTES` = Telegram's own 20MB getFile ceiling, checked against BOTH the
  Content-Length header and the actual bytes received, 15s timeout).
- **`src/lib/moderator/media-frame-extractor.ts` (NEW)** — `extractVideoFrames(videoBuffer, positionsMs)` via
  the new `ffmpeg-static` dependency (added to `package.json`; resolves a platform binary at install time — a
  Linux binary on Vercel's build, verified locally to resolve on Windows). Writes the video to a `mkdtemp`
  unique temp directory, extracts one JPEG per requested position (20s timeout per position), and **guarantees
  cleanup of the whole temp directory in a `finally` block on both success and failure paths** — no explicit
  media is ever left on disk. A single failed extraction position is skipped, not fatal to the whole pass.
- **`src/lib/moderator/community-runtime.ts`'s `runMediaModeration()`** — the orchestrator, mirrors
  `runLinkModeration()`'s exact shape: a SINGLE coordinated enforcer (`deployments[0]`, the same pattern link
  moderation already uses) so an explicit upload produces ONE action, never one per deployed moderator bot.
  Checked BEFORE link moderation and BEFORE Natural Chatter routing in `handleHumanMessage` — a deleted message
  has nothing left to link-check or chat about. `detectSupportedMedia()` recognizes Telegram's own typed
  `photo`/`video`/`animation` fields (highest-resolution photo variant, Telegram sends smallest-first) plus a
  `document` **only when Telegram's own reported `mime_type` starts with `image/`or `video/`** — never by
  filename/extension alone (a `.jpg.exe` with no image mime type is correctly never treated as media).
  `MEDIA_MAX_BYTES = 15MB` (tighter than Telegram's own ceiling) and `MEDIA_MAX_VIDEO_DURATION_S = 5min` are
  checked BEFORE any download — oversized/too-long media is skipped as unsupported, never downloaded.
- **Video moderation has its OWN separate rollout flag** (`MEDIA_MODERATION_VIDEO_ENABLED`, layered on top of
  `MEDIA_MODERATION_ENABLED`) since `ffmpeg-static` needs live Vercel verification before enabling — photo
  moderation can ship without being blocked by that risk, same "ship OFF, verify live, flip flag" pattern
  already used for `AUTO_POSTING_ENABLED` etc. Both reuse the EXISTING `virtualModModeration` entitlement gate
  (no new toggle/entitlement axis — deliberately not overbuilt).
- **Dedup**: new `moderator_media_dedup` table (migration `0059`, unique on `(community_id, file_unique_id)`) —
  a COST optimization only; genuine Telegram webhook-retry dedup is already fully covered upstream by the
  pre-existing `isDuplicateUpdate`. Known, accepted v1 limitation: doesn't track classifier/policy version, so a
  later provider/threshold change won't retroactively reclassify an already-cached file. **Run migration
  `0059`.**
- **Privacy/retention**: no explicit media is ever persisted beyond the temp-file lifetime of a single
  classification pass; the activity log (`media_moderation` event type, reusing the existing
  `moderator_activity_log`) retains only metadata (message id, community id, verdict/failure, enforcement kind,
  confidence) — never the downloaded image/video bytes themselves.
- **Model-routing invariant preserved**: media classification NEVER calls `aiComplete`/DeepSeek/Claude — only
  the dedicated `classifyImageBytes` HTTP call. The one AI call in this whole feature is
  `generateMediaModerationWarning` (`media-warning.ts`, mirrors `link-classify.ts`'s `generateModerationWarning`
  exactly) — natural-language WARNING TEXT only, still routed through the existing Sonnet-5-medium
  `getInnvilModelConfig()`, same as link moderation's own warning text already was.
- **Warning-state reuse**: media violations share the SAME per-(community,user) strike counter link moderation
  already maintains (`loadLinkWarningState`/`persistLinkWarningState`) — a unified content-policy counter,
  not a second parallel warning-state table, per explicit "keep this simple" instruction.
- New tests: `media-moderation.test.ts` (+31 — sampling bounds/coverage incl. beyond-first-frame, aggregation
  strongest-wins + all-failures-is-failure, early exit, every enforcement case incl. every failure kind
  resolving to ALLOW regardless of warning history), `media-safety-provider.test.ts` (+7, mocked `fetch` —
  unconfigured/non-2xx/malformed-response/network-error/timeout all fail explicitly, correct request shape),
  `community-runtime.test.ts` (+10 — `detectSupportedMedia` across photo/video/animation/document-by-mimetype,
  document-by-filename-only correctly rejected, no-mime-type document rejected, photo-precedence). 770 tests
  pass (up from 727), `tsc --noEmit` clean, production build clean. **Scope note**: the full DB/Telegram-mocked
  `runMediaModeration` orchestrator itself is verified via typecheck + build + code review (mirrors
  `runLinkModeration`'s already-established shape) rather than a full integration test — consistent with how
  comparably complex existing orchestrators (`executeAction`, `handleCommunityUpdate`) are treated in this
  codebase; the pure policy/adapter/detection layers underneath it are fully unit-tested.
- **Not done this pass, by design**: no NSFW/image-safety vendor is actually wired up — `MEDIA_SAFETY_PROVIDER_URL`/
  `MEDIA_SAFETY_PROVIDER_API_KEY`/`MEDIA_SAFETY_TIMEOUT_MS` must be set before this does anything beyond ALLOW
  everything; `ffmpeg-static`'s Vercel-Linux compatibility needs live verification before flipping
  `NEXT_PUBLIC_MEDIA_MODERATION_VIDEO_ENABLED` on in production.

### 2026-08-17 — Project Profile UI consolidation + Auto-Posting sourced from the same profile (v1.18.14)
- **Completes the Project Profile simplification** (backend — migration `0058`, `project-profile.ts`,
  `getProjectProfile`/`updateProjectProfile`/`setProjectContact`, the `loadRelevantKnowledge` preset-injection
  logic — shipped earlier this session). This pass finishes the two pieces that were still outstanding: the
  owner-facing UI consolidation and Auto-Posting's own sourcing.
- **`AdminTabs.tsx`: the old three-equally-prominent-cards layout is replaced with ONE primary `ProjectProfileCard`.**
  Structured fields (name, description, website, docs URL, main overview) + four structured **contact presets**
  (Support/Partnerships/Sales/Technical — authoritative fields, not ordinary knowledge rows) are now the primary
  editing surface; the old free-form FAQ/Fact/Link/Note entries still exist, just demoted into a collapsed
  "Additional Knowledge" section (closed by default) as an explicit secondary fallback, not a competing system.
  `CommunityKnowledgeCard` is relabeled "Community Context" (copy now frames it as a SMALL optional override,
  not a parallel full system). `OrganizationKnowledgeCard` is now `LegacyOrganizationKnowledgeSection` — wrapped
  in a collapsed-by-default disclosure so old rows stay reachable/editable without competing for attention; no
  data was destroyed or migrated away.
- **`autopost-runtime.ts`'s `loadKnowledgeForWindow` now sources from the same Project Profile**, in the
  corrected priority order: Main Overview first, then website/docs, then free-form project knowledge, then
  community context, then legacy organization knowledge as the last fallback — no separate knowledge
  architecture for Auto-Posting. **Contact presets are never included** — the loader never even reads
  `projects.contacts`, only `overview`/`website`/`docs_url`, so a configured support handle can never leak into
  generated post content as inspiration.
- New tests: `autopost-runtime.test.ts` (+5, NEW file — overview-first priority ordering, a project with no
  overview/website/docs still surfaces free-form knowledge, contacts structurally never read/leaked, community +
  legacy organization knowledge still flow through as fallback material, no crash when a community has no
  resolved project). 770 tests pass, `tsc --noEmit` clean, production build clean.

### 2026-08-12 — Verified + locked in: project_id for retrieval is never client-suppliable (v1.18.2)
- **Explicit security requirement checked, not assumed**: audited both retrieval paths
  (`community-runtime.ts`'s `loadRelevantKnowledge`, `autopost-runtime.ts`'s `loadKnowledgeForWindow`) —
  confirmed neither function accepts a `projectId` parameter at all; both take only `communityId` and resolve
  the project exclusively via a server-side `communities.project_id` DB lookup before any `knowledge_sources`
  query runs. No code path (Telegram webhook, cron, or otherwise) can inject an arbitrary `project_id` into
  retrieval. This is structurally distinct from the owner-facing WRITE actions
  (`createProjectKnowledgeEntry(panelId, projectId, ...)` etc.), which DO accept an explicit `projectId` — but
  that's the authenticated owner picking among their OWN projects from the dashboard, gated by `ownedProject()`
  ownership verification, not a retrieval-time trust boundary.
- New regression test (`community-runtime.test.ts`) pins both halves: a structural check that
  `loadRelevantKnowledge.length === 4` (no fifth `projectId` argument exists to add), and a behavioral check
  that even with an "attacker-controlled" project's knowledge present in the same fake DB, a community only
  ever retrieves what its own DB-resolved `project_id` is entitled to. 726 tests pass (up from 725), `tsc
  --noEmit` clean, production build clean. No code changes were needed — this pass only verified and locked in
  an invariant that already held.

### 2026-08-12 — Fix: migration 0057 constraint-ordering bug (v1.18.1)
- **Live migration run failed**: `update knowledge_sources set scope_type = 'ORGANIZATION' ...` ran while the
  OLD check constraint (from migration 0054, which only allowed `'PROJECT'`/`'COMMUNITY'`) was still in effect,
  so the reclassification itself violated it. Fixed the ordering in `0057_projects.sql` — both old constraints
  (the inline column check and the named `knowledge_sources_scope_check`) are now dropped BEFORE the data
  UPDATE, with the new three-scope constraint added after. The whole migration is wrapped in `begin`/`commit`,
  so the failed attempt was fully rolled back — nothing was left half-applied. **Re-run `0057_projects.sql`.**

### 2026-08-12 — Phase 4.N architecture correction: Panel -> Project -> Community hierarchy (v1.18.0)
- **Live bug report:** a Community Knowledge entry saved for "Innvil Test Community" was retrieved when a
  question was asked in a totally different community ("new community") on the same panel — traced to the
  literal root cause, not just the wrong-community save: `knowledge_sources`' "PROJECT" scope only ever carried
  `panel_id` (never a project distinction), so it was accidentally PANEL-wide since v1.15.0. That's wrong once
  one panel owns multiple distinct projects (e.g. one KaJ Labs panel running Litho / Thanos Wallet / Ignite DEX,
  each with its own Telegram community) — a community in one project must never retrieve another project's facts.
- **New first-class `projects` entity** (migration `0057`) sits between panel and community:
  `Panel -> Project -> Community`. `communities.project_id` (NOT NULL) is the new ownership link — every
  community belongs to exactly one project; a project may have one or more communities (kept deliberately
  NOT hard-1:1, per explicit instruction — "Litho" could have a Main + Regional Telegram, both inheriting the
  same Project Knowledge).
- **`knowledge_sources` gained a third scope, `ORGANIZATION`** (was `PROJECT`/`COMMUNITY` only) — truly
  panel-wide facts shared across every project (company info, legal, shared policy). `PROJECT` now requires a
  real `project_id` (never panel-wide again); `COMMUNITY` unchanged. New three-way check constraint enforces
  the exact field combination each scope requires.
- **Conservative, non-lossy migration** for existing data (per explicit "do not silently merge/duplicate
  ambiguous data" instruction): every EXISTING community gets its own NEW project (1 project per community,
  named after the community) — this never merges two communities that might be different projects, which would
  be unsafe for a panel with multiple communities. The OLD panel-wide `PROJECT` rows are reclassified to
  `ORGANIZATION` (they never had a community/project distinction to begin with, so assigning them to one
  arbitrary project would have been an unjustified guess) rather than being duplicated or dropped. **Run
  migration `0057`** — nothing is deleted; every existing community connection and knowledge entry is preserved.
- **Retrieval now resolves the community's project first, then queries all three scopes independently**
  (`community-runtime.ts`'s `loadRelevantKnowledge`/`autopost-runtime.ts`'s `loadKnowledgeForWindow`) — PROJECT
  is filtered strictly by `project_id = <this community's resolved project>`, so a different project's rows are
  never even fetched, let alone retrieved (isolation enforced in the DB query, never by prompting alone).
  Precedence unchanged in spirit, extended to three levels: **community > project > organization** — earlier
  entries in the merged list win when facts conflict (`combineKnowledgeRetrieval`, now takes three ordered
  result sets).
- **Prompt now labels every entry by its own scope** (`chatter-generate.ts`'s `projectKnowledgeContextLines`,
  `autopost-generate.ts`'s prompt) — "Community knowledge (specific to this community)" / "Project knowledge
  (specific to this project)" / "Organization knowledge (shared across every project this panel owns)" — never
  a single generic "Project Knowledge" header that could mislabel an organization-wide fact.
- **`connectCommunity`** (`actions/moderator.ts`) now establishes a project on every NEW community connection
  — reuses the existing project unchanged on a reconnect (never silently reassigns it), and creates a new
  project (named after the Telegram chat, same convention the migration used) for a genuinely new community,
  since this action has no project-selector UI yet to ask the owner explicitly (documented follow-up).
- **Owner-facing CRUD split correctly** (`actions/knowledge.ts`): `listPanelProjects`/`createProject`,
  `listProjectKnowledge`/`create`/`update`/`delete` now all REQUIRE a `projectId` (never panel-wide again),
  new `listOrganizationKnowledge`/`create`/`update`/`delete` (panel-scoped, for genuinely global facts),
  `listPanelCommunities` now also returns each community's resolved project name. Every write validates the
  full ownership chain (panel owner → owns project → project owns community) via query filters, never a
  trusted client-supplied id.
- **UI fixes the exact reported gap**: `ProjectKnowledgeCard` now has an explicit project selector (+ "create
  project") instead of being silently panel-wide; `CommunityKnowledgeCard` now starts with **no community
  selected** ("— Choose a community —") instead of silently defaulting to the oldest community, and shows the
  selected community's resolved project name right below the picker so the scope is never ambiguous; new
  `OrganizationKnowledgeCard` for panel-wide facts. Shared `KnowledgeEntryList`/`KnowledgeAddForm` components
  factor out the now-3x-duplicated list/add-form UI.
- New/updated tests: `knowledge.test.ts` (+5 — 3-way `combineKnowledgeRetrieval` incl. organization-only
  fallback, project-isolation shape, project-fallback shape), `community-runtime.test.ts` (rewrote
  `fakeAdminForKnowledge` to also resolve `communities.project_id`, +6 new tests incl. the exact user-reported
  cross-project-leakage scenario as a regression test, project-fallback, organization-fallback, and
  multi-community-same-project), `chatter-generate.test.ts` (+2 — scope labeling correctness, organization
  never mislabeled as project). 725 tests pass (up from 715), `tsc --noEmit` clean, production build clean.
- **Deliberately deferred, documented (not hidden):** a UI for reassigning an existing community to a
  different/existing project (today only "auto-create a new project per new community connection" exists) —
  the 1-project-per-community migration default is safe and non-lossy on its own; consolidating communities
  under one project is a manual DB operation until that UI is built. No vector/embedding filtering section
  needed (still no such infrastructure exists in this codebase, confirmed again this pass) — the DB query
  filters (`project_id`/`community_id`/`panel_id`) are the isolation mechanism.

### 2026-08-12 — Phase 4.N (Part B): AI Telegram Auto-Posting — per-moderator posting windows (v1.17.0)
- **Implemented from `docs/moderator/project-knowledge-autoposting-spec.md`'s "AUTO-POSTING UPDATE — Per-
  Moderator Posting Windows" section** (supersedes the base spec's earlier §13-15/§24 — read and implemented
  from THAT section, not the superseded one). Core rule: **each Virtual Moderator IS the visible Telegram
  publisher for its own assigned window — there is no generic Innvil publishing bot.** Publishing always uses
  the assigned moderator's own managed-bot credential, never `TELEGRAM_MANAGER_BOT_TOKEN` (spec §14/§20).
- **Real per-community timezone added** (`communities.timezone`, migration `0055`, IANA name, default `UTC`) —
  no per-community timezone field existed anywhere in the schema before this (the v1.7.0 reactive-quota system
  uses UTC-calendar-day as a stand-in specifically because nothing better existed). Auto-posting windows are
  meaningless without real local hour-of-day semantics, so this is a genuine schema addition, not a reuse of
  that stand-in. `src/lib/moderator/autopost.ts`'s `zonedTimeToUtc`/`localDateKeyInTimezone` implement the
  wall-clock↔UTC conversion by hand (no timezone library dependency added) — a standard "format a UTC guess in
  the target zone, correct by the offset" technique; not exact across a DST transition INSTANT itself
  (documented v1 simplification, acceptable since posting is "sometime in this window", not a precision-
  critical instant).
- **Overnight windows (e.g. 22:00–02:00) are explicitly REJECTED at validation** (`validateWindow`), per the
  spec's own sanctioned fallback (§8: "if the existing scheduler cannot safely support this yet, reject rather
  than implementing ambiguous behavior") — not implemented as ambiguous/incorrect behavior.
- **Random scheduled time, generated once, persisted, never re-rolled** (spec §4/§5, the section's own
  "CRITICAL" warning) — `auto_post_occurrences` has a `unique(auto_post_window_id, local_date)` constraint,
  which both enforces "at most one occurrence per window per day" (spec §3) at the DB level and is the
  idempotency backbone: every state transition (`scheduled → generating → generated → publishing → published`,
  or `→ publish_failed`/`failed`/`missed`/`cancelled`) is a CONDITIONAL update keyed on the row's current
  status (`claimStatus` in `autopost-runtime.ts`), so two concurrent cron sweeps can't double-generate or
  double-publish the same occurrence (spec §6/§35/§36 — publish failure retries the SAME stored content, never
  regenerates a different post).
- **Missed-window handling** (spec §16): if the sweep only reaches a scheduled-but-never-executed occurrence
  after its window's local END has already passed, it's marked `missed` — never posted late, never dumped all
  at once after downtime.
- **Community-wide duplicate-content prevention** (spec §21 base spec / §12 update — Kaleb shouldn't repeat
  what Mika already posted, not just what Kaleb posted): `loadRecentPostSummaries` pulls recent PUBLISHED posts
  across every window in the community; both fed into the generation prompt directly AND checked via a
  keyword-overlap heuristic (`isTooSimilarToRecent`, same reasoning as `knowledge.ts`'s retrieval scoring — no
  embedding infra exists in this codebase) with one bounded regeneration attempt before giving up and marking
  the slot `missed` rather than posting a near-duplicate.
- **Collision spacing** (spec §9 — Mika 10:51 / Kaleb 10:58 shouldn't both fire seven minutes apart):
  `scheduleWithSpacing` does a bounded re-roll (up to 5 attempts, 10-minute minimum gap) against other windows'
  occurrences already scheduled the same day in the same community — a deliberately simple policy, not a full
  collision-resolution optimizer (documented limitation for a very packed day).
- **Source-grounded generation, task-routed to Sonnet 5 medium** (spec §12 — same substantive-generation tier
  as Q&A, via the existing hard `getInnvilModelConfig()`/`INNVIL_REQUIRED_MODEL` invariant, never the
  CASUAL_CHAT DeepSeek carve-out). `src/lib/moderator/autopost-generate.ts`'s prompt explicitly bans fabricated
  partnerships/prices/APYs/listings/roadmap-milestones/audits/dates/announcements/integrations/giveaways/
  promotions/statistics unless explicitly present in the SAME retrieved Project + Community Knowledge the Q&A
  path uses (community first = precedence, reusing `combineKnowledgeRetrieval` from Part A/C — one shared
  knowledge pipeline, never a second disconnected one per the spec's own core product rule). An
  `INSUFFICIENT_KNOWLEDGE` sentinel lets the model decline rather than hallucinate a post when the knowledge
  base is too thin (spec §33/§8 base spec) — the occurrence is marked `missed`, not force-published.
- **Human-safe output validation before publish** (spec §19): `validateGeneratedPost` — non-empty, within
  Telegram's length limit, no placeholder text, no leaked internal formatting/sentinel text, no secret-shaped
  strings. Fails closed (marks `failed`, never publishes) rather than best-effort sending.
- **Entitlement wired for real** (`plan.ts`'s `virtualModContentGeneration`, previously a hardcoded `false`
  stub) — any active PAID tier, trial explicitly excluded (spec §26/§27, the same distinction already used for
  the trial's separate 20/day reactive quota — this is a different, additional exclusion, not a reuse of that
  mechanism). Gated behind a new master rollout switch `AUTO_POSTING_ENABLED`
  (`NEXT_PUBLIC_AUTO_POSTING_ENABLED`), OFF in production until live-verified, same pattern as
  `VIRTUAL_MODERATOR_ENABLED`/`BOT_ACKNOWLEDGEMENT_ENABLED`/`NATURAL_CHATTER_ENABLED`.
- **Migrations `0055_autopost.sql`** (`communities.timezone`, `auto_post_windows`, `auto_post_occurrences`,
  service-role only) **+ `0056_supabase_autopost_cron.sql`** (pg_cron every 5 minutes, mirrors the
  order-sync/blog/bill-addons/binance-sync cron pattern exactly — shared vault `app_url`/`cron_secret`). Cron
  route `app/api/cron/autopost`. **Run migrations `0055` and `0056`.**
- **Owner-facing CRUD** (`src/lib/actions/autopost.ts`): `getCommunityTimezone`/`setCommunityTimezone`,
  `listCommunityDeployments` (only moderators actually deployed in that community are assignable, spec §27),
  `listAutoPostWindows`/`createAutoPostWindow`/`setAutoPostWindowEnabled`/`deleteAutoPostWindow`,
  `listRecentAutoPosts` (spec §26's "optional preview", kept minimal per the spec's own "don't overbuild" note).
  New **"Auto-Posting" card** in the owner's Virtual Moderator tab — community selector, timezone field,
  window creation (moderator + start/end time), window list with enable/disable/delete, and a recent-posts
  status list. Hidden entirely unless `AUTO_POSTING_ENABLED`.
- **Deliberately simplified/deferred this pass** (documented, not hidden): DRAFT/review mode (auto-publish
  only — the occurrence status model already has room for a future draft state without a schema change, per
  spec §25's own "don't make the data model impossible to extend"); true semantic-similarity duplicate
  detection (keyword-overlap heuristic instead, no embedding infra exists); sophisticated collision-spacing
  optimization (simple bounded re-roll instead); a failed GENERATION (not publish) does not currently
  auto-retry on the next sweep — it's marked `failed` terminally, requiring the owner to notice via the
  recent-posts list (bounded retry-with-backoff bookkeeping was judged more infrastructure than this pass
  needs; publish failures DO retry automatically, since that's the spec's own explicit requirement).
- New tests: `autopost.test.ts` (+28, all new — window validation incl. the overnight-rejection case, timezone
  conversion round-trips for both UTC and a real non-UTC zone incl. spec's own DST-adjacent boundary example,
  spec TEST 1's "scheduled time lies inside the window" across multiple random sources, missed-window
  detection, collision spacing incl. a forced-collision re-roll, the duplicate-content heuristic, every §19
  output-validation case incl. the secret-shaped-string check), `plan.test.ts` (+3 — content-generation
  entitlement OFF under the master switch even with a paid tier, OFF for trial regardless of the switch, OFF
  with no entitlement). 715 tests pass (up from 684), `tsc --noEmit` clean, production build clean (confirmed
  `/api/cron/autopost` appears in the build output).

### 2026-08-12 — Phase 4.N (Part C): Community Knowledge — a second, community-scoped knowledge layer (v1.16.0)
- **Implemented from `docs/moderator/project-knowledge-autoposting-spec.md`'s "COMMUNITY-SPECIFIC KNOWLEDGE"
  section** — a second knowledge scope, specific to ONE Telegram community rather than the whole panel/project,
  now unblocked since Part A's retrieval pipeline (v1.15.0) exists to build on. `knowledge_sources` already had
  the `scope_type`/`community_id` columns from day one (migration 0054), so this needed no new migration.
- **Auto-linking via deployment→community falls out of the existing query filter for free** (spec §2/§9 — "no
  per-bot manual linking required"): `community-runtime.ts`'s retrieval now filters COMMUNITY-scope rows by
  the message's own `community_id`, so any active moderator answering in a community automatically sees that
  community's knowledge with zero extra join table or per-moderator config.
- **Precedence when facts conflict (spec §7/§24)**: `combineKnowledgeRetrieval()` (`knowledge.ts`) merges a
  community's own relevant results with the tenant-wide PROJECT results, COMMUNITY entries listed FIRST —
  ordering IS the precedence signal (the prompt now explicitly states "if an earlier entry conflicts with a
  later one, the earlier one is more specific to this community and takes precedence"), rather than attempting
  semantic conflict detection the v1 keyword-overlap retrieval has no basis to do reliably.
- **Strict isolation enforced in the DB query, never by prompting alone** (spec §8): `loadRelevantKnowledge`
  (renamed from `loadRelevantProjectKnowledge`, now `export`ed for direct testing) fetches PROJECT and
  COMMUNITY rows via two separately-scoped queries (`.eq("panel_id", panelId)` vs.
  `.eq("community_id", communityId)`) run in parallel, and merges only after both are independently
  relevance-ranked.
- **Owner-facing CRUD** (`src/lib/actions/knowledge.ts`): `listPanelCommunities`/`listCommunityKnowledge`/
  `createCommunityKnowledgeEntry`/`updateCommunityKnowledgeEntry`/`deleteCommunityKnowledgeEntry`, gated by a
  new `ownedCommunity()` check (community must both exist and belong to a panel this user owns — never trusts
  a client-supplied `communityId`). New **"Community Knowledge" card** in the owner's Virtual Moderator tab
  (`AdminTabs.tsx` `CommunityKnowledgeCard`) — a community selector + the same minimal add/list/deactivate/
  delete editor pattern as the Project Knowledge card, mounted right below it. Hidden entirely (no empty-state
  flash) when the panel has no connected communities yet.
- New tests: `knowledge.test.ts` (+6 — `combineKnowledgeRetrieval`'s community-first precedence ordering,
  limit handling, project-only/community-only fallbacks, cross-community isolation shape), `community-runtime.test.ts`
  (+6, new `fakeAdminForKnowledge` mock proving the REAL two-query shape — not just the pure retrieval math —
  incl. the exact spec test-4 cross-community isolation case and the spec §7/§24 conflicting-fact precedence
  case). 684 tests pass (up from 672), `tsc --noEmit` clean, production build clean. No migration (reuses
  migration 0054's scope field, built exactly for this).
- **Still not built** (per the spec's own phasing): AI Auto-Posting (needs a separate per-moderator posting-
  window scheduling/publishing engine) — both knowledge scopes are meant to feed it once it exists, per spec
  §11/§16 of the auto-posting section.

### 2026-08-12 — Phase 4.N (Part A): Project Knowledge grounds Moderator Q&A (v1.15.0)
- **Implemented from `docs/moderator/project-knowledge-autoposting-spec.md`** (verbatim source of truth — see
  Phase 4.N in the roadmap). Full spec covers three deliverables: (A) shared Project Knowledge powering Q&A,
  (B) the SAME knowledge powering AI Telegram Auto-Posting, (C) a second Community Knowledge scope. **Only (A)
  is built this pass** — (B) needs a whole scheduling/publishing engine (per-moderator posting windows,
  persisted random occurrence times, idempotent cron execution) that doesn't exist and would be a second,
  separate deliverable even with the knowledge layer in place; (C) is explicitly stated in the spec itself as
  blocked on (A) existing first. Scoped and flagged rather than half-building either.
- **Inspected before writing any code** (per the spec's own required process, §40): confirmed no vector/
  embedding/RAG infrastructure exists anywhere in this codebase (no pgvector, no embedding client, no
  `openai`/`langchain`/similar dependency) — building one from scratch for "the smallest safe, extensible
  patch" would be over-scoped. **v1 retrieval is a bounded, deterministic keyword-overlap scorer** instead
  (`src/lib/moderator/knowledge.ts` `scoreKnowledgeRelevance`/`retrieveRelevantKnowledge` — title matches
  weighted 2x over content matches, returns nothing when nothing scores above 0 rather than ever falling back
  to the whole knowledge base). Swappable for real embeddings later without changing the calling contract.
- **Migration `0054_project_knowledge.sql`** (NEW) — `knowledge_sources` (panel_id, `scope_type` "PROJECT" |
  "COMMUNITY", `community_id` nullable, `kind` overview/faq/fact/link/note, title, content, active). The scope
  field exists from day one per the spec's own explicit instruction ("build the shared retrieval layer with an
  explicit scope field from the start rather than retrofitting it later") — only PROJECT-scope rows are ever
  written this pass; COMMUNITY-scope is schema-ready but unused until the separate Community Knowledge feature
  is built. Service-role only (no RLS policies), same pattern as every other moderator config table. **Run
  migration `0054`.**
- **Owner-facing CRUD** (`src/lib/actions/knowledge.ts`, panel-scoped — a panel is one project/brand, so both
  the legacy owner-created and the newer customer-owned moderators (migration 0051) share the same project
  knowledge): `listProjectKnowledge`/`createProjectKnowledgeEntry`/`updateProjectKnowledgeEntry`/
  `deleteProjectKnowledgeEntry`. Deliberately minimal (title + content + kind dropdown, no file/URL ingestion
  yet — per the spec's own "don't force everything into one giant text field" but also "don't overbuild UI if
  the current phase only needs minimal configuration").
- **New "Project Knowledge" card** in the owner's Virtual Moderator tab (`AdminTabs.tsx` `ProjectKnowledgeCard`)
  — add/list/deactivate/delete entries, mounted below the moderator list.
- **Wired into Moderator Q&A, ANSWER only** (never CASUAL_CHAT — substantive facts belong to substantive Q&A,
  matching the spec's own model-routing table). `community-runtime.ts`'s `handleHumanMessage` retrieves once
  per triggering message (`loadRelevantProjectKnowledge`, not per-responder) when `action.type === "ANSWER"`,
  threaded through both the primary and any additional (multi-target) responder via a new
  `GenerateChatterReplyInput.projectKnowledge` field. `chatter-generate.ts`'s new `projectKnowledgeContextLines`
  renders only the ALREADY-RETRIEVED subset (never the whole KB) with an explicit "this is the ONLY source of
  factual project claims" instruction, and is omitted entirely (not an empty block) when nothing relevant was
  found. Also softened `SHARED_RULES`' blanket "you do not have access to... business records" line, since
  that's now sometimes untrue — it now explicitly gates factual claims to what's in the Project Knowledge block
  when present.
- New tests: `knowledge.test.ts` (+10 — spec test 1 "what chains do you support?" retrieves the right entry,
  spec test 2 an uncovered question retrieves nothing, spec test 4's cross-tenant shape, inactive sources never
  retrieved, title-match ranking, limit/ordering, empty-list safety, title-less entries), `chatter-generate.ts`
  test additions (+7 — null when nothing retrieved, verbatim content surfacing, the never-fabricate-beyond-it
  instruction, wired into ANSWER, explicitly NOT wired into CASUAL_CHAT, multiple entries, title-less
  rendering). 672 tests pass (up from 656), `tsc --noEmit` clean, production build clean. **Run migration
  `0054`** before this has anything to retrieve.

### 2026-08-12 — Phase 4.P: bot-ack Community Handoff + depth-2 social chain (v1.14.0)
- **Implemented from `docs/moderator/bot-ack-social-behavior-spec.md`** (verbatim source of truth — see Phase
  4.P in the roadmap). The hard "a BOT_ACK may never trigger anything else" rule made bot-to-bot exchanges cut
  off abruptly instead of resolving naturally. New depth/origin model (`coordinator.ts`): depth 0
  (HUMAN/PROACTIVE origin) may produce a `BOT_ACK` (unchanged, deterministic-opener bypass from v1.12.1 still
  applies); a depth-1 (`origin: "BOT_ACK"`) event may produce AT MOST a new **`COMMUNITY_HANDOFF`** action
  (depth becomes 2), never another acknowledgement; a depth-2 (`origin: "COMMUNITY_HANDOFF"`) event always
  `IGNORE`s — a hard dead end, no exceptions (spec §12: "Bot 1 must not answer"). New `MAX_BOT_HANDOFF_DEPTH = 2`
  in `event-types.ts` (existing `MAX_BOT_INTERACTION_DEPTH = 1` kept, now only documents the plain-ack step).
- **`role_handoffs` bot-ack mode now actually differs from `acknowledgements`** — both existed as selectable
  UI options already (`AdminTabs.tsx`'s "Role handoffs" label), but the coordinator previously treated them
  identically. `role_handoffs` is now what actually enables the depth-1→2 escalation; `acknowledgements` (and
  `reactions_only`) stop at a plain ack, same as before. No schema/UI change needed.
- **`COMMUNITY_HANDOFF` is a new `CommunityAction` kind** (`event-types.ts`) — deliberately NOT mandatory
  (`HANDOFF_PROBABILITY = 0.4`, lower than `ACK_PROBABILITY` — escalating an already-completed exchange should
  be rarer than the initial ack) and NOT forced onto a bare closing acknowledgement ("nice one", "thanks") —
  reuses the existing Natural Chatter closing-acknowledgement detection via a new export
  `isSimpleClosingAcknowledgement` (`chatter-coordinator.ts`, wraps the already-existing `CLOSING_ACK_RE`/
  `isPositiveClosing`/`isAcknowledgementOnly` checks rather than duplicating them) instead of forcing a handoff
  onto text that already feels socially complete (spec TEST 4).
- **Handoff text is generic "open the floor" phrasing only** (spec §9 option A/D — "Anyone here got anything
  new today?"), deliberately NEVER referencing a specific recent topic or Project/Community Knowledge (option
  B/C) since that grounding pipeline doesn't exist yet (Phase 4.N, still NOTED/not built) — fabricating a
  grounded-sounding reference without real grounding would violate the spec's own anti-fabrication rule, so
  this stays generic and deterministic (zero AI cost, matching the file's existing "no AI calls" design) until
  that pipeline exists. Never addressed to the other moderator by name (spec §4 — addressed to the room only).
- **`community-runtime.ts`**: `executeAction`'s `SEND_TEXT` branch now also handles `COMMUNITY_HANDOFF` (both
  send via Telegram `sendMessage`); `recordBotAckReply` (which persists the provenance so another bot's webhook
  correctly re-classifies this message's origin) now accepts either kind, writing `origin: "COMMUNITY_HANDOFF"`
  for a handoff so the hard dead-end gate above is actually reachable on the next event.
- **Already satisfied, no changes needed (verified, not assumed):** "REACT means a real Telegram reaction, not
  a text message" (spec's own first REACT section) — `executeAction`'s REACT branch already calls
  `setMessageReaction` (and gained a REACTION_INVALID retry-fallback in v1.12.3); reactions never insert a
  `community_messages` row so they structurally can't start a bot chain (spec §13); bot-ack's own daily/gap
  rate limiting (`DAILY_CAP`/`MIN_GAP_MS`, pre-existing) is already a dedicated allowance fully separate from
  the human-facing `TRIAL_REACTIVE_DAILY_LIMIT`/quota system (spec §14/§17); `bot_message` vs `human_message`
  event types already separate bot-ack/handoff activity from human engagement in analytics (spec §15/§22).
- New tests (`coordinator.test.ts`, +12): a depth-1 event under `role_handoffs` producing a `COMMUNITY_HANDOFF`
  (spec TEST 1 shape), never addressed by name (§4), a `COMMUNITY_HANDOFF`-origin event always `IGNORE`s (spec
  TEST 2), a bare closing ack doesn't force one (spec TEST 4), a handoff isn't mandatory even when eligible
  (spec TEST 5), `acknowledgements` mode never escalates, rate-limited targets still block a handoff, and
  `EXTERNAL_BOT` senders never get this treatment; two pre-existing tests updated for the new depth semantics
  (the old blanket "any nonzero depth → IGNORE" test didn't distinguish origin, which the new model requires —
  replaced with origin-precise equivalents). 656 tests pass (up from 647), `tsc --noEmit` clean, production
  build clean. No migration (new action kind is in-code only; `community_messages.origin` already accepted
  arbitrary text).
- **Deliberately not built this pass** (per the spec's own reaction-pacing sections, §10/§11 of the REACT
  half): those already have a close analog in the EXISTING Natural Chatter ambient-reaction fan-out
  (`resolveAdditionalReactors`/`MAX_ADDITIONAL_REACTORS`, v1.9.15) for human-directed reactions — the bot-ack
  REACT path here already only ever selects a single target (`available[...]`), which already satisfies "zero
  or one Innvil reaction is usually enough" for the bot-to-bot case without needing new pacing code.

### 2026-08-12 — Room-wide address ("everyone") now scales additional-responder count with community size (v1.13.1)
- **Live report:** "gm everyone" only ever got one reply, regardless of how many moderators were deployed in
  the community. Root cause: `resolveMultiTargetAddress`'s `PLURAL_ADDRESS_RE` never matched "everyone"/
  "everybody" at all (only "you both"/"you two"/"you guys"/"you all"/"both of you"/"both mods") — so "gm
  everyone" was never treated as a multi-target address in the first place, and fell through to the ordinary
  single-primary COMMUNITY_OPENER path (quietest-longest picks exactly one responder).
- **Product decision (explicit, from the user):** for a 2-moderator community, one reply to "gm everyone" is
  fine as-is. For larger communities it should scale: 5 deployed → at least 3 reply, 10 deployed → at least 5.
- **New `ROOM_WIDE_ADDRESS_RE`** (`chatter-coordinator.ts`, matches "everyone"/"everybody") is a DISTINCT
  category from the existing small explicit plural ("you both"/"you guys") — the small-plural group names a
  roughly fixed-size group regardless of room size and keeps the existing fixed `MAX_ADDITIONAL_RESPONDERS`
  (2 additional / 3 total) cap unchanged; "everyone" invites the whole deployed team and now scales instead.
  `isRoomWideAddress()` + `roomWideResponderCount(activeModeratorCount)` = `max(1, ceil(n/2))` — matches the
  exact worked examples given: 2→1, 5→3, 10→5. `resolveMultiTargetAddress` now also matches
  `ROOM_WIDE_ADDRESS_RE` (same as the existing plural-address branch, returning every deployed moderator) —
  the SCALING itself is applied downstream, not inside this function.
- **`resolveAdditionalResponderIds`** (`community-runtime.ts`) gained an optional third `maxAdditional`
  parameter (defaults to `MAX_ADDITIONAL_RESPONDERS`, so every existing call site/behavior for a small explicit
  plural is unchanged). The one real call site (`handleHumanMessage`'s multi-target fan-out) now checks
  `isRoomWideAddress(event.text)` and, when true, passes `roomWideResponderCount(deployments.length) - 1` (minus
  the primary, already counted) instead of the fixed cap.
- New tests: `chatter-coordinator.test.ts` (+8 — "everyone"/"everybody" detection, an ordinary message correctly
  not triggering it, "everyone" resolving via `resolveMultiTargetAddress`, the exact 2→1/5→3/10→5 worked
  examples, rounding-up behavior, confirming the small-plural cap is unaffected), `community-runtime.test.ts`
  (+4 — the scaled cap actually overriding the default at both the 5- and 10-deployed worked examples, omitting
  the cap still falling back to the default, a cap of 0 correctly yielding zero additional responders). 647
  tests pass (up from 636), `tsc --noEmit` clean, production build clean. No migration.

### 2026-08-12 — AI Moderator pricing/entitlement model revision — canonical source only (v1.13.0)
- **Full pricing/entitlement rework per approved spec.** Per explicit instruction, updated the CANONICAL source
  (`src/lib/money.ts` + `src/lib/moderator/plan.ts`/`customer-entitlement.ts`) first, and made dependent
  UI/actions derive from it rather than duplicating numbers — audited every file referencing the old constants
  (`AiModeratorSurface.tsx`, `customer-moderator.ts`, `customer-entitlement.ts`, `plan.ts`, `money.test.ts`)
  before changing anything.
- **New core pricing** (`money.ts`): Basic $49.99 (unchanged) / Standard **$114.99** (was $99.99) / Premium
  **$209.99** (was $179.99) / Pro **$359.99** (was $299.99). Slot counts (2/5/10/20) and community counts
  (1/2/3/5) were already correct from earlier work — no change needed there.
- **Direct-mode commission dropped from a flat 20% to the approved 5%** (`MODERATOR_COMMISSION_SHARE`) — the
  customer pays Innvil directly, the owner is credited this share to their Innvil wallet.
  `subscribeCustomerModeratorPlan` already read this constant, so the rate correction flows through with zero
  code change beyond the constant itself.
- **New `MODERATOR_RENTAL_DISCOUNT` (10%)** for the Rental/wholesale commercial mode (owner buys capacity from
  Innvil below list, resells to their own customer at their own price, keeps 100%, no additional commission).
  `plan.ts` already had an unfinished `commercialMode: "commission" | "rental"` type stub with a doc comment
  referencing this constant — the constant now actually exists, but **Rental mode's billing path is NOT wired
  up**: it needs an owner-side wholesale-subscribe action and a customer-facing resale-price charge (the
  customer pays the OWNER, not Innvil — structurally different from `subscribeCustomerModeratorPlan`, which is
  Direct-mode only). Documented inline; flagged to the user as a separate follow-up rather than half-building it.
- **New Enterprise slot-pricing formula** — `moderatorEnterpriseSlotPrice(totalSlots)`: starts from the Pro base
  (20 slots/$359.99), +$15/slot for slots 21–50, +$13/slot above 50. Live-verified against both spec worked
  examples (50 slots → $809.99, 75 slots → $1,134.99). `moderatorEnterpriseIncludedCommunities(totalSlots)`:
  Pro's 5 included, +2 (→7) for +10..+29 extra slots above Pro, +3 (→8) for +30 or more. Enterprise stays a
  direct-contact/direct-Innvil sale with no panel-owner commission/rental split (unchanged from before).
- **New community-entitlement model** — communities are a separate axis from Active Moderator Slots (a
  purchased community never grants extra slots). `MODERATOR_COMMUNITY_CAPACITY`: Basic/Standard hard-capped (1/2,
  no expansion), Premium expandable 3→5, Pro expandable 5→10. `plan.ts`'s `CAPACITY.maxCommunities` and
  `customer-entitlement.ts`'s `customerModeratorCapacity()` now both READ the included count from this single
  `money.ts` table instead of a second hardcoded copy. New `moderatorCommunityExpansionCeiling()` (both files)
  exposes the paid-expansion ceiling for a future purchase flow.
- **New additional-community/auto-post pricing constants** — `MODERATOR_ADDITIONAL_COMMUNITY_PRICE` ($9.99,
  access only) / `MODERATOR_ADDITIONAL_COMMUNITY_WITH_AUTOPOST_PRICE` ($14.99, access + 1 post/day);
  `moderatorAutopostFrequencyAddonPrice(postsPerDay)` for extra daily frequency in an already-autoposting
  community (2/day = +$9.99, 3/day = +$19.98, capped at `MODERATOR_AUTOPOST_MAX_PER_DAY` = 3). Customer-facing
  wording must always be daily-frequency-per-community, never a monthly quota (per spec).
- **New pooled monthly AI-conversational-response allowance** — `MODERATOR_AI_RESPONSE_POOL` (Basic 1200 /
  Standard 2400 / Premium 4200 / Pro 7200), `customerModeratorAiResponsePool()`. Explicitly does NOT apply to
  the trial (which keeps its own, already-enforced, separate daily reactive quota — `TRIAL_REACTIVE_DAILY_LIMIT`,
  v1.7.0 — returning 0 here rather than double-counting against a different mechanism). SILENCE/REACT/
  deterministic SHORT_ACK/GM-GN template sends/no-generation moderation actions were already zero-AI-call paths
  (v1.9.0+) and continue to never consume this pool once metering is built.
- **Storefront UI** (`AiModeratorSurface.tsx`): the `TIERS` display array is now COMPUTED from the canonical
  constants (`moderatorPlanPrice`, `MODERATOR_CAPACITY`, `MODERATOR_COMMUNITY_CAPACITY`) instead of a third
  hardcoded copy of the same numbers; tier cards now also show included/expandable community counts. Still
  gated behind the existing `aiModeratorComingSoon` flag (Storefront.tsx) — not un-gated, per standing
  instruction.
- **Scope note (deliberately NOT built this pass, to avoid half-finished money code):** the actual
  purchase/consumption flows for Rental mode, additional-community purchases, auto-post-frequency purchases,
  and AI-response-pool metering. These all depend on either a feature that isn't built yet (auto-posting itself
  is Phase 4.N, still NOTED/not built) or a materially separate billing pathway (Rental) — the canonical pricing
  FUNCTIONS all exist and are tested, but nothing calls them from a purchase action yet. AI routing (DeepSeek for
  casual chat, Sonnet 5 medium for substantive Q&A/scheduled auto-post generation, zero-call for SILENCE/REACT/
  SHORT_ACK) was already correct per the spec's own preservation instruction — no change needed there.
- New/updated tests: `money.test.ts` (+24 — full pricing table, commission/rental rate separation, Enterprise
  formula incl. both spec worked examples and the band-51 boundary, community capacity/expansion, additional-
  community pricing, autopost frequency pricing incl. the 3/day cap, AI response pool), `plan.test.ts` (+6 —
  community expansion ceiling per tier incl. trial and no-entitlement), `customer-entitlement.test.ts` (+8 —
  same ceiling function via the customer-facing entitlement source, AI response pool incl. the trial
  non-double-counting case). 636 tests pass (up from 603), `tsc --noEmit` clean, production build clean. No
  migration (all changes are in-code constants/pure functions; no new DB columns needed for what's wired up).

### 2026-08-12 — Bot-ack REACT was silently failing: invalid emoji + swallowed Telegram errors (v1.12.3)
- **Live test of the v1.12.1 opener-acknowledgement fix showed no reaction on Kwan's "gm everyone"** despite
  `moderator_activity_log` showing a clean `bot_message -> REACT` decision — the log was lying. Diagnosed by
  reproducing the exact `setMessageReaction` call live against the real bot token/chat/message id.
- **Root cause #1 (invalid emoji):** Telegram's `setMessageReaction` only accepts emoji from ITS OWN fixed,
  platform-wide reaction list — this is separate from a chat's "allow all reactions" admin setting, which just
  means "allow any reaction from Telegram's list," still excluding anything outside it. `coordinator.ts`'s
  `REACT_EMOJIS` (`👍`, `👋`, `🙌`) and `chatter-generate.ts`'s `personaReactionEmoji` positive/agreement pools
  (`🙌`) both included "👋" (waving hand) and/or "🙌" (raised hands), neither of which is a valid Telegram
  reaction — live-verified `400 REACTION_INVALID` for both, even with the chat's reactions fully open. Replaced
  with confirmed-valid alternatives (`🎉`, `👏`) — live re-verified accepted.
- **Root cause #2 (silent failure, same bug class as the `/api/v2` incident):** the bot-ack branch in
  `community-runtime.ts`'s `handleCommunityUpdate()` called `logBotAckDecision()` (logging the DECIDED action,
  e.g. "REACT") **before** `executeAction()` even ran, and never checked `executeAction`'s return value
  afterward — so a Telegram-side rejection was completely invisible, logged identically to success. This is the
  exact bug class already fixed in the Natural Chatter REACT path back in v1.9.2 (`reactAsDeployment`, which
  DOES check `result.ok` and logs `REACT_FAILED`) — the bot-ack path had never received the same fix. Now
  checks `sent.ok`; on failure, `console.error`s the real Telegram error and logs a `{action.kind}_FAILED`
  activity entry instead of pretending success. `recordBotAck` (the target's pacing/rate-limit bookkeeping) now
  only runs on a confirmed-successful send — a failed action no longer consumes the target's cooldown/daily-cap
  budget.
- **Defense in depth:** `executeAction`'s REACT branch (`community-runtime.ts`, shared by both the bot-ack and
  Natural Chatter paths) now retries once with `👍` — a near-universal Telegram reaction — whenever the chosen
  emoji comes back `REACTION_INVALID`, rather than only improving the logging. A single retry, not a discovery
  round-trip to the chat's actual allowed-reactions set.
- **Files changed:** `coordinator.ts` (emoji pool), `chatter-generate.ts` (emoji pools), `community-runtime.ts`
  (`executeAction`'s REACT-fallback retry + the bot-ack caller's honest failure handling).
- No test suite changes this pass — verified via `tsc --noEmit` (clean), the full 603-test suite (unchanged,
  no existing test asserted on a specific REACT emoji value), a clean production build, and a live
  `setMessageReaction` reproduction against the real test chat confirming all three new pool emoji (`👍`, `🎉`,
  `👏`) are now accepted. No migration.

### 2026-08-11 — Bot-to-bot opening acknowledgement made deterministic + fixed @username leak (v1.12.1)
- **Live test found two real bugs after confirming bot-to-bot Telegram delivery itself was finally
  working** (Kwan's message reached Test's webhook, classified correctly as `INNVIL_MODERATOR`). The
  Coordinator evaluated it and returned `IGNORE` — traced to `ACK_PROBABILITY = 0.35` in
  `coordinator.ts` applying uniformly to EVERY bot-to-bot message, including genuine openers ("gm",
  "hello", "hey everyone"), when an opening statement between two Innvil moderators should always be
  acknowledged, not "occasionally."
- **Root cause #1 (probability):** `decideBotAcknowledgement()`'s `ACK_PROBABILITY` roll didn't
  distinguish an opening statement from ordinary bot-to-bot chatter. **Fix:** reuses the SAME semantic
  opener classifier Natural Chatter already applies to human messages
  (`chatter-coordinator.ts`'s `isConversationalOpener` — no new/duplicate greeting detector) to bypass
  the probability roll ONLY for genuine openers; every other hard gate (sender type, `BOT_ACK` origin,
  interaction depth, `botAckMode`, rate limits) still fully applies, and ordinary/non-opening bot
  chatter keeps the exact same 35% "occasional" behavior as before — the fix is scoped to the specific
  semantic event, not a global `0.35 → 1.0` change.
- **Root cause #2 (naming leak):** `classifySender()`'s bot branch (`community-runtime.ts`) set
  `displayName: from.username ?? from.first_name ?? null` — since Telegram bots always have a
  username, a recognized Innvil moderator's `displayName` was ALWAYS its raw Telegram bot username
  (`kwan_mod_bot`), which `coordinator.ts`'s `craftAckText()` puts directly into generated
  acknowledgement text ("Morning kwan_mod_bot 👋" instead of "Morning Kwan 👋"). **Fix:** for a
  `senderType === "INNVIL_MODERATOR"`, `displayName` now resolves from the moderator's CONFIGURED name
  (`virtual_moderators.name`, fetched via a new `telegram_bot_integrations → virtual_moderators(name)`
  embed — verified live against the DB to rule out the same `PGRST201` ambiguity that broke `/api/v2`
  in the fix above) — never the Telegram username. A missing configured name safely falls through to
  `null` (craftAckText's name-free template pool: "Got it 👍" / "Hey 👋"), never the raw handle.
  `EXTERNAL_BOT`/`HUMAN` senders are unaffected (still use Telegram-provided naming, which never claims
  to be a configured moderator's name).
- **Files changed:** `coordinator.ts` (opener bypass + a couple more opener-flavored templates),
  `community-runtime.ts` (`classifySender` name resolution, now exported for direct testing).
- New tests: `coordinator.test.ts` (+11 — opener bypass across multiple phrasings, every other gate
  still applies to openers, no-recursion via `BOT_ACK` origin, exactly-one-selected-moderator with
  multiple eligible targets, name-safety in generated text, null-name fallback) plus one existing test
  fixed (its default fixture text was accidentally an opener, which no longer proves what it was
  testing — text changed to genuine non-opener chatter); `community-runtime.test.ts` (+5 — direct
  `classifySender` tests proving configured-name resolution, no-username-leak, safe null fallback,
  `EXTERNAL_BOT`/`HUMAN` paths unaffected). 603 tests pass (up from 588), `tsc --noEmit` clean,
  production build clean. No migration.

### 2026-08-11 — Fix: customer API `panels(...)` embed became ambiguous after migration 0051 (v1.11.2)
- **The actual root cause** of the "Invalid API key" incident above, found immediately after v1.11.1 shipped:
  once errors were surfaced instead of swallowed, `/api/v2` started returning `500 Server error validating
  API key` for EVERY request, including a deliberately-invalid test key — proving the query itself was
  failing, not just "no row found." Vercel logs showed `PGRST201: Could not embed because more than one
  relationship was found for 'customer_accounts' and 'panels'`.
- **Root cause**: migration `0051_customer_moderator_entitlement.sql` (earlier this session, Phase 4.M.1)
  added `customer_moderator_entitlement` with FKs to BOTH `customer_accounts` and `panels` — a second valid
  join path between those two tables. PostgREST can no longer resolve `loadUserByKey`'s implicit
  `panels(status, settings)` embed unambiguously (confirmed live via a direct PostgREST query reproducing the
  `PGRST201` with both candidate relationships listed). Grepped the rest of the codebase — this was the ONLY
  place using an implicit `customer_accounts → panels(...)` embed; every other call site queries `panels`
  separately, unaffected.
- **Fix**: pin the embed to the actual FK, `panels!customer_accounts_panel_id_fkey(status, settings)` — exactly
  the disambiguation PostgREST's own error `hint` suggested. Verified directly against the live database
  (200, resolves correctly) before shipping. `tsc --noEmit` clean, production build clean.
- **Correction to the "not the root cause" note in v1.11.1 below**: it WAS caused by this session's own earlier
  work, just migration `0051` (Aug 11, customer AI-moderator entitlement) — not anything in the later Virtual
  Moderator chatter/moderation work the user originally suspected.

### 2026-08-11 — Fix: customer API `loadUserByKey` silently swallowed real DB errors as "Invalid API key" (v1.11.1)
- **Live incident**: an external integration (customer's own SMM automator, hitting `/api/v2?action=balance`)
  started failing with `401 Invalid API key` even for a freshly generated key — diagnosed live: the key's hash
  was confirmed written to `customer_accounts.api_key_hash` and read back as an exact match, yet the deployed
  endpoint still rejected it. Root cause: `loadUserByKey` (`app/api/v2/route.ts`) destructured only `{ data }`
  from the Supabase query, never checking `error` — `.maybeSingle()` returns `{data:null, error:null}` for a
  genuine "no matching row," but ALSO `{data:null, error:{...}}` for a real query failure (bad/rotated
  service-role credentials, connection issue, etc.), and both collapsed into the same `!data` → `401 Invalid
  API key` response, making a real backend failure indistinguishable from an actually-wrong key.
- **Fix**: `loadUserByKey` now returns `{ok:false}` on a genuine query error (logged via `console.error` with
  the Supabase error code/message, never silently swallowed) vs. `{ok:true, user:null}` for a real "no match."
  `process()` now returns `500 "Server error validating API key"` for the former, `401 "Invalid API key"` only
  for the latter — so the next occurrence is diagnosable from Vercel function logs instead of looking identical
  to a customer typo. Confirmed via `tsc --noEmit` + production build; no existing tests cover this route.
- **Not the root cause of the original 401** (that's environment/credentials-side, outside this session's
  branch — verified this session's preview-alias deploys never reached the `trendtitan.xyz` production domain,
  and the live production Supabase project ref matches `.env.local`'s), but this fix means the REAL underlying
  error will now surface in logs on the next occurrence instead of being masked.
- **Same `{data} = await ...` pattern (destructuring without checking `error`) still exists elsewhere in this
  file** (services/orders lookups) — lower severity there (empty results vs. a misleading auth rejection), not
  fixed in this pass; worth a follow-up sweep.

### 2026-07-25 — Collage mockup: single-platform tile on a focused panel (v1.1.44)
- Finishes the platform-focus visual pass. On a platform-focused panel, the Agency design's `mockup:"collage"`
  platform card now shows **ONE big "Built for [platform]" tile** (large `PlatformGlyph` + capitalized name) instead
  of the multi-platform icon row; all-platforms panels keep the row. `DesignRenderer` branches on
  `data.focusPlatform` (already plumbed). Matches the orbit hero's single-platform treatment.
  (Versions 1.1.35–1.1.43 were the owner's Binance Order-ID rework — order_id column, C2C-only matching, etc.)

### 2026-07-25 — Binance Pay: owner review + reconcile (v1.1.34)
- **New "Binance Pay review" card** in the Payments tab (shown only when Binance Pay is connected) — the last
  deferred Binance nice-to-have. Lets the owner see every Binance deposit (amount wanted / exact payable / bonus /
  status / matched tx), and **Credit or Cancel** the ones that didn't auto-credit (wrong amount, recipient, or stuck
  pending) after verifying in their Binance account. Also shows the **cached Pay history** (received transactions,
  flagged credited/unmatched) and a **stale-sync alert** when history hasn't refreshed while deposits are open.
- `src/lib/actions/binance-admin.ts` (NEW, owner-auth) — `getBinanceReview(panelId)` returns `{deposits,
  transactions, lastSyncAt, syncStale}` (payments where `gateway='binance_pay'` + `binance_pay_transactions`,
  customer identity resolved). Credit/Cancel reuse the existing `commitPendingPayment` / `cancelPendingPayment`.
  `AdminTabs.tsx` `BinanceReviewCard` renders it. No migration.

### 2026-07-25 — Repo handoff docs for resuming the major update (v1.1.33)
- Added `docs/handoff/` so another agent/session can continue cleanly: `README.md` (current state,
  migrations 0031–0038 + pg_cron + env/Supabase settings to apply, "build first" warning),
  `pending-items.md` (email-change OTP → Binance admin review → collage mockup → default-landing TG
  sections → Telegram add-on, each with files + build steps), and `conventions.md` (gotchas:
  never `export type` from a `"use server"` file, pg_cron not vercel.json + the `*/`-in-comment
  bug, OTP/Resend requirements, `placeOrderForAccount` money-core, platform-focus wiring, version/
  commit protocol). Docs only.

### 2026-07-25 — Branded password-reset OTP (no more Supabase reset link) (v1.1.32)
- **Password reset is now our own panel-branded OTP too** (like signup), so the reset email carries the panel's
  name and there's no Supabase magic link → no localhost/Innvil link. `customerForgotPassword(panelId, email)`
  resolves the user via new SQL `auth_user_id_by_email` (migration **0038**), stores a `reset`-purpose code in
  `customer_signup_otps` (new `purpose` column) and emails it via Resend; **always returns ok** (no account
  enumeration). `customerResetPassword(panelId, email, code, newPassword)` verifies (15-min TTL, 5 attempts) →
  `admin.updateUserById({password})`.
- `ForgotPasswordClient` is a 2-stage flow (email → code + new password); the old link-based `reset-password`
  route now just redirects there (kept for old bookmarks). `sendOtpEmail` gained a `kind` (signup/reset/change)
  for the copy. **Run migration 0038.**
- **Still Supabase-flow (small follow-up):** the logged-in **email-change** confirmation (`customerUpdateEmail`)
  — convert to the same OTP pattern next.

### 2026-07-25 — Platform-focus hero: single icon revolves + lights-out pulse (v1.1.31)
- Supersedes the v1.1.30 fly-across version. **On a platform-focused panel, the Orbit hero shows ONE platform icon revolving** continuously around the orbit
  ring surrounding the "+18% growth" card, instead of the multi-platform orbit. Kept **upright** (no self-spin) via
  an arm/counter-rotate pattern; relaxed **16s** revolution; and a **"lights-out" pulse every 5s** — visible ~2s,
  then a gentle ~3s fade-away-and-reappear (opacity out/in + slight shrink), still orbiting. Pulse period (5s) ≠
  revolution (16s).
- `DesignRenderer`: `dzOrbit` (arm rotates around centre) + `dzOrbitCounter` (item counter-rotates to stay upright)
  + `dzOrbitPulse` (5s: ~2s visible, ~3s fade out→in) keyframes. `DesignRenderData.focusPlatform` drives the branch in
  the `mockup:"orbit"` section (focus → single revolving icon `zIndex:5` above rings/card; else the orbiting badges).
  Threaded from `app/p/[subdomain]/page.tsx` (`panel.platformFocus`) and the Design Studio preview (`focus`).

### 2026-07-25 — Custom panel-branded signup OTP (replaces Supabase confirmation email) (v1.1.29)
- **Customer email verification is now our OWN OTP**, so the confirmation email carries the PANEL's name (not
  Innvil) and no longer depends on Supabase's project-wide template / Site-URL (which caused the localhost + Innvil
  emails). Flow: `customerSignUp` creates the user **unconfirmed via the admin API** (`createUser email_confirm:false`
  — sends NO Supabase email), stores a hashed 6-digit code (`customer_signup_otps`, migration **0037**), and emails
  it via **Resend** branded with the panel name. `customerVerifyOtp` checks the code (15-min TTL, 5 attempts) →
  `updateUserById email_confirm:true` → creates the customer account; the SignUpClient then auto-signs-in with the
  same credentials. `customerResendOtp` reissues a code. `sendEmail` gained a `fromName` (panel display name; domain
  stays the verified Resend one).
- `SignUpClient` is now a 2-stage form (details → **6-digit code** entry with Resend/Back), works in both the
  standalone page and the embedded design auth slot.
- **REQUIRES:** `RESEND_API_KEY` set (+ a verified `RESEND_FROM` domain) — without it the code can't be delivered and
  signup can't complete. Keep the Supabase **"Confirm email" setting ON** (so an unconfirmed user can't sign in until
  the OTP confirms them). **Run migration 0037.**

### 2026-07-25 — Customer login by username-or-email + Binance Order-ID flow (v1.1.28)
- **Customer login now accepts a username OR an email.** `customerSignIn(panelId, identifier, password)` resolves a
  non-email identifier to its login email WITHIN that panel (`customer_accounts` → `profiles.display_name` →
  `auth.admin.getUserById`), then signs in. Storefront login input is now `type=text` placeholder "Email or username".
- **Binance Pay is now transaction-id based (no auto-detect), matching the requested 2-step UX.** `BinancePayPanel`
  rebuilt as **(1) Make payment → (2) Verify payment**: step 1 shows amount + Binance ID + QR + "I've paid — verify";
  step 2 has an **"Enter your Binance Order ID"** field + Verify (`claimBinancePayment`). Dropped the 12s auto-poll +
  "check now" (`checkBinanceDeposit` / the `binance-sync` cron still exist as a background safety net; the customer
  path is TXID-only). Unique-amount anti-theft + 10-min expiry retained.
- **NOTE (config, not code):** customer confirmation emails going to *localhost* and showing *Innvil* branding are a
  **Supabase Auth** issue, not the app — set the project **Site URL** to prod, allowlist panel redirect URLs, add
  **custom SMTP** (deliverability), and note Auth email templates are **project-wide** (can't be per-panel branded
  without a custom OTP/magic-link flow via Resend). The signup code already passes the panel's own URL as `emailRedirectTo`.

### 2026-07-25 — Platform focus: live in the Design Studio preview (v1.1.27)
- **Fix: toggling "Telegram only" in the Design Studio didn't change the preview** — the preview rendered the
  design's own copy and never applied the overlay (the overlay only ran server-side on the live storefront).
  `DesignStudio` now computes `applyPlatformContent(activePkg, focus)` and renders that; the default (non-design)
  preview hero falls back to the platform pack's headline/description. So selecting a focus re-themes the preview
  instantly, matching what the live storefront shows after Save & apply.

### 2026-07-25 — Platform-specific panels (Telegram first) (v1.1.26)
- **A panel can now be scoped to ONE platform** (e.g. Telegram-only) or left as all-platforms (default). A
  focused panel gets **platform-specific landing marketing** AND a **hard catalog filter** (storefront shows only
  that platform's services). Set at creation and **editable later**. Grows one platform at a time — Telegram now.
- `src/lib/platform-focus.ts` (NEW, pure) — `PlatformFocus` ("telegram"), `PLATFORM_FOCUS_OPTIONS`,
  `readPlatformFocus`/`normalizePlatformFocus`, `platformAllowedByFocus`. Stored on `panels.settings.platformFocus`
  (no migration).
- **Content overlay:** `src/lib/design/platform-content.ts` (NEW) — `PlatformContentPack` + `applyPlatformContent(pkg, focus)`
  which overlays the platform pack's COPY onto a design's LANDING page (hero/features/steps/testimonials/faq/cta),
  preserving tokens/layout/animation. So **even a purchased design (Pulse, etc.) reads as Telegram-only.**
  `src/data/platform-content/telegram.ts` (NEW) — the Telegram pack (hero, features, steps, testimonials, FAQ, CTA, SEO).
- **Wiring:** `createPanel` accepts `platformFocus`; create wizard Basics step has an "All platforms / Telegram only"
  choice; `getPublicPanel` returns `platformFocus`; `getStorefrontServices` hard-filters services to the focus;
  `app/p/[subdomain]/page.tsx` applies `applyPlatformContent` to the active design, overrides the default landing
  hero copy, and sets Telegram-flavored SEO. Owner can change focus in the **Design Studio → Platform focus**
  (`updatePanelBranding`/`getPanelBranding` gained `platformFocus`).
- **Known follow-up:** the DEFAULT (non-design) landing gets TG hero + TG-only catalog + TG SEO now; its deeper
  sections (benefits/FAQ/how-it-works in `Storefront.tsx`) still show generic copy — theme those from the pack next.
  Purchased designs are already fully TG-themed.

### 2026-07-25 — Fix: "PlaceOrderInput is not defined" on panel create (v1.1.25)
- **Root cause:** re-exporting a TYPE from a `"use server"` module (`export type { PlaceOrderInput, PlaceOrderResult }`
  in `actions/orders.ts`, `export type { BinanceClaimResult }` in `actions/binance-pay.ts`). Next treats every export
  of a server-action module as an action; the erased type became an undefined runtime reference, crashing any client
  bundle that transitively loaded it (e.g. the create-panel wizard → `PlaceOrderInput is not defined`).
- **Fix:** dropped both `export type { … }` re-exports and switched to `import type { … }` for the annotations.
  Nothing external imported those types from the action modules (they also live in `orders/place.ts` /
  `payments/binance-match.ts`). **Rule:** never `export type` from a `"use server"` file — re-export shared types
  from a plain server-only module instead.

### 2026-07-25 — Mass order split out + build/launch fixes (v1.1.24)
- **Mass order is now its OWN tab, separate from Campaign.** `MassOrderCard` (nested inside `CampaignSurface` in
  all three states) was extracted to `src/components/customer/MassOrder.tsx` and mounted as a dedicated
  **"Mass order"** nav item/page in `CustomerDashboard` (`CustomerPage` gained `massorder`). `CampaignSurface` no
  longer renders it (dropped the three inline instances + the now-unused `runMassOrder`/`MassOrderResult` imports).
- **Fix: create-panel stuck on "Launching…".** The wizard's `launch` had no try/catch, so a thrown server action
  (e.g. while the build was broken) left `busy=true` forever. Now wrapped — surfaces the error + resets the button.
- **Fix: build error `Expression expected` in `app/api/cron/watch-accounts/route.ts`.** A `*/5 * * * *` cron
  expression inside a `/* … */` block comment closed the comment early. Reworded the comment (schedule lives in
  migration 0036).
- **Completed R5b's missing dependency:** the session-less order core. `src/lib/orders/place.ts` (NEW,
  server-only) holds `placeOrderForAccount(admin, panel, acct, input)` — the full money path (price → duplicate
  guard → charge → provider forward → refund). `actions/orders.ts` `placeOrder` is now a thin auth wrapper over
  it; `watch-sweep.ts` (R5b) uses it to order on behalf of a resolved customer with no session. No behaviour change.

### 2026-07-25 — Automator v2 — R5b: watched accounts / full-auto (feed-based) (v1.1.23)
- **The Business+ "watched accounts" perk is now live** — full-auto ordering of new posts. Innvil can't reliably
  scrape X/IG/TikTok from serverless, so it's **feed-based** (bring-your-own, like providers): the customer
  registers an **RSS/Atom feed URL** per account; a cron polls it and fans new post links out through their
  automation profile.
- **Session-less ordering refactor:** the order money-path moved from `actions/orders.ts` into
  `src/lib/orders/place.ts` (`placeOrderForAccount`) so the cron can place orders on behalf of a resolved
  customer account (no session). `placeOrder` is now a thin auth wrapper over it — behaviour unchanged.
- `src/lib/automation/feed.ts` (NEW) — `fetchFeedLinks` / `parseFeedLinks` (RSS + Atom, no dep, newest-first,
  baseline-diffed). `src/lib/automation/watch-sweep.ts` (NEW) — `sweepWatchedAccounts`: for each active feed on a
  live Business+ panel with an active sub + configured profile, detects new posts (capped 3/run), enforces the
  tier platform scope, and orders via `slotsForLink` → `placeOrderForAccount`; advances the baseline; records a
  campaign. Route **`app/api/cron/watch-accounts`** + schedule **`0036_supabase_watch_accounts_cron.sql`** (every
  5 min).
- **Migration `0035_watched_accounts.sql`** (NEW) — `watched_accounts` (panel/customer/label/feed_url/
  last_item_url/active; RLS = panel members / super admin / owning customer). **Run 0035 + 0036.**
- `actions/watched.ts` (NEW) — `getWatchedAccounts` / `addWatchedAccount` (validates the feed + baselines to the
  newest item so history isn't ordered) / `setWatchedActive` / `removeWatchedAccount` (gated: Business+ tier +
  active sub). Storefront `CampaignSurface` gained a **Watched accounts** card (Business+ only); the subscribe-card
  perk dropped its "coming soon" tag.
- **Automator v2 R1–R5 complete.** Run migrations **0035, 0036** (+ schedule the `innvil-watch-accounts` cron).

### 2026-07-25 — Binance Pay: landing/SEO marketing + USDT-only hints (v1.1.22)
- **Landing:** the "Wallets + crypto deposits" card now lists Binance Pay; added a dedicated **"Accept USDT via
  Binance Pay"** feature card (unique-amount auto-reconcile, no merchant account, optional bonuses)
  (`PublicLanding.tsx`). **SEO:** added keywords "smm panel binance pay", "accept usdt smm panel", "smm panel
  crypto payments" (`app/layout.tsx`).
- **USDT-only surfaced to customers:** the Add-Funds Binance hint leads with "USDT only"; the pay panel shows a
  "**USDT only** — sending any other coin won't be credited" warning under the exact amount. Owner connect help
  notes "Accepted asset: USDT only". (Enforced server-side already — currency must equal USDT.)

### 2026-07-25 — Binance Pay — Phase 2: unique payable amount + auto-credit poller (v1.1.21)
- **Anti-theft via unique payable amounts.** Each pending Binance deposit is assigned a unique amount
  (base + a tiny 0.0001-step tail, unique among the panel's open deposits) — the customer sends *exactly* that.
  A transaction maps to exactly one deposit by (amount + receiver UID + time window), so nobody can claim a
  payment that isn't theirs, and the exact-amount match replaces loose amount policies. Migration
  **`0033_binance_payable.sql`** (NEW) adds `payments.binance_payable` + a partial index. **Run 0033.**
- **Hands-free auto-credit.** `src/lib/payments/binance-match.ts` (NEW, server-only, non-action so it can export
  sync helpers) holds the shared `pickPayable` / `validateTx` / `findMatchingTx` / `creditMatch` core.
  `actions/binance-pay.ts` now exposes **`checkBinanceDeposit`** (no TXID — sync + match by unique amount →
  credit) alongside the TXID-submit `claimBinancePayment` (now also amount-guarded). `src/lib/payments/binance-poll.ts`
  (`sweepBinanceDeposits`) + route **`app/api/cron/binance-sync`** sweep every panel with an open deposit and
  auto-credit matches. Scheduled by **`0034_supabase_binance_sync_cron.sql`** (NEW, every minute, vault
  `app_url`/`cron_secret`). **Run 0034.**
- Storefront `BinancePayPanel` rebuilt: shows the **exact amount to send** (the match key, copyable), **polls
  every 12s** to auto-detect the payment (plus an "I've paid — check now" button), and keeps the transaction-id
  entry as a collapsible fallback. `Storefront` passes `onBinanceCheck`. The requested top-up is credited (+ bonus);
  the tiny unique tail is a disclosed processing margin.
- **Binance Pay is now production-ready** (Phase 1 + 2 complete). Deferred nice-to-haves: richer admin
  review/alerts. **NEXT (per user): add Binance Pay to the Innvil SEO + landing marketing.**

### 2026-07-25 — Binance Pay: top-up bonus + 10-minute expiry (v1.1.20)
- **Binance Pay deposits now earn the same tiered top-up bonus** as the other gateways (e.g. 100 USDT → +1%).
  `claimBinancePayment` resolves the panel's discount tier for the base amount via the shared
  `resolveGatewayDiscountPct` (exported from `actions/payments.ts` — per-gateway `discountRules`, else the crypto
  category default), credits `base + bonus`, and records `bonus_amount` on the payment. Base = received
  (credit_actual) or requested (exact). Storefront shows the "send X → receive X+bonus" line before paying
  (dropped the earlier binance discount suppression).
- **10-minute deposit window.** `createBinanceDeposit` returns `expiresAt` (created_at + 10 min);
  `claimBinancePayment` rejects with `EXPIRED` past it. The customer `BinancePayPanel` shows a live mm:ss
  countdown and disables Verify when it lapses.
- **Each TXID is single-use** (unchanged) — the partial unique index on `payments.binance_tx_id` plus a
  pre-check. Receiver match is against the owner's configured Binance UID.

### 2026-07-25 — Binance Pay (personal-account reconciliation) — Phase 1 (v1.1.19)
- **New per-panel payment method: Binance Pay** — the owner connects their OWN read-only Binance key; the
  customer pays the owner's Pay ID and submits the transaction id; the server pulls the owner's Pay history,
  matches + validates, and credits the wallet. **NOT** an official merchant checkout (personal-account
  reconciliation). Internal id `binance_pay`; accepted asset **USDT**, credited 1:1 into the wallet.
- **Migration `0032_binance_pay.sql`** (NEW) — `binance_pay_transactions` (per-panel Pay-history cache, RLS on
  with no policies = service-role only) + `payments.binance_tx_id` with a **partial unique index** (one Binance
  tx credits at most one deposit). **Run migration 0032.**
- `src/lib/payments/binance.ts` (NEW) — signed HMAC-SHA256 client for `sapi/v1/pay/transactions`.
  `src/lib/payments/binance-sync.ts` (NEW) — `syncPanelBinanceHistory(panelId)` (decrypts the owner key, upserts
  the overlapping window; single-flight). `adapters/binance.ts` (NEW) — a fields-only "adapter" so the owner
  CONNECT form + encrypted secret storage reuse the gateway machinery (`createCheckout`/`verifyWebhook` never
  run). Registered in the adapter map + `GATEWAY_CATALOG` (crypto, available).
- `src/lib/actions/binance-pay.ts` (NEW) — `createBinanceDeposit` (pending payment + pay-to details, no redirect)
  + `claimBinancePayment` (validate tx format → local lookup → sync-on-miss → checks: incoming/positive, currency
  == USDT, order type ∈ {C2C,PAY}, receiver UID when set, not older than the deposit, anti-replay → amount policy
  → atomic claim + `apply_balance_change('deposit')`, roll back on credit failure). **Amount policy** per gateway:
  `credit_actual` (default, credits what was received) or `exact` (mismatch stays pending for owner review).
- Storefront: `getPanelPaymentMethods` flags `binance_pay` as `manual`; `Storefront` passes `onBinanceCreate` /
  `onBinanceClaim`; `CustomerDashboard` renders a **BinancePayPanel** (QR + Pay ID + amount + paste-transaction-id
  → Verify) instead of a redirect. On success the wallet refreshes immediately.
- **Owner setup:** Payments tab → connect Binance Pay (Pay ID, optional UID/QR/amount-policy, read-only API key +
  secret). **Caveats surfaced in the connect help:** Innvil is serverless (no fixed egress IP → key IP-allowlist
  isn't reliable; keep it read-only); it's a personal-account workaround — confirm commercial receipts are
  allowed with Binance.
- **NEXT (Phase 2, deferred):** pg_cron poller (`/api/cron/binance-sync`), unique-payable-amount anti-theft,
  richer admin review + alerts.

### 2026-07-25 — Welcome message: manually send to existing customers (v1.1.18)
- **The welcome message can now be sent on demand to EXISTING customers** — individually or in bulk (the auto-send
  only fires for brand-new sign-ups). `actions/admin-tickets.ts` `sendWelcomeToCustomers(panelId, {customerIds?|all})`
  (owner-auth) renders the panel's configured welcome (`renderWelcome`) and opens a **welcome-kind** ticket per
  target so replying still grants the free credit **once**; customers who already have a welcome ticket are
  **skipped** (no second bonus). Returns `{sent, skipped}`.
- UI: a **"Send welcome"** button in each customer's expanded manage row (Customers tab), and a **"Send to all
  existing customers"** control in the **Welcome message** card (Notifications tab, with a confirm + result count).
- Needs migration **0031** (the `kind` column). No new migration.

### 2026-07-25 — Automated new-customer welcome + mobile payments fix (v1.1.17)
- **Every new customer now auto-receives an owner welcome message** (as a support ticket) — welcomes them,
  offers a small free credit if they reply, and invites them to Innvil. **Fully owner-editable** (edit the
  subject/body entirely, or turn it off).
  - `src/lib/welcome.ts` (NEW, pure) — `WelcomeConfig {enabled, subject?, body?, creditEnabled, creditAmount}` on
    `panels.settings.welcome`; `DEFAULT_WELCOME_SUBJECT`/`DEFAULT_WELCOME_BODY` (default copy with `{panel}` /
    `{credit}` placeholders), `readWelcomeConfig`, `normalizeWelcomeConfig`, `renderWelcome` (fills placeholders).
  - **Migration `0031_welcome_tickets.sql`** (NEW) — `support_tickets.kind` (default `general`, welcome ticket =
    `welcome`) + `welcome_bonus_granted` (one-time flag). **Run migration 0031.**
  - `actions/customer-auth.ts` — `ensureCustomerAccount` now detects a genuinely NEW account (insert, not upsert;
    loses the unique-constraint race → skips) and fires `sendWelcomeTicket` (owner-authored ticket, `customer_unread`).
  - `actions/tickets.ts` `customerReply` — first reply to the welcome ticket grants the owner's configured credit
    **once** (atomic flag-claim → `apply_balance_change` `manual_adjust` "Welcome bonus"; rolls back the flag on
    failure). Can't be farmed.
  - `actions/welcome.ts` (NEW, owner-auth) — `getWelcomeSettings` / `setWelcomeSettings` (audit-logged). Owner UI:
    the **Notifications tab** now hosts a real **"Welcome message"** card (`AdminTabs.tsx` `WelcomeMessageCard`) —
    toggle, subject, body, free-credit toggle + amount, reset-to-default; the email-notifications part stays "coming soon".
  - NOTE (white-label): the default body includes an Innvil invite line; owners can delete it since the whole
    message is editable.
- **Payments tab mobile fix** — the gateway rows were cramped on phones (badges + Edit/Disconnect crushed onto one
  line). The row now **stacks vertically on mobile** (label/badges wrap; the action buttons drop below full-width)
  and sits inline on `sm+`.

### 2026-07-25 — Automator v2 — R5a: Business+ file-upload link import (v1.1.16)
- **The Business+ "file upload" perk is now live** (the other half, watched-accounts/full-auto, stays deferred —
  it needs a cron + social-platform APIs). `src/lib/automation/file-links.ts` (NEW, client) —
  `extractLinksFromFile(file)` flattens **csv / xlsx / xls** (SheetJS) / **docx** (mammoth) / **txt** to text and
  runs the existing smart `parseCampaignLinks` (handles concatenated URLs). Both deps already ship.
- `CampaignSurface` (subscribed state): an **"Upload file"** button next to Configure, shown only when
  `sub.fileUpload` (owner on Business+). Extracted links are appended to the paste-links textarea (then Run as
  usual); a per-upload result note. The subscribe-card "file upload" perk dropped its "coming soon" tag
  (watched accounts keeps it).
- No migration. **NEXT (R5b, deferred):** watched-accounts / full-auto ordering (cron + platform polling).

### 2026-07-25 — Automator v2 — R4b: owner-configurable customer price + Business+ tier upgrade (v1.1.15)
- **The customer Automator subscription is no longer hard-coded** — the owner sets what customers pay and can
  run a promo. The $6.99 / $9.99 figures are just suggested DEFAULTS.
  - `src/lib/automation/pricing.ts` (NEW, pure) — `SUGGESTED_AUTOMATOR_PRICE` 6.99 / `SUGGESTED_AUTOMATOR_PLUS_PRICE`
    9.99; `AutomatorPricing {price?, promoActive, promoPrice?, promoLabel?}` on `panels.settings.automator`;
    `suggestedAutomatorPrice` (Business+ → 9.99, else 6.99), `baseAutomatorPrice` (override ?? suggested),
    `effectiveAutomatorPrice` (active valid promo ?? base), `automatorPromoApplies`, `normalizeAutomatorPricing`.
- **Business+ upgrades the storefront subscription.** The customer sub's feature set follows the OWNER tier:
  Business+ raises the suggested default to **$9.99** and unlocks **file upload + watched accounts** (surfaced on
  the storefront subscribe card as included · *coming soon* until R5 builds the surfaces).
- `actions/automator-sub.ts` — charges the **effective** price (was the flat constant); `AutomatorSubInfo` gained
  `basePrice`, `promoActive`, `promoLabel`, `fileUpload`, `watchedAccounts`. `billing/automator.ts` renewal sweep
  now charges each panel's **current effective price** (loads settings per involved panel).
- `actions/automator-pricing.ts` (NEW, owner-auth) — `getAutomatorPricing` / `setAutomatorPricing` (validates the
  promo is below the regular price; audit-logged). Owner UI: a **"Customer price"** card in the Campaign
  Automation tab (`AdminTabs.tsx` `CustomerPricingCard`) — monthly price (blank = suggested default) + a
  promo/discount toggle (promo price + label), shown once the owner has an active tier.
- Storefront `CampaignSurface` subscribe card shows the promo (strike-through base + label) and the Business+
  perks. No migration (`settings.automator` is JSONB config).

### 2026-07-25 — Automator v2 — R4: storefront teaser + subscribe + always-free mass order (v1.1.14)
- **The storefront Campaign tab is now the real customer surface — always visible to every customer** (drives
  demand). `CampaignSurface.tsx` rewritten as a 3-state machine driven by `getAutomatorSub`:
  1. **Not offered** (owner has no tier) → "How it works" + a **"Contact support to enable it"** button
     (`onContactSupport` → the Tickets tab).
  2. **Offered, not subscribed** → the pitch + a **$6.99/mo Subscribe** button (`subscribeAutomator`) with the
     customer's wallet balance + a lapsed-for-low-balance note.
  3. **Subscribed** → the full paste-links surface (live per-platform analysis, **Configure** → `AutomationConfig`
     keyword slots, **Run** → `runCampaign`, per-link results, recent campaigns).
- **Mass order stays available for FREE in ALL states.** New `runMassOrder({panelId, text})` in
  `actions/campaigns.ts` — storefront-auth'd, gated only on a **live panel + active customer** (no subscription):
  one order per line, `serviceId | link | quantity` (pipe or whitespace separated), the service id resolves by the
  panel's own **local_id** or the uuid, each placed via `placeOrder` (customer wallet). Returns `MassOrderResult`
  `{placed, totalCharge, failed, items}`. Rendered as a **"Mass order · Free"** card in every state of
  `CampaignSurface`.
- `CustomerDashboard.tsx`: the **Campaign** nav item is now always shown (dropped the `campaignEnabled` gate) and
  passes `onContactSupport={() => go("tickets")}`. `campaignEnabled` prop is now vestigial.
- **R1–R4 complete.** Run migrations **0028, 0029, 0030**. **NEXT (R5, deferred):** Business+ extras — file-upload
  link import + watched-accounts auto-order.

### 2026-07-25 — Faster "Provider balances → Refresh all" (v1.1.13)
- **The Provider-balances "Refresh all" was slow because each provider was a separate server action** — Next
  serializes server actions from one client, so the client-side `Promise.all(rows.map(fetchProviderBalance))`
  actually ran one-by-one. New **`refreshAllProviderBalances()`** (`actions/providers.ts`) refreshes EVERY
  provider across the owner's panels in **one** request, in parallel server-side (`Promise.all`); returns
  `{ refreshed, total }`. `OwnerProviderBalances.refreshAll` now calls it instead of N separate actions.

### 2026-07-25 — Faster "Sync statuses" + "Refresh & resend" (v1.1.12)
- **Parallelized the serial hot loops** in the two owner order actions (were the main wait):
  - `orders/sync.ts` `syncPanelOrders` — the 3 pre-passes (expire/failed/dupe reconcile) now run via `Promise.all`,
    and `refreshPanelStorefrontSnapshots` materializes customer snapshots in **bounded-parallel batches of 10**
    (was a sequential per-customer loop — the big drag on panels with many customers). Per-provider status sync
    was already parallel; provider selection/commission stay sequential (balance accounting order matters).
  - `admin-orders.ts` `refreshProviderBalancesAndRetryHeldOrders` — provider **balance refresh** now runs in
    parallel (independent API calls), and the **resends** run in bounded-parallel **batches of 5** (fast without
    hammering one provider's API). The balance-gated retryable SELECTION stays sequential (decrements per-provider
    remaining).
- No behaviour change — same results, less waiting.

### 2026-07-25 — Automator v2 — R3: keyword fan-out engine (v1.1.11)
- **`runCampaign` (`actions/campaigns.ts`) rewritten to the v2 model.** Dropped the owner-preset lookup +
  regular/priority tier. Now: gates on the owner tier (`hasCampaignAutomation`) + an **active customer automator
  subscription** (`automator_subscriptions.active`) + a **configured profile** (`profileIsConfigured`); enforces
  the tier's **platform scope** (`tierPlatforms` — out-of-scope link → skipped "Not in the panel's plan"); and
  for each link fans out via **`slotsForLink(profile, platform, link)`** — the customer's keyword-matched slots
  (or keyword-less defaults), deduped by service — placing one order per slot via `placeOrder`. Records
  `campaigns`/`campaign_items`. The Instagram-Reel special-case is gone (the customer expresses it via a "reel"
  keyword slot). `runCampaign` signature dropped `tier`. `campaign_service_presets` (0028) is now fully unused.
- **NEXT (R4):** the always-on storefront teaser (contact-support when the owner hasn't subscribed) + the
  customer **$6.99 subscribe button** (calls `subscribeAutomator`) that unlocks the config + run surface.

### 2026-07-25 — Blog: edit the article BODY (v1.1.10)
- **Only the meta (title/desc/slug/tag/keywords) was editable — now the BODY is too.** `actions/blog-admin.ts`
  `updatePostBody(id, { intro, sections, cta })` (super-admin gated) sanitises the block structure (drops empty
  blocks/sections, keeps known kinds) and saves intro + `sections` (jsonb) + `cta`; revalidates the slug.
- `src/components/superadmin/BlogBodyEditor.tsx` (NEW) — edits the lead **intro**, each **section** (H2 + blocks:
  paragraph / sub-heading / bullet / numbered / quote, add/remove per block + per section), and the closing
  **CTA**. Opened by a new **"Edit body"** button on each **draft AND published** post in `BlogReview`
  (alongside the meta "Edit"); saving refreshes the queue and (for published posts) revalidates the live page.
  No migration.

### 2026-07-25 — Blog: bulk topic import (paste or file) (v1.1.9)
- **The AI blog was recycling topics because the queue kept emptying** (falling back to the small built-in
  pool). Added a **bulk topic import** so the super admin can load many topics at once. `actions/blog-admin.ts`
  `addTopicsBulk(items[{topic,keywords[]}])` — super-admin gated, inserts `blog_topics` as pending, skips blanks
  + case-insensitive duplicates (existing + within-batch), returns `{added, skipped}`.
- `BlogReview.tsx` Topic-queue card gained an **"Import many topics"** block: a textarea (one topic per line,
  optional `| keywords`) + **Upload file** (.csv/.xlsx → col A topic, col B keywords; .docx/.txt → one per line).
  Files parsed client-side via dynamic `import("xlsx")` / `import("mammoth")` (both already deps). Refreshes the
  queue + cache on success. No migration.

### 2026-07-25 — Refresh & resend: resend even when the order lost its provider mapping (v1.1.8)
- Follow-up to 1.1.7 (which still didn't reorder). `submitPendingOrderToProvider` hard-required
  `order.provider_id`; stuck-pending orders whose service wasn't mapped at placement (provider_id null) were
  never sendable. Now it **resolves the provider from the service's CURRENT mapping** (`services.provider_id` +
  `provider_service_id`) when the order's is missing, sets `provider_id` on the order when it sends, and the
  candidate filter dropped the `provider_id` requirement (any pending order with a service and no
  `provider_order_id` is a candidate). Still skips orders that already have a `provider_order_id` (no double-send).

### 2026-07-25 — Refresh & resend now catches stuck-pending orders too (v1.1.7)
- **"Refresh & resend" only retried orders explicitly flagged held-for-provider-balance** — pending orders that
  simply never got forwarded to the provider (stuck on OUR end) were ignored. `refreshProviderBalancesAndRetry
  HeldOrders` (`admin-orders.ts`) now treats ANY pending order with a `provider_id` but no `provider_order_id`
  as a candidate (never sent = safe to resend; a set `provider_order_id` means it's genuinely pending at the
  provider → skipped). Balance-held orders still gate on the refreshed provider balance; other stuck orders
  resend directly. `submitPendingOrderToProvider` already guards on `provider_order_id`, so there's no
  double-send risk.

### 2026-07-25 — Automator v2 — R2: customer keyword-slot config (v1.1.6)
- **The config now belongs to the CUSTOMER** (keyword slots), not the owner. `src/lib/automation/profile.ts`
  (NEW, pure) — `AutomationProfile` = `platforms: { [platform]: AutomationSlot[] }`, each slot = `{serviceId,
  quantity, keywords[]}`; `slotsForLink(profile, platform, link)` fires keyword-matched slots (substring
  `matchesAnyKeyword`) or the keyword-less defaults, deduped by service. Read/normalize helpers.
- **Migration `0030_automation_profiles.sql`** (NEW) — `automation_profiles` (panel_id, customer_id, config
  jsonb; RLS = panel members / super admin / owning customer). Supersedes 0028's `campaign_service_presets`.
  **Run migration 0030** (and 0029 if not yet).
- `actions/automation-profile.ts` (NEW) — `getAutomationProfile` (offered, tier `allowedPlatforms`, profile,
  customer-orderable `servicesByPlatform` filtered to the owner tier's platforms) + `saveAutomationProfile`
  (normalized to allowed platforms + valid service ids). Storefront-auth'd.
- `src/components/customer/AutomationConfig.tsx` (NEW) — per-platform slot editor (service select + qty +
  comma-keywords, add/remove), **hidden by default**, opened by a **Configure** button in `CampaignSurface`
  (which dropped the old regular/priority toggle), collapses on Save.
- **NEXT (R3):** rewrite `runCampaign` to fan out via the customer's profile (`slotsForLink`) + enforce the tier
  platform scope, dropping the owner-preset lookup. Then R4 (storefront teaser + customer $6.99 subscribe button).

### 2026-07-25 — Automator v2 — R1b-ii: owner tier subscribe UI (v1.1.5)
- **The "Campaign Automation" PanelAdmin tab is now the real owner subscribe UI** (was a "coming soon"
  placeholder). `AutomationTab({ panelId })` in `AdminTabs.tsx`: loads `getPlan`, shows current plan
  (renews/paused) + this panel's Innvil balance, and three tier cards — **Pro $9.99 / Business $19.99 /
  Business+ $49.99** — each with its platform scope + features. Subscribe/Switch → a **confirm step that warns**
  "you pay $X/mo; make sure you have ~N+ customers who'll subscribe at $6.99 first" (break-even = ceil(price/6.99)
  → Pro 2, Business 3, Business+ 8), then calls `setPlan`. Cancel supported. Charges from the panel's Innvil balance.
- **R1 complete** (model + customer sub backend + owner subscribe UI). **NEXT (R2):** replace the owner-preset /
  regular-priority campaign config with the CUSTOMER keyword-slot automation profile (hidden-by-default, opened by
  a "Configure" button), then R3 (keyword fan-out) + R4 (storefront teaser + customer subscribe button).

### 2026-07-25 — Automator v2 — R1b: customer $6.99 subscription (backend) (v1.1.4)
- **The hard-coded $6.99/mo customer Automator subscription** (100% owner revenue). Migration
  **`0029_automator_subscriptions.sql`** (NEW) — `automator_subscriptions` (panel_id, customer_id, active,
  since, last/next_charge_at, lapsed; RLS = panel members / super admin / owning customer). **Run migration 0029.**
- `actions/automator-sub.ts` (NEW) — `getAutomatorSub` (offered = owner has a tier / active / lapsed / price /
  wallet balance), `subscribeAutomator` (gated on the owner tier; charges $6.99 from the customer wallet as an
  **`order`-type** balance change — no provider payout, so it's 100% owner revenue — sets active +30d),
  `cancelAutomator`. Storefront-auth'd.
- `billing/automator.ts` (NEW) `billDueAutomatorSubs` — monthly renewal sweep (charge due active subs; lapse any
  the customer can't cover), wired into the **bill-addons** cron alongside plans + AI add-ons.
- `money.ts` already has `CUSTOMER_AUTOMATOR_PRICE = 6.99` / `AUTOMATOR_PERIOD_DAYS` (R1).
- **NEXT (R1b-ii):** owner tier subscribe UI (Pro/Business/Business+ cards + the "have enough demand first"
  warning) in the Campaign Automation tab. Then R2 (customer keyword config), R3 (keyword fan-out), R4 (storefront
  teaser + the customer subscribe button that calls `subscribeAutomator`).

### 2026-07-25 — Gate Design Tools behind a launch flag (coming soon) (v1.1.3)
- **Design Tools (dashboard layout builder + visual editor) are gated OFF for everyone — even Business/Business+.**
  The editor only reorders today; it needs nav/section placement, hamburger/dropdown layout, component placement,
  etc. before release. New `DESIGN_TOOLS_ENABLED = false` flag in `plans.ts`; `hasDesignTools()` returns false
  while it's off (flip the flag to re-enable the Business/+ entitlement everywhere it's gated). Design Studio now
  shows a **"Design tools · coming soon"** teaser instead of the Dashboard world toggle + Visual editor card.
- Landing + FAQ softened: the visual editor is described as **coming soon** (Design Shop stays live).

### 2026-07-25 — Automator v2 — R1: three-tier plan model + platform scoping (v1.1.2)
- **Re-architecting the Automator to the v2 model** (see memory `innvil-automator-v2`): customer keyword config,
  $6.99 customer sub (100% to owner), owner tier plans incl. **Business+**. This slice = the plan/pricing MODEL
  (pure); actions/UI/keyword-config/teaser come next (R1b→R4). No migration yet.
- `plans.ts` — `PlanTier` now `pro | business | business_plus`. **Tier → campaign platforms:** Pro = X/Instagram/
  TikTok; Business = + Facebook/YouTube/LinkedIn/Threads/Telegram; Business+ = **all** owner services (`null`).
  New helpers `tierPlatforms`, `automatorPlatformAllowed(settings, platform)`, `hasFileUpload` / `hasWatchedAccounts`
  (Business+ only); `hasDesignTools`/`planBundlesSupport` now true for Business AND Business+.
- `money.ts` — `INNVIL_BUSINESS_PLUS_PRICE = 49.99`; `planPrice` handles it; `CUSTOMER_AUTOMATOR_PRICE = 6.99`
  + `AUTOMATOR_PERIOD_DAYS` (the hard-coded customer sub — 100% owner revenue, wired in R1b).
- `actions/plan.ts` — `PlanInfo.businessPlusPrice`; Business+ also disables the separate ai_support sub (bundled)
  + counts as bundling support. Super-admin Panels **Plan** select gained a **Business+** comp option (testing).
- Existing 2b `campaigns.ts`/`CampaignSurface` (owner-preset + regular/priority) still compile but are SUPERSEDED
  — replaced in R2 (customer keyword config) + R3 (keyword fan-out).
- **NEXT (R1b):** customer $6.99 automator subscription (table + charge from wallet → owner earnings + monthly
  billing) + owner tier subscribe UI with the "have enough demand first" warning.

### 2026-07-25 — Campaign Automation — Phase 2b: fan-out engine + storefront surface (v1.1.1)
- **The Automator now runs orders.** `src/lib/actions/campaigns.ts` (NEW) — `runCampaign({panelId, links, tier})`:
  storefront-auth'd, gated on `hasCampaignAutomation`, parses the blob (`analyzeCampaign`), creates a `campaigns`
  row, and for each detected link looks up the owner's enabled `campaign_service_presets` for that platform+tier
  and places **one order per preset** via the existing `placeOrder` (customer wallet, floors/markup/provider all
  reused), deduping by service and applying the Instagram-Reel rule (views only). Records `campaign_items`
  (order_ids, charge, status), caps links by `campaignLinkLimit`, and skips comment presets (pools = 2c).
  `listCampaigns` for history.
- `src/components/customer/CampaignSurface.tsx` (NEW) — storefront Campaign tab: paste-links textarea with a
  **live analysis** (per-platform counts + unrecognized), regular/priority tier, Run, a per-link result list, and
  recent campaigns. Mounted in `CustomerDashboard` as a new **"Campaign"** nav item, shown only when
  `campaignEnabled`. Gate threaded `getPublicPanel.campaignAutomation` → page → Storefront → dashboard.
- **Testing:** comp a panel to Pro/Business (super admin) so the Campaign tab appears; until the 2c preset UI
  exists, insert a `campaign_service_presets` row (panel_id, platform, tier='regular', service_type, service_id,
  quantity, enabled=true) to see fan-out place orders. No new migration (0028 already covers it).
- **NEXT (2c):** owner preset UI (per platform/tier service_type → service + qty) + comment pools; then 2d
  (self-serve subscribe UI that unlocks the campaign surface + design tools) + background processing for big runs.

### 2026-07-25 — Campaign Automation (the Automator) — Phase 2a foundation (v1.1.0)
- **Started the Automator.** Foundation slice only (per user: full-auto "watched accounts" deferred). No UI or
  fan-out yet — that's 2b. Ships the detection engine + schema.
- `src/lib/automation/links.ts` (NEW) — ported from the SMM-automator project + enhanced: `detectPlatform(link)`
  (hostname → instagram/tiktok/youtube/x/facebook/linkedin/telegram/spotify/threads, with a substring fallback),
  `isInstagramReel(link)` (Reel rule = views only), **`parseCampaignLinks(input)`** (extracts every URL even when
  pasted with no separators — newlines/commas/spaces AND concatenated `…/1https://…/2` — deduped), and
  `analyzeCampaign(input)` (per-link preview: platform + counts). Pure module, client+server safe.
- **Migration `0028_campaign_automation.sql`** (NEW) — `campaign_service_presets` (OWNER config: per
  (platform, tier, service_type) → a panel `service_id` + quantity, `enabled`), `campaigns` (CUSTOMER run header:
  panel/customer/tier/status/total_links/total_charge), `campaign_items` (per link: detected platform, status,
  `order_ids` jsonb, charge, error). Enums `campaign_status` / `campaign_item_status`. RLS mirrors support
  tickets (presets = owner/super-admin only; campaigns/items = panel members, super admin, or the owning
  customer). **Run migration 0028.**
- **NEXT (2b):** fan-out — for each detected link, look up the owner's presets for its platform and place one
  order per preset via the existing `placeOrder` (customer wallet, floors/markup respected), writing
  `campaign_items`; then the storefront **Campaign** surface (link blob + csv/xlsx/docx upload). Then 2c (owner
  preset UI + comment pools) and 2d (self-serve subscribe UI that unlocks the campaign surface + design tools).

### 2026-07-25 — Landing: automation-first positioning + full feature coverage (v1.0.2)
- **The marketing landing (`PublicLanding.tsx`) now sells the whole product with an "SMM panel made easy /
  almost fully automated / minimal human touch" angle** (the landing = Innvil's storefront). Changes:
  - **Hero** repositioned: pill "SMM panel making & managing — made easy", mono line "Almost fully automated ·
    minimal human touch · 0% rent, 5% only", headline "Your own SMM panel, built and run for you", copy leads
    with what Innvil automates.
  - **NEW `#automation` section** ("Built to run itself. Minimal human touch.") — a 9-point checklist of what
    runs on its own (catalog import/categorize, markup pricing, order routing, 10-min status sync, auto-refunds,
    crypto auto-credit, commission settlement, held-order auto-resend, provider-spend logging) + "the only things
    that need you" line. New "Automation" nav anchor.
  - **`#platform` grid gained 3 cards** that were missing entirely: **Design Shop + visual editor**, **Free AI
    assistant** (owner), **AI customer support (add-on)**.
  - Fixed the stale `#why` line that listed the Design Shop as "next" — it's live now.
- **SEO pass (same release):** root metadata (`app/layout.tsx`) title → "Innvil — SMM Panel Making & Managing,
  Made Easy"; description + OG/Twitter reworked around automation; keywords add "smm panel made easy",
  "automated smm panel", "smm panel automation", "run/manage an smm panel". Two new FAQ entries in
  `landing-faq.ts` ("How much is automated?" + "Can I customize the storefront?") — they render on-page AND in
  the FAQPage JSON-LD (shared array). `app/JsonLd.tsx` SoftwareApplication description updated to match.
- Content/copy only; no logic change.

### 2026-07-25 — v1.0.0 — public launch 🎉
- **First stable release.** Build passes, deployed to production, and all three pg_cron jobs
  (`innvil-order-sync-every-10-min`, `innvil-generate-blog`, `innvil-bill-addons`) verified active + running.
  Google indexing requested.
- **What's live at 1.0:** end-to-end money loop (deposits → wallet → orders → provider forward → status sync →
  5% commission settlement w/ volume discounts + $100/day cap), white-label storefronts (subdomain + custom
  domains, per-panel metadata/favicon), bring-your-own provider, multi-gateway payments (Cryptomus/NOWPayments/
  Razorpay/Stripe), owner→Innvil top-ups, support tickets both directions, earnings receipts, AI blog autopilot
  (human-approved), customer AI support add-on + free owner assistant, SEO foundation + /blog, and a
  **functional Design Shop** (4 distinct designs — Pulse/Studio/Agency/Orbit — buy/activate/switch, full live
  previews, super-admin pricing + first-purchase promos) + **visual editor Phase 1**.
- **Gated "coming soon" (not blocking 1.0):** self-serve plan subscriptions + Campaign Automation Phase 2 (the
  Automator), visual-editor Phase 2 + dashboard editor, child panels / design resell. Business features are
  comp-only via super admin today.

### 2026-07-24 — Orbit/collage badges use real platform glyphs (v0.2.116)
- The `orbit` and `collage` hero mockups showed the platform's first LETTER in each floating badge. They now
  render the real monochrome brand glyph via the existing `PlatformGlyph` (`src/components/customer/
  PlatformIcons.tsx`, `fill: currentColor` → white on the accent badge; unknown platforms get the neutral
  fallback ring). `DesignRenderer` now imports `PlatformGlyph`.

### 2026-07-24 — Design #4 "Orbit" published — initial four complete (v0.2.115)
- **`src/data/designs/orbit.ts` (NEW) — "Orbit"** ($7, minimal futuristic premium): a combination of the
  backlog directions (GlassOS glass/aurora + Neon-Cyber grid + Floating Social Ecosystem hero). Deep-space
  canvas, electric-lime (#A3E635) + indigo accent, aurora-over-grid `backdrop`, glass cards.
- **New signature layout in the renderer: `mockup: "orbit"`** — platform badges orbiting a central "growth"
  dashboard node with spinning dashed rings (new `dz-spin`/`dz-spin-rev` CSS + `dzSpin` keyframe). `"orbit"`
  added to the schema mockup union.
- `src/data/designs/index.ts`: Orbit → `PUBLISHED_DESIGNS`; **`COMING_SOON_DESIGNS` is now empty** — the
  initial four (Pulse, Studio, Agency, Orbit) are all live, each with a distinct LAYOUT (phone-feed /
  dashboard-card / collage / orbit), not just a palette.
- **NEXT designs** come from the backlog in memory `innvil-design-directions` (GlassOS, Neon Cyber, Bento,
  Finance, Dark Luxury, Isometric, AI Assistant, Brutalist, Aurora, Motion) — each needs its own renderer
  variant/mockup. Then: visual editor Phase 2 + dashboard editor when the Automator launches.

### 2026-07-24 — Renderer now varies by LAYOUT + Design #3 "Agency" (bold/colourful) (v0.2.114)
- **Root fix: designs were only differing by tokens/copy** because `DesignRenderer` drew one fixed layout per
  section type — so a light palette on the same structure read as "Studio in white." The renderer now branches
  on `variant`/`mockup` for real layout differences:
  - **`mockup: "collage"`** (NEW) — a playful card collage hero (accent tile + trophy card + platform-icon card)
    instead of phone-feed / dashboard-card. `"collage"` added to the schema mockup union.
  - **`features` `variant: "color-cards"`** (NEW) — full-colour feature tiles cycling dark → accent-gradient →
    light with big emoji (`item.icon`). Default features variant now also uses `item.icon` when present.
- `src/data/designs/agency.ts` — **"Agency"** rebuilt as a **bold, colourful, playful** composition (warm
  off-white canvas, coral→orange gradient, very rounded shapes, collage hero, colour feature cards, emoji), a
  genuinely different LOOK from dark Pulse/Studio — not a recolour. ($10, id still `agency`.)
- `src/data/designs/index.ts`: Agency is `PUBLISHED`. Only teaser left: **Orbit** (minimal futuristic).
- **NOTE:** future designs should lean on `variant`/`mockup` for layout distinctiveness, not just tokens. Add
  new variants to the shared renderer as needed. **NEXT design:** Orbit.

### 2026-07-24 — Super-admin design pricing + first-purchase promos (v0.2.111)
- **Design prices are now super-admin-settable, with per-design first-purchase promos** (base prices still live
  in each package's `meta.price` as the default). No migration — stored in `platform_settings` under key
  `design_pricing` = `{ [designId]: { price?, promoActive, promoPrice?, promoLabel? } }`.
- `src/lib/design/pricing.ts` (NEW) — `DesignPricingEntry`/`DesignPricingMap` + `effectivePrice(base, entry,
  {firstPurchase})` (override price + promo applied to a buyer's FIRST design on a panel, i.e. `owned.length===0`).
- `actions/platform-settings.ts` — `getDesignPricing()` (public-safe read) + `setDesignPricing(id, entry)`
  (super-admin, sanitised, upsert).
- `buyDesign` now charges the **effective price** (override + first-purchase promo), not `meta.price`.
- **UI `src/components/superadmin/DesignPricingAdmin.tsx` (NEW)** — per-design price + promo toggle/price/label,
  **cached** (session+local, paints instantly then background-syncs, like BlogReview). Mounted in BOTH surfaces:
  the `/superadmin` route (new **Design pricing** tab) and the **owner-app super-admin sidebar** (new
  "Design pricing" section, super-admin only).
- Design Shop reflects it: cover badge / buy button show the overridden price and, for a first-time buyer,
  the promo price + label; the balance gate uses the effective price. The in-studio `DesignLibraryPanel` also
  loads `getDesignPricing()` and shows the effective/promo price on its buy button + balance gate (v0.2.112).
  Also fixed a duplicate `Tag` lucide import in `panels/index.tsx` that broke the build (v0.2.112).

### 2026-07-24 — Design #2 "Studio" published (v0.2.110)
- **Second marketplace design shipped, one-at-a-time as intended.** `src/data/designs/studio.ts` (NEW) —
  **"Studio"** ($12, dark creator-economy): near-black cinematic canvas, cyan/indigo accent, editorial serif
  headlines, a **creator-analytics hero card** (mini growth bar-chart + follower/view/revenue tiles), glowing
  service cards, creator/agency testimonials. A different composition from Pulse, not a recolour.
- **New hero mockup in the shared renderer:** `DesignRenderer` now draws `mockup: "dashboard-card"` (the
  analytics card) alongside `"phone-feed"` — reusable by future designs. `"dashboard-card"` was already a valid
  schema value.
- `src/data/designs/index.ts`: Studio moved from `COMING_SOON_DESIGNS` → `PUBLISHED_DESIGNS` (buyable + full
  live preview). Remaining teasers: **Agency** (clean corporate) and **Orbit** (minimal futuristic).
- **NEXT designs:** Agency → Orbit, one finished at a time. Visual editor Phase 2 + dashboard editor deferred
  until the Automator (subscribe flow) launches.

### 2026-07-24 — Hide Business-gated design tools from non-subscribers (v0.2.109)
- **Design Tools are now HIDDEN, not upsold, for owners without Business.** Since there's no self-serve
  subscribe yet (it ships with the Automator / Campaign Automation Phase 2 — only a super admin can comp a plan
  today), the Design Studio loads `getDashboardDesign().hasDesignTools` and only renders the **Dashboard world
  toggle** and the **Visual editor** card when entitled; a non-entitled user is forced to the Landing world.
  The internal upsells in `DashboardLayoutBuilder`/`VisualEditor` remain as defensive fallbacks but are now
  unreachable for normal owners.

### 2026-07-24 — Visual editor (Phase 1): config-driven landing builder (v0.2.108)
- **First slice of the Shopify/Webflow-style visual editor**, built on the SAME schema + `DesignRenderer` the
  marketplace uses (an owner-built design is just another config the renderer reads). Business-gated
  (`hasDesignTools`). No migration — state in `panels.settings.design.editor` = `{ draft, published }`.
- `src/lib/design/editor.ts` (NEW) — `EditorDesign` (`{ tokens, page }`), `EDITOR_DEFAULT_TOKENS` (neutral dark
  starter palette), `makeSection(kind)` factories + `starterDesign()` (a complete starting landing),
  `readEditorState(settings)`, and **`editorToPackage(design, name)`** → wraps the config as a `DesignPackage`
  so the shared renderer draws it.
- `actions/design.ts` — `getCustomDesign` / `saveCustomDesignDraft` / `publishCustomDesign` /
  `unpublishCustomDesign` / `resetCustomDesign` (owner-auth + Business gate; publish snapshots draft→published,
  audit-logged).
- `src/components/panels/admin/VisualEditor.tsx` (NEW) — full-screen editor: **layers/sections panel**
  (select / reorder / delete), an **approved component library** ("Add" → hero/stats/services/platforms/steps/
  features/testimonials/faq/cta/content/functional), a **per-section settings panel** (edit copy; services
  price toggle), **global colours** (accent/bg tokens), desktop/tablet/mobile **live canvas** via
  `DesignRenderer`, and Save draft / Publish / Unpublish / Reset. Opened from a new "Visual editor" card in the
  Design Studio's Landing world. Non-Business owners see a locked upsell.
- **Live on the storefront:** `getPublicPanel` now returns `customDesign` (the published `EditorDesign`);
  `app/p/[subdomain]/page.tsx` renders it for guests via `editorToPackage` when no marketplace design is active
  (precedence: marketplace design > editor design > default). The signed-in dashboard themes from its tokens too.
- **Phase 1 limits (next):** per-item editing for list sections (steps/features/testimonials/faq), drag-drop,
  undo/redo/revisions, nav/header/footer editing, more per-section settings (variant/animation), and
  responsive per-breakpoint controls. Functional blocks already stay backend-wired via the renderer's slots.

### 2026-07-24 — Blog UI paints from cache (no wait for the super-admin check) (v0.2.107)
- **The Blog nav item, Blog section and bell draft-notices were missing until `amSuperAdmin()` resolved** —
  `isSuper` started `false` with no cache, so blog surfaces popped in late (unlike the rest of the app, which
  paints from `readOwnerAppCache`). Now `isSuper` initialises from `readOwnerAppCache("is-super")` and writes
  back when the check resolves, so blog UI shows immediately on reload and re-verifies in the background.
  `BlogReview` already caches its drafts/topics, so the content fills from cache too.

### 2026-07-24 — Design Studio: Landing / Dashboard "worlds" (v0.2.106)
- **The Design Studio now has two worlds** switched by a top-bar toggle (Landing · Dashboard), instead of
  stacking the dashboard preview under the landing. `world` state in `DesignStudio.tsx`:
  - **Landing** — identity, landing copy, ad sections, colour themes, Design Shop controls + the landing
    preview (active design via `DesignRenderer`, or the default).
  - **Dashboard** — the `DashboardLayoutBuilder` controls + a focused customer-dashboard preview (header +
    `DashboardHomePreview`) whose palette follows the active design (`designToThemeVars`) or the colour theme.
  Each world shows only its own controls + its own preview. No data/logic change — purely the studio's editing UX.

### 2026-07-24 — Fix: schedule bill-addons cron; order-sync job missing too (v0.2.105)
- **`cron.job` showed ONLY `innvil-generate-blog`** — `innvil-bill-addons` and `innvil-order-sync-every-10-min`
  were not scheduled (add-on/plan billing + order-status sync silently never ran). Added
  **`0027_supabase_bill_addons_cron.sql`** (`trigger_bill_addons()` → `/api/cron/bill-addons?secret=…`, daily
  06:00 UTC) mirroring 0015/0026. **Order-sync has `0015` but its job is absent** — re-run 0015's
  `select cron.schedule('innvil-order-sync-every-10-min', …)` (the migration is idempotent) to restore it.
  All three crons share the vault `app_url`/`cron_secret`.

### 2026-07-24 — Fix: blog auto-generation was never scheduled (v0.2.104)
- **Root cause of "no auto blogs":** the daily blog-draft cron existed only as a COMMENT in the route file — no
  migration ever scheduled it (unlike order-sync, which has `0015`). So the endpoint worked when hit manually
  but was never called. Added **`0026_supabase_blog_cron.sql`** mirroring `0015`: `trigger_blog_generation()`
  (vault `app_url` + `cron_secret`, `net.http_get` → `/api/cron/generate-blog?secret=…`, 120s timeout) +
  `cron.schedule('innvil-generate-blog','0 9 * * *', …)`, with an unschedule-if-exists guard. **Run migration
  0026**; needs vault `app_url`/`cron_secret` (same as order-sync) + `ANTHROPIC_API_KEY`.
- The manual "generate now" inserts exactly one draft (`generateDraftNow` → single `insertDraft`); "2 at once"
  was most likely a double-submit/retry of the slow AI request or the cron firing alongside it — not a loop.

### 2026-07-24 — Fix: Design Studio preview ignored the colour theme (v0.2.103)
- **The live storefront already recoloured a bought design from the free theme (v0.2.99), but the Design Studio
  PREVIEW didn't** — it passed `personalization={accent}` only, never `tokenOverrides`, so picking a theme in the
  studio left the preview locked to the design's shipped palette (the "black-pink gradient"). Now the studio
  preview passes `tokenOverrides={themeToDesignTokens(v.theme, v.accent)}`, so changing the colour theme
  recolours the design live in the preview — matching what the storefront renders. Caption updated to say the
  theme recolours the design (layout/type/animation stay the designer's).

### 2026-07-24 — Customer dashboard themed from the active design (v0.2.102)
- **A signed-in customer's dashboard now picks up the active design's palette** (was still the default Innvil
  look even with a design applied). New **`designToThemeVars(tokens, overrides)`** in `theme-bridge.ts` — the
  REVERSE of `themeToDesignTokens`: maps the design's `--d-*` tokens onto the `fp-*` CSS vars the existing
  dashboard uses (surfaces, text, accent + `color-mix` accent tints). `app/p/[subdomain]/page.tsx` wraps the
  signed-in storefront in `designToThemeVars(designPkg.tokens, themeToDesignTokens(theme, accent))` when a design
  is active, else the panel's colour theme. **Colours only — no dashboard layout/markup/order/wallet changes**;
  a free colour theme still recolours the design first (same precedence as the landing).
- Guests already got the design landing; this closes the last "default UI with a design active" gap.

### 2026-07-24 — Themed signup page from the active design (v0.2.101)
- **The signup page now wears the panel's purchased design** — same pattern as login (v0.2.98). `SignUpClient`
  gained an **`embedded`** mode (form only, inputs/buttons styled from `--d-*` design tokens; form markup shared
  between both modes) and host-aware links via `storefrontBaseFromLocation` (no more hardcoded `/p/<sub>`).
  `app/p/[subdomain]/signup/page.tsx` checks `panel.activeDesign`; if the package has a `signup` page it renders
  the design via the shared `DesignRenderer` (catalog-derived stats, panel `hrefs`, `themeToDesignTokens`
  overrides) and **injects the real signup form into the `auth-card` slot** — auth logic stays outside the
  design. No design ⇒ the default page wrapped in `themeVars`.
- **TODO (next):** the customer DASHBOARD still renders the default Innvil UI even with a design active — theme
  it from the active design's tokens (order/wallet logic untouched).

### 2026-07-24 — White-label fix: storefront auth pages leaked Innvil branding (v0.2.100)
- **The real "still points to Innvil" bug was METADATA, not links.** The storefront auth pages had **no
  `generateMetadata`**, so they inherited the root layout's Innvil title + favicon — a customer on
  `…/p/<sub>/login` saw a tab reading *"Innvil — The White-label SMM Panel Builder"*. Only the landing had
  per-panel metadata.
- Added `generateMetadata` (panel name title, panel favicon, `noindex`, OG `siteName` = panel) to
  **login, signup, forgot-password and reset-password**. Auth pages are now fully white-label.
- Also added `storefrontBaseFromLocation(subdomain)` to `src/lib/config.ts` — the CLIENT counterpart of
  `storefrontBase()` — so client components stop hardcoding `/p/<sub>` (still to be applied to
  `SignUpClient`/`ForgotPasswordClient`/`ResetPasswordClient`).

### 2026-07-24 — Free themes recolour bought designs + host-aware storefront links (v0.2.99)
- **FIX (log-in link went to Innvil):** storefront links hardcoded `/p/<sub>/…`. On a PANEL host (subdomain,
  custom domain, `sub.localhost`) the proxy already rewrites `/` to that panel, so the prefix sent the visitor
  back through the proxy onto Innvil. New **`src/lib/storefront-host.ts` `storefrontBase(subdomain)`** (server,
  header-based) returns `/p/<sub>` on the app host and `""` on a panel host; used by the landing + login pages.
  `LoginClient` does the same check client-side for its own links/redirect.
- **Free colour themes now apply to PURCHASED designs** (they were locked to the design's shipped palette).
  New **`src/lib/design/theme-bridge.ts` `themeToDesignTokens(themeId, accent)`** maps the `fp-*` theme vars onto
  the design's `--d-*` colour tokens (and drops the design's decorative backdrop, which is palette-specific).
  `DesignRenderer` gained **`tokenOverrides`**; the landing + login pass the panel's theme/accent. **Colours
  only** — layout, typography, radii, shadows and animation stay the designer's, which is what keeps designs
  distinct.
- **TODO (next):** signup page (mirror the login pattern — Pulse's `signup` page already exists) and the customer
  DASHBOARD picking up the active design's tokens.

### 2026-07-24 — Themed auth pages + "Back to dashboard" fix (v0.2.98)
- **The login page now uses the panel's purchased design.** Pulse gained **`login` + `signup` page schemas**
  (design chrome + hero + a `functional: auth-card` slot). `app/p/[subdomain]/login/page.tsx` checks
  `panel.activeDesign`; if that package has a `login` page it renders the design via the shared
  `DesignRenderer` (real catalog-derived stats, panel `hrefs`) and **injects the real login form into the
  `auth-card` slot** — so authentication logic stays entirely outside the design package. No design ⇒ the
  default themed page (now wrapped in `themeVars` so it respects the panel's colour theme).
- `LoginClient` gained an **`embedded`** mode: form only, inputs/buttons styled from the design tokens
  (`--d-*`), used when injected into a design's auth slot. The form markup is shared between both modes.
- **FIX:** the marketing header's **"Back to dashboard"** did nothing — it was a client `<Link href="/">`, so
  Next's router cache could serve the stale signed-out landing. Now a plain `<a>` (full navigation).
- **TODO (next):** the signup page still renders the default UI — mirror this pattern with `SignUpClient`
  `embedded` + the design's `signup` page (already defined in Pulse).

### 2026-07-24 — Design activation fixes: storefront login route + live design preview (v0.2.97)
- **FIX (404 on login):** a purchased design's "Log in" CTA pointed at `/p/<sub>/login`, which **didn't exist** —
  the default storefront logs in inline on its landing card, so the route was never created. Added
  **`app/p/[subdomain]/login/`** (`page.tsx` + `LoginClient.tsx`), mirroring the existing signup page and using
  `customerSignIn`; links to forgot-password + signup, redirects to `/p/<sub>` on success.
- **FIX (Design Studio preview was hardcoded):** the studio's landing preview always drew the default Innvil
  hero. It now loads the panel's active design (`getDesignLibrary`) and renders the **real design** via the
  shared `DesignRenderer` (inert, demo content, live name/logo/accent) when one is applied; otherwise the default
  preview. `DesignLibraryPanel` gained `onChanged` so buying/activating/deactivating refreshes the preview
  immediately. Caption now states which design is shown.

### 2026-07-24 — Design Shop scope correction + preview placement (v0.2.96)
- **CORRECTION to v0.2.90.** The three "premium templates" (aurora/carbon/luxe) are just CSS-var color
  themes — that is explicitly **NOT** the paid Design Shop. They're now labeled **"More color themes ·
  included"** (free). Do not sell color presets, font presets, dashboard skins, static screenshots, small
  preview cards, summarized previews, or one shared layout recolored as the paid product.
- **The real Design Shop (per the user's full spec — see memory `innvil-design-shop-vision`):**
  1. **Config-driven visual interface editor (Business sub)** — Shopify/Webflow-class, for the panel's
     FRONTEND only: canvas w/ desktop/tablet/mobile, layers panel, approved SMM component library,
     grid/section/column drag-drop (not raw absolute positioning), per-component settings, global design
     tokens, component variants (order form, service list, balance card, stats, tables, header, nav),
     non-functional content sections, page-level editing (dashboard/services/orders/add-funds/tickets/auth),
     nav editing, undo/redo/autosave/revisions/draft/publish/revert/duplicate/import/export, responsive
     controls, **safe constraints** (can't delete/break backend-connected components), and a **renderer**
     that reads the config and renders the SAME existing functionality. Backend/DB/API/orders/payments
     are never touched — functional components stay wired to their current actions.
  2. **Marketplace of complete one-time-purchase landing designs** — each a full design PACKAGE (page/section
     schemas, component variants, tokens, responsive rules, animation defs, original/licensed artwork, fonts,
     default+preview content, version/compatibility metadata), materially different from the others
     (SMM visual language: likes/views/followers/creator profiles/growth charts/feeds). Bought once → the
     owner's design library forever (activate/deactivate/switch/customize permitted settings). Marketplace
     metadata + filters per spec. **Every design needs a FULL live preview** — the real landing rendered with
     demo content via the SAME renderer/config (not a mockup), with responsive/scroll/hover/animation, optional
     pre-purchase personalization (name/logo/color/categories/mode), and export/activation guarded until bought.
  3. **Sanitized "bring your own HTML"** → included in the **Business** subscription (with the editor).
- **Architecture backbone:** the editor and marketplace designs SHARE ONE config-driven renderer (a purchased
  design is just a config the renderer reads). Build order: schema + renderer → editor UI → marketplace +
  full-preview environment. Large multi-phase effort; deliver incrementally.
- Also this release: the **dashboard-layout live preview moved into the Design Studio's preview column,
  directly below the landing preview** (was awkwardly in the side controls). `DashboardHomePreview` is now an
  exported component; `DashboardLayoutBuilder` reports its working layout up via `onLayoutChange`.
- **Design Shop foundation started (vertical slice: build the backbone THROUGH one finished design).**
  - `src/lib/design/schema.ts` (NEW) — the shared config contract for BOTH the marketplace and the future
    visual editor: `DesignTokens` (+ `tokensToCssVars`), typed sections (`hero` w/ engagement floats + phone
    mockup, `stats` w/ `source:"live"`, `services`, `platforms`, `steps`, `features`, `testimonials`, `faq`,
    `cta`, `content`, and **`functional`** — a constrained slot (`auth-card`/`service-list`/`payment-methods`)
    so a design can PLACE real components without owning their logic), per-section `variant`/`animation`/
    `responsive`/token overrides, `DesignPage` (header/sections/footer), `DesignMeta` (price, categories,
    includedPages, features, version, changelog, publisher, status, cover), `DesignPackage` (+ demo `preview`
    content), and preview-only `PreviewPersonalization`/`personalizeTokens`.
  - `src/data/designs/pulse.ts` (NEW) — **design #1 "Pulse"** ($29, social-growth/animated): gradient backdrop,
    floating like/view/follower/notify cards, phone-feed hero mockup, count-up stats, glow service cards,
    testimonials, FAQ, glass auth slot. A complete landing composition, not a palette.
  - `src/data/designs/index.ts` (NEW) — catalog: `PUBLISHED_DESIGNS` (Pulse) + `COMING_SOON_DESIGNS` teasers
    (**Studio** dark creator-economy, **Agency** clean corporate, **Orbit** minimal futuristic — each a
    genuinely different composition). **Ship one design at a time**: a design only becomes `published`
    (buyable + fully previewable) when finished; others are metadata-only "Available soon" cards.
  - **`src/components/design/DesignRenderer.tsx` (NEW)** — the ONE shared renderer used by both the live
    previews and (post-purchase) the real storefront landing, so a preview is never an approximation. Renders
    every section type + header/footer from config, tokens as CSS vars (`--d-*`), CSS-only animations
    (fade-up/float), `<details>` FAQ. **Functional sections render injected `slots`** (`auth-card` /
    `service-list` / `payment-methods`): the caller passes Innvil's real backend-wired components, so this file
    never touches auth/order/payment logic; with no slot it draws a demo visual (used by previews).
    `inert` mode disables navigation for previews.
  - **`/design-shop`** (`app/design-shop/page.tsx` + `src/components/design/DesignShop.tsx`) — marketplace:
    cover, price, tagline, categories, page count, version, responsive/animated flags, features, category
    filters. Published → **Live preview**; teasers → "In the studio / Available soon". Buy buttons are
    intentionally disabled until the purchase+library layer lands.
  - **`/design-preview/[id]`** (`app/design-preview/[id]/page.tsx` + `DesignPreviewShell.tsx`) — the FULL live
    preview: real render via the shared renderer with the package's demo content, working desktop/tablet/mobile
    widths, and temporary **personalization** (panel name / logo / accent) that never installs or unlocks
    anything. `noindex`; teaser ids get an "in the studio" notice.
  - **PRICING:** max **$12** one-time per design, with a real ladder — Pulse $12, Studio $12, Agency $10,
    Orbit $7.
  - **PURCHASE LOOP CLOSED (same release).** `src/lib/design/library.ts` (NEW) reads
    `panels.settings.addons.design` → `{ owned[], active }` (an `active` design must still be owned — guards
    tampering). `actions/design.ts` gained `getDesignLibrary` / **`buyDesign`** (one-time charge from the
    panel's Innvil balance, rejects duplicates/unpublished/insufficient funds, audit-logged) / **`activateDesign`**
    (must own it; `null` = back to the default landing). Purchases are PERMANENT — switching or deactivating
    never revokes a design.
  - **Live on the real storefront:** `getPublicPanel` now returns `activeDesign`, and `app/p/[subdomain]/page.tsx`
    renders the purchased design **for guests only** (signed-in customers always get the real dashboard) using
    the SAME `DesignRenderer` with the panel's live catalog, currency and logo. The renderer gained a `hrefs`
    prop (via a small `HrefContext`) so CTAs point at **this panel's** `/p/<sub>/signup|login` — never Innvil's
    owner auth — and the `auth-card` slot is filled with a real signup/login card.
  - Owner UI: `DesignLibraryPanel.tsx` (NEW) in the Design Studio's Design Shop section — buy / activate /
    switch / preview, with the panel's balance shown; "Innvil default landing" is always an option.
  - **NEXT:** designs #2–#4 one finished at a time (Studio → Agency → Orbit), then the visual editor on this
    same schema; later, per-design editable text/permitted settings.

### 2026-07-24 — Design Shop Phase A: dashboard layout builder (v0.2.91)
- **Design Tools = bundled into Business** (not a separate charge). `hasDesignTools(settings)` = Business tier
  (`src/lib/plans.ts`). Premium landing templates stay à-la-carte (Phase B).
- **Customer-dashboard layout builder** — a Business owner rearranges/show-hides the dashboard HOME widgets
  (stats, favorites, recently-ordered, recent-orders) with built-in controls. **No code; order/wallet logic
  untouched.** Config in `panels.settings.dashboard.home`; unset ⇒ default layout unchanged. No migration.
- `src/lib/dashboard-layout.ts` (NEW): `DashboardWidget`, `DEFAULT_DASHBOARD_HOME`, `readDashboardHome`
  (repairs/appends missing widgets), `normalizeDashboardHome`, labels. `src/lib/actions/design.ts` (NEW):
  `getDashboardDesign`/`setDashboardHome`/`resetDashboardHome` (owner-auth + Business gate).
- `CustomerDashboard` home is now config-driven (IIFE renders widgets in the saved order/visibility; default
  path identical to before). Threaded `dashboardLayout` through `getPublicPanel` → page → `Storefront` →
  dashboard. **Render gated on `hasDesignTools`** so a downgrade reverts customers to default.
- UI `src/components/panels/admin/DashboardLayoutBuilder.tsx` (show/hide + up/down reorder + reset + a **live
  mini-preview** of the customer dashboard home that updates as you edit), mounted as a new **"Dashboard layout"**
  section in the Design Studio (upsell card when not on Business). NOTE: this targets the panel's CUSTOMER
  dashboard (top-nav + mobile hamburger — no sidebar), never the Innvil owner app. NEXT iteration: owner custom
  content blocks on the dashboard + nav-style options (top-tabs vs always-hamburger).
- **Plans aren't sold to owners yet** (Campaign Automation feature is Phase 2) — owner surfaces say "coming
  soon." A **super admin can COMP a plan** per panel to test the Business-gated features: `setPanelPlan(tier)`
  in `superadmin.ts` (no charge, `nextChargeAt=null` so the cron skips it, audit-logged) + a **Plan** select
  (Free/Pro/Business) in the `/superadmin` Panels table (`SuperAdminPanelVM.planTier`).
- **Phase B next (dep installed):** premium landing templates (buy once, own forever) + sanitized custom-HTML
  landing editor (`sanitize-html`), gated by Design Tools / one-time purchase.

### 2026-07-24 — Design Shop: premium templates (v0.2.90)
- **First slice of the Design Shop.** Added a `premium` + `note` flag to `ThemeDef` and three real premium
  templates in `src/data/themes.ts` — **Aurora** (gradient glass, teal→violet), **Carbon Pro** (ultra-dark,
  cyan), **Luxe** (editorial ivory + gold, a light theme). They apply like any theme (CSS-var overrides on the
  storefront root, so they restyle landing + customer dashboard). No dep, no migration.
- `DesignStudio.tsx`: split themes into `FREE_THEMES` / `PREMIUM_THEMES`; the old locked "coming soon" premium
  placeholders are now the real premium templates (click to apply). (Icon `Lock`→`Gem`.)
- **Next (needs `npm install sanitize-html @types/sanitize-html`):** sanitized custom-HTML landing sections —
  owners paste HTML, server-sanitizes (allowlist tags/attrs, strip all JS/handlers) before rendering on the
  storefront. Chosen approach = sanitized inline blocks (safe on a customer-facing page). Then: richer section
  builder (reorder, more block types) + Design-Shop pricing/gating.

### 2026-07-24 — Campaign Automation: subscription foundation (Phase 1) (v0.2.89)
- **First half of "Campaign Automation"** (renamed from "Automator") — the paid, monthly subscription that
  will unlock a customer-facing bulk "Campaign" ordering surface on the storefront. Per-panel, owner-subscribed,
  billed from the panel's Innvil balance (reuses the AI add-on charge/settle pattern). **No migration** (state in
  `panels.settings.addons.plan`). **Backend only this phase — no live subscribe UI yet** (won't sell it until the
  Phase 2 feature exists so owners aren't charged for nothing).
- Plans: **Innvil Pro $9.99/mo** (Campaign Automation, ≤250 links, saved profiles, background processing) and
  **Innvil Business $19.99/mo** (unlimited links, file import, **bundles the AI Support add-on**, priority).
  Prices in `money.ts` (`INNVIL_PRO_PRICE`/`INNVIL_BUSINESS_PRICE`/`PLAN_PERIOD_DAYS`/`planPrice`).
- `src/lib/plans.ts` (NEW): `readPlan`/`planTier`/`hasCampaignAutomation`/`hasFileImport`/`campaignLinkLimit`/
  `planBundlesSupport`. `src/lib/ai/addon.ts` `customerSupportActive` now also true on Business (the bundle).
- `src/lib/actions/plan.ts` (NEW): `getPlan`/`setPlan(tier|null)` — subscribe/switch charges the tier price from
  Innvil balance now (rejects if short), sets `nextChargeAt` +30d, audit-logged; Business subscribe disables any
  separate `ai_support` sub to avoid double-billing; cancel flips it off. `src/lib/billing/plans.ts` `billDuePlans`
  swept by the `bill-addons` cron (now runs support + plan sweeps). Lapse (low balance) → tier=null + lapsed=true.
- Renamed the PanelAdmin "Automation" tab → **"Campaign Automation"** (its subscribe UI + the feature land in Phase 2).
- **Phase 2 next:** migration (`campaigns`, `automation_profiles`), smart link detection, platform auto-detect,
  fan-out ordering via `placeOrder` (customer wallet), the storefront campaign surface, and the owner subscribe UI.

### 2026-07-24 — Streaming AI replies + floating owner assistant (v0.2.88)
- **Streaming built but currently OFF (proxy doesn't support SSE).** `aiStream()` in `src/lib/ai/client.ts`
  (SSE→plain-text) + routes `app/api/ai/{assistant,support}` (reuse `prepareOwnerAssistant`/`prepareGlobalAssistant`
  /`prepareCustomerSupport`) exist, BUT the aiprimetech proxy in use doesn't stream, so the widgets were reverted
  to the reliable **non-streaming server actions** (`customerSupportReply`, `ownerAssistantReply`,
  `globalAssistantReply`). The streaming routes/`aiStream` are retained, unused, ready to re-enable behind a
  streaming-capable provider (Anthropic direct / OpenRouter). Also kept: 60s fetch timeout (`postJson`),
  `try/finally` composer reset, trimmed caps (owner 600 / support 500 tokens).
- **Floating owner assistant (global)** — the free owner assistant is a **floating chat** (bottom-right,
  `Bot` launcher) mounted at the **owner-app shell level** (`InnvilApp` in `panels/index.tsx`), so it's on
  **every** section of the owner dashboard, not just inside a panel. It's **account-level**: `prepareGlobalAssistant`
  grounds it in Innvil how-to (`OWNER_KB`) + a summary of ALL the owner's panels (status/balance/commission).
  The route `/api/ai/assistant` takes an OPTIONAL `panelId` (present → panel-scoped `prepareOwnerAssistant`;
  absent → global). `OwnerAssistantChat.tsx` always renders (no config gate). The **AI Assistant tab**
  (`OwnerAssistant.tsx`) is just the **Customer AI Support add-on** toggle/card + a note pointing at the floating button.
- No migration.

### 2026-07-24 — AI monetization corrected: owner assistant FREE, customer support PAID (v0.2.87)
- **Fixes the model (v0.2.85–86 had it backwards).** Two independent AI features:
  - **Owner → Innvil assistant** (owners asking how to run their panel / reach Innvil): **FREE, always on,
    Innvil-funded.** `ownerAssistantReply` now gates only on ownership + `aiConfigured` (no subscription).
  - **Storefront customer AI support** (AI chat for the panel's CUSTOMERS): **PAID $2.99/mo add-on** the OWNER
    enables + pays (from the panel's Innvil balance). The billing/subscription machinery moved here.
- `src/lib/ai/addon.ts` rewritten: `readSupportSub` + `customerSupportActive(settings)` = the paid `ai_support`
  subscription is active (OFF by default now; on when the owner subscribes or a super admin comps it). Removed
  the old always-on default + the `ai_assistant` state helpers.
- `src/lib/actions/ai-assistant.ts`: `ownerAssistantReply` (free) + **`getSupportAddon`/`setSupportAddon`**
  (enable charges `AI_ADDON_PRICE` from the panel's Innvil balance, sets `addons.ai_support` sub, audit-logged;
  disable flips it off). `money.ts` `AI_ASSISTANT_PRICE`→**`AI_ADDON_PRICE`** (2.99). Billing sweep
  `billDueSupportAddons` (`src/lib/billing/assistant.ts`) now bills `ai_support`; cron `bill-addons` unchanged.
- UI `OwnerAssistant.tsx` (AI Assistant tab): free owner chat on top + a **Customer AI Support** add-on card
  (subscribe/cancel, balance check, "panel stays 0% rent"). Storefront chat (`SupportChat`) now shows only when
  the owner's paid add-on is active (`aiSupport` = `customerSupportActive`). Super-admin Panels toggle = a
  comp/override (caption "owner add-on · comp"). No migration.

### 2026-07-24 — Customer AI support is now always-on & Innvil-funded (v0.2.86)
- **Reversal of the v0.2.84 paid-gate:** the customer-facing AI support chat (storefront "contact support")
  is now **ON for every panel by default**, on Innvil's cost — a platform feature, not a per-panel paid add-on.
  It is independent of the owner AI Assistant ($2.99 add-on); enabling the owner assistant does NOT toggle the
  storefront chat and vice-versa.
- New `customerSupportActive(settings)` (`src/lib/ai/addon.ts`): ON unless a super admin explicitly disables it
  (`addons.ai_support.enabled === false`) — an emergency off-switch (e.g. abuse), not a purchase gate. Wired
  into `getPublicPanel` (storefront mounts the widget for all panels), `customerSupportReply` (gate), and the
  super-admin Panels toggle (now labeled "on by default"; `setPanelAiAddon(false)` = disable). No migration.
- **Cost note / TODO:** always-on + free means Innvil eats the API usage; recommend adding a per-customer daily
  message cap to bound cost (needs a small counter/table — not built yet).

### 2026-07-24 — Owner AI Assistant add-on (paid, $2.99/mo per panel) (v0.2.85)
- **Second AI surface: the owner-facing assistant.** A paid, opt-in, per-panel add-on that helps the OWNER
  run this panel (connect a provider, import/price services, go live, payments, commission, statuses…),
  grounded in Innvil how-to knowledge (`OWNER_KB`) + the panel's live stats (status, Innvil balance,
  commission rate, providers/services/orders/customers counts). The panel itself stays 0% rent — this is
  strictly opt-in.
- **Billing: $2.99/mo from the panel's Innvil balance** (`AI_ASSISTANT_PRICE` in `money.ts`). Enabling charges
  the first month immediately and sets next-charge +30d; a daily cron re-charges due subscriptions and
  **pauses** the add-on (enabled=false, lapsed=true) when a panel can't cover it. State lives in
  `panels.settings.addons.ai_assistant` (`readAiAssistant` in `src/lib/ai/addon.ts`) — **no migration**.
- Files: `src/lib/actions/ai-assistant.ts` (`getPanelAssistant`/`setPanelAssistant` [owner-auth + ownership,
  charge/refund-free disable, audit-logged]/`ownerAssistantReply` [gated + grounded]); billing sweep
  `src/lib/billing/assistant.ts` (`billDueAssistants`); cron `app/api/cron/bill-addons` (CRON_SECRET-gated,
  **schedule via Supabase pg_cron**, daily). UI: `src/components/panels/admin/OwnerAssistant.tsx` (offer card
  when off → Enable; inline chat + "renews …"/Cancel when on), mounted as a new **"AI Assistant"** tab in
  `PanelAdmin`. Uses the same shared AI client, so a third-party Claude key works too.
- **Schedule the pg_cron `innvil-bill-addons` job** (SQL in the route file); set the AI key. No migration.

### 2026-07-24 — AI chat support (customer) + AI integration + blog review in owner app (v0.2.84)
- **Shared AI client** `src/lib/ai/client.ts` (server-only): one Anthropic entry point (`aiComplete`,
  `aiConfigured`, `DEFAULT_AI_MODEL`) used by every AI feature. **`ANTHROPIC_API_KEY`** required; optional
  `AI_MODEL` global default. The blog writer was refactored onto it (single integration to maintain).
- **Customer-facing AI support chat (paid add-on).** Gated by `panels.settings.addons.ai_support.enabled`
  (`src/lib/ai/addon.ts`). `src/lib/actions/ai-support.ts` `customerSupportReply` answers grounded in a
  built-in how-it-works FAQ (`SUPPORT_FAQ`, zero owner config) + THIS panel's catalog + the signed-in
  customer's own balance/recent orders + deposit methods + any custom landing blocks the owner wrote
  (`settings.branding.sections`), with a HARD privacy rule (never given/never reveals provider identity,
  provider cost, floors, markup, or commission).
  `escalateSupportToTicket` opens a real ticket (reuses `createTicket`). UI = floating `SupportChat.tsx`
  mounted in `CustomerDashboard` when the add-on is on; `aiSupport` threaded PublicPanel → page → Storefront →
  dashboard. **Super admin enables it per panel** in `/superadmin → Panels` (new AI-support toggle;
  `setPanelAiAddon`, audit-logged).
- **Super admin = a panel-owner account role-flagged `super_admin` in Supabase — same owner app.** So blog
  review now lives in the **owner-app sidebar** (super-admin-only "Blog" item → `BlogReview`), not only at
  `/superadmin`. The blog review UI was extracted to `src/components/superadmin/BlogReview.tsx` (shared by
  both). New-draft **notifications go to the in-app bell** (`listBlogDraftNotices` → badge + list in
  `AppTopbar`, tap → Blog section). AI (cron) drafts also best-effort email super admins (bonus).
- **Still pending:** the OWNER-facing AI assistant (second surface) — see CLAUDE_PROGRESS. No migration
  (uses `panels.settings`). Set `ANTHROPIC_API_KEY`.

### 2026-07-23 — AI blog autopilot: draft → human-approve → publish (v0.2.83)
- **AI writes blog drafts on a daily schedule; a super admin reviews and publishes.** Deliberately
  gated (not auto-publish) — daily unreviewed AI content risks Google's "scaled content abuse" penalty,
  which could demote the whole domain. Nothing goes live without a human clicking Publish.
- **Migration `0025_blog_ai.sql`** — `blog_posts` (DB-backed posts: slug/title/description/tag/keywords/
  intro/sections jsonb/cta/related/status draft|published|archived/source ai|manual/topic/published_at) +
  `blog_topics` (curated topic queue) + RLS (public reads published; super admin manages).
- **Writer** `src/lib/ai/blog-writer.ts` (server-only): prompts Claude (**`ANTHROPIC_API_KEY`**, optional
  `BLOG_AI_MODEL`, default `claude-sonnet-5`) for a strict-JSON article matching the block model, hard-
  validates it, and is constrained to VERIFIED product facts (no invented features/stats). Always a draft.
- **Read layer** `src/lib/blog/data.ts` merges the 3 static cornerstone guides (`src/data/blog-posts.ts`,
  still code) with published DB rows (static wins on slug); resilient (empty/unreachable DB → static only).
  Blog index/[slug]/sitemap now read this + use ISR (`revalidate = 3600`) so approved posts appear without a
  redeploy. Renderer extracted to `src/components/blog/ArticleBody.tsx` (shared by the article page + admin
  preview).
- **Generation** `src/lib/blog/generate.ts` (queue → fallback topic pool → generate → insert draft; marks
  topic used). **Cron** `app/api/cron/generate-blog` (CRON_SECRET-gated) — **schedule via Supabase pg_cron**,
  daily, e.g. `select cron.schedule('innvil-generate-blog','0 9 * * *', $$ ... net.http_post(url, Bearer CRON_SECRET) $$)`.
- **Super admin → new "Blog" tab** (`SuperAdminDashboard.tsx` `BlogTab` + `src/lib/actions/blog-admin.ts`):
  generate-now (optional topic), drafts-to-review with full preview + light edit (title/desc/slug/tag/keywords)
  + Publish/Delete, published list (Unpublish/Delete), and the topic queue (add/delete). **Run migration `0025`;
  set `ANTHROPIC_API_KEY`; schedule the pg_cron job.**

### 2026-07-23 — Blog / guides content surface for SEO (v0.2.82)
- **New `/blog` content surface** so the SEO foundation has indexable long-tail articles to rank.
  All SSR, no new deps, no migration. `src/data/blog-posts.ts` is the single source of truth (typed
  block model → clean semantic HTML; helpers `allPosts`/`getPost`/`relatedPosts`) and ships 3 cornerstone
  guides: **how-to-start-an-smm-panel**, **white-label-smm-panel-vs-smm-panel-script**,
  **how-much-does-an-smm-panel-cost** (genuinely useful, cross-linked, CTA to /signup).
- `app/blog/page.tsx` = index (own canonical/OG metadata, Blog + ItemList JSON-LD). `app/blog/[slug]/page.tsx`
  = article (`generateStaticParams` prebuilds all 3, per-post `generateMetadata` with canonical + OG
  `article`, BlogPosting JSON-LD, `**bold**` inline renderer, related-post links, `notFound()` for unknown
  slugs). New server-safe `src/components/marketing/SiteChrome.tsx` (`MarketingHeader`/`MarketingFooter`)
  gives the blog the landing chrome; a **"Guides" → /blog** link was added to both it and the landing TopNav.
  `app/sitemap.ts` now lists /blog + every post. `robots.ts` already allows /blog.

### 2026-07-23 — SEO keyword copy pass on the landing (v0.2.81)
- Copy-only pass so the SSR/metadata foundation (v0.2.75–0.2.80) has keyword-aligned content to rank.
  In `PublicLanding.tsx`: hero intro now names "the no-code **SMM panel builder** — a modern alternative
  to buying an **SMM panel script**"; #how H2 → **"How to start your own SMM panel."**; #platform →
  "SMM panel features" / "Everything to run your SMM panel"; #why → "…rented **SMM panel**"; #pricing
  eyebrow → "SMM panel pricing"; #faq H2 → "SMM panel questions, answered." No structure/logic change.
- `app/layout.tsx`: added high-intent keywords (how to start an smm panel, start your own smm panel,
  smm panel builder, smm panel script alternative). Title/description + FAQ were already tuned. No migration.

### 2026-07-23 — Extract PublicLanding into its own module (SSR/perf) (v0.2.80)
- **The server-rendered marketing landing no longer ships the whole owner-app bundle.** `PublicLanding`
  (+ its private `TopNav`) moved OUT of the big `"use client"` barrel `src/components/panels/index.tsx`
  and INTO a standalone module **`src/components/panels/PublicLanding.tsx`**. `app/page.tsx` (server
  component, the crawlable homepage) previously imported it from the barrel — which also exports
  `InnvilApp`/`AuthScreen`/`SuperAdmin` — pulling the entire owner app into the landing's module graph.
- Importers repointed to `@/src/components/panels/PublicLanding` (`app/page.tsx`, `app/PreviewSwitcher.tsx`);
  `app/HomeClient.tsx` unchanged (already `dynamic(..., {ssr:false})` for `InnvilApp`). Trimmed the
  now-unused landing imports from `index.tsx`. Landing markup/copy identical; better Core Web Vitals on
  the primary SEO page. No migration.

### 2026-07-20 — Auto provider top-up tracker + drop "Providers (all panels)" (v0.2.78)
- **Auto-detected top-ups (internal, not manual, not a new API call).** `fetchProviderBalance`
  (`providers.ts`) reads the prior stored balance before updating; if the live balance is HIGHER (same
  currency, not the first observation) it records the increase as a provider top-up in `provider_topups`
  (migration `0023`). Pre-Innvil balances are the baseline (never counted) — a growth/lock-in record.
- **Refund-aware (migration `0024`, Option A + review).** Provider-side refunds also raise the balance,
  so the sync now queues each order's estimated provider refund in `providers.pending_refund_credit`
  (`bump_provider_refund_credit`, in the terminal-refund block using `provider_cost × fraction`). The
  next balance increase **nets that out first** — only the leftover is logged as a top-up. If the
  increase overlapped a refund it's marked `needs_review`, and the tracker shows an inline **"Is this a
  refund?"** prompt; tagging it refund (`provider_topups.kind='refund'` via `setProviderTopupKind`)
  **excludes it from the totals and the CSV**. Every entry can also be re-tagged/deleted. (Replaced the
  earlier "$5 burst" idea — that broke bonused top-ups.)
- **Provider balances page → adds a "Top-up tracker"** (`OwnerProviderBalances` in `OwnerSections.tsx`):
  period toggle **Weekly / Bi-weekly / Monthly** (weekly default), per-period totals grouped by currency
  + per-provider breakdown, a **CSV download** (internal cost record, not an official receipt), and a
  "Recorded top-ups" list with per-entry delete. Actions in `src/lib/actions/provider-topups.ts`
  (`listProviderTopups`/`deleteProviderTopup`; auto-insert lives in `fetchProviderBalance`).
- **Removed "Providers (all panels)"** from the owner sidebar (per user — the balance tracker replaces
  it and is on-theme). `OwnerProviders` component left defined but unused. **Run migration `0023`.**

### 2026-07-20 — Provider balance tracker (sidebar) (v0.2.77)
- New owner sidebar item **"Provider balances"** (`OwnerProviderBalances` in `OwnerSections.tsx`, icon
  `PiggyBank`) — a dedicated, balance-first view of every connected provider so the owner can see how much
  they've funded on the provider side. Summary stat cards (Providers · Needs top-up · Low balance · Healthy),
  a **"Total funded"** card that sums balances **grouped by currency** (providers can bill in different
  currencies), and a per-provider list (balance, Low/Top-up badge, last-synced, per-row + "Refresh all").
  Reuses `listAllOwnerProviders` + `fetchProviderBalance` + the existing `LOW_BALANCE_THRESHOLD` (10) and the
  shared `readOwnerCache("providers")` cache. Complements the existing management table ("Providers (all
  panels)"). No migration.

### 2026-07-20 — Owner dashboard home: real stats (v0.2.76)
- The owner **Dashboard home** was mostly hardcoded ($0.00 stat cards, a mock RevenueChart, "Panels
  created" the only real number). Now data-driven from `getOwnerBillingSummary` + `listAllOwnerOrders(8)`:
  stat cards = **Panels (live/total) · Revenue today · Orders today · Innvil balance**; a **Recent orders**
  card (real, "View all" → Orders section, needs new `goOrders` prop) + a **Today** card (profit today,
  commission charged, orders today, live panels); each "Your panels" tile shows its **real revenue today**
  (from `perPanel`) instead of the always-$0 `ordersToday`. Cached via readOwnerAppCache for instant paint.
  Dropped the mock RevenueChart from the home (still used by the deprecated SuperAdmin mock). No migration.

### 2026-07-20 — SEO foundation: SSR landing + metadata + structured data (v0.2.75)
- **Biggest fix — the marketing landing is now server-rendered (crawlable).** `app/page.tsx` was a
  client-only `ssr:false` shell (empty HTML to crawlers). It's now a **server component**: signed-out
  visitors get `<PublicLanding />` SSR'd; signed-in users + the `?preview=1` switcher render via a new
  client island **`app/HomeClient.tsx`** (dynamic `ssr:false` `InnvilApp`/`PreviewSwitcher`). Auth is at
  real routes (`/login`,`/signup`), so `setWorld` was vestigial on the landing — made optional. Logout
  now `await signOutAction()` **then** `setWorld` (→ `router.refresh()`) so the server re-render sees no session.
- **Metadata** (`app/layout.tsx`): added `metadataBase`, `applicationName`, `robots`, Twitter card, OG
  `siteName`. **Removed the global `canonical`/OG `url`** (they'd leak the Innvil apex onto white-label
  storefronts); homepage sets its own `canonical:"/"` in `app/page.tsx`. **No title template** (same reason).
- **Structured data** (`app/JsonLd.tsx`, server): Organization + WebSite + SoftwareApplication + **FAQPage**,
  the FAQ built from the shared **`src/data/landing-faq.ts`** (single source of truth — PublicLanding renders
  the same array, required for valid FAQ rich results).
- **`app/robots.ts` + `app/sitemap.ts`** (disallow /superadmin,/api,reset/forgot; sitemap = marketing pages;
  storefronts self-manage SEO on their own domains).
- **Storefront metadata** (`app/p/[subdomain]/page.tsx`): white-label OG (panel's own name/description, never
  Innvil), `noindex` for draft/suspended/maintenance.
- Also added the **"Refresh & resend held orders"** feature card to the landing #platform grid (the v0.2.73
  differentiator). **`metadataBase` uses `NEXT_PUBLIC_APP_URL`** — set it to the real prod origin.
- **Top-up bonus tiers on the landing (data-driven):** new public `getPublicTopupTiers()` (platform-payments.ts)
  reads `platform_topup_discount_defaults` (crypto category, else richest) → `app/page.tsx` passes them to
  `PublicLanding` (`topupTiers` prop) → a **"Fund more, get more"** tier grid in #pricing (up to +N% bonus
  credit). Hidden when no tiers are configured, so it always reflects the super-admin's current setup.

### 2026-07-20 — Remove every remaining Sparkles icon (v0.2.74)
- Completed the v0.2.71 default-logo work: **all remaining `Sparkles` icons are now the Ledgerline
  gauge (`Gauge`)**. Fixed the last three inline usages — storefront "Other" platform-tab glyph, the
  main-landing hero Pill icon, and the "Open full Design Studio" button. Zero `Sparkles` left in
  `src/` + `app/`. Inline icons use `Gauge` directly; logo placeholders use `DefaultLogo`. No migration.
- TODO: add the v0.2.73 **"Refresh & Resend"** feature (held provider-balance orders auto-resend after a
  top-up) to the landing-page ad as a differentiator.

### 2026-07-20 — Receipt: business-registration upload + OCR + manual details (v0.2.72)
- The earnings receipt's business header was hardcoded (`BUSINESS_INFO`). Now it's **per-owner,
  editable, and OCR-assisted**. New `owner_business_profiles` table (migration `0022`) + actions
  `getBusinessProfile`/`saveBusinessProfile` (`src/lib/actions/business-profile.ts`).
- `ReceiptCard.tsx`: a collapsible **"Business details"** editor (legal name, address, registrant,
  business/registration no., tax id, email, phone) — fully manual entry. **Upload a registration
  document** (image) → **client-side OCR via `tesseract.js`** (dynamic import) pre-fills the blank
  fields (heuristics in `parseBusinessText`; never clobbers typed values) + shows the raw scanned
  text. The **document is NOT stored** — only the details the owner saves. PDF now renders only the
  fields that are set (skips empties).
- **Run migration `0022_owner_business_profile.sql`** and **`npm install`** (adds `tesseract.js`).
  OCR is best-effort/image-based; manual entry is the reliable path.

### 2026-07-20 — Default logo = Ledgerline gauge (drop the AI-tell sparkle) (v0.2.71)
- The generic `Sparkles`-in-a-square placeholder used for panels/customers without a logo reads as an
  AI-generated default (an easy "made with AI" tell). Replaced it everywhere with a deliberate secondary
  brand asset: **`DefaultLogo`** (`src/components/ui/BrandMark.tsx`) — the original **Ledgerline gauge**
  ("meter") glyph (lucide `Gauge`) in a gold rounded square. This is the canonical global default/
  placeholder logo.
- Swapped in: storefront header (`Storefront.tsx`), customer dashboard + landing, the three storefront
  auth pages (signup/forgot/reset), and both DesignStudio live-preview logos. Left as-is: the "Other"
  platform-category glyph and the Design-Studio button icon (not brand placeholders). Removed now-unused
  `Sparkles` imports. No migration.

### 2026-07-20 — Commission reversal on refund (v0.2.70)
- Refunding a **completed** order (whose 5% was already settled off `innvil_balance`) now **gives the
  commission back**. New `reverse_order_commission(order, fraction)` (migration `0021`) credits the
  proportional commission to `innvil_balance` and reduces `orders.commission_amount` (so "commission
  charged" reflects the net take). No-ops when nothing was settled (order never completed).
- Wired into both refund paths: owner manual `refundOrder` (`admin-orders.ts`, fraction = refund/charge)
  and the sync engine's completed→terminal refund transition (`src/lib/orders/sync.ts`, same fraction).
  Held/failed refunds don't call it (those orders were never completed → no commission).

### 2026-07-20 — Commission volume discounts + $100/day cap (v0.2.69)
- **Marketing hook to pull socpanel renters: "5% isn't forever."** Per-panel commission can be
  discounted down to **1%** as a panel scales, and Innvil never takes more than **$100/panel/day**.
- **Internal brackets** (guideline for support + future AI), by completed orders/day:
  1k → 4% · 2.5k → 3% · 5k → 2% · 10k → 1% (`commissionBracketRate` in `src/lib/money.ts` +
  `INNVIL_MIN_COMMISSION_RATE` 0.01, `INNVIL_COMMISSION_CAP_PER_DAY` 100).
- **Settlement (migration `0020_commission_brackets.sql`):** `settle_order_commission()` now reads the
  panel's `settings.commission_rate` (default 5%) and enforces the **$100/panel/day cap** via new
  `orders.commission_settled_at` (once the day's cap is hit, further completions settle at $0). Same
  signature — sync.ts unchanged.
- **Super admin:** `/superadmin → Panels` gains a **Commission** column — current rate, a set control
  (clamped 1–5%), and each panel's orders-today with the suggested bracket. `setPanelCommissionRate`
  (audit-logged) in `superadmin.ts`; `SuperAdminPanelVM` now carries `commissionRate` + `ordersToday`.
- **Owner Billing** note + **landing** updated: by-the-numbers tile "5% → 1%", a volume-discount
  bracket strip in #pricing, and a new "Does the commission drop as I grow?" FAQ. Owners doing
  1,000+ orders/day are told to contact support for a lower rate.
- NOTE: the Billing "Commission today (est.)" still estimates at a flat 5% (per-panel rate + cap are
  applied at settlement; "Commission charged" is the real figure).

### 2026-07-20 — Owner → Innvil support contact (v0.2.68)
- Panel owners can now **contact Innvil support**. New owner sidebar item **"Contact support"**
  (`OwnerContactSupport` in `OwnerSections.tsx`): a subject+message form plus their own past
  messages with open/resolved status. Distinct from the owner↔customer "Support inbox".
- **Delivery:** `sendOwnerSupportMessage` (`src/lib/actions/platform-support.ts`) stores the
  message in the new `platform_support_messages` table AND best-effort emails support (reply-to =
  owner) via Resend. Destination = `platform_settings.support_email` if set, else the
  **super-admin account email(s)** (resolved via `auth.admin.getUserById`).
- **Super admin:** new **Support** tab in `/superadmin` — sets the support destination email
  (`get/setSupportEmail` in `platform-settings.ts`), lists all owner messages with sender/date,
  "Reply by email" (mailto), and mark resolved / reopen (`setPlatformSupportStatus`).
- **Role split in the owner sidebar** (`navItemsFor(isSuper)`): the super-admin account (Innvil owner)
  sees **"Panel Support"** — `OwnerPanelSupport`, the same owner-message inbox — instead of "Contact
  support" (they ARE support). Every non-super-admin owner keeps **"Contact support"**.
- **Run migration `0019_platform_support.sql`.** Email needs `RESEND_API_KEY` (best-effort; the
  in-app super-admin list always works regardless).

### 2026-07-20 — Live-to-preview: unfunded Live runs as Inactive (v0.2.66)
- Reversed the hard block from v0.2.65: owners can **always click Live** now. With **no Innvil
  balance the server runs it in preview** — `updatePanelStatus` sets the panel `inactive` (browsable,
  no orders) + flags `innvil_suspended`, so a later top-up auto-activates it to fully live. Funding a
  flagged panel while going live clears the flag. It now returns `{ ok, status (effective), note }` so
  the UI reflects the Live→Inactive downgrade; a `live_preview_no_credit` audit reason shows in Status
  History as "Preview — add funds to accept orders".
- `StatusDropdown` `settable` is back to `[draft, live, maintenance]` (Live no longer balance-gated);
  `inactive`/`suspended` stay shown-but-locked with `lockedNote`. My Panels shows the returned note;
  the Status-tab hint reworded to "set Live to preview, runs Inactive until funded".
- **Landing ad:** commission section + the activation FAQ now sell "build and preview your live
  storefront for free — only fund a panel when you're ready to take orders."
- No migration.

### 2026-07-20 — Activation gate: Live needs funds; lock inactive/suspended (v0.2.65)
- **Going Live now requires a funded Innvil balance** ("activating" a panel = funding it).
  `updatePanelStatus` rejects `live` when `innvil_balance <= 0` (was only blocking the
  already-suspended case). `toPanel` now exposes `innvilBalance` on the `Panel` view-model
  (from settings), so the UI can gate too.
- **Owners set only draft / live / maintenance.** `OWNER_SETTABLE` dropped `inactive` (it's
  applied automatically when credit runs out) — `inactive` + `suspended` are now **shown but
  locked** (greyed, Lock icon, unclickable) in `StatusDropdown` via a new `settable` prop
  (replaces the old `options` filter) + `lockedNote`. When unfunded, **Live is also locked**
  with "Add funds to activate…". StatusTab shows an activation hint card when unfunded; both
  My Panels and the Status tab pass `settable` computed from the panel's balance.
- **Landing:** moved the "$10 to activate" detail OUT of the #pricing wheel (now 5% / $0 / ∞
  panels) and INTO a new **FAQ** entry "How do I activate my panel and take it live?".
- No migration.

### 2026-07-20 — Status polish: real Status History (v0.2.64)
- The panel Status tab's **Status History** card was hardcoded mock ("2 hours ago / Yesterday /
  3 days ago"). Now REAL: every status change writes a `panel.status_changed` event to `audit_logs`
  — from `updatePanelStatus` (owner, meta by:owner), the sync auto-inactive (by:system,
  reason:innvil_out_of_credit), the top-up `reactivatePanelIfFunded` + super-admin `adjustPanelBalance`
  (reason:innvil_topup). `getPanelStatusHistory(panelId)` (panels.ts) reads them newest-first + appends
  a synthesized "Panel created" baseline from `panels.created_at` (so it's never empty; infers creation
  status from the oldest log's `from`). `StatusTab` now takes `panelId`, fetches on mount + re-fetches
  ~800ms after a change, and renders real relative times (`relTime`: just now / Xm / Xh / yesterday /
  Xd / date) with the absolute time on hover. Also restricted the tab's StatusDropdown to the four
  owner-settable statuses (matches My Panels). No migration (uses existing `audit_logs`).

### 2026-07-20 — MVP polish: Billing shows real commission charged (v0.2.63)
- Owner **Billing** now reflects the live commission settlement (which shipped v0.2.56 but the UI still
  said "coming soon"). `getOwnerBillingSummary` (`admin-orders.ts`) gained `commissionCharged` (lifetime
  sum of `orders.commission_amount`, total + per-panel; degrades to 0 if 0017 isn't applied). UI
  (`OwnerSections.tsx OwnerBilling`): badge "Auto-billing coming soon" → **"Auto-billing active"**; new
  **"Commission charged"** stat next to "Commission today (est.)"; note rewritten to explain estimate vs
  actually-deducted + the out-of-credit pause; per-panel row shows both today + charged. Roadmap #2 item.

### 2026-07-20 — Main landing pass: commission wheel + trust band + FAQ (v0.2.62)
- Landing page pass (roadmap #1), modeled on socpanel/prm4u/worldofsmm. Added to `PublicLanding`
  (`src/components/panels/index.tsx`): (1) an honest **"by the numbers" band** below the hero
  (5% · $0 rent · ∞ panels · Minutes) — NOT fabricated usage stats, since Innvil is pre-launch;
  (2) rebuilt **#pricing** into "The fairest commission in SMM" with an inline-SVG **commission
  donut** (You keep 95% / Innvil 5% completed-only) + the three real numbers (5% completed-only,
  $10 activate/$5 min, $0 rent/setup) + legend; (3) a **#faq** accordion (8 Q&As: what/how/pricing/
  provider/domain/multi-panel/payments/privacy-boundary) + FAQ nav anchor.
- No new deps (donut is hand-rolled SVG), no migration. FAQ copy is written to double as SEO
  structured-data source for roadmap #3.

### 2026-07-20 — Fix: real platforms no longer dumped into "Other" (v0.2.61)
- Storefront guest-landing showcase (`app/p/[subdomain]/Storefront.tsx`) was bucketing services by a
  stale hardcoded 7-item `PLATFORMS`/`KNOWN` set, so any real platform beyond those 7 (LinkedIn,
  Twitch, Discord, Reddit, Pinterest, …) fell into **"Other"**. Now it buckets by the import's actual
  stored `platform` key — every real platform gets its own named tab; only truly platform-less
  services (import already tags them `other`, e.g. website traffic) go to "Other" (sorted last).
  Proper labels via a `PLATFORM_LABELS` map (owner `platformMeta` label wins, then map, then
  title-case), and hero/tab glyphs use the owner's custom logo (`platformMeta[key].icon`). The
  ordering flow (`NewOrder`) already did this correctly — this only aligns the storefront landing.

### 2026-07-20 — Richer per-panel storefront landing (v0.2.60)
- Expanded the customer-facing storefront guest landing (`app/p/[subdomain]/Storefront.tsx`) toward
  the reference SMM sites (prm4u/worldofsmm/smmcost). Three new default sections, all white-label +
  data-driven: a **live stats strip** (Services / Platforms / Starting-from lowest price / 24-7 — all
  derived from the panel's real catalog, nothing fabricated), a **"How it works"** 4-step flow
  (create account → add funds → pick a service → watch it grow), and a **"Secure payments"** trust row
  that lists only the gateways the owner actually connected (hidden when none). Flow is now
  hero → stats → services → how-it-works → why → FAQ → owner blocks → payments → CTA → footer.
- Content-only; no new deps or migration. Still pending for per-panel (agenda #3 second half):
  more Design-Shop premium templates.

### 2026-07-20 — Landing: surface delete + owner status control (v0.2.59)
- Reviewed the reference sites (prm4u, smmcost, worldofsmm, socpanel) and surfaced two just-built
  capabilities on the public landing: **How it works** step 04 reframed from "Go live" to
  **"You control the status"** (owner sets draft/live/inactive/maintenance anytime; going live is a
  given, so we lead with owner control + reversibility). Added a **"Create & delete freely"** card
  to the #platform grid (spin up test panels, delete unwanted ones cleanly — no clutter/lock-in).
- Content-only; no new deps or migration.

### 2026-07-20 — Owner status control + landing video + panel delete (v0.2.58)
- **Owner-controlled panel status** — the My Panels `StatusDropdown` now offers only the four
  owner-settable statuses (draft/live/inactive/maintenance); `suspended` is Innvil-support-only.
  `updatePanelStatus` enforces it server-side: rejects `suspended`, refuses to change an
  already-suspended panel, and blocks going `live` while the panel is Innvil-credit-suspended
  (top up instead). Inline error surfaced per card. `StatusDropdown` gained an optional
  `options` filter (defaults to all — other usages unchanged).
- **Landing walkthrough video** — super admin sets a tutorial video URL (YouTube/Vimeo/direct
  .mp4) under **/superadmin → Landing video**; the public landing renders it in a "See how
  easy it is" section (`toVideoEmbed` in `src/lib/video.ts`; hidden when unset). Stored in the
  new `platform_settings` table via `getLandingVideo`/`setLandingVideo`
  (`src/lib/actions/platform-settings.ts`). **Run migration `0018_platform_settings.sql`.**
- **Delete panel (with caution)** — each My Panels card has a delete affordance opening a
  confirm modal that requires typing the panel's subdomain; `deletePanel` re-checks ownership
  + the typed subdomain, then deletes (all `panel_id` FKs cascade). Irreversible, spelled out
  in the modal.

### 2026-07-20 — Main landing: feature parity + differentiators (v0.2.57)
- Expanded the Innvil public landing (`PublicLanding` in `src/components/panels/index.tsx`)
  for the public MVP. Two new sections: **#platform** ("Everything to run the business")
  — a 9-card grid of BUILT features (custom domains/reversible, wallets + crypto deposits,
  support tickets, earnings receipts, duplicate detection + mass cancel, provider-balance
  visibility, auto order-status sync, customer API, mobile-first) — and **#why** ("Built
  differently from a rented panel") — the socpanel differentiators: 0% rent/5%, bring-your-
  own-provider, no domain lock-in, customer-privacy boundary, business-OS, ANVIL (coming soon).
- TopNav gains Platform + Why Innvil anchors. Copy only claims shipped features. No new deps,
  no migration. (Couldn't fetch socpanel/smmcost live — classifier outage on WebFetch; built
  from the Phase 4.v.1 differentiators. Refine section order against the live sites later.)
- Still TODO for MVP: richer per-panel storefront landing + Design-Shop premium templates.

### 2026-07-20 — Commission settlement — billing loop closes (v0.2.56)
- **Innvil's 5% commission is now actually DEDUCTED** (was display-only). Per completed
  order, `settle_order_commission()` draws 5% of the charge off the panel's
  `innvil_balance` — atomic + idempotent via new `orders.commission_amount`
  (NULL = unsettled). The sync engine (`settlePanelCommission` in `src/lib/orders/sync.ts`)
  sweeps completed+unsettled orders every pass (cron + owner "Sync statuses"), so it
  catches completions from provider sync AND manual mark-completed.
- **Out-of-credit rule:** when a panel's Innvil balance hits $0 the sync auto-moves a
  `live` panel to `inactive` (browsable, no new orders — `placeOrder` already blocks
  non-live) and flags `settings.innvil_suspended`. A top-up reactivates it: the platform
  webhook (`reactivatePanelIfFunded`) and super-admin `adjustPanelBalance` clear the flag
  and restore `live` (owner's own inactive/suspended choices are never overridden).
- Shared `INNVIL_COMMISSION_RATE` in `src/lib/money.ts`; the Billing estimate now reads
  from it so display and actual deduction can't drift. **Run migration
  `0017_commission_settlement.sql`.**

### 2026-07-19 — Owner→Innvil top-up flow / P3 (v0.2.55)
- Owner **Add Funds** now really pays Innvil via the super-admin's Cryptomus/NOWPayments
  platform gateways and credits the panel's Innvil balance. `createPlatformDeposit`
  (recomputes credit = paid + promo bonus) → gateway checkout → webhook
  `/api/webhooks/platform/[gateway]` → `credit_panel_innvil_balance` (atomic).
  **Run migration `0016_platform_deposits.sql`.** Innvil balance is per-panel; the modal
  has a panel selector. (Commission DEDUCTION shipped in v0.2.56 above.)

### 2026-07-13 — Auto-credit fix + order holds + earnings + global adjust (v0.2.23)
- **NOWPayments finished deposits auto-credit again**: `verifyWebhook` now gates on the
  authoritative server-to-server `getPaymentStatus` (owner API key), HMAC best-effort.
- **Insufficient PROVIDER balance** on an order → held (pending, no refund) with an
  "On hold" indicator in both Orders views; `expireHeldOrders` auto-cancels + refunds
  24h later (inside each sync pass).
- **Earnings & receipts** is its own owner section (top-ups − API cost = profit +
  download); Billing keeps just the commission balance.
- **Customers (all panels)** rows expand → manual Credit/Debit (`adjustCustomerBalance`).

### 2026-07-12 — Custom domains (v0.2.16)
- Owners connect their own domain in the Domain tab: real connect/verify/disconnect,
  live status, and the exact DNS record to add. `proxy.ts` routes any non-app host →
  `/p/<host>`; `getPublicPanel` resolves by subdomain OR `custom_domain`. Vercel
  Domains API wired (`src/lib/vercel/domains.ts` + `actions/custom-domain.ts`) so the
  domain is added to the project + SSL issued automatically. Works without the API too
  (stores domain, shows manual Vercel step). **Env for auto-setup:** `VERCEL_API_TOKEN`,
  `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`.

### 2026-07-12 — Subdomain routing (v0.2.15)
- Panels are now reachable at `<subdomain>.innvil.cloud` (not just `/p/<sub>`).
  `proxy.ts` rewrites a panel-subdomain host → `/p/<sub>` internally and forces the
  storefront session; apex/localhost/preview hosts and `/_next`,`/api`,`/p/`,static
  paths are untouched. `updateSession` gained `{rewriteTo, storefront}`. Root domain
  via `PANEL_ROOT_DOMAIN` (`NEXT_PUBLIC_PANEL_ROOT_DOMAIN`, default innvil.cloud).
  **Deploy:** add wildcard domain `*.innvil.cloud` in Vercel + DNS `*` CNAME. Custom
  domains next.

### 2026-07-12 — Per-service import markup + earnings receipt (v0.2.13)
- **Import per-service markup**: `importServices` accepts `markupOverrides`
  (provider_service_id → {kind,value}); the import UI shows a per-selected-row markup
  input (global type, custom value) with a live sell-price preview. Blank = global.
- **Earnings receipt** (Billing → `ReceiptCard`): single-month range calendar →
  `getOwnerReceipt(from,to)` = completed top-ups − provider/API cost = profit
  (per-panel breakdown) → downloadable self-contained HTML receipt. No migration.

### 2026-07-12 — Customer support tickets (v0.2.10)
- Real, usable support tickets both sides: customers open/reply/close in the storefront
  Tickets tab (`CustomerTickets.tsx`); owners reply/close/reopen in the panel's Support
  tab (`admin/SupportInbox.tsx`). Unread badges via `customer_unread`/`owner_unread`.
- Backend: migration `0009_support_tickets.sql` (`support_tickets` +
  `support_ticket_messages`, RLS) — **run it**; `tickets.ts` (customer) +
  `admin-tickets.ts` (owner) actions.
- Email: best-effort Resend notifier (`src/lib/email/resend.ts`) on each reply —
  no-ops without `RESEND_API_KEY` (set `RESEND_API_KEY`, optional `RESEND_FROM`).

### 2026-07-12 — Super-admin dashboard + platform payments (v0.2.9)
- New role-gated `/superadmin` (server-checked `hasRole('super_admin')`) with a real
  **Platform payments** config: the super admin connects **Cryptomus + NOWPayments**
  (how panel owners pay Innvil). Secrets pgcrypto-encrypted in a new
  `platform_payment_gateways` table — **run migration `0008`**. Binance Pay later.
- Actions: `platform-payments.ts` (get/connect/disconnect, reuse adapter fields) +
  `superadmin.ts` (platform overview counts, `amSuperAdmin`). Owner sidebar shows a
  "Super admin" link only to super admins.
- Make yourself super admin once:
  `update profiles set role='super_admin' where id=(select id from auth.users where email='you@…');`

### 2026-07-12 — Owner dashboard + auth production (v0.2.8)
- Auth split into dedicated worlds/routes: `/login`, `/signup` (username + confirm +
  email verification), `/forgot-password`, `/reset-password`. Landing CTAs link to them.
- Owner **Account settings** (username, email w/ confirmation, password) via
  `account.ts` + `AccountSettings.tsx`; reachable from the sidebar + topbar avatar.
- Fixes: `.ledgerline.app` → `innvil.cloud` (shared `src/lib/config.ts`); My Panels
  **Visit** button works (`/p/<sub>`); create-panel **Connect provider** lands you on
  the Providers tab (`PanelAdmin` `initialTab`); the **bell** is clickable (dropdown).
- Owner shell real data: Orders (all panels) + Customers (all panels) + Billing
  (real revenue + 5% commission estimate; auto-settlement "coming soon"); Support
  (all panels) → coming soon. See `OwnerSections.tsx`.

### 2026-07-12 — Admin dashboard production pass (v0.2.7)
- **Orders tab is now real** (§5): `admin-orders.ts` — `listPanelOrders` (owner-only
  fields incl. provider cost/profit), status-filter chips + search, expandable detail,
  and working per-order actions (resend / refill / cancel / mark completed / refund
  full or partial) + on-demand "Sync statuses".
- **Overview tab is now real**: live stats (revenue today, orders today, pending,
  customers, active services) + recent orders, via `getPanelOverview`.
- **Honest placeholders**: the tabs that showed non-functional controls (Domain custom
  domains, Customer API, Risk & Security, Notifications, Support, Promotions) are now
  clean "Coming soon" states so no fake controls ship to production. Domain still shows
  the real, live included subdomain.
- Note: `middleware.ts` was renamed to `proxy.ts` (Next 16 proxy convention) — edit
  `proxy.ts`, don't re-add `middleware.ts`.

### 2026-07-12 — Owner landing sections + NOWPayments gateway (v0.2.6)
- Owners can add their own promo/ad blocks to the storefront landing (heading, body,
  optional CTA button/link) via the Design Studio, shown below the default landing
  content and stored in `settings.branding.sections`. Sanitized on read and write.
- NOWPayments is now a real, connectable crypto gateway (300+ coins): hosted invoice
  checkout + HMAC-SHA512 IPN verification, reusing the existing adapter/webhook
  pipeline. Owner enters API key + IPN secret and points NOWPayments' IPN callback at
  `<APP_URL>/api/webhooks/nowpayments`.

### 2026-07-12 — Glyph revert (shape restored)
- Reverted the latest transform-based glyph distortion and restored the previous anvil shape in both in-app logo and favicon.
- Kept spacing/layout tuning independent from symbol geometry so future adjustments can target fit without altering identity.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Vertical occupancy correction (actual glyph geometry)
- Corrected the perceived top/bottom emptiness by increasing the anvil glyph's true vertical occupancy inside the badge (not only CSS scaling), so spacing aligns more closely with side breathing room.
- Applied the same geometry update to both in-app mark and favicon for consistent spacing behavior.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Container proportion tweak (vertical spacing balance)
- Kept container size unchanged and increased the mark's vertical fill so top/bottom spacing no longer feels excessive versus side spacing.
- Repositioned the mark slightly to keep visual center and improve badge-to-symbol proportionality across nav/auth/sidebar placements.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Backdrop-first composition pass (fixed badge, larger mark)
- Kept the rounded-square badge size unchanged while increasing anvil footprint so the symbol reads as the primary form and the badge reads as supportive backdrop.
- Allowed controlled horizontal overrun behavior (horn-side emphasis with counterweight on heel side) while keeping the base visually grounded inside the badge.
- Preserved palette, flat vector style, and canonical anvil silhouette; synchronized favicon path to the same refined geometry.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Horn/heel/waist micro-refinement + tighter badge corners
- Smoothed horn emergence from the top face, slightly extended heel presence, reduced face thickness further, flattened/extended waist transitions, and nudged base width for better silhouette balance.
- Tightened rounded-square corner radius for the in-app logo container and favicon badge so the container no longer overpowers the refined symbol.
- Preserved the original muted beige/sand background and dark charcoal glyph palette with flat vector geometry.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Optical refinement pass (proportional tuning)
- Tuned the existing anvil silhouette proportions without changing identity: thinner top face, slightly shorter horn, longer/shallower waist transitions, slightly wider base, and reduced left heel projection.
- Shifted the glyph slightly left and increased internal breathing room to counter horn weight and improve optical centering at favicon scale.
- Kept the original muted beige background + dark charcoal glyph palette and synchronized the favicon path with the in-app mark.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Continuous-form anvil refinement pass
- Refined the anvil mark into a more continuous silhouette so horn, waist, heel, and base read as one sculpted geometric form instead of stacked blocks.
- Improved waist definition with cleaner transitions between face and base, avoiding rigid center cutouts and non-essential chamfers.
- Kept the same muted beige badge + dark glyph palette and synced favicon geometry to the updated silhouette.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Canonical anvil silhouette (SaaS geometry pass)
- Refined the Innvil symbol to better preserve canonical anvil anatomy (horn, face, waist, heel, base) while keeping a minimal engineered SaaS aesthetic.
- Improved optical balance and geometric proportions so the mark reads as an iconic technology symbol rather than a decorative historical illustration.
- Synced the favicon to the same updated silhouette and retained the muted beige background with dark glyph palette.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Bold silhouette logo redesign (anvil-first)
- Redesigned the Innvil symbol into a bold, unmistakable geometric anvil silhouette, prioritizing immediate recognition over abstract hidden symbolism.
- Kept the original brand palette direction: muted beige/sand badge with a dark charcoal glyph, no gradients, glow, or decorative effects.
- Updated favicon geometry + color to match the in-app mark for consistent recognition from 16x16 up to larger brand surfaces.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Minimalist geometric anvil logo redesign
- Reworked the Innvil brand mark into a minimalist geometric monoline symbol inspired by an anvil silhouette, avoiding literal/medieval elements and decorative sparks.
- The new mark emphasizes clean negative space and a strong small-size footprint for favicon clarity and SaaS-grade icon recognition.
- Updated in-app logo usage and favicon to use the same core geometry for visual consistency.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Build fixes + Innvil anvil brand mark refresh
- Fixed TypeScript build blockers across customer/admin/storefront flows: added missing `currency` prop usage in customer quick cards, corrected PaymentsTab fallback typing to satisfy `PaymentsMeta`, and tightened storefront payment-method mapping typing.
- Replaced the old gauge/L visual mismatch with a modern anvil-inspired Innvil mark and aligned favicon + in-app logo usage.
- Increased brand-mark visibility by removing extra logo/container margins so the mark fills its badge area more clearly in top nav/auth/sidebar placements.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Instant admin content while background sync refreshes
- Improved the owner admin experience so providers, services, customers, and payments content remains visible immediately after load while a background refresh updates it with the latest data.
- The admin tabs now use a lightweight session cache to preserve the last loaded state during refreshes, reducing blank states and perceived loading delays.

## Completed Features

### Phase 0: Preview Complete
- ✅ **Panel Statuses** — All 5 statuses (draft, live, inactive, suspended, maintenance) with customer-facing behavior
- ✅ **Customer Management** — Customer list + full profile drawer (wallet, deposits, orders, tickets, login history, referral, API key, notes, ban/restrict/adjust balance)
- ✅ **Provider Management** — Multi-provider table (priority, status, health, last sync), test/import/delete actions
- ✅ **Service Management** — Services list with category, pricing, floor, min/max, refill/cancel/drip, featured
- ✅ **Category Manager** — Reorder, rename, hide, delete categories
- ✅ **Order Management** — Order table, per-order actions (retry/refill/cancel/mark completed/refund), expandable provider detail
- ✅ **Customer API Management** — Owner-side rate limits, allowed IPs, key regen/disable, usage logs (separate from the customer-facing API docs tab)
- ✅ **Risk & Security** — Deposit limits, fraud/access controls
- ✅ **Notifications** — Owner + customer notification toggles, auto-reply, support inbox
- ✅ **Payment Gateway Configuration** — Cryptomus, Coinbase Commerce, NowPayments, Stripe, PayPal, Bank Transfer, Wise, Manual, Custom
- ✅ **Domain Management** — Subdomain, custom domain, SSL status, force HTTPS, redirects, DNS verification
- ✅ **Super Admin** — Analytics, panel management (login-as-owner/view-as-customer), user management, payments, audit logs, system health
- ✅ **Customer-facing privacy rules** — Inactive mode restrictions, API response behavior, never exposes provider cost/floor/commission to customers

> Note: `panel-preview.jsx` at the project root is the original single-file design
> reference this build was ported from. It's gitignored and kept intentionally —
> treat it as a design source of truth for visual/UX intent, not as code to import.
> When the two disagree on a detail, `src/components/panels/index.tsx` (this real,
> typed implementation) is authoritative.

---

### Phase 1: Customer Experience & Order Flow Refinement (Implemented — Preview)

> **Status 2026-07-07:** Implemented as a new, fully separate component tree in
> `src/components/customer/` (CustomerLanding, CustomerDashboard, NewOrder,
> PlatformIcons). The world switcher's "Created panel · Customer-facing" view now
> renders `CustomerPanel`. The old `LivePanel`/`LivePanelContent` in
> `src/components/panels/index.tsx` are deprecated and no longer routed.
>
> Delivered: white-label customer landing (Create Account / Log In only), separate
> customer dashboard (Dashboard, New Order, Orders, Wallet, Tickets, API, Profile),
> Platform → Category → Service flow with monochrome SVG platform glyph buttons,
> alias-aware smart search ("twitter views" → X Views), progressive form with
> dependent resets, full service preview, favorites + automatic Favorites category,
> Recently Ordered, 1-click Quick Order & Reorder, wallet + Add Funds always in
> header, number-input quantity (no sliders), hamburger mobile nav, sticky order
> summary, helpful empty states. All of it status-aware (live/inactive/offline).
> Drip feed: per-service `drip` capability; supported services show an opt-in
> toggle (always OFF by default) with runs/interval inputs — total quantity is
> split across runs, never multiplied.
>
> Profile: edit username, change email (with confirmation), change password.
> API tab: masked key display (nb_live_886**********839976f69bd) with copy +
> one-click regeneration, and full per-endpoint docs (Service list / Create /
> Status / Multiple status / Refill / Balance / Cancel) with copyable request
> URLs and highlighted JSON response samples. Landing page:
> stats strip, per-platform services showcase, benefits grid, FAQ accordion, and
> CTA band — all white-label.
>
> The "Preview Panel Status" switcher bar is preview-only tooling: `CustomerPanel`
> renders it only when given `previewControls` (passed solely by the world
> switcher in `app/page.tsx`, default off). Real customers never see status
> controls — only status effects (offline screens, inactive banner).

### Objective

Redesign the customer-facing experience to be significantly simpler and faster than traditional SMM panels by separating the customer dashboard from the Panel Owner dashboard and reducing the number of steps required to place repeat orders.

### Customer Dashboard

- Customer UI must remain completely independent from the Panel Owner/Admin dashboard.
- Customers only have access to Dashboard, Orders, Wallet, Tickets, API, Profile, and other account-related features.
- Login/Register belong only on the panel's public landing page.
- After authentication, the default page is the Dashboard.

### Landing Pages

- Innvil landing page is dedicated to selling the platform ("Create your own SMM Panel").
- Every panel has its own independent customer landing page focused on **Create Account** and **Log In**, with no Innvil branding.

### Platform Organization

Services should first be grouped by **Social Platform**, configured by the Panel Owner.

Flow:

**Platform → Category → Service**

Platform selection should use **official platform icon buttons**, not a dropdown.

Requirements:

- Use the official monochrome brand glyphs (SVGs).
- Do **not** use emojis.
- Do **not** use colorful logos.
- Place each icon inside a soft, rounded square button/card.
- Desktop displays all available platform buttons in one horizontal row whenever possible.
- Mobile allows horizontal scrolling while maintaining large touch targets.

Selecting a platform filters the available categories and services.

### Order Structure

1. Platform (icon buttons)
2. Search
3. Category
4. Service
5. Service ID
6. Quantity
7. Amount
8. Create Order

### Smart Search

Search should match:

- Platform
- Category
- Service Name
- Service ID
- Aliases / keywords

Searching "Twitter Views" should also return services named "X Views", "Tweet Views", and other relevant aliases.

### Progressive Form

- Category remains disabled until a Platform is selected.
- Service remains disabled until a Category is selected.
- Service details update automatically after selecting a service.
- Changing the Platform resets all dependent selections to prevent invalid orders.

### Service Preview

Display:

- Service Name
- Service ID
- Minimum
- Maximum
- Estimated Start Time
- Estimated Completion
- Refill Availability
- Cancel Availability
- Description

### Favorites & Quick Access

Implement:

- Favorite Service
- Automatic Favorites category
- Recently Ordered
- Pinned Services / Quick Order
- Reorder button on completed orders

### Dashboard Improvements

Display:

- Wallet
- Recent Orders
- Pending Orders
- Completed Today
- Favorite Services
- Quick Order

Wallet balance should remain visible in the header together with an **Add Funds** shortcut.

### UX Improvements

- Remove all quantity sliders.
- Quantity is always entered through a number/text input.
- Remove unnecessary sliding panels throughout the customer dashboard.
- Mobile navigation uses a hamburger menu.
- Sticky Order Summary on desktop.
- Helpful empty states with actionable guidance.
- Minimize clicks throughout the customer experience.
- Optimize for frequent repeat orders rather than first-time users.

### UI Design Note

Platform icons should always use the **official monochrome brand glyphs (SVGs)** displayed inside **soft, rounded square cards**. Avoid emojis and colorful logos. This visual language should remain consistent across desktop and mobile to create a premium, modern interface while keeping every platform instantly recognizable.

### Input Responsiveness (hard rule)

Typing in any customer-facing field must never wait on content loading. Keystrokes
echo immediately and search results update on the same keystroke (typing "1"
instantly lists all service IDs starting with 1). Keep filtering synchronous and
in-memory; when real data arrives (Phase 3+), load/cache the catalog upfront and
filter client-side — debounce only network fetches, never the input echo or
locally-available results.

### Design Principle

The customer experience should **not imitate traditional SMM panels**.

Every interaction should minimize clicks, reduce cognitive load, and optimize for repeat ordering.

When multiple design options exist, always prefer the one that is:

- Faster
- Cleaner
- Easier to understand
- More efficient for returning customers

The customer dashboard should feel closer to a modern SaaS product than a legacy SMM panel. This principle should guide all future customer-facing UI and UX decisions.

---

### Phase 2: Production Foundation (In Progress)
- ✅ **Next.js routing** — App Router with dynamic routes
- ✅ **Role-based layouts** — Preview shells for panel owner, customer, and super admin
- ✅ **Protected routes** — Preview infrastructure (planned for Supabase Auth)
- ✅ **Reusable components** — Card, Toggle, Pill, StatusBadge, StatCard, FloorLedger, RevenueChart
- ✅ **Loading, empty, and error states** — Preview placeholders
- ✅ **Component refactoring** — PanelAdmin split into `src/components/panels/admin/`
  (PanelAdmin shell + AdminTabs with 17 focused tab components + CustomerDrawer).
  Dead `LivePanel`/`LivePanelContent` removed. `panels/index.tsx`: 2,250 → ~1,070 lines.
- ◐ **TypeScript interfaces** — `src/types/index.ts` holds `Panel` + `CustomerRow`
  (re-exports `PanelStatus`). Order/Service/etc. types still to add.
- ⏳ **Mock data extraction** — Mock data already lives in src/data/constants.ts

### Phase 3-6: Supabase Integration, Business Logic, Platform Features, Testing
- ⏳ Pending implementation

---

## Pending Features (Roadmap)

### Phase 2: Production Foundation (Remaining)
- [ ] Role-based layouts for panel owner, customer, and super admin
- [ ] Protected routes with authentication
- [ ] Loading skeletons and error boundaries
- [ ] Empty states with helpful CTAs

### Phase 3: Supabase Integration
- ◐ **Database schema** — DONE: `supabase/migrations/0001_init.sql` (all tables,
  enums, ledger + provider-key pgcrypto functions) + `0002_rls.sql` (RLS, helpers,
  api-key column revoke). Needs a live project to run against.
- ◐ **Supabase clients** — DONE: `src/lib/supabase/{client,server,admin,middleware,constants}.ts`
  + root `middleware.ts` (session refresh). Uses `@supabase/ssr` (added to deps).
  > Owner and customer auth share one Supabase project. To stop them clobbering
  > each other's session on a single origin (localhost), the customer storefront
  > uses a SEPARATE session cookie: `createStorefrontClient()` (server + browser)
  > namespaces via `cookieOptions.name = STOREFRONT_COOKIE_NAME`, and the
  > middleware refreshes the storefront cookie on `/p/*`, the owner cookie
  > elsewhere. In production the storefront is a different domain, so this is moot.
- ◐ **DB types** — DONE: `src/types/db.ts` (row interfaces), re-exported from types/index.
- ◐ **Authentication with Supabase Auth** — DONE (platform/owner side): server
  auth helpers `src/lib/auth.ts` (getUser/getProfile/ensureProfile/hasRole) +
  actions `src/lib/actions/auth.ts` (signIn/signUp/signOut); AuthScreen wired to
  real Supabase (loading/error/email-confirmation states), AppTopbar logout wired.
  Profile fallback via service role (covers the case where the auth.users trigger
  couldn't install).
- ◐ **Customer storefront (real)** — DONE (browse + auth): real route
  `app/p/[subdomain]/` resolves a panel by subdomain (status-aware: offline
  screens for draft/suspended/maintenance, inactive banner), server-fetches
  customer-safe services (`src/lib/actions/storefront.ts` getPublicPanel/
  getStorefrontServices — no cost/markup/profit) + the visitor's customer account.
  `Storefront.tsx`: on-brand landing (branding, hero, platform showcase, benefits,
  auth card) + panel-scoped customer auth (`src/lib/actions/customer-auth.ts`
  customerSignUp/SignIn/SignOut → creates auth user + profile(customer) +
  customer_accounts row). Signed-in view now renders the REAL `CustomerDashboard`
  (Dashboard/New Order/Orders/Wallet/Tickets/API/Profile) fed by live data —
  branding, catalog (Platform→Category→Service + smart search), wallet balance,
  and real order placement via `placeOrder` (§4). The customer components accept
  data via props (mock defaults so `/?preview=1` still works).
  Production maps subdomain→/p/[subdomain] via a middleware rewrite (later); path
  works now. PENDING: wallet funding/deposits (§7), tickets system, real API key,
  order-status sync (§4 cron).
- [ ] Protected-route redirects (owner app) — activate when preview worlds become real routes.
- ◐ **User roles** — schema enum + profile.role + hasRole() gate in place;
  Super Admin / Panel Owner / Customer / Staff. Role-gated route wiring pending.
- ◐ Migrate admin/customer UI off mock data onto the DB (data-access layer) —
  DONE for panels: `src/lib/actions/panels.ts` (listPanels/createPanel/
  updatePanelStatus); InnvilApp loads real panels; DashboardHome + MyPanels
  render them (with empty/loading states); CreatePanelWizard creates real panels;
  a real panel (UUID) now loads into PanelAdmin. Remaining: services/orders/
  customers/etc. tabs still on mock.
  > Admin-dashboard server actions (panels, providers) authenticate the user and
  > enforce ownership IN CODE via the service-role client (getAuthedAdmin), rather
  > than relying on RLS `auth.uid()` (which wasn't resolving on writes in this
  > env). RLS remains in the DB for the future customer-facing browser client.
- [ ] Real-time subscriptions for order updates
- [ ] (schema) Additional tables for the operational admin layer (see Phase 4):
  - `providers` (name, api_url, **api_key encrypted / service-role only**, status, balance, currency, notes)
  - `services` (provider_id, provider_service_id, category, name, type, provider_rate, sell_rate, markup, min, max, description, status, sort_order)
  - `orders` (user_id, service_id, link, quantity, charge, provider_cost, profit, provider_order_id, status, provider_payload, provider_response, status_history)
  - `balance_transactions` (user_id, amount, type, reason, admin_id, balance_after)
  - `payments`/`deposits` (user_id, method, amount, status, gateway_ref, approved_by)
  - `faq` (question, answer, category, sort_order, published)
- ✅ Row Level Security (RLS) policies (panel-scoped; provider api_key never readable client-side) — `0002_rls.sql`

### Phase 4: Business Logic — Operational Admin Dashboard (SocPanel-style)

> This phase turns the preview admin tabs into a real bring-your-own-provider
> control panel. Innvil never sells SMM services directly — each panel owner
> connects their own provider(s); we pull services, forward orders, and sync
> statuses. **All provider API calls happen server-side (route handlers / edge
> functions) so api keys are never exposed to the frontend.** Provider logic lives
> in reusable service files (e.g. `src/lib/providers/`).

- **§1 Provider API Management** — server layer DONE; UI wiring pending
  - ✅ Standard SMM v2 wrapper: `src/lib/providers/` (types + client:
    services/add/status/multistatus/refill/cancel/balance, `ProviderError` handling)
  - ✅ Credentials helper: `getProviderCredentials`/`storeProviderKey` (pgcrypto
    via service-role RPC; keys decrypted server-side only)
  - ✅ Actions: `src/lib/actions/providers.ts` — create/update/delete (RLS authz;
    key stored via set_provider_key), `testProviderConnection`,
    `fetchProviderBalance` (caches balance + last_balance_sync),
    `countProviderServices`. Never returns api keys.
  - ✅ ProvidersTab wired to real data: `listProviders(panelId)`, add-provider
    form → createProvider, per-row Test connection / Fetch balance / Delete, with
    loading/error/empty states. Guards non-UUID (mock) panels. Selects explicit
    non-secret columns (never api_key_enc).
- **§2 Service Import & Sync** — DONE (server + UI), with 2-level auto-categorize
  - ✅ `src/lib/actions/services.ts`: fetchImportableServices, importServices
    (markup applied to selection; **auto-creates a two-level category tree** —
    platform category e.g. "Instagram Services" → sub-category e.g. "Followers",
    detected by keyword from the provider category+name; platform guess for the
    customer flow), syncProviderServices (refresh rate/min/max + availability,
    recompute sell rate), setServiceStatus, updateService, deleteService,
    listCatalog (nested platform→sub→services tree), recategorizeServices
    (rebuild platform→type from service names, drop empty leaf categories — fixes
    pre-2-level imports without delete+reimport). Detection: main category =
    platform name only; sub = service type keyword; both read from the service
    NAME so provider category messiness is ignored. Markup math in
    `src/lib/money.ts`. Requires migration `0003_category_hierarchy.sql`
    (adds provider_categories.parent_id).
- **§3 Service Management** — DONE (bulk done; a couple of edge fields remain)
  - ✅ Provider cost vs sell vs profit shown per service.
  - ✅ Enable/disable per service (toggle).
  - ✅ Edit imported services: display name, description, markup (recomputes sell), delete.
  - ✅ Bulk actions: global "Select all services" + per-row multi-select →
    enable/disable, set markup (recomputes sell), delete. `bulkSetServiceStatus`/
    `bulkSetMarkup`/`bulkDeleteServices` (authorizeServiceIds gate; chunked `.in()`).
  - ✅ Per-category **Delete** (platform + sub headers) → `deleteCategory` removes
    the category + children + their services.
  - ✅ Per-platform **editable logo** (`setPanelPlatformIcon` → `panels.settings.
    platforms[key]`, monochrome SVG path). Built-in glyphs incl. LinkedIn/Bluesky;
    unknown platforms get a neutral ring until a logo is set. Customer platform
    buttons are derived from available services (empties hidden) and use these
    logos; picking a service collapses the list into a re-pick dropdown.
  - [ ] Nice-to-have later: bulk category move, sync-selected, edit min/max/sort order.
- **§4 Order Automation** — placement DONE (customer side); sync/cron pending
  - ✅ `src/lib/actions/orders.ts` `placeOrder`: charges wallet via
    `apply_balance_change` (atomic), inserts the order, auto-routes to the mapped
    provider (`addOrder`, server-side), stores provider order id + payload +
    response, writes order_status_history. Refunds + marks `refunded` if the
    provider rejects/unreachable. Unmapped service → stays `pending`.
    `listCustomerOrders` for the customer dashboard. Wired into the storefront
    (NewOrder → onPlaceOrder → placeOrder → refresh).
  - ✅ Status sync: `src/lib/orders/sync.ts` (mapProviderStatus, syncPanelOrders
    batch `getMultiStatus` per provider with an atomic status-transition claim,
    syncAllOpenOrders). Cron `app/api/cron/sync-orders` (+ `vercel.json` every
    10 min, CRON_SECRET-gated) + owner `syncOrdersNow(panelId)` for on-demand.
    Partial/canceled/refunded auto-refund the unfilled portion (proportional to
    `remains`), once, via the claim → apply_balance_change('refund').
  - ✅ Manual per-order actions (owner): `src/lib/actions/admin-orders.ts`
    resendOrder / requestRefill / requestCancel / markOrderCompleted / refundOrder
    (full or partial). All owner-auth + ownership-checked; provider calls server-side.
- **§5 Admin Orders Page** — DONE (owner Orders tab is real)
  - ✅ `listPanelOrders(panelId, {status?, limit?})` — real order list with owner-only
    fields (charge, provider cost, profit, provider order id, remains). Emails resolved
    via service role. OrdersTab: status filter chips + client-side search (id/service/
    customer/link), expandable detail with the per-order actions above + "Sync statuses"
    (syncOrdersNow). Guards non-UUID (mock) panels.
  - `getPanelOverview(panelId)` powers the real **Overview** tab (revenue today, orders
    today, pending, customers, active services, recent orders). `getPanelCurrency`.
  - [ ] Later: provider/date-range filters, raw provider_response viewer, CSV export.
- **§6 Users & Balance Management** — DONE (owner side)
  - ✅ Real customer list per panel: `listPanelCustomers` (email, balance, order
    count, spend, status: active/banned/restricted). CustomersTab wired to it.
  - ✅ Manual credit/debit with reason → `adjustCustomerBalance` (apply_balance_
    change `manual_adjust`, owner as admin); inline Credit +/Debit − per customer.
    `setCustomerStatus` (ban/unban). `src/lib/actions/customers.ts`.
  - This is the MVP wallet-funding path (owner credits a customer → they can order)
    until self-serve gateways (§7 / Phase 5).
- **§7 Payment Admin** — multi-gateway, bring-your-own PER PANEL (adapter pattern)
  - ✅ **Adapter architecture** `src/lib/payments/adapters/` — a `GatewayAdapter`
    (fields, createCheckout, extractOrderId, verifyWebhook) + registry +
    `GATEWAY_CATALOG` (shows the whole ecosystem incl. India options; unbuilt ones
    are "coming soon"). Adding a gateway = one adapter + it's live.
  - ✅ **Cryptomus** (crypto), **Razorpay** (India — Payment Links + HMAC webhook),
    **Stripe** (global — Checkout Session + signed webhook), **NOWPayments** (crypto,
    300+ coins — hosted invoice + HMAC-SHA512 IPN) all connectable.
    PayPal / PayU / Cashfree / Paytm / Coinbase = catalog "coming soon".
  - ✅ Credentials: migration `0005` table `panel_payment_gateways`; secrets stored
    as an ENCRYPTED JSON blob in `api_key_enc` (reuse set/get_gateway_key), public
    fields in `config` jsonb. `getGatewayContext` decrypts server-side only.
  - ✅ Shared webhook `src/lib/payments/webhook-handler.ts` + routes
    `app/api/webhooks/[gateway]` (+ static `cryptomus`): adapter verifies →
    idempotent pending→completed → `apply_balance_change('deposit')`.
  - ✅ Actions `payments.ts`: getPaymentsMeta / connectGateway (dynamic fields per
    adapter; blank secret keeps existing) / disconnectGateway / createDeposit
    (routes via the panel's active gateway) / listDeposits. PaymentsTab = full
    catalog UI. **Requires `NEXT_PUBLIC_APP_URL` + a public webhook URL.**
  - Owner setup: Razorpay/Stripe owners add the webhook endpoint in their gateway
    dashboard (help text in the UI); Cryptomus is per-invoice (auto). NOWPayments
    owners set the IPN callback URL to `<APP_URL>/api/webhooks/nowpayments` and paste
    the API key + IPN secret.
  - [ ] Next: PayPal, then PayU/Cashfree/Paytm adapters; per-panel CURRENCY (wallets
    are USD-oriented today — Razorpay charges INR); storefront multi-gateway chooser;
    admin deposits/tx-log view.
- **§8 Support & FAQ**
  - [ ] Ticket system: view, reply, close, reopen
  - [ ] FAQ CRUD
- **§9 Statistics Dashboard**
  - [ ] Cards/charts: revenue, provider cost, profit, orders (total/pending/completed/failed), users, deposits
  - [ ] Provider performance: orders by provider, failure rate, avg completion, profit by provider
- **§10 Panel Settings**
  - [ ] Settings pages: general, branding/logo/name, domain/custom domain, + placeholders (language, notifications, integrations, manager/staff roles) structured for later expansion

### Phase 4.w: Design with AI Add-on (NOTED, not built)

> Post-MVP paid add-on for panel owners to generate storefront themes/sections/copy
> with controlled quality and safety.

- Runtime model access should use an Innvil-owned API account/provider that allows
  serving end-users; do not assume personal editor subscriptions can be embedded as
  website runtime AI backends.
- Hard boundary: Design with AI is interface-only (landing-page/panel-dashboard
  design and formatting) and must never mutate backend rules, business logic,
  permissions, payment/order flows, or database behavior.
- All AI requests must be server-side only (no provider secrets in browser).
- Generation contract: strict JSON schema output + component allowlist renderer.
- Quality pass chain: planner -> builder -> critic -> repair, then publish approval.
- Persist versioned drafts with rollback and generation audit logs.
- "Skills" should be implemented as Innvil-owned prompt rules, retrieval docs,
  validators, and regression tests (not chat-memory coupling).

### Phase 4.v: Trust boundaries + go-public SEO messaging (NOTED, not built)

- Customer-account trust boundary:
  - panel owners must not have login-as-customer capability in production;
  - panel owners must not have customer password reset capability;
  - owner remediation is limited to moderation + balance adjustments.
- SEO/ad messaging before public launch should explicitly highlight:
  - easier operations than legacy SMM panels,
  - customer-account protections above,
  - custom-domain reversibility (disconnect falls back to included subdomain).
- Public launch gate: ship only when current MVP fixes are complete; keep non-ready
  modules clearly labeled as "coming soon".

### Phase 4.v.1: Pre-launch landing pages + storefront designs (NOTED, for MVP)

> When we go public, do a dedicated landing + storefront design pass.

- **Main Innvil landing = FULL feature parity.** Surface every built feature (panels,
  bring-your-own-provider, custom domains, wallet, support tickets, earnings/receipts,
  duplicate detection + mass cancel, provider-balance visibility, mobile, etc.). Use
  **socpanel.com** as the structural reference for the main marketing landing.
- **Lead with what socpanel does NOT have** (differentiators):
  - **0% monthly rent — 5% commission on completed orders only** (socpanel charges
    monthly rent regardless of sales). Headline differentiator.
  - No setup fee; unlimited panels per account; subdomain live in minutes.
  - **Bring-your-own-provider** — Innvil never resells; owner keeps 95%.
  - **Custom-domain reversibility** — disconnect anytime → auto-falls back to the
    included subdomain (no lock-in).
  - **Customer privacy boundary** — owners can't log into customer accounts or reset
    customer passwords; only balance adjustments (trust/safety).
  - **Modular business OS**, not just a panel — Automator, Analytics add-on, Design
    Shop, downloadable earnings receipts.
  - **ANVIL rewards token** (future) — rewards on top-ups + discounts on paid features.
  - Modern, mobile-first SaaS UX.
- **Richer per-panel storefront landing + more Design-Shop templates.** Expand the
  default storefront landing content and add premium themes/templates. Base panel/
  storefront designs on: **smmcost.com, smmcity.com, worldofsmm.com, prm4u.com**.

### Phase 4.u: Child panels (NOTED, not built)

- Introduce child panels where customers can run their own panel experience.
- Child-panel rent/pricing should be configurable by the child-panel operator.
- The current storefront UX can evolve into the child-panel admin surface.

### Phase 4.x: Automation Add-on ("Automator") — PAID feature (NOTED, not built)

> Port the working system at `C:\Users\My PC\SMM-automator` (Next.js + Supabase)
> INTO Innvil as a **paid add-on** a panel owner can buy/enable. Also a strong
> landing-page ad / SEO section. **Keep the reference project's logic**; only
> re-skin it to Innvil's design system (obsidian/gold/violet) — its own design
> is intentionally basic (built for the owner's internal use). The preview
> `AutomationTab` already has an "Automator add-on" placeholder to grow into.

**What the automator does (logic to retain), from the reference project:**
- Manual **mass order**: paste many post links → per-link **platform auto-detect**
  from the URL hostname (x/twitter, instagram, tiktok, linkedin, youtube — see
  `app/api/orders/route.ts` `detectPlatformFromLink`) → one tracked order per link.
- **Service presets** per (platform, tier=priority|regular): enabled presets map a
  `service_type` (likes/views/comments/…) → a provider service id + quantity, so a
  single link fans out into the right set of services automatically
  (`lib/place-order.ts` `submitOrderForLink`). Instagram **Reel** rule: only order
  views for /reel/ links. **Duplicate-skip**: a service already submitted for a
  link is skipped.
- **Comment pools**: for the `comments` service type, pull N unused comments from a
  per-platform pool (auto-pick oldest with stock), mark used, pass to the provider.
  Pools are uploaded as CSV (papaparse) → `comment_pools` / `comment_pool_items`.
- **Fully-automatic mode** (optional, advanced): `watched_accounts` + a cron
  (`app/api/cron/poll-x`) watch X accounts and auto-order newly detected posts.
- Background processing via Next `after()`; orders tracked in an `orders` table
  with a `services_ordered` JSON + status pending→submitted/failed.
- Reference tables: service_presets, comment_pools, comment_pool_items,
  api_providers, watched_accounts, settings, orders.

**Requested enhancements when porting:**
1. **Smart link detection** — today it splits on `\r?\n|,` only. Make it detect
   links even when pasted as ONE blob with no separators. Recipe: split *before*
   each URL start and keep only URL-shaped parts, e.g.
   `text.split(/(?=https?:\/\/)/i).map(s=>s.trim().replace(/[\s,]+$/,"")).filter(s=>/^https?:\/\//i.test(s))`
   — handles newlines, commas, spaces, AND concatenated `…/1https://…/2`.
2. **File upload** to extract links: **csv** (papaparse — already used), **xlsx**
   (SheetJS `xlsx`), **docx** (`mammoth` → raw text). **pdf** if feasible
   (`pdfjs-dist`/`pdf-parse`); if it's heavy, ship csv/xlsx/docx first. Flatten the
   file to text, then run the same smart link detection.

**Innvil integration shape:**
- Gate behind an add-on flag on the panel (e.g. `panels.settings.automation` or a
  subscription row); Innvil can charge for it (revenue beyond the 5%).
- Customer side: a "Mass / Auto Order" surface in the customer dashboard (link
  blob + file upload + smart detection), only when the panel has the add-on.
- Owner side: configure service presets per platform/tier + comment pools (grow
  the existing AutomationTab).
- Provider calls reuse `src/lib/providers/` (server-side, keys never exposed).
- Landing: dedicated feature/SEO block (like the provider-automation section).

### Phase 4.y: Analytics Dashboard + Content Calendar Add-on (NOTED, not built)

> Same shape as the Automator above: a **paid, unlockable add-on** on top of the
> core panel product, not part of the base panel/storefront. Direction is to
> grow Innvil into a one-stop shop for social-media-marketing tooling beyond just
> SMM order fulfillment. Build this only after the current panel-maker product
> (Phases 2-4 core) is complete and earning — it needs a cron/infra upgrade
> beyond what Phases 2-4 require.

**What it is:**
- An analytics dashboard + content calendar. Proposed subdomain shape:
  `analytics.innvil` (mirrors the `p.[subdomain]` storefront pattern).
- **Bring-your-own API**, same principle as SMM providers: the panel owner
  supplies their own platform API keys/credentials — Innvil never fills these in
  and never pays for or proxies a social platform API on the owner's behalf.
  This is why pricing is a flat rental, not usage/subscription-to-an-API-cost
  (see pricing below).
- **Auto-posting/scheduling is a separate, distinct feature inside the content
  calendar** — not bundled into "analytics." Analytics = tracking/reporting on
  followed accounts and links; calendar = planning + (optionally) auto-posting.
- Core analytics loop: user adds accounts they want to follow/track → every new
  link pulled gets analytics attached → user can download a synced CSV export on
  whatever cadence their plan allows. What the user does with those links
  afterward is their own responsibility — cover this explicitly in ToS/privacy
  terms (extend Innvil's existing ToS for this add-on specifically).

**Reference implementation (structure/UI reference ONLY, not a design source of
truth — Innvil's own obsidian/gold/charcoal theme and component system always
win over this):**
- `C:\Users\My PC\Documents\CRM style analytics dashboard` (internally named
  "LinkBatch"). Next.js + Supabase. Relevant files: `components/
  LinkBatchDashboard.js`, `lib/linkbatch-data.js` (data shape, stats aggregation,
  hashtag/topic trend helpers), `supabase/migrations/001_linkbatch_crm.sql`
  (schema: workspaces, connected_accounts, campaigns, posts + post_metrics,
  export_batches + export_batch_items, reports, activity_events, workflow_jobs,
  alerts, saved_views, notifications, drafts, scheduled_posts, approvals,
  media_assets, publishing_logs, plan_limits, admin_cost_settings, billing_usage
  — all workspace-scoped with RLS via an `lb_is_workspace_member()` helper).
  The reference project's own dashboard UI is messy/unfocused by the user's own
  assessment — when porting, consolidate and simplify rather than copy as-is;
  take the useful pieces (account/link tracking, CSV export batches, hashtag/
  topic trend rollups, workspace + RLS pattern) into Innvil's own IA.
- The reference project's plan tiers are subscription-priced against its own API
  cost ($0/$49/$99/$299/$549/custom) — **do not reuse this pricing model**; that
  project pays for its own API access, Innvil's add-on does not.

**Innvil pricing direction (rental, not subscription-to-API-cost):**
- Flat monthly **rental** tiers, gated by sync/refresh frequency (not by API
  cost, since the owner brings their own key): Basic $25/mo, Standard $45/mo,
  Premium $75/mo, Business $105/mo (exact naming/amounts TBD at build time, but
  keep the "rent scales with refresh rate, not with API spend" principle).
- Higher tiers = faster sync/refresh cadence for pulling link analytics —
  similar in spirit to the reference project's `sync_frequency_minutes` per
  plan, but the price basis is refresh rate/rental, not a cost Innvil incurs.

### Phase 4.z: ANVIL platform token (NOTED, not built — post-MVP)

> Innvil's experimental platform token/rewards system — the competitive moat idea.
> **Build only after the core MVP is stable & public-ready.** Full economics live in
> memory `innvil-anvil-token.md`. Summary:
> - **Phase 1 (off-chain, in-platform):** ANVIL rewarded as a % of each top-up; accrues
>   APY (~0.5–1%/yr, higher when holding ≥ $100 worth); USD ⇄ ANVIL conversion; opt-in
>   toggle to spend ANVIL as substitute currency when USD is exhausted; ANVIL buys every
>   paid feature (Design Shop, Analytics rent, Automator, future SaaS) at **tiered
>   discounts** — each tier kept below Innvil's margin so we still net positive. Target
>   max supply 10B. Collect traction data for the deck + on-chain reference.
> - **Phase 2 (on-chain):** launch with extra user benefits to grow holders; in-platform
>   ANVIL converts **1:1** to the coin; add a **burn** mechanism (spending ANVIL in the
>   panel burns supply); keep adding SaaS sinks to drive utility + holders.
> - Branding: platform currency is *anvil* now → *ANVIL* the coin later (logo = the mark).

### Phase 4.M: Innvil Virtual Moderator — Natural Chatter & Community Moderation Refinement ((A) DONE v1.1.84, (B) DONE v1.7.0, (C)–(F) NOTED)

> Telegram-based AI community moderator add-on. Foundation already built and live in
> this branch: Managed Bot provisioning (BotFather-token fallback + Telegram Managed
> Bots deep-link flow), the free 7-day trial entitlement system, Connect Community +
> `ModeratorDeployment`, Innvil Moderator Acknowledgement (bounded bot-to-bot ack
> between Innvil moderators sharing a community, loop-proofed via `origin`/
> `interactionDepth`, verified live end-to-end incl. the loop-safety fix, v1.1.80),
> and Reactive Natural Chatter (replies to human chat) — confirmed working live
> end-to-end. Architecture: Telegram adapter → `CommunityEvent` → Community
> Coordinator (`src/lib/moderator/coordinator.ts` / `chatter-coordinator.ts`) →
> `CommunityAction` → Telegram adapter, orchestrated in `community-runtime.ts`.
> `docs/moderator/natural-chatter-refinement-spec.md` is the verbatim source-of-truth
> spec (57 sections); implement (C)–(F) FROM that file, not from this summary. Scope
> is tightly bounded to 6 things:
> - **(A) Reactive response selection/pacing — DONE (final form: v1.1.97).**
>   **Natural Chatter uses contextual social action selection. It does NOT use flat
>   response percentages anywhere.** `selectChatterAction()` (`chatter-coordinator.ts`)
>   takes no RNG parameter and contains no `Math.random()`; the earlier
>   probability models (v1.1.84's LOW/MEDIUM/HIGH/VERY_HIGH → 0%/35%/85%/100% bands,
>   and v1.1.96's opener signal that still fed them) were **removed outright** —
>   repo-wide greps for `selectChatterResponder`/`ENGAGE_PROBABILITY`/
>   `PROBABILITY_GATE`/`ChatterPriority`/`priorityBand` return nothing.
>   The Coordinator classifies the message (EMPTY / TOO_SHORT / COMMUNITY_OPENER /
>   TRIVIAL / QUESTION / SUBSTANTIVE) + room state and returns exactly one
>   first-class action: **`SILENCE` · `REACT` · `SHORT_ACK` · `CASUAL_CHAT` ·
>   `ANSWER`** (`COMMUNITY_HANDOFF` stays a bot-to-bot concept in `coordinator.ts`;
>   a HUMAN message never routes to it). **Silence is contextual, never a lost
>   roll** — every SILENCE carries reasons (`already_handled`, `trivial_low_value`,
>   `no_eligible_moderator`, `low_social_priority`, `already_handled_recent_reply`,
>   …). **Cost:** SILENCE/REACT/SHORT_ACK make **zero** AI calls (REACT is a real
>   Telegram reaction; SHORT_ACK is a deterministic phrase from `shortAckText()`);
>   only CASUAL_CHAT/ANSWER reach Sonnet 5, each with its own action-specific
>   prompt. The action union structurally carries exactly ONE `deploymentId`, so N
>   moderators can never produce N generations. **Randomness now exists in exactly
>   one place** — `shortAckText()` picking which canned phrase to use: it varies
>   *wording*, never *whether* a moderator acts and never *who* (selection is
>   deterministic: explicit mention → active-exchange continuity → quietest
>   longest). **Multi-moderator (§15) — DONE (v1.1.85).** `findChatterDeployment`
>   (singular, `.limit(1)`) → `findChatterDeployments` (plural); also fixed a real
>   pre-existing bug where pacing was read AFTER streaks were reset, making the
>   dominating-conversation safeguard unreachable. **Conversational continuity
>   (v1.1.95):** `wasLastSpeaker` keeps whoever's mid-exchange answering, instead of
>   a different moderator jumping in as if it were the subject. **Moderator
>   handoff + closing tone (v1.1.98):** live-caught a second bug in the same
>   family — one moderator (Kwan) answered six messages straight, fabricating
>   "it's just me around" while a second deployed moderator (Test) sat idle, even
>   answering FOR Test after an explicit `@test1_mod_bot` mention, then tacked
>   "anything else on your mind?" onto a plain "I see, okay." `invitesOtherModerator()`
>   detects generic handoff requests ("any other moderator who can respond here?",
>   "anyone else?") and EXCLUDES the currently-speaking candidate from selection
>   (not merely deprioritizes it) when 2+ moderators are deployed. Fixed the same
>   directed-vs-continuity ordering bug in the `SUBSTANTIVE` branch specifically
>   (it checked `wasLastSpeaker` before `isDirectedAtBot`) so an explicit mention of
>   a different, non-speaking moderator now correctly wins for plain statements too,
>   not just questions. `CLOSING_ACK_RE` folds "I see, okay." / "got it" / "alright"
>   / "fair enough" into `TRIVIAL` regardless of word count (they were 3+ words,
>   missing the existing `isTrivial` heuristic entirely) — right after a moderator
>   reply these now resolve to `SILENCE`, not another reply. Generation prompts gained
>   `otherActiveModeratorNames` (the real, current deployment list — a moderator can
>   only reference another's presence/absence grounded in this fact, never invented)
>   plus an explicit single-identity rule and a ban on generic support-chat closers.
>   **Plain-name targeting, history grounding, persona isolation (v1.1.99):** three
>   more live-caught bugs. (1) A moderator addressed by its plain configured name
>   ("what persona are you kwan?", no @mention) went unanswered until the human
>   typed `@kwan_mod_bot` explicitly — `messageIsDirectedAtBot` only checked
>   @username and Telegram reply-to, never the moderator's own name. New pure
>   `resolveDirectedModerator()` (`chatter-coordinator.ts`) resolves @username,
>   reply-to, exact plain name, or a typo-tolerant near-spelling ("knaw"/"kwna" for
>   "Kwan") — word-boundary-safe (tokenized, so "Ann" is never triggered by
>   "announcement") and ambiguity-safe (2+ equally-plausible name matches resolve
>   to no directed target, never a guess). Typo tolerance uses an anagram/
>   transposition check rather than raw edit distance — short names like "Test"
>   are distance-1 from real words ("rest"/"best"/"west"), which would otherwise
>   false-positive; an exact letter-for-letter anagram of a specific configured
>   name is a much safer signal. (2) Kwan invented "was just responding to Test's
>   message first" to explain a message it simply wasn't selected for — added an
>   explicit grounding rule: never invent reasons for your own silence or claims
>   about another moderator's actions; give a neutral answer instead. (3) Moderator
>   voices were bleeding into each other (one picked up the other's lowercase/
>   terse style over a long conversation) — root cause was two-fold:
>   `personaStyle()` never read the `formality`/`slang`/`teasing` persona fields
>   at all (now it does), and the transcript labeled messages by name only, with
>   no signal distinguishing "your own past messages" from "a different
>   moderator's" — now explicitly labeled `(you)` vs `(a different moderator, not
>   you)`, plus an explicit anti-imitation rule ("do not imitate their voice...").
>   New `chatter-generate.test.ts` asserts all of this against the actual
>   assembled prompt strings, not live model output.
>   **Upbeat closings react instead of replying + style-drift-under-questioning fix
>   (v1.2.0):** two more live-caught bugs from the same conversation. (1) "okay,
>   perfect!" (2 words, 14 chars) got a full `CASUAL_CHAT` text reply instead of a
>   reaction — it exceeded the old 12-char `isTrivial` cap so it fell through to
>   `SUBSTANTIVE`, where continuity picked it up as a real message worth
>   continuing. Widened the cap to 16 chars and added `POSITIVE_WORD_RE`
>   (perfect/awesome/amazing/excellent/fantastic/sweet/"love it"/"nice one"/great)
>   checked inside the `TRIVIAL` branch, before the directed/ambient split — an
>   upbeat short closing now always resolves to `REACT` (❤️ for "love", 😄
>   otherwise via `positiveReactionFor()`), never a new sentence back, matching how
>   a human moderator would actually react to "perfect!". A plain neutral closing
>   with no positive word ("got it") still resolves to `SILENCE` as before — only
>   genuinely upbeat closings get a reaction. (2) Kwan's writing flipped from
>   initial-caps to all-lowercase immediately after a human asked "why are you so
>   formal though, kwan?" — the model was treating the question about its tone as
>   an instruction to change it. `personaStyle()`'s formality lines are now more
>   mechanical/imperative ("Always capitalize the start of your sentences... this
>   is a fixed habit of how you write, not something you adjust message to
>   message" / "Always write in lowercase... fixed habit..."), and a new
>   `SHARED_RULES` entry explicitly states writing style is FIXED by configuration
>   and does not change in response to being asked about it — the moderator can
>   still answer the question honestly, it just keeps writing in its own normal
>   style while doing so. New regression tests in both `chatter-coordinator.test.ts`
>   (upbeat-closing → REACT, neutral-closing → SILENCE, ambient upbeat still
>   reacts) and `chatter-generate.test.ts` (prompt asserts the fixed-style rule is
>   present).
>   **Positive-closing detection decoupled from the character cap (v1.2.1):**
>   the v1.2.0 fix widened `isTrivial`'s character cap 12→16 to catch "okay,
>   perfect!", but that's the same fragile-heuristic class of bug — a slightly
>   longer 2-word closing using longer words ("that's fantastic!", 17 chars)
>   would still fall through it. New `isPositiveClosing()` bounds by WORD COUNT
>   only (≤4 words containing a `POSITIVE_WORD_RE` hit), independent of
>   `isTrivial`'s character cap, and is OR'd into `classifyMessageKind`'s
>   `TRIVIAL` branch alongside `isTrivial`/`CLOSING_ACK_RE` — the same pattern
>   already used for `CLOSING_ACK_RE` in v1.1.98. A genuinely longer sentence
>   that happens to mention a positive word mid-paragraph (5+ words) still
>   stays `SUBSTANTIVE`. New tests cover both the longer-words case and the
>   mid-paragraph non-closing case.
>   **TRIVIAL/closing acknowledgement detection is now intent-based rather than
>   gated by an arbitrary small character limit (v1.3.0):** longer acknowledgements
>   can resolve to REACT/SILENCE, while acknowledgement + new substantive content
>   still routes normally. Live bug: after a moderator's joke, "prettyaccurate too.
>   lol" (3 words, 23 chars — over every length cap tried so far, including the
>   v1.2.0/v1.2.1 widenings) generated a full follow-up reply instead of reacting
>   or staying silent, because length/word-count was the classification gate.
>   New `isAcknowledgementOnly()` replaces it with a semantic check: hard
>   exclusions first (ends with "?", a contrast/continuation marker "but/however/
>   though/although/except/still/also", a request marker "can/could/would you" /
>   "please", or — critically — a negative-state/problem word matched by STEM,
>   not exact word-boundary regex, so "failure" is caught the same as "failed";
>   deliberately over-inclusive since a false trigger just means a real reply
>   instead of a reaction, never the reverse). Only past those gates does it
>   tokenize, require at least one recognized ack/laugh/thanks/agreement signal,
>   and tolerate a SMALL residual of otherwise-unclassifiable leftover words
>   (≤2) as a weak fallback signal, not the decisive one — a single leftover
>   token is never assumed safe by tolerance alone (a bare "broken"/"down"/
>   "error" residual is excluded by the explicit vocabulary regardless of
>   count). A dedicated `isKnownConcatenation()` word-break check recognizes a
>   glued-together closing like "prettyaccurate" ("pretty"+"accurate") as
>   recognized content without resorting to blanket tolerance. Existing
>   `isTrivial`/`CLOSING_ACK_RE`/`isPositiveClosing` length-bounded checks are
>   kept as fast-path additions (harmless redundancy for short cases), but the
>   new semantic check is what actually resolves anything longer. Adversarial
>   tests added specifically for the single-residual-token risk the fix targets
>   ("yeah lol broken", "haha okay it's failed", "yeah lol down", "lol yeah
>   error", "yeah lol total failure" catching the "failure"-vs-"fail" regex gap)
>   plus a long fabricated-topic message that merely opens with an ack word,
>   confirming none are silently swallowed. 245 tests pass, zero regressions to
>   plain-name targeting, @username/reply targeting, directed-over-continuity
>   priority, persona isolation, history grounding, deterministic selection, or
>   bot-loop protections.
>   **Community-opener staleness guard (v1.3.1):** live bug caught while checking
>   the live Telegram chat — "hey guys 👋" sent 95 minutes after the previous
>   message (a moderator reply, "glad it landed 😄") was silenced with reason
>   `already_handled`, even though the room had gone completely quiet in
>   between. Root cause: `recentlyAnsweredByModerator`/`recentlyRespondedByHuman`/
>   `wasLastSpeaker` in `community-runtime.ts` were computed purely from WHO sent
>   the prior message in history, with no regard for WHEN — a moderator's reply
>   from hours ago, simply because it's the last row, was treated identically to
>   one from 10 seconds ago. New `isRecentMessage(createdAt, now)` (exported,
>   `RECENT_EXCHANGE_WINDOW_MS` = 5 minutes) gates all three: `loadRecentContext`
>   now also selects `created_at` (threaded onto `ChatterContextMessage` as
>   `createdAt`), and `handleHumanMessage` only treats the prior message as
>   "the room is mid an active exchange" when it's within the window. New tests
>   in `community-runtime.test.ts` cover the exact 95-minute live repro, an
>   active 30-second-old exchange still counting as recent, and the exact
>   window boundary (strict less-than). Diagnosed via `moderator_activity_log`
>   (`decision=SILENCE reason=already_handled`), which is what made this
>   provable rather than guessed — worth querying first for any "the bot didn't
>   respond" report before touching classification code.
>   **Moderator persona identity — configurable + primary over AI-ness (v1.4.0).**
>   Live bug: asked "what persona are you?", moderators collapsed into generic
>   "just an AI... no special persona... nothing fancier than that" instead of a
>   real persona answer. Root cause was two-fold: (1) **no moderator had ever had
>   a persona actually configured** — `virtual_moderators.persona` was set once to
>   `DEFAULT_MODERATOR_PERSONA` at creation with NO owner-facing action or UI to
>   ever change it, so Kwan and Test were running on byte-identical bland
>   defaults; (2) even with numeric style knobs (formality/humor/slang/...) set,
>   the prompt only had writing-MECHANICS instructions ("write in lowercase"),
>   never a first-person-usable self-DESCRIPTION, and no rule distinguishing a
>   persona question from an AI-identity question — so the model fell back to the
>   only self-referential guidance it had (the AI-honesty rule) for both.
>   - New `ModeratorPersona.description` (`domain.ts`) — an owner-authored,
>     free-text self-description ("laid-back, friendly, concise, slightly
>     witty"), stored in the existing `persona` jsonb column (no migration).
>   - New owner action **`setModeratorPersonaDescription`** (`actions/moderator.ts`,
>     merges into the existing persona object, preserves the style knobs) — the
>     FIRST persona-editing action to exist at all. `VirtualModeratorRow` gained
>     `personaDescription`; `listVirtualModerators` reads it via
>     `normalizeModeratorPersona`.
>   - New **"Persona" input + Save button** in the owner's Virtual Moderator tab
>     (`AdminTabs.tsx` `TelegramConnectRow`) — always visible per moderator,
>     independent of Telegram-connection status.
>   - `chatter-generate.ts`: new `personaIdentityLine()` surfaces the configured
>     description as the AUTHORITATIVE persona answer (or an honest "nothing
>     configured, don't invent traits" fallback when blank) — separate from
>     `personaStyle()`, which still governs HOW the moderator writes, not WHO it
>     says it is. Rewrote the AI-honesty `SHARED_RULES` entry to require
>     re-anchoring to name + persona immediately after any AI/bot acknowledgement
>     ("yeah, I'm AI-powered, but here I'm Kwan — laid-back and to the point") —
>     AI-ness never replaces the persona. New rule explicitly separates persona
>     questions from AI-identity questions and bans "just an AI"/"no special
>     persona"/"just a regular mod"/"nothing fancier than that" phrasing whenever
>     a persona IS configured.
>   - Tests (`chatter-generate.test.ts`): persona surfaced verbatim + marked
>     authoritative, persona-vs-AI-question distinction present, denial phrasing
>     banned, AI re-anchoring required, persona stated as PRIMARY over AI-ness,
>     Kwan/Test isolation (no cross-contamination), and the missing-persona case
>     (neutral fallback, no fabrication). 258 tests pass.
>   **Persona preset picker — 18 distinct starting personas (v1.5.0).** Follow-up
>   to v1.4.0, since a blank text field is still a blank-page problem for most
>   owners. New `src/lib/moderator/presets.ts` (pure, no I/O) — 18 curated
>   presets (Calm Professional, Friendly Community Mod, Chill & Casual, Witty Mod,
>   Direct & No-Nonsense, Hype & Energetic, Supportive Guide, Technical Expert,
>   Strict Moderator, Diplomatic Mediator, Polite Minimalist, Playful Meme Mod,
>   Community Veteran, Dry Humor, Big-Sibling Mod, Founder-Like, Web3 Native,
>   Gaming Community Mod), each a genuinely distinct combination of the
>   *existing* `ModeratorPersona` dials (formality/humor/slang/emojiFrequency/
>   teasing/chattiness/profanityTolerance) + a tailored `description` +
>   substantive `customInstructions` (not "You are friendly"-shallow) + UI tags
>   + a unique example-voice line. 10 are surfaced by default
>   (`DEFAULT_SURFACED_PRESET_IDS`); the other 8 sit behind "More presets"; a
>   "Custom" option clears the preset link without touching any field.
>   **No migration, no new generation plumbing** — `applyPersonaPreset()` is a
>   ONE-TIME materialization onto the same persona jsonb fields v1.4.0 already
>   wired into `personaStyle()`/`personaIdentityLine()`, so presets flow through
>   generation for free. New `ModeratorPersona.presetId` (nullable) is pure UI
>   provenance ("based on: X") — generation never reads it, and nothing ever
>   re-applies a preset automatically, so a later manual edit to
>   description/customInstructions is never silently snapped back.
>   - New owner actions (`actions/moderator.ts`): `applyModeratorPersonaPreset`,
>     `clearModeratorPersonaPreset`, `setModeratorCustomInstructions`.
>     `VirtualModeratorRow` gained `personaCustomInstructions`/`personaPresetId`.
>   - New UI: `PersonaPresetPicker` (`AdminTabs.tsx`) — a card grid (label,
>     one-line description, style tags) above the existing persona-description
>     input; clicking a card previews its example-voice line before an explicit
>     "Use this persona" click actually applies it (never a stray-click
>     overwrite); a collapsible "Advanced: behavior instructions" textarea
>     exposes `customInstructions` directly (owner-editable whether it came
>     from a preset or was typed from scratch).
>   - Presets are explicitly scoped to STYLE only — every preset's `overrides`
>     only ever touches `description`/`customInstructions`/the 6 numeric style
>     dials (asserted by test); `ModeratorPersona` has no moderation-authority,
>     identity-ownership, entitlement, or routing fields for a preset to reach
>     even if it tried. The "Founder-Like" preset's `customInstructions`
>     explicitly disclaims actually being the founder.
>   - New `presets.test.ts` (13 tests: catalog shape, exactly 10 surfaced + 8
>     more, distinct example voices, resolution, cross-preset distinctness on
>     formality/slang/emoji/verbosity, no two presets share identical dials,
>     materialization preserves untouched fields, custom-edit-not-overwritten,
>     style-only boundary). New `chatter-generate.test.ts` cases: a preset
>     flows into the real generation prompt, Kwan (Calm Professional)/Test
>     (Chill & Casual) stay isolated including under a shared transcript
>     dominated by the other's casual style, and an existing presetId-null
>     moderator is unaffected. 275 tests pass, `tsc --noEmit` clean, production
>     build clean, diff reviewed (only the intended files changed). Note: the
>     new preset-picker UI was verified via typecheck + build only, same as
>     v1.4.0's persona input — the Browser preview tool remained unavailable
>     this session (ongoing safety-classifier outage), so neither was live
>     click-tested.
>   **Persona preset picker made collapsible (v1.6.1).** User feedback after
>   live use: the 10-card grid rendered open by default inside every
>   moderator's row was "way too cramped," especially with multiple moderators
>   on screen. `PersonaPresetPicker` now defaults CLOSED — a single header
>   button shows "Persona preset — [current preset name]" (or "a quick
>   starting point" when unset/custom) with a rotating chevron, matching the
>   existing expand/collapse pattern used elsewhere in `AdminTabs.tsx`. The
>   card grid, "More presets"/"Custom" controls, and per-card example-voice
>   preview only render when expanded. No change to preset data/materialization
>   logic — purely a layout/visibility change. 324 tests pass (unaffected,
>   no logic touched), `tsc --noEmit` clean, build clean. Note: verified via
>   typecheck + build only, same limitation as v1.5.0/v1.4.0 — the Browser
>   preview tool remained unavailable this session.
>   **Same-sender "already handled" false suppression — IMPLEMENTED (v1.5.1).**
>   Live bug, found by checking the live Telegram chat immediately after v1.5.0
>   deployed: "anyone here?" sent 16 seconds after the SAME person's own
>   unanswered "yo! what's up" was silenced with `decision=SILENCE
>   reason=already_handled`, even though nothing had actually been handled — the
>   prior message just happened to also be from a human (K asking themselves
>   twice, not a different member engaging). Diagnosed via `moderator_activity_log`
>   the same way as the v1.3.1 staleness bug — confirmed via the actual
>   decision/reason before touching classification code, same workflow now
>   established for any "the bot didn't respond" report.
>   - Root cause: `recentlyRespondedByHuman` in `community-runtime.ts` only
>     checked the prior message's SENDER TYPE ("was it human"), never WHO
>     specifically — so two consecutive messages from the same person (neither
>     of which got any reply) incorrectly read as "a human already responded to
>     this room."
>   - Fix: new exported `humanRecentlyResponded(priorMessage, currentSenderPlatformId,
>     now)` (pure, alongside `isRecentMessage`) requires the prior human message
>     to be both RECENT (existing v1.3.1 guard) AND from a DIFFERENT platform
>     user id than the current message's sender. `loadRecentContext` now also
>     selects `sender_platform_id` (already written on every insert since
>     migration 0047, just not previously read back), threaded onto
>     `ChatterContextMessage` as `senderPlatformId`.
>   - `recentlyAnsweredByModerator` is unaffected (a moderator reply always
>     counts as genuine engagement regardless of who asks next).
>   - New tests in `community-runtime.test.ts`: the exact live repro (same
>     person, 16s apart → not "responded"), a different person's recent message
>     correctly counting as responded, a moderator's prior message never
>     routing through this human-only check, and the existing staleness
>     boundary (95 minutes, different person) still correctly excluded. 280
>     tests pass.
>   **Short questions were being swallowed as trivial filler — IMPLEMENTED
>   (v1.5.2).** Live bug, caught testing the v1.5.1 fix in the live chat: right
>   after Test replied to "anyone here?", asking "who else?" got silenced with
>   `reason=already_handled_recent_reply` — as if it were throwaway filler, not
>   a real question. Root cause: `isTrivial()`'s word-count/char-length check
>   (≤2 words, ≤16 chars) doesn't know or care about question-ness — it even
>   **strips the trailing `?`** the same as `!`/`.` when computing the char
>   length — so a genuinely short question like "who else?" or "is this
>   perfect?" (which also independently matches `isPositiveClosing` via
>   "perfect") was classified `TRIVIAL` before `classifyMessageKind` ever
>   reached the `QUESTION` check. `isAcknowledgementOnly` already had its own
>   internal "ends with `?`" guard for this exact reason, but `isTrivial`/
>   `CLOSING_ACK_RE`/`isPositiveClosing` didn't share it.
>   - Fix: `classifyMessageKind` now computes `looksLikeQuestion = trimmed.endsWith("?")`
>   once and skips the ENTIRE trivial-check group when true, going straight to
>   `QUESTION` — no matter how short the message is. `CLOSING_ACK_RE` was
>   already naturally immune (its anchor only allows trailing `.`/`!`), but the
>   guard now covers all four checks in one obvious place instead of relying on
>   each function to remember to exclude `?` individually.
>   - New tests (`chatter-coordinator.test.ts`): the exact live repro ("who
>   else?" → `ANSWER`, not silenced), a short question with zero other signal
>   still answering, `isPositiveClosing`'s "is this perfect?" blind spot fixed,
>   and a short acknowledgement-shaped question ("makes sense?") correctly
>   routing to `ANSWER` instead of `TRIVIAL`. 284 tests pass, zero regressions
>   (confirmed no existing test relies on a `?`-terminated message resolving to
>   `TRIVIAL`).
>   **Intent-over-length made architectural, not a patch — IMPLEMENTED
>   (v1.6.0).** The v1.5.2 fix only guarded the "ends with `?`" case. Live-caught
>   follow-up: `"who else"` (no `?`) was STILL swallowed as `TRIVIAL`, because
>   `isTrivial()`'s raw word-count/char-count check ran *before*
>   `isLikelyQuestion()` ever got a turn for anything not ending in `?` — the
>   v1.5.2 guard only ever checked the punctuation, never actually reordered
>   the two checks. Direct instruction from the user: fix this at the
>   architecture level, not with another special case.
>   - **`isTrivial()` deleted entirely** (not patched, not scoped down — removed).
>   Every "trivial control" it existed to catch (`"lol"`, `"nice"`, `"cool"`,
>   `"okay"`, `"got it"`, `"thanks"`, `"fair enough"`) was verified to already be
>   semantically covered by `isAcknowledgementOnly`/`CLOSING_ACK_RE` without it.
>   - **`classifyMessageKind` reordered**: `EMPTY/TOO_SHORT → COMMUNITY_OPENER →
>   QUESTION (isLikelyQuestion) → TRIVIAL (CLOSING_ACK_RE / isPositiveClosing /
>   isAcknowledgementOnly) → SUBSTANTIVE`. Question/request intent is now
>   checked structurally before any trivial classification exists to swallow
>   it — this is a property of the ORDER, not a per-message exception.
>   - **`isLikelyQuestion()` extended** to catch headless questions with no `?`
>   at all: added `which`/`anyone`/`anybody`/`someone` to the leading-word
>   check, so `"who else"`, `"why though"`, `"anyone else"` etc. are recognized
>   on their own terms — not inferred from missing punctuation.
>   - **Regression from the deletion, caught before shipping**: `RESOLVED_ACK_RE`
>   phrases (`"fixed"`, `"solved"`, `"nvm"`, `"figured it out"`) used to reach
>   the `TRIVIAL` action branch only because the old `isTrivial()` swallowed
>   them by word count; removing it made `"fixed now"` fall through to
>   `SUBSTANTIVE` since none of those words are in `isAcknowledgementOnly`'s
>   `ACK_TOKENS` vocabulary. Fixed by having `isAcknowledgementOnly` also treat
>   a `RESOLVED_ACK_RE` match as a signal (reusing the existing regex rather
>   than duplicating its vocabulary into `ACK_TOKENS`, where words like
>   `"fixed"`/`"working"` would risk misclassifying unrelated substantive
>   sentences).
>   - New tests (`chatter-coordinator.test.ts`, +46): 12 punctuated short
>   questions, 5 headless/unpunctuated short questions, directed `"kwan?"`/
>   `"test?"` resolving to `ANSWER` (not `TRIVIAL`/`SHORT_ACK`), 7 trivial
>   controls, 4 long-acknowledgement controls, 4 acknowledgement+question cases,
>   3 acknowledgement+substantive-continuation cases, and explicit
>   action-selection checks (`"who else?"` never `SILENCE`/`REACT`-only,
>   `"prettyaccurate too. lol"` never `CASUAL_CHAT`/`ANSWER`). 324 tests pass
>   (up from 284).
>   **(B) IMPLEMENTED (v1.7.0) — 20/day trial reactive quota.** 20
>   successfully-executed reactive conversational text responses
>   (`CASUAL_CHAT`/`ANSWER`/`SHORT_ACK`) per community per local community day,
>   trial entitlement only — a maximum, never a target; silence stays a
>   first-class valid outcome regardless. Paid tiers are unaffected (spec §2 —
>   out of scope for this patch).
>   - New migration `0050_reactive_quota.sql` — `community_reactive_quota`
>     (panel_id, community_id, quota_day, reactive_count; PK on
>     (community_id, quota_day), service-role only) + atomic SQL RPC
>     `increment_community_reactive_quota` (single upsert-on-conflict
>     statement, avoids a read-then-write race between concurrent webhook
>     deliveries). **Run migration 0050.**
>   - "Local community day" is a UTC calendar date for now — no per-community
>     timezone field exists anywhere in the schema (the spec's pointer to
>     "existing proactive-quota timezone infrastructure" doesn't actually
>     exist yet either; Proactive Mode was never built beyond reserved
>     `deployment_state` columns). Revisit once real per-community timezone
>     configuration exists.
>   - `plan.ts`: new `TRIAL_REACTIVE_DAILY_LIMIT = 20`, alongside the existing
>     (still-unenforced) `TRIAL_PROACTIVE_DAILY_LIMIT = 2`.
>   - `community-runtime.ts`: `reactiveQuotaDay(now)` (pure),
>     `hasReactiveQuotaRemaining` (plain read, called BEFORE any AI generation
>     is attempted — spec §17, so an exhausted trial never pays for a wasted
>     Sonnet call), `recordReactiveQuotaUse` (calls the atomic RPC, called
>     ONLY after a text response actually sends successfully — spec §7, never
>     for a failed send, declined generation, or a `SILENCE`/`REACT`, neither
>     of which reaches that code path at all). `handleHumanMessage` gained an
>     `isTrialEntitlement` parameter (computed once in the webhook dispatcher
>     via `moderatorEntitlementSource(settings) === "trial"`); the gate sits
>     right after the `REACT` branch, so `SHORT_ACK`/`CASUAL_CHAT`/`ANSWER`
>     share one check (all three are genuine "reactive conversational text
>     responses" per spec §3, none are in §4's explicit non-counting list) —
>     `REACT`/`SILENCE` above it are structurally unaffected.
>   - Judgment calls made explicit for review: (1) `SHORT_ACK` counts toward
>     and is gated by the quota same as `CASUAL_CHAT`/`ANSWER`, even though
>     it's deterministic/zero-AI-cost — it's still a genuine reactive text
>     send per the spec's own counting definition, and excluding it would let
>     a trial bot talk unboundedly via canned acknowledgements once real
>     replies are exhausted; (2) UTC-day bucketing instead of inventing
>     timezone infrastructure that doesn't exist elsewhere in the codebase.
>   - New tests (`community-runtime.test.ts`, +6): `reactiveQuotaDay`
>     UTC-formatting, quota-remaining true with no prior usage / under limit,
>     exhausted exactly at the limit and over it (race overshoot), and the
>     RPC call shape (`recordReactiveQuotaUse` sends the right scoping
>     params). 330 tests pass.
>   **Still not covered by (A):** the quota-aware/business-knowledge-aware signals
>   from §11 that depend on (B) or Phase 4.N; durable per-moderator memory (there is
>   no durable moderator-memory system at all yet — Phase 4.N remains NOTED/not
>   built — so there's nothing to isolate until that exists).
> - **(B) Trial reactive quota = 20/day — DONE (v1.7.0, see release note above).**
>   Successful sends only, per community per local community day, checked before AI
>   generation — separate from the existing 2/day proactive quota; moderation
>   enforcement never consumes or is blocked by it.
> - **Task-based model routing for chatter generation — DONE (v1.9.0).** Virtual
>   Moderator task-based model routing: CASUAL_CHAT now uses DeepSeek V4 Flash in
>   non-thinking mode; SILENCE/REACT/SHORT_ACK remain zero-call; substantive Project
>   Knowledge/Q&A ANSWER generation remains Claude Sonnet 5 at medium effort. Persona
>   configuration is provider-independent and remains authoritative across both
>   routes. Flash is the intended long-term chatter model pending live quality
>   validation; V4 Pro is the explicit next candidate if Flash quality is
>   insufficient.
>   - New `resolveChatterRoute(action)` (`src/lib/moderator/chatter-generate.ts`,
>     exported via `__testables`) is the SOLE provider/model decision point for
>     chatter generation — keyed strictly on `selectChatterAction()`'s own
>     `action.type` (never message text/keywords, never touched/bypassed). ANSWER
>     calls the existing `getInnvilModelConfig()` (Sonnet 5, medium, hard-enforced,
>     throws rather than downgrading — unchanged). CASUAL_CHAT calls new
>     `deepseekChatterProvider()` (`src/lib/ai/client.ts`, mirrors
>     `aiprimetechProvider()`'s shape) which reads `DEEPSEEK_API_KEY`/
>     `DEEPSEEK_BASE_URL`/`DEEPSEEK_CHATTER_MODEL` (default `deepseek-v4-flash`) and
>     returns an `aiComplete` `providerOverride` — this bypasses the primary/
>     `AI_FALLBACK_*` Sonnet-resolution path entirely, so there is no code path from
>     CASUAL_CHAT to Sonnet at all. When DeepSeek is unconfigured or the call fails,
>     `generateChatterReply` returns a generation failure (logged
>     `GENERATION_FAILED`, same handling as any other failed generation) — it never
>     escalates to Sonnet automatically; switching Flash→Pro later is a
>     `DEEPSEEK_CHATTER_MODEL` env change only, no code change.
>   - CASUAL_CHAT gets a low `maxTokens` (150, vs ANSWER's 1024) matching its own
>     existing prompt rule (<20 words) — short natural chatter, never an
>     assistant-style essay. Prompt construction (`buildSystemPrompt`,
>     `personaIdentityLine`, `personaStyle`, `buildContextLines`, `SHARED_RULES`) is
>     completely unchanged and provider-agnostic — the exact same persona/identity/
>     history content is sent regardless of which provider ends up running it; only
>     `model`/`providerOverride`/`maxTokens` differ per action.
>   - Existing per-call `[ai-usage]` logging (`src/lib/ai/client.ts`) already covers
>     both routes (model, effort, disableThinking, token counts) via the
>     `automation` tag (`NATURAL_CHATTER_CASUAL` / `NATURAL_CHATTER_ANSWER`) — no new
>     telemetry pipeline needed for a first pass at per-customer chatter-volume
>     accounting.
>   - New tests: `src/lib/ai/client.test.ts` (+3 — `deepseekChatterProvider` null
>     when unconfigured/never reuses `AI_API_KEY`, default model/base-url, override
>     config) and `src/lib/moderator/chatter-generate.test.ts` (+8 — ANSWER always
>     Sonnet even when DeepSeek is configured, CASUAL_CHAT always DeepSeek Flash
>     non-thinking, no-silent-Sonnet-fallback on missing DeepSeek key, Flash→Pro
>     config-only proof, low-vs-generous token caps, prompt content identical
>     regardless of DeepSeek configuration, two-moderator persona isolation holds
>     for the DeepSeek-routed action). 378 tests pass, `tsc --noEmit` clean,
>     production build clean.
>   - **Run no migration** (env-only change). **Set `DEEPSEEK_API_KEY`** before this
>     takes effect — until then CASUAL_CHAT generation fails explicitly rather than
>     running (no silent no-op, no silent Sonnet spend).
>   - **Correction (v1.9.1):** DeepSeek V4 defaults thinking to ENABLED — the model
>     id (`deepseek-v4-flash`) alone was not actually sufficient to disable it, and
>     `openaiComplete()` (the OpenAI-compatible request path DeepSeek shares) never
>     sent any reasoning-control field at all until now. It now sends the explicit
>     `thinking: { type: "disabled" }` request field whenever `disableThinking` is
>     set — mirroring `anthropicComplete()`'s equivalent field, and kept entirely in
>     the provider/client layer (`src/lib/ai/client.ts`) rather than moderator code
>     constructing a provider-specific request shape. New tests assert the actual
>     outgoing request body (via a `fetch` spy), not just the resolved route. 380
>     tests pass, `tsc --noEmit` clean, production build clean.
>   **Two more live bugs fixed the same session (v1.9.2):**
>   - **REACT was silently failing with zero observability.** `executeAction()`'s
>     REACT branch (`community-runtime.ts`) called Telegram's `setMessageReaction`
>     but discarded the result — a rejection (bot lacking rights, or the chat's own
>     restricted allowed-reactions set) looked IDENTICAL to a successful react from
>     every log/activity angle, since the caller unconditionally logged decision
>     `"REACT"` regardless of whether Telegram actually accepted it. `executeAction`
>     now returns `{sentMessageId, ok, error}`; a failed REACT logs `REACT_FAILED`
>     (with the Telegram error) and `console.error`s instead of silently no-op'ing.
>   - **Emoji had a large dead zone.** `personaStyle()` only gave the model an emoji
>     instruction below 20 or above 60 — nothing in 20-60 got ANY signal, and the
>     default persona (`emojiFrequency: 30`) plus 15 of the 18 presets land in
>     exactly that gap, so a terse-chatter-styled model just defaulted to none.
>     Replaced with four continuous bands (<15 avoid / <40 rare / <65 moderate /
>     else welcome) covering the whole 0-100 range with no gap.
>     `shortAckText()` had the same shape of bug (emoji only ever possible above
>     emojiFrequency 60, at a flat 40% roll) — now scales continuously
>     (`chance = emojiFrequency/100 * 0.5`, gated only near-zero) so the dial
>     actually has graduated effect instead of a hard cliff almost nothing clears.
>   - New tests: emoji-instruction coverage across the full range (no gap),
>     default-persona regression test (the exact live bug), band-escalation proof,
>     `shortAckText` continuous-probability tests (seeded random). 386 tests pass,
>     `tsc --noEmit` clean, production build clean. No migration.
>   **Third live bug fixed the same session (v1.9.3): plain-name targeting was too
>   aggressive — referential mentions were treated as direct address.**
>   - Live repro: after Test said "kwan's around too, just replied a sec ago", the
>     human asked **"why are you responding for kwan though?"** — clearly addressed
>     to Test ("you" + Test was the immediately-preceding speaker), with "kwan"
>     merely referenced, not addressed. `resolveDirectedModerator` matched Kwan
>     anyway (the v1.1.99 plain-name fix only checked whether the name token
>     appeared ANYWHERE, never distinguishing vocative "hey kwan"/"are you kwan"
>     from referential "for kwan"/"did test answer for kwan"), so Kwan was forced
>     to answer a question actually about Test's own prior action — and, with no
>     real basis to answer from, fabricated an entirely unstated accusation
>     ("not me impersonating anyone — no ventriloquism required"), reading as a
>     generic AI customer-support deflection rather than the configured persona.
>   - **Fix 1 (`chatter-coordinator.ts`):** new `isVocativeOccurrence`/
>     `trailingCommaVocative` — a name mention only counts as directed address when
>     it's the sole message content, the first word, immediately preceded by a
>     vocative cue (hey/hi/yo/hello/**you**), or has a comma directly before it at
>     the end ("tell me, kwan"). A REFERENTIAL preceding word (for/about/to/did/
>     does/is/answered/think/said/…) always overrides to non-directed, even at an
>     edge position ("...for Kwan?"). Once the false match is removed, the
>     *existing* `wasLastSpeaker` continuity mechanism correctly picks Test (no new
>     "who's the addressee via 'you'" system needed — continuity already covers it
>     once the interfering false positive is gone).
>   - **Fix 2 (`chatter-generate.ts` `SHARED_RULES`):** new invariant — never invent
>     a stronger accusation/emotion/criticism/motive/premise than what's literally
>     in the message or grounded conversation history; a plain question like "why
>     are you responding for X though?" is NOT an accusation of impersonation and
>     doesn't call for a defensive rebuttal.
>   - **Fix 3 (hardcoded, per explicit request):** new `SHARED_RULES` entry banning
>     sliding into generic AI customer-support voice — applies to BOTH CASUAL_CHAT
>     and ANSWER (not just casual chatter's own framing), explicitly names the
>     failure pattern (manufactured clever comebacks/defensive rebuttals just to
>     fill space) as exactly what to avoid.
>   - New tests: exact live-message repro (`resolveDirectedModerator` → null),
>     referential-vs-vocative pairs from every example given, no-regression checks
>     for every existing vocative case (incl. the v1.1.99 "what persona are you
>     kwan?" fix and the comma-tag "tell me, kwan" case), an end-to-end
>     `selectChatterAction` test proving Test is picked via continuity, and prompt
>     assertions for both new SHARED_RULES entries. 394 tests pass, `tsc --noEmit`
>     clean, production build clean. No migration.
>   **Deferred, scoped separately (not built this pass):** the user's proposed
>   "primary + optional secondary responder" model (at most one PRIMARY response
>   per message as today, with a narrowly-gated OPTIONAL secondary chime-in from a
>   directly-relevant other moderator) — a genuinely larger architectural change to
>   `ChatterAction`/dispatch/tests than the routing bug above; needs its own scoped
>   design pass before implementation.
>   **Fourth live bug fixed the same session (v1.9.4): conversation-opener detection
>   was lexical, not semantic.** `isCommunityOpener()` required a fixed greeting word
>   (gm/good morning/hey/hi/hello/...) AND a fixed room-address word (everyone/
>   anyone/guys/all/folks) together — a bare re-entry greeting like **"hey there
>   again"** (no room-address noun) matched neither, fell through to the generic
>   SUBSTANTIVE rule (which only engages when directed-at-bot or mid an active
>   exchange), and silenced as `low_social_priority` even though it's plainly a bid
>   to re-enter the conversation.
>   - Replaced with **`isConversationalOpener(text)`** (exported from
>     `chatter-coordinator.ts`, mirrors `resolveDirectedModerator`'s export-for-
>     testing pattern) — a semantic classifier combining FOUR signals (presence-check
>     `COMMUNITY_CHECK_IN_RE`, re-entry `RE_ENTRY_RE` — "again"/"I'm back"/"back
>     again"/"back here", broadened greeting/salutation `GREETING_RE` — added
>     yo/sup/what's up, and the existing room-address/check-in patterns) via OR, but
>     bounded by **hard exclusions checked first**: a real question (`isLikelyQuestion`),
>     a request (`REQUEST_MARKER_RE`), a problem report (`hasProblemWord`/
>     `NOT_WORKING_RE`), or an acknowledgement/closure (`CLOSING_ACK_RE`/
>     `isPositiveClosing`/`isAcknowledgementOnly`) always wins over a greeting word —
>     "hey, why is my order stuck?" stays a QUESTION, "hey thanks, that fixed it"
>     stays a CLOSURE, "it broke again" stays a problem report (not fooled by "again"
>     alone). A presence-check question ("anyone here?") is carved out from the
>     question-exclusion, since it's opener territory despite the "?". No arbitrary
>     length gate anywhere in the function (word/char count is never the deciding
>     factor, matching the codebase's existing TRIVIAL-classification philosophy).
>     Deliberately did NOT add a standalone "message contains a room-address noun"
>     fallback — "I already told everyone" contains "everyone" but is a plain
>     statement, not a bid to interact (same referential-vs-address distinction as
>     the (A) plain-name-targeting fix above).
>   - Room activity/quietness/who-spoke-last stays entirely OUT of the opener
>     DEFINITION (per explicit instruction) — `isConversationalOpener` takes no
>     time/context argument at all; `selectChatterAction`'s existing
>     `COMMUNITY_OPENER` branch (`recentlyAnsweredByModerator`/
>     `recentlyRespondedByHuman` → `already_handled`) is completely unchanged and is
>     what decides whether a recognized opener actually gets a reply.
>   - **One pre-existing test's expectation changed** (not preserved as a
>     regression-guard, since it directly contradicted the new requirement): a bare
>     `"gm"` with no room-address word previously asserted SILENCE; it now asserts
>     `CASUAL_CHAT` + `community_opener`, matching the explicit requirement that bare
>     "hi"/"hello"/"morning" count as openers.
>   - New tests (chatter-coordinator.test.ts, +9): clear openers/re-entry generalize
>     across shapes never literally quoted together in one regex (incl. casing/
>     punctuation variants), room-addressed openers, opener-cue-plus-substantive-
>     intent correctly yields to question/request, ordinary non-opener statements,
>     acknowledgement-after-greeting stays a closure, no length gate (long AND
>     one-word openers), a re-entry word near a problem word stays a real report, the
>     same opener text classifies identically regardless of room busyness (only the
>     downstream ACTION differs), and an immediate same-text repeat right after a
>     moderator reply doesn't double-reply. 403 tests pass, `tsc --noEmit` clean,
>     production build clean. No migration.
>   **Architecture correction (v1.9.5), same day:** `isConversationalOpener` initially
>   duplicated question/request/problem/acknowledgement detection as internal "hard
>   exclusions", re-implementing logic that already existed for other purposes. Per
>   explicit feedback, restructured so **`isConversationalOpener` is now a narrow,
>   purely POSITIVE signal detector** (`COMMUNITY_CHECK_IN_RE || RE_ENTRY_RE ||
>   GREETING_RE`, nothing else) — it correctly returns `true` for "hey thanks, that
>   fixed it" (it DOES contain a greeting cue) and does not itself decide final
>   classification. **All precedence now lives in `classifyMessageKind`'s ordering**,
>   reusing the SAME canonical helpers already used elsewhere in the file
>   (`isLikelyQuestion`, `hasProblemWord`/`NOT_WORKING_RE`, the existing
>   `CLOSING_ACK_RE`/`isPositiveClosing`/`isAcknowledgementOnly` trivial check) rather
>   than new duplicated regex logic: presence-check (`COMMUNITY_CHECK_IN_RE`, a more
>   specific signal than generic question-detection) → real question → problem report
>   → acknowledgement/closure → opener signal → substantive, in that order. Tests
>   updated to match: opener-vs-stronger-classification precedence is now proven via
>   the real end-to-end pipeline (`single()`/`selectChatterAction`), not by asking the
>   narrowed function to know about those other categories; added a dedicated
>   "generalizes to UNSEEN combinations of the same signal types" test (fresh
>   sentence constructions never quoted in the implementation, e.g. "sup, back again
>   folks", "it's pretty quiet in here today") to concretely demonstrate this isn't
>   an ever-growing fixed-phrase list. 404 tests pass, `tsc --noEmit` clean,
>   production build clean. No migration.
>   **Fifth live bug fixed the same session (v1.9.6): a MISPLACED "?" broke question
>   detection entirely.** Live repro: right after Test replied "hey, what's up?", the
>   human sent **"?just testing things up, what's up"** (a stray "?" typed at the
>   START — a common mobile-keyboard/autocorrect typo) and got no response.
>   `isLikelyQuestion()` only checked `t.endsWith("?")` (false here — the real "?" is
>   at the start, not the end) and a leading-word regex anchored at the very first
>   characters (also false — the message starts with `"?just"`, not a question word).
>   With question-detection failing, the message fell through to
>   `isConversationalOpener`'s `"what's up"` greeting match (COMMUNITY_OPENER), whose
>   `already_handled` suppression fired (a moderator had JUST replied) — silenced,
>   indistinguishable from being ignored outright.
>   - Fix: `isLikelyQuestion()` now treats a `"?"` ANYWHERE in the message as question
>     intent (`t.includes("?")`), not only as the very last character — a misplaced
>     question mark is still the human typing a question, regardless of position.
>     Checked before `isConversationalOpener` in `classifyMessageKind`'s existing
>     ordering, so this class of message now correctly resolves to QUESTION → ANSWER,
>     which (unlike COMMUNITY_OPENER) has no "already answered" suppression at all.
>   - New tests: exact live repro (leading `"?"` + a moderator having just replied →
>     ANSWER, not SILENCE), a `"?"` embedded mid-message also signals question intent,
>     and a control proving the fix isn't "treat everything as a question" (a message
>     with no `"?"` anywhere and no leading question word still correctly stays
>     non-QUESTION). 407 tests pass, `tsc --noEmit` clean, production build clean. No
>     migration.
>   **Sixth + seventh live issues fixed the same session (v1.9.7): mid-sentence
>   vocative targeting gap, and a persona-dial dead zone extended beyond emoji.**
>   - **Targeting — corrected diagnosis, not a slang dictionary.** Live repro:
>     `"okay, test, waddup?"` (right after Test's own prior reply) got no response.
>     Investigation showed `isLikelyQuestion` already correctly fired on the trailing
>     `"?"` (orthography-agnostic — that axis was never broken). The actual gap:
>     **"test" sits in the middle of the sentence, flanked by commas on both sides** —
>     a standard written-English vocative pattern — but `resolveDirectedModerator`
>     only recognized a name as directly-addressed when it was the sole message, the
>     first word, preceded by hey/hi/yo/hello/you, or comma-preceded **at the very
>     end**. A comma-flanked name in the middle was never covered, so "test" never
>     resolved as addressee, selection fell to `wasLastSpeaker` continuity (which
>     picked Kwan, who'd spoken most recently), and Kwan — correctly recognizing it
>     couldn't sensibly answer a question naming someone else — declined outright
>     (`MODEL_DECLINED`). **This was a targeting/address-resolution bug, not a
>     slang-comprehension one** — explicitly did not build a slang dictionary or a new
>     normalization pipeline; the fix is purely positional/structural
>     (`commaPrecededVocative`, generalized from the prior end-anchored-only version
>     to match a comma immediately before a name anywhere in the message), which
>     generalizes to any informal wording around it without recognizing the words at
>     all. Zero new model/API calls.
>   - **Persona dead zone extended beyond emoji.** Separately confirmed live: a
>     moderator saved with the "Witty Mod" preset (`formality:30, slang:35,
>     chattiness:40, teasing:55`) read as generically professional despite the
>     preset. Root cause: `personaStyle()`'s formality/slang/chattiness/teasing
>     thresholds (`>70`/`<30`, `>60`/`<20`, etc.) had the exact same dead-zone gap
>     already fixed for `emojiFrequency` in v1.9.2 — Witty Mod's dials land in the
>     unfixed gap of every one of those four dials simultaneously, so the model got
>     zero explicit style instruction for any of them and defaulted to a neutral
>     voice. Closed the same way as emoji: continuous bands with a real middle-range
>     instruction for each dial, preserving the existing high/low wording exactly
>     (tests assert on those exact strings).
>   - New tests (chatter-coordinator.test.ts, +10; chatter-generate.test.ts, +6):
>     exact live repro for both bugs, comma-flanked-vocative generalization with fresh
>     informal wording never quoted in the implementation, referential-mention
>     regression guard (no comma before the name still correctly excluded), required
>     categories (casual question/request without canonical grammar, greeting +
>     substantive-ask precedence, informal closure via existing ack-token vocabulary,
>     ambiguous slang staying silent rather than inventing a specific interpretation),
>     Witty Mod's exact live dial values producing real instructions instead of
>     silence, and formality/slang/chattiness escalating across the full range. 420
>     tests pass, `tsc --noEmit` clean, production build clean. No migration.
>
>   **Product invariant (added per explicit instruction):** Virtual Moderators
>   interpret contemporary informal chat by communicative intent rather than
>   canonical spelling. Slang, phonetic spelling, abbreviations, punctuation/casing
>   noise, and other casual chat forms must not require an ever-growing vocabulary
>   dictionary. Input understanding is independent of the moderator's output persona:
>   every moderator understands the same user meaning, while responding according to
>   its own saved Innvil persona.
>   **Architecture correction (v1.9.8), same day: persona dial-bands were treated as
>   the identity source — restructured to a clear hierarchy.** Per explicit
>   feedback, v1.9.7's dead-zone fix was correct to close (moderate dial values must
>   never mean zero style guidance) but wrong to let `personaStyle()` — the numeric-
>   dial mechanics — read as the sole source of "is this moderator Witty vs
>   Professional." **Persona identity now has an explicit, stated hierarchy: (1) the
>   saved persona `description` (already authoritative via `personaIdentityLine`,
>   unchanged) → (2) `customInstructions` → (3) numeric dials, which only REFINE
>   intensity/mechanics within that identity, never define it.**
>   - `customInstructions` was pulled OUT of `personaStyle()`'s dial-mechanics array
>     (where it sat undifferentiated among "use emoji occasionally"-type bullets) into
>     its own `personaCustomInstructionsLine()`, positioned right after the persona
>     description and explicitly framed as "as authoritative as your persona
>     description above."
>   - New `STYLE_HIERARCHY_PREFACE`, inserted immediately before the dial-mechanics
>     block in `buildSystemPrompt`: *"The following are secondary style/intensity
>     notes — they refine HOW you express the persona and behavioral guidance above,
>     they do NOT redefine who you are. If they ever seem to pull in a different
>     direction than your configured persona/description, the persona wins."* Makes
>     the hierarchy an explicit instruction, not something inferred from ordering.
>   - **Dead-zone fix completed properly** (v1.9.7 left `teasing`/`humor` with only a
>     low-end band, no middle) and **every band reworded to soft/probabilistic
>     language** ("when it fits", "don't force it", "acceptable when context
>     supports it") — never a rigid rule mandating a visible gimmick every message.
>   - **Preset data check (per explicit request): already fine.** Every one of the 18
>     presets in `presets.ts` already carries a distinct, substantive `description` +
>     detailed `customInstructions` (e.g. Witty Mod: *"playful and clever, with dry
>     humor and the occasional joke — but still genuinely useful"*) — none are generic
>     or numbers-only. No preset-data rewrite was needed.
>   - New tests: two presets with genuinely moderate dial values (Witty Mod / Calm
>     Professional) proving materially different persona identity survives — each
>     prompt contains its OWN description + customInstructions verbatim, cross-
>     checked absent from the other's prompt, plus the hierarchy-preface text itself
>     and confirmation that dials still add concrete mechanics (refine, not replace).
>     Existing dead-zone tests updated for the reworded (softer) band text. 421 tests
>     pass, `tsc --noEmit` clean, production build clean. No migration.
>   **Eighth live bug fixed the same session (v1.9.9): formality=30 still fell into
>   the neutral "either way is fine" band, not lowercase.** Live repro: Kwan (Witty
>   Mod, `formality:30`) kept capitalizing sentence starts after v1.9.8. Root cause:
>   the "always lowercase" threshold was `< 30` — Kwan's exact value (30) fell one
>   point short, landing in the neutral middle band, which explicitly permits either
>   style. Neither Witty Mod's `description` nor its `customInstructions` say
>   anything about capitalization, so this was purely a dial-threshold call, not a
>   hierarchy issue. Raised the lowercase cutoff to `< 40` — chosen so every preset
>   the user characterized as "professional or semi-formal" (Founder-Like 45,
>   Supportive Guide 40, Diplomatic Mediator 55, Strict Moderator/Polite Minimalist
>   60, Technical Expert 65, Calm Professional 75) stays in the neutral/strict bands,
>   while Witty Mod and every other casual-leaning preset (10–35) now reliably skews
>   lowercase. Neutral band renamed "Semi-formal" and reworded to make the
>   professional-vs-casual distinction explicit in the prompt text itself. New
>   regression test asserts Witty Mod's formality specifically resolves to the
>   lowercase band, not the neutral one. 422 tests pass, `tsc --noEmit` clean,
>   production build clean. No migration.
>   **Ninth live issue, resolved with an explicit product decision (v1.9.10): narrow
>   model-assisted fallback for phonetic slang greetings.** Live repro: `"waddup
>   guys"` (no `"?"`, no directed name) stayed silenced (`low_social_priority`).
>   Investigated whether this generalizes deterministically like the earlier "?"
>   and comma-vocative fixes did — it does NOT: "waddup" is a phonetic respelling of
>   "what's up" (th→d, dropped `'s`) with no punctuation/positional signal
>   connecting the two spellings, unlike a `"?"` anywhere or a comma before a name.
>   A hand-tuned regex for this phonetic family would just be the brittle lexical
>   patch already explicitly ruled out, in a different shape. **Reported this
>   honestly instead of shipping a disguised dictionary** — user chose to add a
>   narrow, opt-in model fallback (over accepting the deterministic limit).
>   - `selectChatterAction`/`classifyMessageKind` stay pure/synchronous/AI-free —
>     unchanged. The fallback lives entirely in `community-runtime.ts`'s
>     already-async dispatch, gated by new pure `isAmbientOpenerFallbackCandidate()`
>     (`chatter-coordinator.ts`): fires ONLY on the exact `"low_social_priority"`
>     SILENCE (ambient, non-directed, no continuity, nothing deterministic matched)
>     AND a short message (≤8 words) — the narrowest possible surface, not "every
>     silence."
>   - New `classifyAmbientGreeting(text)` (`chatter-generate.ts`) — a
>     **classification call, not generation**: one word out (`GREETING`/`OTHER`),
>     `maxTokens: 5`, routed through the existing `deepseekChatterProvider()` (same
>     cheap DeepSeek Flash path as CASUAL_CHAT, **never Sonnet**), via the same
>     `providerOverride` mechanism that structurally bypasses the Sonnet-resolution
>     path. On any failure (unconfigured key, network error, non-200) returns
>     `ok:false` and the caller keeps the original deterministic SILENCE — no
>     escalation to a more expensive provider, ever.
>   - New `resolveAmbientOpenerFallback()` (`chatter-coordinator.ts`) — called only
>     after the model confirms a greeting; mirrors `selectChatterAction`'s
>     `COMMUNITY_OPENER` branch exactly (same `already_handled` suppression, same
>     candidate selection), so this is a second-pass ENTRY into existing handling,
>     not a new/parallel action category.
>   - **Cost/volume estimate (per explicit requirement to quantify before
>     building):** gated to the `low_social_priority` residual bucket, which live
>     traffic showed at roughly 5–10% of incoming messages; the ≤8-word gate narrows
>     that further. Expect low-single-digit-percent of total messages to ever reach
>     this call — most real messages are already resolved by a question mark, a
>     directed name, a problem word, or an acknowledgement signal before reaching
>     this fallback at all. Existing `[ai-usage]` logging (tagged
>     `AMBIENT_GREETING_CLASSIFY`) already covers this call for cost auditing — no
>     new telemetry needed.
>   - New tests: `chatter-coordinator.test.ts` (+7 — exact live-bug repro, gate
>     fires only for `low_social_priority` not other silence reasons, never on a
>     non-SILENCE action, length-bounded, `already_handled` suppression preserved,
>     same downstream action shape as a real `COMMUNITY_OPENER`) and
>     `chatter-generate.test.ts` (+4, fetch-spy verified — routes to
>     `deepseek-v4-flash`/non-thinking/tiny `max_tokens`, `"OTHER"` classifies as
>     not-a-greeting, unconfigured DeepSeek makes **zero** network calls, a failed
>     call surfaces as `ok:false` without throwing). 433 tests pass, `tsc --noEmit`
>     clean, production build clean. **Run no migration** (reuses the existing
>     `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`/`DEEPSEEK_CHATTER_MODEL` env vars —
>     same credential, now used for two purposes: CASUAL_CHAT generation and this
>     narrow classification fallback).
>   **Tenth architecture correction, same session (v1.9.11): formality/capitalization
>   for a PRESET is now a binary semantic decision, never a numeric threshold.**
>   v1.9.9 raised the lowercase cutoff to `<40`, but that was still fundamentally
>   the wrong abstraction per explicit feedback — a probability BAND (30 means
>   maybe lowercase, 40 means neutral, 60 means capitalized) is not how a fixed
>   identity trait like "is this moderator formal" should work; it's why Witty
>   Mod's `formality:30` had already drifted across two different thresholds
>   (v1.9.8's `<30`, then v1.9.9's `<40`) without ever being a real product
>   decision about Witty Mod specifically.
>   - New `ModeratorPersona.formal: boolean | null` (`domain.ts`) — `true`/`false`
>     is a deterministic capitalization CONTRACT (conventional caps vs. casual
>     lowercase), never a tendency. `null` = no explicit decision was ever made (a
>     fully custom persona, or one saved before this field existed) — ONLY then
>     does `personaStyle()` fall back to the pre-existing numeric-`formality`
>     threshold logic (unchanged, still `>70`/`<40`/else), preserving custom-
>     persona behavior exactly as before.
>   - **Every one of the 18 presets in `presets.ts` now sets `formal` explicitly**,
>     read from each preset's own `description`/`customInstructions`/example
>     voice — an actual per-preset product decision, not a formula: `formal:true`
>     — Calm Professional, Direct & No-Nonsense, Technical Expert, Strict
>     Moderator, Diplomatic Mediator, Polite Minimalist (6). `formal:false` — the
>     remaining 12 (Friendly Community Mod, Chill & Casual, Witty Mod, Hype &
>     Energetic, Supportive Guide, Playful Meme Mod, Community Veteran, Dry
>     Humor, Big-Sibling Mod, Founder-Like, Web3 Native, Gaming Community Mod).
>     `ModeratorPersonaPreset.overrides` type widened to include `formal`.
>   - `personaStyle()` (`chatter-generate.ts`): `formal===true` → strict-caps
>     contract; `formal===false` → lowercase contract; `formal===null` → the
>     numeric-dial fallback band (only reachable for custom/legacy personas,
>     never for a preset-created one). No probability language anywhere in the
>     contract text ("skew", "usually", "may capitalize", "lowercase-leaning" —
>     all explicitly tested absent).
>   - New tests: `presets.test.ts` (+5 — every preset sets `formal` explicitly,
>     the full 18-preset semantic mapping asserted against the catalog directly
>     (not a computed range), Witty Mod's `formal:false` traced through
>     materialization, four named presets spot-checked, custom-persona default is
>     `null`) and `chatter-generate.test.ts` (+4 — `persona.formal` wins even when
>     it CONTRADICTS the numeric dial in both directions, `formal:true/false`
>     never produces the neutral fallback text, no probability language leaks
>     into the contract, `formal:null` still exercises the preserved numeric
>     fallback). 442 tests pass, `tsc --noEmit` clean, production build clean.
>     **Run no migration** (new persona field defaults to `null` via
>     `normalizeModeratorPersona`, so existing stored personas read back
>     unaffected until re-materialized from a preset).
>   **Eleventh live issue (v1.9.12): a Telegram webhook died at the platform's 30s
>   timeout with ZERO diagnostic trace — root cause found and the whole pipeline
>   hardened, opener classification untouched.** Live repro: "hey there again"
>   correctly classified `COMMUNITY_OPENER` (verified by calling the actual deployed
>   `isConversationalOpener`/`selectChatterAction` directly, not inferred from
>   source) — but produced no reply and zero `moderator_activity_log` rows,
>   even though the message itself was recorded in `community_messages`.
>   `vercel logs` showed the real cause: `Vercel Runtime Timeout Error: Task timed
>   out after 30 seconds` on the winning bot's webhook invocation (the losing
>   bot's simultaneous delivery exited cleanly via the existing claim-race
>   `!claimed` check — that part was never broken). A killed function never
>   reaches its own `logActivity` calls, which is why the DB showed nothing.
>   - **Actual root cause, found by inspection not guesswork:** `postJson()` in
>     `src/lib/ai/client.ts` created an `AbortController` with a 12s timer, wired
>     into `fetch()`'s `signal` — correctly. But the timer was cleared in a
>     `finally` block that ran as soon as `fetch()` ITSELF resolved, which only
>     means response HEADERS arrived, not that the body has been read.
>     `anthropicComplete()`/`openaiComplete()` then called `res.json()` **outside**
>     `postJson()`, completely outside the abort scope — a provider that sends
>     headers promptly but stalls mid-body could hang past the "12s" timeout
>     indefinitely, with no protection at all, right up to the platform's hard 30s
>     kill.
>   - **Fix:** `postJson()` now reads the full body (`res.text()`) INSIDE the same
>     function, under the SAME `AbortSignal` used for `fetch()`. Per the Fetch spec,
>     aborting that signal also aborts an in-progress body read tied to it, so the
>     timeout now genuinely bounds the whole request lifecycle (connect + headers +
>     body), not just the first phase. `anthropicComplete`/`openaiComplete` now
>     `JSON.parse()` the already-fully-read text instead of calling `res.json()`
>     unprotected. Verified with a `fetch` mock whose headers resolve instantly but
>     whose `.text()` never resolves until the abort signal fires — proven via
>     `node:test`'s fake timers (`t.mock.timers`), so the test proves the fix in
>     milliseconds, not by waiting out a real 12-second timer.
>   - **`telegram-client.ts`'s `telegramApiCall` had NO timeout at all** (plain
>     `fetch`, no `AbortController`) — not the primary suspect in this incident
>     (Telegram's API is normally fast), but hardened with the same pattern
>     (10s bound, body read inside the same abort scope) as defense in depth,
>     per explicit verification request.
>   - **Retries/fallback confirmed NOT stacking:** `aiComplete`'s primary→
>     `AI_FALLBACK_*` retry is structurally skipped entirely whenever
>     `providerOverride` is set (`if (opts.providerOverride) return
>     completeOnce(...)`, no wrapping) — confirmed by reading the code, not
>     assumed. No second model call follows the first for CASUAL_CHAT/DeepSeek.
>   - **Observability layer added, all in `community-runtime.ts`:** `GENERATION_STARTED`
>     is now written to `moderator_activity_log` **before** the model call —
>     specifically so a killed function still leaves a diagnostic DB trace even if
>     some future bug escapes the client-level fix above. New `GENERATION_TIMEOUT`
>     outcome (existing `GENERATION_FAILED`/`MODEL_DECLINED` unchanged) if the new
>     total-budget safety net (`raceWithTimeout`, `CHATTER_TOTAL_BUDGET_MS = 20s` —
>     `12s` model timeout < `20s` total budget < `30s` platform `maxDuration`,
>     leaving ~10s headroom for DB/logging/Telegram-send) ever fires — in practice
>     this should be redundant now that the client-level timeout is fixed, but
>     guarantees the function returns and logs rather than hanging regardless.
>     Same budget wrapper applied to the v1.9.10 `classifyAmbientGreeting` fallback
>     call (`AMBIENT_CLASSIFY_BUDGET_MS = 15s`).
>   - **Structured timing checkpoints** (`createRequestTimer`, tagged
>     `[chatter-timing]` in Vercel logs) at every stage from `webhook_received`
>     through `total_request_duration`: duplicate-update check, claim/dedup
>     (`claim_won`/`claim_lost_duplicate` — the two-bot race is expected/normal,
>     now distinguishable from a real failure), entitlement gate, deployment
>     lookup, context loading, coordinator selection, generation start/end,
>     Telegram send, activity logging. Each line logs both the delta since the
>     previous checkpoint (which stage was slow) and total elapsed (approaching
>     budget) — label + integrationId + timings only, never prompts/message
>     content/secrets.
>   - **DeepSeek routing re-verified, no changes needed:** confirmed via the
>     existing v1.9.0/v1.9.1 fetch-spy tests (still passing, untouched) that
>     CASUAL_CHAT sends `model: "deepseek-v4-flash"`, the configured
>     `DEEPSEEK_BASE_URL`, and `thinking: {type: "disabled"}` — no accidental
>     Sonnet fallback, wrong model, or wrong endpoint.
>   - **Claim-race semantics unchanged** (per explicit instruction — no correctness
>     bug found there): two bots receiving the same Telegram update is expected;
>     first to claim in `recordCommunityMessage` proceeds, the loser exits via the
>     pre-existing `!claimed` check. Only added trace logging around it.
>   - New tests: `client.test.ts` (+2 — stalled-body-after-fast-headers is aborted
>     within the timeout via fake timers; a fetch that never resolves headers at
>     all was already correctly handled, kept as a regression guard) and
>     `community-runtime.test.ts` (+8 — `raceWithTimeout`'s full contract:
>     resolves-before-budget wins, never-resolves is bounded not left hanging, a
>     stage far slower than budget still cuts off at the budget boundary, a
>     rejecting promise propagates as a rejection rather than being swallowed,
>     the timed-out branch structurally carries no provider/model info to
>     silently fall back through, plus `createRequestTimer`'s structured-log
>     shape and no-sensitive-content guarantee). 451 tests pass, `tsc --noEmit`
>     clean, production build clean. No migration (no schema change; new
>     activity-log decision VALUES only, same existing table/columns).
>   **Twelfth live issue (v1.9.13): Natural Chatter was turn-based — one moderator
>   answering consumed the human's message, so a second explicitly-addressed
>   moderator never got a chance to reply.** Live repro: "good, good. can you both
>   tell me about yourself?" — Kwan answered alone, even saying "test can speak for
>   themself though" (correctly declining to speak FOR Test), but nothing ever gave
>   Test an independent turn on that SAME message. Product invariant stated
>   explicitly by the user: human group conversation is not turn-based — one
>   moderator speaking does not consume the message; if a message genuinely
>   addresses multiple moderators, each relevant one may independently answer using
>   its own persona.
>   - **New pure detector in `chatter-coordinator.ts`: `resolveMultiTargetAddress(text,
>     moderators)`.** Two structural signals, OR'd — never a hardcoded phrase
>     dictionary: (1) `leadingNameListTargets()` — a name-list AT THE START of the
>     message joined by "and"/commas ("Kwan and Test, thoughts?", "Kwan, Test, what's
>     up") — the same positional rule that already makes a single name a vocative
>     (`isVocativeOccurrence`'s `idx===0` case), generalized to 2+ names; (2)
>     `PLURAL_ADDRESS_RE` — a real grammatical category, plurality of second-person
>     address ("you both", "you two", "both of you", "the two of you", "you guys",
>     "both mods/moderators") — when it matches, the target is EVERY currently active
>     moderator (there's no way to know a subset from a bare pronoun). Deliberately
>     does NOT try to detect plurality in "what are your roles?" — English's "you"/
>     "your" carry no singular/plural distinction, so inventing one there would be
>     exactly the "invent meaning beyond reasonable interpretation" failure class
>     already ruled out elsewhere in this file; documented as an honest limitation,
>     with a test proving it correctly resolves to no multi-target rather than a guess.
>     A referential mention ("why did test answer for kwan?") and a plain single
>     directed name ("kwan, what do you think?") both correctly stay single-target —
>     reuses the SAME referential-vs-vocative distinction already relied on by
>     `resolveDirectedModerator` (v1.9.3), not a new one.
>   - **`selectChatterAction()` itself is completely UNCHANGED** — the existing
>     single-primary selection (directed > continuity > quietest-longest, pacing,
>     every classifier/precedence rule from v1.9.0–1.9.12) is untouched and fully
>     backward compatible. Multi-target is a strictly ADDITIONAL layer, consulted only
>     from `community-runtime.ts` alongside the existing separate
>     `resolveDirectedModerator()` call (`chatter-coordinator.ts` has no access to
>     moderator names inside `selectChatterAction`, only `deploymentId`s) — and only
>     ever consulted when the PRIMARY action is already `CASUAL_CHAT`/`ANSWER` (never
>     for `REACT`/`SHORT_ACK`/`SILENCE`, which already returned before this point).
>   - **Bounded fan-out: `MAX_ADDITIONAL_RESPONDERS = 2`** (3 responders total,
>     including the primary) — explicit, socially-bounded cap regardless of how many
>     moderators are actually deployed (a Pro-tier panel can have up to 20 Active
>     Moderator Slots; a "you all" must never pile 20 replies onto one message). New
>     exported pure `resolveAdditionalResponderIds(primaryDeploymentId, multiTargets)`
>     in `community-runtime.ts` applies the cap AND excludes the primary from its own
>     additional-responder set (dedup-safety — the primary is already answering via
>     the normal single-responder path).
>   - **`community-runtime.ts` refactor: the whole generate→send→log pipeline
>     extracted into `respondAsDeployment()`**, callable once for the primary
>     responder and once per additional co-addressed responder — same
>     budget/timeout/trial-quota-gate/`GENERATION_STARTED`/`GENERATION_TIMEOUT`/
>     `GENERATION_FAILED`/`MODEL_DECLINED` logging shape every time, just scoped to a
>     different deployment + ITS OWN persona/prompt (never a copy of the primary's
>     reply — each additional responder gets an independent `generateChatterReply`
>     call). `handleHumanMessage`'s primary-path behavior/log decision values are
>     byte-identical to before the refactor (verified: all 451 pre-existing tests
>     still pass unchanged). Additional responders bypass pacing/cooldown the same
>     way a single directed mention already does (`isDirectedAtBot: true` — a genuine
>     multi-target address is directed at all named moderators, not an ambient one).
>   - **Loop-safety: zero new protection code needed.** Both the primary's and every
>     additional responder's sends happen serialized, within the SAME
>     `handleHumanMessage` invocation triggered by the ONE claimed human event — never
>     a new webhook delivery or recursive bot-observation path. The bot-ack branch in
>     `handleCommunityUpdate` (gated on `senderType === "INNVIL_MODERATOR"`) is a
>     completely separate, untouched code path — an additional responder's own send is
>     an ordinary `SEND_TEXT` with `origin: "HUMAN"`, so it re-enters the bot-ack
>     pipeline (via another bot's webhook re-observing it) exactly the same as any
>     single moderator's reply always has, with the same existing depth-1 bot-ack
>     bound.
>   - **Dedup-safety confirmed unchanged (per explicit instruction — no bug found,
>     left untouched):** `recordCommunityMessage`'s insert-based claim race (spec:
>     first bot's webhook to claim the inbound message proceeds; every other bot's
>     simultaneous delivery exits via the pre-existing `!claimed` check) still governs
>     which ONE webhook invocation runs `handleHumanMessage` at all — multi-target
>     fan-out happens ENTIRELY inside that single winning invocation, so it can never
>     interact with or be suppressed by the per-bot-webhook race.
>   - New tests: `chatter-coordinator.test.ts` (+14 — the exact live repro, "you two"/
>     "both of you" as the same plural category, a leading named list with and without
>     "and", singular-direct-target and referential-mention non-triggers, the "what are
>     your roles?" honest-limitation case, the <2-moderator no-op case, 3+ moderators
>     under a plural address, the `MAX_ADDITIONAL_RESPONDERS` constant itself, and a
>     substring-name false-pile-on guard) and `community-runtime.test.ts` (+5 —
>     `resolveAdditionalResponderIds`'s dedup-safety, multi-target resolution, the
>     no-pile-on cap, and empty/single-target edge cases). 469 tests pass, `tsc
>     --noEmit` clean, production build clean. No migration (no schema change —
>     `moderator_activity_log` already supported multiple rows per source message with
>     no uniqueness constraint, confirmed by inspection before implementation).
>   **Thirteenth live issue (v1.9.14): human group-chat behavior contract — Virtual
>   Moderators are participants, not assistants.** Live repro: "why are the two of you
>   not answering one after the other? like you are taking turns?" got assistant-style
>   over-explanations from BOTH moderators ("no secret turn system, we just reply when
>   we see it" / "no coordination going on, we just both hop in whenever we see the
>   message pop up") — mechanics-exposure AND redundant duplicate explanations in one
>   message. **Diagnosis correction, found by tracing the live activity log before
>   touching code:** this specific message actually routed through **ANSWER** (Sonnet),
>   not CASUAL_CHAT — it ends in "?", so `classifyMessageKind` resolves it to QUESTION
>   → ANSWER, per the existing, unchanged precedence order. The fix therefore applies
>   the new rules to BOTH actions, not only CASUAL_CHAT as originally scoped, since a
>   casual/social meta-question phrased as a literal question is still reachable via
>   ANSWER today.
>   - **New SHARED_RULES entries** (`chatter-generate.ts`, apply to every moderator
>     present and future — nothing hardcoded to a specific name/persona): (1) never
>     explain/reference/imply internal mechanics — routing, coordinator/selection
>     logic, turn-taking, responder selection, model/provider choice, AI architecture,
>     or any other hidden system behavior (explicitly bans phrasing like "the system
>     picked me", "there's no turn system", "we don't coordinate", "I was selected
>     first"); a casual question about timing/why multiple moderators replied gets a
>     brief in-world social answer ("just timing", "we both just saw it"), never a
>     description of how the underlying system works. (2) minimum-sufficient-response:
>     for casual/social/meta exchanges, use the shortest natural reply that satisfies
>     what's actually being asked, in the moderator's own voice — semantic brevity, not
>     a character cap; don't restate/summarize the human's message first unless real
>     clarification is needed; not every casual message needs a complete, thorough
>     answer just because a longer one is technically possible ("what would I, this
>     specific person, actually say here, if anything?" vs. "what's the most complete
>     answer I could give?").
>   - **Distinct-contribution / `conversationObligationSatisfied` for multi-responder
>     exchanges.** Separated per the user's explicit instruction: coordinator/runtime
>     decides WHETHER a second moderator's own obligation is still unmet; the generator
>     contract makes any resulting reply minimally human, not assistant-like — deciding
>     one thing with prompting and the other with a deterministic rule, not conflating
>     them. New pure `requiresIndividualContribution(text)` (`chatter-coordinator.ts`,
>     narrow structural regex on the request's own grammatical shape — "yourself/
>     yourselves", "who are you", "your persona/personality", "introduce yourself(ves)",
>     "each of you" — not an attempt to fully parse intent; defaults to `false` i.e.
>     "shared" when unrecognized, the safer default). New
>     `GenerateChatterReplyInput.priorResponsesToThisMessage` (other moderator(s) who
>     already replied to this SAME message, grounded in what was ACTUALLY said, never
>     invented) + `individualContributionExpected` (that boolean, computed once per
>     message, not per responder — it's a property of the QUESTION). New
>     `obligationContextLines()` injects one of two instructions into BOTH the
>     ANSWER and CASUAL_CHAT prompts when prior responses exist: **individual**
>     obligation ("can you both tell me about yourself?") → still must give its own
>     genuine answer, never just repeat/describe the other moderator; **shared**
>     obligation ("why are you two replying like that?") → the prior reply may already
>     fully satisfy it, explicitly offered `NO_REPLY` as a completely fine outcome,
>     forbidden from writing a second full explanation of the same thing — may still
>     add a genuinely distinct short reaction/confirmation/flavor.
>   - **`community-runtime.ts` wiring:** `respondAsDeployment` now returns
>     `{replied: false} | {replied: true; text: string}` (was `void`) so
>     `handleHumanMessage` can thread what the primary (and each successive additional)
>     responder actually said into the NEXT additional responder's own
>     `priorResponsesToThisMessage` — accumulating, so a third responder (second
>     additional, within the existing `MAX_ADDITIONAL_RESPONDERS = 2` cap) sees BOTH
>     prior replies. `individualContributionExpected` is computed once via
>     `requiresIndividualContribution(event.text)` and passed to every additional
>     responder alongside the accumulated `priorResponses`. Primary responder behavior
>     is otherwise unchanged — `priorResponsesToThisMessage` is simply absent/empty for
>     it, so `obligationContextLines()` returns `null` and the prompt is unaffected.
>   - **Considered and explicitly rejected: extending REACT to ambient (non-directed)
>     acknowledgements.** Investigated a separate live report ("woah, that's strict
>     lol" got no response, not even a reaction) — traced via `moderator_activity_log`
>     to `SILENCE`/`already_handled_recent_reply`, confirming REACT IS implemented,
>     just deliberately scoped to messages actually DIRECTED at a moderator. A first
>     attempt to extend REACT to ambient laugh/thanks content broke 10 existing,
>     clearly intentional tests (e.g. `"prettyaccurate too. lol"`, `"yeah lol that's
>     actually pretty accurate"` — all explicitly asserted to stay `SILENCE` even
>     ambient-with-laughter) — reverted. This is confirmed existing product behavior,
>     not a gap: reacting to every ambient "lol" not addressed to anyone would read as
>     the bot reacting to everything in the room.
>   - New tests: `chatter-generate.test.ts` (+15 — no-hidden-mechanics rule present in
>     both ANSWER and CASUAL_CHAT prompts, the exact banned live phrasing, the
>     minimum-sufficient-response rule in both prompts, `requiresIndividualContribution`
>     across the live repro + collective-question cases, `obligationContextLines` null/
>     individual/shared wording incl. the NO_REPLY offer, wiring into both prompt
>     branches, and persona isolation surviving the obligation context across two
>     different presets). 484 tests pass, `tsc --noEmit` clean, production build clean.
>     No migration.
>   **Explicit product decision (v1.9.15): ambient (non-directed) reactions are now
>   allowed — supersedes the v1.9.14-era "REACT requires direct targeting" design.**
>   Live example: "woah, that's strict lol" (no @mention/reply/name) stayed SILENCE
>   under the old rule — a human moderator would typically still smile/react to that,
>   not go fully quiet, since it's clearly a reaction to something in the room. Per
>   explicit instruction, the OLD "ambient trivial content always stays SILENCE" rule
>   (encoded in 9 existing tests) was reviewed individually and updated rather than
>   preserved as sacred — see each test's own comment for why.
>   - **New relevance gate, not a blanket "always react."** `ChatterCandidate` gained
>     `recentlyParticipated: boolean` (broader than the existing `wasLastSpeaker` —
>     true if this deployment sent ANY message within the recent, bounded context
>     window, not only the literal last one; computed by new
>     `deploymentRecentlyParticipated()` in `community-runtime.ts`). New
>     `pickRelevantReactor()` (`chatter-coordinator.ts`) requires a candidate to be
>     `wasLastSpeaker` or `recentlyParticipated` before an ambient TRIVIAL message can
>     REACT — a genuinely contextless "lol" with no relevant candidate still correctly
>     stays `SILENCE` (`trivial_low_value`/`already_handled_recent_reply`, unchanged).
>     Direct targeting still exists and is unaffected (`directed_trivial_acknowledgement`
>     stays single-target, unfanned-out, by design — a message literally addressed at
>     one moderator is that moderator's to answer).
>   - **Multiple relevant moderators may independently react — reactions are not
>     turn-taking.** New `resolveAdditionalReactors(input, primaryDeploymentId)` +
>     `MAX_ADDITIONAL_REACTORS = 1` (2 reactors total, matching the product spec's own
>     worked examples — chosen the same way `MAX_ADDITIONAL_RESPONDERS` was: an
>     explicit, socially-bounded cap independent of Active Moderator Slot count, since
>     a Pro-tier panel can have up to 20 deployed). Called from `community-runtime.ts`
>     only when the primary REACT did NOT come from the directed path — reuses the
>     SAME relevance bar as the primary (`wasLastSpeaker`/`recentlyParticipated`), never
>     a coin flip on whether to react, only a deterministic tie-break (quietest-longest)
>     for WHICH of several equally-relevant candidates fill the bounded slots.
>   - **`selectChatterAction()`'s own return shape is unchanged** (still exactly one
>     action/deploymentId) — multi-reactor fan-out is a strictly additional layer,
>     mirroring the v1.9.13 multi-target-address architecture exactly.
>   - **Persona-aware reaction expression, content-based eligibility stays persona-
>     agnostic.** "The coordinator decides whether a reaction is warranted. The
>     persona layer decides how that reaction is expressed." New
>     `personaReactionEmoji(baseEmoji, persona, random?)` (`chatter-generate.ts`) —
>     the coordinator still only ever suggests a neutral content-based default emoji
>     (unchanged, e.g. 😂 for laughter); this maps it to a persona-appropriate
>     variant (humor/teasing dials widen the laugh pool to 🤣/😆; formality narrows
>     positive/agreement to 🙂/👍). A persona that strongly avoids emoji
>     (`emojiFrequency < 15`) still reacts — a Telegram reaction IS an emoji, there's
>     no text-less alternative — but gets the plainest option for the category rather
>     than an exuberant one. Deterministic by default with an injectable `random`
>     (mirrors `shortAckText`'s existing pattern) — randomness, when used, only picks
>     among equally-valid expressions of the SAME category, never whether to react.
>     Wired into `community-runtime.ts`'s new `reactAsDeployment()` helper (extracted
>     from the old inline REACT branch, same zero-Sonnet/zero-`community_messages`-
>     insert shape as before — reactions still never call `generateChatterReply` and
>     still can never be re-observed by another bot's webhook, so no new loop-safety
>     surface), called once for the primary reactor and once per additional one.
>   - New tests: `chatter-coordinator.test.ts` (+16 — the exact live repro, unrelated
>     ambient noise still SILENCE, directed laugh unaffected, `recentlyParticipated`
>     alone is sufficient relevance, two-relevant-moderators bounded fan-out, no-pile-on
>     cap with many equally-relevant candidates, `resolveAdditionalReactors` dedup-
>     safety/non-TRIVIAL-exclusion/relevance-requirement, the `MAX_ADDITIONAL_REACTORS`
>     constant, and a structural no-generation-waste check) plus 9 EXISTING tests
>     reviewed and updated (SILENCE→REACT) with an explanatory comment on each, per
>     explicit instruction not to blindly preserve tests that contradict the new
>     product decision; `chatter-generate.test.ts` (+8 — persona-aware pool selection,
>     the low-emoji-persona plain-option floor, determinism); `community-runtime.test.ts`
>     (+4 — `deploymentRecentlyParticipated`'s broader-than-last-message window, staleness,
>     and HUMAN-sender exclusion). 507 tests pass (up from 484), `tsc --noEmit` clean,
>     production build clean. No migration.
> - **(New capability, v1.10.0) Temporary conversational task state — "let's all count" now
>   actually works.** Live failure: a human said "let us all count. I'll start with 1.
>   Test goes 2, Kwan 3, then I do 4 until 20" — Test replied "1" immediately (before
>   the human even started), later turns were improvised from local transcript context
>   instead of executed, and "wait for me to start" did not pause anything. Root cause:
>   normal chatter (chatter-coordinator.ts) is deliberately message-by-message with no
>   memory of a multi-step SHARED activity — there was nothing to pause, because nothing
>   was ever formally started. This is a NEW, separate mechanism, not a chatter-prompt
>   fix — normal group chat stays turn-free; only an EXPLICIT ordered/shared activity
>   temporarily overrides it, until completed/changed/cancelled/expired.
>   - **New pure module `src/lib/moderator/task-state.ts`** — a `ConversationTask`
>     discriminated union (only `SEQUENCE` implemented; a `type` field lets future task
>     kinds, e.g. ordered Q&A, be added without reworking this shape or the runtime
>     wiring around it). `SequenceTask` = ordered `TaskParticipant[]` (`HUMAN`, by
>     platform id, or `MODERATOR`, by deploymentId — dynamically resolved from real
>     deployments, never hardcoded to any fixture names), `currentIndex` (whose turn),
>     `progression` (`NUMERIC {start,step,end}` — the driving example, sent with ZERO
>     LLM calls since the runtime already knows the exact required value — or
>     `FREEFORM`, which needs real generation since there's nothing deterministic to
>     produce), `status` (`ACTIVE`/`PAUSED`/`COMPLETED`/`CANCELLED`/`EXPIRED`).
>   - **Detection is structural, not a phrase dictionary**: `detectSequenceTaskIntent`
>     requires a counting cue + an explicit end value ("until N"/"to N") + splits the
>     setup message into clauses (period/comma/"then") and extracts (participant,
>     number) pairs per clause — a known moderator name, or a first-person
>     self-reference ("I"/"me") for the human — in the order they appear, deriving
>     turn order + step from that. A message that doesn't match this shape (e.g. "tell
>     me a joke", or numbers with no counting cue — "meet me at 3, Echo will be
>     there") never creates a task; a task needs 2+ distinct participants assigned
>     numbers, since a single-person "count" isn't a turn-taking activity.
>   - **Control instructions** — `classifyTaskInstruction` (structural signals, not a
>     giant fixed vocabulary): PAUSE (wait/hold on/don't start yet), RESUME (go/start/
>     ready), RESET (start over/restart — same participants/order/progression, just
>     restarts progress), CANCEL (never mind/stop/forget it — terminal). A narrow,
>     bounded `applyReorderInstruction` handles "no, X goes after Y" by moving X in the
>     turn order while preserving WHOSE turn is currently expected by identity (never
>     silently skips/repeats a turn because of the reorder).
>   - **Task-local state overrides ordinary routing entirely, not just for the expected
>     participant.** New `routeConversationTask()` in `community-runtime.ts` is checked
>     BEFORE `selectChatterAction` in `handleHumanMessage`; while a task governs a
>     message (control instruction, a turn attempt — matching, mismatched, or
>     irrelevant —, or a brand-new task just created by this message), ordinary
>     quietest-longest/continuity/multi-responder/ambient-reaction selection never runs
>     for it at all — "task-local state wins unless the user explicitly changes the
>     task." A wrong value from the expected participant is `TASK_MISMATCH` (state
>     unchanged, same participant gets another chance) — never silently advances; an
>     off-turn message is silently ignored (`NO_MATCH`), never lets a different,
>     more-eligible-by-ordinary-rules moderator jump in.
>   - **Moderator turn cascade, same invocation.** New `runModeratorTaskCascade()` —
>     since Telegram webhooks are one-shot, a chain of consecutive moderator turns
>     (Test's "2" immediately unlocking Kwan's "3") is executed serially within the
>     SAME webhook call that advanced the human's turn, stopping the instant the next
>     expected participant is HUMAN (moderators WAIT — no generated "your turn"
>     reminder) or the task `COMPLETED`s. NUMERIC turns are sent as the literal
>     deterministic string, no `generateChatterReply` call; a FREEFORM turn does call
>     it (`CASUAL_CHAT`, that moderator's own persona) since there's genuinely nothing
>     deterministic to send — persona flavors HOW a freeform turn reads, it can never
>     corrupt a NUMERIC one (that value is never model-generated at all).
>   - **Persistence (migration `0052`, new `moderator_conversation_tasks` table)** —
>     required because Telegram webhook invocations are stateless/serverless and a
>     task spans several of them; NOT process memory. `state` is the full
>     `ConversationTask` as JSONB (same pattern as `virtual_moderators.persona`).
>     **Scoping: one ACTIVE/PAUSED task per COMMUNITY** (a "let's all count" is a room
>     event, not a private one) — enforced by a partial unique index at the DB level,
>     not just application code, so a second concurrent task-creation attempt simply
>     can't insert (loses the race, existing task keeps governing — never silently
>     merged). **TTL: 15 minutes** since the task's last advancement (checked on read,
>     no cron) — long enough for natural human typing/thinking pauses in a live group
>     activity, short enough that a forgotten game doesn't govern the room for hours;
>     on expiry the task is marked `EXPIRED` and that message falls through to ordinary
>     chatter. **Run migration `0052`.**
>   - **Observability**: every lifecycle transition logs to the existing
>     `moderator_activity_log` (event_type `conversation_task`) — `TASK_CREATED`,
>     `TASK_ADVANCED`, `TASK_PAUSED`, `TASK_RESUMED`, `TASK_COMPLETED`, `TASK_CANCELLED`,
>     `TASK_EXPIRED`, `TASK_MISMATCH`, `TASK_UPDATED` (reset/reorder) — with taskId +
>     current step/participant metadata, no message content/secrets, same convention
>     as every other decision this feature already logs.
>   - New tests: `task-state.test.ts` (+32 — the exact live repro incl. dynamic
>     non-Kwan/Test fixtures, the wait-instruction non-advance, the full 1→2→3→4
>     sequence, task-local override proof, human-turn = wait/no-generation, mismatch
>     leaves state untouched, reset/cancel/pause/resume, reorder preserving whose turn
>     it is, completion, TTL boundaries, FREEFORM progression). 539 tests pass (up from
>     507), `tsc --noEmit` clean, production build clean. **Run migration `0052`
>     before this governs any live community.**
> - **(C)-(F) IMPLEMENTED (v1.11.0) — intelligent external-link moderation, spam vs.
>   legitimate-follow-up distinction, natural warning escalation, configurable
>   collab/AMA routing.** Moderation is a genuinely separate decision from Natural
>   Chatter (spec §18/§50): it runs on every human message regardless of @mention
>   (spec §46) and is never disabled by the reactive chatter quota (spec §45) — only
>   short-circuits ordinary task/chatter routing for THIS message when the message
>   was actually deleted (nothing left to respond to).
>   - **Pure policy layer** `src/lib/moderator/link-moderation.ts` — `extractLinks`/
>     `normalizeLink`/`linkHash` (URL + bare `@handle` extraction, tracking-param
>     stripping without changing destination identity, spec §44); `LinkCategory`
>     taxonomy (`SAFE_RELEVANT_LINK`/`APPROVED_PARTNER_LINK`/`COLLABORATION_REQUEST`/
>     `AMA_REQUEST`/`PARTNERSHIP_REQUEST`/`UNSOLICITED_PROMOTION`/`LINK_SPAM_OR_FLOOD`/
>     `PHISHING_OR_SCAM`/`EXPLICIT_CONTENT`/`UNKNOWN_OR_AMBIGUOUS`); `recordLinkObservation`/
>     `isFloodRepeat` (30-minute flood window, `FLOOD_REPEAT_THRESHOLD=3` same-link
>     repeats — spec §30, changes ONLY the rapid-flood interpretation, never resets
>     `warningCount`, kept as a genuinely separate field — spec §31); and the
>     deterministic policy itself, `decideLinkEnforcement()` (spec §42, "don't use LLM
>     as sole ban authority" — classification informs this, never decides alone):
>     severe content (explicit/phishing, high confidence) → immediate `DELETE_BAN`,
>     role-exempt for nobody; safe/partner/collab/AMA/partnership/unknown → `ALLOW`;
>     flood/spam signal → `DELETE_BAN` (checked BEFORE the admin exemption below, since
>     a rapid burst reads as a safety signal, not ordinary self-promotion — spec §43's
>     "don't exempt trusted accounts from ALL safety logic"); admin/trusted role →
>     `ALLOW` (ordinary-ad exemption only); otherwise 3-strike `DELETE_WARN` escalation
>     → `DELETE_BAN` on the 4th (`PROMOTION_WARNING_LIMIT=3`).
>   - **AI-touching half** `src/lib/moderator/link-classify.ts` — `classifyLinkIntent`
>     (Sonnet 5 medium, the hard `INNVIL_REQUIRED_MODEL` default — moderation decisions
>     delete content and ban people, exactly the consequence class the model invariant
>     protects; NOT the DeepSeek CASUAL_CHAT carve-out) degrades to
>     `UNKNOWN_OR_AMBIGUOUS`/low on any failure so an AI hiccup can never itself cause
>     a deletion/ban; `generateModerationWarning` (persona-voiced, spec §24 — explicitly
>     bans robotic "Violation N/3" wording — falls back to a small VARIED template pool,
>     never one fixed sentence, if generation fails).
>   - **Enforcement**: new `CommunityAction` kinds `DELETE_MESSAGE`/`RESTRICT_USER`
>     (`mode:"BAN"` only in v1) in `event-types.ts`, executed via Telegram
>     `deleteMessage`/`banChatMember` (`community-runtime.ts`'s `executeAction`).
>     Admin/trusted-role check reuses Telegram's own `getChatMember` status
>     (administrator/creator) rather than inventing a parallel trust concept — fails
>     closed (not exempt) on any lookup error.
>   - **State**: new `moderator_link_warning_state` table (migration `0053`, per
>     community+Telegram-user, mirrors `deployment_state`'s shape) holds BOTH
>     long-term `warning_count` and the short-term flood-window fields as genuinely
>     separate columns, never merged.
>   - **(F) Collab/AMA routing** — new `communities.collab_contact` column (same
>     per-community settings pattern as `bot_ack_mode`), owner-editable via new
>     `setCommunityCollabContact` action + a text input in the Communities section of
>     `AdminTabs.tsx`. Routing happens through the EXISTING chatter pipeline, not a
>     separate generation call: when link classification lands on a COLLAB/AMA/
>     PARTNERSHIP category and a contact is configured, `runLinkModeration` (which
>     `ALLOW`s these — spec §39, never delete a legitimate collab link) passes
>     `collabRoutable` up to `handleHumanMessage`, which threads the community's
>     `collab_contact` into `GenerateChatterReplyInput` — a new `collabContactLine()`
>     prompt block (`chatter-generate.ts`) lets the moderator naturally mention it IF
>     ordinary chatter's own selection/quota decides to reply at all (spec §45: this
>     conversational reply DOES consume reactive quota, unlike enforcement itself).
>     A new `SHARED_RULES` entry bans inventing a contact when none is configured
>     (spec §35/§38); `collabContactLine`'s own text states the routing is
>     conversational only, never an authorization grant (spec §36).
>   - **Known v1 simplification** (documented honestly, not hidden): the enforcing/
>     classifying moderator is always `deployments[0]` (the first chatter-eligible
>     deployment in the community) rather than picking whichever specific deployment
>     has delete/restrict rights — Telegram simply rejects the API call if that bot
>     lacks rights (surfaced via `console.error`, never silently swallowed), so
>     enforcement still degrades safely, it just doesn't yet retry a different bot.
>   - New tests: `link-moderation.test.ts` (+33 — extraction/normalization, all 14
>     of spec §54's required scenarios via `decideLinkEnforcement`, the flood-window
>     boundary incl. the 30-minute non-reset-of-history proof, admin exemption not
>     applying to severe/flood signals), `link-classify.test.ts` (+11 — fetch-spy
>     verified Sonnet-only routing for both classification and warning generation,
>     malformed/failed-call degradation, the anti-robotic-wording prompt assertion,
>     varied fallback templates), `chatter-generate.test.ts` (+5 — collab-contact
>     line grounding, no-invented-username rule, wired into both ANSWER/CASUAL_CHAT).
>   588 tests pass (up from 539), `tsc --noEmit` clean, production build clean.
>   **Run migration `0053` before this governs any live community.**
>
>   **Also folded into this release**: the free-trial wallet-maintenance threshold
>   (`TRIAL_WALLET_MIN_BALANCE`, `src/lib/moderator/customer-entitlement.ts`) raised
>   from $10 to $20 per explicit instruction — a pure constant change, storefront copy
>   (`AiModeratorSurface.tsx`) and tests updated to match. No migration (not persisted
>   as a DB value, computed live).

### Phase 4.M.1: AI Moderator product-placement + entitlement correction — Phase 1 of N (v1.8.0)

> **Product correction: the AI Moderator is a STOREFRONT product, purchased by a panel
> CUSTOMER, not the panel owner.** Before this, the entire Virtual Moderator surface —
> including the 7-day trial — was 100% owner-facing: `startModeratorTrialIfEligible`
> granted the trial to the panel OWNER the moment *they* connected a Telegram community
> (keyed by `owner_id`, zero customer involvement), `commercialMode`/pricing constants
> existed in `money.ts` but were **never wired to any actual billing execution path**
> (grepped every reference — `commercialMode` was only ever displayed as a label in the
> owner UI), and `virtual_moderators` had no `customer_id` column at all. This was
> confirmed via a full investigation report (root-cause questions 1–13) before any code
> was touched, per explicit instruction not to silently rewrite money ownership.
> **This is Phase 1 of a multi-phase migration** (scope explicitly agreed with the user
> before implementation): entitlement + pricing + a real, working customer billing path
> and a new storefront tab. Deferred to Phase 2: migrating the Telegram
> provisioning/connect-community UI into the storefront (it reuses the existing, complex,
> already-working owner-side pipeline in `actions/moderator.ts` — wiring that through
> customer auth deserves its own careful pass, not a rushed duplication here), and
> narrowing the owner `ModeratorTab` to config-only.
>
> **Free trial eligibility (exact rule):**
> `account age >= 30 days AND >= $50 lifetime completed panel-service spend` (ESTABLISHED),
> **OR** `>= $100 lifetime completed panel-service spend regardless of account age`
> (HIGH_VALUE), **OR** `maintain >= $10 customer wallet balance during the fixed 7-day
> trial window` (WALLET). Precedence when multiple paths qualify: HIGH_VALUE >
> ESTABLISHED > WALLET — a durable non-wallet source is always preferred, so a customer
> who also clears a spend/age bar is never subjected to the $10 maintenance rule.
> - New `src/lib/moderator/customer-entitlement.ts` (pure, no I/O): `resolveTrialQualification`,
>   `isTrialCurrentlyAccessible`, `trialAccessGranted`, `sumNetOrderSpend`,
>   `customerModeratorCapacity`/`customerModeratorMaxSavedModerators` (reuses
>   `moderator/plan.ts`'s existing `CAPACITY` table — Basic/Standard/Premium/Pro slot
>   counts were already 2/5/10/20, unchanged, now exported for reuse).
> - **The $10 is never a fee.** It's the customer's own usable wallet balance — never
>   charged, never confiscated by starting or maintaining a trial.
> - **Fixed trial window, no calendar-extension exploit:** `trialAccessGranted()` combines
>   a FIXED `trialEndsAt` (set once at start, never recomputed) with a LIVE, derived
>   wallet-maintenance check — there is deliberately no persisted "paused" flag, so
>   dipping below $10 for days and restoring later can never grant extra days; pause/resume
>   is a pure function of (qualification source, current wallet balance, now vs. the
>   original `trialEndsAt`). ESTABLISHED/HIGH_VALUE-qualified trials are permanently
>   exempt from the $10 rule.
> - **Lifetime spend** is computed from the canonical `balance_transactions` ledger, not
>   `orders.status` (which the codebase's own `refundOrder()` sets to `'refunded'` even
>   for a PARTIAL refund — filtering on `status = 'completed'` alone would silently drop
>   partially-refunded fulfilled orders). `sumNetOrderSpend()` nets `type IN ('order',
>   'refund') AND ref_order_id IS NOT NULL` — verified by grep that `ref_order_id` is
>   **only ever set** by genuine order placement/refund code, never by deposits or other
>   add-on subscription charges (e.g. the Automator's $6.99 charge also uses
>   `type='order'` but never sets `ref_order_id` — filtering by type alone would NOT have
>   safely excluded it).
>
> **New pricing (canonical source: `money.ts`, single source of truth — no scattered
> literals):** Basic $49.99/2 slots, Standard $99.99/5, Premium $179.99/10, Pro
> $299.99/20 (replaces the old, never-actually-billed $29/$59/$99/$179). Enterprise
> (20+ slots) is contact-only — `MODERATOR_ENTERPRISE_MIN_SLOTS = 21`, structurally not a
> `ModeratorPlanTier` value (cannot compile into normal tier billing), routed through the
> existing customer→owner support-ticket path (`contactEnterpriseModeratorSales` →
> `createTicket`) — no direct customer→Innvil channel exists by design (keeps Innvil
> invisible to end customers, the same boundary used everywhere else).
>
> **Billing/ownership architecture (the money-ownership correction):**
> - New migration `0051_customer_moderator_entitlement.sql`: `virtual_moderators
>   .customer_id` (nullable — NULL = owner-created/dev moderator under the old model,
>   set = customer-owned under the new one; both coexist during the migration), new
>   `customer_moderator_entitlement` table (one row per panel+customer: trial state +
>   paid subscription state, PK on `(panel_id, customer_id)`), and atomic RPC
>   `charge_customer_for_moderator_subscription` — debits the customer's wallet the full
>   price via the existing `apply_balance_change` (which already row-locks and raises on
>   insufficient balance) and credits the panel owner's Innvil balance with their
>   `MODERATOR_COMMISSION_SHARE` (20%) commission in the SAME transaction — both-or-neither,
>   so a failed charge can never leave a partial credit or an active paid entitlement
>   (the app layer only persists the tier after receiving `'OK'` back). The remaining 80%
>   is Innvil's own revenue, realized implicitly by never being credited anywhere further
>   — the same pattern already used for the 5% order commission.
> - New `src/lib/actions/customer-moderator.ts` (storefront-session-authed, mirrors the
>   established `automator-sub.ts` `ctx(panelId)` pattern exactly): `getModeratorEligibility`,
>   `startCustomerModeratorTrial`, `subscribeCustomerModeratorPlan`, `cancelCustomerModeratorPlan`,
>   `contactEnterpriseModeratorSales`, `listCustomerModerators`, `createCustomerModerator`.
>   Every action derives `customer_id` from the AUTHENTICATED session lookup
>   (`customer_accounts` by `user_id` + `panelId`) — never from a client-supplied ID — and
>   every query/write is scoped by both `panel_id` and that resolved `customer_id`, so one
>   panel's customer structurally cannot reach another customer's (or another panel's)
>   entitlement/moderator rows. Uses the codebase's established code-level tenancy
>   enforcement via the service-role client (same convention as every other owner/customer
>   action here), not RLS.
>
> **Storefront UX:** new `src/components/customer/AiModeratorSurface.tsx`, mounted as a
> new "AI Moderator" nav item in `CustomerDashboard.tsx` (customer-facing, alongside
> Campaign/Mass order). Shows eligibility copy (established/high-value/wallet-route
> messaging exactly as specified, no mention of the old "prior order history" rule),
> trial start, the 4 paid tier cards + Enterprise contact card, and the customer's own
> saved moderators with a create-moderator control. Telegram connection is explicitly
> labeled "coming soon to this dashboard — contact support to connect a moderator today"
> (Phase 2, per the agreed scope split — see above).
>
> **New tests:** `customer-entitlement.test.ts` (31 — every boundary from the spec:
> ESTABLISHED age/spend both-required at 29/30 days and $49.99/$50.00, HIGH_VALUE at
> $99.99/$100.00, WALLET at $9.99/$10.00, the ESTABLISHED-vs-WALLET overlap precedence,
> the exact wallet-pause/restore/no-extension-exploit sequence day-by-day, deposits/
> refunds/subscription-charges correctly excluded from spend), `money.test.ts` (6 —
> canonical prices, slot counts, Enterprise boundary + compile-time tier-safety). 367
> tests pass total, `tsc --noEmit` clean, production build clean, diff reviewed.
> **Run migration 0051** before any customer attempts to use this. Note: no dedicated
> action-level Supabase-integration tests were added for tenant isolation (no such
> pattern exists for ANY server action in this codebase — enforcement is structural,
> via the `ctx()` scoping pattern, consistent with every other customer-facing action).
>
> **Phase 2 IMPLEMENTED (v1.12.0) — self-serve Telegram provisioning in the storefront.**
> Moved the Telegram bot-connection + community-linking flow into the customer surface,
> reusing the SAME Telegram-facing pipeline as the owner flow (`moderator/manager.ts`'s
> auth-agnostic helpers — deep-link building, username validation, bot-token
> verification, webhook registration, chat-membership checks — nothing about how Innvil
> talks to Telegram is duplicated). What's deliberately separate from the owner path:
> the ownership check (`customer_id`, never `panel.owner_id`) and the capacity source
> (`customerModeratorCapacity(entitlementSource)` — THIS customer's own trial/plan,
> never `panels.settings`, which governs the owner's own unrelated legacy entitlement).
> The owner-only "start a trial on first deployment" step is intentionally never called
> here — a customer's trial is explicit (`startCustomerModeratorTrial`), never silently
> auto-granted by connecting Telegram.
> - New in `actions/customer-moderator.ts`: `ctxModerator()` (customer-session +
>   `customer_id` ownership check, mirrors `moderator.ts`'s `ownedModerator`),
>   `requestCustomerTelegramCreation`/`getCustomerModeratorProvisioning`/
>   `cancelCustomerTelegramProvisioning`/`connectCustomerBotToken` (BotFather fallback)/
>   `connectCustomerCommunity`/`listCustomerModeratorCommunities`/
>   `setCustomerDeploymentEnabled` — each mirrors its owner-facing counterpart 1:1 in
>   Telegram-interaction logic, differing only in auth/capacity source. Bot-ack mode is
>   surfaced READ-ONLY on the customer side (`listCustomerModeratorCommunities`) —
>   changing it stays an owner-only control (`setCommunityBotAckMode`), since it's a
>   community-wide setting shared across every moderator deployed there.
> - New `ModeratorTelegramCard` in `AiModeratorSurface.tsx` — per-moderator connect flow
>   (managed-bot deep link + BotFather token fallback + polling, mirroring
>   `TelegramConnectRow`'s UX from `AdminTabs.tsx`) and, once deployable, a community
>   connect input + connected-communities list. **The whole `AiModeratorSurface` entry
>   point stays gated behind `aiModeratorComingSoon` (hardcoded `true` in
>   `Storefront.tsx`) per explicit instruction — this component is built and verified,
>   not yet visible to real customers.**
> - **Proactive shared-system-risk check** (per explicit new standing instruction, see
>   the `/api/v2` incident above): before shipping, verified via direct PostgREST
>   introspection that neither new implicit embed this pass added
>   (`moderator_deployments→communities`, `virtual_moderators→telegram_bot_integrations`)
>   has become ambiguous — both still resolve to exactly one relationship. No new FK was
>   added in this pass, so no new risk was actually introduced, but checked anyway.
> `tsc --noEmit` clean, 588 tests pass (unchanged — no dedicated action-level tests
> added, consistent with this codebase's established convention for server actions),
> production build clean. No migration (reuses existing `virtual_moderators.customer_id`
> from migration 0051 + the existing `telegram_provisioning_attempts`/
> `telegram_bot_integrations`/`communities`/`moderator_deployments` tables).

### Phase 4.N: Project Knowledge + AI Auto-Posting for Virtual Moderator (DONE v1.15.0/v1.16.0/v1.17.0, hierarchy corrected v1.18.0 — Moderator Q&A grounding incl. Community Knowledge, AND per-moderator AI Telegram Auto-Posting. Gated OFF in production behind AUTO_POSTING_ENABLED until live-verified.)

> **FINAL INVARIANT (v1.18.0):** Knowledge follows the hierarchy Panel -> Project -> Community.
> Project Knowledge belongs to a specific project and is inherited by every community attached to
> that project. Community Knowledge belongs only to the specific community and overrides/supplements
> Project Knowledge. Organization/Panel Knowledge is the only scope shared across every project a
> panel owns. A community may never retrieve Project Knowledge belonging to another project under the
> same panel, even though both projects share a panel.

> Extends Phase 4.M. Adds a shared, tenant-scoped **Project Knowledge Base** (project
> overview, website, whitepaper, docs, FAQs, roadmap, official links, brand voice,
> custom notes — via text/URL/file/structured-field inputs) that powers BOTH the
> Virtual Moderator's Q&A answers AND a new **AI Telegram Auto-Posting** capability —
> one shared retrieval layer, not two disconnected knowledge stores.
> **Full verbatim 41-section spec (source of truth, implement from it, not this
> summary):** `docs/moderator/project-knowledge-autoposting-spec.md`. Key invariants:
> - **Retrieval, not prompt-stuffing** — ingest → parse → chunk → index/embed →
>   retrieve relevant chunks only; reuse existing vector/search infra if present,
>   never resend a whole whitepaper per generation.
> - **Source-grounded, never fabricated** — auto-posts must not invent partnerships,
>   prices/APYs, listings, dates, audits, or stats unless backed by stored knowledge;
>   insufficient material → skip the slot, never hallucinate a post. Static docs are
>   never treated as proof of *current* time-sensitive facts (APY, live campaigns).
> - **Tenant + community isolation** — Project A knowledge never leaks into Project
>   B; base project knowledge is reusable across a moderator's communities, but
>   community-specific memory stays isolated per Community/ModeratorDeployment, and
>   casual community chatter never silently becomes authoritative Project Knowledge.
> - **Auto-posting is its own capability** — separate from proactive moderator speech
>   (GM/GN, dead-chat revival) and from the reactive/proactive quotas in Phase 4.M;
>   never publishes with `TELEGRAM_MANAGER_BOT_TOKEN` (control-plane only) — always
>   the subscriber's own managed-bot credential for that community/deployment.
> - **⚠️ No generic Innvil publishing bot — each Virtual Moderator IS the publisher**
>   (same-day correction, appended to the spec file as "AUTO-POSTING UPDATE",
>   read it before implementing scheduling/publishing). Subscribers configure a
>   **posting window per ModeratorDeployment, fully user-settable per moderator**
>   (e.g. Mika 05:00–12:00, Kaleb 13:00–17:00, Alex 18:00–22:00 — illustrative
>   examples only, never hardcoded defaults/bounds — all in the community's local
>   timezone); each window publishes **at most one post/local-day**, at a random
>   time that is
>   **generated once and persisted** (`AutoPostOccurrence`, unique on
>   `windowId + localDate`) — never re-rolled per cron tick. A missed window is
>   **skipped**, not caught up. Duplicate-content prevention is **community-wide
>   across all moderators**, not per-bot. Minimum spacing between two moderators'
>   near-simultaneous posts to avoid an unnatural cluster.
> - **Generation vs. publishing are separate steps** — scheduler → retrieval → AI
>   generation (close to execution time, not days ahead, so knowledge stays fresh)
>   → validation (length, no secrets/prompt-leakage, no duplicate content, correct
>   bot/community) → deterministic publish; idempotent per occurrence (one
>   successful Telegram post max, even on cron/publish retry — retry reuses the
>   SAME generated content, never regenerates a different post per attempt).
> - **Entitlement: OFF for the trial** — the 7-Day Full AI Mod Trial explicitly
>   excludes AI content generation/auto-posting; `autoPosting.enabled = false` for
>   trial via existing entitlement infra, never scattered `if (plan === ...)` checks
>   inside Telegram code.
> - **Task-based model routing** — Sonnet 5 at `medium` effort as the default for
>   blog generation, scheduled content, and substantive Q&A (not one reasoning level
>   for everything); simple chatter/reactions skip expensive reasoning entirely.
> Explicitly OUT of scope: Managed Bot provisioning, Manager Bot ownership model,
> order/provider systems, duplicate-order logic, billing/commission architecture,
> Natural Chatter's response-selection logic (unless shared retrieval requires it),
> and link moderation behavior.
> - **NOTED addition:** a second, community-scoped knowledge layer ("COMMUNITY-
>   SPECIFIC KNOWLEDGE" appended to the spec file) — facts belonging to one
>   specific `Community` (local rules/admins/FAQs), auto-available to every
>   moderator deployed there via the deployment→community link, isolated from
>   other communities and from the tenant-wide Project Knowledge above (though a
>   community-specific fact wins over a conflicting project-wide one). Depends on
>   the base Project Knowledge retrieval pipeline existing first — build the
>   shared retrieval layer with an explicit `PROJECT`/`COMMUNITY` scope field
>   from day one rather than retrofitting scoping later.

### Phase 4.N.1: Virtual Moderator entitlement correction — Active Mod Slots (v1.1.77)
- **Fixed the paid-tier capacity table** in `src/lib/moderator/plan.ts` — `standard` was
  `{maxCommunities:2, maxActiveSlots:6}`, now `{2, 5}`; `premium` was `{3, 12}`, now
  `{3, 10}`. `basic` `{1,2}` and `pro` `{5,20}` unchanged. Trial stays `{1,1}`.
- **Confirmed (not changed — already correct):** `connectCommunity`/`setDeploymentEnabled`
  in `src/lib/actions/moderator.ts` already count ACTIVE `moderator_deployments` rows for
  slot enforcement, never unique `VirtualModerator` rows — so reusing the same moderator
  persona across two communities already correctly consumes 2 Active Mod Slots (not 1),
  pausing a deployment already frees a slot, and reactivating one already re-checks
  current capacity. The entitlement *unit* was already right; only the table's numbers
  needed correcting. New tests in `plan.test.ts` pin the corrected per-tier values.

### Phase 4.O: Bot-to-Bot delivery correction + Telegram AI Moderator onboarding automation (NOTED, not built)

> **Live bot-ack delivery test (2026-08-08) failed** — a message sent directly through
> Kwan's bot token to the shared test community never reached Test's webhook (not in
> `community_messages`, no fresh delivery attempt in `getWebhookInfo`), despite both
> bots being confirmed admins in that chat. **Corrected diagnosis:** this is NOT a
> platform-level "bots can't see other bots' messages" block — Telegram officially
> supports **Bot-to-Bot Communication Mode**, a per-bot BotFather setting, independent
> of admin status and independent of Group Privacy Mode. The supported configuration
> for Innvil's bot-ack feature needs all three, set per participating bot: (1)
> Bot-to-Bot Communication Mode ON in @BotFather, (2) Group Privacy Mode OFF, (3) admin
> in the target chat. Changing Group Privacy Mode may require removing/re-adding the
> bot to the group for Telegram to apply it. **Do not modify bot-ack Coordinator/
> classification code until delivery is re-verified live with these Telegram-side
> settings actually configured** — the existing loop-prevention/classification
> architecture (`MAX_BOT_INTERACTION_DEPTH=1`, numeric-bot-ID classification, origin
> metadata) is believed correct; the blocker was Telegram-side configuration.
> **Full verbatim spec (source of truth):** `docs/moderator/telegram-bot-to-bot-onboarding-spec.md`.
>
> **Second, larger, NOTED-not-built piece in the same file:** automate the Telegram-side
> setup for deploying an AI Moderator, to the extent Telegram's official API actually
> allows — an official add-to-group deep link with suggested (least-privilege,
> feature-driven) admin rights the user confirms in Telegram itself; guided @BotFather
> steps for Bot-to-Bot Communication Mode + Group Privacy Mode when bot-ack is enabled
> (never faked/auto-configured — Telegram exposes no supported API for a manager bot to
> flip these on a managed bot, so this stays user-guided unless that changes); and
> **delivery-based verification** (`NOT_TESTED` → `READY_FOR_TEST` → `VERIFIED_BY_DELIVERY`
> / `FAILED` — never show "verified" just because the user clicked "done"). Bot-ack setup
> must never block the rest of a deployment (chatter/moderation/Q&A/auto-posting all work
> without it) and must never be forced on subscribers who don't want moderator-to-moderator
> interaction. `/start` (private + `startgroup` deep-link) is in scope as a setup/status
> touchpoint — never counted as chatter, never trusting Telegram username as identity,
> never disclosing tenant data to an unrelated user who sends `/start`.

### Phase 4.O.1: Virtual Moderator saved-moderator creation cap (v1.1.81)
- **Global ceiling on saved `VirtualModerator` records is now 5, tier-scaled below
  that** — `basic` 2, `standard`/`premium`/`pro` all 5 (was: only trial capped at 1,
  every paid tier was `Number.POSITIVE_INFINITY`/unlimited). Distinct from Active
  Mod Slots (Phase 4.N.1) — this caps how many personas can exist at all, not how
  many are simultaneously deployed. Enforcement (`createVirtualModerator` in
  `src/lib/actions/moderator.ts`) was already correct — counts `virtual_moderators`
  rows for the panel — only `moderatorMaxSavedModerators`'s per-tier table needed
  the real numbers. No-entitlement now correctly returns 0 (was silently unlimited).

### Phase 4.P: Bot-ack social behavior — Community Handoff + real Telegram Reactions (DONE v1.14.0)

> Refines the already-built, loop-fixed (v1.1.80) bot-ack feature. Two problems with
> today's hard "a BOT_ACK may never trigger anything else" rule: (1) it can cut a
> natural-feeling bot-to-bot exchange off abruptly instead of letting it resolve
> gracefully, and (2) `REACT` needs to mean an actual Telegram message reaction
> (`setMessageReaction`), never a standalone emoji text message.
> **Full verbatim spec:** `docs/moderator/bot-ack-social-behavior-spec.md`. Key points:
> - **New bounded action: `COMMUNITY_HANDOFF`** — depth 0 (root event) → depth 1
>   (optional `BOT_ACK`) → depth 2 (optional `COMMUNITY_HANDOFF`, community-facing
>   only, addressed to "anyone"/humans, never to the other bot by name) → hard STOP.
>   A `COMMUNITY_HANDOFF` must never itself trigger another bot's acknowledgement;
>   only a human reply restarts normal Coordinator logic. Silence is still a valid
>   outcome at every step — never force a handoff just because an exchange happened.
> - **`REACT` = real Telegram reaction, not a message.** Reactions are optional,
>   context-dependent (one moderator's answer may get 0 or 1 reaction from another
>   eligible moderator, never a stack of reactions from every deployed moderator),
>   must use only reactions Telegram's `available_reactions` actually allows for
>   that chat (never fall back to an emoji text message), target an explicit
>   message ID (never "the latest message"), and must never themselves start a new
>   bot-chain event. `SILENCE` is not a fallback state for "can't react" — it's
>   frequently the correct answer on its own (e.g. "ok"/"lol" from a human usually
>   gets nothing, bot or human).
> - **Separate quota** — bot-to-bot social usage (BOT_ACK + COMMUNITY_HANDOFF) and
>   reactions must not consume the Phase 4.M reactive (20/day) or proactive (2/day)
>   quotas; prefer a small dedicated bot-interaction allowance instead.
> - **3+ moderator clarification** (given informally, appended to the spec file): the
>   ack-then-redirect shape generalizes to N moderators — either several may take a
>   bounded turn before one redirects, or a later moderator may redirect directly
>   without first producing its own `BOT_ACK`. Don't hardcode new fixed-depth
>   arithmetic beyond what's in the spec; implement from the stated intent.
> - Only `INNVIL_MODERATOR`-classified senders (numeric bot ID + active deployment in
>   the same community) participate — `EXTERNAL_BOT` never gets this treatment.

### Phase 4.Q: `innvil_bot_manager` — Innvil's official product bot (NOTED, not built)

> **Explicit instruction: "Take note only, will implement this once the ai mods are
> fully intact."** A new Innvil-owned, platform-wide (not per-panel/tenant) Telegram
> bot with two separated modes: **proactive marketing** (approved-campaign broadcasts
> to stored, authorized destinations — never an unsupervised "cron asks LLM to invent
> a message and auto-sends") and **reactive Innvil product support** (answers human
> questions about Innvil/Moderator/plans/setup grounded in its OWN
> `INNVIL_PRODUCT_KNOWLEDGE` base, stays silent on everything else via a hard
> Coordinator-level scope classifier + confidence threshold — not just prompt text).
> **Full spec (source of truth):** `docs/moderator/innvil-bot-manager-spec.md`.
> **⚠️ Naming collision flagged in the spec:** this is a **different bot** from the
> existing control-plane-only Manager Bot (`TELEGRAM_MANAGER_BOT_TOKEN` in
> `src/lib/moderator/manager.ts`) — that one's whole-codebase invariant is that it
> NEVER posts customer/community-facing content. `innvil_bot_manager` must be its own
> separate credential; pick a non-colliding internal name (e.g. `INNVIL_OFFICIAL_BOT`)
> when implementing. Other key points: gets **priority over customer moderators** for
> Innvil-related questions in a shared group (they suppress/stay silent rather than
> all answering); its marketing broadcasts carry `origin = INNVIL_MARKETING`, which
> customer moderators must NOT `BOT_ACK` or `COMMUNITY_HANDOFF` on by default (avoids
> Mika/Kaleb/Alex piling reactions onto an official announcement); a human replying to
> a marketing post is a normal new HUMAN event the manager answers reactively.

### Phase 4.R: Superadmin PR Generator (NOTED, not built)

> **Explicit instruction: roadmap note only, read-only now — do not implement yet.**
> Add a Superadmin-only PR workflow alongside (but separate from) the existing Generate
> Blog flow. This is a manual external-publication pipeline (for platforms like openPR),
> not an auto-publishing system.

Core product intent and hard constraints:
- New content-generation area includes both **Generate Blog** and **Generate PR**.
- PR generation is **Superadmin-only** at both UI and backend authorization layers.
- Keep existing blog generation fully intact (no regressions).
- Generate at most **one PR per cycle** (default 30 days, configurable).
- Scheduler can check daily, but only generates when eligible.
- Eligibility baseline is **external publication date**:
  `next_generation_date = external_publication_date + interval_days`.
- Do not generate scheduled PRs while latest PR is still Draft/Reviewed/Approved.
- Manual override exists (`Generate PR Now`) with an explicit unpublished-PR warning.
- Never auto-submit to openPR or any external PR platform.

PR lifecycle and publication tracking:
- Statuses: `Draft`, `Reviewed`, `Approved`, `Published Externally`, `Rejected`.
- `Mark as Published` is internal tracking only and must store:
  external URL (required), publication name/date, external headline, notes,
  published_by, published_at.
- This action must NOT publish on Innvil, auto-submit externally, or auto-create
  public content.

Featured Article linkage (optional):
- After PR is marked `Published Externally`, Superadmin may optionally create a
  **Featured Article** draft in Innvil.
- Reuse existing blog/article models; do not create a second public CMS.
- Featured article summarizes the external PR and links out; it must not duplicate
  the full press release body and must remain draft until manually published.

Compliance and fact-grounding direction:
- Follow openPR press-code principles for factual, non-deceptive PR writing:
  https://www.openpr.com/news/presscode.html
- Add a Superadmin-managed PR Fact Library as the primary claims source.
- No fabricated stats/awards/partnerships/testimonials/quotes/superiority claims.
- Claim traceability required (claim -> source/fact entry) and visible in PR detail.
- Include a compliance-review pass (accuracy, unsupported claims, quote checks,
  promotional-vs-editorial distinction, similarity/duplicate-angle checks,
  keyword-stuffing risk) before approval.

Architecture direction for future implementation:
- Reuse existing Innvil systems for AI abstraction, Superadmin auth, blog/article
  models, scheduler/cron, notifications, audit logging, and DB conventions.
- Keep AI credentials server-side only.
- Expected entities (following current conventions): `pr_campaigns`,
  `press_releases`, `pr_fact_library`, `pr_compliance_reports`, `pr_claim_sources`,
  plus optional PR->featured-article relation.
- Generation pipeline stages (separate concerns): angle selection -> fact/source
  gathering -> PR draft generation -> claim validation -> compliance review ->
  similarity review -> optional one-pass regeneration with reviewer feedback.

### Phase 5: Platform Features
- [ ] Payment gateway integration (Cryptomus, Stripe, PayPal) — wires into Phase 4 §7
- [ ] Webhook handling for payment confirmations
- [ ] Customer-facing API with rate limiting
- [ ] Custom domain setup with SSL
- [ ] DNS verification flow
- [ ] SSL certificate management
- [ ] Rate limiting per customer/API key
- [ ] Email notifications (order updates, deposits, support)
- [ ] Referral system for panel owners
- [ ] Promotional codes and discounts

### Phase 6: Testing & Deployment
- [ ] Unit tests for utility functions and hooks
- [ ] Integration tests for order flow
- [ ] Permission and access control testing
- [ ] Customer privacy verification
- [ ] Payment flow testing
- [ ] Provider failure handling
- [ ] UI/UX testing across devices and browsers
- [ ] Performance testing and optimization
- [ ] Security audit
- [ ] Production deployment to Vercel
- [ ] Production Supabase configuration
- [ ] Domain configuration and SSL setup
- [ ] Launch checklist and documentation
- [ ] Post-launch monitoring and analytics

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Encrypts provider + payment-gateway API keys (pgcrypto). Required.
PROVIDER_KEY_SECRET=your_long_random_secret

# Public origin — REQUIRED for crypto deposits (Cryptomus callback/return URLs).
# Must be a public URL for webhooks to reach you (prod/preview or a tunnel).
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Protects the order-status sync cron (/api/cron/sync-orders) AND the blog-draft
# cron (/api/cron/generate-blog). Callers send `Authorization: Bearer <CRON_SECRET>`.
# If unset, the endpoints are open (fine for local testing).
CRON_SECRET=your_long_random_secret

# AI features (blog writer + customer AI support chat). Server-side only. The client
# is provider-agnostic (src/lib/ai/client.ts): it speaks Anthropic's Messages API by
# default, or an OpenAI-compatible one (OpenRouter, Vercel AI Gateway, …) so you can
# use a third-party Claude key. REQUIRED for any AI generation: a key.
#
# INVARIANT: every Innvil-authored AI automation (Natural Chatter, moderator
# replies, community moderation, bot-to-bot conversations, owner/customer
# assistant chat, and any future add-on) MUST run on Claude Sonnet 5, at
# effort "medium" by default — never silently substituted for Fable/Haiku/
# Opus/an older Sonnet/a "cheaper" model. If Sonnet 5 can't be used, the
# operation must fail explicitly (src/lib/ai/client.ts `getInnvilModelConfig()`
# / `assertInnvilModel()`), never silently downgrade. This does NOT gate the
# blog writer's own BLOG_AI_MODEL override below — that's a deliberate,
# human-set per-feature knob, not a silent fallback.
#
# Simplest (Anthropic direct):
ANTHROPIC_API_KEY=your_anthropic_api_key   # (AI_API_KEY also accepted)
#
# Third-party / gateway (OpenAI-compatible), e.g. OpenRouter:
#   AI_PROVIDER=openai
#   AI_API_KEY=sk-or-...                     # your OpenRouter/gateway key
#   AI_BASE_URL=https://openrouter.ai/api/v1 # (default when AI_PROVIDER=openai)
#   AI_MODEL=anthropic/claude-sonnet-5       # provider-specific model id!
#
# Model id (per-feature override exists). Anthropic direct → "claude-sonnet-5";
# OpenRouter/Vercel Gateway → "anthropic/claude-sonnet-5".
AI_MODEL=claude-sonnet-5
# Optional blog-writer-specific model override.
BLOG_AI_MODEL=claude-sonnet-5
#
# Chat streaming (token-by-token replies). OFF by default. Turn ON only with a
# provider that supports SSE streaming (Anthropic direct / OpenRouter) — the
# aiprimetech proxy does NOT stream, so leave this off there. NEXT_PUBLIC_* is
# inlined at build time, so a redeploy applies the change.
# NEXT_PUBLIC_AI_STREAMING=true
#
# --- To switch providers later: set AI_PROVIDER/AI_BASE_URL/AI_API_KEY/AI_MODEL to
#     the new provider, flip NEXT_PUBLIC_AI_STREAMING=true if it streams, redeploy. ---
#
# Fallback provider (optional). If the primary call fails or times out (12s
# per-request cap — see AI_REQUEST_TIMEOUT_MS in client.ts), aiComplete retries
# once against this provider before giving up. Same shape as the primary vars,
# with an AI_FALLBACK_ prefix; a bare model override falls back to the
# primary's model if unset. Current setup (2026-08-08): Anthropic direct is
# PRIMARY (ANTHROPIC_API_KEY, AI_PROVIDER/AI_BASE_URL unset), aiprimetech.io is
# the FALLBACK:
AI_FALLBACK_API_KEY=your_aiprimetech_key
AI_FALLBACK_BASE_URL=https://aiprimetech.io
# AI_FALLBACK_PROVIDER=anthropic   # default; aiprimetech speaks Anthropic-style /v1/messages
# AI_FALLBACK_MODEL=claude-sonnet-5
#
# --- Task-based model routing (Virtual Moderator Natural Chatter only) ---
# CASUAL_CHAT (low-stakes social chatter) routes to a DEDICATED DeepSeek
# provider instead of Sonnet 5 — its own key/base-url/model, entirely
# separate from AI_API_KEY/AI_FALLBACK_* above. ANSWER (substantive,
# knowledge-grounded Q&A) stays hard-locked to Sonnet 5 via
# getInnvilModelConfig() — this carve-out does NOT touch that path or the
# INNVIL_REQUIRED_MODEL invariant above. If DEEPSEEK_API_KEY is unset,
# CASUAL_CHAT generation fails explicitly (GENERATION_FAILED, logged) — it
# NEVER silently falls through to Sonnet. See
# src/lib/ai/client.ts deepseekChatterProvider() and
# src/lib/moderator/chatter-generate.ts resolveChatterRoute().
DEEPSEEK_API_KEY=your_deepseek_key
# DEEPSEEK_BASE_URL=https://api.deepseek.com
# DEEPSEEK_CHATTER_MODEL=deepseek-v4-flash   # next candidate if quality is insufficient: deepseek-v4-pro (explicit config change only, never automatic)
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

*Last updated: 2026-07-09 — Money loop closes end-to-end: §6 owner balance mgmt (Customers tab: real list + manual credit/debit) and §7 Cryptomus crypto deposits with automatic webhook credit (customer Add funds → checkout → confirm → balance auto-updates → order). Customer storefront runs the REAL dashboard on live data; §4 placeOrder forwards to provider/refunds. Run migration 0005; set NEXT_PUBLIC_APP_URL + PROVIDER_KEY_SECRET. Next: order-status sync cron (§4), admin Orders (§5), more gateways.*
