# Superadmin Watch users

The **Watch users** tab (also linked from Overview) lists known Watch accounts,
newest first, with search, 7/30-day filters, pagination, access state, email and
Telegram verification, and saved watcher counts. Forge panels remain separate.

## Database prerequisite

Apply `supabase/migrations/0130_superadmin_watch_users.sql` before deploying the
directory. The UI explicitly reports a missing migration rather than displaying
misleading zero counts. Only service_role can execute the reporting function;
both the server action and function check the authenticated actor's superadmin
role. Email addresses are never exposed through public/authenticated RPC access.

Watch signup origin is captured by the server signup action using the exact
trusted Watch hostname. This metadata is analytics only, not authorization, and
like other user metadata can be edited by the account owner. Existing users are
included from Watch entitlements, trials, Telegram links, preferences or saved
watchers (including older panel-owned watchers). There is no fabricated backfill
of historical signup origin. Accounts with no such evidence cannot be classified
retroactively. First Watch date and original Innvil signup date are separate.

Access labels and active-subscription counts describe direct Watch entitlements
and trials, not legacy Forge-panel add-on billing. A legacy panel user's absence
of a direct subscription is not presented as proof they have no watcher access.
Summary counts cover all known Watch accounts; filters affect the directory's
matching count and rows. Refresh is manual. Counts are not Telegram community
member counts, and this feature does not add notifications.

## Verification

- TypeScript and 2,462 unit/runtime tests passed.
- Production build passed (see execution record).
- `scripts/test-watch-users-migration.mjs` executes the real migration against
  isolated PGlite PostgreSQL with 32 synthetic accounts. It checks permission
  denial, service-role execution, old panel ownership, evidence deduplication,
  pagination, literal search, dates and access counts. It never connects to
  production. Set PGLITE_MODULE to an external PGlite dist/index.js to rerun.
- Production database application and authenticated browser acceptance remain
  separate checks; no live users were created for testing.
