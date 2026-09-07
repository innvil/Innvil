# Watcher Presence Scheduling — full spec (verbatim, source of truth)

> **STATUS: NOTED, NOT BUILT.** Sent by the user in full during the 2026-08-19 session,
> alongside the BYO Enterprise refinement spec (see
> `docs/moderator/byo-enterprise-refinement-spec.md`). Explicit sequencing instruction:
> **both are to be implemented only after current Telegram/moderation testing and
> debugging is complete and confirmed stable.** Only the real Watch usage-limit work
> (v1.47.16, `MODERATOR_AI_RESPONSE_POOL` tracking/enforcement) was authorized to
> proceed in that same session. See CLAUDE.md's "Phase 4.U" entry for a condensed
> summary and cross-references to the relevant existing architecture this must build
> on (chatter-generate.ts, community-runtime.ts, watch-plans.ts, watch-datetime.ts,
> the Coordinator/single-enforcer model, moderator_activity_log, migrations).

The verbatim instructions below are reproduced exactly as given, for implementation
reference once work on this phase actually begins — do not summarize/paraphrase away
detail when implementing; read this file directly.

---

Implement Watcher Presence Scheduling for Innvil Watch — but ONLY after all currently active debugging/testing work is complete and the repo is in a clean, stable state.

Do not interrupt or mix this feature into any current moderation/runtime/debugging work.

Before starting:
- run `git status`
- read the latest `CLAUDE.md`
- confirm there are no unfinished changes from the current Telegram/moderation testing
- inspect the actual Watch architecture, schema, deployment model, Watcher runtime, scheduler/background-job infrastructure, timezone/settings model, plan feature configuration, Telegram message sending path, coordinator/idempotency logic, and existing tests
- identify the smallest coherent architecture before editing
- do not deploy automatically

======================================================================
PRODUCT SEMANTICS
======================================================================

Canonical ownership:

Watcher Profile
→ owns identity/persona/behavior

Deployment
→ assigns one Watcher to one Community

Presence Schedule
→ belongs to that Watcher deployment in that Community

The schedule must NOT live globally on the Watcher Profile because the same Watcher may eventually be deployed to multiple Communities with different schedules.

Do not create Community-owned personas.
Do not create deployment-level persona overrides.

Persona remains Watcher-owned.

======================================================================
WHAT "PRESENCE" MEANS
======================================================================

Presence scheduling controls the Watcher's human-like conversational/community presence.

It does NOT automatically disable core moderation.

A Watcher that is currently outside its conversational presence window should still be able to perform existing safety/moderation enforcement unless an already-existing explicit moderation setting says otherwise.

Keep these concepts separate:

1. Core moderation / safety enforcement
2. Reactive conversational behavior
3. Proactive/social presence
4. Scheduled presence messages

Do not let a presence schedule accidentally disable scam/phishing/spam moderation.

======================================================================
DEFAULT INNVIL SCHEDULE
======================================================================

Innvil should provide a sensible default so the owner does not need to manually schedule every Watcher.

Default concept:

- Innvil Recommended mode
- automatically stagger deployed Watchers
- default stagger/cadence: every 2 hours
- use the Community/account timezone through the existing canonical timezone system
- create useful overlap between active Watchers
- generate a full-day rotation when appropriate

Example with two Watchers:

Kwan becomes conversationally active
2 hours later → Test becomes active
there is an intentional overlap period
later Kwan rotates out
later Kwan returns
etc.

Do NOT interpret "every 2 hours" as:
- every Watcher is active for exactly 2 hours
- hard-coded fixed 2-hour shifts

The 2-hour value is the default stagger/rotation cadence.

Active duration/return behavior should be modeled separately.

The default generator should produce a sensible schedule based on the number of deployments rather than requiring us to hard-code examples.

======================================================================
OWNER CONTROL
======================================================================

The owner must retain full control.

Support at least:

Schedule mode:
- Innvil Recommended
- Custom

Innvil Recommended:
- generates a usable schedule automatically
- default stagger = 2 hours
- owner can start from this schedule and customize it

