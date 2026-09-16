# Silent third-party bot cleanup

The community Settings tab has an owner-controlled toggle, **Silently remove
third-party bot messages**, off by default. Migration
`0133_external_bot_cleanup.sql` adds its persisted boolean. No existing community
is automatically opted in, and rerunning the migration preserves choices.

When enabled, new incoming third-party bot posts are deleted without AI calls,
warnings, mentions, strikes, mutes, kicks, bans, or private warning reports.
This includes bot-admin credit/advertisement messages and useful third-party bot
posts: it is an all-bot-post switch, not an ad classifier or per-bot allowlist.
Success/failure is visible in activity. No prior history is swept.

Safeguards:

- Use Telegram's bot identity, not display names or text. Human forwards of bot
  posts are still human messages and use the existing human policy.
- Never target Innvil watchers (including known paused/foreign-community
  watchers), the receiving watcher, anonymous admins, or sender-chat/channel
  identities. Failed identity lookup holds deletion, without trusting the bot
  as a teammate or exposing any tenant information.
- Only group/supergroup posts; no cleanup in private chats or Watcher Ops.
- The existing cross-watcher message claim prevents duplicate cleanup attempts.
  Known edits/retries do not retrigger deletion. An edit first observed by the
  watcher can be cleaned if it wins that same message claim.
- Require an active entitlement and enabled deployment; the existing trial
  exhausted-quota pause is respected. No AI quota is consumed by deletion.
- Missing delete rights or a failed API call never becomes a successful deletion
  or falls through to human penalties. The stored unique message claim remains.
- Removed text is replaced in conversation context with a removal marker.

## Telegram setup

Telegram normally withholds other bots' messages. Its current Bot Features
documentation describes Bot-to-Bot Communication Mode in BotFather: for ordinary
group bot posts, enable the mode on the receiving watcher and give it admin
rights or disable Group Privacy. It also needs permission to delete messages.
This application toggle does not itself change BotFather settings or Telegram
permissions and cannot act on messages Telegram does not deliver.

Official source checked 2026-09-16:
[Bot-to-Bot Communication](https://core.telegram.org/bots/features#bot-to-bot-communication).
The older FAQ's blanket statement that bots cannot see other bots is not a full
description of this newer opt-in capability.

## Verification

`external-bot-cleanup.test.ts` covers identity guards, actual delete-only request
execution with mocked Telegram, failure outcomes, disabled/duplicate/ineligible
paths, trial gating and webhook placement. Product-runtime tests verify boolean
validation, ownership, defaults and settings persistence. The isolated PostgreSQL
fixture runs the real migration using a test-only PGlite module:

```powershell
# Set PGLITE_MODULE to an installed @electric-sql/pglite module.
node scripts/test-external-bot-cleanup-migration.mjs
node --conditions=react-server --import tsx --test "src/**/*.test.ts"
npm run build
```

Verify the column exists before deploying this revision. Live Telegram delivery,
BotFather mode and delete permissions need actual operational evidence; unit
tests and a successful web deployment alone do not establish them. No test
messages should be posted to the user's live community without permission.

Local verification: all 2,497 regression tests and the isolated 0133 migration
fixture passed. No live bot posts were created or deleted during testing.
