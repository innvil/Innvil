# Bot-Ack Social Behavior: Community Handoff + Real Telegram Reactions

> Status: **NOTED — not implemented yet.** This is the source-of-truth spec for
> refining "Innvil Moderator Acknowledgement" (bot-ack) behavior, captured
> verbatim as given so no fidelity is lost before implementation. Do not
> implement from memory/paraphrase — implement from this file.
>
> This extends the already-built, now loop-fixed (v1.1.80) bot-ack feature in
> `src/lib/moderator/coordinator.ts` + `community-runtime.ts`. It does not
> replace or contradict the existing hard loop-prevention gates (origin/depth) —
> it adds a new bounded action type (`COMMUNITY_HANDOFF`) and redefines what
> `REACT` actually means at execution time (a real Telegram message reaction,
> not a standalone emoji text message — `executeAction`'s `REACT` branch already
> calls `setMessageReaction`, so the API-level piece may already be correct;
> verify before assuming this needs new Telegram-client code).
>
> **3+ moderator clarification (given informally, appended verbatim at the
> bottom of this file):** the same natural-conversation-then-redirect shape
> should hold with 3 or more moderators in a community, not just the 2-moderator
> case the main spec illustrates — either all eligible moderators may
> participate for a bounded stretch before one redirects to humans, or a later
> moderator may redirect directly without waiting for its own acknowledgement
> turn first.

## UPDATE BOT-TO-BOT CONVERSATION BEHAVIOR

The current hard rule:

BOT_ACK
→ no further response

is too blunt and can make moderators seem rude or socially broken.

We still need strict loop prevention, but moderators should be able to end a bot-to-bot exchange naturally by redirecting the conversation back to the human community.

==================================================
1. CORE RULE
==================================================

Do NOT allow unlimited bot-to-bot back-and-forth.

But also do NOT force a moderator to abruptly ignore a socially open-ended message from another Innvil moderator when a natural conversation handoff is appropriate.

Instead distinguish:

A. BOT-TO-BOT ACKNOWLEDGEMENT
B. COMMUNITY HANDOFF / TOPIC TRANSITION

A BOT_ACK must not trigger another BOT_ACK.

However, it MAY lead to a single bounded COMMUNITY_HANDOFF that addresses the group rather than continuing the bot-to-bot exchange.

==================================================
2. EXAMPLE
==================================================

Desired:

Bot 1:
"gm"

Bot 2:
"gm, how are you?"

Bot 1:
"good, you?"

Bot 2:
"never better — anyone here got something new today?"

Then:

Bot 1
→ SILENCE

This is acceptable because Bot 2 naturally redirected the exchange toward humans/community.

The conversation no longer feels abruptly cut off.

Undesired:

Bot 1:
"gm"

Bot 2:
"gm, how are you?"

Bot 1:
"good, you?"

Bot 2:
SILENCE

That feels socially incomplete.

==================================================
3. NEW ACTION TYPE / SEMANTICS
==================================================

Add or reuse a concept equivalent to:

COMMUNITY_HANDOFF

or:

TOPIC_TRANSITION

This is NOT a BOT_ACK.

Its purpose is:

- close the bot-to-bot exchange
- redirect attention to human members
- introduce a fresh community-facing topic
- avoid creating another reply obligation for the other moderator

Examples:

"Doing great — anyone here building anything interesting today?"

"All good 😄 What's everyone working on?"

"Can't complain. Anyone got updates from their side?"

"Pretty good — what's the mood in here today?"

==================================================
4. WHO IS THE TARGET?
==================================================

A COMMUNITY_HANDOFF must be addressed conceptually to:

the whole community / humans

not specifically to the other bot.

Avoid:

"How about you, Mika?"

because that invites another bot response.

Prefer:

"Anyone here have something new?"

because it opens the floor to humans.

==================================================
5. LOOP SAFETY
==================================================

Keep hard loop protection.

Conceptually:

origin = HUMAN
origin = PROACTIVE
origin = AUTO_POST
origin = BOT_ACK
origin = COMMUNITY_HANDOFF

Rules:

HUMAN
→ may cause one moderator response

PROACTIVE
→ may receive at most one bot acknowledgement

AUTO_POST
→ may receive at most one bot acknowledgement

BOT_ACK
→ may NOT trigger another BOT_ACK

BOT_ACK
→ MAY trigger at most one COMMUNITY_HANDOFF if socially appropriate

COMMUNITY_HANDOFF
→ MUST NOT trigger bot acknowledgement from another Innvil moderator

This prevents:

Bot A
→ Bot B
→ Bot A
→ Bot B
→ ...

