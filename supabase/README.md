# Supabase — Veyra

Phase 3 database foundation. Migrations live in `migrations/` and run in filename
order.

| File | What it does |
|------|--------------|
| `0001_init.sql` | Extensions (pgcrypto), enums, all tables, indexes, `updated_at` triggers, `handle_new_user` trigger, `apply_balance_change()` ledger function, provider key `set/get_provider_key()` functions |
| `0002_rls.sql` | Enables RLS on every table, `is_super_admin()` / `is_panel_member()` / `owns_customer()` helpers, per-table policies, provider `api_key_enc` column revoke, service-role-only grants |

## Applying the migrations (fresh project)

**Option A — SQL editor (quickest):** open each file, paste into the Supabase
Dashboard → SQL Editor, run `0001` then `0002`.

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Environment

Copy `.env.local.example` → `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from project settings
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only; never ship to client)
- `PROVIDER_KEY_SECRET` — random string; the pgcrypto secret for provider API keys
- `CRON_SECRET` — random string; guards the order-status cron route

Then install the new dependency and run:

```bash
npm install       # picks up @supabase/ssr
npm run dev
```

## Getting a login (dev)

Supabase Auth accounts must exist in Supabase — you can't put a login in
`.env.local`. Pick whichever is easiest:

1. **Seed script (matches the `.env.local` workflow):** set `SEED_ADMIN_EMAIL`,
   `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_ROLE` in `.env.local`, then:
   ```bash
   npm run seed:admin
   ```
   Creates a confirmed user (no email step) + sets the profile role. Re-runnable.
2. **Dashboard:** Authentication → Users → Add user → check **Auto Confirm User**.
3. **Normal signup:** use the app's Login/Signup screen. If you get stuck on
   "confirm your email", turn off Authentication → Sign In / Providers →
   **Confirm email** for local dev.

## Security notes

- **Provider API keys** are stored encrypted (`providers.api_key_enc`, pgcrypto).
  The column is revoked from `anon`/`authenticated`; keys are only ever decrypted
  server-side via `get_provider_key(provider_id, PROVIDER_KEY_SECRET)` using the
  service-role client (`src/lib/supabase/admin.ts`).
- **Balances** move only through `apply_balance_change()` (atomic, ledger-backed).
  Customers cannot insert `balance_transactions` directly.
- All provider HTTP calls happen in server routes (`app/api/**`) — added in Phase 4.
