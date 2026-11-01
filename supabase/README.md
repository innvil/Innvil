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
| `0022_owner_business_profile.sql` | `owner_business_profiles` (per-owner receipt business details: legal name, address, registrant, business/reg no., tax id, email, phone) + owner RLS |
| `0023_provider_topups.sql` | `provider_topups` — auto-recorded provider balance INCREASES (delta detected in `fetchProviderBalance`) for the Provider-balances top-up tracker; owner RLS |
| `0024_provider_topup_refunds.sql` | refund-aware tracking: `provider_topups.kind`/`needs_review` + `providers.pending_refund_credit` + `bump_provider_refund_credit()` — nets out known provider-side refunds so they aren't logged as top-ups |

> Numbers `0006`/`0007` were intentionally skipped — the sequence has gaps, that's fine.
> Migrations run in **filename order**; always number a new one after the current highest.

## Applying the migrations (fresh project)

**Option A — SQL editor (quickest):** open each file, paste into the Supabase
Dashboard → SQL Editor, and run them in **filename order** (`0001` → `0024`).

**Option B — Supabase CLI:**

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Environment

Copy `.env.local.example` to `.env.local` and configure the required Supabase,
application, encryption, and cron environment variables.

Production credentials are never committed to the repository.

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

- Provider API credentials are encrypted at rest and are only accessed server-side.
- Client roles cannot directly access sensitive provider credentials.
- Balance changes are processed through an atomic ledger-backed workflow.
- External provider requests are handled server-side.
