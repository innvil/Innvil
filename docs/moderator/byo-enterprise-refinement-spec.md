# Innvil Watch BYO Enterprise refinement — full spec (verbatim, source of truth)

> **STATUS: NOTED, NOT BUILT.** Sent by the user in full during the 2026-08-19 session,
> alongside the Watcher Presence Scheduling spec (see
> `docs/moderator/watcher-presence-scheduling-spec.md`). Explicit sequencing
> instruction: **both are to be implemented only after current Telegram/moderation
> testing and debugging is complete and confirmed stable.** Only the real Watch
> usage-limit work (v1.47.16, `MODERATOR_AI_RESPONSE_POOL` tracking/enforcement) was
> authorized to proceed in that same session. See CLAUDE.md's "Phase 4.V" entry for a
> condensed summary and cross-references to the relevant existing architecture
> (`watch-enterprise.ts` — currently pricing/copy only, no BYO account-mode/
> credential storage exists yet; `watch-ai-usage.ts` — the new real usage-tracking
> layer this must extend rather than duplicate; the provider-key pgcrypto encryption
> pattern already used for SMM provider keys and payment-gateway credentials).
>
> **Two drafts were sent this session** — an earlier, shorter BYO heredoc (positioned
> BYO as a secondary Enterprise refinement) and this LATER, more complete one (explicit
> "BYO IS A MAJOR WATCH OFFERING" positioning, with landing-page prominence, hierarchical
> usage policy, and expanded provider-telemetry sections). **This file is the later,
> superseding version** — implement from this one, not from memory of the earlier draft.

The verbatim instructions below are reproduced exactly as given, for implementation
reference once work on this phase actually begins — do not summarize/paraphrase away
detail when implementing; read this file directly.

---

Implement the next Innvil Watch BYO Enterprise refinement — but ONLY after all currently active debugging/testing work is complete and the repo is clean/stable.

This is a separate feature phase.

Do NOT mix this into:
- current Telegram/moderation debugging
- Watcher Presence Scheduling work
- unrelated billing changes
- normal self-serve plan behavior

Before starting:
- run `git status`
- read the latest `CLAUDE.md`
- confirm current testing/debugging is complete
- inspect the actual Enterprise/BYO implementation
- inspect canonical plan/entitlement configuration
- inspect Usage
- inspect provider/runtime abstractions
- inspect current Watcher execution path
- inspect billing/subscription mode representation
- inspect landing-page Watch/Enterprise content
- inspect migrations/RLS
- inspect current tests
- identify the smallest coherent architecture before editing
- preserve existing business/runtime logic unless a small compatibility change is genuinely required
- do not deploy automatically

======================================================================
CANONICAL PRODUCT MODEL
======================================================================

Innvil Watch remains one product/domain/runtime.

Within Watch:

Innvil Watch
├── Managed Watch
└── BYO Enterprise
    └── Bring Your Own Provider

BYO is NOT:
- a separate Innvil product
- a separate domain
- a separate CRM
- a separate dashboard
- a replacement for standard Watch architecture

BYO customers use the same Watch CRM and receive additional BYO-specific capabilities where relevant.

Managed Enterprise remains a valid alternative for customers who do not want to manage their own provider infrastructure.

Preserve the existing Enterprise commercial/pricing architecture.

Do NOT invent new pricing in this task.

======================================================================
BYO IS A MAJOR WATCH OFFERING
======================================================================

BYO Enterprise should no longer be positioned as an obscure advanced option buried inside Enterprise settings.

Treat BYO as one of the PRIMARY commercial/product offers of Innvil Watch.

It should receive strong public landing-page visibility and meaningful CTA treatment.

The landing page should make it obvious that customers have two broad ways to use Watch:

1. Innvil-managed Watchers / Managed Watch
2. BYO Enterprise — bring your own AI/provider infrastructure while using Innvil Watch as the Community operations/orchestration/control layer

Do not make BYO visually dominate the entire Watch brand, but it should feel like a first-class offer rather than a footnote.

======================================================================
PUBLIC LANDING PAGE POSITIONING
======================================================================

Inspect the current Watch landing page first.

Integrate BYO into the existing design rather than adding redundant sections.

BYO should have at least one prominent landing-page section/card and a meaningful CTA near an appropriate product/pricing decision point.

Potential messaging direction:

Bring Your Own AI Provider

Already have your own AI infrastructure?

Connect it to Innvil Watch and use the same Watcher orchestration, moderation controls, scheduling, usage visibility, and Community operations layer while keeping control of your provider.

