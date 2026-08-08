# Project Knowledge + AI Auto-Posting Spec

> Status: **NOTED — not implemented yet.** This is the source-of-truth spec for a
> new Virtual Moderator capability, captured verbatim as given so no fidelity is
> lost before implementation. See the pointer in `CLAUDE.md` (Phase 4.N) for where
> this sits in the roadmap. Do not implement from memory/paraphrase — implement
> from this file.
>
> Scope boundary (§39 below): this patch is ONLY (A) shared project/business
> knowledge, (B) retrieval for Virtual Moderator Q&A, (C) AI-generated Telegram
> Auto-Posting from the same knowledge, (D) scheduling/publishing architecture,
> (E) grounding/safety/idempotency. It must NOT touch Managed Bot provisioning,
> Manager Bot ownership, order/provider systems, duplicate-order logic, billing/
> commission architecture, Natural Chatter response-selection logic (unless
> needed for shared retrieval), or link moderation behavior.
>
> **IMPORTANT UPDATE (same day, appended below as "AUTO-POSTING UPDATE"):** the
> publishing model in §13–15/§24 above is superseded/clarified — there is NO
> generic Innvil publishing bot. Each Virtual Moderator/ModeratorDeployment is
> itself the visible publisher, with its own configured posting window
> (e.g. Mika 05:00–12:00, Kaleb 13:00–17:00, Alex 18:00–22:00), publishing at
> most one auto-generated post per window per local community day, at a
> RANDOM time that must be generated once and PERSISTED (never re-rolled per
> cron tick). Read that section before implementing scheduling/publishing.
>
> Related, separate note: the user also asked (same conversation) to make the
> `aiprimetech.io` proxy the AI **fallback** once a real Anthropic key is
> available, with direct Anthropic as primary — see `innvil-ai-provider-fallback`
> in memory / the env-var note in `CLAUDE.md`. That is an AI-client routing
> change, independent of this feature, and should not be conflated with it.

Implement a new shared Project Knowledge + AI Auto-Posting capability for Innvil Virtual Moderator.

This instruction extends the existing Virtual Moderator architecture.

The key new product rule is:

The same customer-provided project knowledge should power BOTH:

1. AI Virtual Moderator answers inside Telegram communities
2. AI-generated scheduled Telegram posts

Do not build separate disconnected knowledge systems for those two features.

==================================================
1. CORE PRODUCT MODEL
==================================================

A customer should be able to teach Innvil about their project once.

That knowledge may include:

- project overview
- website
- whitepaper
- documentation
- FAQs
- token/project utility
- roadmap
- products/services
- supported networks/chains
- official Telegram
- official X/Twitter
- Discord
- GitHub
- support links
- contact information
- approved announcements
- important project facts
- community rules
- brand voice / tone
- custom notes entered by the subscriber

This becomes the tenant/community Project Knowledge Base.

The same knowledge should then be usable by:

AI Virtual Moderator
→ answer user questions

AND

AI Telegram Auto-Posting
→ generate scheduled community content

==================================================
2. ONE SOURCE OF TRUTH
==================================================

Do NOT implement:

one knowledge store for Moderator answers

and:

another independent knowledge store for Auto-Posting.

Use one shared, tenant-scoped source of truth.

Conceptually:

ProjectKnowledge
        ↓
Knowledge ingestion/indexing
        ↓
Shared retrieval layer
        ↓
┌────────────────────────┬─────────────────────────┐
│ Virtual Moderator      │ Auto-Posting Engine     │
│ Q&A / support          │ Scheduled content       │
└────────────────────────┴─────────────────────────┘

This is important so the moderator and scheduled posts do not contradict each other.

==================================================
3. KNOWLEDGE SCOPE / ISOLATION
==================================================

Knowledge must be isolated by tenant/customer.

Do not allow Project A knowledge to be retrieved for Project B.

Where the same Virtual Moderator can be deployed to multiple communities, preserve the existing architecture:

base project/business knowledge
→ reusable

community-specific context/memory
→ isolated per Community / ModeratorDeployment

Do not merge community memories globally.

==================================================
4. SUPPORTED KNOWLEDGE INPUTS
==================================================

Inspect existing Innvil storage and upload architecture before implementing.

Support or prepare for inputs such as:

TEXT INPUT:
- project overview
- FAQs
- key facts
- custom notes

URL INPUT:
- website
- docs
- whitepaper URL
- official links

FILE INPUT:
- whitepaper PDF
- documentation files
- other approved project materials

STRUCTURED FIELDS:
- project name
- official website
- Telegram
- X/Twitter
- Discord
- GitHub
- contact/admin
- important links

