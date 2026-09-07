# Telegram Bot-to-Bot Delivery Correction + AI Moderator Onboarding Automation Spec

> Status: **Diagnosis correction (acted on immediately) + onboarding automation spec
> (NOTED — not implemented yet).** Captured verbatim as given so no fidelity is lost.
> See the pointer in `CLAUDE.md` (Phase 4.O) for where this sits in the roadmap.
>
> **Do not implement/modify bot-ack Coordinator or classification code from this
> file until Telegram delivery is proven live** (§14/§Delivery Test below) —
> that's the explicit instruction that came with this spec. The onboarding
> automation section (§1 onward, "UPDATE TELEGRAM AI MODERATOR ONBOARDING") is a
> separate, larger, NOTED-not-built feature: automating the Telegram-side setup
> (add-to-group deep link with suggested admin rights, guided BotFather steps for
> Bot-to-Bot Communication Mode + Group Privacy Mode, and delivery-based
> verification) so deploying an AI Moderator feels like one flow instead of ten
> manual Telegram settings.

The previous diagnosis is incorrect/outdated.

Telegram now officially supports Bot-to-Bot Communication Mode.

Do NOT conclude that Telegram inherently blocks messages from other bots.

Official Telegram documentation says bots can receive messages from other bots in groups when Bot-to-Bot Communication Mode is enabled.

For Innvil's intended unsolicited moderator-to-moderator acknowledgement flow, configure each participating Innvil managed bot with:

1. Bot-to-Bot Communication Mode ENABLED in @BotFather.
2. Group Privacy Mode DISABLED.
3. Admin rights in the target group/supergroup.

Use both admin + privacy-disabled for Innvil's supported configuration so we are not relying on ambiguous/minimal delivery conditions.

Then rerun the real test:

Kwan (Innvil managed bot)
→ sends ordinary group message

Telegram
→ delivers update to Test's normal webhook

Test webhook
→ normalizes CommunityEvent

sender.bot === true
+
sender Telegram numeric bot ID matches an active Innvil TelegramBotIntegration / ModeratorDeployment in THIS community
→ classify INNVIL_MODERATOR

Coordinator
→ evaluate bot acknowledgement policy

Do not classify based on username suffix.

==================================================
IMPORTANT TELEGRAM-SIDE REQUIREMENT
==================================================

Bot-to-Bot Communication Mode is a Telegram/BotFather configuration, not an Innvil application toggle.

Check whether this mode is actually enabled for BOTH Test and Kwan.

Do not infer it from:

- being admin
- Privacy Mode
- webhook health
- managed-bot status

These are separate settings.

If Bot-to-Bot Communication Mode is not enabled, enable it in @BotFather before changing application code.

==================================================
DELIVERY TEST
==================================================

After enabling the Telegram-side settings, perform one controlled test:

1. Test and Kwan are both in the same group.
2. Both have Bot-to-Bot Communication Mode enabled.
3. Both have Group Privacy Mode disabled.
4. Both are admins.
5. Test webhook is healthy.
6. Kwan sends ONE normal group message.

Then verify:

A. Test webhook receives an update.
B. community_messages contains the message.
C. sender is classified by numeric Telegram bot ID.
D. classification = INNVIL_MODERATOR.
E. Coordinator emits either:
   - IGNORE
   - REACT
   - SHORT_ACKNOWLEDGEMENT
   according to policy.
F. No acknowledgement loop occurs.

==================================================
LOOP SAFETY REMAINS MANDATORY
==================================================

Telegram explicitly warns that bot-to-bot communication can create loops.

Keep the existing Innvil safeguards:

MAX_BOT_INTERACTION_DEPTH = 1

origin:
HUMAN
PROACTIVE
BOT_ACK

A normal/proactive message:
A → B may acknowledge once

BOT_ACK:
must NOT trigger another bot acknowledgement.

Also retain:

- message deduplication
- per-chat rate limiting
- per-bot-pair pacing
- causationMessageId
- interactionDepth
- Coordinator selects zero/one responding moderator
- reaction preferred when sufficient

Do not rely on prompts alone for loop prevention.

==================================================
DO NOT MODIFY BOT-ACK LOGIC YET
==================================================