Lower Innvil platform fees than the equivalent Managed Enterprise configuration.
Provider usage is billed separately by your provider.

[ Explore BYO Enterprise ]

Also consider a smaller secondary CTA earlier on the page, such as:

Running your own AI stack?
Explore BYO Enterprise →

Adapt wording to the actual current landing-page tone.

Important:
- do NOT claim guaranteed total-cost savings
- do NOT claim Innvil pays provider usage
- do NOT imply provider setup is automatic if it is manual
- clearly disclose provider usage/cost is separate
- preserve Managed Enterprise as the alternative
- do not advertise unsupported provider capabilities
- do not add fake logos/providers simply for marketing
- only advertise features actually implemented in this task or already supported

BYO should be represented in pricing/Enterprise comparison where appropriate, but do not duplicate the same copy in several places.

======================================================================
BYO VALUE PROPOSITION
======================================================================

BYO Enterprise value proposition:

The customer brings their own supported provider/API infrastructure.

Innvil Watch remains the:
- Community Operations CRM
- Watcher orchestration layer
- moderation/control layer
- scheduling layer
- Activity/observability layer
- usage visibility/control layer
- operational policy layer

Potential benefits to communicate, only when genuinely implemented:
- use your own supported AI provider
- maintain control over provider/model configuration
- use the same Innvil Watch CRM
- monitor Watcher/API usage through Innvil
- configure how much of the customer's provider Innvil Watch may consume
- apply Watcher/Community operational limits where supported
- use Watcher Presence Scheduling
- lower Innvil platform fees than equivalent Managed Enterprise service
- provider charges remain directly the customer's responsibility

Again:
Lower Innvil fee does NOT equal guaranteed lower total cost.

======================================================================
SAME DASHBOARD, DIFFERENT CAPABILITIES
======================================================================

Do NOT create a new BYO dashboard.

BYO Enterprise should use the existing Watch CRM.

Normal/Managed Watch continues to have the existing navigation.

BYO Enterprise gains additional capabilities only where appropriate.

Examples:

Existing Watch CRM:
- Overview
- Projects
- Communities
- Watchers
- Activity
- Usage
- Plans/Billing where applicable
- Settings

BYO may additionally expose:
- Provider / API Management
- BYO Usage Controls
- provider/model visibility
- provider/runtime telemetry
- rate/usage controls

Use the existing navigation architecture.

Do not create an entire second navigation tree.

======================================================================
PROVIDER / API MANAGEMENT
======================================================================

Add an appropriate BYO-only Provider/API Management experience.

Inspect existing Settings/Enterprise patterns and choose the cleanest placement.

Potential placement:
- Settings → Provider/API
or
- a compact Enterprise/API Management destination

Choose based on actual current architecture.

The BYO customer should be able to manually configure supported provider connection details.

Only expose what the actual runtime supports.

Potential fields where supported:
- provider
- model
- API credential
- endpoint/base URL
- provider-specific options already represented by the runtime

Do not invent provider support.

Do not create a UI for a provider/model combination the runtime cannot actually use.

======================================================================
CUSTOMER CONTROLS HOW INNVIL MAY USE THEIR API
======================================================================

This is a core BYO requirement.

The customer is not merely supplying an API key.

They must be able to configure HOW Innvil Watch may use their provider/API.

Canonical distinction:

Provider configuration
= how Innvil Watch connects to the customer's provider

BYO usage policy
= how much and in what ways Innvil Watch is authorized to use that provider

These controls are customer-owned operational guardrails.

They are NOT modifications to Innvil's commercial plan definition.

Examples of configurable controls, only where measurable and enforceable:

Account-level:
- maximum provider/API requests per month
- maximum provider token usage per month where reliably measurable
- maximum AI responses/messages per hour/day/month
- maximum proactive messages per hour/day
- provider/model restrictions

Community-level:
- Community request/message budget
- Community proactive-message limits
- Community provider/model override where architecture supports it

Watcher/deployment-level:
- per-Watcher API request ceiling
- per-Watcher proactive-message ceiling
- per-Watcher provider/model assignment where current routing cleanly supports it

Do NOT expose a configurable control unless Innvil Watch can genuinely enforce it server-side.

No decorative sliders/toggles.

======================================================================
HIERARCHICAL USAGE POLICY
======================================================================

Where the architecture supports it cleanly, prefer:

Account BYO policy
↓
Community override
↓
Watcher/deployment override

Do not over-engineer the hierarchy.

If only account + Watcher is justified initially, implement only that.