Do not force all information into one giant text field.

==================================================
5. RETRIEVAL, NOT FULL-DOCUMENT PROMPT STUFFING
==================================================

Do NOT send an entire whitepaper or all customer knowledge into every AI request.

Use retrieval.

Conceptually:

ingest source
→ parse/extract text
→ chunk
→ index/embed using existing infrastructure
→ retrieve relevant chunks for a given task
→ send only relevant context to the model

This applies to BOTH:

- moderator Q&A
- auto-post generation

Reuse existing vector/search infrastructure if present.

Do not introduce a second retrieval system unnecessarily.

==================================================
6. MODERATOR KNOWLEDGE ANSWERS
==================================================

When a community member asks a project/business question:

Example:

"What chains does this project support?"

The moderator should:

1. classify it as a knowledge/business question
2. retrieve relevant project knowledge
3. answer based on retrieved source material
4. avoid inventing unsupported facts
5. stay consistent with the configured moderator personality/tone

Direct @mention is NOT required.

Example:

"Does anyone know where the whitepaper is?"

No @mention.

If Innvil has the answer:

→ moderator may respond naturally

This behavior should remain part of the normal contextual response-selection architecture.

==================================================
7. AUTO-POSTING IS AI-GENERATED CONTENT
==================================================

Telegram Auto-Posting is NOT simply:

"take saved text and send it later."

The content itself should be AI-generated from the subscriber's configured project knowledge.

Example inputs:

Project overview
Whitepaper
Official links
Feature descriptions
FAQs
Roadmap
Brand voice

Then Innvil may generate scheduled content such as:

- educational posts
- feature highlights
- project explanations
- onboarding posts
- FAQ-style posts
- community reminders
- ecosystem explanations
- product/service highlights
- approved link/resource posts
- project utility explanations
- technical concepts rewritten for community audiences

==================================================
8. SOURCE-GROUNDED AUTO-POSTING
==================================================

Generated posts must be grounded in stored customer knowledge.

The model must NOT invent:

- partnerships
- token prices
- APYs/yields
- listings
- roadmap milestones
- audit claims
- security guarantees
- supported chains
- dates
- launch announcements
- integrations
- giveaways
- promotions
- statistics

unless those claims are supported by the available approved project knowledge.

If evidence is insufficient:

do not fabricate content.

Choose another supported topic or return a safe "insufficient source material" result.

==================================================
9. CURRENT / TIME-SENSITIVE FACTS
==================================================

Do not treat a static whitepaper as proof of current information when facts may change.

Examples:

- current APY
- current token price
- active partnerships
- current roadmap status
- exchange listings
- live campaigns
- upcoming AMA dates

Only use current/time-sensitive facts when Innvil has an approved current source for them.

If there is no live/current data source, avoid presenting time-sensitive claims as current.

==================================================
10. OFFICIAL LINKS
==================================================

Auto-generated Telegram posts may include subscriber-configured official links.

Examples:

Website
Whitepaper
Docs
Telegram
X
Discord
GitHub

Use only approved/configured links.

Do not invent URLs.

If the subscriber changes an official link, future generated posts should use the updated value.

==================================================
11. BRAND VOICE
==================================================

Allow subscriber/project configuration for content tone.

Examples:

- professional
- technical
- friendly
- degen/crypto-native
- concise
- educational
- playful
- formal

Auto-posting should follow the configured project/content voice.

The Virtual Moderator personality may have its own persona.

Do not assume these always need to be identical.

Conceptually:

Project Brand Voice
→ scheduled content style

Moderator Persona
→ conversational community behavior

They may overlap, but keep them logically distinct.

==================================================
12. MODEL / EFFORT ROUTING
==================================================

Use task-based model routing rather than one reasoning level for everything.

Preferred initial behavior:

Daily SEO blog generation
→ Sonnet 5
→ medium effort

Telegram scheduled content generation
→ Sonnet 5
→ medium effort

Substantive project/business Q&A
→ Sonnet 5
→ medium effort

Complex whitepaper synthesis
→ medium by default
→ high only when truly needed

Simple chatter:
"hi"
"lol"
"nice"

→ do NOT require the same expensive reasoning path

Emoji/reaction-only:
→ deterministic/no LLM where possible

Moderation:
→ deterministic first
→ AI semantic classification only when useful

Do not hardcode these exact provider/model names deeply into business logic if Innvil already has model abstraction/configuration.

==================================================
13. AUTO-POST SCHEDULING
==================================================

Separate:

CONTENT GENERATION

from:

PUBLISHING/SCHEDULING.

Conceptually:

Scheduler decides:
"Generate a post for this slot"

        ↓

Auto-Posting Engine retrieves relevant project knowledge

        ↓

AI generates grounded post

        ↓

Validate output

        ↓

Publish through selected customer managed bot

Publishing itself should remain deterministic application logic.

The AI does not directly call Telegram on its own.

==================================================
14. CUSTOMER BOT IDENTITY
==================================================

Auto-posts must be published using the subscriber-owned managed Telegram bot selected for that community/deployment.

Never publish customer content using:

TELEGRAM_MANAGER_BOT_TOKEN

The Manager Bot remains control-plane/provisioning infrastructure.

Runtime publishing must use the selected customer managed-bot credential.

==================================================
15. COMMUNITY / DEPLOYMENT TARGETING
==================================================

An Auto-Posting configuration must target the correct:

tenant
community
ModeratorDeployment / bot integration
timezone

Do not publish a post intended for Community A into Community B.

Do not globally publish from a VirtualModerator just because it is reusable.

==================================================
16. TIMEZONE
==================================================

Scheduled posts should use the community/deployment local timezone.

Examples:

09:00 morning post

should mean:

09:00 in that community's configured timezone

not server UTC unless no timezone exists.

Reuse existing timezone infrastructure.

==================================================
17. DUPLICATE / REPETITIVE CONTENT PREVENTION
==================================================

Auto-posting should not generate essentially the same post repeatedly.

Before generating/publishing, inspect recent successful posts.

Use:

- recent topic history
- semantic similarity if infrastructure exists
- link history
- recent content categories

Avoid repeating:

"Here is our whitepaper"
"Check out our whitepaper"
"Read the whitepaper"

three days in a row.

==================================================
18. TOPIC DIVERSITY
==================================================

Where sufficient knowledge exists, rotate naturally between content types.

Examples:

- project overview
- feature highlight
- FAQ
- technical explanation
- documentation/resource
- use case
- ecosystem explanation
- community tip
- utility explanation
- onboarding guidance

Do not hardcode a rigid rotation if the repository already has content strategy abstractions.

==================================================
19. HUMAN-SAFE OUTPUT VALIDATION
==================================================

Before publishing AI-generated Telegram content, validate:

- non-empty text
- Telegram length constraints
- formatting
- supported links
- no placeholder text
- no accidental system prompt leakage
- no secrets
- no raw retrieval metadata
- no unsupported claims where detectable
- no duplicate content
- correct community/deployment
- correct bot credential

If validation fails:

do not publish.

Record safe operational error/state.

==================================================
20. NO SECRET LEAKAGE
==================================================

Knowledge prompts and auto-generated content must never include:

- Telegram bot tokens
- provider API keys
- webhook secrets
- Supabase service keys
- Vercel secrets
- internal system prompts
- encryption secrets
- private tenant metadata not intended for community use

Retrieval must use only approved knowledge-source content.

==================================================
21. KNOWLEDGE SOURCE METADATA
==================================================

Store enough provenance to know where facts came from.

Conceptually:

KnowledgeSource:
- tenantId
- type
- title
- source URL/file
- createdAt
- updatedAt
- active
- lastIndexedAt

KnowledgeChunk:
- sourceId
- text
- embedding/index metadata

Follow existing repository architecture if equivalent entities already exist.

==================================================
22. SOURCE UPDATES / REINDEXING
==================================================

If the customer updates:

- overview
- whitepaper
- docs
- official links
- FAQs

the knowledge index should be refreshed.

Future moderator answers and generated posts should use the updated material.

Do not require recreating the Virtual Moderator or Telegram bot.

==================================================
23. DELETING/DEACTIVATING KNOWLEDGE
==================================================

If a customer removes/deactivates a knowledge source:

future retrieval should stop using it.

Do not continue generating answers/posts from deleted stale material indefinitely.

Respect existing retention policy for audit/history.

==================================================
24. AUTO-POSTING CONFIGURATION
==================================================

Add/prep settings conceptually like:

Auto-Posting
[ enabled ]

Community
[ selected community ]

Bot
[ selected deployed Virtual Moderator ]

Frequency
[ X posts/day or schedule ]

Timezone
[ community timezone ]

Content types
[ optional preferences ]

Brand voice
[ project default / custom ]

Include official links
[ yes/no ]

Do not overbuild UI if current product phase only needs minimal configuration.

==================================================
25. DRAFT / REVIEW MODE
==================================================

Architect this so Auto-Posting can support both:

DRAFT MODE
→ AI generates content
→ user reviews/approves

AUTO-PUBLISH MODE
→ AI generates
→ validates
→ publishes automatically