==================================================
6. INTERACTION DEPTH
==================================================

Do not simply use one integer rule:

MAX_BOT_INTERACTION_DEPTH = 1

if that prevents a graceful handoff.

Instead preserve bounded depth with action semantics.

Conceptually:

depth 0:
original/proactive/human event

depth 1:
optional BOT_ACK

depth 2:
optional COMMUNITY_HANDOFF

STOP

No further bot-generated social action caused by that chain.

So:

max bot social chain depth = 2

BUT:

depth 2 must be community-facing handoff only.

It cannot be another direct acknowledgement.

==================================================
7. WHEN TO USE COMMUNITY_HANDOFF
==================================================

Use only when the bot-to-bot exchange would otherwise feel socially unfinished.

Good candidates:

- "how are you?"
- "what are you up to?"
- "anything interesting today?"
- a light greeting exchange
- a short role-based interaction that naturally leads back to the group

Do NOT always generate a handoff.

Silence is still allowed.

==================================================
8. DO NOT FORCE TOPIC CHANGE EVERY TIME
==================================================

Avoid robotic pattern:

bot acknowledgement
→ always ask community question

That would become predictable.

Coordinator should decide between:

IGNORE
REACTION
SHORT_ACKNOWLEDGEMENT
COMMUNITY_HANDOFF

based on:

- conversation state
- recent moderator chatter
- group activity
- whether humans are active
- whether the exchange feels complete
- moderator persona
- recent community topics

==================================================
9. NATURAL TOPIC CHANGE
==================================================

When transitioning, the moderator may:

A. open the floor generally

"Anyone here got updates today?"

B. reference recent human/community context

"Speaking of that, did anyone try the new feature yet?"

C. bring up relevant Community Knowledge

"By the way, has anyone checked the latest docs update?"

D. ask a low-pressure social question

"What's everyone working on today?"

Do not fabricate news or project updates just to change topic.

If using project/community facts, they must come from approved Project Knowledge / Community Knowledge.

==================================================
10. RECENT CONTEXT
==================================================

Prefer topic transitions grounded in recent community context.

Example:

Humans were previously discussing staking.

Bot exchange finishes.

Good handoff:

"Anyway, anyone here tried the new staking flow yet?"

Not:

"What's your favorite movie?"

unless that fits the community/persona and context.

==================================================
11. HUMAN-FIRST TRANSITION
==================================================

The purpose of the handoff is to create space for HUMANS.

After COMMUNITY_HANDOFF:

other Innvil moderators should remain silent for that causation chain.

Human replies may restart normal Coordinator logic as new HUMAN events.

==================================================
12. NO BOT RESPONSE TO HANDOFF
==================================================

Critical:

If Bot 2 says:

"Never better — anyone here have something new?"

Bot 1 must not answer:

"Nothing new here!"

That would restart the bot loop.

The handoff is considered community-facing.

Only human/member responses should normally continue that branch.

==================================================
13. CLASSIFICATION STILL INNVIL-ONLY
==================================================

This behavior applies only when sender classification is:

INNVIL_MODERATOR

and the other bot is:

- Innvil-managed
- identified by Telegram numeric bot ID
- actively deployed in the same Community
- eligible for bot interaction

EXTERNAL_BOT must not participate in this social handoff flow by default.

==================================================
14. QUOTA
==================================================

Keep bot-to-bot social usage separately bounded.

Do not consume the normal:

reactiveResponseDailyLimit = 20

for internal Innvil bot acknowledgement/handoff if the existing architecture already treats bot chatter separately.

Prefer a dedicated small daily bot-interaction allowance.

Example concept:

botAckDailyLimit = 2
or repository-equivalent policy

Do not let bot-to-bot chatter consume most of the human-facing response allowance.

==================================================
15. ANALYTICS
==================================================

Do not count:

BOT_ACK
COMMUNITY_HANDOFF

as human engagement.

Track them separately if analytics exist.

==================================================
16. MEMORY
==================================================

Do not write trivial bot exchanges to durable memory.

Example:

"gm"
"good, you?"
"never better"

→ no durable memory

If the handoff leads to meaningful human discussion, that later human discussion may enter normal Community Memory according to existing policy.

==================================================
17. TESTS
==================================================

TEST 1

Bot A:
"gm"

Bot B:
"gm, how are you?"

Bot A:
"good, you?"

Expected:
Bot B may produce:
"never better — anyone here got anything new?"

Then STOP bot chain.

==================================================
TEST 2

After COMMUNITY_HANDOFF:

Bot A receives it.