Rules:
- child policy must not exceed an applicable parent ceiling
- inherited values must be clearly distinguished from overridden values
- customer overrides never mutate global Enterprise/plan config
- account isolation required

Example:

Account:
2,000,000 provider tokens/month

Community A:
1,000,000 tokens/month

Kwan:
250,000 tokens/month

The effective policy must respect the tightest applicable ceiling.

======================================================================
SECRET HANDLING
======================================================================

Provider credentials are secrets.

Requirements:
- never return stored plaintext credentials to browser after persistence
- never log plaintext credentials
- never include credentials in Activity
- never put credentials in client-accessible state unnecessarily
- use the repo's established secure secret/encryption mechanism if one exists

If no acceptable secure mechanism exists:
STOP and report the architecture gap before implementing insecure storage.

UI may show:
API key
••••••••••••••••
Updated Aug 19

[ Replace credential ]

Do NOT provide a reveal-existing-key feature.

======================================================================
BYO PROVIDER USAGE TRACKING
======================================================================

Innvil can track BYO provider usage ONLY when Innvil has reliable telemetry.

Do NOT pretend Innvil can observe calls made completely outside Innvil.

Inspect the current runtime.

Preferred model where compatible:

Watcher runtime
→ Innvil provider adapter/gateway
→ customer's configured provider

When Innvil makes/proxies the request, record actual measurable usage.

Potential telemetry:
- account
- Project
- Community
- Watcher
- deployment
- provider
- model
- timestamp
- request count
- input tokens where provider reports them
- output tokens where provider reports them
- latency
- success/error status
- provider response metadata where safe
- estimated cost ONLY if a reliable canonical pricing source already exists

Do NOT fabricate:
- token counts
- provider spend
- dollar estimates
- request counts

If a provider does not report a metric reliably:
show unavailable rather than silently estimating.

======================================================================
USAGE PAGE — ALL WATCH PLANS
======================================================================

Refine the existing Watch Usage page so all customers can see the monthly/current-period limits that were already approved in the canonical product model.

IMPORTANT:
Do not invent new limits.

Inspect:
- canonical plan config
- entitlement helpers
- current usage counters
- billing/current-period logic

If approved monthly limits are not actually represented centrally in the codebase:
STOP and report exactly what is missing rather than inventing numbers.

For supported metrics, the Usage page should show actual consumption against the plan's canonical limit.

Conceptually:

AI responses
4,120 / 10,000

Messages
18,400 / 50,000

Current period
Aug 15 – Sep 14

Use real values only.

Do not turn Usage into another Plans page.

======================================================================
NORMAL SELF-SERVE PLAN USAGE
======================================================================

Bronze
Silver
Gold
Platinum

can VIEW:
- current usage
- canonical monthly/current-period limit
- percentage/progress
- current reset/period information

They CANNOT customize those limits.

Normal plan limits are controlled by Innvil.

Do not render editable usage controls for normal plans.

Do not create hidden mutation endpoints that let normal customers modify them.

======================================================================
BYO USAGE CONTROLS
======================================================================

BYO Enterprise gets both:

1. Usage reporting
2. Customer-controlled operational usage policy

Usage should conceptually show:

Provider/API requests
7,420 / 25,000 configured ceiling

Tokens
8.4M / 20M configured ceiling

Kwan proactive messages
84 / 200 today

Exact metrics must come from actual runtime telemetry.

The Usage page should clearly distinguish:

Innvil commercial/contract entitlement
vs
Customer-configured BYO operational ceiling

Do not blur those concepts.

======================================================================
SERVER-SIDE ENFORCEMENT
======================================================================

BYO usage policy must be enforced before Innvil makes eligible provider calls.

For every controlled provider/runtime operation:

1. derive account from authenticated/runtime context
2. resolve BYO eligibility
3. resolve provider configuration
4. resolve effective customer usage policy
5. resolve current usage
6. enforce the applicable limit
7. make provider call only if allowed
8. record measurable usage exactly once
9. attribute it correctly

Do not trust browser-provided account IDs or limits.

Use race-safe/idempotent accounting where concurrency/retries matter.

When a limit is reached:
- fail/suppress deterministically
- expose clear operational state
- record useful Activity where appropriate
- do not repeatedly retry the same blocked proactive action

======================================================================
CRITICAL RUNTIME SEPARATION
======================================================================

Keep these categories separate:

1. Core moderation/safety enforcement
2. Reactive conversational AI
3. Proactive/social messages
4. Presence Scheduling messages
5. Provider/API calls