If only one mode is being implemented now, do not make the data model impossible to extend later.

==================================================
26. TRIAL ENTITLEMENT
==================================================

Important:

The previously approved trial currently excludes:

- AI content generation for campaigns
- autoposting
- automatic/scheduled content publishing

Do NOT silently enable Auto-Posting for the 7-Day Full AI Mod Trial unless product entitlement has explicitly changed.

This new feature should use existing entitlement infrastructure.

Conceptually:

autoPosting.enabled = false
for trial

unless later changed intentionally.

Do NOT scatter:

if (plan === ...)

inside Telegram code.

==================================================
27. MODERATOR REACTIVE RESPONSE QUOTA
==================================================

The trial reactive response limit:

reactiveResponseDailyLimit = 20

does NOT apply to scheduled auto-posting because Auto-Posting is a separate capability.

Likewise:

auto-posted content must not consume:
- reactive response quota
- proactive moderator quota

unless product rules explicitly combine them later.

Keep usage accounting separate.

==================================================
28. AUTO-POSTING VS PROACTIVE MODERATOR SPEECH
==================================================

Do not confuse these concepts.

PROACTIVE MODERATOR:
- GM/GN
- dead-chat revival
- contextual conversation starter
- social engagement

AUTO-POSTING:
- scheduled project/content publication
- educational/project post
- campaign/content engine output

They are separate capabilities.

Proactive trial limit:
2/day

does NOT automatically authorize Auto-Posting.

==================================================
29. COMMUNITY MEMORY VS PROJECT KNOWLEDGE
==================================================

Keep these concepts distinct:

PROJECT KNOWLEDGE
= authoritative customer-provided facts

COMMUNITY MEMORY
= context learned from activity in a specific community

Auto-posting should primarily use:
Project Knowledge

Moderator answers may use:
Project Knowledge
+ appropriate Community context

Do not use casual community rumors as authoritative facts for generated scheduled posts.

==================================================
30. USER-GENERATED COMMUNITY CONTENT
==================================================

Do not automatically absorb every Telegram message into Project Knowledge.

Project Knowledge should come from approved customer-controlled sources.

Community messages may contribute to:
short-term context
community memory
conversation understanding

but should not silently become authoritative project facts.

==================================================
31. WHITEPAPER HANDLING
==================================================

For whitepapers:

- ingest once
- parse/extract text
- chunk
- index
- retrieve relevant sections

Do not resend the entire whitepaper for each generation.

Preserve page/source metadata where practical so future UI/audit may show provenance.

==================================================
32. GENERATED CONTENT SHOULD NOT CLAIM HUMAN ACTION
==================================================

Avoid generated text falsely implying actions/events that have not happened.

Examples to avoid unless supported:

"We just partnered with..."
"We're excited to announce..."
"Our new feature is live..."
"We've reached 100,000 users..."

Do not generate fabricated announcements to fill a schedule.

==================================================
33. FALLBACK WHEN KNOWLEDGE IS TOO THIN
==================================================

If a project has insufficient source material:

do NOT hallucinate a post.

Possible outcomes:

- skip slot
- generate from a safe known topic
- mark "insufficient knowledge"
- request more project information in UI later

Silence/no-post is better than fabricated project information.

==================================================
34. CONTENT HISTORY
==================================================

Record generated/published content metadata.

Conceptually:

- tenant
- community
- deployment/bot
- generatedAt
- scheduledFor
- publishedAt
- status
- topic/category
- final text
- source references or source IDs where appropriate
- Telegram message ID
- model/task metadata if existing analytics supports it

Avoid storing unnecessary chain-of-thought/internal reasoning.

==================================================
35. IDEMPOTENCY
==================================================

Scheduled publishing must be idempotent.

If cron/job retries:

do not publish the same scheduled content twice.

Use a stable schedule/job/content identifier.

Example:

same schedule occurrence
→ max one successful Telegram post

==================================================
36. FAILED PUBLISHING
==================================================

If generation succeeds but Telegram publish fails:

do not silently mark as published.

Store appropriate state such as:
generated
publish_failed

Allow retry according to existing job architecture.

Do not regenerate a completely different post on every retry unless intentional.

==================================================
37. REQUIRED TESTS — KNOWLEDGE
==================================================

Add focused tests for:

1.
Project overview contains supported chains.

User asks:
"What chains do you support?"

→ moderator retrieves relevant knowledge
→ correct grounded answer

2.
Question not covered by knowledge.

→ moderator does not fabricate definitive fact

3.
Updated whitepaper/source.

→ future retrieval uses updated index

4.
Tenant A and Tenant B knowledge.

