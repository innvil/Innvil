# Quiet moderation for ordinary spam

## Policy

This schedule runs only after existing classification confirms ordinary spam
and deletion succeeds. It does not make allowed messages violations. Admin
exemption, relevant project links, Promotion-topic allowances, uncertainty
handling, and the separate severe-threat/flood/negative-statement paths remain
in place.

| Individual incident | Action | Public notice |
| --- | --- | --- |
| 1 | Delete | Short room reminder, without a mention, if budget allows |
| 2 | Delete and mute 10 minutes | Silent |
| 3 | Delete and mute 30 minutes | Brief firmer notice; mention only if target unclear |
| 4 | Delete and mute 60 minutes | Targeted final warning: another violation means removal |
| 5+ | Delete and kick, if a final warning was delivered before this message | Normally silent |

Without a confirmed prior final-warning delivery, stage 5 holds removal and
uses a 60-minute mute instead. It attempts the final notice within the public
budget and privately flags the held removal for admin review. Failed Telegram
actions are not recorded as successful.

## Shared noise and concurrency controls

- Similar-spam first reminders share a topic/family cooldown across all users
  and watchers: 30 minutes by default, or 60 in community settings.
- All ordinary public notices, including stages 3 and 4, share a community-wide
  maximum of three per ten minutes.
- Successful delivery starts the cooldown. A confirmed failed send releases its
  reservation. An unfinished send with an unknown outcome conservatively counts
  against the relevant window, even after its 60-second send lease expires.
- Silent deletions do not restart the reminder window.
- Strike counts belong to each user within the community. Duplicate message IDs
  do not escalate again; ordinary violations within a 30-second incident window
  are deleted without advancing the ladder. Confirmed flood handling is separate.
- A database transaction lock serializes claims across watchers. Before sending,
  the runtime checks that the reservation has not expired or been superseded.
- After 30 days without a recorded violation, the user's cycle resets. Delayed
  receipts from an older cycle cannot restore its warning or mute history.

## Wording and accounting

Persona-generated notices are short, avoid insults and placeholders, and cannot
claim a prior mute unless a successful mute receipt exists. The final notice
must explicitly state both final-warning status and removal on another offense.
A bounded wording wait uses a validated fallback when generation fails or is
too slow. A quiet decision skips wording generation entirely.

Violation counts, actual public warning deliveries, successful restrictions,
and the final-warning receipt are separate. The activity log records silent
outcomes; meaningful consequences and failures also go to private Watcher Ops.
Legacy violation counts seed a new user's ledger once, capped at four, but do
not fabricate earlier public notices, mutes, or a delivered final warning.

## Deployment and verification

Migration `supabase/migrations/0132_quiet_moderation.sql` supplies the shared
ledger, service-role-only functions, and the owner-controlled 30/60-minute
setting. Verify availability before deploying this application revision; do not
infer migration status from the presence of a local SQL file. Re-running the
current migration is supported. No new provider credentials are required.

Regression coverage includes runtime action ordering, mentions and silence,
failed sends/mutes, truthful private reports, final-warning safeguards, and
settings ownership. The isolated PostgreSQL fixture runs the actual migration,
including concurrency, idempotency, cooldown/cap, reset and permission checks:

```powershell
# PGLITE_MODULE must point to an installed @electric-sql/pglite module.
node scripts/test-quiet-moderation-migration.mjs
node node_modules/typescript/bin/tsc --noEmit
node --conditions=react-server --import tsx --test "src/**/*.test.ts"
npm run build
```

These checks do not send messages into a live Telegram community or establish
real-model classification accuracy. Database and Telegram calls are not a single
transaction: an interrupted worker can leave an unknown outcome for private
review; this implementation does not promise exactly-once external delivery.