Custom:
owner can configure schedule values for each deployment.

Inspect the existing architecture and choose an appropriately simple representation, but conceptually allow control over:

- initial/start time or offset
- active duration
- return/off interval or recurrence
- Watcher ordering
- coverage window
- presence messages enabled/disabled

Do not unnecessarily expose cron syntax.

This should be understandable to a normal Community owner.

======================================================================
MULTIPLE WATCHERS
======================================================================

This must scale from one Watcher to several Watchers.

For Communities with 2–5 Watchers, the recommended schedule should create staggered conversational coverage rather than having all Watchers enter/leave at exactly the same time.

Example concept only:

Watcher A starts
+2h Watcher B starts
+2h Watcher C starts
+2h Watcher D starts
+2h Watcher E starts

Earlier Watchers may still be active, creating natural overlap.

Do not hard-code this exact sequence if a more general scheduling algorithm is cleaner.

Preserve all existing canonical slot/deployment semantics.

Watcher Slot = active Watcher-to-Community deployment.

Presence scheduling does not change slot accounting.

======================================================================
PRESENCE EVENTS
======================================================================

Do not hard-code specific messages such as:

"gm"
"gn"
"brb"

Instead create semantic presence transitions/events.

For example, use concepts equivalent to:

- presence_started
- presence_resumed
- presence_ending

Use naming consistent with the existing codebase.

The Watcher's Persona should influence the actual message sent.

Examples:

Friendly persona:
"Morning everyone 👋 I'm around for a while."

Dry-humor persona:
"I have returned. Try not to burn the place down."

The text must come from the existing AI/persona/runtime system where appropriate rather than a fixed global phrase.

The owner should be able to turn presence transition messages off.

Do not send a message every time the scheduler polls.

Only send on an actual persisted transition.

======================================================================
IDEMPOTENCY / SCHEDULER SAFETY
======================================================================

This is critical.

Inspect whatever scheduling/background execution mechanism already exists.

Do NOT introduce an unsafe client-side timer.

Presence transitions must be server-side and durable.

Design for:
- duplicate scheduler invocations
- retries
- delayed jobs
- serverless execution
- Vercel/runtime constraints
- concurrent invocations

A transition must fire at most once for the same logical occurrence.

For example:

08:00 Watcher becomes active

must not produce three "I'm back" messages because the scheduler ran three times.

Persist enough state to determine:
- current presence state
- last transition
- next transition if useful
- transition occurrence/idempotency identity

Use safe additive schema changes.

Validate ownership/RLS carefully.

======================================================================
MISSED / DELAYED TRANSITIONS
======================================================================

Handle scheduler delays sensibly.

Example:
A transition should have occurred at 10:00 but the scheduler runs at 10:08.

It should be able to reconcile the state without creating a storm of historical messages.

Do not blindly replay every missed arrival/departure message after downtime.

Choose and document a deterministic reconciliation rule.

Prefer current-state correctness over sending stale social messages.

======================================================================
TIMEZONES
======================================================================

Use the existing canonical Watch/account timezone configuration.

Do not invent a second timezone system.

Scheduling should remain stable across:
- timezone changes
- DST where applicable
- server UTC execution

Store schedule data in a representation that avoids timezone ambiguity.

Document the approach.

======================================================================
UI PLACEMENT
======================================================================

Scheduling is Community/deployment operational configuration.

Do NOT put the schedule on the reusable Watcher Persona page.

Preferred location:

Community
├── Overview
├── Watchers
│   ├── Deployments
│   └── Presence Schedule
├── Moderation
├── Activity
├── Media
├── Auto-Posting
└── Settings

Adapt this to the actual current routing/components rather than forcing unnecessary navigation changes.

The important rule is:

Presence Schedule belongs in the Community's deployed-Watcher operational context.

======================================================================
UI
======================================================================

Create a compact, operational scheduling UI.

Desired high-level experience:

Presence Schedule

Schedule mode
[ Innvil Recommended ] [ Custom ]

Innvil recommended
Automatically staggers your Watchers for conversational coverage.

