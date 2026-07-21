# Supabase — Innvil

Phase 3 database foundation. Migrations live in `migrations/` and run in filename
order.

| File | What it does |
|------|--------------|
| `0001_init.sql` | Extensions (pgcrypto), enums, all tables, indexes, `updated_at` triggers, `handle_new_user` trigger, `apply_balance_change()` ledger function, provider key `set/get_provider_key()` functions |
| `0002_rls.sql` | Enables RLS on every table, `is_super_admin()` / `is_panel_member()` / `owns_customer()` helpers, per-table policies, provider `api_key_enc` column revoke, service-role-only grants |
| `0003_category_hierarchy.sql` | Adds `provider_categories.parent_id` for the 2-level platform → type category tree |
| `0004_service_local_id.sql` | Adds `services.local_id` (per-panel service numbers starting at 1) |
| `0005_payment_gateways.sql` | `panel_payment_gateways` table + `set/get_gateway_key()` (pgcrypto) + RLS — per-panel bring-your-own gateway |
| `0008_platform_payment_gateways.sql` | `platform_payment_gateways` (super-admin gateways owners pay Innvil with) + `set/get_platform_gateway_key()`, super-admin RLS |
| `0009_support_tickets.sql` | `support_tickets` + `support_ticket_messages` + RLS |
| `0010_order_local_id.sql` | Adds `orders.local_id` (per-panel sequential order numbers) |
| `0011_order_status_duplicate.sql` | Adds the `duplicate` value to the `order_status` enum |
| `0012_order_duplicate_guards.sql` | `normalize_order_link()` + DB-level duplicate-order prevention (same customer + panel + normalized link + service/category) |
| `0013_storefront_snapshot_cache.sql` | `storefront_customer_snapshots` — server-backed customer-dashboard hydrate cache (avoids cookie-timing races) |
| `0014_topup_discounts.sql` | `payments.bonus_amount` + `platform_topup_discount_defaults` (super-admin per-category top-up promo tiers) |
| `0015_supabase_order_sync_cron.sql` | `pg_cron` + `pg_net`, `trigger_order_sync()`, schedules the order-status sync every 10 min |
| `0016_platform_deposits.sql` | `platform_deposits` (owner → Innvil top-ups) + `credit_panel_innvil_balance()` (atomic funding of `panels.settings.innvil_balance`) |
| `0017_commission_settlement.sql` | `orders.commission_amount` + `settle_order_commission()` — draws Innvil's 5% commission off `innvil_balance` per completed order (idempotent; the sync engine sweeps completed+unsettled orders) |
| `0018_platform_settings.sql` | `platform_settings` key/value store (super-admin RLS) — landing walkthrough-video URL + owner-support destination email |
| `0019_platform_support.sql` | `platform_support_messages` (owner → Innvil support) + RLS — owners send; super admin reads/resolves in /superadmin, emailed to `platform_settings.support_email` or the super-admin account email |
| `0020_commission_brackets.sql` | `orders.commission_settled_at` + rewritten `settle_order_commission()` — per-panel `settings.commission_rate` (volume discount to 1%) + a **$100 per-panel per-day** commission cap |
| `0021_commission_reversal.sql` | `reverse_order_commission()` — refunding a completed order credits its (proportional) commission back to `innvil_balance` + reduces `orders.commission_amount` |

> Numbers `0006`/`0007` were intentionally skipped — the sequence has gaps, that's fine.
> Migrations run in **filename order**; always number a new one after the current highest.

## Applying the migrations (fresh project)

**Option A — SQL editor (quickest):** open each file, paste into the Supabase
Dashboard → SQL Editor, and run them in **filename order** (`0001` → `0021`).

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

## Supabase-hosted cron for order sync

Automatic order-status syncing is driven by Supabase, not `vercel.json`.

1. Store the deployed app URL and cron secret in Supabase Vault:

```sql
do $$
declare
  secret_id uuid;
begin
  select id into secret_id
  from vault.decrypted_secrets
  where name = 'app_url'
  order by created_at desc
  limit 1;

  if secret_id is null then
    perform vault.create_secret('https://your-app-url', 'app_url');
  else
    perform vault.update_secret(secret_id, 'https://your-app-url', 'app_url', null);
  end if;
end
$$;

do $$
declare
  secret_id uuid;
begin
  select id into secret_id
  from vault.decrypted_secrets
  where name = 'cron_secret'
  order by created_at desc
  limit 1;

  if secret_id is null then
    perform vault.create_secret('your-cron-secret', 'cron_secret');
  else
    perform vault.update_secret(secret_id, 'your-cron-secret', 'cron_secret', null);
  end if;
end
$$;
```

2. Make sure `your-cron-secret` matches the app's `CRON_SECRET` env var.

3. Apply migrations through `0015_supabase_order_sync_cron.sql`.

That migration enables `pg_cron` + `pg_net`, creates `public.trigger_order_sync()`,
and schedules `innvil-order-sync-every-10-min` to GET:

`<app_url>/api/cron/sync-orders?secret=...`

Useful checks:

```sql
select jobid, jobname, schedule, command
from cron.job
where jobname = 'innvil-order-sync-every-10-min';

select *
from net._http_response
order by created desc
limit 20;
```