A conversational or proactive BYO cap must not automatically disable unrelated scam/phishing enforcement.

If a specific moderation capability itself requires the BYO provider and the customer exhausts that provider budget:
- handle it explicitly
- show the degraded capability honestly
- do not silently claim moderation is fully available
- do not bypass the customer's configured provider limit

Do not use one generic "messages remaining" switch for all runtime behavior.

======================================================================
WATCHER PRESENCE SCHEDULING INTERACTION
======================================================================

Presence Scheduling is a separate Watch feature.

Do not change its ownership model.

Presence Schedule remains deployment/community operational configuration.

If a scheduled presence transition causes an AI/provider request:
- enforce BYO policy first
- record provider usage once
- count actual sent proactive message appropriately
- retries must not double-count
- scheduler polling itself must not count as usage

If a scheduled presence message is blocked by BYO policy:
- suppress deterministically
- avoid retry spam
- record useful Activity if appropriate
- do not affect core moderation

======================================================================
MONTHLY / CURRENT-PERIOD SEMANTICS
======================================================================

Inspect existing subscription-period implementation.

Do not automatically assume calendar month.

If canonical usage period is:
current_period_start → current_period_end

use it.

If the existing product has a separate canonical monthly operational period:
use that.

Make UI wording accurate.

Annual subscriptions may still use monthly operational allowances only if that is already the approved product behavior.

Do not invent annual usage semantics.

======================================================================
USAGE ACCOUNTING
======================================================================

Usage accounting should be durable.

Requirements:
- account-scoped
- correctly attributed
- timestamped
- idempotent where retryable
- safe under concurrent calls
- no duplicate counting from retries
- no cross-account leakage

Prefer an append-only usage-event model plus aggregation if consistent with existing architecture.

Do not create an expensive unbounded query on every Usage page render if a canonical aggregation pattern already exists.

======================================================================
PROVIDER HEALTH / OBSERVABILITY
======================================================================

Where technically supported, show useful provider status based on actual observed state:

- Configured
- Not configured
- provider/model
- last successful request
- last provider error
- recent request volume

Do not create fake "healthy" indicators.

Do not continuously ping provider APIs simply to display a green dot unless the architecture already supports safe health checks.

Prefer observed runtime telemetry.

======================================================================
PROVIDER / MODEL ASSIGNMENT
======================================================================

Inspect current AI routing.

If cleanly supported, allow BYO assignment of provider/model at the appropriate scope.

Possible scope:
- account default
- Community override
- Watcher/deployment override

But do not create a complex provider-routing system without architectural justification.

If provider selection is account-wide today, preserve that unless there is a clear, tested reason to expand it.

Any provider assignment must preserve:
- Watcher Persona
- Project knowledge
- moderation behavior
- deployment semantics
- Coordinator/single-enforcer behavior
- zero-Panel Watch ownership

======================================================================
ACCESS CONTROL
======================================================================

BYO-specific editable UI must only appear for BYO Enterprise accounts.

Managed Enterprise:
- does not get BYO credential/API controls unless already part of the canonical Managed model

Bronze/Silver/Gold/Platinum:
- never get BYO editable controls

Server actions/endpoints must enforce BYO eligibility independently of UI.

No UI-only authorization.

======================================================================
SCHEMA / MIGRATIONS
======================================================================

Use safe additive migrations.

Inspect existing tables first.

Potential concepts:
- BYO provider configuration
- encrypted secret/reference
- provider/model selection
- usage events
- BYO policy/defaults
- Community overrides
- Watcher/deployment overrides

Do not blindly create all of these if existing structures can be reused.

Ownership must remain account-native.

Canonical ownership derives through:
Community → Project → account_id
Deployment → Community → Project → account_id

Zero-Panel compatibility is mandatory.

Do not introduce hidden/default/synthetic Panels.

Validate RLS/service-role access carefully.

Do not expose secrets through RLS-readable tables.

======================================================================
LEGACY / EXISTING SYSTEM PRESERVATION
======================================================================

Do not regress:
- direct standalone Watch
- legacy Forge/Panel distribution
- Telegram webhook processing
- Coordinator/single-enforcer
- legitimate mention behavior
- scam/phishing/spam enforcement
- media moderation
- Project knowledge
- Auto-Posting
- Presence Scheduling
- current AI routing
- Watcher/deployment semantics
- Activity
- Usage
- normal billing
- Innvil Credit
- Free Trial
- monthly/annual plans
- Community Expansion

BYO is additive.

======================================================================
LANDING PAGE TESTS
======================================================================