Default rotation cadence
Every 2 hours

Timezone
Asia/Manila

Presence messages
[x] Announce when becoming active
[x] Announce when returning
[x] Send a short sign-off when rotating out

Then show the generated deployment rotation/timeline.

Example representation:

Kwan
Starts 8:00 AM
Active ...
Returns ...

Test
Starts 10:00 AM
Active ...
Returns ...

Use the real computed schedule, not fake static examples.

The owner should be able to:
- switch to Custom
- edit individual deployment schedule
- reorder Watchers where relevant
- reset/reapply Innvil Recommended schedule

Do not overwhelm the UI with cron/scheduler terminology.

======================================================================
PERSONA INTEGRATION
======================================================================

Presence messages must use the correct Watcher's persona.

If Kwan enters:
→ Kwan's persona determines the wording.

If Test enters:
→ Test's persona determines the wording.

Do not create a shared Community persona.

If the owner manually customized the Watcher's Persona description or Behavior instructions, presence-message generation should respect those current values.

Do not overwrite Persona settings when schedules are changed.

======================================================================
MESSAGE FREQUENCY / ANTI-SPAM
======================================================================

Scheduling itself must not become spam.

Guard against:
- duplicate transition messages
- scheduler retries
- rapid toggling
- timezone/save changes triggering unintended announcements
- resetting the recommended schedule causing immediate repeated messages

Changing configuration should not automatically send a presence message unless a genuine runtime state transition occurs under the final design.

======================================================================
ACTIVITY
======================================================================

Integrate with the existing canonical Activity system where appropriate.

Presence lifecycle events should be observable operationally.

Examples conceptually:
- Kwan became active
- Kwan rotated out
- Kwan resumed presence

Do not invent an entirely separate activity/history system.

If presence messages are sent, preserve enough linkage to understand that they were scheduler/presence-generated rather than ordinary user-triggered responses.

======================================================================
PLANS / ENTITLEMENT
======================================================================

This feature should start at the Standard/Silver tier and above.

However, DO NOT hard-code this based on my wording before inspecting the existing canonical plan/feature matrix.

Inspect how plan capabilities are currently represented.

Customer-facing mapping:
- Bronze = Basic
- Silver = Standard
- Gold = Premium
- Platinum = Pro

Desired availability:
- Bronze: no Watcher Presence Scheduling
- Silver: Presence Scheduling
- Gold: Presence Scheduling
- Platinum: Presence Scheduling
- Enterprise: preserve current Enterprise behavior and include the feature unless existing architecture requires a deliberate distinction
- Free Trial: inspect current trial capability model; do not assume eligibility without reviewing existing product rules

Implement gating through the canonical entitlement/feature system.

Do not scatter plan-name checks around the UI/runtime.

If the codebase does not yet have an appropriate feature-capability helper, introduce the smallest centralized solution.

======================================================================
RUNTIME INTERACTION
======================================================================

Inspect current Watcher response routing carefully.

Presence scheduling must NOT break:
- Telegram webhook processing
- Coordinator/single-enforcer behavior
- normal mentions/direct addressing
- scam/phishing/spam moderation
- media moderation
- Project knowledge
- Auto-Posting
- existing Watcher active-deployment safeguards

Do not treat "presence inactive" as "deployment inactive."

Deployment remains active.

Presence is a separate conversational state.

======================================================================
SCHEMA / MIGRATION
======================================================================

Use a safe additive migration.

Inspect current migrations first and use the next correct migration number.

Model only what is required.

Potential concepts may include:
- deployment presence configuration
- schedule mode
- schedule definition
- presence-message preferences
- persisted runtime presence state
- last/next transition
- transition/idempotency record

Do not blindly implement all of those as separate tables if a simpler correct schema exists.

Requirements:
- account ownership derivable through Deployment → Community → Project → account_id
- zero-Panel compatible
- no hidden/default/synthetic Panel
- RLS/service-role policy consistent with existing architecture
- no destructive migration
- backfill existing deployments safely
- existing deployments should default to presence scheduling OFF unless the product design strongly requires another safe default

