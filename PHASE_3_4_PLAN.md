# Innvil — Phase 3 + 4 Implementation Plan

> Plan only — nothing here is built yet. This is the sequence for turning the
> current mock-data preview into a real, SocPanel-style operational admin
> dashboard, on top of the EXISTING theme, routes, components, and naming.
> Reviewed against the 10-module admin brief (2026-07-07).

---

## 0. Guiding constraints (from the brief — do not violate)

- Reuse existing theme, layout, `src/components/panels/admin/` tabs, App Router,
  naming, and the mock-data shapes in `src/data/constants.ts` (become real rows).
- No new UI library. No renaming existing routes/tables unless necessary.
- **All provider API calls are server-side** (Next.js Route Handlers / edge
  functions). Provider `api_key` is NEVER sent to or stored in the frontend.
- Provider logic isolated + reusable in `src/lib/providers/`.
- Admin-only access checks, clear error handling, loading states everywhere.
- Multi-tenant: every operational row is scoped to a `panel_id`, enforced by RLS.

---

## 1. Architecture decisions

1. **Multi-tenancy.** Every operational table carries `panel_id`. RLS scopes rows
   to the panel(s) a user owns/staffs. Super Admin uses the service-role client to
   bypass. Customers see only their own orders/tickets/balance.
2. **Server-side provider calls.** New Route Handlers under `app/api/`. The
   provider `api_key` column is readable only by the service-role client; RLS/GRANTs
   revoke it from `authenticated`. The browser never receives keys or raw provider
   URLs with keys.
3. **Order forwarding + status sync.**
   - Create: server inserts `orders` row (`pending`) → calls provider `add` →
     stores `provider_order_id` + payload/response, moves to `processing`.
   - Sync: a scheduled route polls provider `status` for active orders, updates
     `status` + appends `order_status_history`, handles `partial` → partial refund.
4. **Money is ledger-first.** Balances change ONLY via a `balance_transactions`
   row, inside a Postgres function/transaction (atomic). No bare balance mutation.
   Store money as `numeric(12,4)`.
5. **Provider API shape.** Assume the common "SMM Panel API v2" contract
   (`POST api/v2` with `key`, `action=services|add|status|refill|cancel|balance`).
   One generic client; per-provider quirks handled with small adapters if needed.

---

## 2. Data model (Phase 3 schema — `supabase/migrations/`)

| Table | Key columns | Notes |
|-------|-------------|-------|
| `profiles` | id→auth.users, role (`super_admin`/`panel_owner`/`staff`/`customer`), display_name | role source of truth |
| `panels` | id, owner_id, name, subdomain, custom_domain, status, theme, settings jsonb | existing preview shape |
| `panel_members` | panel_id, user_id, role, permissions jsonb | §10 staff/manager roles |
| `customer_accounts` | panel_id, user_id, status (`active`/`banned`/`restricted`), balance, api_key_hash | panel-scoped end users |
| `providers` | panel_id, name, api_url, **api_key (encrypted, service-role only)**, status, balance, currency, last_balance_sync, notes | §1 |
| `provider_categories` | panel_id, provider_id, name | §2 auto-create |
| `services` | panel_id, provider_id, provider_service_id, category_id, name, type, provider_rate, markup_type (`percent`/`multiplier`/`fixed`), markup_value, sell_rate, min, max, description, platform, status, sort_order, last_synced_at | §2/§3 |
| `orders` | panel_id, customer_id, service_id, provider_id, link, quantity, charge, provider_cost, profit, provider_order_id, status (enum), start_count, remains, provider_payload jsonb, provider_response jsonb | §4/§5 |
| `order_status_history` | order_id, status, note, created_at | §5 status history |
| `balance_transactions` | panel_id, customer_id, amount (signed), type (`deposit`/`order`/`refund`/`manual_adjust`), reason, admin_id, balance_after, ref_order_id | §6 ledger |
| `payments` | panel_id, customer_id, method, amount, currency, status (`pending`/`approved`/`rejected`/`completed`), gateway, gateway_ref, approved_by | §7 |
| `tickets` | panel_id, customer_id, subject, status (`open`/`answered`/`closed`) | §8 |
| `ticket_messages` | ticket_id, sender_id, is_staff, body | §8 |
| `faq` | panel_id, question, answer, category, sort_order, published | §8 |
| `audit_logs` | panel_id, actor_id, action, meta jsonb | existing concept |