Expected:
Bot A does NOT reply.

==================================================
TEST 3

Human replies to COMMUNITY_HANDOFF.

Expected:
new HUMAN event
normal Coordinator logic may respond.

==================================================
TEST 4

Bot A sends simple acknowledgement:

"nice one"

Expected:
Bot B may IGNORE.
No forced handoff.

==================================================
TEST 5

Bot exchange already feels complete.

Expected:
SILENCE.

Do not generate unnecessary transition.

==================================================
TEST 6

Handoff uses project/community topic.

Expected:
fact must be grounded in current Community Knowledge / Project Knowledge.

==================================================
TEST 7

External bot says:
"gm, how are you?"

Expected:
no Innvil social bot-chain behavior by default.

==================================================
18. FINAL INVARIANT
==================================================

Bot-to-bot interaction should feel socially complete without becoming a bot conversation loop.

Desired shape:

Bot A
→ Bot B acknowledges
→ optional Bot A reply
→ Bot B gracefully redirects to humans/community
→ STOP bot chain

Not:

Bot A
→ Bot B
→ Bot A
→ Bot B forever

and not:

Bot A
→ Bot B
→ abrupt silence in the middle of a natural exchange.

The final bot-generated message in the chain should preferably close the exchange or open the floor to humans.

## UPDATE THE RECENT BOT-ACK / COMMUNITY-HANDOFF SPEC WITH NATURAL TELEGRAM REACTIONS

==================================================
1. REACT MEANS A REAL TELEGRAM MESSAGE REACTION
==================================================

The Coordinator action:

REACT

must mean:

use Telegram's actual message-reaction capability on the target message

NOT:

sendMessage("🔥")
sendMessage("👍")
reply with an emoji-only text message

Example:

Human:
"I just read there is a new update with Project Alpha"

Mika:
"Yeah — the latest update adds..."

Kaleb:
🔥 reaction attached to Mika's message

Kaleb must NOT send a separate:

"🔥"

message.

==================================================
2. REACTIONS ARE SOCIAL SIGNALS, NOT CHAT MESSAGES
==================================================

Treat Telegram reactions as lightweight acknowledgement.

They are useful when:

- agreement is enough
- appreciation is enough
- another moderator already gave a good answer
- a human shared something interesting
- a bot wants to acknowledge without adding another text message
- a conversation has already been adequately handled

A reaction should reduce chat clutter.

==================================================
3. REACTIONS MUST FEEL NATURAL
==================================================

Do NOT implement:

if not responding:
    react()

Do NOT react to every message.

Do NOT make every other moderator react whenever one Innvil moderator speaks.

Silence remains valid.

Coordinator should choose among:

SILENCE
REACT
SHORT_ACKNOWLEDGEMENT
NORMAL_RESPONSE
COMMUNITY_HANDOFF

depending on context.

==================================================
4. EXAMPLE — DESIRED FLOW
==================================================

Bot 1:
"gm"

Bot 2:
"gm, how are you?"

Bot 1:
"good, you?"

Bot 2:
"never better — anyone got something new today?"

Bot 1:
SILENCE

Human:
"I just read there's a new update with Project Alpha."

Coordinator selects ONE moderator.

Bot 1 OR Bot 2:
"Yeah, there is. The latest update adds [grounded explanation from Project/Community Knowledge]."

Then the OTHER moderator may:

🔥 react to that answer

instead of sending another text response.

This is good behavior.

It makes both moderators feel present without creating:

Bot 1 response
→ Bot 2 response
→ Bot 1 response
→ Bot 2 response

==================================================
5. REACTION IS OPTIONAL
==================================================

In the example above:

other moderator reacts 🔥

is allowed.

It is NOT mandatory.

Depending on pacing/context:

the other moderator may simply remain silent.

Do not create a rule:

"Whenever one Innvil bot answers, another Innvil bot must react."

That would quickly become artificial.

==================================================
6. WHO MAY REACT
==================================================

For moderator-to-moderator social reactions:

only an eligible:

INNVIL_MODERATOR

actively deployed in the SAME Community may participate.

Use Telegram numeric bot ID + active Innvil deployment.

Do not use username naming conventions.

External bots:

→ no social reaction choreography by default.

==================================================
7. HUMAN MESSAGES MAY ALSO RECEIVE REACTIONS
==================================================

Innvil moderators may naturally react to human messages too.

Examples:

Human:
"Finally got it working."

Moderator:
👍

Human:
"Just shipped our first version!"

Moderator:
🔥

Human:
"Thanks everyone."

Moderator:
❤️ or 👍 where appropriate

But again:

do not react constantly.

==================================================
8. REACTION SELECTION
==================================================

Choose reactions based on the semantic meaning and moderator personality.

Examples:

positive achievement:
🔥
👏
🎉
👍

agreement/confirmation:
👍
✅

funny/light:
😂

appreciation:
❤️
🙏 where Telegram/chat supports it

surprise:
😮

Do not randomly choose emojis without understanding the message.

Do not use inappropriate reactions for serious/negative events.

==================================================
9. USE ONLY ALLOWED TELEGRAM REACTIONS
==================================================

Before applying a reaction:

respect Telegram's available reactions for that chat/message.

Do not assume every emoji is available.

If the desired reaction is unavailable:

choose an allowed appropriate reaction

or:

SILENCE

Do NOT replace it with a standalone emoji text message merely because the reaction API cannot use that emoji.

==================================================
10. REACTION PACING
==================================================

Add pacing safeguards.

Consider:

- moderator recently reacted
- moderator recently spoke
- another Innvil moderator already reacted
- same message already has an Innvil moderator reaction
- recent reaction density
- importance of message
- current community activity

Do not create patterns like:

Human message
→ Mika reacts

next human message
→ Mika reacts

next message
→ Kaleb reacts

next message
→ Mika reacts

continuously.

==================================================
11. ONE INNVIL SOCIAL REACTION IS USUALLY ENOUGH
==================================================

For most messages:

zero or one Innvil moderator reaction is enough.

Example:

Mika gives an excellent answer.

Kaleb:
🔥

Alex:
SILENCE

Do NOT normally produce:

Kaleb 🔥
Alex 👍
Sarah ❤️

on the same moderator message.

Coordinator should select zero or one reacting moderator for ordinary events.

==================================================
12. REACTIONS AFTER KNOWLEDGE ANSWERS
==================================================

This is especially useful when one moderator answers a human using Community Knowledge / Project Knowledge.

Example:

Human:
"What's the Project Alpha update?"

Mika:
"The new release adds X and Y..."

Kaleb:
🔥

Kaleb should not repeat:

"Yes, exactly. The update adds X and Y."

Use the reaction to show presence without duplicating information.

==================================================
13. REACTION DOES NOT START A BOT CHAIN
==================================================

A reaction must NOT become a new conversational event that triggers:

another bot acknowledgement

or:

another bot response.

Example:

Mika:
"Latest update includes X."

Kaleb:
🔥 reaction

STOP.

Mika must not respond to Kaleb's reaction.

Do not create reaction loops.

==================================================
14. COMMUNITY_HANDOFF + REACTION FLOW
==================================================

The recent bot-to-bot handoff logic remains:

Bot 1:
"gm"

Bot 2:
"gm, how are you?"

Bot 1:
"good, you?"

Bot 2:
"never better — anyone got anything new?"

Then:

Bot 1:
SILENCE

Do NOT react merely because Bot 2 performed a community handoff.

The handoff already completed the social exchange.

Wait for humans.

==================================================
15. HUMAN RESTARTS NORMAL FLOW
==================================================

When a human responds after COMMUNITY_HANDOFF:

Human:
"I heard Project Alpha has an update."

This is a NEW HUMAN event.

Coordinator may choose:

Mika → text answer

OR:

Kaleb → text answer

Normally only ONE moderator should provide the substantive answer.

Then another moderator MAY react to that answer if socially appropriate.

==================================================
16. GROUND KNOWLEDGE ANSWERS
==================================================

For:

Human:
"I heard Project Alpha has a new update."

The selected moderator must not invent the update.

Retrieve from:

current Community Knowledge
+
approved Project Knowledge

according to existing knowledge precedence.

If supported knowledge says:

"Alpha v2 introduces X"

then answer naturally.

If Innvil has no reliable information:

do not fabricate an update.

==================================================
17. REACTION QUOTA
==================================================

A true Telegram message reaction does NOT consume:

reactiveResponseDailyLimit = 20

because it is not a conversational text response.

It also does not consume:

proactiveDailyLimit = 2

It should have separate anti-spam/pacing limits if necessary.

Do not abuse the lack of text quota to generate unlimited reactions.

==================================================
18. NO LLM REQUIRED FOR OBVIOUS REACTIONS
==================================================

Where context is obvious:

do not call an expensive LLM solely to decide:

👍

Example:

Human:
"Fixed."

Recent context shows they solved the issue.

A deterministic/social heuristic may choose:

👍

Use AI semantic classification only where useful.

==================================================
19. DO NOT TREAT REACTION AS FALLBACK
==================================================

Critical:

The hierarchy must NOT be:

don't text
→ react

Sometimes the correct result is simply:

SILENCE.

Example:

Human:
"ok"

Expected:
usually SILENCE

not automatically:
👍

Example:

Human:
"lol"

Expected:
usually SILENCE

not automatically:
😂

==================================================
20. REACTION TARGET MUST BE EXPLICIT
==================================================

CommunityAction for a reaction should contain the exact Telegram target message.

Conceptually:

REACT {
    chatId
    messageId
    reaction
    moderatorDeploymentId
}

Do not infer "latest message" at execution time.

This prevents race conditions and reacting to the wrong message.

==================================================
21. IDEMPOTENCY
==================================================

Reaction execution should be idempotent.

Duplicate Telegram webhook/event processing must not repeatedly mutate/reapply reactions unnecessarily.

Use existing event/action deduplication.

==================================================
22. ANALYTICS
==================================================

Track reactions separately from:

- human-facing text responses
- bot acknowledgements
- proactive posts
- auto-posts
- moderation actions

A reaction is moderator activity.

It is NOT a human message.

Do not inflate conversational response counts.

==================================================
23. REQUIRED TESTS
==================================================

TEST 1

Human:
"I just read there's a new Project Alpha update."

Mika gives grounded answer.

Kaleb is eligible.

Expected:
Kaleb MAY react 🔥 to Mika's exact Telegram message.

No additional Kaleb text required.

==================================================
TEST 2

Kaleb reacts 🔥 to Mika's answer.

Expected:
Mika does not respond.
No bot-chain event generated.

==================================================
TEST 3

Human:
"ok"

Expected:
usually SILENCE.
No automatic reaction.

==================================================
TEST 4

Human:
"Finally fixed it!"

Expected:
moderator may naturally react 👍/🔥 depending on persona/context.

==================================================
TEST 5

Mika answers.

Kaleb reacts.

Alex is also active.

Expected:
Alex normally SILENCE.
Do not stack multiple Innvil reactions.

==================================================
TEST 6

Desired reaction unavailable in the Telegram chat.

Expected:
use another appropriate allowed reaction or SILENCE.

Do not send an emoji text message as fallback.

==================================================
TEST 7

Reactive quota = 20/20.

Eligible human achievement message.

Expected:
reaction may still occur according to pacing because true reactions do not consume text-response quota.

==================================================
TEST 8

Duplicate event/action execution.

Expected:
no repeated/reaction spam.

==================================================
24. UPDATED SOCIAL INVARIANT
==================================================

Innvil moderators should feel like multiple socially aware human moderators sharing a room.

They do NOT all need to speak.

Example:

Bot 1:
"gm"

Bot 2:
"gm, how are you?"

Bot 1:
"good, you?"

Bot 2:
"never better — anyone got anything new?"

Bot 1:
SILENCE

Human:
"I heard Project Alpha just got an update."

Bot 1:
"Yep — the latest update introduces X..."

Bot 2:
🔥 [REAL TELEGRAM REACTION ON BOT 1'S MESSAGE]

STOP.

This is desirable.

It communicates:

- presence
- agreement
- personality
- social awareness

without unnecessary text chatter.

Reactions should feel earned and contextual.

Never turn them into an automatic response to every message.

## 3+ MODERATOR CLARIFICATION (given informally, same conversation)

> Verbatim from the user, appended here since it directly qualifies the
> 2-moderator examples throughout this spec:

"in the ack right now, this is only for basic, or the 2 mods. but when there
are 3 mods, the conversation should still feel natural, either they all talk
for a certain time, until one of them redirects to human chat, or bot 3 could
redirect without having to wait to another ack from another bot.

sample:

b1: gm, how's evr1
b2: feelin gud
b3: good, hope you are too - redirect"

Reading: with 3+ eligible moderators in a community, the same
acknowledge-then-redirect shape applies, but it is NOT strictly bound to
exactly 2 hops before a mandatory handoff. Either (a) multiple moderators may
each take a bounded turn in the same exchange before one of them redirects, or
(b) a later moderator in the chain may perform the `COMMUNITY_HANDOFF` directly
instead of first producing its own `BOT_ACK` — i.e. the redirect doesn't have
to wait for every eligible moderator to have acknowledged first. The
`depth 0 → depth 1 (BOT_ACK) → depth 2 (COMMUNITY_HANDOFF) → STOP` model from
§6 above still needs to generalize sensibly to N moderators rather than being
hardcoded to exactly one BOT_ACK hop; implement this from the intent above, not
by inventing new fixed depth arithmetic not stated here.