Important:
Adding this feature must NOT cause existing production/test Watchers to suddenly begin sending scheduled social messages after migration.

Existing deployments should require explicit enablement unless there is a very strong existing reason otherwise.

======================================================================
RECOMMENDED SCHEDULE GENERATOR
======================================================================

Implement the recommended scheduling logic as a pure/testable helper where possible.

Inputs should conceptually include:
- deployed Watchers
- timezone/config
- default cadence
- coverage options

Output:
- deterministic recommended deployment schedules

Default cadence:
2 hours

It should handle:
- 1 Watcher
- 2 Watchers
- 3 Watchers
- 4 Watchers
- 5 Watchers

Avoid random schedule generation unless there is a persisted deterministic seed and a compelling reason.

Owners need predictable schedules.

======================================================================
TESTING
======================================================================

Add focused tests covering at minimum:

Ownership:
- schedule belongs to Deployment/Community relationship
- changing Kwan schedule does not change Test
- same Watcher in another Community can have a separate schedule if architecture permits

Recommended scheduling:
- 1 Watcher
- 2 Watchers
- 5 Watchers
- default 2-hour stagger
- deterministic output

Custom scheduling:
- owner can override recommended values
- saved custom values persist

Plan gating:
- Bronze blocked
- eligible paid tiers allowed
- server enforcement exists, not UI-only

Moderation:
- presence inactive does NOT disable core moderation

Transitions:
- starts
- ends/rotates out
- resumes
- no duplicate event on repeated scheduler run
- no duplicate Telegram presence message
- retry/idempotency behavior

Delayed execution:
- scheduler reconciliation does not spam historical messages

Configuration changes:
- editing schedule does not accidentally emit presence announcements
- timezone changes behave deterministically

Persona:
- transition messaging uses the selected Watcher's persona
- Kwan and Test produce independently scoped prompts/context
- manual persona edits remain respected

Activity:
- presence transition is represented through canonical Activity where implemented

Account isolation:
- one account cannot mutate another account's deployment schedule

Zero-Panel:
- direct standalone Watch deployments work without panel_id

Existing runtime regression:
- normal Telegram response
- moderation
- deployment behavior
remain intact

======================================================================
VALIDATION
======================================================================

Run:

- focused scheduling tests
- focused Telegram/runtime tests affected by this change
- full `npm test`
- `npx tsc --noEmit`
- `npm run build`

Review final diff for:
- duplicated scheduler logic
- hard-coded usernames
- hard-coded presence text
- scattered plan checks
- accidental moderation shutdown
- client-side timers
- duplicate messages
- unsafe migrations/RLS
- Panel coupling
- unrelated feature changes

Update `CLAUDE.md` with:
- Presence Scheduling semantics
- ownership model
- default 2-hour recommended cadence
- owner customization behavior
- moderation-vs-presence distinction
- plan availability
- scheduler/idempotency design
- schema/migration
- operational notes

======================================================================
DO NOT DO YET
======================================================================

Do NOT include the BYO Enterprise refinement in this task.

Do NOT implement:
- BYO API Management
- provider API usage dashboard
- BYO rate/token controls
- BYO landing-page promotion
- new Enterprise dashboard
- unrelated billing changes

Those will be handled as a separate feature after Presence Scheduling is stable.

Do not deploy automatically.

======================================================================
FINAL REPORT
======================================================================

When complete, report:

1. Root architecture chosen
2. Schedule ownership model
3. Innvil Recommended algorithm
4. How the default 2-hour cadence works
5. Owner customization controls
6. Presence vs moderation behavior
7. Persona-generated transition messages
8. Scheduler/idempotency approach
9. Delayed-job reconciliation behavior
10. Timezone behavior
11. Plan gating
12. UI placement
13. Schema/migration
14. Activity integration
15. Files changed
16. Focused/full test results
17. TypeScript/build results
18. Any untested external/runtime dependency
19. Remaining gaps
20. Confirmation that this work began only after the existing debugging/testing work was complete