**Order status enum:** `pending, processing, in_progress, partial, completed, canceled, failed, refunded`.

**RLS highlights:** panel owner/staff → rows where `panel_id` ∈ their panels;
customers → own rows; `providers.api_key` never selectable by `authenticated`
(column GRANT revoked; only service-role reads it in `app/api/**`).

---

## 3. File / folder layout (additions only — nothing renamed)

```
src/lib/
  supabase/client.ts     # browser (anon) client
  supabase/server.ts     # server client (cookies) for RSC/route handlers
  supabase/admin.ts      # service-role client (server-only; reads provider keys)
  providers/types.ts     # ProviderService, AddOrderResult, StatusResult, ...
  providers/client.ts    # generic SMM v2 client: services/add/status/refill/cancel/balance
  providers/index.ts     # getProviderClient(provider) factory
  money.ts               # markup math + numeric helpers
  crypto.ts              # api_key encrypt/decrypt (or pgcrypto in SQL)
app/api/
  providers/[id]/test/route.ts       # test connection
  providers/[id]/balance/route.ts    # fetch balance
  services/import/route.ts           # list + import provider services
  services/sync/route.ts             # sync selected services
  orders/route.ts                    # create order (forward to provider)
  orders/[id]/retry|cancel|refill/route.ts
  cron/sync-orders/route.ts          # polled by Vercel Cron
supabase/migrations/*.sql            # schema + RLS + balance function + enum
src/types/index.ts                   # + Provider, Service, Order, CustomerAccount,
                                     #   BalanceTx, Payment, Ticket, Faq
src/components/panels/admin/         # EXISTING tabs wired to real data +
                                     #   new ImportServices view for §2
```

---

## 4. Build sequence (step by step)

### Phase 3 — foundation (must come first)
1. Supabase clients (`client/server/admin`) + env wiring + auth middleware.
2. Migrations: all tables + enum + RLS + `apply_balance_change()` SQL function + audit triggers.
3. Auth: panel-owner + customer login/register, role gating, protected routes
   (replaces the preview auth screens; customer landing already exists).
4. TS types in `src/types` + a thin data-access layer (`src/lib/queries/`);
   migrate admin tabs off mock constants incrementally.

### Phase 4 — modules (each: migration if needed → server route/lib → wire existing tab → access check → loading/error states)
`§1 Providers → §2 Import & Sync → §3 Services → §4 Order automation (+cron) →
§5 Orders page → §6 Users & balance → §7 Payments (manual approval) →
§8 Support & FAQ → §9 Statistics → §10 Settings`

Rationale: §1 unlocks §2; §2 populates §3; §3 enables §4 (orders reference
services); §4 produces the data §5/§9 display; §6/§7 are balance-side; §8/§10 are
independent and can slot in anytime after auth.

---

## 5. Decisions needed from you before Phase 3 build

1. **Supabase project** — do you already have one (share URL + keys via
   `.env.local`), or should I write migrations for a fresh project you then create?
2. **Provider key storage** — pgcrypto column encryption (recommended) vs.
   app-level encryption with an env secret?
3. **Cron** — Vercel Cron hitting `app/api/cron/sync-orders` (simplest on Vercel)
   vs. Supabase `pg_cron` + edge function?
4. **Customers** — are panel end-users full Supabase auth users, or lightweight
   panel-owned rows? (Recommended: auth users + `customer_accounts` scoping.)
5. **Provider API contract** — confirm your providers use the standard
   `api/v2?action=...&key=...` format so one generic client covers them.

---

*Created 2026-07-07 — plan for review; no code written yet.*