Add focused tests verifying:

- BYO is prominently discoverable on Watch landing
- CTA is meaningful and routes correctly
- Managed Enterprise remains visible
- BYO provider-cost disclosure is present
- no guaranteed-savings wording
- no unsupported provider claims
- no duplicate redundant BYO sections
- mobile layout remains usable

======================================================================
BYO ELIGIBILITY TESTS
======================================================================

Test at minimum:

- BYO Enterprise sees Provider/API Management
- Managed Enterprise does not receive BYO edit controls unless explicitly canonical
- Bronze/Silver/Gold/Platinum do not receive BYO edit controls
- server rejects BYO mutations for non-BYO account
- account isolation

======================================================================
SECRET TESTS
======================================================================

Test:
- credential can be stored/replaced securely
- existing plaintext secret is not returned
- secret absent from client/API response
- secret absent from logs in normal path
- one account cannot access another's provider config

======================================================================
PROVIDER CONFIG TESTS
======================================================================

Test:
- supported provider accepted
- unsupported provider rejected
- supported model accepted
- unsupported provider/model combination rejected
- provider config scoped to correct account
- credential replacement does not expose old value

======================================================================
USAGE TESTS
======================================================================

Test:
- canonical plan monthly/current-period limits render for normal plans
- normal plans cannot modify commercial limits
- BYO usage reflects real measurable counters
- provider request recorded once
- retry does not double-count
- period aggregation correct
- account/Community/Watcher attribution correct
- unavailable provider metrics remain unavailable rather than fabricated

======================================================================
BYO POLICY TESTS
======================================================================

Test:
- BYO customer can configure supported API/runtime usage policy
- non-BYO cannot
- account-level policy enforced
- Community override enforced where implemented
- Watcher/deployment override enforced where implemented
- child cannot exceed applicable parent ceiling
- inherited vs overridden values resolve correctly
- changing BYO policy does not mutate canonical plan config
- cap is enforced server-side before provider call
- limit exhaustion produces deterministic state/error
- concurrent/retried calls do not bypass or double-count

======================================================================
RUNTIME-SEPARATION TESTS
======================================================================

Test:
- conversational limit does not automatically disable unrelated moderation
- proactive-message limit does not disable unrelated moderation
- Presence Scheduling respects BYO limits
- scheduler retry does not double-count
- blocked scheduled message does not retry-spam
- provider exhaustion is surfaced honestly when a provider-dependent moderation capability is affected

======================================================================
VALIDATION
======================================================================

Run:
- focused BYO tests
- focused landing-page tests
- focused Usage tests
- affected provider/runtime tests
- affected Presence Scheduling tests
- full `npm test`
- `npx tsc --noEmit`
- `npm run build`

Review the final diff for:
- secret leakage
- fake provider support
- fake usage metrics
- duplicated provider abstractions
- UI-only access control
- global plan limits accidentally mutated by BYO customers
- overbuilt hierarchy
- moderation accidentally disabled by conversational quotas
- double-counted usage
- Panel coupling
- duplicate landing-page BYO marketing
- unrelated feature changes

Update `CLAUDE.md` with:
- BYO as a primary Watch offer
- landing-page positioning
- Managed vs BYO distinction
- provider architecture
- credential handling
- customer-defined API usage policy
- usage telemetry limitations
- usage-limit inheritance/override model
- normal-plan read-only Usage behavior
- server enforcement rules
- Presence Scheduling interaction
- supported provider limitations
- any deferred BYO capabilities

Do not deploy automatically.

======================================================================
FINAL REPORT
======================================================================

Report:

1. Existing BYO architecture found
2. Final architecture implemented
3. How BYO is positioned as a primary Watch offer
4. Landing-page placement and CTA
5. Managed vs BYO distinction
6. Provider/API Management placement
7. Secret-storage approach
8. Supported providers/models exposed
9. Customer-configurable API usage policy
10. Policy hierarchy/override behavior
11. How provider usage is measured
12. What provider usage cannot be measured
13. Usage page changes
14. Canonical normal-plan usage-limit source
15. Normal-plan read-only behavior
16. BYO configurable controls
17. Server-side enforcement
18. Moderation-vs-provider-limit behavior
19. Community/Watcher usage attribution
20. Presence Scheduling interaction
21. Provider health/observability
22. Schema/migrations
23. Files changed
24. Focused/full test results
25. TypeScript/build results
26. Live/external verification performed
27. Unverified external dependencies
28. Remaining gaps
29. Confirmation that this work began only after current testing/debugging was complete
