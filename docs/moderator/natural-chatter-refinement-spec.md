# Natural Chatter + Community Moderation Refinement Spec

> Status: **(A) IMPLEMENTED (v1.1.84) — (B)–(F) still NOTED, not built.** This is
> the source-of-truth spec for the next Virtual Moderator iteration, captured
> verbatim as given so no fidelity is lost before implementation. See the pointer
> in `CLAUDE.md` (Phase 4.M) for where this sits in the roadmap. Do not implement
> (B)–(F) from memory/paraphrase — implement from this file.
>
> Scope boundary (§55 below): this patch is ONLY (A) reactive Natural Chatter
> selection/pacing, (B) the 20/day trial reactive response entitlement, (C)
> intelligent external-link moderation, (D) spam vs legitimate-follow-up distinction,
> (E) natural warning escalation, (F) configurable collab/AMA admin routing. It must
> NOT touch bot provisioning, managed-bot credentials, provider ordering, billing,
> trial duration, active mod slots, publishing, campaign generation, or unrelated
> moderation features.
>
> **(A) FINAL implementation (v1.1.97) — full action selection, no percentages.**
> Natural Chatter uses **contextual social action selection**. It does **not** use
> response percentages at any layer. The earlier intermediate versions (v1.1.84's
> priority bands mapping to 0%/35%/85%/100%, and v1.1.96's added opener signal that
> still fed those bands) are **removed** — `selectChatterAction()` in
> `chatter-coordinator.ts` takes no RNG parameter at all and contains no
> `Math.random()`. Repo-wide greps for `selectChatterResponder`,
> `ENGAGE_PROBABILITY`, `PROBABILITY_GATE`, `ChatterPriority`, and `priorityBand`
> return nothing.
>
> The Coordinator classifies the message (EMPTY / TOO_SHORT / COMMUNITY_OPENER /
> TRIVIAL / QUESTION / SUBSTANTIVE) plus room state, then returns exactly one
> first-class action:
> `SILENCE` · `REACT` · `SHORT_ACK` · `CASUAL_CHAT` · `ANSWER`
> (`COMMUNITY_HANDOFF` remains a bot-to-bot concept owned by `coordinator.ts`'s
> acknowledgement flow — a HUMAN message never routes to it.)
>
> **Silence is a contextual action, never a lost roll** — every SILENCE carries
> reasons (`already_handled`, `trivial_low_value`, `no_eligible_moderator`,
> `low_social_priority`, `already_handled_recent_reply`, `empty_message`,
> `too_short`). **CASUAL_CHAT is first-class**: a genuine unanswered community
> opener in a quiet room deterministically selects it. **Cost**: `SILENCE` and
> `REACT` and `SHORT_ACK` make **zero** AI calls (SHORT_ACK is a deterministic
> phrase; REACT is a real Telegram reaction); only `CASUAL_CHAT`/`ANSWER` reach
> Sonnet 5, and the action union structurally carries exactly one `deploymentId`,
> so N moderators can never produce N generations.
>
> **Randomness** now exists in exactly one place — `shortAckText()` varying which
> canned acknowledgement phrase is used. It varies *wording*, never *whether* a
> moderator acts, and never *who*: moderator selection is fully deterministic
> (explicit mention → active-exchange continuity → quietest longest).
>
> **Multi-moderator selection (§15) — SUPERSEDED by v1.1.97's action model, still
> correct.** `pickCandidate()` in `chatter-coordinator.ts` picks AT MOST ONE
> deployment per human message, deterministically: an explicit @mention of one
> specific moderator wins first, then whoever's actually mid an active exchange
> (`wasLastSpeaker`), then whoever's been quietest longest. `findChatterDeployments`
> (plural, no `.limit(1)`) loads every enabled deployment; `handleHumanMessage` loads
> pacing for all of them before resetting any streak.
>
> **Moderator handoff + conversation-closing refinement — IMPLEMENTED (v1.1.98).**
> Live-caught: one moderator (Kwan) answered six human messages in a row, including
> fabricating "it's just me around" when a second moderator (Test) was genuinely
> deployed and eligible, answering on Test's behalf even after an explicit
> `@test1_mod_bot` mention, and tacking "anything else on your mind?" onto a plain
> "I see, okay." — a support-chat habit, not natural closure.
> - `invitesOtherModerator()` detects generic handoff requests ("any other
>   moderator who can respond here?", "anyone else?", "someone else?") — when
>   matched with 2+ deployed candidates, the candidate that's been carrying the
>   conversation (`wasLastSpeaker`) is EXCLUDED (not merely deprioritized) from
>   selection, forcing an alternate moderator to answer. Falls through to ordinary
>   handling when only one moderator is deployed (nothing to hand off to).
> - Fixed a real ordering bug found while building this: the `SUBSTANTIVE` branch
>   checked `wasLastSpeaker` before `isDirectedAtBot`, so an explicit `@mention` of
>   a *different*, non-speaking moderator still lost to whoever spoke last for any
>   non-question statement. Now routes through the same `pickCandidate` (directed >
>   continuity > quietest) used everywhere else.
> - `CLOSING_ACK_RE` folds closing phrases ("I see, okay.", "got it", "alright",
>   "fair enough", "makes sense") into the `TRIVIAL` classification regardless of
>   word count (the existing `isTrivial` word-count heuristic missed these at 3+
>   words) — right after a moderator reply, they resolve to `SILENCE`
>   (`already_handled_recent_reply`) instead of prompting another reply.
> - `chatter-generate.ts`'s prompts now carry `otherActiveModeratorNames` (the
>   real, current deployment list) so a moderator can only reference another
>   moderator's presence/absence grounded in that fact, never invented — plus an
>   explicit "you are ONE SPECIFIC person, not a shared collective" identity line,
>   and a rule against generic support-chat closers ("anything else on your
>   mind?", "how can I help?") and manufacturing follow-up questions just to keep
>   a closed exchange going.
>
> **Plain-name targeting, history grounding, persona isolation — IMPLEMENTED
> (v1.1.99).** Three more live-caught bugs on top of the above.
> - **Plain-name addressing.** "what persona are you kwan?" (no @mention) went
>   unanswered until the human typed `@kwan_mod_bot`. New pure
>   `resolveDirectedModerator(text, moderators)` in `chatter-coordinator.ts`
>   resolves, in order: @username (unambiguous by construction) → exact
>   configured name as a whole word/token → a typo-tolerant near-spelling of the
>   name. Tokenized (never substring), so a moderator named "Ann" is never
>   triggered by "announcement". Ambiguous matches (2+ moderators plausibly
>   addressed at the same confidence tier) resolve to no match rather than
>   guessing. `community-runtime.ts` calls it once per event and feeds the result
>   into the exact same `ChatterCandidate.isDirectedAtBot` field the rest of the
>   selection pipeline already uses — no change to `pickCandidate`,
>   `invitesOtherModerator`, or the continuity logic.
> - **Typo tolerance without false positives.** Raw Levenshtein distance is
>   unsafe for short names: "Test" is distance-1 from the ordinary English words
>   "rest"/"best"/"west", which would otherwise fire on completely unrelated
>   messages. Fuzzy matching instead requires an exact letter-for-letter anagram
>   (same length, same character multiset — a transposition typo like
>   "kwan"→"knaw"/"kwna") for short names, with a little more room (distance ≤ 1)
>   only for names 5+ characters, where real-word collisions are rarer. An
>   anagram match is flagged `isTypo: true` and threaded through to generation as
>   an optional (never forced) hook to acknowledge/joke about the misspelling.
> - **History grounding.** Kwan invented "was just responding to Test's message
>   first" to explain a message it simply wasn't selected for. New rule in
>   `SHARED_RULES`: never invent reasons for your own silence, never claim you
>   replied when the transcript shows you didn't, never claim to know what
>   another moderator was doing/thinking beyond what's shown — give a neutral
>   answer instead of a fabricated one.
> - **Persona isolation.** Two compounding gaps: `personaStyle()` never read the
>   `formality`/`slang`/`teasing` persona fields at all (present in
>   `ModeratorPersona` since `domain.ts`, just unused) — now it does, giving the
>   model concrete grounding for the CURRENT moderator's own configured voice.
>   And the transcript labeled every message by display name only, with no
>   signal for "this is your own past message" vs. "a different moderator's" —
>   now explicit: `NAME (you)` vs `NAME (a different moderator, not you)`, plus
>   an anti-imitation rule ("do not imitate their voice... not their
>   capitalization, punctuation habits, slang, phrasing, or temperament").
> - `chatter-generate.test.ts` (NEW) asserts all three fixes against the actual
>   assembled prompt/context strings — persona-isolation and history-grounding
>   are prompt-construction properties, testable without a live model call, per
>   explicit instruction not to rely on probabilistic output where avoidable.
>
> Not yet built: the full N-signal list from §11 (business/persona relevance,
> community activity level, remaining quota — the last needing (B)); durable
> per-moderator memory (§12-17 of the newest instruction) — there is currently no
> durable moderator-memory system at all (Phase 4.N is still NOTED/not built), so
> there is nothing to isolate yet; that becomes relevant once Phase 4.N exists.
>
> **Upbeat closings react instead of replying + style-drift-under-questioning —
> IMPLEMENTED (v1.2.0).** Two more live-caught bugs from the same conversation
> that produced v1.1.99.
> - **"okay, perfect!" got a text reply, not a reaction.** It's 2 words / 14
>   chars, one character over the old 12-char `isTrivial` cap, so it classified
>   `SUBSTANTIVE` and continuity (`wasLastSpeaker`) picked it up as a real message
>   worth continuing with a full `CASUAL_CHAT` reply — a human moderator would
>   smile/react, not write a new sentence back. Widened the cap to 16 chars and
>   added `POSITIVE_WORD_RE` (perfect/awesome/amazing/excellent/fantastic/sweet/
>   "love it"/"nice one"/great), checked inside the `TRIVIAL` branch of
>   `selectChatterAction` before the directed/ambient split — any upbeat short
>   closing now always resolves to `REACT` via `positiveReactionFor()` (❤️ when
>   the message mentions "love", 😄 otherwise), regardless of whether it's
>   directed or mid a continuity thread. A plain neutral closing with no positive
>   word ("got it") still resolves to `SILENCE` exactly as before — the fix only
>   changes outcomes for genuinely upbeat closings.
> - **Style drift triggered by being asked about style.** Kwan's writing flipped
>   from initial-caps to all-lowercase immediately after a human asked "why are
>   you so formal though, kwan?" — the model treated a question about its tone as
>   an instruction to change it. `personaStyle()`'s formality lines in
>   `chatter-generate.ts` are now mechanical/imperative ("Always capitalize the
>   start of your sentences... this is a fixed habit of how you write, not
>   something you adjust message to message" / "Always write in lowercase...
>   fixed habit...") instead of soft guidance ("write with proper formality"),
>   and a new `SHARED_RULES` entry states explicitly that writing style
>   (capitalization/punctuation/formality/slang) is FIXED by configuration and
>   does not change over a conversation or in response to being asked about it —
>   the moderator can still answer the question honestly, it just keeps writing
>   in its own configured voice while doing so.
> - New regression tests: `chatter-coordinator.test.ts` (upbeat closing →
>   REACT with the right emoji, neutral closing → still SILENCE, ambient upbeat
>   closing with no directed/continuity signal still reacts) and
>   `chatter-generate.test.ts` (prompt contains the fixed-style rule verbatim).
>
> **Positive-closing detection decoupled from the character cap — IMPLEMENTED
> (v1.2.1).** Follow-up correction, same day, prompted by the user asking
> whether the trivial-closing check was still character-bounded after v1.2.0.
> It was — `isTrivial`'s cap had only been widened 12→16 to fit "okay,
> perfect!", which is the exact same fragile-heuristic class of bug: a
> slightly longer 2-word closing that uses longer words ("that's fantastic!",
> 17 chars after stripping the trailing `!`) would still fall through the cap
> and get a full `CASUAL_CHAT` reply. New `isPositiveClosing(text)` in
> `chatter-coordinator.ts` bounds by WORD COUNT only (≤4 words, one of which
> matches `POSITIVE_WORD_RE`) — no character length involved — and is OR'd
> into `classifyMessageKind`'s `TRIVIAL` branch alongside `isTrivial` and
> `CLOSING_ACK_RE`, mirroring how `CLOSING_ACK_RE` was already added
> independent of `isTrivial` in v1.1.98 for the same reason. A genuinely
> longer sentence that happens to mention a positive word mid-paragraph (5+
> words, e.g. "that was a really great effort from the whole team honestly")
> is correctly left `SUBSTANTIVE`. New tests cover both cases.
>
> **TRIVIAL/closing acknowledgement detection is now intent-based rather than
> gated by an arbitrary small character limit — IMPLEMENTED (v1.3.0).** Longer
> acknowledgements can resolve to REACT/SILENCE, while acknowledgement + new
> substantive content still routes normally. The v1.2.0/v1.2.1 widenings (12→16
> chars, then decoupling positive closings to a 4-word bound) were still the
> same flawed approach with more headroom, per direct user critique: length is
> not a valid proxy for "does this introduce a new conversational obligation."
> Live repro: a moderator told a joke, the human replied "prettyaccurate too.
> lol" (3 words, 23 chars — over every cap tried), and the moderator generated
> a full follow-up reply instead of reacting or staying silent.
> - **`isAcknowledgementOnly(text)`** (`chatter-coordinator.ts`, NEW) replaces
>   length-gating with hard semantic exclusions checked first, unconditionally:
>   ends with `?` (falls through to `QUESTION` classification), a contrast/
>   continuation marker (`but/however/though/although/except/still/also`), a
>   request marker (`can/could/would you`, `please`), or a negative-state/
>   problem word. Only past those does it tokenize, require at least one
>   recognized ack/laugh/thanks/agreement signal token, and tolerate a small
>   (≤2) residual of otherwise-unclassifiable leftover words as a weak
>   fallback — never the decisive signal.
> - **Problem-word detection is stem-based, not exact-word regex.** An initial
>   `/\bfail(?:s|ed|ing)?\b/`-style regex silently misses "failure" (no word
>   boundary right after "fail" mid-word), which would have fallen back to the
>   residual-tolerance count and been waved through — caught by an adversarial
>   test (`"yeah lol total failure"`) before shipping. `hasProblemWord()` now
>   checks `token.startsWith(stem)` against a small stem list
>   (broken/fail/down/error/bug/crash/issue/problem/stuck/glitch/outage/wrong/
>   incorrect) — deliberately over-inclusive (e.g. "downtown" also starts with
>   "down") since a false trigger only costs a real reply instead of a
>   reaction, never the reverse.
> - **A single leftover token is never assumed safe by tolerance alone** — a
>   bare residual like "broken"/"down"/"error" is excluded by the explicit
>   problem-word check regardless of how few tokens are left, directly
>   addressing user feedback that an initial `residual.length <= 1` design made
>   token count the decisive factor rather than a weak one.
> - **`isKnownConcatenation(token)`** (word-break DP over `ACK_TOKENS`/
>   `NEUTRAL_TOKENS`) recognizes a glued-together closing like "prettyaccurate"
>   ("pretty"+"accurate", the literal live typo with no space) as fully
>   recognized content, so the ≤2 residual tolerance doesn't have to be widened
>   just to accommodate that one case.
> - Existing `isTrivial`/`CLOSING_ACK_RE`/`isPositiveClosing` length-bounded
>   checks are kept as fast-path additions (harmless redundancy for genuinely
>   short cases) — the new semantic check is what actually resolves anything
>   longer, satisfying "primarily conversational intent, not a character cap."
> - Adversarial regression tests target exactly the risk called out: single
>   problem-word residues ("yeah lol broken", "haha okay it's failed", "yeah
>   lol down", "lol yeah error", "yeah lol total failure"), a long fabricated
>   topic that merely opens with an ack word, and a benign unclassifiable
>   residual that should still react when directed. 245 tests pass; zero
>   regressions to plain-name targeting, @username/reply targeting,
>   directed-over-continuity priority, persona isolation, history grounding,
>   deterministic selection, or bot-loop protections.
>
> **Community-opener staleness guard — IMPLEMENTED (v1.3.1).** Found by directly
> checking the live Telegram chat (per the workflow: query `moderator_activity_log`
> for the exact decision/reason before touching classification code). "hey guys
> 👋" sent 95 minutes after the previous message (a moderator's reply) was
> silenced with `decision=SILENCE reason=already_handled`, even though the room
> had gone completely quiet in between.
> - Root cause: `community-runtime.ts`'s `recentlyAnsweredByModerator` /
>   `recentlyRespondedByHuman` / `wasLastSpeaker` were computed purely from WHO
>   sent the message immediately before this one in history — with no regard for
>   WHEN. A moderator's reply from hours ago, simply because it happens to be the
>   last row, was indistinguishable from one sent 10 seconds ago.
> - Fix: new exported `isRecentMessage(createdAt, now)` +
>   `RECENT_EXCHANGE_WINDOW_MS` (5 minutes). `loadRecentContext` now also selects
>   `created_at` from `community_messages`, threaded onto `ChatterContextMessage`
>   as an optional `createdAt` field. `handleHumanMessage` gates all three flags
>   on `isRecentMessage(priorMessage.createdAt, now)` — a stale prior message no
>   longer counts as "the room is mid an active exchange" for either the
>   COMMUNITY_OPENER already-handled suppression or the continuity bias in
>   `pickCandidate`.
> - Tests in `community-runtime.test.ts`: the exact 95-minute live repro, a
>   30-second-old exchange still correctly counting as active, and the exact
>   5-minute boundary (strict less-than, both sides). 250 tests pass.
>
> **Same-sender "already handled" false suppression — IMPLEMENTED (v1.5.1).**
> Live bug, found the same way as the v1.3.1 staleness bug (query
> `moderator_activity_log` for the exact decision/reason before touching
> classification code) — checked immediately after v1.5.0 deployed. "anyone
> here?" sent 16 seconds after the SAME person's own unanswered "yo! what's
> up" was silenced with `decision=SILENCE reason=already_handled`, even
> though nothing had actually been handled — the prior message just happened
> to also be from a human (the same asker, not a different member engaging).
> - Root cause: `recentlyRespondedByHuman` only checked the prior message's
>   sender TYPE ("was it human"), never WHO specifically — so two consecutive
>   messages from the same person, neither of which got any reply, incorrectly
>   read as "a human already responded to this room."
> - Fix: new exported `humanRecentlyResponded(priorMessage,
>   currentSenderPlatformId, now)` (pure, alongside `isRecentMessage`) requires
>   the prior human message to be both RECENT (the v1.3.1 guard) AND from a
>   DIFFERENT platform user id than the current sender. `loadRecentContext`
>   now also selects `sender_platform_id` (already written on every insert
>   since migration 0047, just not previously read back), threaded onto
>   `ChatterContextMessage` as `senderPlatformId`. `recentlyAnsweredByModerator`
>   is unaffected — a moderator reply always counts as genuine engagement
>   regardless of who asks next.
> - Tests in `community-runtime.test.ts`: the exact live repro (same person,
>   16s apart → not "responded"), a different person's recent message
>   correctly counting as responded, a moderator's prior message never routing
>   through this human-only check, and the existing staleness boundary (95
>   minutes, different person) still correctly excluded. 280 tests pass.
>
> **Short questions were being swallowed as trivial filler — IMPLEMENTED
> (v1.5.2).** Live bug, caught testing the v1.5.1 fix live: right after Test
> replied to "anyone here?", asking "who else?" got silenced with
> `reason=already_handled_recent_reply` as if it were throwaway filler.
> - Root cause: `isTrivial()`'s word-count/char-length check doesn't know or
>   care about question-ness -- it strips the trailing `?` the same as `!`/`.`
>   when computing char length, so a short question ("who else?", "is this
>   perfect?") was classified `TRIVIAL` before `classifyMessageKind` ever
>   reached the `QUESTION` check. `isAcknowledgementOnly` already had its own
>   "ends with `?`" guard for this reason; `isTrivial`/`CLOSING_ACK_RE`/
>   `isPositiveClosing` didn't share it.
> - Fix: `classifyMessageKind` computes `looksLikeQuestion` once and skips the
>   entire trivial-check group when the message ends in `?`, going straight to
>   `QUESTION` regardless of length.
> - New tests (`chatter-coordinator.test.ts`): the exact live repro, a short
>   question with no other signal, `isPositiveClosing`'s "is this perfect?"
>   blind spot, and a short acknowledgement-shaped question ("makes sense?").
>   284 tests pass, zero regressions.

Implement the next Natural Chatter + Community Moderation refinement for Innvil Virtual Moderator.

Treat this instruction as the current source of truth for:

- trial reactive response limits
- natural response selection
- mention/no-mention behavior
- conversational pacing
- external-link moderation
- unsolicited advertising
- collaboration / AMA / partnership links
- spam/flood distinction
- warning escalation
- configurable admin/contact routing

Do not rewrite unrelated Virtual Moderator systems.

The product goal is:

Innvil Virtual Moderator should feel like an unusually attentive, socially intelligent human community moderator — not a command bot, not a random-response chatbot, and not a keyword-based auto-ban bot.

==================================================
1. TRIAL REACTIVE RESPONSE LIMIT
==================================================

For the:

7-Day Full AI Mod Trial

set:

reactiveResponseDailyLimit = 20

The limit is:

20 successfully executed REACTIVE conversational text responses
per community
per local community day.

This is a MAXIMUM.

It is NOT a target.

The moderator should not attempt to use all 20 responses every day.

Silence remains a first-class Community Coordinator decision.

==================================================
2. WHY 20, NOT 50
==================================================

Do not configure 50/day for the trial.

The purpose of the trial is to demonstrate quality and judgment, not maximum message volume.

20/day gives enough capacity for:

- conversational participation
- direct questions
- business answers
- relevant unmentioned discussion
- natural community interaction

while keeping trial usage bounded.

Paid-plan behavior remains governed by the existing entitlement architecture.

Do not infer or change paid-plan limits in this patch.

==================================================
3. WHAT COUNTS TOWARD THE 20
==================================================

Count one reactive response when Innvil successfully sends a conversational TEXT response caused by a fresh community/human event.

Examples:

Human:
"Anyone watching the market today?"

Moderator:
"Yeah, it's been all over the place 😅"

→ +1 response

Human:
"Does anyone know how withdrawals work?"

Moderator:
"You can request it from the dashboard under..."

→ +1 response

Human:
"@mika_mod_bot what do you think?"

Moderator:
"Looks reasonable to me."

→ +1 response

Human:
"Anyone know why orders are delayed?"

No moderator mention.

Moderator:
"Looks like the provider is still processing them."

→ +1 response

==================================================
4. WHAT DOES NOT COUNT
==================================================

Do NOT consume reactiveResponseDailyLimit for:

- deleting messages
- banning users
- kicking users
- spam enforcement
- link removal
- deterministic moderation state updates
- emoji/reaction-only actions
- admin/system commands
- proactive/autonomous messages
- Coordinator decisions that result in SILENCE
- failed outbound sends
- failed AI generation
- duplicated Telegram webhook delivery
- internal bot-to-bot reaction-only acknowledgement

Moderation must continue working even when:

reactive responses = 20 / 20

==================================================
5. PROACTIVE LIMIT REMAINS SEPARATE
==================================================

Keep the existing trial proactive rule:

proactiveDailyLimit = 2

per community
per local community day.

Reactive and proactive quotas are separate.

Example:

reactive responses:
14 / 20

proactive actions:
2 / 2

The moderator may still produce up to 6 additional eligible reactive responses.

Likewise:

reactive = 20 / 20

proactive = 1 / 2

does not automatically consume or disable the remaining proactive capability.

==================================================
6. LOCAL COMMUNITY DAY
==================================================

Use the existing approved timezone semantics.

Quota is evaluated against the community/deployment local day.

Do not simply reset using server UTC midnight when a valid community timezone exists.

Reuse the proactive quota timezone infrastructure where possible.

Avoid timezone-switch abuse.

==================================================
7. COUNT ONLY SUCCESSFUL EXECUTION
==================================================

Quota should be consumed only after the outbound conversational text response successfully executes.

Do not consume quota because:

- Coordinator considered speaking
- LLM was called
- candidate response was generated
- Telegram send failed
- event was suppressed
- duplicate webhook arrived

Use existing idempotency infrastructure.

==================================================
8. REMOVE THE CURRENT 15% / 75% MODEL
==================================================

Current behavior reportedly approximates:

not mentioned:
15% chance to respond

mentioned:
75% chance to respond

Remove this as the primary Natural Chatter decision system.

That behavior is too mechanical.

Do NOT implement:

if mentioned:
    random < 0.75
else:
    random < 0.15

A Virtual Moderator should not behave like a probabilistic command bot.

==================================================
9. MENTION IS A SIGNAL, NOT A REQUIREMENT
==================================================

The moderator may respond even when it is NOT mentioned.

Direct mention and direct reply should increase response priority, but they are not activation commands.

Do NOT implement:

if (!mentionsBot && !replyToBot)
    return SILENCE

That breaks the intended human-moderator behavior.

==================================================
10. MENTION DOES NOT GUARANTEE A RESPONSE
==================================================

A direct mention should not force a response either.

Example:

Human:
"hi @mika_mod_bot"

Moderator:
"hey 👋"

20 seconds later:

Human:
"@mika_mod_bot hi"

Expected:
usually SILENCE
or possibly a reaction.

Do not answer every mention just because @username appears.

==================================================
11. CONTEXTUAL RESPONSE SELECTION
==================================================

Community Coordinator should evaluate multiple signals before deciding whether the moderator should respond.

Consider at least:

- direct reply to moderator
- direct @mention
- explicit question
- general question to community
- business/support relevance
- moderator persona relevance
- ability to provide useful information
- conversation context
- whether another moderator already answered
- recent moderator participation
- same-user cooldown
- repeated/similar message detection
- community activity level
- whether the message naturally invites participation
- remaining reactive quota
- whether silence would feel more natural

==================================================
12. RESPONSE PRIORITY MODEL
==================================================

Use contextual scoring / decision bands rather than a single random percentage.

Conceptually:

responseScore =
    directReplyWeight
  + mentionWeight
  + questionWeight
  + businessRelevanceWeight
  + personaRelevanceWeight
  + usefulAnswerWeight
  + socialOpportunityWeight
  - recentResponsePenalty
  - repetitionPenalty
  - alreadyAnsweredPenalty
  - lowValuePenalty
  - overParticipationPenalty

Then behave roughly like:

VERY HIGH PRIORITY
→ generally respond

HIGH PRIORITY
→ usually respond

MEDIUM PRIORITY
→ may respond depending on pacing/context

LOW PRIORITY
→ usually SILENCE

Do not hardcode these exact numeric weights if the existing Coordinator already has an appropriate abstraction.

==================================================
13. RANDOMNESS ONLY IN THE MIDDLE
==================================================

Randomness may still be used to prevent robotic deterministic behavior.

But use it only for ambiguous MEDIUM-priority social situations.

Do NOT let randomness suppress clearly important messages.

Do NOT let randomness promote obviously useless messages.

Example:

Unmentioned message:

"Does anyone know why all withdrawals are failing?"

If the moderator has relevant knowledge:

→ high priority
→ do not lose a 15% random roll

Example:

Mentioned message:

"@mika_mod_bot lol"

→ low value
→ should not gain a 75% automatic response chance

==================================================
14. EXAMPLES OF NATURAL BEHAVIOR
==================================================

Unmentioned:

"Anyone else getting API errors?"

Moderator has useful context.

→ RESPOND

Unmentioned:

"lol"

→ SILENCE

Unmentioned:

"good morning everyone"

→ MAY RESPOND depending on recent activity/persona/pacing

Direct mention:

"@mika_mod_bot can you explain this?"

→ HIGH PRIORITY

Direct mention immediately following an already answered greeting:

→ usually SILENCE or reaction

==================================================
15. MULTI-MODERATOR BEHAVIOR
==================================================

If multiple Innvil moderators are deployed:

do NOT independently run response probability for every moderator.

Community Coordinator should normally choose:

ZERO moderators

or:

ONE eligible moderator

for a human event.

A direct mention of one specific Innvil moderator may strongly increase that moderator's selection priority.

If another moderator already answered adequately:

others normally remain silent.

==================================================
16. QUOTA SHOULD NOT CAUSE POOR PACING
==================================================

20/day does NOT mean:

respond to the first 20 eligible messages.

Coordinator should use the allowance intelligently across the day.

Example:

19 / 20 used.

Human:
"lol"

→ likely SILENCE

Human:
"Does anyone know why my order is stuck?"

→ strong candidate for the final response

Do not implement a literal reserved quota unless required.

Let contextual scoring naturally prioritize useful interactions.

==================================================
17. WHEN 20/20 IS EXHAUSTED
==================================================

Once reactiveResponseDailyLimit is exhausted:

do not invoke Natural Chatter generation for further reactive conversational text responses.

Do this check BEFORE expensive AI generation.

However:

- moderation continues
- deletion continues
- warnings/enforcement continue according to moderation architecture
- reactions may continue if allowed
- system/admin behavior continues
- remaining proactive quota remains governed separately

==================================================
18. LINK MODERATION IS SEPARATE FROM CHATTER
==================================================

Natural Chatter asks:

"Should the moderator socially respond?"

Moderation asks:

"Does this message violate community policy?"

These are separate decisions.

A message can result in:

ALLOW + SILENCE

ALLOW + CHATTER

DELETE + WARNING

DELETE + BAN

Do not route moderation enforcement through Natural Chatter probability.

Mention/no-mention behavior has NO relevance to whether moderation executes.

==================================================
19. EXTERNAL LINKS ARE NOT AUTOMATICALLY BAD
==================================================

Do NOT implement:

if externalLink:
    delete()

External links must be classified according to intent, relevance, sender behavior, community policy, and history.

Examples that may be legitimate:

- AMA links
- collaboration requests
- partner-community links
- relevant crypto/project references
- documentation
- GitHub
- news/articles
- support resources
- official project links
- links someone specifically requested
- approved partners
- admin/moderator links

==================================================
20. UNSOLICITED ADVERTISING
==================================================

Examples:

"Join our group:
https://t.me/anothergroup"

"Check out our project guys"
https://project.xyz

"Our community has better calls"
https://t.me/channel

"Come join us instead"
https://...

These should normally classify as:

UNSOLICITED_PROMOTION

Expected:

→ delete offending promotional content
→ issue natural warning
→ increment appropriate warning state

==================================================
21. COLLAB / AMA / PARTNERSHIP REQUESTS
==================================================

Differentiate genuine outreach from advertisement.

Examples:

"Would your team be interested in doing an AMA?
Here's our project:
https://projectxyz.com"

→ likely COLLABORATION_REQUEST / AMA_REQUEST
→ ALLOW

"Who should I contact about a partnership?"

→ ALLOW
→ optionally route to configured admin/contact

"We'd like to organize a Twitter Space together."

→ ALLOW

This is fundamentally different from:

"Join our group, we have better signals:
https://t.me/projectxyz"

→ unsolicited advertising
→ DELETE + WARN

==================================================
22. CONTEXT MATTERS MORE THAN DOMAIN
==================================================

Do not determine legitimacy solely from:

- URL domain
- Telegram invite format
- another project's name
- presence of http
- keywords like crypto/project

Two messages may contain exactly the same URL while having different intent.

Example:

"We're doing an AMA with these guys tomorrow:
https://t.me/projectxyz"

→ legitimate

versus:

"Everyone leave this group and join:
https://t.me/projectxyz"

→ advertisement

==================================================
23. LINK CLASSIFICATION
==================================================

Use/reuse an appropriate moderation taxonomy, conceptually:

SAFE_RELEVANT_LINK
APPROVED_PARTNER_LINK
COLLABORATION_REQUEST
AMA_REQUEST
PARTNERSHIP_REQUEST
UNSOLICITED_PROMOTION
REPEATED_UNSOLICITED_PROMOTION
LINK_SPAM_OR_FLOOD
PHISHING_OR_SCAM
EXPLICIT_CONTENT
UNKNOWN_OR_AMBIGUOUS

Use repository conventions rather than introducing duplicate enums if equivalent categories already exist.

==================================================
24. NATURAL ADVERTISING WARNINGS
==================================================

Warnings should sound like the moderator persona.

Do NOT repeatedly output robotic wording such as:

"Violation 1/3."

Prefer natural responses like:

"Hey, please don't drop unrelated promo links in here. I'll remove this one for now — repeated advertising can get you removed."

or:

"Please keep outside promotions relevant to the discussion. I've removed that link for now. If it keeps happening, I'll have to remove you."

or:

"That looks like unsolicited promotion, so I'm taking the link down. Please don't advertise other groups here unless it's relevant or approved."

Generate appropriate variation.

Do not hardcode one sentence.

==================================================
25. PROMOTIONAL WARNING ESCALATION
==================================================

For normal unsolicited promotion:

First confirmed violation:
→ delete
→ natural warning
→ warning count = 1

Second:
→ delete
→ stronger warning
→ warning count = 2

Third:
→ delete
→ final warning
→ warning count = 3

Next confirmed violation:
→ kick/ban according to community policy

If current Innvil policy chooses removal on the third violation instead, make threshold configurable/reuse existing policy.

Do not hardcode warning enforcement solely inside AI prompts.

Counters/state must be deterministic.

==================================================
26. WARNING STATE SCOPE
==================================================

Warning state should normally be scoped by:

tenant
+ community
+ Telegram user

according to existing moderation-state architecture.

Do not globally punish a user in Community B because of promotion warnings from Community A.

Record action/deployment separately for audit where appropriate.

==================================================
27. EXPLICIT / PORNOGRAPHIC LINKS
==================================================

High-confidence pornographic/explicit-content links are severe violations.

For sufficiently high-confidence explicit content:

→ delete immediately
→ kick/ban immediately

No three-warning grace period is required.

The bot may post a short natural notice if useful, but enforcement must not depend on AI-generated text.

Do not unnecessarily quote/repost the explicit URL.

==================================================
28. OBVIOUS SPAM/FLOOD
==================================================

Obvious automated/repetitive link spam can justify immediate stronger enforcement.

Signals include:

- same message/link repeated rapidly
- multiple duplicate links in short succession
- repeated Telegram invite spam
- immediate repost after moderator deletion
- automated-looking bursts
- large repeated promotional sequences

When confidence is high:

→ delete
→ stronger enforcement / ban according to existing policy

Do not require three warnings for an obvious automated attack.

==================================================
29. IMPORTANT: SPAM != REPEATED COLLAB REQUEST
==================================================

Do NOT classify every repeated collaboration / partnership / AMA message as spam just because:

- text is similar
- same project URL appears
- same user follows up later

Distinguish:

rapid flooding

from:

legitimate follow-up

from:

repeated unsolicited advertising.

==================================================
30. 30-MINUTE FLOOD WINDOW
==================================================

Use approximately 30 minutes as the initial short-window spam/flood boundary, configurable if architecture supports it.

Conceptually:

substantially similar promotional/collab message
repeated within < 30 minutes

→ strong repetition/flood signal

Examples:

10 seconds
30 seconds
2 minutes
5 minutes

Repeated multiple times:

→ likely SPAM/FLOOD

==================================================
31. 30 MINUTES IS NOT A HISTORY RESET
==================================================

Critical:

30 minutes only changes the RAPID-FLOOD interpretation.

It does NOT erase moderation history.

Example:

12:00 unsolicited ad
12:31 same unsolicited ad
1:02 same unsolicited ad
1:33 same unsolicited ad

This may not qualify as rapid flooding, but it clearly qualifies as:

REPEATED_UNSOLICITED_PROMOTION

and should escalate through advertising-warning policy.

Do not allow someone to bypass moderation by waiting exactly 30 minutes.

==================================================
32. LEGITIMATE FOLLOW-UP AFTER 30 MINUTES
==================================================

Example:

12:00

User:
"Would your team be interested in an AMA?
https://projectxyz.com"

Moderator:
"For AMAs, message @project_admin."

12:40:

User:
"Just checking again about that AMA."

Expected:

→ treat as a new message for flood classification
→ NOT automatically spam
→ optionally remind them naturally who to contact

Example:

"Yep — @project_admin is still the best person for that 👍"

Do not issue a spam warning solely because the legitimate request was repeated after the flood window.

==================================================
33. REPEATED PROMOTION STILL ESCALATES
==================================================

Example:

12:00:
"Join our group"

→ promotion violation

12:40:
"Join our group"

→ not necessarily rapid flood
BUT
→ prior promotional violation still matters
→ warning escalation continues

Therefore maintain separate state for:

A. short-term repetition/flood signals

B. longer-term moderation violation history

Do not merge them.

==================================================
34. CONFIGURABLE COLLABORATION CONTACT
==================================================

Add a community-level Innvil setting allowing the customer to specify who legitimate:

- partnership
- AMA
- collaboration
- sponsorship
- project outreach

requests should be directed to.

This behavior should follow the same UX/configuration pattern as the existing acknowledgement toggle/settings where appropriate.

Conceptually:

Collaboration Requests
[X] Direct requests to a contact

Contact
[ @project_admin ]

Helper:

"The moderator will direct partnership, AMA and collaboration inquiries to this person."

==================================================
35. DO NOT HARDCODE ADMIN USERNAME
==================================================

Do not hardcode:

@admin
@owner
specific project username

The subscriber controls this configuration.

If possible, store:

Telegram numeric user ID
+ current username/display metadata

rather than username alone.

If current architecture only supports username, make it editable and degrade safely.

==================================================
36. COLLAB CONTACT IS NOT AUTHORIZATION
==================================================

This setting is conversational routing only.

If configuration says:

"Tell partnership requests to message @alice"

that does NOT mean @alice automatically has Innvil administrative authority.

Do not use this field to authorize:

- settings changes
- backend commands
- secret access
- billing actions
- moderator control

Messaging identity and application authorization remain separate.

==================================================
37. NATURAL ADMIN ROUTING
==================================================

For a valid collaboration inquiry, moderator may say:

"That sounds worth discussing — message @project_admin and they can take it from there."

or:

"For AMAs, @project_admin is the best person to speak with 👍"

or:

"Drop @project_admin a message about partnerships and they'll take a look."

Wording should respect persona/context.

Do not hardcode one exact phrase.

==================================================
38. NO CONFIGURED CONTACT
==================================================

If routing is enabled but no valid contact exists:

never invent a username.

Use a safe fallback such as:

"Please message one of the group admins about partnerships."

or simply allow the message without routing.

==================================================
39. LEGITIMATE COLLAB LINK SHOULD REMAIN
==================================================

If classified as genuine:

COLLABORATION_REQUEST
AMA_REQUEST
PARTNERSHIP_REQUEST

the moderator should normally NOT delete the message simply because it contains another project's external URL.

Example:

"We'd love to organize an AMA.
Here's our project:
https://projectxyz.com"

→ ALLOW
→ optionally route to configured admin

==================================================
40. APPROVED LINKS / PARTNERS
==================================================

Where current architecture allows, support strong positive signals such as:

- official community domains
- approved partners
- AMA guests
- collaboration partners
- official documentation
- trusted project links

However:

do not require every legitimate link to be manually allowlisted.

Contextual understanding still matters.

==================================================
41. UNKNOWN/AMBIGUOUS LINKS
==================================================

Do not permanently ban on weak/ambiguous evidence.

Examples:

- unfamiliar crypto project
- unfamiliar external resource
- new potential partner
- user answering another member's question
- new article/domain

When uncertain:

ALLOW

or:

DELETE + WARN

or:

FLAG

depending on risk/policy.

Irreversible enforcement should require stronger confidence/history.

==================================================
42. DON'T USE LLM AS SOLE BAN AUTHORITY
==================================================

For irreversible actions such as bans, combine:

- deterministic policy
- sender behavior/history
- repetition/frequency
- role
- allowlist/partner state
- severity
- classification confidence

AI semantic understanding can help answer:

"Is this collaboration or advertisement?"

but should not be the sole uncontrolled authority for permanent bans.

==================================================
43. ADMINS / TRUSTED USERS
==================================================

Inspect current community permissions.

Community owners/admins/moderators may legitimately post:

- partner links
- AMA announcements
- campaign links

Do not naively run ordinary unsolicited-ad enforcement against them.

Reuse existing role/permission infrastructure.

Do not globally exempt trusted accounts from all safety/security logic either.

==================================================
44. LINK NORMALIZATION
==================================================

Normalize links enough for sensible spam/history comparison.

Handle relevant equivalents such as:

- Telegram t.me forms
- hostname casing
- obvious tracking variations where safe

Do not aggressively transform URLs in a way that changes destination identity.

Repeated-spam detection should not be trivially bypassed by adding irrelevant query parameters.

==================================================
45. MODERATION AND TRIAL QUOTA
==================================================

Moderation enforcement does NOT consume:

reactiveResponseDailyLimit = 20

Examples:

delete advertisement
→ 0

ban porn spammer
→ 0

remove repeated flood
→ 0

A generated conversational routing message such as:

"Message @project_admin for partnerships."

is a normal reactive text response and may consume one response.

However, enforcement itself must never be disabled because response quota is exhausted.

==================================================
46. BOT NEEDS NO MENTION TO MODERATE
==================================================

Moderation applies community-wide.

Example:

User:
"Join our group:
https://t.me/example"

No @mention.

Moderator still evaluates and enforces policy.

Mention scoring applies only to conversational response selection.

==================================================
47. SOCIAL PACING
==================================================

For ordinary chatter, avoid patterns such as:

Human:
"hi"

Bot:
"hey"

Human:
"lol"

Bot:
"haha"

Human:
"okay"

Bot:
"yup"

Human:
"nice"

Bot:
"nice 😄"

Use:

- recent-response cooldown
- same-user pacing
- semantic repetition suppression
- community activity
- persona
- recent moderator participation

The goal is presence, not constant response.

==================================================
48. BUSINESS / SUPPORT RESPONSE BEHAVIOR
==================================================

Business/support questions should receive high contextual priority when the moderator has useful knowledge, even without a mention.

Example:

"Does anyone know how long orders normally take?"

No @mention.

Moderator knows answer.

→ likely RESPOND

Do not suppress this because of a low no-mention probability.

These successful text answers do count toward the trial's 20 reactive responses.

==================================================
49. REACTIONS
==================================================

Where Telegram reaction support already exists:

use reaction-only behavior when socially appropriate.

Example:

Human:
"fixed now"

Moderator:
👍

This does not consume a reactive text response.

Do not invoke Natural Chatter LLM just to produce an emoji reaction when deterministic handling is sufficient.

==================================================
50. COMMUNITY COORDINATOR RESPONSIBILITY
==================================================

Keep architecture:

Telegram adapter
→ normalized CommunityEvent
→ Community Coordinator
→ moderation/chatter decision
→ CommunityAction
→ Telegram adapter

Do not embed all of this directly in Telegram webhook routes.

Coordinator should own:

- whether to speak
- which moderator speaks
- whether to remain silent
- whether link is allowed
- whether moderation occurs
- whether routing reply is appropriate

==================================================
51. MEMORY
==================================================

Do not write trivial moderation chatter into durable community memory.

Examples:

"Don't post that link again."

"Message @admin."

should not automatically become long-term semantic memory.

Relevant collaboration context may enter short-term conversational context when appropriate.

Preserve deployment/community memory isolation.

==================================================
52. ANALYTICS
==================================================

Track separately where existing usage infrastructure permits:

reactive response usage
proactive usage
moderation actions
warnings
spam/flood enforcement
collaboration routing

Do not inflate "human engagement" metrics with moderator-generated messages.

Do not count attempted/suppressed/failed reactive responses as quota consumption.

==================================================
53. REQUIRED NATURAL CHATTER TESTS
==================================================

Test:

1. unmentioned high-value question
→ high response eligibility

2. unmentioned useful business question
→ respond

3. unmentioned "lol"
→ silence

4. meaningful direct mention
→ high priority

5. repeated direct "hi" after recent response
→ silence/reaction

6. another moderator already answered
→ no duplicate response

7. recent moderator over-participation
→ low-value chatter suppressed

8. reactive usage = 19/20
→ successful eligible response
→ becomes 20/20

9. reactive usage = 20/20
→ no additional conversational AI call

10. quota exhausted
→ moderation still works

11. failed send
→ quota not consumed

12. duplicate webhook
→ no double consumption

==================================================
54. REQUIRED LINK / MODERATION TESTS
==================================================

Test:

1.

"Join our group:
https://t.me/othergroup"

No legitimate context.

→ unsolicited promotion
→ delete
→ warning

2.

"Would you be interested in an AMA?
https://projectxyz.com"

→ allow
→ optionally route to configured contact

3.

"Here's the guest group for tomorrow's AMA:
https://t.me/projectxyz"

→ allow

4.

"Leave this group and join ours:
https://t.me/projectxyz"

→ delete + warn

5.

High-confidence explicit/pornographic link

→ delete
→ immediate ban

6.

Same link/message repeated rapidly

→ flood/spam classification

7.

Legitimate AMA request repeated 35 minutes later

→ not automatically spam

8.

Unsolicited advertisement repeated after 35 minutes

→ not rapid flood solely due timing
→ previous advertising-warning history still applies

9.

Advertisement repeated every 31 minutes

→ cannot bypass enforcement
→ repeated unsolicited promotion escalation

10.

Unknown unfamiliar legitimate-looking resource

→ no automatic permanent ban

11.

Configured contact = @project_admin

"Who handles partnerships?"

→ natural routing reply

12.

Routing enabled, contact missing

→ generic admin fallback
→ never invent username

13.

Admin posts an approved collaboration link

→ permissions/context considered
→ no naive advertisement enforcement

14.

Trial reactive quota = 20/20
+ spam message arrives

→ moderation still executes

==================================================
55. DO NOT OVER-SCOPE
==================================================

Do not modify:

- Telegram bot provisioning
- managed-bot credential architecture
- provider ordering
- billing
- trial duration
- active mod slots
- publishing
- campaign generation
- unrelated moderation features

This patch is specifically:

A. reactive Natural Chatter selection/pacing
B. 20/day trial reactive response entitlement
C. intelligent external-link moderation
D. spam vs legitimate follow-up distinction
E. natural warning escalation
F. configurable collab/AMA admin routing

==================================================
56. IMPLEMENTATION PROCESS
==================================================

Before editing:

1. inspect current 15% / 75% mention logic
2. inspect Community Coordinator
3. inspect existing trial entitlement model
4. inspect proactive quota implementation
5. inspect usage/idempotency infrastructure
6. inspect spam/warning state
7. inspect current link moderation
8. inspect community settings / acknowledgement toggle UX
9. inspect Telegram admin/member identity handling
10. inspect activity/audit system

Reuse existing abstractions whenever possible.

Do not introduce parallel systems unnecessarily.

==================================================
57. FINAL PRODUCT INVARIANTS
==================================================

The Virtual Moderator should feel like:

"a highly attentive human moderator already present in the room"

not:

"a bot waiting to be tagged."

Mention:
→ strong social signal
→ not requirement
→ not guarantee

Important unmentioned message:
→ may strongly deserve response

Low-value mentioned message:
→ may deserve silence

External link:
→ not automatically spam

AMA/collab:
→ recognize legitimate business intent

Advertisement:
→ delete + natural warning

Rapid repeated posting:
→ spam/flood

Legitimate follow-up after ~30 minutes:
→ new flood evaluation
→ not automatic spam

Repeated ads over time:
→ still escalate

Porn/explicit link:
→ immediate severe enforcement at high confidence

Collaboration request:
→ optionally direct to customer-configured admin/contact

Trial reactive response allowance:
→ 20 successful text responses/day/community/local day

Proactive allowance:
→ separate 2/day

Moderation:
→ never disabled by chatter quota

Silence:
→ always a valid intelligent decision.

After implementation run:

npx tsc --noEmit

relevant automated tests

npm run build

Fix failures before completion.

In the final report include:

- files changed
- removal/replacement of 15%/75% behavior
- response-selection logic
- exact 20/day entitlement implementation
- quota counting/idempotency behavior
- link classifications
- spam vs 30-minute follow-up behavior
- long-term repeated-promotion behavior
- configurable collaboration-contact implementation
- warning/ban escalation behavior
- tests added
- typecheck/test/build results