→ no cross-tenant retrieval

5.
Community-specific memory exists.

→ does not become global authoritative Project Knowledge

==================================================
38. REQUIRED TESTS — AUTO-POSTING
==================================================

1.
Configured project knowledge exists.

Scheduled content generation
→ creates grounded Telegram post

2.
Whitepaper contains Feature X.

Generated educational post about Feature X
→ grounded in retrieved source

3.
No source supports a partnership claim.

→ generator must not invent partnership

4.
Official links configured.

→ generated link uses configured official URL

5.
Source updated.

→ future generated content uses updated information

6.
Recent post is semantically similar.

→ duplicate/repetitive output suppressed or regenerated

7.
Auto-post job retried.

→ one Telegram publication maximum

8.
Telegram send fails.

→ not marked published
→ safe retry behavior

9.
Trial entitlement.

→ Auto-Posting unavailable if trial still excludes it

10.
Reactive moderator quota = 20/20.

→ Auto-Posting entitlement/accounting remains separate

11.
Proactive quota = 2/2.

→ Auto-Posting remains separate

12.
Customer managed bot credential selected.

→ post executes as customer bot
→ Manager Bot credential never used for runtime posting

==================================================
39. DO NOT OVER-SCOPE
==================================================

Do not modify:

- Managed Bot provisioning architecture
- Manager Bot ownership model
- order/provider systems
- duplicate-order logic
- billing/commission architecture
- Natural Chatter response-selection logic unless needed for shared retrieval
- link moderation behavior

This implementation is specifically:

A. shared project/business knowledge
B. retrieval for Virtual Moderator Q&A
C. AI-generated Telegram Auto-Posting from the same knowledge
D. scheduling/publishing architecture
E. grounding/safety/idempotency

==================================================
40. IMPLEMENTATION PROCESS
==================================================

Before editing:

1. inspect any existing knowledge/business-info fields
2. inspect current VirtualModerator schema
3. inspect Community / ModeratorDeployment schema
4. inspect existing AI abstraction
5. inspect current blog writer/content-generation patterns
6. inspect file upload/storage architecture
7. inspect vector/search/RAG infrastructure if present
8. inspect Telegram outbound action execution
9. inspect cron/job scheduling infrastructure
10. inspect entitlement infrastructure
11. inspect activity/content history models

Reuse existing systems instead of creating duplicate infrastructure.

==================================================
41. FINAL PRODUCT INVARIANT
==================================================

The customer should experience:

"I teach Innvil about my project once."

Then:

Virtual Moderator
→ knows how to answer project questions

Auto-Posting
→ knows what project content to publish

Both:
→ use the same authoritative customer-controlled knowledge
→ remain tenant isolated
→ do not invent unsupported claims
→ use the correct customer-managed Telegram bot identity

The knowledge base is the shared source of truth.

Implement this architecture with the smallest safe, extensible patch.

After implementation run:

npx tsc --noEmit

relevant tests

npm run build

Fix failures before completion.

In the final report include:

- files changed
- knowledge data model
- ingestion/indexing approach
- retrieval flow
- how Moderator Q&A uses retrieval
- how Auto-Posting uses the same retrieval
- entitlement behavior
- scheduling/idempotency behavior
- grounding safeguards
- tests added
- typecheck/test/build results

---

# AUTO-POSTING UPDATE — Per-Moderator Posting Windows (same day, supersedes §13–15/§24 above)

> **Status: NOTED — not implemented yet.** This is a critical correction to the
> base spec above, given verbatim. The core rule: **the AI Virtual Moderators
> themselves are the visible Telegram publishers — there is no separate generic
> Innvil publishing bot.** Read this section in full before implementing any
> scheduling/publishing code from the base spec's §13–15/§24.

IMPORTANT AUTO-POSTING UPDATE

The AI Virtual Moderators themselves are the visible Telegram publishers.

Do NOT create a separate generic Innvil publishing bot.

Each scheduled content window belongs to a specific Virtual Moderator / ModeratorDeployment, and the content must be published using that moderator's subscriber-owned managed Telegram bot credential.

Example configuration:

Moderator 1 — Mika
Posting window:
05:00 → 12:00

Moderator 2 — Kaleb
Posting window:
13:00 → 17:00

Moderator 3 — Alex
Posting window:
18:00 → 22:00

Each moderator may publish AT MOST ONE auto-generated post inside its assigned window for that local community day.

Innvil chooses the actual publish time randomly within the configured window.

==================================================
1. VISIBLE PUBLISHER
==================================================

Auto-generated Telegram content must be published by the selected AI Moderator.

Example:

Mika's scheduled slot
→ generate content using shared Project Knowledge
→ publish through Mika's managed-bot token
→ Telegram visibly shows Mika as sender

Kaleb's slot
→ publish through Kaleb's managed-bot token

Do NOT use:

TELEGRAM_MANAGER_BOT_TOKEN

for community publishing.

Manager Bot remains provisioning/control-plane infrastructure only.

==================================================
2. SCHEDULE MODEL
==================================================

Allow subscriber to configure one or more moderator posting windows.

Conceptually:

AutoPostWindow {
    communityId
    moderatorDeploymentId
    startLocalTime
    endLocalTime
    enabled
}
    
Example:

Mika:
05:00 - 12:00

Kaleb:
13:00 - 17:00

Alex:
18:00 - 22:00

Use actual repository naming conventions.

==================================================
3. ONE POST MAXIMUM PER WINDOW
==================================================

Each configured window represents:

AT MOST ONE successful scheduled publication
per local community day.

Do NOT interpret:

05:00 - 12:00

as permission to repeatedly post throughout those seven hours.

It means:

choose one eligible time somewhere inside that window
→ generate/publish one post
→ window is complete for the day

==================================================
4. RANDOM TIME WITHIN WINDOW
==================================================

For each local community day, select a random scheduled time inside the configured window.

Example:

configured:
05:00 - 12:00

possible generated schedule:

today:
08:17

tomorrow:
10:42

next day:
06:28

The exact time should vary naturally.

Do not always publish at:
05:00
08:00
12:00

unless explicitly configured as a fixed-time schedule later.

==================================================
5. RANDOM TIME MUST BE PERSISTED
==================================================

CRITICAL:

Do NOT calculate a new random time every time the scheduler runs.

Bad implementation:

cron runs every 5 minutes
→ random() says "publish now?"
→ eventually publishes

This makes behavior unpredictable and can produce duplicates.

Instead:

generate one target timestamp for that window/day
→ persist it
→ scheduler checks against that persisted timestamp

Conceptually:

AutoPostOccurrence {
    autoPostWindowId
    localDate
    scheduledFor
    status
    generatedContentId?
    publishedAt?
}

Unique:

autoPostWindowId + localDate

This guarantees one occurrence per window/day.

==================================================
6. IDEMPOTENCY
==================================================

The scheduler may run repeatedly.

Example:

cron every 5 minutes.

At 08:15:
scheduledFor = 08:17
→ do nothing

At 08:20:
scheduledFor <= now
→ execute occurrence

If cron retries again:

status = published
→ do nothing

A window/day must never publish twice because of:

- cron retries
- Vercel retries
- database retries
- duplicate jobs
- Telegram timeout ambiguity

Use database-level/idempotent protection where appropriate.

==================================================
7. COMMUNITY LOCAL TIMEZONE
==================================================

Posting windows use the COMMUNITY'S LOCAL TIMEZONE.

Example:

Community timezone:
Asia/Manila

Mika:
05:00 - 12:00

means:

05:00-12:00 Asia/Manila

not UTC.

Reuse the same timezone semantics used for:

- proactive moderator quota
- reactive trial quota
- local community day

==================================================
8. WINDOWS CROSSING MIDNIGHT
==================================================

Support or explicitly validate overnight windows.

Example:

22:00 → 02:00

If supported:

treat it as one logical posting window crossing midnight.

If the existing scheduler cannot safely support this yet:

reject such configuration with a clear validation message rather than implementing ambiguous behavior.

Do NOT accidentally treat:

22:00 → 02:00

as invalid negative duration and schedule incorrectly.

==================================================
9. WINDOW OVERLAP
==================================================

Allow multiple moderators to have different windows.

If windows overlap:

Mika:
08:00 - 12:00

Kaleb:
10:00 - 14:00

both can technically have one occurrence.

However, Community Coordinator / posting scheduler should avoid unnatural near-simultaneous publications.

Add a configurable or reasonable minimum spacing between automated content posts in the same community.

Example:

Mika scheduled 10:51
Kaleb scheduled 10:58

Do not publish both seven minutes apart if the configured pacing policy says they should be spaced.

Resolve collision safely, preferably when occurrences are generated.

==================================================
10. DO NOT RANDOMIZE MODERATOR IDENTITY
==================================================

If the subscriber assigns:

05:00-12:00 → Mika

then Mika publishes that occurrence.

Do not randomly choose another moderator.

The user is explicitly assigning:

moderator
+
time window

==================================================
11. SHARED PROJECT KNOWLEDGE
==================================================

Each moderator's auto-post generation uses the same authoritative tenant Project Knowledge system defined previously.

