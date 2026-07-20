# Innvil — Project Documentation

## Overview

Innvil is a **no-code white-label SMM panel builder** built with Next.js + Supabase + Vercel. Users create independent, white-label SMM panels with their own subdomain, storefront, customer dashboard, and wallet. Innvil charges a **5% commission only** on completed orders — no monthly rent, no setup fees.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16.2+ (App Router, Turbopack) |
| UI Components | React 19+ with Lucide icons |
| Charts | Recharts |
| Styling | Tailwind CSS |
| Backend/Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | Vercel |
| State Management | React hooks (useState/useContext) |

> Upgraded from Next.js 14 / React 18 on 2026-07-07 — Next 14.x stopped receiving
> security patches (Vercel's May 2026 advisory cluster only patches 15.5.18+/16.2.6+).
> See CLAUDE_PROGRESS.txt for the full upgrade log.

---

## Terminology

| Term | Definition |
|------|------------|
| **Innvil** | The platform itself — the panel builder |
| **Panel** | A white-label SMM storefront created by a user |
| **Panel Owner** | A user who creates and manages a panel |
| **Customer** | End user who registers on a panel to order SMM services |
| **Provider** | The SMM API provider a panel owner connects to (bring-your-own) |
| **Floor/Price Floor** | Minimum price enforced by the provider — panel owners cannot price below it |
| **Markup** | The percentage added above the provider's floor price |
| **Live Panel** | A customer-facing panel storefront |
| **Super Admin** | Innvil platform administrator — never visible to panel owners or customers |

---

## Coding Standards

### Component Structure
- Use functional components with React hooks
- Keep components focused and single-purpose
- Co-locate component-specific styles when possible
- Use `.jsx` for components, `.js` for utilities and data

### Naming Conventions
- Components: PascalCase (`PanelAdmin`, `StatusBadge`)
- Functions/Variables: camelCase (`handleStatusChange`, `panelStatuses`)
- Constants: SCREAMING_SNAKE_CASE for configuration objects (`PANEL_STATUSES`)
- CSS classes: lowercase with hyphens (BEM-ish via Tailwind)

### Styling
- Use Tailwind CSS utility classes
- Custom styles via `GlobalStyle` component (inline `<style>` tag)
- Design tokens defined in `src/styles/globals.css`

### State Management
- Local state: `useState` for component-level state
- Cross-component state: props drilling for simple cases
- Consider Context API or Zustand for complex shared state

---

## Architecture

```
innvil/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Root — REAL auth-driven (signed out→public/login,
│   │                      #   signed in→dashboard). Dev switcher at /?preview=1
│   ├── PreviewSwitcher.tsx# The old world-switcher harness (dev only)
│   ├── p/[subdomain]/     # REAL customer storefront (page.tsx + Storefront.tsx)
│   ├── layout.tsx         # Root layout with fonts
│   └── globals.css        # Tailwind + design tokens
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── ui/            # Base components (Card, Toggle, Pill, etc.)
│   │   ├── panels/        # Innvil app, Super Admin (index.tsx)
│   │   │   └── admin/     # Panel Owner admin: PanelAdmin shell, AdminTabs, CustomerDrawer
│   │   │                  # (Categories merged into the Services "Catalog" tab)
│   │   └── customer/      # Customer-facing experience (Phase 1)
│   │       ├── index.tsx            # CustomerPanel — status-aware entry
│   │       ├── CustomerLanding.tsx  # White-label landing (auth only)
│   │       ├── CustomerDashboard.tsx# Dashboard/Orders/Wallet/Tickets/API/Profile
│   │       ├── NewOrder.tsx         # Progressive order form + smart search
│   │       └── PlatformIcons.tsx    # Monochrome brand glyphs + platform buttons
│   ├── data/              # Mock data and constants
│   ├── types/             # Shared TS interfaces (index.ts) + DB row types (db.ts)
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utility functions
│   │   └── supabase/      # client.ts, server.ts, admin.ts, middleware.ts, constants.ts
│   │                      #   (storefront uses a separate session cookie)
│   └── styles/            # Global CSS and design tokens
├── supabase/
│   ├── migrations/        # 0001_init (schema), 0002_rls (policies),
│   │                      # 0003 (category parent_id), 0004 (services.local_id),
│   │                      # 0005 (panel_payment_gateways + gateway key RPCs)
│   └── README.md          # how to apply migrations + env
├── middleware.ts          # Supabase session refresh
├── public/                # Static assets
├── .env.local.example     # Environment variables template
├── package.json
├── tailwind.config.ts
├── next.config.js
└── CLAUDE.md
```

---

## Panel Statuses

| Status | Customer Can Browse | Customer Can Order | Description |
|--------|--------------------|--------------------|-------------|
| `draft` | No | No | Panel is being set up. Not visible to customers. |
| `live` | Yes | Yes | Fully operational. |
| `inactive` | Yes | No | Browsable, login, dashboard, history, wallet balance, deposits. No new orders. |
| `suspended` | No | No | Offline. Panel owner must contact Innvil support. |
| `maintenance` | No | No | Temporarily offline. Auto-returns to previous status. |

---

## Recent Updates

### 2026-07-20 — Fix: real platforms no longer dumped into "Other" (v0.2.61)
- Storefront guest-landing showcase (`app/p/[subdomain]/Storefront.tsx`) was bucketing services by a
  stale hardcoded 7-item `PLATFORMS`/`KNOWN` set, so any real platform beyond those 7 (LinkedIn,
  Twitch, Discord, Reddit, Pinterest, …) fell into **"Other"**. Now it buckets by the import's actual
  stored `platform` key — every real platform gets its own named tab; only truly platform-less
  services (import already tags them `other`, e.g. website traffic) go to "Other" (sorted last).
  Proper labels via a `PLATFORM_LABELS` map (owner `platformMeta` label wins, then map, then
  title-case), and hero/tab glyphs use the owner's custom logo (`platformMeta[key].icon`). The
  ordering flow (`NewOrder`) already did this correctly — this only aligns the storefront landing.

### 2026-07-20 — Richer per-panel storefront landing (v0.2.60)
- Expanded the customer-facing storefront guest landing (`app/p/[subdomain]/Storefront.tsx`) toward
  the reference SMM sites (prm4u/worldofsmm/smmcost). Three new default sections, all white-label +
  data-driven: a **live stats strip** (Services / Platforms / Starting-from lowest price / 24-7 — all
  derived from the panel's real catalog, nothing fabricated), a **"How it works"** 4-step flow
  (create account → add funds → pick a service → watch it grow), and a **"Secure payments"** trust row
  that lists only the gateways the owner actually connected (hidden when none). Flow is now
  hero → stats → services → how-it-works → why → FAQ → owner blocks → payments → CTA → footer.
- Content-only; no new deps or migration. Still pending for per-panel (agenda #3 second half):
  more Design-Shop premium templates.

### 2026-07-20 — Landing: surface delete + owner status control (v0.2.59)
- Reviewed the reference sites (prm4u, smmcost, worldofsmm, socpanel) and surfaced two just-built
  capabilities on the public landing: **How it works** step 04 reframed from "Go live" to
  **"You control the status"** (owner sets draft/live/inactive/maintenance anytime; going live is a
  given, so we lead with owner control + reversibility). Added a **"Create & delete freely"** card
  to the #platform grid (spin up test panels, delete unwanted ones cleanly — no clutter/lock-in).
- Content-only; no new deps or migration.

### 2026-07-20 — Owner status control + landing video + panel delete (v0.2.58)
- **Owner-controlled panel status** — the My Panels `StatusDropdown` now offers only the four
  owner-settable statuses (draft/live/inactive/maintenance); `suspended` is Innvil-support-only.
  `updatePanelStatus` enforces it server-side: rejects `suspended`, refuses to change an
  already-suspended panel, and blocks going `live` while the panel is Innvil-credit-suspended
  (top up instead). Inline error surfaced per card. `StatusDropdown` gained an optional
  `options` filter (defaults to all — other usages unchanged).
- **Landing walkthrough video** — super admin sets a tutorial video URL (YouTube/Vimeo/direct
  .mp4) under **/superadmin → Landing video**; the public landing renders it in a "See how
  easy it is" section (`toVideoEmbed` in `src/lib/video.ts`; hidden when unset). Stored in the
  new `platform_settings` table via `getLandingVideo`/`setLandingVideo`
  (`src/lib/actions/platform-settings.ts`). **Run migration `0018_platform_settings.sql`.**
- **Delete panel (with caution)** — each My Panels card has a delete affordance opening a
  confirm modal that requires typing the panel's subdomain; `deletePanel` re-checks ownership
  + the typed subdomain, then deletes (all `panel_id` FKs cascade). Irreversible, spelled out
  in the modal.

### 2026-07-20 — Main landing: feature parity + differentiators (v0.2.57)
- Expanded the Innvil public landing (`PublicLanding` in `src/components/panels/index.tsx`)
  for the public MVP. Two new sections: **#platform** ("Everything to run the business")
  — a 9-card grid of BUILT features (custom domains/reversible, wallets + crypto deposits,
  support tickets, earnings receipts, duplicate detection + mass cancel, provider-balance
  visibility, auto order-status sync, customer API, mobile-first) — and **#why** ("Built
  differently from a rented panel") — the socpanel differentiators: 0% rent/5%, bring-your-
  own-provider, no domain lock-in, customer-privacy boundary, business-OS, ANVIL (coming soon).
- TopNav gains Platform + Why Innvil anchors. Copy only claims shipped features. No new deps,
  no migration. (Couldn't fetch socpanel/smmcost live — classifier outage on WebFetch; built
  from the Phase 4.v.1 differentiators. Refine section order against the live sites later.)
- Still TODO for MVP: richer per-panel storefront landing + Design-Shop premium templates.

### 2026-07-20 — Commission settlement — billing loop closes (v0.2.56)
- **Innvil's 5% commission is now actually DEDUCTED** (was display-only). Per completed
  order, `settle_order_commission()` draws 5% of the charge off the panel's
  `innvil_balance` — atomic + idempotent via new `orders.commission_amount`
  (NULL = unsettled). The sync engine (`settlePanelCommission` in `src/lib/orders/sync.ts`)
  sweeps completed+unsettled orders every pass (cron + owner "Sync statuses"), so it
  catches completions from provider sync AND manual mark-completed.
- **Out-of-credit rule:** when a panel's Innvil balance hits $0 the sync auto-moves a
  `live` panel to `inactive` (browsable, no new orders — `placeOrder` already blocks
  non-live) and flags `settings.innvil_suspended`. A top-up reactivates it: the platform
  webhook (`reactivatePanelIfFunded`) and super-admin `adjustPanelBalance` clear the flag
  and restore `live` (owner's own inactive/suspended choices are never overridden).
- Shared `INNVIL_COMMISSION_RATE` in `src/lib/money.ts`; the Billing estimate now reads
  from it so display and actual deduction can't drift. **Run migration
  `0017_commission_settlement.sql`.**

### 2026-07-19 — Owner→Innvil top-up flow / P3 (v0.2.55)
- Owner **Add Funds** now really pays Innvil via the super-admin's Cryptomus/NOWPayments
  platform gateways and credits the panel's Innvil balance. `createPlatformDeposit`
  (recomputes credit = paid + promo bonus) → gateway checkout → webhook
  `/api/webhooks/platform/[gateway]` → `credit_panel_innvil_balance` (atomic).
  **Run migration `0016_platform_deposits.sql`.** Innvil balance is per-panel; the modal
  has a panel selector. (Commission DEDUCTION shipped in v0.2.56 above.)

### 2026-07-13 — Auto-credit fix + order holds + earnings + global adjust (v0.2.23)
- **NOWPayments finished deposits auto-credit again**: `verifyWebhook` now gates on the
  authoritative server-to-server `getPaymentStatus` (owner API key), HMAC best-effort.
- **Insufficient PROVIDER balance** on an order → held (pending, no refund) with an
  "On hold" indicator in both Orders views; `expireHeldOrders` auto-cancels + refunds
  24h later (inside each sync pass).
- **Earnings & receipts** is its own owner section (top-ups − API cost = profit +
  download); Billing keeps just the commission balance.
- **Customers (all panels)** rows expand → manual Credit/Debit (`adjustCustomerBalance`).

### 2026-07-12 — Custom domains (v0.2.16)
- Owners connect their own domain in the Domain tab: real connect/verify/disconnect,
  live status, and the exact DNS record to add. `proxy.ts` routes any non-app host →
  `/p/<host>`; `getPublicPanel` resolves by subdomain OR `custom_domain`. Vercel
  Domains API wired (`src/lib/vercel/domains.ts` + `actions/custom-domain.ts`) so the
  domain is added to the project + SSL issued automatically. Works without the API too
  (stores domain, shows manual Vercel step). **Env for auto-setup:** `VERCEL_API_TOKEN`,
  `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`.

### 2026-07-12 — Subdomain routing (v0.2.15)
- Panels are now reachable at `<subdomain>.innvil.cloud` (not just `/p/<sub>`).
  `proxy.ts` rewrites a panel-subdomain host → `/p/<sub>` internally and forces the
  storefront session; apex/localhost/preview hosts and `/_next`,`/api`,`/p/`,static
  paths are untouched. `updateSession` gained `{rewriteTo, storefront}`. Root domain
  via `PANEL_ROOT_DOMAIN` (`NEXT_PUBLIC_PANEL_ROOT_DOMAIN`, default innvil.cloud).
  **Deploy:** add wildcard domain `*.innvil.cloud` in Vercel + DNS `*` CNAME. Custom
  domains next.

### 2026-07-12 — Per-service import markup + earnings receipt (v0.2.13)
- **Import per-service markup**: `importServices` accepts `markupOverrides`
  (provider_service_id → {kind,value}); the import UI shows a per-selected-row markup
  input (global type, custom value) with a live sell-price preview. Blank = global.
- **Earnings receipt** (Billing → `ReceiptCard`): single-month range calendar →
  `getOwnerReceipt(from,to)` = completed top-ups − provider/API cost = profit
  (per-panel breakdown) → downloadable self-contained HTML receipt. No migration.

### 2026-07-12 — Customer support tickets (v0.2.10)
- Real, usable support tickets both sides: customers open/reply/close in the storefront
  Tickets tab (`CustomerTickets.tsx`); owners reply/close/reopen in the panel's Support
  tab (`admin/SupportInbox.tsx`). Unread badges via `customer_unread`/`owner_unread`.
- Backend: migration `0009_support_tickets.sql` (`support_tickets` +
  `support_ticket_messages`, RLS) — **run it**; `tickets.ts` (customer) +
  `admin-tickets.ts` (owner) actions.
- Email: best-effort Resend notifier (`src/lib/email/resend.ts`) on each reply —
  no-ops without `RESEND_API_KEY` (set `RESEND_API_KEY`, optional `RESEND_FROM`).

### 2026-07-12 — Super-admin dashboard + platform payments (v0.2.9)
- New role-gated `/superadmin` (server-checked `hasRole('super_admin')`) with a real
  **Platform payments** config: the super admin connects **Cryptomus + NOWPayments**
  (how panel owners pay Innvil). Secrets pgcrypto-encrypted in a new
  `platform_payment_gateways` table — **run migration `0008`**. Binance Pay later.
- Actions: `platform-payments.ts` (get/connect/disconnect, reuse adapter fields) +
  `superadmin.ts` (platform overview counts, `amSuperAdmin`). Owner sidebar shows a
  "Super admin" link only to super admins.
- Make yourself super admin once:
  `update profiles set role='super_admin' where id=(select id from auth.users where email='you@…');`

### 2026-07-12 — Owner dashboard + auth production (v0.2.8)
- Auth split into dedicated worlds/routes: `/login`, `/signup` (username + confirm +
  email verification), `/forgot-password`, `/reset-password`. Landing CTAs link to them.
- Owner **Account settings** (username, email w/ confirmation, password) via
  `account.ts` + `AccountSettings.tsx`; reachable from the sidebar + topbar avatar.
- Fixes: `.ledgerline.app` → `innvil.cloud` (shared `src/lib/config.ts`); My Panels
  **Visit** button works (`/p/<sub>`); create-panel **Connect provider** lands you on
  the Providers tab (`PanelAdmin` `initialTab`); the **bell** is clickable (dropdown).
- Owner shell real data: Orders (all panels) + Customers (all panels) + Billing
  (real revenue + 5% commission estimate; auto-settlement "coming soon"); Support
  (all panels) → coming soon. See `OwnerSections.tsx`.

### 2026-07-12 — Admin dashboard production pass (v0.2.7)
- **Orders tab is now real** (§5): `admin-orders.ts` — `listPanelOrders` (owner-only
  fields incl. provider cost/profit), status-filter chips + search, expandable detail,
  and working per-order actions (resend / refill / cancel / mark completed / refund
  full or partial) + on-demand "Sync statuses".
- **Overview tab is now real**: live stats (revenue today, orders today, pending,
  customers, active services) + recent orders, via `getPanelOverview`.
- **Honest placeholders**: the tabs that showed non-functional controls (Domain custom
  domains, Customer API, Risk & Security, Notifications, Support, Promotions) are now
  clean "Coming soon" states so no fake controls ship to production. Domain still shows
  the real, live included subdomain.
- Note: `middleware.ts` was renamed to `proxy.ts` (Next 16 proxy convention) — edit
  `proxy.ts`, don't re-add `middleware.ts`.

### 2026-07-12 — Owner landing sections + NOWPayments gateway (v0.2.6)
- Owners can add their own promo/ad blocks to the storefront landing (heading, body,
  optional CTA button/link) via the Design Studio, shown below the default landing
  content and stored in `settings.branding.sections`. Sanitized on read and write.
- NOWPayments is now a real, connectable crypto gateway (300+ coins): hosted invoice
  checkout + HMAC-SHA512 IPN verification, reusing the existing adapter/webhook
  pipeline. Owner enters API key + IPN secret and points NOWPayments' IPN callback at
  `<APP_URL>/api/webhooks/nowpayments`.

### 2026-07-12 — Glyph revert (shape restored)
- Reverted the latest transform-based glyph distortion and restored the previous anvil shape in both in-app logo and favicon.
- Kept spacing/layout tuning independent from symbol geometry so future adjustments can target fit without altering identity.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Vertical occupancy correction (actual glyph geometry)
- Corrected the perceived top/bottom emptiness by increasing the anvil glyph's true vertical occupancy inside the badge (not only CSS scaling), so spacing aligns more closely with side breathing room.
- Applied the same geometry update to both in-app mark and favicon for consistent spacing behavior.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Container proportion tweak (vertical spacing balance)
- Kept container size unchanged and increased the mark's vertical fill so top/bottom spacing no longer feels excessive versus side spacing.
- Repositioned the mark slightly to keep visual center and improve badge-to-symbol proportionality across nav/auth/sidebar placements.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Backdrop-first composition pass (fixed badge, larger mark)
- Kept the rounded-square badge size unchanged while increasing anvil footprint so the symbol reads as the primary form and the badge reads as supportive backdrop.
- Allowed controlled horizontal overrun behavior (horn-side emphasis with counterweight on heel side) while keeping the base visually grounded inside the badge.
- Preserved palette, flat vector style, and canonical anvil silhouette; synchronized favicon path to the same refined geometry.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Horn/heel/waist micro-refinement + tighter badge corners
- Smoothed horn emergence from the top face, slightly extended heel presence, reduced face thickness further, flattened/extended waist transitions, and nudged base width for better silhouette balance.
- Tightened rounded-square corner radius for the in-app logo container and favicon badge so the container no longer overpowers the refined symbol.
- Preserved the original muted beige/sand background and dark charcoal glyph palette with flat vector geometry.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Optical refinement pass (proportional tuning)
- Tuned the existing anvil silhouette proportions without changing identity: thinner top face, slightly shorter horn, longer/shallower waist transitions, slightly wider base, and reduced left heel projection.
- Shifted the glyph slightly left and increased internal breathing room to counter horn weight and improve optical centering at favicon scale.
- Kept the original muted beige background + dark charcoal glyph palette and synchronized the favicon path with the in-app mark.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Continuous-form anvil refinement pass
- Refined the anvil mark into a more continuous silhouette so horn, waist, heel, and base read as one sculpted geometric form instead of stacked blocks.
- Improved waist definition with cleaner transitions between face and base, avoiding rigid center cutouts and non-essential chamfers.
- Kept the same muted beige badge + dark glyph palette and synced favicon geometry to the updated silhouette.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Canonical anvil silhouette (SaaS geometry pass)
- Refined the Innvil symbol to better preserve canonical anvil anatomy (horn, face, waist, heel, base) while keeping a minimal engineered SaaS aesthetic.
- Improved optical balance and geometric proportions so the mark reads as an iconic technology symbol rather than a decorative historical illustration.
- Synced the favicon to the same updated silhouette and retained the muted beige background with dark glyph palette.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Bold silhouette logo redesign (anvil-first)
- Redesigned the Innvil symbol into a bold, unmistakable geometric anvil silhouette, prioritizing immediate recognition over abstract hidden symbolism.
- Kept the original brand palette direction: muted beige/sand badge with a dark charcoal glyph, no gradients, glow, or decorative effects.
- Updated favicon geometry + color to match the in-app mark for consistent recognition from 16x16 up to larger brand surfaces.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Minimalist geometric anvil logo redesign
- Reworked the Innvil brand mark into a minimalist geometric monoline symbol inspired by an anvil silhouette, avoiding literal/medieval elements and decorative sparks.
- The new mark emphasizes clean negative space and a strong small-size footprint for favicon clarity and SaaS-grade icon recognition.
- Updated in-app logo usage and favicon to use the same core geometry for visual consistency.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Build fixes + Innvil anvil brand mark refresh
- Fixed TypeScript build blockers across customer/admin/storefront flows: added missing `currency` prop usage in customer quick cards, corrected PaymentsTab fallback typing to satisfy `PaymentsMeta`, and tightened storefront payment-method mapping typing.
- Replaced the old gauge/L visual mismatch with a modern anvil-inspired Innvil mark and aligned favicon + in-app logo usage.
- Increased brand-mark visibility by removing extra logo/container margins so the mark fills its badge area more clearly in top nav/auth/sidebar placements.
- Reader note: Please note these updates properly in your changelog/release notes after you read this line, then you can delete this line.

### 2026-07-12 — Instant admin content while background sync refreshes
- Improved the owner admin experience so providers, services, customers, and payments content remains visible immediately after load while a background refresh updates it with the latest data.
- The admin tabs now use a lightweight session cache to preserve the last loaded state during refreshes, reducing blank states and perceived loading delays.

## Completed Features

### Phase 0: Preview Complete
- ✅ **Panel Statuses** — All 5 statuses (draft, live, inactive, suspended, maintenance) with customer-facing behavior
- ✅ **Customer Management** — Customer list + full profile drawer (wallet, deposits, orders, tickets, login history, referral, API key, notes, ban/restrict/adjust balance)
- ✅ **Provider Management** — Multi-provider table (priority, status, health, last sync), test/import/delete actions
- ✅ **Service Management** — Services list with category, pricing, floor, min/max, refill/cancel/drip, featured
- ✅ **Category Manager** — Reorder, rename, hide, delete categories
- ✅ **Order Management** — Order table, per-order actions (retry/refill/cancel/mark completed/refund), expandable provider detail
- ✅ **Customer API Management** — Owner-side rate limits, allowed IPs, key regen/disable, usage logs (separate from the customer-facing API docs tab)
- ✅ **Risk & Security** — Deposit limits, fraud/access controls
- ✅ **Notifications** — Owner + customer notification toggles, auto-reply, support inbox
- ✅ **Payment Gateway Configuration** — Cryptomus, Coinbase Commerce, NowPayments, Stripe, PayPal, Bank Transfer, Wise, Manual, Custom
- ✅ **Domain Management** — Subdomain, custom domain, SSL status, force HTTPS, redirects, DNS verification
- ✅ **Super Admin** — Analytics, panel management (login-as-owner/view-as-customer), user management, payments, audit logs, system health
- ✅ **Customer-facing privacy rules** — Inactive mode restrictions, API response behavior, never exposes provider cost/floor/commission to customers

> Note: `panel-preview.jsx` at the project root is the original single-file design
> reference this build was ported from. It's gitignored and kept intentionally —
> treat it as a design source of truth for visual/UX intent, not as code to import.
> When the two disagree on a detail, `src/components/panels/index.tsx` (this real,
> typed implementation) is authoritative.

---

### Phase 1: Customer Experience & Order Flow Refinement (Implemented — Preview)

> **Status 2026-07-07:** Implemented as a new, fully separate component tree in
> `src/components/customer/` (CustomerLanding, CustomerDashboard, NewOrder,
> PlatformIcons). The world switcher's "Created panel · Customer-facing" view now
> renders `CustomerPanel`. The old `LivePanel`/`LivePanelContent` in
> `src/components/panels/index.tsx` are deprecated and no longer routed.
>
> Delivered: white-label customer landing (Create Account / Log In only), separate
> customer dashboard (Dashboard, New Order, Orders, Wallet, Tickets, API, Profile),
> Platform → Category → Service flow with monochrome SVG platform glyph buttons,
> alias-aware smart search ("twitter views" → X Views), progressive form with
> dependent resets, full service preview, favorites + automatic Favorites category,
> Recently Ordered, 1-click Quick Order & Reorder, wallet + Add Funds always in
> header, number-input quantity (no sliders), hamburger mobile nav, sticky order
> summary, helpful empty states. All of it status-aware (live/inactive/offline).
> Drip feed: per-service `drip` capability; supported services show an opt-in
> toggle (always OFF by default) with runs/interval inputs — total quantity is
> split across runs, never multiplied.
>
> Profile: edit username, change email (with confirmation), change password.
> API tab: masked key display (nb_live_886**********839976f69bd) with copy +
> one-click regeneration, and full per-endpoint docs (Service list / Create /
> Status / Multiple status / Refill / Balance / Cancel) with copyable request
> URLs and highlighted JSON response samples. Landing page:
> stats strip, per-platform services showcase, benefits grid, FAQ accordion, and
> CTA band — all white-label.
>
> The "Preview Panel Status" switcher bar is preview-only tooling: `CustomerPanel`
> renders it only when given `previewControls` (passed solely by the world
> switcher in `app/page.tsx`, default off). Real customers never see status
> controls — only status effects (offline screens, inactive banner).

### Objective

Redesign the customer-facing experience to be significantly simpler and faster than traditional SMM panels by separating the customer dashboard from the Panel Owner dashboard and reducing the number of steps required to place repeat orders.

### Customer Dashboard

- Customer UI must remain completely independent from the Panel Owner/Admin dashboard.
- Customers only have access to Dashboard, Orders, Wallet, Tickets, API, Profile, and other account-related features.
- Login/Register belong only on the panel's public landing page.
- After authentication, the default page is the Dashboard.

### Landing Pages

- Innvil landing page is dedicated to selling the platform ("Create your own SMM Panel").
- Every panel has its own independent customer landing page focused on **Create Account** and **Log In**, with no Innvil branding.

### Platform Organization

Services should first be grouped by **Social Platform**, configured by the Panel Owner.

Flow:

**Platform → Category → Service**

Platform selection should use **official platform icon buttons**, not a dropdown.

Requirements:

- Use the official monochrome brand glyphs (SVGs).
- Do **not** use emojis.
- Do **not** use colorful logos.
- Place each icon inside a soft, rounded square button/card.
- Desktop displays all available platform buttons in one horizontal row whenever possible.
- Mobile allows horizontal scrolling while maintaining large touch targets.

Selecting a platform filters the available categories and services.

### Order Structure

1. Platform (icon buttons)
2. Search
3. Category
4. Service
5. Service ID
6. Quantity
7. Amount
8. Create Order

### Smart Search

Search should match:

- Platform
- Category
- Service Name
- Service ID
- Aliases / keywords

Searching "Twitter Views" should also return services named "X Views", "Tweet Views", and other relevant aliases.

### Progressive Form

- Category remains disabled until a Platform is selected.
- Service remains disabled until a Category is selected.
- Service details update automatically after selecting a service.
- Changing the Platform resets all dependent selections to prevent invalid orders.

### Service Preview

Display:

- Service Name
- Service ID
- Minimum
- Maximum
- Estimated Start Time
- Estimated Completion
- Refill Availability
- Cancel Availability
- Description

### Favorites & Quick Access

Implement:

- Favorite Service
- Automatic Favorites category
- Recently Ordered
- Pinned Services / Quick Order
- Reorder button on completed orders

### Dashboard Improvements

Display:

- Wallet
- Recent Orders
- Pending Orders
- Completed Today
- Favorite Services
- Quick Order

Wallet balance should remain visible in the header together with an **Add Funds** shortcut.

### UX Improvements

- Remove all quantity sliders.
- Quantity is always entered through a number/text input.
- Remove unnecessary sliding panels throughout the customer dashboard.
- Mobile navigation uses a hamburger menu.
- Sticky Order Summary on desktop.
- Helpful empty states with actionable guidance.
- Minimize clicks throughout the customer experience.
- Optimize for frequent repeat orders rather than first-time users.

### UI Design Note

Platform icons should always use the **official monochrome brand glyphs (SVGs)** displayed inside **soft, rounded square cards**. Avoid emojis and colorful logos. This visual language should remain consistent across desktop and mobile to create a premium, modern interface while keeping every platform instantly recognizable.

### Input Responsiveness (hard rule)

Typing in any customer-facing field must never wait on content loading. Keystrokes
echo immediately and search results update on the same keystroke (typing "1"
instantly lists all service IDs starting with 1). Keep filtering synchronous and
in-memory; when real data arrives (Phase 3+), load/cache the catalog upfront and
filter client-side — debounce only network fetches, never the input echo or
locally-available results.

### Design Principle

The customer experience should **not imitate traditional SMM panels**.

Every interaction should minimize clicks, reduce cognitive load, and optimize for repeat ordering.

When multiple design options exist, always prefer the one that is:

- Faster
- Cleaner
- Easier to understand
- More efficient for returning customers

The customer dashboard should feel closer to a modern SaaS product than a legacy SMM panel. This principle should guide all future customer-facing UI and UX decisions.

---

### Phase 2: Production Foundation (In Progress)
- ✅ **Next.js routing** — App Router with dynamic routes
- ✅ **Role-based layouts** — Preview shells for panel owner, customer, and super admin
- ✅ **Protected routes** — Preview infrastructure (planned for Supabase Auth)
- ✅ **Reusable components** — Card, Toggle, Pill, StatusBadge, StatCard, FloorLedger, RevenueChart
- ✅ **Loading, empty, and error states** — Preview placeholders
- ✅ **Component refactoring** — PanelAdmin split into `src/components/panels/admin/`
  (PanelAdmin shell + AdminTabs with 17 focused tab components + CustomerDrawer).
  Dead `LivePanel`/`LivePanelContent` removed. `panels/index.tsx`: 2,250 → ~1,070 lines.
- ◐ **TypeScript interfaces** — `src/types/index.ts` holds `Panel` + `CustomerRow`
  (re-exports `PanelStatus`). Order/Service/etc. types still to add.
- ⏳ **Mock data extraction** — Mock data already lives in src/data/constants.ts

### Phase 3-6: Supabase Integration, Business Logic, Platform Features, Testing
- ⏳ Pending implementation

---

## Pending Features (Roadmap)

### Phase 2: Production Foundation (Remaining)
- [ ] Role-based layouts for panel owner, customer, and super admin
- [ ] Protected routes with authentication
- [ ] Loading skeletons and error boundaries
- [ ] Empty states with helpful CTAs

### Phase 3: Supabase Integration
- ◐ **Database schema** — DONE: `supabase/migrations/0001_init.sql` (all tables,
  enums, ledger + provider-key pgcrypto functions) + `0002_rls.sql` (RLS, helpers,
  api-key column revoke). Needs a live project to run against.
- ◐ **Supabase clients** — DONE: `src/lib/supabase/{client,server,admin,middleware,constants}.ts`
  + root `middleware.ts` (session refresh). Uses `@supabase/ssr` (added to deps).
  > Owner and customer auth share one Supabase project. To stop them clobbering
  > each other's session on a single origin (localhost), the customer storefront
  > uses a SEPARATE session cookie: `createStorefrontClient()` (server + browser)
  > namespaces via `cookieOptions.name = STOREFRONT_COOKIE_NAME`, and the
  > middleware refreshes the storefront cookie on `/p/*`, the owner cookie
  > elsewhere. In production the storefront is a different domain, so this is moot.
- ◐ **DB types** — DONE: `src/types/db.ts` (row interfaces), re-exported from types/index.
- ◐ **Authentication with Supabase Auth** — DONE (platform/owner side): server
  auth helpers `src/lib/auth.ts` (getUser/getProfile/ensureProfile/hasRole) +
  actions `src/lib/actions/auth.ts` (signIn/signUp/signOut); AuthScreen wired to
  real Supabase (loading/error/email-confirmation states), AppTopbar logout wired.
  Profile fallback via service role (covers the case where the auth.users trigger
  couldn't install).
- ◐ **Customer storefront (real)** — DONE (browse + auth): real route
  `app/p/[subdomain]/` resolves a panel by subdomain (status-aware: offline
  screens for draft/suspended/maintenance, inactive banner), server-fetches
  customer-safe services (`src/lib/actions/storefront.ts` getPublicPanel/
  getStorefrontServices — no cost/markup/profit) + the visitor's customer account.
  `Storefront.tsx`: on-brand landing (branding, hero, platform showcase, benefits,
  auth card) + panel-scoped customer auth (`src/lib/actions/customer-auth.ts`
  customerSignUp/SignIn/SignOut → creates auth user + profile(customer) +
  customer_accounts row). Signed-in view now renders the REAL `CustomerDashboard`
  (Dashboard/New Order/Orders/Wallet/Tickets/API/Profile) fed by live data —
  branding, catalog (Platform→Category→Service + smart search), wallet balance,
  and real order placement via `placeOrder` (§4). The customer components accept
  data via props (mock defaults so `/?preview=1` still works).
  Production maps subdomain→/p/[subdomain] via a middleware rewrite (later); path
  works now. PENDING: wallet funding/deposits (§7), tickets system, real API key,
  order-status sync (§4 cron).
- [ ] Protected-route redirects (owner app) — activate when preview worlds become real routes.
- ◐ **User roles** — schema enum + profile.role + hasRole() gate in place;
  Super Admin / Panel Owner / Customer / Staff. Role-gated route wiring pending.
- ◐ Migrate admin/customer UI off mock data onto the DB (data-access layer) —
  DONE for panels: `src/lib/actions/panels.ts` (listPanels/createPanel/
  updatePanelStatus); InnvilApp loads real panels; DashboardHome + MyPanels
  render them (with empty/loading states); CreatePanelWizard creates real panels;
  a real panel (UUID) now loads into PanelAdmin. Remaining: services/orders/
  customers/etc. tabs still on mock.
  > Admin-dashboard server actions (panels, providers) authenticate the user and
  > enforce ownership IN CODE via the service-role client (getAuthedAdmin), rather
  > than relying on RLS `auth.uid()` (which wasn't resolving on writes in this
  > env). RLS remains in the DB for the future customer-facing browser client.
- [ ] Real-time subscriptions for order updates
- [ ] (schema) Additional tables for the operational admin layer (see Phase 4):
  - `providers` (name, api_url, **api_key encrypted / service-role only**, status, balance, currency, notes)
  - `services` (provider_id, provider_service_id, category, name, type, provider_rate, sell_rate, markup, min, max, description, status, sort_order)
  - `orders` (user_id, service_id, link, quantity, charge, provider_cost, profit, provider_order_id, status, provider_payload, provider_response, status_history)
  - `balance_transactions` (user_id, amount, type, reason, admin_id, balance_after)
  - `payments`/`deposits` (user_id, method, amount, status, gateway_ref, approved_by)
  - `faq` (question, answer, category, sort_order, published)
- ✅ Row Level Security (RLS) policies (panel-scoped; provider api_key never readable client-side) — `0002_rls.sql`

### Phase 4: Business Logic — Operational Admin Dashboard (SocPanel-style)

> This phase turns the preview admin tabs into a real bring-your-own-provider
> control panel. Innvil never sells SMM services directly — each panel owner
> connects their own provider(s); we pull services, forward orders, and sync
> statuses. **All provider API calls happen server-side (route handlers / edge
> functions) so api keys are never exposed to the frontend.** Provider logic lives
> in reusable service files (e.g. `src/lib/providers/`).

- **§1 Provider API Management** — server layer DONE; UI wiring pending
  - ✅ Standard SMM v2 wrapper: `src/lib/providers/` (types + client:
    services/add/status/multistatus/refill/cancel/balance, `ProviderError` handling)
  - ✅ Credentials helper: `getProviderCredentials`/`storeProviderKey` (pgcrypto
    via service-role RPC; keys decrypted server-side only)
  - ✅ Actions: `src/lib/actions/providers.ts` — create/update/delete (RLS authz;
    key stored via set_provider_key), `testProviderConnection`,
    `fetchProviderBalance` (caches balance + last_balance_sync),
    `countProviderServices`. Never returns api keys.
  - ✅ ProvidersTab wired to real data: `listProviders(panelId)`, add-provider
    form → createProvider, per-row Test connection / Fetch balance / Delete, with
    loading/error/empty states. Guards non-UUID (mock) panels. Selects explicit
    non-secret columns (never api_key_enc).
- **§2 Service Import & Sync** — DONE (server + UI), with 2-level auto-categorize
  - ✅ `src/lib/actions/services.ts`: fetchImportableServices, importServices
    (markup applied to selection; **auto-creates a two-level category tree** —
    platform category e.g. "Instagram Services" → sub-category e.g. "Followers",
    detected by keyword from the provider category+name; platform guess for the
    customer flow), syncProviderServices (refresh rate/min/max + availability,
    recompute sell rate), setServiceStatus, updateService, deleteService,
    listCatalog (nested platform→sub→services tree), recategorizeServices
    (rebuild platform→type from service names, drop empty leaf categories — fixes
    pre-2-level imports without delete+reimport). Detection: main category =
    platform name only; sub = service type keyword; both read from the service
    NAME so provider category messiness is ignored. Markup math in
    `src/lib/money.ts`. Requires migration `0003_category_hierarchy.sql`
    (adds provider_categories.parent_id).
- **§3 Service Management** — DONE (bulk done; a couple of edge fields remain)
  - ✅ Provider cost vs sell vs profit shown per service.
  - ✅ Enable/disable per service (toggle).
  - ✅ Edit imported services: display name, description, markup (recomputes sell), delete.
  - ✅ Bulk actions: global "Select all services" + per-row multi-select →
    enable/disable, set markup (recomputes sell), delete. `bulkSetServiceStatus`/
    `bulkSetMarkup`/`bulkDeleteServices` (authorizeServiceIds gate; chunked `.in()`).
  - ✅ Per-category **Delete** (platform + sub headers) → `deleteCategory` removes
    the category + children + their services.
  - ✅ Per-platform **editable logo** (`setPanelPlatformIcon` → `panels.settings.
    platforms[key]`, monochrome SVG path). Built-in glyphs incl. LinkedIn/Bluesky;
    unknown platforms get a neutral ring until a logo is set. Customer platform
    buttons are derived from available services (empties hidden) and use these
    logos; picking a service collapses the list into a re-pick dropdown.
  - [ ] Nice-to-have later: bulk category move, sync-selected, edit min/max/sort order.
- **§4 Order Automation** — placement DONE (customer side); sync/cron pending
  - ✅ `src/lib/actions/orders.ts` `placeOrder`: charges wallet via
    `apply_balance_change` (atomic), inserts the order, auto-routes to the mapped
    provider (`addOrder`, server-side), stores provider order id + payload +
    response, writes order_status_history. Refunds + marks `refunded` if the
    provider rejects/unreachable. Unmapped service → stays `pending`.
    `listCustomerOrders` for the customer dashboard. Wired into the storefront
    (NewOrder → onPlaceOrder → placeOrder → refresh).
  - ✅ Status sync: `src/lib/orders/sync.ts` (mapProviderStatus, syncPanelOrders
    batch `getMultiStatus` per provider with an atomic status-transition claim,
    syncAllOpenOrders). Cron `app/api/cron/sync-orders` (+ `vercel.json` every
    10 min, CRON_SECRET-gated) + owner `syncOrdersNow(panelId)` for on-demand.
    Partial/canceled/refunded auto-refund the unfilled portion (proportional to
    `remains`), once, via the claim → apply_balance_change('refund').
  - ✅ Manual per-order actions (owner): `src/lib/actions/admin-orders.ts`
    resendOrder / requestRefill / requestCancel / markOrderCompleted / refundOrder
    (full or partial). All owner-auth + ownership-checked; provider calls server-side.
- **§5 Admin Orders Page** — DONE (owner Orders tab is real)
  - ✅ `listPanelOrders(panelId, {status?, limit?})` — real order list with owner-only
    fields (charge, provider cost, profit, provider order id, remains). Emails resolved
    via service role. OrdersTab: status filter chips + client-side search (id/service/
    customer/link), expandable detail with the per-order actions above + "Sync statuses"
    (syncOrdersNow). Guards non-UUID (mock) panels.
  - `getPanelOverview(panelId)` powers the real **Overview** tab (revenue today, orders
    today, pending, customers, active services, recent orders). `getPanelCurrency`.
  - [ ] Later: provider/date-range filters, raw provider_response viewer, CSV export.
- **§6 Users & Balance Management** — DONE (owner side)
  - ✅ Real customer list per panel: `listPanelCustomers` (email, balance, order
    count, spend, status: active/banned/restricted). CustomersTab wired to it.
  - ✅ Manual credit/debit with reason → `adjustCustomerBalance` (apply_balance_
    change `manual_adjust`, owner as admin); inline Credit +/Debit − per customer.
    `setCustomerStatus` (ban/unban). `src/lib/actions/customers.ts`.
  - This is the MVP wallet-funding path (owner credits a customer → they can order)
    until self-serve gateways (§7 / Phase 5).
- **§7 Payment Admin** — multi-gateway, bring-your-own PER PANEL (adapter pattern)
  - ✅ **Adapter architecture** `src/lib/payments/adapters/` — a `GatewayAdapter`
    (fields, createCheckout, extractOrderId, verifyWebhook) + registry +
    `GATEWAY_CATALOG` (shows the whole ecosystem incl. India options; unbuilt ones
    are "coming soon"). Adding a gateway = one adapter + it's live.
  - ✅ **Cryptomus** (crypto), **Razorpay** (India — Payment Links + HMAC webhook),
    **Stripe** (global — Checkout Session + signed webhook), **NOWPayments** (crypto,
    300+ coins — hosted invoice + HMAC-SHA512 IPN) all connectable.
    PayPal / PayU / Cashfree / Paytm / Coinbase = catalog "coming soon".
  - ✅ Credentials: migration `0005` table `panel_payment_gateways`; secrets stored
    as an ENCRYPTED JSON blob in `api_key_enc` (reuse set/get_gateway_key), public
    fields in `config` jsonb. `getGatewayContext` decrypts server-side only.
  - ✅ Shared webhook `src/lib/payments/webhook-handler.ts` + routes
    `app/api/webhooks/[gateway]` (+ static `cryptomus`): adapter verifies →
    idempotent pending→completed → `apply_balance_change('deposit')`.
  - ✅ Actions `payments.ts`: getPaymentsMeta / connectGateway (dynamic fields per
    adapter; blank secret keeps existing) / disconnectGateway / createDeposit
    (routes via the panel's active gateway) / listDeposits. PaymentsTab = full
    catalog UI. **Requires `NEXT_PUBLIC_APP_URL` + a public webhook URL.**
  - Owner setup: Razorpay/Stripe owners add the webhook endpoint in their gateway
    dashboard (help text in the UI); Cryptomus is per-invoice (auto). NOWPayments
    owners set the IPN callback URL to `<APP_URL>/api/webhooks/nowpayments` and paste
    the API key + IPN secret.
  - [ ] Next: PayPal, then PayU/Cashfree/Paytm adapters; per-panel CURRENCY (wallets
    are USD-oriented today — Razorpay charges INR); storefront multi-gateway chooser;
    admin deposits/tx-log view.
- **§8 Support & FAQ**
  - [ ] Ticket system: view, reply, close, reopen
  - [ ] FAQ CRUD
- **§9 Statistics Dashboard**
  - [ ] Cards/charts: revenue, provider cost, profit, orders (total/pending/completed/failed), users, deposits
  - [ ] Provider performance: orders by provider, failure rate, avg completion, profit by provider
- **§10 Panel Settings**
  - [ ] Settings pages: general, branding/logo/name, domain/custom domain, + placeholders (language, notifications, integrations, manager/staff roles) structured for later expansion

### Phase 4.w: Design with AI Add-on (NOTED, not built)

> Post-MVP paid add-on for panel owners to generate storefront themes/sections/copy
> with controlled quality and safety.

- Runtime model access should use an Innvil-owned API account/provider that allows
  serving end-users; do not assume personal editor subscriptions can be embedded as
  website runtime AI backends.
- Hard boundary: Design with AI is interface-only (landing-page/panel-dashboard
  design and formatting) and must never mutate backend rules, business logic,
  permissions, payment/order flows, or database behavior.
- All AI requests must be server-side only (no provider secrets in browser).
- Generation contract: strict JSON schema output + component allowlist renderer.
- Quality pass chain: planner -> builder -> critic -> repair, then publish approval.
- Persist versioned drafts with rollback and generation audit logs.
- "Skills" should be implemented as Innvil-owned prompt rules, retrieval docs,
  validators, and regression tests (not chat-memory coupling).

### Phase 4.v: Trust boundaries + go-public SEO messaging (NOTED, not built)

- Customer-account trust boundary:
  - panel owners must not have login-as-customer capability in production;
  - panel owners must not have customer password reset capability;
  - owner remediation is limited to moderation + balance adjustments.
- SEO/ad messaging before public launch should explicitly highlight:
  - easier operations than legacy SMM panels,
  - customer-account protections above,
  - custom-domain reversibility (disconnect falls back to included subdomain).
- Public launch gate: ship only when current MVP fixes are complete; keep non-ready
  modules clearly labeled as "coming soon".

### Phase 4.v.1: Pre-launch landing pages + storefront designs (NOTED, for MVP)

> When we go public, do a dedicated landing + storefront design pass.

- **Main Innvil landing = FULL feature parity.** Surface every built feature (panels,
  bring-your-own-provider, custom domains, wallet, support tickets, earnings/receipts,
  duplicate detection + mass cancel, provider-balance visibility, mobile, etc.). Use
  **socpanel.com** as the structural reference for the main marketing landing.
- **Lead with what socpanel does NOT have** (differentiators):
  - **0% monthly rent — 5% commission on completed orders only** (socpanel charges
    monthly rent regardless of sales). Headline differentiator.
  - No setup fee; unlimited panels per account; subdomain live in minutes.
  - **Bring-your-own-provider** — Innvil never resells; owner keeps 95%.
  - **Custom-domain reversibility** — disconnect anytime → auto-falls back to the
    included subdomain (no lock-in).
  - **Customer privacy boundary** — owners can't log into customer accounts or reset
    customer passwords; only balance adjustments (trust/safety).
  - **Modular business OS**, not just a panel — Automator, Analytics add-on, Design
    Shop, downloadable earnings receipts.
  - **ANVIL rewards token** (future) — rewards on top-ups + discounts on paid features.
  - Modern, mobile-first SaaS UX.
- **Richer per-panel storefront landing + more Design-Shop templates.** Expand the
  default storefront landing content and add premium themes/templates. Base panel/
  storefront designs on: **smmcost.com, smmcity.com, worldofsmm.com, prm4u.com**.

### Phase 4.u: Child panels (NOTED, not built)

- Introduce child panels where customers can run their own panel experience.
- Child-panel rent/pricing should be configurable by the child-panel operator.
- The current storefront UX can evolve into the child-panel admin surface.

### Phase 4.x: Automation Add-on ("Automator") — PAID feature (NOTED, not built)

> Port the working system at `C:\Users\My PC\SMM-automator` (Next.js + Supabase)
> INTO Innvil as a **paid add-on** a panel owner can buy/enable. Also a strong
> landing-page ad / SEO section. **Keep the reference project's logic**; only
> re-skin it to Innvil's design system (obsidian/gold/violet) — its own design
> is intentionally basic (built for the owner's internal use). The preview
> `AutomationTab` already has an "Automator add-on" placeholder to grow into.

**What the automator does (logic to retain), from the reference project:**
- Manual **mass order**: paste many post links → per-link **platform auto-detect**
  from the URL hostname (x/twitter, instagram, tiktok, linkedin, youtube — see
  `app/api/orders/route.ts` `detectPlatformFromLink`) → one tracked order per link.
- **Service presets** per (platform, tier=priority|regular): enabled presets map a
  `service_type` (likes/views/comments/…) → a provider service id + quantity, so a
  single link fans out into the right set of services automatically
  (`lib/place-order.ts` `submitOrderForLink`). Instagram **Reel** rule: only order
  views for /reel/ links. **Duplicate-skip**: a service already submitted for a
  link is skipped.
- **Comment pools**: for the `comments` service type, pull N unused comments from a
  per-platform pool (auto-pick oldest with stock), mark used, pass to the provider.
  Pools are uploaded as CSV (papaparse) → `comment_pools` / `comment_pool_items`.
- **Fully-automatic mode** (optional, advanced): `watched_accounts` + a cron
  (`app/api/cron/poll-x`) watch X accounts and auto-order newly detected posts.
- Background processing via Next `after()`; orders tracked in an `orders` table
  with a `services_ordered` JSON + status pending→submitted/failed.
- Reference tables: service_presets, comment_pools, comment_pool_items,
  api_providers, watched_accounts, settings, orders.

**Requested enhancements when porting:**
1. **Smart link detection** — today it splits on `\r?\n|,` only. Make it detect
   links even when pasted as ONE blob with no separators. Recipe: split *before*
   each URL start and keep only URL-shaped parts, e.g.
   `text.split(/(?=https?:\/\/)/i).map(s=>s.trim().replace(/[\s,]+$/,"")).filter(s=>/^https?:\/\//i.test(s))`
   — handles newlines, commas, spaces, AND concatenated `…/1https://…/2`.
2. **File upload** to extract links: **csv** (papaparse — already used), **xlsx**
   (SheetJS `xlsx`), **docx** (`mammoth` → raw text). **pdf** if feasible
   (`pdfjs-dist`/`pdf-parse`); if it's heavy, ship csv/xlsx/docx first. Flatten the
   file to text, then run the same smart link detection.

**Innvil integration shape:**
- Gate behind an add-on flag on the panel (e.g. `panels.settings.automation` or a
  subscription row); Innvil can charge for it (revenue beyond the 5%).
- Customer side: a "Mass / Auto Order" surface in the customer dashboard (link
  blob + file upload + smart detection), only when the panel has the add-on.
- Owner side: configure service presets per platform/tier + comment pools (grow
  the existing AutomationTab).
- Provider calls reuse `src/lib/providers/` (server-side, keys never exposed).
- Landing: dedicated feature/SEO block (like the provider-automation section).

### Phase 4.y: Analytics Dashboard + Content Calendar Add-on (NOTED, not built)

> Same shape as the Automator above: a **paid, unlockable add-on** on top of the
> core panel product, not part of the base panel/storefront. Direction is to
> grow Innvil into a one-stop shop for social-media-marketing tooling beyond just
> SMM order fulfillment. Build this only after the current panel-maker product
> (Phases 2-4 core) is complete and earning — it needs a cron/infra upgrade
> beyond what Phases 2-4 require.

**What it is:**
- An analytics dashboard + content calendar. Proposed subdomain shape:
  `analytics.innvil` (mirrors the `p.[subdomain]` storefront pattern).
- **Bring-your-own API**, same principle as SMM providers: the panel owner
  supplies their own platform API keys/credentials — Innvil never fills these in
  and never pays for or proxies a social platform API on the owner's behalf.
  This is why pricing is a flat rental, not usage/subscription-to-an-API-cost
  (see pricing below).
- **Auto-posting/scheduling is a separate, distinct feature inside the content
  calendar** — not bundled into "analytics." Analytics = tracking/reporting on
  followed accounts and links; calendar = planning + (optionally) auto-posting.
- Core analytics loop: user adds accounts they want to follow/track → every new
  link pulled gets analytics attached → user can download a synced CSV export on
  whatever cadence their plan allows. What the user does with those links
  afterward is their own responsibility — cover this explicitly in ToS/privacy
  terms (extend Innvil's existing ToS for this add-on specifically).

**Reference implementation (structure/UI reference ONLY, not a design source of
truth — Innvil's own obsidian/gold/charcoal theme and component system always
win over this):**
- `C:\Users\My PC\Documents\CRM style analytics dashboard` (internally named
  "LinkBatch"). Next.js + Supabase. Relevant files: `components/
  LinkBatchDashboard.js`, `lib/linkbatch-data.js` (data shape, stats aggregation,
  hashtag/topic trend helpers), `supabase/migrations/001_linkbatch_crm.sql`
  (schema: workspaces, connected_accounts, campaigns, posts + post_metrics,
  export_batches + export_batch_items, reports, activity_events, workflow_jobs,
  alerts, saved_views, notifications, drafts, scheduled_posts, approvals,
  media_assets, publishing_logs, plan_limits, admin_cost_settings, billing_usage
  — all workspace-scoped with RLS via an `lb_is_workspace_member()` helper).
  The reference project's own dashboard UI is messy/unfocused by the user's own
  assessment — when porting, consolidate and simplify rather than copy as-is;
  take the useful pieces (account/link tracking, CSV export batches, hashtag/
  topic trend rollups, workspace + RLS pattern) into Innvil's own IA.
- The reference project's plan tiers are subscription-priced against its own API
  cost ($0/$49/$99/$299/$549/custom) — **do not reuse this pricing model**; that
  project pays for its own API access, Innvil's add-on does not.

**Innvil pricing direction (rental, not subscription-to-API-cost):**
- Flat monthly **rental** tiers, gated by sync/refresh frequency (not by API
  cost, since the owner brings their own key): Basic $25/mo, Standard $45/mo,
  Premium $75/mo, Business $105/mo (exact naming/amounts TBD at build time, but
  keep the "rent scales with refresh rate, not with API spend" principle).
- Higher tiers = faster sync/refresh cadence for pulling link analytics —
  similar in spirit to the reference project's `sync_frequency_minutes` per
  plan, but the price basis is refresh rate/rental, not a cost Innvil incurs.

### Phase 4.z: ANVIL platform token (NOTED, not built — post-MVP)

> Innvil's experimental platform token/rewards system — the competitive moat idea.
> **Build only after the core MVP is stable & public-ready.** Full economics live in
> memory `innvil-anvil-token.md`. Summary:
> - **Phase 1 (off-chain, in-platform):** ANVIL rewarded as a % of each top-up; accrues
>   APY (~0.5–1%/yr, higher when holding ≥ $100 worth); USD ⇄ ANVIL conversion; opt-in
>   toggle to spend ANVIL as substitute currency when USD is exhausted; ANVIL buys every
>   paid feature (Design Shop, Analytics rent, Automator, future SaaS) at **tiered
>   discounts** — each tier kept below Innvil's margin so we still net positive. Target
>   max supply 10B. Collect traction data for the deck + on-chain reference.
> - **Phase 2 (on-chain):** launch with extra user benefits to grow holders; in-platform
>   ANVIL converts **1:1** to the coin; add a **burn** mechanism (spending ANVIL in the
>   panel burns supply); keep adding SaaS sinks to drive utility + holders.
> - Branding: platform currency is *anvil* now → *ANVIL* the coin later (logo = the mark).

### Phase 5: Platform Features
- [ ] Payment gateway integration (Cryptomus, Stripe, PayPal) — wires into Phase 4 §7
- [ ] Webhook handling for payment confirmations
- [ ] Customer-facing API with rate limiting
- [ ] Custom domain setup with SSL
- [ ] DNS verification flow
- [ ] SSL certificate management
- [ ] Rate limiting per customer/API key
- [ ] Email notifications (order updates, deposits, support)
- [ ] Referral system for panel owners
- [ ] Promotional codes and discounts

### Phase 6: Testing & Deployment
- [ ] Unit tests for utility functions and hooks
- [ ] Integration tests for order flow
- [ ] Permission and access control testing
- [ ] Customer privacy verification
- [ ] Payment flow testing
- [ ] Provider failure handling
- [ ] UI/UX testing across devices and browsers
- [ ] Performance testing and optimization
- [ ] Security audit
- [ ] Production deployment to Vercel
- [ ] Production Supabase configuration
- [ ] Domain configuration and SSL setup
- [ ] Launch checklist and documentation
- [ ] Post-launch monitoring and analytics

---

## Environment Variables

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Encrypts provider + payment-gateway API keys (pgcrypto). Required.
PROVIDER_KEY_SECRET=your_long_random_secret

# Public origin — REQUIRED for crypto deposits (Cryptomus callback/return URLs).
# Must be a public URL for webhooks to reach you (prod/preview or a tunnel).
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Protects the order-status sync cron (/api/cron/sync-orders). Vercel Cron sends
# it as `Authorization: Bearer <CRON_SECRET>`. If unset, the endpoint is open
# (fine for local testing — hit it in a browser to force a sync).
CRON_SECRET=your_long_random_secret
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

---

*Last updated: 2026-07-09 — Money loop closes end-to-end: §6 owner balance mgmt (Customers tab: real list + manual credit/debit) and §7 Cryptomus crypto deposits with automatic webhook credit (customer Add funds → checkout → confirm → balance auto-updates → order). Customer storefront runs the REAL dashboard on live data; §4 placeOrder forwards to provider/refunds. Run migration 0005; set NEXT_PUBLIC_APP_URL + PROVIDER_KEY_SECRET. Next: order-status sync cron (§4), admin Orders (§5), more gateways.*