First prove Telegram delivery with the correct Telegram settings.

The current failure:

Kwan sent message
→ Test webhook received nothing

is consistent with Bot-to-Bot Communication Mode not being enabled/configured correctly.

Do not rewrite Coordinator/classification code until delivery has been retested after Telegram configuration.

UPDATE TELEGRAM AI MODERATOR ONBOARDING / COMMUNITY DEPLOYMENT.

We now need to make Telegram-side setup as automated and user-friendly as Telegram officially permits.

The goal:

When an Innvil AI Moderator is deployed into a community, Innvil should help the user:

1. add the bot to the intended Telegram group
2. request the required admin permissions through Telegram's official add-to-group flow
3. confirm/start the deployment
4. guide the user through enabling Bot-to-Bot Communication Mode when bot acknowledgements are enabled
5. guide the user through disabling Group Privacy Mode when required
6. verify the resulting Telegram configuration before enabling bot-to-bot acknowledgements

Do NOT claim Innvil can automatically change Telegram settings that Telegram does not expose through a supported API.

==================================================
1. /START IS SUPPORTED
==================================================

Innvil managed AI Moderators are normal Telegram bots at runtime.

They may implement:

/start

and Telegram deep-link start parameters.

Use /start for onboarding/status/setup interactions where appropriate.

However:

/start does NOT itself grant Telegram administrator rights.

It also must NOT be treated as an undocumented mechanism for changing BotFather configuration.

==================================================
2. ADD-TO-GROUP DEEP LINK WITH ADMIN RIGHTS
==================================================

Telegram officially supports bot deep links for adding a bot to a group and suggesting administrator permissions.

Use the official group bot-link mechanism.

Conceptually:

https://t.me/<BOT_USERNAME>?startgroup=<SIGNED_OR_OPAQUE_PARAMETER>&admin=<REQUESTED_RIGHTS>

Do NOT hardcode the exact permission-string format until inspecting Telegram's current official deep-link specification and existing project helpers.

The link should:

- open Telegram
- let the user choose the target group
- propose the required moderator admin rights
- let the USER confirm the permissions

Telegram must remain the authority granting those rights.

Innvil must never pretend to have granted itself administrator access.

==================================================
3. REQUIRED ADMIN RIGHTS
==================================================

Request the minimum rights needed for the enabled Innvil features.

For the full AI Moderator capability, likely required rights include those needed for:

- deleting violating messages
- restricting/banning users
- managing relevant group moderation actions

Do NOT request dangerous/unnecessary permissions merely because Telegram allows them.

For example:

do not request permission to add new administrators unless an Innvil feature genuinely requires it.

Use least privilege.

Inspect the exact Telegram ChatAdminRights mapping before implementation.

==================================================
4. RIGHTS SHOULD FOLLOW FEATURES
==================================================

Prefer feature-based rights calculation.

Example:

Natural chatter only:
→ minimal/no moderation admin rights where possible

Moderation enabled:
→ delete messages
→ restrict users

Auto-posting:
→ permission required to send/post in target chat according to Telegram chat type

Do not request every possible admin permission for every deployment.

==================================================
5. USER CONFIRMATION IS REQUIRED
==================================================

Telegram admin permissions cannot be silently self-granted by the bot.

Expected flow:

Innvil
→ "Add Mika to Community"

user clicks

Telegram
→ choose group
→ review requested admin rights
→ confirm

Then Innvil verifies actual rights.

Do not rely only on the user saying setup is complete.

==================================================
6. STARTGROUP PARAMETER
==================================================

Use a safe opaque/signed startgroup parameter to correlate the Telegram setup flow back to Innvil when useful.

It may represent:

- tenant
- deployment/onboarding session
- intended moderator
- intended community setup flow

Do NOT put:

- bot tokens
- webhook secrets
- raw tenant secrets
- sensitive identifiers

inside the visible parameter.

Validate server-side.

Do not rely on a username alone as authoritative identity.

==================================================
7. ACTUAL BOT IDENTITY
==================================================

After Telegram setup, continue using:

numeric Telegram bot ID

as durable runtime identity.

Username is display metadata only.

This remains consistent with the managed-bot provisioning architecture.