Knowledge may include:

- overview
- website
- whitepaper
- docs
- FAQs
- roadmap
- products
- official links
- project facts
- approved announcements

Auto-post content should be grounded in that knowledge.

The moderator's PERSONALITY affects how the post is written.

Conceptually:

Shared Project Knowledge
        +
Mika's Persona
        ↓
Mika's Telegram post

Shared Project Knowledge
        +
Kaleb's Persona
        ↓
Kaleb's Telegram post

Therefore different moderators may naturally have different voices while remaining factually consistent.

==================================================
12. MODERATOR ROLE MAY INFLUENCE TOPIC
==================================================

Where moderator roles/personas exist, use them intelligently.

Example:

Mika:
community host

May publish:
- onboarding
- community reminders
- friendly project explanations

Kaleb:
technical specialist

May publish:
- technical features
- whitepaper explanations
- protocol concepts

Alex:
news/community specialist

May publish:
- approved ecosystem information
- project resources

Do NOT fabricate role-specific facts.

All factual claims still come from Project Knowledge.

==================================================
13. CONTENT SHOULD NOT BE PRE-GENERATED TOO EARLY
==================================================

Be careful about generating content days in advance.

Knowledge may change before publication.

Preferred behavior:

schedule/persist the occurrence time in advance

but generate the actual content reasonably close to execution time.

Conceptually:

Day begins
→ create today's occurrence
→ scheduledFor = 08:17

08:17 arrives
→ retrieve CURRENT Project Knowledge
→ generate content
→ validate
→ publish

This helps prevent stale content.

==================================================
14. GENERATION FAILURE
==================================================

If generation fails at the scheduled time:

do NOT immediately mark the occurrence as published.

Use state such as:

scheduled
generating
generated
publishing
published
failed

or repository-equivalent states.

Allow bounded retry.

Do not produce multiple different Telegram posts because generation was retried.

==================================================
15. PUBLISH FAILURE
==================================================

If content was generated successfully but Telegram publishing fails:

retain the generated content.

Retry publishing that SAME content when appropriate.

Do not regenerate another post on every publish retry.

This avoids:

attempt 1 → Post A
attempt 2 → Post B
attempt 3 → Post C

for one scheduled occurrence.

==================================================
16. MISSED WINDOW
==================================================

Define explicit behavior if the system is unavailable until after the window ends.

Example:

Mika:
05:00 - 12:00

scheduledFor:
09:37

system recovers:
14:00

Preferred initial behavior:

SKIP the missed occurrence

rather than posting outside the subscriber's configured window.

Record:

status = missed

Do not suddenly publish all missed automated posts at once.

Allow product configuration later if catch-up publishing is desired.

==================================================
17. SCHEDULE EDITS
==================================================

If subscriber changes a future window:

05:00-12:00
→
07:00-10:00

future occurrences should follow the updated schedule.

For today's already-created occurrence:

define predictable behavior.

Preferred:

if occurrence has NOT published and its scheduled time has not passed:
→ recalculate once according to updated window

if already published:
→ leave history unchanged

Avoid creating a second occurrence for the same window/day.

==================================================
18. DISABLING AUTO-POST
==================================================

If subscriber disables:

Auto-Posting

or disables that specific window before execution:

pending occurrence should not publish.

Mark/cancel it appropriately.

Do not delete historical publication records.

==================================================
19. MODERATOR DEPLOYMENT MUST BE ACTIVE
==================================================

Before publishing verify:

- VirtualModerator still exists
- ModeratorDeployment is ACTIVE
- Telegram integration is valid
- community still matches deployment
- managed-bot credential is available
- Auto-Posting entitlement still permits execution
- window remains enabled

If any prerequisite fails:

do not publish.

==================================================
20. PUBLISH AS THE ASSIGNED MODERATOR
==================================================

The outbound action must use:

assigned ModeratorDeployment
        ↓
its TelegramBotIntegration
        ↓
encrypted subscriber managed-bot credential
        ↓
Telegram sendMessage/sendPhoto/etc.

Never infer bot identity from username.

Use stored Telegram bot ID / integration relationship.

==================================================
21. CONTENT HISTORY ACROSS MODERATORS
==================================================

Duplicate-content prevention should be COMMUNITY-wide, not only per moderator.

Example:

Mika posted yesterday:

"Here's what our staking feature does..."

Kaleb should not publish effectively the same explanation today just because Kaleb is a different bot.

Check recent community Auto-Post history across all Innvil moderators deployed there.

==================================================
22. NATURAL MULTI-MODERATOR FEEL
==================================================

