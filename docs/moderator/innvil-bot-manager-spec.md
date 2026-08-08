# innvil_bot_manager — Innvil's Official Product Bot (Proactive Marketing + Reactive Support)

> Status: **NOTED — not implemented yet.** Explicit instruction from the user:
> "Take note only, will implement this once the ai mods are fully intact." Do not
> build from memory/paraphrase — implement from this file. See the pointer in
> `CLAUDE.md` for where this sits in the roadmap.
>
> **⚠️ Naming collision to resolve before implementation:** this spec's
> `innvil_bot_manager` is a **customer/community-facing** bot (posts marketing
> broadcasts into groups/channels, answers product questions reactively). That is
> a fundamentally different role from the existing **Manager Bot**
> (`TELEGRAM_MANAGER_BOT_TOKEN`, see `src/lib/moderator/manager.ts`), which is
> **strictly control-plane/provisioning only** — its whole-codebase invariant,
> stated repeatedly elsewhere (`manager.ts` header comment, Phase 4.N's "never
> publishes customer content using `TELEGRAM_MANAGER_BOT_TOKEN`"), is that it
> NEVER acts as a community-facing bot. `innvil_bot_manager` as described here
> **must be its own separate bot/credential**, provisioned and run like any other
> managed bot (or as a distinct first-party integration) — it must not reuse or
> be confused with the existing Manager Bot token. Pick a non-colliding internal
> name when implementing (e.g. `INNVIL_OFFICIAL_BOT`) to avoid this ambiguity in
> code, even if the Telegram-facing bot is still branded `@innvil_bot_manager` or
> similar.

## Concept

Make `innvil_bot_manager` a special Innvil-owned Telegram bot with two clearly
separated behaviors:

1. Proactive marketing / announcement mode
2. Reactive Innvil support mode

That keeps it useful without letting it drift into answering random questions.

## 1. Proactive marketing messages

Store every Telegram destination where `innvil_bot_manager` is authorized to post:

```ts
BotManagerChat {
  chatId: string
  type: "PRIVATE" | "GROUP" | "SUPERGROUP" | "CHANNEL"
  title?: string

  marketingEnabled: boolean
  supportEnabled: boolean

  joinedAt: Date
  lastMarketingMessageAt?: Date
}
```

Then give the backend a campaign system:

```ts
MarketingCampaign {
  id: string
  message: string

  target:
    | "ALL"
    | "PRIVATE_USERS"
    | "GROUPS"
    | "CHANNELS"

  scheduledAt?: Date
  status: "DRAFT" | "SCHEDULED" | "SENDING" | "SENT"
}
```

When a campaign becomes due:

```ts
for (const chat of eligibleChats) {
  await telegram.sendMessage(chat.chatId, campaign.message)
}
```

Telegram's `sendMessage` supports sending directly to a known `chat_id`, so once
the bot is already present in a group/channel or a user has initiated contact
with it, the backend can use that stored destination for later messages.
Telegram does not let ordinary bots initiate a brand-new private conversation
with an arbitrary user who has never interacted with or added the bot.

Distinguish campaign types instead of treating every proactive message as
generic marketing:

```ts
MARKETING_BROADCAST
PRODUCT_ANNOUNCEMENT
RELEASE_UPDATE
SERVICE_NOTICE
EDUCATIONAL_TIP
```

## 2. In groups, make it an Innvil/product support bot

When `innvil_bot_manager` receives a group message, run a classifier before the
normal answer generator:

```ts
enum ManagerMessageIntent {
  INNVIL_QUESTION,
  MODERATOR_PRODUCT_QUESTION,
  OTHER_INNVIL_PRODUCT_QUESTION,
  ACCOUNT_OR_PLAN_QUESTION,
  SETUP_QUESTION,
  BUG_OR_SUPPORT_QUESTION,

  UNRELATED,
  CASUAL_CHAT,
  UNKNOWN
}
```

Then:

```ts
if (intent is InnvilRelated) {
    answer()
} else {
    SILENCE
}
```

So:

Human: "How many moderators can I create on Basic?"
`innvil_bot_manager`: "Basic supports up to 2 moderators. Standard 5, Premium 10,
and Pro support up to 20."

But:

Human: "Who won the Lakers game?"
Manager: `SILENCE`

And:

Human: "What's the weather today?"
Manager: `SILENCE`

That scope restriction should be implemented in the Coordinator/classifier, not
merely inside the LLM prompt.

## 3. Give the manager its own knowledge base

Do not let `innvil_bot_manager` use arbitrary community knowledge like
customer-created moderators do. Give it:

```
INNVIL_PRODUCT_KNOWLEDGE
├── Innvil platform
├── Moderator product
├── plans + pricing
├── moderator limits
├── setup instructions
├── Telegram integration
├── features
├── product updates
├── FAQs
├── troubleshooting
└── other official Innvil products
```

Answer pipeline:

```
Telegram message
        ↓
Is this Innvil-related?
        ↓
      YES
        ↓
Retrieve Innvil Product Knowledge
        ↓
Generate grounded answer
        ↓
Send
```

If there is no reliable answer:

"I don't have confirmed information about that yet. You can check with the
Innvil team."

Don't let it invent product behavior.

## 4. Group visibility matters

By default, Telegram bots in groups operate under Privacy Mode, meaning they
don't necessarily receive every normal group message. Bots that are admins or
have Privacy Mode disabled can receive the wider group conversation.

For the desired behavior — someone asks an Innvil question naturally in the
group, `innvil_bot_manager` notices it, `innvil_bot_manager` answers — the bot
generally needs to be configured so it actually receives those group messages
(same Bot-to-Bot Communication Mode / Group Privacy Mode considerations already
documented in `docs/moderator/telegram-bot-to-bot-onboarding-spec.md` for
customer moderators, applies here too).

Then the software itself is much stricter than Telegram:

```
Telegram gives manager all group messages
              ↓
Innvil scope classifier
              ↓
99% potentially ignored
              ↓
Only Innvil/product-related questions answered
```

That is preferable to relying on Telegram Privacy Mode as the product-topic
classifier.

## 5. Don't respond whenever someone says "Innvil"

Use a relevance score:

```ts
const classification = {
  innvilRelated: true,
  confidence: 0.94,
  needsAnswer: true,
  product: "MODERATOR",
  intent: "PLAN_LIMIT"
}
```

Possible rule:

```ts
if (
  classification.innvilRelated &&
  classification.confidence >= 0.80 &&
  classification.needsAnswer
) {
  respond()
} else {
  silence()
}
```

This prevents weird responses such as "I was using Innvil earlier lol" —
manager shouldn't necessarily answer that. But "Does Innvil Moderator work in
Telegram topics?" should trigger it.

## 6. Manager has priority over customer moderators for Innvil questions

Since `innvil_bot_manager` and several deployed customer moderator bots may be
in the same group, add ownership routing:

```
QUESTION ABOUT INNVIL / MODERATOR PRODUCT
        ↓
innvil_bot_manager gets priority
        ↓
customer-created moderators SILENCE
```

Otherwise: Human asks "How do I add another moderator?" and Mika, Kaleb, AND
`innvil_bot_manager` all answer — exactly what to avoid.

```ts
if (message.intent === INNVIL_PRODUCT_SUPPORT) {
    selectedResponder = INNVIL_BOT_MANAGER
    suppressCommunityModerators = true
}
```

## 7. Marketing posts shouldn't trigger the moderator bot chain

Especially important given the bot-ack/Community Handoff behavior already
being built (`docs/moderator/bot-ack-social-behavior-spec.md`). Introduce an
origin:

```ts
origin = INNVIL_MARKETING
```

Then:

```
INNVIL_MARKETING
→ customer moderators do NOT BOT_ACK by default
→ customer moderators do NOT COMMUNITY_HANDOFF
→ no bot social chain
```

Otherwise: `innvil_bot_manager` posts "Innvil just launched our new Moderator
dashboard 🚀" and Mika/Kaleb/Alex all pile on with "Nice!"/"Looks great!"/🔥 —
that reads as fake very quickly. The manager's marketing broadcasts should be
treated like an official system/company announcement, not another moderator
initiating casual bot chatter.

## 8. Humans can reply to a marketing message

This is where it becomes powerful. Example:

`innvil_bot_manager`: "New: Innvil Moderator now supports up to 5 moderators on
Standard, Premium and Pro."
Human: "Does Basic get 5 too?"
Manager: "Basic remains limited to 2. Standard, Premium and Pro support up to 5."

That's a new HUMAN support event, so the manager answers normally.

Another human: "Can the moderators talk to each other?"
Manager: "Yes. Innvil moderators can have short, bounded interactions, but
they'll hand the conversation back to the community rather than endlessly
talking to each other."

That's the target experience.

## 9. Campaign controls, not unrestricted auto-posting

Avoid:

```
cron every day:
    ask LLM to invent marketing message
    send automatically
```

Instead:

```
Approved campaign/content
        ↓
Scheduler
        ↓
Audience selection
        ↓
Pacing / duplication checks
        ↓
Telegram send
```

AI can still write the copy, but store an approved campaign object first:

```ts
{
  type: "PRODUCT_ANNOUNCEMENT",
  sourceKnowledgeIds: [...],
  copy: "...",
  sendAt: "...",
  targetAudience: "INNVIL_COMMUNITIES",
  approved: true
}
```

This dramatically reduces the chance the official Innvil account publishes
invented features, prices, dates, or claims. Telegram also has specific
broadcast throughput behavior (including higher-rate paid broadcasts), so
centralize outgoing campaigns through a queue rather than firing all
`sendMessage` requests directly.

## Final architecture

```
                    INNVIL_BOT_MANAGER
                           │
              ┌────────────┴─────────────┐
              │                          │
       PROACTIVE MODE              REACTIVE MODE
              │                          │
      Campaign Scheduler          Telegram Update
              │                          │
      Approved Marketing          Intent Classifier
              │                          │
      Audience Resolver          Innvil related?
              │                    │          │
      Telegram Queue             YES         NO
              │                    │          │
        sendMessage()        Product KB     SILENCE
                                   │
                              Grounded Answer
                                   │
                              sendMessage()
```

## Hard invariant

`innvil_bot_manager` is Innvil's official product voice. It may proactively
publish approved Innvil communications and answer human questions about Innvil,
Innvil Moderator, and other approved Innvil products. It must remain silent on
unrelated topics and must not become a general-purpose community moderator.

That separation means customer-created Moderator bots keep their existing
role, while `innvil_bot_manager` becomes the authoritative product/support
presence — a distinct capability from both Phase 4.N (customer Project
Knowledge / Auto-Posting, which is per-tenant/per-panel) and Phase 4.M/4.P
(customer moderator chatter/bot-ack behavior). `innvil_bot_manager` is
Innvil-owned and platform-wide, not scoped to any one panel/tenant.