==================================================
8. BOT-TO-BOT COMMUNICATION MODE
==================================================

Innvil supports optional AI Moderator acknowledgement between Innvil bots.

Telegram officially requires Bot-to-Bot Communication Mode for this functionality.

This setting is PER BOT.

Do NOT assume:

- Manager Bot's setting applies globally
- being a managed bot automatically enables it
- being an admin automatically enables it
- /start enables it

==================================================
9. DO NOT INVENT AN API FOR BOT-TO-BOT MODE
==================================================

Before implementation, inspect current official Telegram APIs.

If Telegram exposes a documented supported API for a manager bot to change Bot-to-Bot Communication Mode on a managed bot:

→ use it safely.

If no supported API exists:

→ do NOT fake one
→ do NOT use unofficial automation against @BotFather
→ do NOT attempt UI scraping/account automation

Instead use guided user setup.

Current expected implementation should assume user confirmation through @BotFather unless official API inspection proves otherwise.

==================================================
10. BOTFATHER GUIDED SETUP
==================================================

When the subscriber enables:

"Allow AI Moderators to acknowledge each other"

Innvil should guide them through the required Telegram configuration.

Conceptually UI:

AI Moderator Interaction
[ Enable ]

Telegram setup required:

✓ Bot is deployed
✓ Bot has required group admin rights
○ Bot-to-Bot Communication Mode
○ Group Privacy Mode

[Open setup instructions]

Instructions should tell user how to open their OWN managed bot in @BotFather and enable:

Bot-to-Bot Communication Mode

and disable:

Group Privacy Mode

where required for unsolicited ordinary bot-message delivery.

Do not expose Innvil Manager Bot credentials or ask for bot tokens.

==================================================
11. GROUP PRIVACY MODE
==================================================

For Innvil's intended bot-to-bot acknowledgement behavior, configure receiving moderators according to Telegram's current requirements.

Target supported configuration:

- Bot-to-Bot Communication Mode enabled
- bot is admin of the Telegram group
- Group Privacy Mode disabled

Telegram documentation states that a Bot-to-Bot-enabled bot may receive ordinary messages from other bots without command mention/direct reply when the receiver is an admin and Group Privacy Mode is disabled.

Treat these as separate Telegram-side requirements.

==================================================
12. PRIVACY MODE CHANGE MAY REQUIRE RE-ADD
==================================================

Telegram documentation notes that changing Group Privacy Mode may require the bot to be removed/re-added to the group for the change to take effect.

Account for this in the setup UX.

Do not tell the customer setup is complete merely because they flipped the BotFather setting.

If needed:

1. change privacy setting
2. remove/re-add or re-run the Innvil add-to-community flow
3. verify delivery

Follow current Telegram documented behavior.

==================================================
13. CONFIGURATION VERIFICATION
==================================================

Innvil should verify as much as Telegram exposes.

After deployment, check:

- correct Telegram chat
- bot membership
- admin status
- actual admin rights
- webhook health
- managed-bot integration
- deployment ACTIVE

For Bot-to-Bot Communication Mode / Privacy Mode:

if Telegram does not expose reliable flag introspection through Innvil's current API,

do not fabricate a "verified" state.

Use statuses such as:

NOT_TESTED
READY_FOR_TEST
VERIFIED_BY_DELIVERY
FAILED

==================================================
14. DELIVERY-BASED BOT-TO-BOT VERIFICATION
==================================================

A strong verification method is an actual controlled delivery test.

Once two Innvil moderators exist in the same community:

Bot A
→ sends a controlled test message

Bot B webhook should receive the message.

Then verify:

sender.is_bot = true
sender numeric bot ID belongs to active Innvil moderator deployment in THIS community

→ classify INNVIL_MODERATOR

If received successfully:

bot-to-bot delivery can be marked verified for that deployment/community combination.

Do NOT trigger social acknowledgement loops during the verification test.

==================================================
15. NO USER-FACING FALSE POSITIVES
==================================================

Do not show:

"Bot-to-Bot enabled ✓"

just because the user clicked "I've done it."

Prefer:

"Telegram setup saved — testing..."

then:

"Bot-to-Bot communication verified"

only after actual delivery succeeds.

