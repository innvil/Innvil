# Innvil

**Infrastructure for launching and scaling digital service businesses.**

Innvil removes the technical and operational barriers between an idea and a
profitable business. Launching a new white-label brand should take minutes, not
weeks. Today it ships as a **no-code SMM (social-media-marketing) panel maker** —
the first application built on the platform — and is evolving into a complete
**business operating system**: automation, analytics, customer management,
payments, provider orchestration, AI-powered workflows, billing, subscriptions,
and marketing.

> **Vision:** be the default infrastructure entrepreneurs reach for when they want
> to launch a white-label digital business — the way Shopify became default for
> e-commerce and Stripe for payments. SMM is the initial market; the underlying
> architecture is modular so it can power any business built on providers, digital
> products, APIs, subscriptions, marketplaces, or service fulfillment.

---

## What it does today

- **Create a panel in minutes** — name, subdomain, theme; a white-label storefront,
  customer dashboard, and wallet, all yours to brand and price.
- **Bring your own provider** — connect any Standard SMM API v2 provider; Innvil
  pulls the full catalog, auto-categorizes it (Platform → Service type), applies
  your markup, and syncs prices/limits. Provider keys are encrypted, server-side
  only. Innvil never sells the services itself.
- **Automated order pipeline** — a customer order charges their wallet, is
  forwarded to the mapped provider, and its status is polled and reconciled
  automatically (partial/canceled orders auto-refund the unfilled portion).
- **Bring-your-own payments (per panel)** — a pluggable multi-gateway system.
  Cryptomus (crypto), Razorpay (India), and Stripe (global) are connectable today;
  more are on the catalog. Deposits auto-credit the wallet via signed webhooks —
  no manual approval.
- **Owner tooling** — real customer list with manual credit/debit, panel statuses
  (draft/live/inactive/suspended/maintenance), per-platform logos, and more.
- **5% commission only** — no monthly rent, no setup fee.

## Tech stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack), React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS + design tokens |
| Backend / DB | Supabase (PostgreSQL, Auth, RLS, pgcrypto) |
| Hosting | Vercel |
| Icons / charts | lucide-react · Recharts |

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

Create `.env.local` (see the variables below), then apply the SQL migrations in
`supabase/migrations/` (in filename order) against your Supabase project.

### Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Encrypts provider + payment-gateway API keys (pgcrypto). Required.
PROVIDER_KEY_SECRET=...

# Public origin — required for payment webhooks/return URLs (prod or a tunnel).
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Protects the order-status sync endpoint (if triggered externally).
CRON_SECRET=...

# Resend (existing outbound mail)
RESEND_API_KEY=...
RESEND_FROM="Innvil <noreply@innvil.cloud>"

# Inbound forwarding (creat@innvil.cloud -> your Gmail)
RESEND_FORWARD_TO=yourname@gmail.com
RESEND_FORWARD_FROM="Innvil Inbox <noreply@innvil.cloud>"
RESEND_INBOUND_ADDRESS=creat@innvil.cloud
RESEND_INBOUND_TOKEN=generate-a-long-random-token
```

Inbound webhook endpoint:

`POST /api/inbound/resend?token=<RESEND_INBOUND_TOKEN>`

Use this URL in Resend's inbound webhook settings for your domain.

### Rotate local secrets

You can rotate local `.env.local` secrets with:

```bash
npm run rotate:env
```

Useful options:

```bash
# rotate inbound token + cron secret
npm run rotate:env -- --recommended

# rotate inbound token + cron + provider key
npm run rotate:env -- --all
```

After rotating keys that are used in production, copy the new values into Vercel
Environment Variables as well.

> Order-status syncing is scheduled via **Supabase** (see the `supabase/migrations`).
> `vercel.json` intentionally carries no cron.

## Project structure

```
app/                     # Next.js routes (root app, /p/[subdomain] storefront,
                         #   /terms, /privacy, /api/webhooks/*, /api/cron/*)
src/
  components/            # UI: panels (owner app + admin tabs), customer storefront
  lib/
    actions/             # server actions (panels, services, orders, customers, payments)
    providers/           # Standard SMM API v2 client (server-only)
    payments/            # gateway adapters (cryptomus, razorpay, stripe) + registry
    orders/              # order-status sync engine
    supabase/            # browser/server/service-role clients + middleware
  data/ · types/         # constants, shared TS types + DB row types
supabase/migrations/     # schema, RLS, and feature migrations (run in order)
```

## Design principles

- **Platform-first.** Prefer features that strengthen the platform and compose into
  a cohesive ecosystem over one-off solutions.
- **Modular.** New capabilities (and new business verticals beyond SMM) should slot
  in without redesigning the core.
- **Secure by default.** Third-party API keys are encrypted and used only
  server-side; customers never see provider cost, markup, or profit.
- **Fast & repeat-order-optimized.** The customer experience should feel like a
  modern SaaS product, not a legacy panel.

## Status

Active development. Not yet production-launched. Payment integrations require the
owner's real gateway accounts and a public webhook URL to verify end-to-end.

---

© 2026 Innvil.