The system should feel like several human moderators taking different shifts.

Example:

08:37 — Mika:
friendly educational post

15:12 — Kaleb:
technical explanation

20:41 — Alex:
community/resource post

Not:

08:00 Mika
08:01 Kaleb
08:02 Alex

Use scheduling windows and collision spacing to preserve natural pacing.

==================================================
23. DO NOT COUNT AUTO-POST AS CHATTER
==================================================

Scheduled Auto-Posting is separate from:

reactiveResponseDailyLimit = 20

and separate from:

proactiveDailyLimit = 2

A successfully scheduled Auto-Post consumes its own Auto-Posting entitlement/usage only.

Do NOT subtract it from:

reactive chatter quota
or
proactive engagement quota

==================================================
24. TRIAL REMAINS EXCLUDED
==================================================

Keep the previously approved trial policy:

7-Day Full AI Mod Trial

does NOT include:

- AI Auto-Posting
- scheduled content generation
- automatic content publishing

Do not enable these schedule windows for trial merely because the trial moderator exists.

Use entitlement architecture.

==================================================
25. UI
==================================================

Provide a natural schedule editor following existing Innvil UX.

Conceptually:

AUTO-POSTING

Moderator
[Mika ▼]

Posting Window
From [05:00]
To   [12:00]

[X] Enabled

+ Add posting window

Then:

Moderator
[Kaleb ▼]

From [13:00]
To   [17:00]

Moderator
[Alex ▼]

From [18:00]
To   [22:00]

Helper text:

"Each moderator will publish once at a random time within its assigned window."

Do not imply the bot posts continuously during that range.

==================================================
26. OPTIONAL PREVIEW
==================================================

If easy within current architecture, show:

Mika
05:00-12:00
1 post/day

Kaleb
13:00-17:00
1 post/day

Alex
18:00-22:00
1 post/day

Do NOT expose the exact random scheduled minute far in advance unless product UX intentionally wants that.

The point is for posting to feel natural rather than mechanically scheduled.

==================================================
27. VALIDATION
==================================================

Validate:

- start/end values
- valid timezone
- moderator is actually deployed in selected community
- user has permission to configure it
- entitlement permits Auto-Posting

Do not allow assigning a Virtual Moderator that is not deployed in that community.

==================================================
28. REQUIRED TESTS
==================================================

TEST 1

Mika window:
05:00-12:00

Generate daily occurrence.

Expected:
scheduledFor lies inside that local-time window.

TEST 2

Scheduler runs repeatedly during window.

Expected:
one successful publication maximum.

TEST 3

Mika:
05:00-12:00

Kaleb:
13:00-17:00

Expected:
each gets its own one-per-window occurrence.

TEST 4

Three moderators / three windows.

Expected:
maximum three scheduled posts that day,
one from each assigned moderator.

TEST 5

Cron retries after successful publish.

Expected:
no duplicate Telegram message.

TEST 6

Generation succeeds, publish fails.

Expected:
retry same generated content,
not generate endless replacements.

TEST 7

Window expires before service recovers.

Expected:
mark missed / skip,
do not dump late posts.

TEST 8

Subscriber disables window before publish.

Expected:
no publication.

TEST 9

ModeratorDeployment becomes inactive.

Expected:
no publication.

TEST 10

Telegram username changes but integration bot ID remains same.

Expected:
correct moderator still publishes.

TEST 11

Two windows randomly schedule posts very close together.

Expected:
community-level spacing/collision policy prevents unnatural cluster.

TEST 12

Recent Mika post and candidate Kaleb post are semantically duplicated.

Expected:
regenerate/select another topic or skip according to policy.

TEST 13

Project knowledge changes before scheduledFor.

Expected:
content generation uses current knowledge at execution time.

TEST 14

Trial tenant attempts Auto-Posting.

Expected:
entitlement rejects it.

TEST 15

Reactive response quota = 20/20.

Expected:
paid Auto-Posting remains unaffected.

==================================================
29. PRODUCT INVARIANT
==================================================

The subscriber experience should be:

"I have three AI moderators taking different content shifts."

Example:

Mika
→ sometime between 5 AM and 12 PM
→ exactly one post

Kaleb
→ sometime between 1 PM and 5 PM
→ exactly one post

Alex
→ sometime between 6 PM and 10 PM
→ exactly one post

Each post:

- comes visibly from that AI moderator
- reflects that moderator's personality
- uses the same authoritative Project Knowledge
- uses the subscriber-owned managed bot
- occurs once within the configured window
- does not duplicate another moderator's recent content

Do not turn this into a generic central publishing account.

The AI moderators themselves are the publishers.