If verification fails, show useful troubleshooting guidance.

==================================================
16. ACKNOWLEDGEMENT FEATURE SHOULD DEGRADE SAFELY
==================================================

If bot-to-bot communication is not configured:

Natural Chatter
Moderation
Project Knowledge answers
Community Knowledge
Auto-Posting

must continue to work normally.

Only moderator-to-moderator acknowledgement should remain unavailable/disabled.

Do not block the whole deployment.

==================================================
17. OPTIONAL ACKNOWLEDGEMENT TOGGLE
==================================================

Keep the existing optional feature semantics.

Conceptually:

AI Moderator Interaction

[ ] Allow moderators to acknowledge each other

When OFF:
→ no social bot acknowledgements

When ON but Telegram setup incomplete:
→ show setup required
→ do not execute bot acknowledgements

When ON and delivery verified:
→ Coordinator may use bounded bot-ack behavior

==================================================
18. LOOP PROTECTION REMAINS MANDATORY
==================================================

Even after Telegram delivery works:

MAX_BOT_INTERACTION_DEPTH = 1

Origin metadata:

HUMAN
PROACTIVE
BOT_ACK
AUTO_POST

A normal human/proactive/auto-post event may potentially receive one moderator acknowledgement where policy allows.

A BOT_ACK must never trigger another BOT_ACK.

Hard logic must enforce this.

Do not rely on prompt text alone.

==================================================
19. AUTO-POSTS AND BOT ACKS
==================================================

AI Moderator Auto-Posting is performed by the assigned active moderator.

If bot acknowledgement is enabled and verified:

another Innvil moderator MAY occasionally acknowledge an auto-post.

But:

- maximum one acknowledgement
- Coordinator chooses zero or one moderator
- default should favor silence
- reaction is preferred when sufficient
- BOT_ACK never causes another acknowledgment

Do not create acknowledgement chains.

==================================================
20. ADMIN RIGHTS SHOULD BE RECHECKED
==================================================

Telegram group admins can modify a bot's rights later.

Therefore before executing privileged moderation actions, use current/recently verified permissions according to existing architecture.

At minimum, surface degraded capability if the bot no longer has required rights.

Example:

Delete Messages permission removed

→ moderation delete cannot execute
→ safe failure/log
→ Innvil UI may show "Telegram permissions need attention"

==================================================
21. COMMUNITY KNOWLEDGE AUTO-LINK STILL APPLIES
==================================================

Telegram setup does not change the Community Knowledge model.

Once:

ModeratorDeployment
→ ACTIVE
→ linked to Community 1

the moderator automatically receives Community 1 Knowledge through:

ModeratorDeployment
→ Community
→ CommunityKnowledge

No separate Telegram/BotFather knowledge configuration exists.

==================================================
22. ACTIVE SLOT ACCOUNTING
==================================================

Adding/deploying the bot to a community follows the Active Mod Slot model.

One ACTIVE ModeratorDeployment:
→ one Active Mod Slot

Same Mika in Community 1 and Community 2:
→ two active slots

Telegram admin setup does not create a second slot by itself.

==================================================
23. ONBOARDING UX
==================================================

Preferred flow:

Innvil:
"Deploy Mika"

        ↓

"Add Mika to Telegram"

        ↓

Telegram opens add-to-group/admin dialog
with suggested minimal permissions

        ↓

User chooses Community/group
and confirms

        ↓

Innvil verifies bot membership/admin permissions

        ↓

Core AI Moderator:
READY

If bot acknowledgements are enabled:

        ↓

Innvil:
"One Telegram setting remains"

        ↓

Guide user to:
@BotFather
→ owned managed bot
→ Bot Settings
→ Bot-to-Bot Communication Mode ON
→ Group Privacy Mode OFF

        ↓

If required, re-add bot

        ↓

Innvil runs delivery verification

        ↓

Bot-to-Bot:
VERIFIED

==================================================
24. DO NOT FORCE BOT-TO-BOT SETUP
==================================================

Bot-to-bot is optional.

A subscriber who only wants:

- one moderator
- moderation
- Q&A
- auto-posting
- natural chatter

should not be forced through bot-to-bot configuration.

Only surface it prominently when:

- acknowledgement feature is enabled
or
- multiple moderators are deployed and user chooses interaction between them.

==================================================
25. /START RESPONSE
==================================================

When a user opens the managed AI Mod privately and sends /start:

the bot may provide a short Innvil-specific setup/status response.

Example conceptually:

"Hey — I'm Mika, your Innvil AI Moderator.

My community setup is managed from Innvil.

Use Innvil to deploy me to a community or update my configuration."

If the bot can securely correlate the Telegram owner to an Innvil account/onboarding session, it may include relevant setup state.

Do not expose tenant data merely because an arbitrary Telegram user sends /start.

==================================================
26. /START IN GROUP
==================================================

If a startgroup parameter results in Telegram starting the bot in the group:

handle it idempotently.

Do not treat /start as ordinary Natural Chatter.

Use it as a setup/system event.

Do not consume reactiveResponseDailyLimit.

==================================================
27. SECURITY
==================================================

Do not let arbitrary users deploy/configure the moderator merely by sending:

/start
/startgroup

Validate:

- Innvil tenant/account ownership
- Telegram owner/setup correlation where available
- community/deployment authorization
- signed/opaque setup parameter

Do not trust Telegram username alone.

==================================================
28. REQUIRED TESTS
==================================================

TEST 1

User clicks Innvil "Add Mika to Telegram."

Expected:
official Telegram add-to-group flow opens with requested admin rights.

TEST 2

User removes one required right before confirming.

Expected:
Innvil detects missing capability and reports degraded setup.

TEST 3

User grants required moderation rights.

Expected:
deployment core moderation readiness succeeds.

TEST 4

Bot-to-Bot toggle enabled in Innvil but Telegram mode not configured.

Expected:
bot acknowledgements remain unavailable.
Other moderator capabilities work.

TEST 5

Bot-to-Bot configured correctly for Test/Kwan.

Kwan sends ordinary group message.

Expected:
Test webhook receives it.

TEST 6

Sender numeric Telegram ID matches active Innvil deployment in same Community.

Expected:
INNVIL_MODERATOR.

TEST 7

Known Innvil bot exists in another tenant/community but is not active here.

Expected:
EXTERNAL_BOT.

TEST 8

BOT_ACK received.

Expected:
no second acknowledgement.

TEST 9

/start in private from unrelated Telegram user.

Expected:
safe generic response.
No tenant information disclosure.

TEST 10

valid signed deployment startgroup flow.

Expected:
correct Innvil setup session is resolved.

TEST 11

privacy-mode setting changed but effective delivery still fails.

Expected:
do NOT show verified.
Keep READY_FOR_TEST/FAILED status.

TEST 12

admin rights later removed.

Expected:
privileged action fails safely and setup health can surface missing permissions.

==================================================
29. IMPLEMENTATION PROCESS
==================================================

Before editing:

1. inspect current Telegram deployment/add-to-group UX
2. inspect Telegram deep-link helpers
3. inspect /start command handling
4. inspect ModeratorDeployment creation/activation
5. inspect admin-right verification
6. inspect current bot-ack feature flag/config
7. inspect CommunityEvent classification
8. inspect loop-prevention metadata
9. inspect Managed Bot provisioning flow
10. check CURRENT official Telegram documentation for:
   - group bot links
   - suggested admin rights
   - Bot-to-Bot Communication Mode
   - Group Privacy Mode
   - managed-bot APIs

Do not implement unsupported Telegram assumptions.

==================================================
30. FINAL PRODUCT INVARIANT
==================================================

Innvil should automate Telegram setup wherever Telegram officially allows it.

Admin rights:
→ Innvil can REQUEST/SUGGEST them through the official Telegram group-add deep link.
→ User confirms them.

Bot-to-Bot Communication Mode:
→ configure automatically ONLY if Telegram exposes an official supported API for Innvil's architecture.
→ otherwise guide the bot owner through @BotFather.

Group Privacy Mode:
→ same rule: do not claim automatic control without documented API support.

Then verify actual behavior rather than relying solely on setup checkboxes.

The user experience should feel:

"Deploy my AI Moderator"

not:

"Go manually configure ten unrelated Telegram settings."

But never bypass Telegram's required user authorization.
