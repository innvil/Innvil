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

### 2026-07-25 — Collage mockup: single-platform tile on a focused panel (v1.1.44)
- Finishes the platform-focus visual pass. On a platform-focused panel, the Agency design's `mockup:"collage"`
  platform card now shows **ONE big "Built for [platform]" tile** (large `PlatformGlyph` + capitalized name) instead
  of the multi-platform icon row; all-platforms panels keep the row. `DesignRenderer` branches on
  `data.focusPlatform` (already plumbed). Matches the orbit hero's single-platform treatment.
  (Versions 1.1.35–1.1.43 were the owner's Binance Order-ID rework — order_id column, C2C-only matching, etc.)

### 2026-07-25 — Binance Pay: owner review + reconcile (v1.1.34)
- **New "Binance Pay review" card** in the Payments tab (shown only when Binance Pay is connected) — the last
  deferred Binance nice-to-have. Lets the owner see every Binance deposit (amount wanted / exact payable / bonus /
  status / matched tx), and **Credit or Cancel** the ones that didn't auto-credit (wrong amount, recipient, or stuck
  pending) after verifying in their Binance account. Also shows the **cached Pay history** (received transactions,
  flagged credited/unmatched) and a **stale-sync alert** when history hasn't refreshed while deposits are open.
- `src/lib/actions/binance-admin.ts` (NEW, owner-auth) — `getBinanceReview(panelId)` returns `{deposits,
  transactions, lastSyncAt, syncStale}` (payments where `gateway='binance_pay'` + `binance_pay_transactions`,
  customer identity resolved). Credit/Cancel reuse the existing `commitPendingPayment` / `cancelPendingPayment`.
  `AdminTabs.tsx` `BinanceReviewCard` renders it. No migration.

### 2026-07-25 — Repo handoff docs for resuming the major update (v1.1.33)
- Added `docs/handoff/` so another agent/session can continue cleanly: `README.md` (current state,
  migrations 0031–0038 + pg_cron + env/Supabase settings to apply, "build first" warning),
  `pending-items.md` (email-change OTP → Binance admin review → collage mockup → default-landing TG
  sections → Telegram add-on, each with files + build steps), and `conventions.md` (gotchas:
  never `export type` from a `"use server"` file, pg_cron not vercel.json + the `*/`-in-comment
  bug, OTP/Resend requirements, `placeOrderForAccount` money-core, platform-focus wiring, version/
  commit protocol). Docs only.

### 2026-07-25 — Branded password-reset OTP (no more Supabase reset link) (v1.1.32)
- **Password reset is now our own panel-branded OTP too** (like signup), so the reset email carries the panel's
  name and there's no Supabase magic link → no localhost/Innvil link. `customerForgotPassword(panelId, email)`
  resolves the user via new SQL `auth_user_id_by_email` (migration **0038**), stores a `reset`-purpose code in
  `customer_signup_otps` (new `purpose` column) and emails it via Resend; **always returns ok** (no account
  enumeration). `customerResetPassword(panelId, email, code, newPassword)` verifies (15-min TTL, 5 attempts) →
  `admin.updateUserById({password})`.
- `ForgotPasswordClient` is a 2-stage flow (email → code + new password); the old link-based `reset-password`
  route now just redirects there (kept for old bookmarks). `sendOtpEmail` gained a `kind` (signup/reset/change)
  for the copy. **Run migration 0038.**
- **Still Supabase-flow (small follow-up):** the logged-in **email-change** confirmation (`customerUpdateEmail`)
  — convert to the same OTP pattern next.

### 2026-07-25 — Platform-focus hero: single icon revolves + lights-out pulse (v1.1.31)
- Supersedes the v1.1.30 fly-across version. **On a platform-focused panel, the Orbit hero shows ONE platform icon revolving** continuously around the orbit
  ring surrounding the "+18% growth" card, instead of the multi-platform orbit. Kept **upright** (no self-spin) via
  an arm/counter-rotate pattern; relaxed **16s** revolution; and a **"lights-out" pulse every 5s** — visible ~2s,
  then a gentle ~3s fade-away-and-reappear (opacity out/in + slight shrink), still orbiting. Pulse period (5s) ≠
  revolution (16s).
- `DesignRenderer`: `dzOrbit` (arm rotates around centre) + `dzOrbitCounter` (item counter-rotates to stay upright)
  + `dzOrbitPulse` (5s: ~2s visible, ~3s fade out→in) keyframes. `DesignRenderData.focusPlatform` drives the branch in
  the `mockup:"orbit"` section (focus → single revolving icon `zIndex:5` above rings/card; else the orbiting badges).
  Threaded from `app/p/[subdomain]/page.tsx` (`panel.platformFocus`) and the Design Studio preview (`focus`).

### 2026-07-25 — Custom panel-branded signup OTP (replaces Supabase confirmation email) (v1.1.29)
- **Customer email verification is now our OWN OTP**, so the confirmation email carries the PANEL's name (not
  Innvil) and no longer depends on Supabase's project-wide template / Site-URL (which caused the localhost + Innvil
  emails). Flow: `customerSignUp` creates the user **unconfirmed via the admin API** (`createUser email_confirm:false`
  — sends NO Supabase email), stores a hashed 6-digit code (`customer_signup_otps`, migration **0037**), and emails
  it via **Resend** branded with the panel name. `customerVerifyOtp` checks the code (15-min TTL, 5 attempts) →
  `updateUserById email_confirm:true` → creates the customer account; the SignUpClient then auto-signs-in with the
  same credentials. `customerResendOtp` reissues a code. `sendEmail` gained a `fromName` (panel display name; domain
  stays the verified Resend one).
- `SignUpClient` is now a 2-stage form (details → **6-digit code** entry with Resend/Back), works in both the
  standalone page and the embedded design auth slot.
- **REQUIRES:** `RESEND_API_KEY` set (+ a verified `RESEND_FROM` domain) — without it the code can't be delivered and
  signup can't complete. Keep the Supabase **"Confirm email" setting ON** (so an unconfirmed user can't sign in until
  the OTP confirms them). **Run migration 0037.**

### 2026-07-25 — Customer login by username-or-email + Binance Order-ID flow (v1.1.28)
- **Customer login now accepts a username OR an email.** `customerSignIn(panelId, identifier, password)` resolves a
  non-email identifier to its login email WITHIN that panel (`customer_accounts` → `profiles.display_name` →
  `auth.admin.getUserById`), then signs in. Storefront login input is now `type=text` placeholder "Email or username".
- **Binance Pay is now transaction-id based (no auto-detect), matching the requested 2-step UX.** `BinancePayPanel`
  rebuilt as **(1) Make payment → (2) Verify payment**: step 1 shows amount + Binance ID + QR + "I've paid — verify";
  step 2 has an **"Enter your Binance Order ID"** field + Verify (`claimBinancePayment`). Dropped the 12s auto-poll +
  "check now" (`checkBinanceDeposit` / the `binance-sync` cron still exist as a background safety net; the customer
  path is TXID-only). Unique-amount anti-theft + 10-min expiry retained.
- **NOTE (config, not code):** customer confirmation emails going to *localhost* and showing *Innvil* branding are a
  **Supabase Auth** issue, not the app — set the project **Site URL** to prod, allowlist panel redirect URLs, add
  **custom SMTP** (deliverability), and note Auth email templates are **project-wide** (can't be per-panel branded
  without a custom OTP/magic-link flow via Resend). The signup code already passes the panel's own URL as `emailRedirectTo`.

### 2026-07-25 — Platform focus: live in the Design Studio preview (v1.1.27)
- **Fix: toggling "Telegram only" in the Design Studio didn't change the preview** — the preview rendered the
  design's own copy and never applied the overlay (the overlay only ran server-side on the live storefront).
  `DesignStudio` now computes `applyPlatformContent(activePkg, focus)` and renders that; the default (non-design)
  preview hero falls back to the platform pack's headline/description. So selecting a focus re-themes the preview
  instantly, matching what the live storefront shows after Save & apply.

### 2026-07-25 — Platform-specific panels (Telegram first) (v1.1.26)
- **A panel can now be scoped to ONE platform** (e.g. Telegram-only) or left as all-platforms (default). A
  focused panel gets **platform-specific landing marketing** AND a **hard catalog filter** (storefront shows only
  that platform's services). Set at creation and **editable later**. Grows one platform at a time — Telegram now.
- `src/lib/platform-focus.ts` (NEW, pure) — `PlatformFocus` ("telegram"), `PLATFORM_FOCUS_OPTIONS`,
  `readPlatformFocus`/`normalizePlatformFocus`, `platformAllowedByFocus`. Stored on `panels.settings.platformFocus`
  (no migration).
- **Content overlay:** `src/lib/design/platform-content.ts` (NEW) — `PlatformContentPack` + `applyPlatformContent(pkg, focus)`
  which overlays the platform pack's COPY onto a design's LANDING page (hero/features/steps/testimonials/faq/cta),
  preserving tokens/layout/animation. So **even a purchased design (Pulse, etc.) reads as Telegram-only.**
  `src/data/platform-content/telegram.ts` (NEW) — the Telegram pack (hero, features, steps, testimonials, FAQ, CTA, SEO).
- **Wiring:** `createPanel` accepts `platformFocus`; create wizard Basics step has an "All platforms / Telegram only"
  choice; `getPublicPanel` returns `platformFocus`; `getStorefrontServices` hard-filters services to the focus;
  `app/p/[subdomain]/page.tsx` applies `applyPlatformContent` to the active design, overrides the default landing
  hero copy, and sets Telegram-flavored SEO. Owner can change focus in the **Design Studio → Platform focus**
  (`updatePanelBranding`/`getPanelBranding` gained `platformFocus`).
- **Known follow-up:** the DEFAULT (non-design) landing gets TG hero + TG-only catalog + TG SEO now; its deeper
  sections (benefits/FAQ/how-it-works in `Storefront.tsx`) still show generic copy — theme those from the pack next.
  Purchased designs are already fully TG-themed.

### 2026-07-25 — Fix: "PlaceOrderInput is not defined" on panel create (v1.1.25)
- **Root cause:** re-exporting a TYPE from a `"use server"` module (`export type { PlaceOrderInput, PlaceOrderResult }`
  in `actions/orders.ts`, `export type { BinanceClaimResult }` in `actions/binance-pay.ts`). Next treats every export
  of a server-action module as an action; the erased type became an undefined runtime reference, crashing any client
  bundle that transitively loaded it (e.g. the create-panel wizard → `PlaceOrderInput is not defined`).
- **Fix:** dropped both `export type { … }` re-exports and switched to `import type { … }` for the annotations.
  Nothing external imported those types from the action modules (they also live in `orders/place.ts` /
  `payments/binance-match.ts`). **Rule:** never `export type` from a `"use server"` file — re-export shared types
  from a plain server-only module instead.

### 2026-07-25 — Mass order split out + build/launch fixes (v1.1.24)
- **Mass order is now its OWN tab, separate from Campaign.** `MassOrderCard` (nested inside `CampaignSurface` in
  all three states) was extracted to `src/components/customer/MassOrder.tsx` and mounted as a dedicated
  **"Mass order"** nav item/page in `CustomerDashboard` (`CustomerPage` gained `massorder`). `CampaignSurface` no
  longer renders it (dropped the three inline instances + the now-unused `runMassOrder`/`MassOrderResult` imports).
- **Fix: create-panel stuck on "Launching…".** The wizard's `launch` had no try/catch, so a thrown server action
  (e.g. while the build was broken) left `busy=true` forever. Now wrapped — surfaces the error + resets the button.
- **Fix: build error `Expression expected` in `app/api/cron/watch-accounts/route.ts`.** A `*/5 * * * *` cron
  expression inside a `/* … */` block comment closed the comment early. Reworded the comment (schedule lives in
  migration 0036).
- **Completed R5b's missing dependency:** the session-less order core. `src/lib/orders/place.ts` (NEW,
  server-only) holds `placeOrderForAccount(admin, panel, acct, input)` — the full money path (price → duplicate
  guard → charge → provider forward → refund). `actions/orders.ts` `placeOrder` is now a thin auth wrapper over
  it; `watch-sweep.ts` (R5b) uses it to order on behalf of a resolved customer with no session. No behaviour change.

### 2026-07-25 — Automator v2 — R5b: watched accounts / full-auto (feed-based) (v1.1.23)
- **The Business+ "watched accounts" perk is now live** — full-auto ordering of new posts. Innvil can't reliably
  scrape X/IG/TikTok from serverless, so it's **feed-based** (bring-your-own, like providers): the customer
  registers an **RSS/Atom feed URL** per account; a cron polls it and fans new post links out through their
  automation profile.
- **Session-less ordering refactor:** the order money-path moved from `actions/orders.ts` into
  `src/lib/orders/place.ts` (`placeOrderForAccount`) so the cron can place orders on behalf of a resolved
  customer account (no session). `placeOrder` is now a thin auth wrapper over it — behaviour unchanged.
- `src/lib/automation/feed.ts` (NEW) — `fetchFeedLinks` / `parseFeedLinks` (RSS + Atom, no dep, newest-first,
  baseline-diffed). `src/lib/automation/watch-sweep.ts` (NEW) — `sweepWatchedAccounts`: for each active feed on a
  live Business+ panel with an active sub + configured profile, detects new posts (capped 3/run), enforces the
  tier platform scope, and orders via `slotsForLink` → `placeOrderForAccount`; advances the baseline; records a
  campaign. Route **`app/api/cron/watch-accounts`** + schedule **`0036_supabase_watch_accounts_cron.sql`** (every
  5 min).
- **Migration `0035_watched_accounts.sql`** (NEW) — `watched_accounts` (panel/customer/label/feed_url/
  last_item_url/active; RLS = panel members / super admin / owning customer). **Run 0035 + 0036.**
- `actions/watched.ts` (NEW) — `getWatchedAccounts` / `addWatchedAccount` (validates the feed + baselines to the
  newest item so history isn't ordered) / `setWatchedActive` / `removeWatchedAccount` (gated: Business+ tier +
  active sub). Storefront `CampaignSurface` gained a **Watched accounts** card (Business+ only); the subscribe-card
  perk dropped its "coming soon" tag.
- **Automator v2 R1–R5 complete.** Run migrations **0035, 0036** (+ schedule the `innvil-watch-accounts` cron).

### 2026-07-25 — Binance Pay: landing/SEO marketing + USDT-only hints (v1.1.22)
- **Landing:** the "Wallets + crypto deposits" card now lists Binance Pay; added a dedicated **"Accept USDT via
  Binance Pay"** feature card (unique-amount auto-reconcile, no merchant account, optional bonuses)
  (`PublicLanding.tsx`). **SEO:** added keywords "smm panel binance pay", "accept usdt smm panel", "smm panel
  crypto payments" (`app/layout.tsx`).
- **USDT-only surfaced to customers:** the Add-Funds Binance hint leads with "USDT only"; the pay panel shows a
  "**USDT only** — sending any other coin won't be credited" warning under the exact amount. Owner connect help
  notes "Accepted asset: USDT only". (Enforced server-side already — currency must equal USDT.)

### 2026-07-25 — Binance Pay — Phase 2: unique payable amount + auto-credit poller (v1.1.21)
- **Anti-theft via unique payable amounts.** Each pending Binance deposit is assigned a unique amount
  (base + a tiny 0.0001-step tail, unique among the panel's open deposits) — the customer sends *exactly* that.
  A transaction maps to exactly one deposit by (amount + receiver UID + time window), so nobody can claim a
  payment that isn't theirs, and the exact-amount match replaces loose amount policies. Migration
  **`0033_binance_payable.sql`** (NEW) adds `payments.binance_payable` + a partial index. **Run 0033.**
- **Hands-free auto-credit.** `src/lib/payments/binance-match.ts` (NEW, server-only, non-action so it can export
  sync helpers) holds the shared `pickPayable` / `validateTx` / `findMatchingTx` / `creditMatch` core.
  `actions/binance-pay.ts` now exposes **`checkBinanceDeposit`** (no TXID — sync + match by unique amount →
  credit) alongside the TXID-submit `claimBinancePayment` (now also amount-guarded). `src/lib/payments/binance-poll.ts`
  (`sweepBinanceDeposits`) + route **`app/api/cron/binance-sync`** sweep every panel with an open deposit and
  auto-credit matches. Scheduled by **`0034_supabase_binance_sync_cron.sql`** (NEW, every minute, vault
  `app_url`/`cron_secret`). **Run 0034.**
- Storefront `BinancePayPanel` rebuilt: shows the **exact amount to send** (the match key, copyable), **polls
  every 12s** to auto-detect the payment (plus an "I've paid — check now" button), and keeps the transaction-id
  entry as a collapsible fallback. `Storefront` passes `onBinanceCheck`. The requested top-up is credited (+ bonus);
  the tiny unique tail is a disclosed processing margin.
- **Binance Pay is now production-ready** (Phase 1 + 2 complete). Deferred nice-to-haves: richer admin
  review/alerts. **NEXT (per user): add Binance Pay to the Innvil SEO + landing marketing.**

### 2026-07-25 — Binance Pay: top-up bonus + 10-minute expiry (v1.1.20)
- **Binance Pay deposits now earn the same tiered top-up bonus** as the other gateways (e.g. 100 USDT → +1%).
  `claimBinancePayment` resolves the panel's discount tier for the base amount via the shared
  `resolveGatewayDiscountPct` (exported from `actions/payments.ts` — per-gateway `discountRules`, else the crypto
  category default), credits `base + bonus`, and records `bonus_amount` on the payment. Base = received
  (credit_actual) or requested (exact). Storefront shows the "send X → receive X+bonus" line before paying
  (dropped the earlier binance discount suppression).
- **10-minute deposit window.** `createBinanceDeposit` returns `expiresAt` (created_at + 10 min);
  `claimBinancePayment` rejects with `EXPIRED` past it. The customer `BinancePayPanel` shows a live mm:ss
  countdown and disables Verify when it lapses.
- **Each TXID is single-use** (unchanged) — the partial unique index on `payments.binance_tx_id` plus a
  pre-check. Receiver match is against the owner's configured Binance UID.

### 2026-07-25 — Binance Pay (personal-account reconciliation) — Phase 1 (v1.1.19)
- **New per-panel payment method: Binance Pay** — the owner connects their OWN read-only Binance key; the
  customer pays the owner's Pay ID and submits the transaction id; the server pulls the owner's Pay history,
  matches + validates, and credits the wallet. **NOT** an official merchant checkout (personal-account
  reconciliation). Internal id `binance_pay`; accepted asset **USDT**, credited 1:1 into the wallet.
- **Migration `0032_binance_pay.sql`** (NEW) — `binance_pay_transactions` (per-panel Pay-history cache, RLS on
  with no policies = service-role only) + `payments.binance_tx_id` with a **partial unique index** (one Binance
  tx credits at most one deposit). **Run migration 0032.**
- `src/lib/payments/binance.ts` (NEW) — signed HMAC-SHA256 client for `sapi/v1/pay/transactions`.
  `src/lib/payments/binance-sync.ts` (NEW) — `syncPanelBinanceHistory(panelId)` (decrypts the owner key, upserts
  the overlapping window; single-flight). `adapters/binance.ts` (NEW) — a fields-only "adapter" so the owner
  CONNECT form + encrypted secret storage reuse the gateway machinery (`createCheckout`/`verifyWebhook` never
  run). Registered in the adapter map + `GATEWAY_CATALOG` (crypto, available).
- `src/lib/actions/binance-pay.ts` (NEW) — `createBinanceDeposit` (pending payment + pay-to details, no redirect)
  + `claimBinancePayment` (validate tx format → local lookup → sync-on-miss → checks: incoming/positive, currency
  == USDT, order type ∈ {C2C,PAY}, receiver UID when set, not older than the deposit, anti-replay → amount policy
  → atomic claim + `apply_balance_change('deposit')`, roll back on credit failure). **Amount policy** per gateway:
  `credit_actual` (default, credits what was received) or `exact` (mismatch stays pending for owner review).
- Storefront: `getPanelPaymentMethods` flags `binance_pay` as `manual`; `Storefront` passes `onBinanceCreate` /
  `onBinanceClaim`; `CustomerDashboard` renders a **BinancePayPanel** (QR + Pay ID + amount + paste-transaction-id
  → Verify) instead of a redirect. On success the wallet refreshes immediately.
- **Owner setup:** Payments tab → connect Binance Pay (Pay ID, optional UID/QR/amount-policy, read-only API key +
  secret). **Caveats surfaced in the connect help:** Innvil is serverless (no fixed egress IP → key IP-allowlist
  isn't reliable; keep it read-only); it's a personal-account workaround — confirm commercial receipts are
  allowed with Binance.
- **NEXT (Phase 2, deferred):** pg_cron poller (`/api/cron/binance-sync`), unique-payable-amount anti-theft,
  richer admin review + alerts.

### 2026-07-25 — Welcome message: manually send to existing customers (v1.1.18)
- **The welcome message can now be sent on demand to EXISTING customers** — individually or in bulk (the auto-send
  only fires for brand-new sign-ups). `actions/admin-tickets.ts` `sendWelcomeToCustomers(panelId, {customerIds?|all})`
  (owner-auth) renders the panel's configured welcome (`renderWelcome`) and opens a **welcome-kind** ticket per
  target so replying still grants the free credit **once**; customers who already have a welcome ticket are
  **skipped** (no second bonus). Returns `{sent, skipped}`.
- UI: a **"Send welcome"** button in each customer's expanded manage row (Customers tab), and a **"Send to all
  existing customers"** control in the **Welcome message** card (Notifications tab, with a confirm + result count).
- Needs migration **0031** (the `kind` column). No new migration.

### 2026-07-25 — Automated new-customer welcome + mobile payments fix (v1.1.17)
- **Every new customer now auto-receives an owner welcome message** (as a support ticket) — welcomes them,
  offers a small free credit if they reply, and invites them to Innvil. **Fully owner-editable** (edit the
  subject/body entirely, or turn it off).
  - `src/lib/welcome.ts` (NEW, pure) — `WelcomeConfig {enabled, subject?, body?, creditEnabled, creditAmount}` on
    `panels.settings.welcome`; `DEFAULT_WELCOME_SUBJECT`/`DEFAULT_WELCOME_BODY` (default copy with `{panel}` /
    `{credit}` placeholders), `readWelcomeConfig`, `normalizeWelcomeConfig`, `renderWelcome` (fills placeholders).
  - **Migration `0031_welcome_tickets.sql`** (NEW) — `support_tickets.kind` (default `general`, welcome ticket =
    `welcome`) + `welcome_bonus_granted` (one-time flag). **Run migration 0031.**
  - `actions/customer-auth.ts` — `ensureCustomerAccount` now detects a genuinely NEW account (insert, not upsert;
    loses the unique-constraint race → skips) and fires `sendWelcomeTicket` (owner-authored ticket, `customer_unread`).
  - `actions/tickets.ts` `customerReply` — first reply to the welcome ticket grants the owner's configured credit
    **once** (atomic flag-claim → `apply_balance_change` `manual_adjust` "Welcome bonus"; rolls back the flag on
    failure). Can't be farmed.
  - `actions/welcome.ts` (NEW, owner-auth) — `getWelcomeSettings` / `setWelcomeSettings` (audit-logged). Owner UI:
    the **Notifications tab** now hosts a real **"Welcome message"** card (`AdminTabs.tsx` `WelcomeMessageCard`) —
    toggle, subject, body, free-credit toggle + amount, reset-to-default; the email-notifications part stays "coming soon".
  - NOTE (white-label): the default body includes an Innvil invite line; owners can delete it since the whole
    message is editable.
- **Payments tab mobile fix** — the gateway rows were cramped on phones (badges + Edit/Disconnect crushed onto one
  line). The row now **stacks vertically on mobile** (label/badges wrap; the action buttons drop below full-width)
  and sits inline on `sm+`.

### 2026-07-25 — Automator v2 — R5a: Business+ file-upload link import (v1.1.16)
- **The Business+ "file upload" perk is now live** (the other half, watched-accounts/full-auto, stays deferred —
  it needs a cron + social-platform APIs). `src/lib/automation/file-links.ts` (NEW, client) —
  `extractLinksFromFile(file)` flattens **csv / xlsx / xls** (SheetJS) / **docx** (mammoth) / **txt** to text and
  runs the existing smart `parseCampaignLinks` (handles concatenated URLs). Both deps already ship.
- `CampaignSurface` (subscribed state): an **"Upload file"** button next to Configure, shown only when
  `sub.fileUpload` (owner on Business+). Extracted links are appended to the paste-links textarea (then Run as
  usual); a per-upload result note. The subscribe-card "file upload" perk dropped its "coming soon" tag
  (watched accounts keeps it).
- No migration. **NEXT (R5b, deferred):** watched-accounts / full-auto ordering (cron + platform polling).

### 2026-07-25 — Automator v2 — R4b: owner-configurable customer price + Business+ tier upgrade (v1.1.15)
- **The customer Automator subscription is no longer hard-coded** — the owner sets what customers pay and can
  run a promo. The $6.99 / $9.99 figures are just suggested DEFAULTS.
  - `src/lib/automation/pricing.ts` (NEW, pure) — `SUGGESTED_AUTOMATOR_PRICE` 6.99 / `SUGGESTED_AUTOMATOR_PLUS_PRICE`
    9.99; `AutomatorPricing {price?, promoActive, promoPrice?, promoLabel?}` on `panels.settings.automator`;
    `suggestedAutomatorPrice` (Business+ → 9.99, else 6.99), `baseAutomatorPrice` (override ?? suggested),
    `effectiveAutomatorPrice` (active valid promo ?? base), `automatorPromoApplies`, `normalizeAutomatorPricing`.
- **Business+ upgrades the storefront subscription.** The customer sub's feature set follows the OWNER tier:
  Business+ raises the suggested default to **$9.99** and unlocks **file upload + watched accounts** (surfaced on
  the storefront subscribe card as included · *coming soon* until R5 builds the surfaces).
- `actions/automator-sub.ts` — charges the **effective** price (was the flat constant); `AutomatorSubInfo` gained
  `basePrice`, `promoActive`, `promoLabel`, `fileUpload`, `watchedAccounts`. `billing/automator.ts` renewal sweep
  now charges each panel's **current effective price** (loads settings per involved panel).
- `actions/automator-pricing.ts` (NEW, owner-auth) — `getAutomatorPricing` / `setAutomatorPricing` (validates the
  promo is below the regular price; audit-logged). Owner UI: a **"Customer price"** card in the Campaign
  Automation tab (`AdminTabs.tsx` `CustomerPricingCard`) — monthly price (blank = suggested default) + a
  promo/discount toggle (promo price + label), shown once the owner has an active tier.
- Storefront `CampaignSurface` subscribe card shows the promo (strike-through base + label) and the Business+
  perks. No migration (`settings.automator` is JSONB config).

### 2026-07-25 — Automator v2 — R4: storefront teaser + subscribe + always-free mass order (v1.1.14)
- **The storefront Campaign tab is now the real customer surface — always visible to every customer** (drives
  demand). `CampaignSurface.tsx` rewritten as a 3-state machine driven by `getAutomatorSub`:
  1. **Not offered** (owner has no tier) → "How it works" + a **"Contact support to enable it"** button
     (`onContactSupport` → the Tickets tab).
  2. **Offered, not subscribed** → the pitch + a **$6.99/mo Subscribe** button (`subscribeAutomator`) with the
     customer's wallet balance + a lapsed-for-low-balance note.
  3. **Subscribed** → the full paste-links surface (live per-platform analysis, **Configure** → `AutomationConfig`
     keyword slots, **Run** → `runCampaign`, per-link results, recent campaigns).
- **Mass order stays available for FREE in ALL states.** New `runMassOrder({panelId, text})` in
  `actions/campaigns.ts` — storefront-auth'd, gated only on a **live panel + active customer** (no subscription):
  one order per line, `serviceId | link | quantity` (pipe or whitespace separated), the service id resolves by the
  panel's own **local_id** or the uuid, each placed via `placeOrder` (customer wallet). Returns `MassOrderResult`
  `{placed, totalCharge, failed, items}`. Rendered as a **"Mass order · Free"** card in every state of
  `CampaignSurface`.
- `CustomerDashboard.tsx`: the **Campaign** nav item is now always shown (dropped the `campaignEnabled` gate) and
  passes `onContactSupport={() => go("tickets")}`. `campaignEnabled` prop is now vestigial.
- **R1–R4 complete.** Run migrations **0028, 0029, 0030**. **NEXT (R5, deferred):** Business+ extras — file-upload
  link import + watched-accounts auto-order.

### 2026-07-25 — Faster "Provider balances → Refresh all" (v1.1.13)
- **The Provider-balances "Refresh all" was slow because each provider was a separate server action** — Next
  serializes server actions from one client, so the client-side `Promise.all(rows.map(fetchProviderBalance))`
  actually ran one-by-one. New **`refreshAllProviderBalances()`** (`actions/providers.ts`) refreshes EVERY
  provider across the owner's panels in **one** request, in parallel server-side (`Promise.all`); returns
  `{ refreshed, total }`. `OwnerProviderBalances.refreshAll` now calls it instead of N separate actions.

### 2026-07-25 — Faster "Sync statuses" + "Refresh & resend" (v1.1.12)
- **Parallelized the serial hot loops** in the two owner order actions (were the main wait):
  - `orders/sync.ts` `syncPanelOrders` — the 3 pre-passes (expire/failed/dupe reconcile) now run via `Promise.all`,
    and `refreshPanelStorefrontSnapshots` materializes customer snapshots in **bounded-parallel batches of 10**
    (was a sequential per-customer loop — the big drag on panels with many customers). Per-provider status sync
    was already parallel; provider selection/commission stay sequential (balance accounting order matters).
  - `admin-orders.ts` `refreshProviderBalancesAndRetryHeldOrders` — provider **balance refresh** now runs in
    parallel (independent API calls), and the **resends** run in bounded-parallel **batches of 5** (fast without
    hammering one provider's API). The balance-gated retryable SELECTION stays sequential (decrements per-provider
    remaining).
- No behaviour change — same results, less waiting.

### 2026-07-25 — Automator v2 — R3: keyword fan-out engine (v1.1.11)
- **`runCampaign` (`actions/campaigns.ts`) rewritten to the v2 model.** Dropped the owner-preset lookup +
  regular/priority tier. Now: gates on the owner tier (`hasCampaignAutomation`) + an **active customer automator
  subscription** (`automator_subscriptions.active`) + a **configured profile** (`profileIsConfigured`); enforces
  the tier's **platform scope** (`tierPlatforms` — out-of-scope link → skipped "Not in the panel's plan"); and
  for each link fans out via **`slotsForLink(profile, platform, link)`** — the customer's keyword-matched slots
  (or keyword-less defaults), deduped by service — placing one order per slot via `placeOrder`. Records
  `campaigns`/`campaign_items`. The Instagram-Reel special-case is gone (the customer expresses it via a "reel"
  keyword slot). `runCampaign` signature dropped `tier`. `campaign_service_presets` (0028) is now fully unused.
- **NEXT (R4):** the always-on storefront teaser (contact-support when the owner hasn't subscribed) + the
  customer **$6.99 subscribe button** (calls `subscribeAutomator`) that unlocks the config + run surface.

### 2026-07-25 — Blog: edit the article BODY (v1.1.10)
- **Only the meta (title/desc/slug/tag/keywords) was editable — now the BODY is too.** `actions/blog-admin.ts`
  `updatePostBody(id, { intro, sections, cta })` (super-admin gated) sanitises the block structure (drops empty
  blocks/sections, keeps known kinds) and saves intro + `sections` (jsonb) + `cta`; revalidates the slug.
- `src/components/superadmin/BlogBodyEditor.tsx` (NEW) — edits the lead **intro**, each **section** (H2 + blocks:
  paragraph / sub-heading / bullet / numbered / quote, add/remove per block + per section), and the closing
  **CTA**. Opened by a new **"Edit body"** button on each **draft AND published** post in `BlogReview`
  (alongside the meta "Edit"); saving refreshes the queue and (for published posts) revalidates the live page.
  No migration.

### 2026-07-25 — Blog: bulk topic import (paste or file) (v1.1.9)
- **The AI blog was recycling topics because the queue kept emptying** (falling back to the small built-in
  pool). Added a **bulk topic import** so the super admin can load many topics at once. `actions/blog-admin.ts`
  `addTopicsBulk(items[{topic,keywords[]}])` — super-admin gated, inserts `blog_topics` as pending, skips blanks
  + case-insensitive duplicates (existing + within-batch), returns `{added, skipped}`.
- `BlogReview.tsx` Topic-queue card gained an **"Import many topics"** block: a textarea (one topic per line,
  optional `| keywords`) + **Upload file** (.csv/.xlsx → col A topic, col B keywords; .docx/.txt → one per line).
  Files parsed client-side via dynamic `import("xlsx")` / `import("mammoth")` (both already deps). Refreshes the
  queue + cache on success. No migration.

### 2026-07-25 — Refresh & resend: resend even when the order lost its provider mapping (v1.1.8)
- Follow-up to 1.1.7 (which still didn't reorder). `submitPendingOrderToProvider` hard-required
  `order.provider_id`; stuck-pending orders whose service wasn't mapped at placement (provider_id null) were
  never sendable. Now it **resolves the provider from the service's CURRENT mapping** (`services.provider_id` +
  `provider_service_id`) when the order's is missing, sets `provider_id` on the order when it sends, and the
  candidate filter dropped the `provider_id` requirement (any pending order with a service and no
  `provider_order_id` is a candidate). Still skips orders that already have a `provider_order_id` (no double-send).

### 2026-07-25 — Refresh & resend now catches stuck-pending orders too (v1.1.7)
- **"Refresh & resend" only retried orders explicitly flagged held-for-provider-balance** — pending orders that
  simply never got forwarded to the provider (stuck on OUR end) were ignored. `refreshProviderBalancesAndRetry
  HeldOrders` (`admin-orders.ts`) now treats ANY pending order with a `provider_id` but no `provider_order_id`
  as a candidate (never sent = safe to resend; a set `provider_order_id` means it's genuinely pending at the
  provider → skipped). Balance-held orders still gate on the refreshed provider balance; other stuck orders
  resend directly. `submitPendingOrderToProvider` already guards on `provider_order_id`, so there's no
  double-send risk.

### 2026-07-25 — Automator v2 — R2: customer keyword-slot config (v1.1.6)
- **The config now belongs to the CUSTOMER** (keyword slots), not the owner. `src/lib/automation/profile.ts`
  (NEW, pure) — `AutomationProfile` = `platforms: { [platform]: AutomationSlot[] }`, each slot = `{serviceId,
  quantity, keywords[]}`; `slotsForLink(profile, platform, link)` fires keyword-matched slots (substring
  `matchesAnyKeyword`) or the keyword-less defaults, deduped by service. Read/normalize helpers.
- **Migration `0030_automation_profiles.sql`** (NEW) — `automation_profiles` (panel_id, customer_id, config
  jsonb; RLS = panel members / super admin / owning customer). Supersedes 0028's `campaign_service_presets`.
  **Run migration 0030** (and 0029 if not yet).
- `actions/automation-profile.ts` (NEW) — `getAutomationProfile` (offered, tier `allowedPlatforms`, profile,
  customer-orderable `servicesByPlatform` filtered to the owner tier's platforms) + `saveAutomationProfile`
  (normalized to allowed platforms + valid service ids). Storefront-auth'd.
- `src/components/customer/AutomationConfig.tsx` (NEW) — per-platform slot editor (service select + qty +
  comma-keywords, add/remove), **hidden by default**, opened by a **Configure** button in `CampaignSurface`
  (which dropped the old regular/priority toggle), collapses on Save.
- **NEXT (R3):** rewrite `runCampaign` to fan out via the customer's profile (`slotsForLink`) + enforce the tier
  platform scope, dropping the owner-preset lookup. Then R4 (storefront teaser + customer $6.99 subscribe button).

### 2026-07-25 — Automator v2 — R1b-ii: owner tier subscribe UI (v1.1.5)
- **The "Campaign Automation" PanelAdmin tab is now the real owner subscribe UI** (was a "coming soon"
  placeholder). `AutomationTab({ panelId })` in `AdminTabs.tsx`: loads `getPlan`, shows current plan
  (renews/paused) + this panel's Innvil balance, and three tier cards — **Pro $9.99 / Business $19.99 /
  Business+ $49.99** — each with its platform scope + features. Subscribe/Switch → a **confirm step that warns**
  "you pay $X/mo; make sure you have ~N+ customers who'll subscribe at $6.99 first" (break-even = ceil(price/6.99)
  → Pro 2, Business 3, Business+ 8), then calls `setPlan`. Cancel supported. Charges from the panel's Innvil balance.
- **R1 complete** (model + customer sub backend + owner subscribe UI). **NEXT (R2):** replace the owner-preset /
  regular-priority campaign config with the CUSTOMER keyword-slot automation profile (hidden-by-default, opened by
  a "Configure" button), then R3 (keyword fan-out) + R4 (storefront teaser + customer subscribe button).

### 2026-07-25 — Automator v2 — R1b: customer $6.99 subscription (backend) (v1.1.4)
- **The hard-coded $6.99/mo customer Automator subscription** (100% owner revenue). Migration
  **`0029_automator_subscriptions.sql`** (NEW) — `automator_subscriptions` (panel_id, customer_id, active,
  since, last/next_charge_at, lapsed; RLS = panel members / super admin / owning customer). **Run migration 0029.**
- `actions/automator-sub.ts` (NEW) — `getAutomatorSub` (offered = owner has a tier / active / lapsed / price /
  wallet balance), `subscribeAutomator` (gated on the owner tier; charges $6.99 from the customer wallet as an
  **`order`-type** balance change — no provider payout, so it's 100% owner revenue — sets active +30d),
  `cancelAutomator`. Storefront-auth'd.
- `billing/automator.ts` (NEW) `billDueAutomatorSubs` — monthly renewal sweep (charge due active subs; lapse any
  the customer can't cover), wired into the **bill-addons** cron alongside plans + AI add-ons.
- `money.ts` already has `CUSTOMER_AUTOMATOR_PRICE = 6.99` / `AUTOMATOR_PERIOD_DAYS` (R1).
- **NEXT (R1b-ii):** owner tier subscribe UI (Pro/Business/Business+ cards + the "have enough demand first"
  warning) in the Campaign Automation tab. Then R2 (customer keyword config), R3 (keyword fan-out), R4 (storefront
  teaser + the customer subscribe button that calls `subscribeAutomator`).

### 2026-07-25 — Gate Design Tools behind a launch flag (coming soon) (v1.1.3)
- **Design Tools (dashboard layout builder + visual editor) are gated OFF for everyone — even Business/Business+.**
  The editor only reorders today; it needs nav/section placement, hamburger/dropdown layout, component placement,
  etc. before release. New `DESIGN_TOOLS_ENABLED = false` flag in `plans.ts`; `hasDesignTools()` returns false
  while it's off (flip the flag to re-enable the Business/+ entitlement everywhere it's gated). Design Studio now
  shows a **"Design tools · coming soon"** teaser instead of the Dashboard world toggle + Visual editor card.
- Landing + FAQ softened: the visual editor is described as **coming soon** (Design Shop stays live).

### 2026-07-25 — Automator v2 — R1: three-tier plan model + platform scoping (v1.1.2)
- **Re-architecting the Automator to the v2 model** (see memory `innvil-automator-v2`): customer keyword config,
  $6.99 customer sub (100% to owner), owner tier plans incl. **Business+**. This slice = the plan/pricing MODEL
  (pure); actions/UI/keyword-config/teaser come next (R1b→R4). No migration yet.
- `plans.ts` — `PlanTier` now `pro | business | business_plus`. **Tier → campaign platforms:** Pro = X/Instagram/
  TikTok; Business = + Facebook/YouTube/LinkedIn/Threads/Telegram; Business+ = **all** owner services (`null`).
  New helpers `tierPlatforms`, `automatorPlatformAllowed(settings, platform)`, `hasFileUpload` / `hasWatchedAccounts`
  (Business+ only); `hasDesignTools`/`planBundlesSupport` now true for Business AND Business+.
- `money.ts` — `INNVIL_BUSINESS_PLUS_PRICE = 49.99`; `planPrice` handles it; `CUSTOMER_AUTOMATOR_PRICE = 6.99`
  + `AUTOMATOR_PERIOD_DAYS` (the hard-coded customer sub — 100% owner revenue, wired in R1b).
- `actions/plan.ts` — `PlanInfo.businessPlusPrice`; Business+ also disables the separate ai_support sub (bundled)
  + counts as bundling support. Super-admin Panels **Plan** select gained a **Business+** comp option (testing).
- Existing 2b `campaigns.ts`/`CampaignSurface` (owner-preset + regular/priority) still compile but are SUPERSEDED
  — replaced in R2 (customer keyword config) + R3 (keyword fan-out).
- **NEXT (R1b):** customer $6.99 automator subscription (table + charge from wallet → owner earnings + monthly
  billing) + owner tier subscribe UI with the "have enough demand first" warning.

### 2026-07-25 — Campaign Automation — Phase 2b: fan-out engine + storefront surface (v1.1.1)
- **The Automator now runs orders.** `src/lib/actions/campaigns.ts` (NEW) — `runCampaign({panelId, links, tier})`:
  storefront-auth'd, gated on `hasCampaignAutomation`, parses the blob (`analyzeCampaign`), creates a `campaigns`
  row, and for each detected link looks up the owner's enabled `campaign_service_presets` for that platform+tier
  and places **one order per preset** via the existing `placeOrder` (customer wallet, floors/markup/provider all
  reused), deduping by service and applying the Instagram-Reel rule (views only). Records `campaign_items`
  (order_ids, charge, status), caps links by `campaignLinkLimit`, and skips comment presets (pools = 2c).
  `listCampaigns` for history.
- `src/components/customer/CampaignSurface.tsx` (NEW) — storefront Campaign tab: paste-links textarea with a
  **live analysis** (per-platform counts + unrecognized), regular/priority tier, Run, a per-link result list, and
  recent campaigns. Mounted in `CustomerDashboard` as a new **"Campaign"** nav item, shown only when
  `campaignEnabled`. Gate threaded `getPublicPanel.campaignAutomation` → page → Storefront → dashboard.
- **Testing:** comp a panel to Pro/Business (super admin) so the Campaign tab appears; until the 2c preset UI
  exists, insert a `campaign_service_presets` row (panel_id, platform, tier='regular', service_type, service_id,
  quantity, enabled=true) to see fan-out place orders. No new migration (0028 already covers it).
- **NEXT (2c):** owner preset UI (per platform/tier service_type → service + qty) + comment pools; then 2d
  (self-serve subscribe UI that unlocks the campaign surface + design tools) + background processing for big runs.

### 2026-07-25 — Campaign Automation (the Automator) — Phase 2a foundation (v1.1.0)
- **Started the Automator.** Foundation slice only (per user: full-auto "watched accounts" deferred). No UI or
  fan-out yet — that's 2b. Ships the detection engine + schema.
- `src/lib/automation/links.ts` (NEW) — ported from the SMM-automator project + enhanced: `detectPlatform(link)`
  (hostname → instagram/tiktok/youtube/x/facebook/linkedin/telegram/spotify/threads, with a substring fallback),
  `isInstagramReel(link)` (Reel rule = views only), **`parseCampaignLinks(input)`** (extracts every URL even when
  pasted with no separators — newlines/commas/spaces AND concatenated `…/1https://…/2` — deduped), and
  `analyzeCampaign(input)` (per-link preview: platform + counts). Pure module, client+server safe.
- **Migration `0028_campaign_automation.sql`** (NEW) — `campaign_service_presets` (OWNER config: per
  (platform, tier, service_type) → a panel `service_id` + quantity, `enabled`), `campaigns` (CUSTOMER run header:
  panel/customer/tier/status/total_links/total_charge), `campaign_items` (per link: detected platform, status,
  `order_ids` jsonb, charge, error). Enums `campaign_status` / `campaign_item_status`. RLS mirrors support
  tickets (presets = owner/super-admin only; campaigns/items = panel members, super admin, or the owning
  customer). **Run migration 0028.**
- **NEXT (2b):** fan-out — for each detected link, look up the owner's presets for its platform and place one
  order per preset via the existing `placeOrder` (customer wallet, floors/markup respected), writing
  `campaign_items`; then the storefront **Campaign** surface (link blob + csv/xlsx/docx upload). Then 2c (owner
  preset UI + comment pools) and 2d (self-serve subscribe UI that unlocks the campaign surface + design tools).

### 2026-07-25 — Landing: automation-first positioning + full feature coverage (v1.0.2)
- **The marketing landing (`PublicLanding.tsx`) now sells the whole product with an "SMM panel made easy /
  almost fully automated / minimal human touch" angle** (the landing = Innvil's storefront). Changes:
  - **Hero** repositioned: pill "SMM panel making & managing — made easy", mono line "Almost fully automated ·
    minimal human touch · 0% rent, 5% only", headline "Your own SMM panel, built and run for you", copy leads
    with what Innvil automates.
  - **NEW `#automation` section** ("Built to run itself. Minimal human touch.") — a 9-point checklist of what
    runs on its own (catalog import/categorize, markup pricing, order routing, 10-min status sync, auto-refunds,
    crypto auto-credit, commission settlement, held-order auto-resend, provider-spend logging) + "the only things
    that need you" line. New "Automation" nav anchor.
  - **`#platform` grid gained 3 cards** that were missing entirely: **Design Shop + visual editor**, **Free AI
    assistant** (owner), **AI customer support (add-on)**.
  - Fixed the stale `#why` line that listed the Design Shop as "next" — it's live now.
- **SEO pass (same release):** root metadata (`app/layout.tsx`) title → "Innvil — SMM Panel Making & Managing,
  Made Easy"; description + OG/Twitter reworked around automation; keywords add "smm panel made easy",
  "automated smm panel", "smm panel automation", "run/manage an smm panel". Two new FAQ entries in
  `landing-faq.ts` ("How much is automated?" + "Can I customize the storefront?") — they render on-page AND in
  the FAQPage JSON-LD (shared array). `app/JsonLd.tsx` SoftwareApplication description updated to match.
- Content/copy only; no logic change.

### 2026-07-25 — v1.0.0 — public launch 🎉
- **First stable release.** Build passes, deployed to production, and all three pg_cron jobs
  (`innvil-order-sync-every-10-min`, `innvil-generate-blog`, `innvil-bill-addons`) verified active + running.
  Google indexing requested.
- **What's live at 1.0:** end-to-end money loop (deposits → wallet → orders → provider forward → status sync →
  5% commission settlement w/ volume discounts + $100/day cap), white-label storefronts (subdomain + custom
  domains, per-panel metadata/favicon), bring-your-own provider, multi-gateway payments (Cryptomus/NOWPayments/
  Razorpay/Stripe), owner→Innvil top-ups, support tickets both directions, earnings receipts, AI blog autopilot
  (human-approved), customer AI support add-on + free owner assistant, SEO foundation + /blog, and a
  **functional Design Shop** (4 distinct designs — Pulse/Studio/Agency/Orbit — buy/activate/switch, full live
  previews, super-admin pricing + first-purchase promos) + **visual editor Phase 1**.
- **Gated "coming soon" (not blocking 1.0):** self-serve plan subscriptions + Campaign Automation Phase 2 (the
  Automator), visual-editor Phase 2 + dashboard editor, child panels / design resell. Business features are
  comp-only via super admin today.

### 2026-07-24 — Orbit/collage badges use real platform glyphs (v0.2.116)
- The `orbit` and `collage` hero mockups showed the platform's first LETTER in each floating badge. They now
  render the real monochrome brand glyph via the existing `PlatformGlyph` (`src/components/customer/
  PlatformIcons.tsx`, `fill: currentColor` → white on the accent badge; unknown platforms get the neutral
  fallback ring). `DesignRenderer` now imports `PlatformGlyph`.

### 2026-07-24 — Design #4 "Orbit" published — initial four complete (v0.2.115)
- **`src/data/designs/orbit.ts` (NEW) — "Orbit"** ($7, minimal futuristic premium): a combination of the
  backlog directions (GlassOS glass/aurora + Neon-Cyber grid + Floating Social Ecosystem hero). Deep-space
  canvas, electric-lime (#A3E635) + indigo accent, aurora-over-grid `backdrop`, glass cards.
- **New signature layout in the renderer: `mockup: "orbit"`** — platform badges orbiting a central "growth"
  dashboard node with spinning dashed rings (new `dz-spin`/`dz-spin-rev` CSS + `dzSpin` keyframe). `"orbit"`
  added to the schema mockup union.
- `src/data/designs/index.ts`: Orbit → `PUBLISHED_DESIGNS`; **`COMING_SOON_DESIGNS` is now empty** — the
  initial four (Pulse, Studio, Agency, Orbit) are all live, each with a distinct LAYOUT (phone-feed /
  dashboard-card / collage / orbit), not just a palette.
- **NEXT designs** come from the backlog in memory `innvil-design-directions` (GlassOS, Neon Cyber, Bento,
  Finance, Dark Luxury, Isometric, AI Assistant, Brutalist, Aurora, Motion) — each needs its own renderer
  variant/mockup. Then: visual editor Phase 2 + dashboard editor when the Automator launches.

### 2026-07-24 — Renderer now varies by LAYOUT + Design #3 "Agency" (bold/colourful) (v0.2.114)
- **Root fix: designs were only differing by tokens/copy** because `DesignRenderer` drew one fixed layout per
  section type — so a light palette on the same structure read as "Studio in white." The renderer now branches
  on `variant`/`mockup` for real layout differences:
  - **`mockup: "collage"`** (NEW) — a playful card collage hero (accent tile + trophy card + platform-icon card)
    instead of phone-feed / dashboard-card. `"collage"` added to the schema mockup union.
  - **`features` `variant: "color-cards"`** (NEW) — full-colour feature tiles cycling dark → accent-gradient →
    light with big emoji (`item.icon`). Default features variant now also uses `item.icon` when present.
- `src/data/designs/agency.ts` — **"Agency"** rebuilt as a **bold, colourful, playful** composition (warm
  off-white canvas, coral→orange gradient, very rounded shapes, collage hero, colour feature cards, emoji), a
  genuinely different LOOK from dark Pulse/Studio — not a recolour. ($10, id still `agency`.)
- `src/data/designs/index.ts`: Agency is `PUBLISHED`. Only teaser left: **Orbit** (minimal futuristic).
- **NOTE:** future designs should lean on `variant`/`mockup` for layout distinctiveness, not just tokens. Add
  new variants to the shared renderer as needed. **NEXT design:** Orbit.

### 2026-07-24 — Super-admin design pricing + first-purchase promos (v0.2.111)
- **Design prices are now super-admin-settable, with per-design first-purchase promos** (base prices still live
  in each package's `meta.price` as the default). No migration — stored in `platform_settings` under key
  `design_pricing` = `{ [designId]: { price?, promoActive, promoPrice?, promoLabel? } }`.
- `src/lib/design/pricing.ts` (NEW) — `DesignPricingEntry`/`DesignPricingMap` + `effectivePrice(base, entry,
  {firstPurchase})` (override price + promo applied to a buyer's FIRST design on a panel, i.e. `owned.length===0`).
- `actions/platform-settings.ts` — `getDesignPricing()` (public-safe read) + `setDesignPricing(id, entry)`
  (super-admin, sanitised, upsert).
- `buyDesign` now charges the **effective price** (override + first-purchase promo), not `meta.price`.
- **UI `src/components/superadmin/DesignPricingAdmin.tsx` (NEW)** — per-design price + promo toggle/price/label,
  **cached** (session+local, paints instantly then background-syncs, like BlogReview). Mounted in BOTH surfaces:
  the `/superadmin` route (new **Design pricing** tab) and the **owner-app super-admin sidebar** (new
  "Design pricing" section, super-admin only).
- Design Shop reflects it: cover badge / buy button show the overridden price and, for a first-time buyer,
  the promo price + label; the balance gate uses the effective price. The in-studio `DesignLibraryPanel` also
  loads `getDesignPricing()` and shows the effective/promo price on its buy button + balance gate (v0.2.112).
  Also fixed a duplicate `Tag` lucide import in `panels/index.tsx` that broke the build (v0.2.112).

### 2026-07-24 — Design #2 "Studio" published (v0.2.110)
- **Second marketplace design shipped, one-at-a-time as intended.** `src/data/designs/studio.ts` (NEW) —
  **"Studio"** ($12, dark creator-economy): near-black cinematic canvas, cyan/indigo accent, editorial serif
  headlines, a **creator-analytics hero card** (mini growth bar-chart + follower/view/revenue tiles), glowing
  service cards, creator/agency testimonials. A different composition from Pulse, not a recolour.
- **New hero mockup in the shared renderer:** `DesignRenderer` now draws `mockup: "dashboard-card"` (the
  analytics card) alongside `"phone-feed"` — reusable by future designs. `"dashboard-card"` was already a valid
  schema value.
- `src/data/designs/index.ts`: Studio moved from `COMING_SOON_DESIGNS` → `PUBLISHED_DESIGNS` (buyable + full
  live preview). Remaining teasers: **Agency** (clean corporate) and **Orbit** (minimal futuristic).
- **NEXT designs:** Agency → Orbit, one finished at a time. Visual editor Phase 2 + dashboard editor deferred
  until the Automator (subscribe flow) launches.

### 2026-07-24 — Hide Business-gated design tools from non-subscribers (v0.2.109)
- **Design Tools are now HIDDEN, not upsold, for owners without Business.** Since there's no self-serve
  subscribe yet (it ships with the Automator / Campaign Automation Phase 2 — only a super admin can comp a plan
  today), the Design Studio loads `getDashboardDesign().hasDesignTools` and only renders the **Dashboard world
  toggle** and the **Visual editor** card when entitled; a non-entitled user is forced to the Landing world.
  The internal upsells in `DashboardLayoutBuilder`/`VisualEditor` remain as defensive fallbacks but are now
  unreachable for normal owners.

### 2026-07-24 — Visual editor (Phase 1): config-driven landing builder (v0.2.108)
- **First slice of the Shopify/Webflow-style visual editor**, built on the SAME schema + `DesignRenderer` the
  marketplace uses (an owner-built design is just another config the renderer reads). Business-gated
  (`hasDesignTools`). No migration — state in `panels.settings.design.editor` = `{ draft, published }`.
- `src/lib/design/editor.ts` (NEW) — `EditorDesign` (`{ tokens, page }`), `EDITOR_DEFAULT_TOKENS` (neutral dark
  starter palette), `makeSection(kind)` factories + `starterDesign()` (a complete starting landing),
  `readEditorState(settings)`, and **`editorToPackage(design, name)`** → wraps the config as a `DesignPackage`
  so the shared renderer draws it.
- `actions/design.ts` — `getCustomDesign` / `saveCustomDesignDraft` / `publishCustomDesign` /
  `unpublishCustomDesign` / `resetCustomDesign` (owner-auth + Business gate; publish snapshots draft→published,
  audit-logged).
- `src/components/panels/admin/VisualEditor.tsx` (NEW) — full-screen editor: **layers/sections panel**
  (select / reorder / delete), an **approved component library** ("Add" → hero/stats/services/platforms/steps/
  features/testimonials/faq/cta/content/functional), a **per-section settings panel** (edit copy; services
  price toggle), **global colours** (accent/bg tokens), desktop/tablet/mobile **live canvas** via
  `DesignRenderer`, and Save draft / Publish / Unpublish / Reset. Opened from a new "Visual editor" card in the
  Design Studio's Landing world. Non-Business owners see a locked upsell.
- **Live on the storefront:** `getPublicPanel` now returns `customDesign` (the published `EditorDesign`);
  `app/p/[subdomain]/page.tsx` renders it for guests via `editorToPackage` when no marketplace design is active
  (precedence: marketplace design > editor design > default). The signed-in dashboard themes from its tokens too.
- **Phase 1 limits (next):** per-item editing for list sections (steps/features/testimonials/faq), drag-drop,
  undo/redo/revisions, nav/header/footer editing, more per-section settings (variant/animation), and
  responsive per-breakpoint controls. Functional blocks already stay backend-wired via the renderer's slots.

### 2026-07-24 — Blog UI paints from cache (no wait for the super-admin check) (v0.2.107)
- **The Blog nav item, Blog section and bell draft-notices were missing until `amSuperAdmin()` resolved** —
  `isSuper` started `false` with no cache, so blog surfaces popped in late (unlike the rest of the app, which
  paints from `readOwnerAppCache`). Now `isSuper` initialises from `readOwnerAppCache("is-super")` and writes
  back when the check resolves, so blog UI shows immediately on reload and re-verifies in the background.
  `BlogReview` already caches its drafts/topics, so the content fills from cache too.

### 2026-07-24 — Design Studio: Landing / Dashboard "worlds" (v0.2.106)
- **The Design Studio now has two worlds** switched by a top-bar toggle (Landing · Dashboard), instead of
  stacking the dashboard preview under the landing. `world` state in `DesignStudio.tsx`:
  - **Landing** — identity, landing copy, ad sections, colour themes, Design Shop controls + the landing
    preview (active design via `DesignRenderer`, or the default).
  - **Dashboard** — the `DashboardLayoutBuilder` controls + a focused customer-dashboard preview (header +
    `DashboardHomePreview`) whose palette follows the active design (`designToThemeVars`) or the colour theme.
  Each world shows only its own controls + its own preview. No data/logic change — purely the studio's editing UX.

### 2026-07-24 — Fix: schedule bill-addons cron; order-sync job missing too (v0.2.105)
- **`cron.job` showed ONLY `innvil-generate-blog`** — `innvil-bill-addons` and `innvil-order-sync-every-10-min`
  were not scheduled (add-on/plan billing + order-status sync silently never ran). Added
  **`0027_supabase_bill_addons_cron.sql`** (`trigger_bill_addons()` → `/api/cron/bill-addons?secret=…`, daily
  06:00 UTC) mirroring 0015/0026. **Order-sync has `0015` but its job is absent** — re-run 0015's
  `select cron.schedule('innvil-order-sync-every-10-min', …)` (the migration is idempotent) to restore it.
  All three crons share the vault `app_url`/`cron_secret`.

### 2026-07-24 — Fix: blog auto-generation was never scheduled (v0.2.104)
- **Root cause of "no auto blogs":** the daily blog-draft cron existed only as a COMMENT in the route file — no
  migration ever scheduled it (unlike order-sync, which has `0015`). So the endpoint worked when hit manually
  but was never called. Added **`0026_supabase_blog_cron.sql`** mirroring `0015`: `trigger_blog_generation()`
  (vault `app_url` + `cron_secret`, `net.http_get` → `/api/cron/generate-blog?secret=…`, 120s timeout) +
  `cron.schedule('innvil-generate-blog','0 9 * * *', …)`, with an unschedule-if-exists guard. **Run migration
  0026**; needs vault `app_url`/`cron_secret` (same as order-sync) + `ANTHROPIC_API_KEY`.
- The manual "generate now" inserts exactly one draft (`generateDraftNow` → single `insertDraft`); "2 at once"
  was most likely a double-submit/retry of the slow AI request or the cron firing alongside it — not a loop.

### 2026-07-24 — Fix: Design Studio preview ignored the colour theme (v0.2.103)
- **The live storefront already recoloured a bought design from the free theme (v0.2.99), but the Design Studio
  PREVIEW didn't** — it passed `personalization={accent}` only, never `tokenOverrides`, so picking a theme in the
  studio left the preview locked to the design's shipped palette (the "black-pink gradient"). Now the studio
  preview passes `tokenOverrides={themeToDesignTokens(v.theme, v.accent)}`, so changing the colour theme
  recolours the design live in the preview — matching what the storefront renders. Caption updated to say the
  theme recolours the design (layout/type/animation stay the designer's).

### 2026-07-24 — Customer dashboard themed from the active design (v0.2.102)
- **A signed-in customer's dashboard now picks up the active design's palette** (was still the default Innvil
  look even with a design applied). New **`designToThemeVars(tokens, overrides)`** in `theme-bridge.ts` — the
  REVERSE of `themeToDesignTokens`: maps the design's `--d-*` tokens onto the `fp-*` CSS vars the existing
  dashboard uses (surfaces, text, accent + `color-mix` accent tints). `app/p/[subdomain]/page.tsx` wraps the
  signed-in storefront in `designToThemeVars(designPkg.tokens, themeToDesignTokens(theme, accent))` when a design
  is active, else the panel's colour theme. **Colours only — no dashboard layout/markup/order/wallet changes**;
  a free colour theme still recolours the design first (same precedence as the landing).
- Guests already got the design landing; this closes the last "default UI with a design active" gap.

### 2026-07-24 — Themed signup page from the active design (v0.2.101)
- **The signup page now wears the panel's purchased design** — same pattern as login (v0.2.98). `SignUpClient`
  gained an **`embedded`** mode (form only, inputs/buttons styled from `--d-*` design tokens; form markup shared
  between both modes) and host-aware links via `storefrontBaseFromLocation` (no more hardcoded `/p/<sub>`).
  `app/p/[subdomain]/signup/page.tsx` checks `panel.activeDesign`; if the package has a `signup` page it renders
  the design via the shared `DesignRenderer` (catalog-derived stats, panel `hrefs`, `themeToDesignTokens`
  overrides) and **injects the real signup form into the `auth-card` slot** — auth logic stays outside the
  design. No design ⇒ the default page wrapped in `themeVars`.
- **TODO (next):** the customer DASHBOARD still renders the default Innvil UI even with a design active — theme
  it from the active design's tokens (order/wallet logic untouched).

### 2026-07-24 — White-label fix: storefront auth pages leaked Innvil branding (v0.2.100)
- **The real "still points to Innvil" bug was METADATA, not links.** The storefront auth pages had **no
  `generateMetadata`**, so they inherited the root layout's Innvil title + favicon — a customer on
  `…/p/<sub>/login` saw a tab reading *"Innvil — The White-label SMM Panel Builder"*. Only the landing had
  per-panel metadata.
- Added `generateMetadata` (panel name title, panel favicon, `noindex`, OG `siteName` = panel) to
  **login, signup, forgot-password and reset-password**. Auth pages are now fully white-label.
- Also added `storefrontBaseFromLocation(subdomain)` to `src/lib/config.ts` — the CLIENT counterpart of
  `storefrontBase()` — so client components stop hardcoding `/p/<sub>` (still to be applied to
  `SignUpClient`/`ForgotPasswordClient`/`ResetPasswordClient`).

### 2026-07-24 — Free themes recolour bought designs + host-aware storefront links (v0.2.99)
- **FIX (log-in link went to Innvil):** storefront links hardcoded `/p/<sub>/…`. On a PANEL host (subdomain,
  custom domain, `sub.localhost`) the proxy already rewrites `/` to that panel, so the prefix sent the visitor
  back through the proxy onto Innvil. New **`src/lib/storefront-host.ts` `storefrontBase(subdomain)`** (server,
  header-based) returns `/p/<sub>` on the app host and `""` on a panel host; used by the landing + login pages.
  `LoginClient` does the same check client-side for its own links/redirect.
- **Free colour themes now apply to PURCHASED designs** (they were locked to the design's shipped palette).
  New **`src/lib/design/theme-bridge.ts` `themeToDesignTokens(themeId, accent)`** maps the `fp-*` theme vars onto
  the design's `--d-*` colour tokens (and drops the design's decorative backdrop, which is palette-specific).
  `DesignRenderer` gained **`tokenOverrides`**; the landing + login pass the panel's theme/accent. **Colours
  only** — layout, typography, radii, shadows and animation stay the designer's, which is what keeps designs
  distinct.
- **TODO (next):** signup page (mirror the login pattern — Pulse's `signup` page already exists) and the customer
  DASHBOARD picking up the active design's tokens.

### 2026-07-24 — Themed auth pages + "Back to dashboard" fix (v0.2.98)
- **The login page now uses the panel's purchased design.** Pulse gained **`login` + `signup` page schemas**
  (design chrome + hero + a `functional: auth-card` slot). `app/p/[subdomain]/login/page.tsx` checks
  `panel.activeDesign`; if that package has a `login` page it renders the design via the shared
  `DesignRenderer` (real catalog-derived stats, panel `hrefs`) and **injects the real login form into the
  `auth-card` slot** — so authentication logic stays entirely outside the design package. No design ⇒ the
  default themed page (now wrapped in `themeVars` so it respects the panel's colour theme).
- `LoginClient` gained an **`embedded`** mode: form only, inputs/buttons styled from the design tokens
  (`--d-*`), used when injected into a design's auth slot. The form markup is shared between both modes.
- **FIX:** the marketing header's **"Back to dashboard"** did nothing — it was a client `<Link href="/">`, so
  Next's router cache could serve the stale signed-out landing. Now a plain `<a>` (full navigation).
- **TODO (next):** the signup page still renders the default UI — mirror this pattern with `SignUpClient`
  `embedded` + the design's `signup` page (already defined in Pulse).

### 2026-07-24 — Design activation fixes: storefront login route + live design preview (v0.2.97)
- **FIX (404 on login):** a purchased design's "Log in" CTA pointed at `/p/<sub>/login`, which **didn't exist** —
  the default storefront logs in inline on its landing card, so the route was never created. Added
  **`app/p/[subdomain]/login/`** (`page.tsx` + `LoginClient.tsx`), mirroring the existing signup page and using
  `customerSignIn`; links to forgot-password + signup, redirects to `/p/<sub>` on success.
- **FIX (Design Studio preview was hardcoded):** the studio's landing preview always drew the default Innvil
  hero. It now loads the panel's active design (`getDesignLibrary`) and renders the **real design** via the
  shared `DesignRenderer` (inert, demo content, live name/logo/accent) when one is applied; otherwise the default
  preview. `DesignLibraryPanel` gained `onChanged` so buying/activating/deactivating refreshes the preview
  immediately. Caption now states which design is shown.

### 2026-07-24 — Design Shop scope correction + preview placement (v0.2.96)
- **CORRECTION to v0.2.90.** The three "premium templates" (aurora/carbon/luxe) are just CSS-var color
  themes — that is explicitly **NOT** the paid Design Shop. They're now labeled **"More color themes ·
  included"** (free). Do not sell color presets, font presets, dashboard skins, static screenshots, small
  preview cards, summarized previews, or one shared layout recolored as the paid product.
- **The real Design Shop (per the user's full spec — see memory `innvil-design-shop-vision`):**
  1. **Config-driven visual interface editor (Business sub)** — Shopify/Webflow-class, for the panel's
     FRONTEND only: canvas w/ desktop/tablet/mobile, layers panel, approved SMM component library,
     grid/section/column drag-drop (not raw absolute positioning), per-component settings, global design
     tokens, component variants (order form, service list, balance card, stats, tables, header, nav),
     non-functional content sections, page-level editing (dashboard/services/orders/add-funds/tickets/auth),
     nav editing, undo/redo/autosave/revisions/draft/publish/revert/duplicate/import/export, responsive
     controls, **safe constraints** (can't delete/break backend-connected components), and a **renderer**
     that reads the config and renders the SAME existing functionality. Backend/DB/API/orders/payments
     are never touched — functional components stay wired to their current actions.
  2. **Marketplace of complete one-time-purchase landing designs** — each a full design PACKAGE (page/section
     schemas, component variants, tokens, responsive rules, animation defs, original/licensed artwork, fonts,
     default+preview content, version/compatibility metadata), materially different from the others
     (SMM visual language: likes/views/followers/creator profiles/growth charts/feeds). Bought once → the
     owner's design library forever (activate/deactivate/switch/customize permitted settings). Marketplace
     metadata + filters per spec. **Every design needs a FULL live preview** — the real landing rendered with
     demo content via the SAME renderer/config (not a mockup), with responsive/scroll/hover/animation, optional
     pre-purchase personalization (name/logo/color/categories/mode), and export/activation guarded until bought.
  3. **Sanitized "bring your own HTML"** → included in the **Business** subscription (with the editor).
- **Architecture backbone:** the editor and marketplace designs SHARE ONE config-driven renderer (a purchased
  design is just a config the renderer reads). Build order: schema + renderer → editor UI → marketplace +
  full-preview environment. Large multi-phase effort; deliver incrementally.
- Also this release: the **dashboard-layout live preview moved into the Design Studio's preview column,
  directly below the landing preview** (was awkwardly in the side controls). `DashboardHomePreview` is now an
  exported component; `DashboardLayoutBuilder` reports its working layout up via `onLayoutChange`.
- **Design Shop foundation started (vertical slice: build the backbone THROUGH one finished design).**
  - `src/lib/design/schema.ts` (NEW) — the shared config contract for BOTH the marketplace and the future
    visual editor: `DesignTokens` (+ `tokensToCssVars`), typed sections (`hero` w/ engagement floats + phone
    mockup, `stats` w/ `source:"live"`, `services`, `platforms`, `steps`, `features`, `testimonials`, `faq`,
    `cta`, `content`, and **`functional`** — a constrained slot (`auth-card`/`service-list`/`payment-methods`)
    so a design can PLACE real components without owning their logic), per-section `variant`/`animation`/
    `responsive`/token overrides, `DesignPage` (header/sections/footer), `DesignMeta` (price, categories,
    includedPages, features, version, changelog, publisher, status, cover), `DesignPackage` (+ demo `preview`
    content), and preview-only `PreviewPersonalization`/`personalizeTokens`.
  - `src/data/designs/pulse.ts` (NEW) — **design #1 "Pulse"** ($29, social-growth/animated): gradient backdrop,
    floating like/view/follower/notify cards, phone-feed hero mockup, count-up stats, glow service cards,
    testimonials, FAQ, glass auth slot. A complete landing composition, not a palette.
  - `src/data/designs/index.ts` (NEW) — catalog: `PUBLISHED_DESIGNS` (Pulse) + `COMING_SOON_DESIGNS` teasers
    (**Studio** dark creator-economy, **Agency** clean corporate, **Orbit** minimal futuristic — each a
    genuinely different composition). **Ship one design at a time**: a design only becomes `published`
    (buyable + fully previewable) when finished; others are metadata-only "Available soon" cards.
  - **`src/components/design/DesignRenderer.tsx` (NEW)** — the ONE shared renderer used by both the live
    previews and (post-purchase) the real storefront landing, so a preview is never an approximation. Renders
    every section type + header/footer from config, tokens as CSS vars (`--d-*`), CSS-only animations
    (fade-up/float), `<details>` FAQ. **Functional sections render injected `slots`** (`auth-card` /
    `service-list` / `payment-methods`): the caller passes Innvil's real backend-wired components, so this file
    never touches auth/order/payment logic; with no slot it draws a demo visual (used by previews).
    `inert` mode disables navigation for previews.
  - **`/design-shop`** (`app/design-shop/page.tsx` + `src/components/design/DesignShop.tsx`) — marketplace:
    cover, price, tagline, categories, page count, version, responsive/animated flags, features, category
    filters. Published → **Live preview**; teasers → "In the studio / Available soon". Buy buttons are
    intentionally disabled until the purchase+library layer lands.
  - **`/design-preview/[id]`** (`app/design-preview/[id]/page.tsx` + `DesignPreviewShell.tsx`) — the FULL live
    preview: real render via the shared renderer with the package's demo content, working desktop/tablet/mobile
    widths, and temporary **personalization** (panel name / logo / accent) that never installs or unlocks
    anything. `noindex`; teaser ids get an "in the studio" notice.
  - **PRICING:** max **$12** one-time per design, with a real ladder — Pulse $12, Studio $12, Agency $10,
    Orbit $7.
  - **PURCHASE LOOP CLOSED (same release).** `src/lib/design/library.ts` (NEW) reads
    `panels.settings.addons.design` → `{ owned[], active }` (an `active` design must still be owned — guards
    tampering). `actions/design.ts` gained `getDesignLibrary` / **`buyDesign`** (one-time charge from the
    panel's Innvil balance, rejects duplicates/unpublished/insufficient funds, audit-logged) / **`activateDesign`**
    (must own it; `null` = back to the default landing). Purchases are PERMANENT — switching or deactivating
    never revokes a design.
  - **Live on the real storefront:** `getPublicPanel` now returns `activeDesign`, and `app/p/[subdomain]/page.tsx`
    renders the purchased design **for guests only** (signed-in customers always get the real dashboard) using
    the SAME `DesignRenderer` with the panel's live catalog, currency and logo. The renderer gained a `hrefs`
    prop (via a small `HrefContext`) so CTAs point at **this panel's** `/p/<sub>/signup|login` — never Innvil's
    owner auth — and the `auth-card` slot is filled with a real signup/login card.
  - Owner UI: `DesignLibraryPanel.tsx` (NEW) in the Design Studio's Design Shop section — buy / activate /
    switch / preview, with the panel's balance shown; "Innvil default landing" is always an option.
  - **NEXT:** designs #2–#4 one finished at a time (Studio → Agency → Orbit), then the visual editor on this
    same schema; later, per-design editable text/permitted settings.

### 2026-07-24 — Design Shop Phase A: dashboard layout builder (v0.2.91)
- **Design Tools = bundled into Business** (not a separate charge). `hasDesignTools(settings)` = Business tier
  (`src/lib/plans.ts`). Premium landing templates stay à-la-carte (Phase B).
- **Customer-dashboard layout builder** — a Business owner rearranges/show-hides the dashboard HOME widgets
  (stats, favorites, recently-ordered, recent-orders) with built-in controls. **No code; order/wallet logic
  untouched.** Config in `panels.settings.dashboard.home`; unset ⇒ default layout unchanged. No migration.
- `src/lib/dashboard-layout.ts` (NEW): `DashboardWidget`, `DEFAULT_DASHBOARD_HOME`, `readDashboardHome`
  (repairs/appends missing widgets), `normalizeDashboardHome`, labels. `src/lib/actions/design.ts` (NEW):
  `getDashboardDesign`/`setDashboardHome`/`resetDashboardHome` (owner-auth + Business gate).
- `CustomerDashboard` home is now config-driven (IIFE renders widgets in the saved order/visibility; default
  path identical to before). Threaded `dashboardLayout` through `getPublicPanel` → page → `Storefront` →
  dashboard. **Render gated on `hasDesignTools`** so a downgrade reverts customers to default.
- UI `src/components/panels/admin/DashboardLayoutBuilder.tsx` (show/hide + up/down reorder + reset + a **live
  mini-preview** of the customer dashboard home that updates as you edit), mounted as a new **"Dashboard layout"**
  section in the Design Studio (upsell card when not on Business). NOTE: this targets the panel's CUSTOMER
  dashboard (top-nav + mobile hamburger — no sidebar), never the Innvil owner app. NEXT iteration: owner custom
  content blocks on the dashboard + nav-style options (top-tabs vs always-hamburger).
- **Plans aren't sold to owners yet** (Campaign Automation feature is Phase 2) — owner surfaces say "coming
  soon." A **super admin can COMP a plan** per panel to test the Business-gated features: `setPanelPlan(tier)`
  in `superadmin.ts` (no charge, `nextChargeAt=null` so the cron skips it, audit-logged) + a **Plan** select
  (Free/Pro/Business) in the `/superadmin` Panels table (`SuperAdminPanelVM.planTier`).
- **Phase B next (dep installed):** premium landing templates (buy once, own forever) + sanitized custom-HTML
  landing editor (`sanitize-html`), gated by Design Tools / one-time purchase.

### 2026-07-24 — Design Shop: premium templates (v0.2.90)
- **First slice of the Design Shop.** Added a `premium` + `note` flag to `ThemeDef` and three real premium
  templates in `src/data/themes.ts` — **Aurora** (gradient glass, teal→violet), **Carbon Pro** (ultra-dark,
  cyan), **Luxe** (editorial ivory + gold, a light theme). They apply like any theme (CSS-var overrides on the
  storefront root, so they restyle landing + customer dashboard). No dep, no migration.
- `DesignStudio.tsx`: split themes into `FREE_THEMES` / `PREMIUM_THEMES`; the old locked "coming soon" premium
  placeholders are now the real premium templates (click to apply). (Icon `Lock`→`Gem`.)
- **Next (needs `npm install sanitize-html @types/sanitize-html`):** sanitized custom-HTML landing sections —
  owners paste HTML, server-sanitizes (allowlist tags/attrs, strip all JS/handlers) before rendering on the
  storefront. Chosen approach = sanitized inline blocks (safe on a customer-facing page). Then: richer section
  builder (reorder, more block types) + Design-Shop pricing/gating.

### 2026-07-24 — Campaign Automation: subscription foundation (Phase 1) (v0.2.89)
- **First half of "Campaign Automation"** (renamed from "Automator") — the paid, monthly subscription that
  will unlock a customer-facing bulk "Campaign" ordering surface on the storefront. Per-panel, owner-subscribed,
  billed from the panel's Innvil balance (reuses the AI add-on charge/settle pattern). **No migration** (state in
  `panels.settings.addons.plan`). **Backend only this phase — no live subscribe UI yet** (won't sell it until the
  Phase 2 feature exists so owners aren't charged for nothing).
- Plans: **Innvil Pro $9.99/mo** (Campaign Automation, ≤250 links, saved profiles, background processing) and
  **Innvil Business $19.99/mo** (unlimited links, file import, **bundles the AI Support add-on**, priority).
  Prices in `money.ts` (`INNVIL_PRO_PRICE`/`INNVIL_BUSINESS_PRICE`/`PLAN_PERIOD_DAYS`/`planPrice`).
- `src/lib/plans.ts` (NEW): `readPlan`/`planTier`/`hasCampaignAutomation`/`hasFileImport`/`campaignLinkLimit`/
  `planBundlesSupport`. `src/lib/ai/addon.ts` `customerSupportActive` now also true on Business (the bundle).
- `src/lib/actions/plan.ts` (NEW): `getPlan`/`setPlan(tier|null)` — subscribe/switch charges the tier price from
  Innvil balance now (rejects if short), sets `nextChargeAt` +30d, audit-logged; Business subscribe disables any
  separate `ai_support` sub to avoid double-billing; cancel flips it off. `src/lib/billing/plans.ts` `billDuePlans`
  swept by the `bill-addons` cron (now runs support + plan sweeps). Lapse (low balance) → tier=null + lapsed=true.
- Renamed the PanelAdmin "Automation" tab → **"Campaign Automation"** (its subscribe UI + the feature land in Phase 2).
- **Phase 2 next:** migration (`campaigns`, `automation_profiles`), smart link detection, platform auto-detect,
  fan-out ordering via `placeOrder` (customer wallet), the storefront campaign surface, and the owner subscribe UI.

### 2026-07-24 — Streaming AI replies + floating owner assistant (v0.2.88)
- **Streaming built but currently OFF (proxy doesn't support SSE).** `aiStream()` in `src/lib/ai/client.ts`
  (SSE→plain-text) + routes `app/api/ai/{assistant,support}` (reuse `prepareOwnerAssistant`/`prepareGlobalAssistant`
  /`prepareCustomerSupport`) exist, BUT the aiprimetech proxy in use doesn't stream, so the widgets were reverted
  to the reliable **non-streaming server actions** (`customerSupportReply`, `ownerAssistantReply`,
  `globalAssistantReply`). The streaming routes/`aiStream` are retained, unused, ready to re-enable behind a
  streaming-capable provider (Anthropic direct / OpenRouter). Also kept: 60s fetch timeout (`postJson`),
  `try/finally` composer reset, trimmed caps (owner 600 / support 500 tokens).
- **Floating owner assistant (global)** — the free owner assistant is a **floating chat** (bottom-right,
  `Bot` launcher) mounted at the **owner-app shell level** (`InnvilApp` in `panels/index.tsx`), so it's on
  **every** section of the owner dashboard, not just inside a panel. It's **account-level**: `prepareGlobalAssistant`
  grounds it in Innvil how-to (`OWNER_KB`) + a summary of ALL the owner's panels (status/balance/commission).
  The route `/api/ai/assistant` takes an OPTIONAL `panelId` (present → panel-scoped `prepareOwnerAssistant`;
  absent → global). `OwnerAssistantChat.tsx` always renders (no config gate). The **AI Assistant tab**
  (`OwnerAssistant.tsx`) is just the **Customer AI Support add-on** toggle/card + a note pointing at the floating button.
- No migration.

### 2026-07-24 — AI monetization corrected: owner assistant FREE, customer support PAID (v0.2.87)
- **Fixes the model (v0.2.85–86 had it backwards).** Two independent AI features:
  - **Owner → Innvil assistant** (owners asking how to run their panel / reach Innvil): **FREE, always on,
    Innvil-funded.** `ownerAssistantReply` now gates only on ownership + `aiConfigured` (no subscription).
  - **Storefront customer AI support** (AI chat for the panel's CUSTOMERS): **PAID $2.99/mo add-on** the OWNER
    enables + pays (from the panel's Innvil balance). The billing/subscription machinery moved here.
- `src/lib/ai/addon.ts` rewritten: `readSupportSub` + `customerSupportActive(settings)` = the paid `ai_support`
  subscription is active (OFF by default now; on when the owner subscribes or a super admin comps it). Removed
  the old always-on default + the `ai_assistant` state helpers.
- `src/lib/actions/ai-assistant.ts`: `ownerAssistantReply` (free) + **`getSupportAddon`/`setSupportAddon`**
  (enable charges `AI_ADDON_PRICE` from the panel's Innvil balance, sets `addons.ai_support` sub, audit-logged;
  disable flips it off). `money.ts` `AI_ASSISTANT_PRICE`→**`AI_ADDON_PRICE`** (2.99). Billing sweep
  `billDueSupportAddons` (`src/lib/billing/assistant.ts`) now bills `ai_support`; cron `bill-addons` unchanged.
- UI `OwnerAssistant.tsx` (AI Assistant tab): free owner chat on top + a **Customer AI Support** add-on card
  (subscribe/cancel, balance check, "panel stays 0% rent"). Storefront chat (`SupportChat`) now shows only when
  the owner's paid add-on is active (`aiSupport` = `customerSupportActive`). Super-admin Panels toggle = a
  comp/override (caption "owner add-on · comp"). No migration.

### 2026-07-24 — Customer AI support is now always-on & Innvil-funded (v0.2.86)
- **Reversal of the v0.2.84 paid-gate:** the customer-facing AI support chat (storefront "contact support")
  is now **ON for every panel by default**, on Innvil's cost — a platform feature, not a per-panel paid add-on.
  It is independent of the owner AI Assistant ($2.99 add-on); enabling the owner assistant does NOT toggle the
  storefront chat and vice-versa.
- New `customerSupportActive(settings)` (`src/lib/ai/addon.ts`): ON unless a super admin explicitly disables it
  (`addons.ai_support.enabled === false`) — an emergency off-switch (e.g. abuse), not a purchase gate. Wired
  into `getPublicPanel` (storefront mounts the widget for all panels), `customerSupportReply` (gate), and the
  super-admin Panels toggle (now labeled "on by default"; `setPanelAiAddon(false)` = disable). No migration.
- **Cost note / TODO:** always-on + free means Innvil eats the API usage; recommend adding a per-customer daily
  message cap to bound cost (needs a small counter/table — not built yet).

### 2026-07-24 — Owner AI Assistant add-on (paid, $2.99/mo per panel) (v0.2.85)
- **Second AI surface: the owner-facing assistant.** A paid, opt-in, per-panel add-on that helps the OWNER
  run this panel (connect a provider, import/price services, go live, payments, commission, statuses…),
  grounded in Innvil how-to knowledge (`OWNER_KB`) + the panel's live stats (status, Innvil balance,
  commission rate, providers/services/orders/customers counts). The panel itself stays 0% rent — this is
  strictly opt-in.
- **Billing: $2.99/mo from the panel's Innvil balance** (`AI_ASSISTANT_PRICE` in `money.ts`). Enabling charges
  the first month immediately and sets next-charge +30d; a daily cron re-charges due subscriptions and
  **pauses** the add-on (enabled=false, lapsed=true) when a panel can't cover it. State lives in
  `panels.settings.addons.ai_assistant` (`readAiAssistant` in `src/lib/ai/addon.ts`) — **no migration**.
- Files: `src/lib/actions/ai-assistant.ts` (`getPanelAssistant`/`setPanelAssistant` [owner-auth + ownership,
  charge/refund-free disable, audit-logged]/`ownerAssistantReply` [gated + grounded]); billing sweep
  `src/lib/billing/assistant.ts` (`billDueAssistants`); cron `app/api/cron/bill-addons` (CRON_SECRET-gated,
  **schedule via Supabase pg_cron**, daily). UI: `src/components/panels/admin/OwnerAssistant.tsx` (offer card
  when off → Enable; inline chat + "renews …"/Cancel when on), mounted as a new **"AI Assistant"** tab in
  `PanelAdmin`. Uses the same shared AI client, so a third-party Claude key works too.
- **Schedule the pg_cron `innvil-bill-addons` job** (SQL in the route file); set the AI key. No migration.

### 2026-07-24 — AI chat support (customer) + AI integration + blog review in owner app (v0.2.84)
- **Shared AI client** `src/lib/ai/client.ts` (server-only): one Anthropic entry point (`aiComplete`,
  `aiConfigured`, `DEFAULT_AI_MODEL`) used by every AI feature. **`ANTHROPIC_API_KEY`** required; optional
  `AI_MODEL` global default. The blog writer was refactored onto it (single integration to maintain).
- **Customer-facing AI support chat (paid add-on).** Gated by `panels.settings.addons.ai_support.enabled`
  (`src/lib/ai/addon.ts`). `src/lib/actions/ai-support.ts` `customerSupportReply` answers grounded in a
  built-in how-it-works FAQ (`SUPPORT_FAQ`, zero owner config) + THIS panel's catalog + the signed-in
  customer's own balance/recent orders + deposit methods + any custom landing blocks the owner wrote
  (`settings.branding.sections`), with a HARD privacy rule (never given/never reveals provider identity,
  provider cost, floors, markup, or commission).
  `escalateSupportToTicket` opens a real ticket (reuses `createTicket`). UI = floating `SupportChat.tsx`
  mounted in `CustomerDashboard` when the add-on is on; `aiSupport` threaded PublicPanel → page → Storefront →
  dashboard. **Super admin enables it per panel** in `/superadmin → Panels` (new AI-support toggle;
  `setPanelAiAddon`, audit-logged).
- **Super admin = a panel-owner account role-flagged `super_admin` in Supabase — same owner app.** So blog
  review now lives in the **owner-app sidebar** (super-admin-only "Blog" item → `BlogReview`), not only at
  `/superadmin`. The blog review UI was extracted to `src/components/superadmin/BlogReview.tsx` (shared by
  both). New-draft **notifications go to the in-app bell** (`listBlogDraftNotices` → badge + list in
  `AppTopbar`, tap → Blog section). AI (cron) drafts also best-effort email super admins (bonus).
- **Still pending:** the OWNER-facing AI assistant (second surface) — see CLAUDE_PROGRESS. No migration
  (uses `panels.settings`). Set `ANTHROPIC_API_KEY`.

### 2026-07-23 — AI blog autopilot: draft → human-approve → publish (v0.2.83)
- **AI writes blog drafts on a daily schedule; a super admin reviews and publishes.** Deliberately
  gated (not auto-publish) — daily unreviewed AI content risks Google's "scaled content abuse" penalty,
  which could demote the whole domain. Nothing goes live without a human clicking Publish.
- **Migration `0025_blog_ai.sql`** — `blog_posts` (DB-backed posts: slug/title/description/tag/keywords/
  intro/sections jsonb/cta/related/status draft|published|archived/source ai|manual/topic/published_at) +
  `blog_topics` (curated topic queue) + RLS (public reads published; super admin manages).
- **Writer** `src/lib/ai/blog-writer.ts` (server-only): prompts Claude (**`ANTHROPIC_API_KEY`**, optional
  `BLOG_AI_MODEL`, default `claude-sonnet-5`) for a strict-JSON article matching the block model, hard-
  validates it, and is constrained to VERIFIED product facts (no invented features/stats). Always a draft.
- **Read layer** `src/lib/blog/data.ts` merges the 3 static cornerstone guides (`src/data/blog-posts.ts`,
  still code) with published DB rows (static wins on slug); resilient (empty/unreachable DB → static only).
  Blog index/[slug]/sitemap now read this + use ISR (`revalidate = 3600`) so approved posts appear without a
  redeploy. Renderer extracted to `src/components/blog/ArticleBody.tsx` (shared by the article page + admin
  preview).
- **Generation** `src/lib/blog/generate.ts` (queue → fallback topic pool → generate → insert draft; marks
  topic used). **Cron** `app/api/cron/generate-blog` (CRON_SECRET-gated) — **schedule via Supabase pg_cron**,
  daily, e.g. `select cron.schedule('innvil-generate-blog','0 9 * * *', $$ ... net.http_post(url, Bearer CRON_SECRET) $$)`.
- **Super admin → new "Blog" tab** (`SuperAdminDashboard.tsx` `BlogTab` + `src/lib/actions/blog-admin.ts`):
  generate-now (optional topic), drafts-to-review with full preview + light edit (title/desc/slug/tag/keywords)
  + Publish/Delete, published list (Unpublish/Delete), and the topic queue (add/delete). **Run migration `0025`;
  set `ANTHROPIC_API_KEY`; schedule the pg_cron job.**

### 2026-07-23 — Blog / guides content surface for SEO (v0.2.82)
- **New `/blog` content surface** so the SEO foundation has indexable long-tail articles to rank.
  All SSR, no new deps, no migration. `src/data/blog-posts.ts` is the single source of truth (typed
  block model → clean semantic HTML; helpers `allPosts`/`getPost`/`relatedPosts`) and ships 3 cornerstone
  guides: **how-to-start-an-smm-panel**, **white-label-smm-panel-vs-smm-panel-script**,
  **how-much-does-an-smm-panel-cost** (genuinely useful, cross-linked, CTA to /signup).
- `app/blog/page.tsx` = index (own canonical/OG metadata, Blog + ItemList JSON-LD). `app/blog/[slug]/page.tsx`
  = article (`generateStaticParams` prebuilds all 3, per-post `generateMetadata` with canonical + OG
  `article`, BlogPosting JSON-LD, `**bold**` inline renderer, related-post links, `notFound()` for unknown
  slugs). New server-safe `src/components/marketing/SiteChrome.tsx` (`MarketingHeader`/`MarketingFooter`)
  gives the blog the landing chrome; a **"Guides" → /blog** link was added to both it and the landing TopNav.
  `app/sitemap.ts` now lists /blog + every post. `robots.ts` already allows /blog.

### 2026-07-23 — SEO keyword copy pass on the landing (v0.2.81)
- Copy-only pass so the SSR/metadata foundation (v0.2.75–0.2.80) has keyword-aligned content to rank.
  In `PublicLanding.tsx`: hero intro now names "the no-code **SMM panel builder** — a modern alternative
  to buying an **SMM panel script**"; #how H2 → **"How to start your own SMM panel."**; #platform →
  "SMM panel features" / "Everything to run your SMM panel"; #why → "…rented **SMM panel**"; #pricing
  eyebrow → "SMM panel pricing"; #faq H2 → "SMM panel questions, answered." No structure/logic change.
- `app/layout.tsx`: added high-intent keywords (how to start an smm panel, start your own smm panel,
  smm panel builder, smm panel script alternative). Title/description + FAQ were already tuned. No migration.

### 2026-07-23 — Extract PublicLanding into its own module (SSR/perf) (v0.2.80)
- **The server-rendered marketing landing no longer ships the whole owner-app bundle.** `PublicLanding`
  (+ its private `TopNav`) moved OUT of the big `"use client"` barrel `src/components/panels/index.tsx`
  and INTO a standalone module **`src/components/panels/PublicLanding.tsx`**. `app/page.tsx` (server
  component, the crawlable homepage) previously imported it from the barrel — which also exports
  `InnvilApp`/`AuthScreen`/`SuperAdmin` — pulling the entire owner app into the landing's module graph.
- Importers repointed to `@/src/components/panels/PublicLanding` (`app/page.tsx`, `app/PreviewSwitcher.tsx`);
  `app/HomeClient.tsx` unchanged (already `dynamic(..., {ssr:false})` for `InnvilApp`). Trimmed the
  now-unused landing imports from `index.tsx`. Landing markup/copy identical; better Core Web Vitals on
  the primary SEO page. No migration.

### 2026-07-20 — Auto provider top-up tracker + drop "Providers (all panels)" (v0.2.78)
- **Auto-detected top-ups (internal, not manual, not a new API call).** `fetchProviderBalance`
  (`providers.ts`) reads the prior stored balance before updating; if the live balance is HIGHER (same
  currency, not the first observation) it records the increase as a provider top-up in `provider_topups`
  (migration `0023`). Pre-Innvil balances are the baseline (never counted) — a growth/lock-in record.
- **Refund-aware (migration `0024`, Option A + review).** Provider-side refunds also raise the balance,
  so the sync now queues each order's estimated provider refund in `providers.pending_refund_credit`
  (`bump_provider_refund_credit`, in the terminal-refund block using `provider_cost × fraction`). The
  next balance increase **nets that out first** — only the leftover is logged as a top-up. If the
  increase overlapped a refund it's marked `needs_review`, and the tracker shows an inline **"Is this a
  refund?"** prompt; tagging it refund (`provider_topups.kind='refund'` via `setProviderTopupKind`)
  **excludes it from the totals and the CSV**. Every entry can also be re-tagged/deleted. (Replaced the
  earlier "$5 burst" idea — that broke bonused top-ups.)
- **Provider balances page → adds a "Top-up tracker"** (`OwnerProviderBalances` in `OwnerSections.tsx`):
  period toggle **Weekly / Bi-weekly / Monthly** (weekly default), per-period totals grouped by currency
  + per-provider breakdown, a **CSV download** (internal cost record, not an official receipt), and a
  "Recorded top-ups" list with per-entry delete. Actions in `src/lib/actions/provider-topups.ts`
  (`listProviderTopups`/`deleteProviderTopup`; auto-insert lives in `fetchProviderBalance`).
- **Removed "Providers (all panels)"** from the owner sidebar (per user — the balance tracker replaces
  it and is on-theme). `OwnerProviders` component left defined but unused. **Run migration `0023`.**

### 2026-07-20 — Provider balance tracker (sidebar) (v0.2.77)
- New owner sidebar item **"Provider balances"** (`OwnerProviderBalances` in `OwnerSections.tsx`, icon
  `PiggyBank`) — a dedicated, balance-first view of every connected provider so the owner can see how much
  they've funded on the provider side. Summary stat cards (Providers · Needs top-up · Low balance · Healthy),
  a **"Total funded"** card that sums balances **grouped by currency** (providers can bill in different
  currencies), and a per-provider list (balance, Low/Top-up badge, last-synced, per-row + "Refresh all").
  Reuses `listAllOwnerProviders` + `fetchProviderBalance` + the existing `LOW_BALANCE_THRESHOLD` (10) and the
  shared `readOwnerCache("providers")` cache. Complements the existing management table ("Providers (all
  panels)"). No migration.

### 2026-07-20 — Owner dashboard home: real stats (v0.2.76)
- The owner **Dashboard home** was mostly hardcoded ($0.00 stat cards, a mock RevenueChart, "Panels
  created" the only real number). Now data-driven from `getOwnerBillingSummary` + `listAllOwnerOrders(8)`:
  stat cards = **Panels (live/total) · Revenue today · Orders today · Innvil balance**; a **Recent orders**
  card (real, "View all" → Orders section, needs new `goOrders` prop) + a **Today** card (profit today,
  commission charged, orders today, live panels); each "Your panels" tile shows its **real revenue today**
  (from `perPanel`) instead of the always-$0 `ordersToday`. Cached via readOwnerAppCache for instant paint.
  Dropped the mock RevenueChart from the home (still used by the deprecated SuperAdmin mock). No migration.

### 2026-07-20 — SEO foundation: SSR landing + metadata + structured data (v0.2.75)
- **Biggest fix — the marketing landing is now server-rendered (crawlable).** `app/page.tsx` was a
  client-only `ssr:false` shell (empty HTML to crawlers). It's now a **server component**: signed-out
  visitors get `<PublicLanding />` SSR'd; signed-in users + the `?preview=1` switcher render via a new
  client island **`app/HomeClient.tsx`** (dynamic `ssr:false` `InnvilApp`/`PreviewSwitcher`). Auth is at
  real routes (`/login`,`/signup`), so `setWorld` was vestigial on the landing — made optional. Logout
  now `await signOutAction()` **then** `setWorld` (→ `router.refresh()`) so the server re-render sees no session.
- **Metadata** (`app/layout.tsx`): added `metadataBase`, `applicationName`, `robots`, Twitter card, OG
  `siteName`. **Removed the global `canonical`/OG `url`** (they'd leak the Innvil apex onto white-label
  storefronts); homepage sets its own `canonical:"/"` in `app/page.tsx`. **No title template** (same reason).
- **Structured data** (`app/JsonLd.tsx`, server): Organization + WebSite + SoftwareApplication + **FAQPage**,
  the FAQ built from the shared **`src/data/landing-faq.ts`** (single source of truth — PublicLanding renders
  the same array, required for valid FAQ rich results).
- **`app/robots.ts` + `app/sitemap.ts`** (disallow /superadmin,/api,reset/forgot; sitemap = marketing pages;
  storefronts self-manage SEO on their own domains).
- **Storefront metadata** (`app/p/[subdomain]/page.tsx`): white-label OG (panel's own name/description, never
  Innvil), `noindex` for draft/suspended/maintenance.
- Also added the **"Refresh & resend held orders"** feature card to the landing #platform grid (the v0.2.73
  differentiator). **`metadataBase` uses `NEXT_PUBLIC_APP_URL`** — set it to the real prod origin.
- **Top-up bonus tiers on the landing (data-driven):** new public `getPublicTopupTiers()` (platform-payments.ts)
  reads `platform_topup_discount_defaults` (crypto category, else richest) → `app/page.tsx` passes them to
  `PublicLanding` (`topupTiers` prop) → a **"Fund more, get more"** tier grid in #pricing (up to +N% bonus
  credit). Hidden when no tiers are configured, so it always reflects the super-admin's current setup.

### 2026-07-20 — Remove every remaining Sparkles icon (v0.2.74)
- Completed the v0.2.71 default-logo work: **all remaining `Sparkles` icons are now the Ledgerline
  gauge (`Gauge`)**. Fixed the last three inline usages — storefront "Other" platform-tab glyph, the
  main-landing hero Pill icon, and the "Open full Design Studio" button. Zero `Sparkles` left in
  `src/` + `app/`. Inline icons use `Gauge` directly; logo placeholders use `DefaultLogo`. No migration.
- TODO: add the v0.2.73 **"Refresh & Resend"** feature (held provider-balance orders auto-resend after a
  top-up) to the landing-page ad as a differentiator.

### 2026-07-20 — Receipt: business-registration upload + OCR + manual details (v0.2.72)
- The earnings receipt's business header was hardcoded (`BUSINESS_INFO`). Now it's **per-owner,
  editable, and OCR-assisted**. New `owner_business_profiles` table (migration `0022`) + actions
  `getBusinessProfile`/`saveBusinessProfile` (`src/lib/actions/business-profile.ts`).
- `ReceiptCard.tsx`: a collapsible **"Business details"** editor (legal name, address, registrant,
  business/registration no., tax id, email, phone) — fully manual entry. **Upload a registration
  document** (image) → **client-side OCR via `tesseract.js`** (dynamic import) pre-fills the blank
  fields (heuristics in `parseBusinessText`; never clobbers typed values) + shows the raw scanned
  text. The **document is NOT stored** — only the details the owner saves. PDF now renders only the
  fields that are set (skips empties).
- **Run migration `0022_owner_business_profile.sql`** and **`npm install`** (adds `tesseract.js`).
  OCR is best-effort/image-based; manual entry is the reliable path.

### 2026-07-20 — Default logo = Ledgerline gauge (drop the AI-tell sparkle) (v0.2.71)
- The generic `Sparkles`-in-a-square placeholder used for panels/customers without a logo reads as an
  AI-generated default (an easy "made with AI" tell). Replaced it everywhere with a deliberate secondary
  brand asset: **`DefaultLogo`** (`src/components/ui/BrandMark.tsx`) — the original **Ledgerline gauge**
  ("meter") glyph (lucide `Gauge`) in a gold rounded square. This is the canonical global default/
  placeholder logo.
- Swapped in: storefront header (`Storefront.tsx`), customer dashboard + landing, the three storefront
  auth pages (signup/forgot/reset), and both DesignStudio live-preview logos. Left as-is: the "Other"
  platform-category glyph and the Design-Studio button icon (not brand placeholders). Removed now-unused
  `Sparkles` imports. No migration.

### 2026-07-20 — Commission reversal on refund (v0.2.70)
- Refunding a **completed** order (whose 5% was already settled off `innvil_balance`) now **gives the
  commission back**. New `reverse_order_commission(order, fraction)` (migration `0021`) credits the
  proportional commission to `innvil_balance` and reduces `orders.commission_amount` (so "commission
  charged" reflects the net take). No-ops when nothing was settled (order never completed).
- Wired into both refund paths: owner manual `refundOrder` (`admin-orders.ts`, fraction = refund/charge)
  and the sync engine's completed→terminal refund transition (`src/lib/orders/sync.ts`, same fraction).
  Held/failed refunds don't call it (those orders were never completed → no commission).

### 2026-07-20 — Commission volume discounts + $100/day cap (v0.2.69)
- **Marketing hook to pull socpanel renters: "5% isn't forever."** Per-panel commission can be
  discounted down to **1%** as a panel scales, and Innvil never takes more than **$100/panel/day**.
- **Internal brackets** (guideline for support + future AI), by completed orders/day:
  1k → 4% · 2.5k → 3% · 5k → 2% · 10k → 1% (`commissionBracketRate` in `src/lib/money.ts` +
  `INNVIL_MIN_COMMISSION_RATE` 0.01, `INNVIL_COMMISSION_CAP_PER_DAY` 100).
- **Settlement (migration `0020_commission_brackets.sql`):** `settle_order_commission()` now reads the
  panel's `settings.commission_rate` (default 5%) and enforces the **$100/panel/day cap** via new
  `orders.commission_settled_at` (once the day's cap is hit, further completions settle at $0). Same
  signature — sync.ts unchanged.
- **Super admin:** `/superadmin → Panels` gains a **Commission** column — current rate, a set control
  (clamped 1–5%), and each panel's orders-today with the suggested bracket. `setPanelCommissionRate`
  (audit-logged) in `superadmin.ts`; `SuperAdminPanelVM` now carries `commissionRate` + `ordersToday`.
- **Owner Billing** note + **landing** updated: by-the-numbers tile "5% → 1%", a volume-discount
  bracket strip in #pricing, and a new "Does the commission drop as I grow?" FAQ. Owners doing
  1,000+ orders/day are told to contact support for a lower rate.
- NOTE: the Billing "Commission today (est.)" still estimates at a flat 5% (per-panel rate + cap are
  applied at settlement; "Commission charged" is the real figure).

### 2026-07-20 — Owner → Innvil support contact (v0.2.68)
- Panel owners can now **contact Innvil support**. New owner sidebar item **"Contact support"**
  (`OwnerContactSupport` in `OwnerSections.tsx`): a subject+message form plus their own past
  messages with open/resolved status. Distinct from the owner↔customer "Support inbox".
- **Delivery:** `sendOwnerSupportMessage` (`src/lib/actions/platform-support.ts`) stores the
  message in the new `platform_support_messages` table AND best-effort emails support (reply-to =
  owner) via Resend. Destination = `platform_settings.support_email` if set, else the
  **super-admin account email(s)** (resolved via `auth.admin.getUserById`).
- **Super admin:** new **Support** tab in `/superadmin` — sets the support destination email
  (`get/setSupportEmail` in `platform-settings.ts`), lists all owner messages with sender/date,
  "Reply by email" (mailto), and mark resolved / reopen (`setPlatformSupportStatus`).
- **Role split in the owner sidebar** (`navItemsFor(isSuper)`): the super-admin account (Innvil owner)
  sees **"Panel Support"** — `OwnerPanelSupport`, the same owner-message inbox — instead of "Contact
  support" (they ARE support). Every non-super-admin owner keeps **"Contact support"**.
- **Run migration `0019_platform_support.sql`.** Email needs `RESEND_API_KEY` (best-effort; the
  in-app super-admin list always works regardless).

### 2026-07-20 — Live-to-preview: unfunded Live runs as Inactive (v0.2.66)
- Reversed the hard block from v0.2.65: owners can **always click Live** now. With **no Innvil
  balance the server runs it in preview** — `updatePanelStatus` sets the panel `inactive` (browsable,
  no orders) + flags `innvil_suspended`, so a later top-up auto-activates it to fully live. Funding a
  flagged panel while going live clears the flag. It now returns `{ ok, status (effective), note }` so
  the UI reflects the Live→Inactive downgrade; a `live_preview_no_credit` audit reason shows in Status
  History as "Preview — add funds to accept orders".
- `StatusDropdown` `settable` is back to `[draft, live, maintenance]` (Live no longer balance-gated);
  `inactive`/`suspended` stay shown-but-locked with `lockedNote`. My Panels shows the returned note;
  the Status-tab hint reworded to "set Live to preview, runs Inactive until funded".
- **Landing ad:** commission section + the activation FAQ now sell "build and preview your live
  storefront for free — only fund a panel when you're ready to take orders."
- No migration.

### 2026-07-20 — Activation gate: Live needs funds; lock inactive/suspended (v0.2.65)
- **Going Live now requires a funded Innvil balance** ("activating" a panel = funding it).
  `updatePanelStatus` rejects `live` when `innvil_balance <= 0` (was only blocking the
  already-suspended case). `toPanel` now exposes `innvilBalance` on the `Panel` view-model
  (from settings), so the UI can gate too.
- **Owners set only draft / live / maintenance.** `OWNER_SETTABLE` dropped `inactive` (it's
  applied automatically when credit runs out) — `inactive` + `suspended` are now **shown but
  locked** (greyed, Lock icon, unclickable) in `StatusDropdown` via a new `settable` prop
  (replaces the old `options` filter) + `lockedNote`. When unfunded, **Live is also locked**
  with "Add funds to activate…". StatusTab shows an activation hint card when unfunded; both
  My Panels and the Status tab pass `settable` computed from the panel's balance.
- **Landing:** moved the "$10 to activate" detail OUT of the #pricing wheel (now 5% / $0 / ∞
  panels) and INTO a new **FAQ** entry "How do I activate my panel and take it live?".
- No migration.

### 2026-07-20 — Status polish: real Status History (v0.2.64)
- The panel Status tab's **Status History** card was hardcoded mock ("2 hours ago / Yesterday /
  3 days ago"). Now REAL: every status change writes a `panel.status_changed` event to `audit_logs`
  — from `updatePanelStatus` (owner, meta by:owner), the sync auto-inactive (by:system,
  reason:innvil_out_of_credit), the top-up `reactivatePanelIfFunded` + super-admin `adjustPanelBalance`
  (reason:innvil_topup). `getPanelStatusHistory(panelId)` (panels.ts) reads them newest-first + appends
  a synthesized "Panel created" baseline from `panels.created_at` (so it's never empty; infers creation
  status from the oldest log's `from`). `StatusTab` now takes `panelId`, fetches on mount + re-fetches
  ~800ms after a change, and renders real relative times (`relTime`: just now / Xm / Xh / yesterday /
  Xd / date) with the absolute time on hover. Also restricted the tab's StatusDropdown to the four
  owner-settable statuses (matches My Panels). No migration (uses existing `audit_logs`).

### 2026-07-20 — MVP polish: Billing shows real commission charged (v0.2.63)
- Owner **Billing** now reflects the live commission settlement (which shipped v0.2.56 but the UI still
  said "coming soon"). `getOwnerBillingSummary` (`admin-orders.ts`) gained `commissionCharged` (lifetime
  sum of `orders.commission_amount`, total + per-panel; degrades to 0 if 0017 isn't applied). UI
  (`OwnerSections.tsx OwnerBilling`): badge "Auto-billing coming soon" → **"Auto-billing active"**; new
  **"Commission charged"** stat next to "Commission today (est.)"; note rewritten to explain estimate vs
  actually-deducted + the out-of-credit pause; per-panel row shows both today + charged. Roadmap #2 item.

### 2026-07-20 — Main landing pass: commission wheel + trust band + FAQ (v0.2.62)
- Landing page pass (roadmap #1), modeled on socpanel/prm4u/worldofsmm. Added to `PublicLanding`
  (`src/components/panels/index.tsx`): (1) an honest **"by the numbers" band** below the hero
  (5% · $0 rent · ∞ panels · Minutes) — NOT fabricated usage stats, since Innvil is pre-launch;
  (2) rebuilt **#pricing** into "The fairest commission in SMM" with an inline-SVG **commission
  donut** (You keep 95% / Innvil 5% completed-only) + the three real numbers (5% completed-only,
  $10 activate/$5 min, $0 rent/setup) + legend; (3) a **#faq** accordion (8 Q&As: what/how/pricing/
  provider/domain/multi-panel/payments/privacy-boundary) + FAQ nav anchor.
- No new deps (donut is hand-rolled SVG), no migration. FAQ copy is written to double as SEO
  structured-data source for roadmap #3.

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

### Phase 4.M: Innvil Virtual Moderator — Natural Chatter & Community Moderation Refinement ((A) DONE v1.1.84, (B)–(F) NOTED)

> Telegram-based AI community moderator add-on. Foundation already built and live in
> this branch: Managed Bot provisioning (BotFather-token fallback + Telegram Managed
> Bots deep-link flow), the free 7-day trial entitlement system, Connect Community +
> `ModeratorDeployment`, Innvil Moderator Acknowledgement (bounded bot-to-bot ack
> between Innvil moderators sharing a community, loop-proofed via `origin`/
> `interactionDepth`, verified live end-to-end incl. the loop-safety fix, v1.1.80),
> and Reactive Natural Chatter (replies to human chat) — confirmed working live
> end-to-end. Architecture: Telegram adapter → `CommunityEvent` → Community
> Coordinator (`src/lib/moderator/coordinator.ts` / `chatter-coordinator.ts`) →
> `CommunityAction` → Telegram adapter, orchestrated in `community-runtime.ts`.
> `docs/moderator/natural-chatter-refinement-spec.md` is the verbatim source-of-truth
> spec (57 sections); implement (B)–(F) FROM that file, not from this summary. Scope
> is tightly bounded to 6 things:
> - **(A) Reactive response selection/pacing — DONE (final form: v1.1.97).**
>   **Natural Chatter uses contextual social action selection. It does NOT use flat
>   response percentages anywhere.** `selectChatterAction()` (`chatter-coordinator.ts`)
>   takes no RNG parameter and contains no `Math.random()`; the earlier
>   probability models (v1.1.84's LOW/MEDIUM/HIGH/VERY_HIGH → 0%/35%/85%/100% bands,
>   and v1.1.96's opener signal that still fed them) were **removed outright** —
>   repo-wide greps for `selectChatterResponder`/`ENGAGE_PROBABILITY`/
>   `PROBABILITY_GATE`/`ChatterPriority`/`priorityBand` return nothing.
>   The Coordinator classifies the message (EMPTY / TOO_SHORT / COMMUNITY_OPENER /
>   TRIVIAL / QUESTION / SUBSTANTIVE) + room state and returns exactly one
>   first-class action: **`SILENCE` · `REACT` · `SHORT_ACK` · `CASUAL_CHAT` ·
>   `ANSWER`** (`COMMUNITY_HANDOFF` stays a bot-to-bot concept in `coordinator.ts`;
>   a HUMAN message never routes to it). **Silence is contextual, never a lost
>   roll** — every SILENCE carries reasons (`already_handled`, `trivial_low_value`,
>   `no_eligible_moderator`, `low_social_priority`, `already_handled_recent_reply`,
>   …). **Cost:** SILENCE/REACT/SHORT_ACK make **zero** AI calls (REACT is a real
>   Telegram reaction; SHORT_ACK is a deterministic phrase from `shortAckText()`);
>   only CASUAL_CHAT/ANSWER reach Sonnet 5, each with its own action-specific
>   prompt. The action union structurally carries exactly ONE `deploymentId`, so N
>   moderators can never produce N generations. **Randomness now exists in exactly
>   one place** — `shortAckText()` picking which canned phrase to use: it varies
>   *wording*, never *whether* a moderator acts and never *who* (selection is
>   deterministic: explicit mention → active-exchange continuity → quietest
>   longest). **Multi-moderator (§15) — DONE (v1.1.85).** `findChatterDeployment`
>   (singular, `.limit(1)`) → `findChatterDeployments` (plural); also fixed a real
>   pre-existing bug where pacing was read AFTER streaks were reset, making the
>   dominating-conversation safeguard unreachable. **Conversational continuity
>   (v1.1.95):** `wasLastSpeaker` keeps whoever's mid-exchange answering, instead of
>   a different moderator jumping in as if it were the subject. **Moderator
>   handoff + closing tone (v1.1.98):** live-caught a second bug in the same
>   family — one moderator (Kwan) answered six messages straight, fabricating
>   "it's just me around" while a second deployed moderator (Test) sat idle, even
>   answering FOR Test after an explicit `@test1_mod_bot` mention, then tacked
>   "anything else on your mind?" onto a plain "I see, okay." `invitesOtherModerator()`
>   detects generic handoff requests ("any other moderator who can respond here?",
>   "anyone else?") and EXCLUDES the currently-speaking candidate from selection
>   (not merely deprioritizes it) when 2+ moderators are deployed. Fixed the same
>   directed-vs-continuity ordering bug in the `SUBSTANTIVE` branch specifically
>   (it checked `wasLastSpeaker` before `isDirectedAtBot`) so an explicit mention of
>   a different, non-speaking moderator now correctly wins for plain statements too,
>   not just questions. `CLOSING_ACK_RE` folds "I see, okay." / "got it" / "alright"
>   / "fair enough" into `TRIVIAL` regardless of word count (they were 3+ words,
>   missing the existing `isTrivial` heuristic entirely) — right after a moderator
>   reply these now resolve to `SILENCE`, not another reply. Generation prompts gained
>   `otherActiveModeratorNames` (the real, current deployment list — a moderator can
>   only reference another's presence/absence grounded in this fact, never invented)
>   plus an explicit single-identity rule and a ban on generic support-chat closers.
>   **Plain-name targeting, history grounding, persona isolation (v1.1.99):** three
>   more live-caught bugs. (1) A moderator addressed by its plain configured name
>   ("what persona are you kwan?", no @mention) went unanswered until the human
>   typed `@kwan_mod_bot` explicitly — `messageIsDirectedAtBot` only checked
>   @username and Telegram reply-to, never the moderator's own name. New pure
>   `resolveDirectedModerator()` (`chatter-coordinator.ts`) resolves @username,
>   reply-to, exact plain name, or a typo-tolerant near-spelling ("knaw"/"kwna" for
>   "Kwan") — word-boundary-safe (tokenized, so "Ann" is never triggered by
>   "announcement") and ambiguity-safe (2+ equally-plausible name matches resolve
>   to no directed target, never a guess). Typo tolerance uses an anagram/
>   transposition check rather than raw edit distance — short names like "Test"
>   are distance-1 from real words ("rest"/"best"/"west"), which would otherwise
>   false-positive; an exact letter-for-letter anagram of a specific configured
>   name is a much safer signal. (2) Kwan invented "was just responding to Test's
>   message first" to explain a message it simply wasn't selected for — added an
>   explicit grounding rule: never invent reasons for your own silence or claims
>   about another moderator's actions; give a neutral answer instead. (3) Moderator
>   voices were bleeding into each other (one picked up the other's lowercase/
>   terse style over a long conversation) — root cause was two-fold:
>   `personaStyle()` never read the `formality`/`slang`/`teasing` persona fields
>   at all (now it does), and the transcript labeled messages by name only, with
>   no signal distinguishing "your own past messages" from "a different
>   moderator's" — now explicitly labeled `(you)` vs `(a different moderator, not
>   you)`, plus an explicit anti-imitation rule ("do not imitate their voice...").
>   New `chatter-generate.test.ts` asserts all of this against the actual
>   assembled prompt strings, not live model output.
>   **Upbeat closings react instead of replying + style-drift-under-questioning fix
>   (v1.2.0):** two more live-caught bugs from the same conversation. (1) "okay,
>   perfect!" (2 words, 14 chars) got a full `CASUAL_CHAT` text reply instead of a
>   reaction — it exceeded the old 12-char `isTrivial` cap so it fell through to
>   `SUBSTANTIVE`, where continuity picked it up as a real message worth
>   continuing. Widened the cap to 16 chars and added `POSITIVE_WORD_RE`
>   (perfect/awesome/amazing/excellent/fantastic/sweet/"love it"/"nice one"/great)
>   checked inside the `TRIVIAL` branch, before the directed/ambient split — an
>   upbeat short closing now always resolves to `REACT` (❤️ for "love", 😄
>   otherwise via `positiveReactionFor()`), never a new sentence back, matching how
>   a human moderator would actually react to "perfect!". A plain neutral closing
>   with no positive word ("got it") still resolves to `SILENCE` as before — only
>   genuinely upbeat closings get a reaction. (2) Kwan's writing flipped from
>   initial-caps to all-lowercase immediately after a human asked "why are you so
>   formal though, kwan?" — the model was treating the question about its tone as
>   an instruction to change it. `personaStyle()`'s formality lines are now more
>   mechanical/imperative ("Always capitalize the start of your sentences... this
>   is a fixed habit of how you write, not something you adjust message to
>   message" / "Always write in lowercase... fixed habit..."), and a new
>   `SHARED_RULES` entry explicitly states writing style is FIXED by configuration
>   and does not change in response to being asked about it — the moderator can
>   still answer the question honestly, it just keeps writing in its own normal
>   style while doing so. New regression tests in both `chatter-coordinator.test.ts`
>   (upbeat-closing → REACT, neutral-closing → SILENCE, ambient upbeat still
>   reacts) and `chatter-generate.test.ts` (prompt asserts the fixed-style rule is
>   present).
>   **Positive-closing detection decoupled from the character cap (v1.2.1):**
>   the v1.2.0 fix widened `isTrivial`'s character cap 12→16 to catch "okay,
>   perfect!", but that's the same fragile-heuristic class of bug — a slightly
>   longer 2-word closing using longer words ("that's fantastic!", 17 chars)
>   would still fall through it. New `isPositiveClosing()` bounds by WORD COUNT
>   only (≤4 words containing a `POSITIVE_WORD_RE` hit), independent of
>   `isTrivial`'s character cap, and is OR'd into `classifyMessageKind`'s
>   `TRIVIAL` branch alongside `isTrivial`/`CLOSING_ACK_RE` — the same pattern
>   already used for `CLOSING_ACK_RE` in v1.1.98. A genuinely longer sentence
>   that happens to mention a positive word mid-paragraph (5+ words) still
>   stays `SUBSTANTIVE`. New tests cover both the longer-words case and the
>   mid-paragraph non-closing case.
>   **TRIVIAL/closing acknowledgement detection is now intent-based rather than
>   gated by an arbitrary small character limit (v1.3.0):** longer acknowledgements
>   can resolve to REACT/SILENCE, while acknowledgement + new substantive content
>   still routes normally. Live bug: after a moderator's joke, "prettyaccurate too.
>   lol" (3 words, 23 chars — over every length cap tried so far, including the
>   v1.2.0/v1.2.1 widenings) generated a full follow-up reply instead of reacting
>   or staying silent, because length/word-count was the classification gate.
>   New `isAcknowledgementOnly()` replaces it with a semantic check: hard
>   exclusions first (ends with "?", a contrast/continuation marker "but/however/
>   though/although/except/still/also", a request marker "can/could/would you" /
>   "please", or — critically — a negative-state/problem word matched by STEM,
>   not exact word-boundary regex, so "failure" is caught the same as "failed";
>   deliberately over-inclusive since a false trigger just means a real reply
>   instead of a reaction, never the reverse). Only past those gates does it
>   tokenize, require at least one recognized ack/laugh/thanks/agreement signal,
>   and tolerate a SMALL residual of otherwise-unclassifiable leftover words
>   (≤2) as a weak fallback signal, not the decisive one — a single leftover
>   token is never assumed safe by tolerance alone (a bare "broken"/"down"/
>   "error" residual is excluded by the explicit vocabulary regardless of
>   count). A dedicated `isKnownConcatenation()` word-break check recognizes a
>   glued-together closing like "prettyaccurate" ("pretty"+"accurate") as
>   recognized content without resorting to blanket tolerance. Existing
>   `isTrivial`/`CLOSING_ACK_RE`/`isPositiveClosing` length-bounded checks are
>   kept as fast-path additions (harmless redundancy for short cases), but the
>   new semantic check is what actually resolves anything longer. Adversarial
>   tests added specifically for the single-residual-token risk the fix targets
>   ("yeah lol broken", "haha okay it's failed", "yeah lol down", "lol yeah
>   error", "yeah lol total failure" catching the "failure"-vs-"fail" regex gap)
>   plus a long fabricated-topic message that merely opens with an ack word,
>   confirming none are silently swallowed. 245 tests pass, zero regressions to
>   plain-name targeting, @username/reply targeting, directed-over-continuity
>   priority, persona isolation, history grounding, deterministic selection, or
>   bot-loop protections.
>   **Still not covered by (A):** the quota-aware/business-knowledge-aware signals
>   from §11 that depend on (B) or Phase 4.N; durable per-moderator memory (there is
>   no durable moderator-memory system at all yet — Phase 4.N remains NOTED/not
>   built — so there's nothing to isolate until that exists).
> - **(B) Trial reactive quota = 20/day** (successful sends only, per community per
>   local community day, checked before AI generation) — separate from the existing
>   2/day proactive quota; moderation enforcement never consumes or is blocked by it.
> - **(C) Intelligent external-link moderation** — links classified by intent, not
>   domain (`SAFE_RELEVANT_LINK` / `COLLABORATION_REQUEST` / `AMA_REQUEST` /
>   `PARTNERSHIP_REQUEST` / `UNSOLICITED_PROMOTION` / `LINK_SPAM_OR_FLOOD` /
>   `PHISHING_OR_SCAM` / `EXPLICIT_CONTENT` / `UNKNOWN_OR_AMBIGUOUS`); works with no
>   mention needed.
> - **(D) Spam vs. legitimate-follow-up distinction** — a ~30-minute window governs
>   only the RAPID-FLOOD interpretation, never a moderation-history reset; a
>   legitimate AMA/collab follow-up after 30 min is a fresh evaluation, but a
>   repeated ad after 30 min still escalates the same warning count.
> - **(E) Natural (non-robotic) warning escalation** — persona-voiced warnings, 3
>   strikes → kick/ban for ordinary unsolicited promotion, immediate ban for
>   high-confidence explicit content, scoped per tenant+community+Telegram user.
> - **(F) Configurable collab/AMA contact routing** — new community-level setting
>   (same UX pattern as the existing bot-ack toggle) letting the owner name who
>   partnership/AMA/collab inquiries get routed to; never hardcode a username, never
>   invent one if unset, and this routing is conversational only — never an
>   authorization grant.
> Explicitly OUT of scope for this patch: bot provisioning, managed-bot credentials,
> provider ordering, billing, trial duration, active mod slots, publishing, campaign
> generation, and any other unrelated moderation feature.

### Phase 4.N: Project Knowledge + AI Auto-Posting for Virtual Moderator (NOTED, not built)

> Extends Phase 4.M. Adds a shared, tenant-scoped **Project Knowledge Base** (project
> overview, website, whitepaper, docs, FAQs, roadmap, official links, brand voice,
> custom notes — via text/URL/file/structured-field inputs) that powers BOTH the
> Virtual Moderator's Q&A answers AND a new **AI Telegram Auto-Posting** capability —
> one shared retrieval layer, not two disconnected knowledge stores.
> **Full verbatim 41-section spec (source of truth, implement from it, not this
> summary):** `docs/moderator/project-knowledge-autoposting-spec.md`. Key invariants:
> - **Retrieval, not prompt-stuffing** — ingest → parse → chunk → index/embed →
>   retrieve relevant chunks only; reuse existing vector/search infra if present,
>   never resend a whole whitepaper per generation.
> - **Source-grounded, never fabricated** — auto-posts must not invent partnerships,
>   prices/APYs, listings, dates, audits, or stats unless backed by stored knowledge;
>   insufficient material → skip the slot, never hallucinate a post. Static docs are
>   never treated as proof of *current* time-sensitive facts (APY, live campaigns).
> - **Tenant + community isolation** — Project A knowledge never leaks into Project
>   B; base project knowledge is reusable across a moderator's communities, but
>   community-specific memory stays isolated per Community/ModeratorDeployment, and
>   casual community chatter never silently becomes authoritative Project Knowledge.
> - **Auto-posting is its own capability** — separate from proactive moderator speech
>   (GM/GN, dead-chat revival) and from the reactive/proactive quotas in Phase 4.M;
>   never publishes with `TELEGRAM_MANAGER_BOT_TOKEN` (control-plane only) — always
>   the subscriber's own managed-bot credential for that community/deployment.
> - **⚠️ No generic Innvil publishing bot — each Virtual Moderator IS the publisher**
>   (same-day correction, appended to the spec file as "AUTO-POSTING UPDATE",
>   read it before implementing scheduling/publishing). Subscribers configure a
>   **posting window per ModeratorDeployment, fully user-settable per moderator**
>   (e.g. Mika 05:00–12:00, Kaleb 13:00–17:00, Alex 18:00–22:00 — illustrative
>   examples only, never hardcoded defaults/bounds — all in the community's local
>   timezone); each window publishes **at most one post/local-day**, at a random
>   time that is
>   **generated once and persisted** (`AutoPostOccurrence`, unique on
>   `windowId + localDate`) — never re-rolled per cron tick. A missed window is
>   **skipped**, not caught up. Duplicate-content prevention is **community-wide
>   across all moderators**, not per-bot. Minimum spacing between two moderators'
>   near-simultaneous posts to avoid an unnatural cluster.
> - **Generation vs. publishing are separate steps** — scheduler → retrieval → AI
>   generation (close to execution time, not days ahead, so knowledge stays fresh)
>   → validation (length, no secrets/prompt-leakage, no duplicate content, correct
>   bot/community) → deterministic publish; idempotent per occurrence (one
>   successful Telegram post max, even on cron/publish retry — retry reuses the
>   SAME generated content, never regenerates a different post per attempt).
> - **Entitlement: OFF for the trial** — the 7-Day Full AI Mod Trial explicitly
>   excludes AI content generation/auto-posting; `autoPosting.enabled = false` for
>   trial via existing entitlement infra, never scattered `if (plan === ...)` checks
>   inside Telegram code.
> - **Task-based model routing** — Sonnet 5 at `medium` effort as the default for
>   blog generation, scheduled content, and substantive Q&A (not one reasoning level
>   for everything); simple chatter/reactions skip expensive reasoning entirely.
> Explicitly OUT of scope: Managed Bot provisioning, Manager Bot ownership model,
> order/provider systems, duplicate-order logic, billing/commission architecture,
> Natural Chatter's response-selection logic (unless shared retrieval requires it),
> and link moderation behavior.
> - **NOTED addition:** a second, community-scoped knowledge layer ("COMMUNITY-
>   SPECIFIC KNOWLEDGE" appended to the spec file) — facts belonging to one
>   specific `Community` (local rules/admins/FAQs), auto-available to every
>   moderator deployed there via the deployment→community link, isolated from
>   other communities and from the tenant-wide Project Knowledge above (though a
>   community-specific fact wins over a conflicting project-wide one). Depends on
>   the base Project Knowledge retrieval pipeline existing first — build the
>   shared retrieval layer with an explicit `PROJECT`/`COMMUNITY` scope field
>   from day one rather than retrofitting scoping later.

### Phase 4.N.1: Virtual Moderator entitlement correction — Active Mod Slots (v1.1.77)
- **Fixed the paid-tier capacity table** in `src/lib/moderator/plan.ts` — `standard` was
  `{maxCommunities:2, maxActiveSlots:6}`, now `{2, 5}`; `premium` was `{3, 12}`, now
  `{3, 10}`. `basic` `{1,2}` and `pro` `{5,20}` unchanged. Trial stays `{1,1}`.
- **Confirmed (not changed — already correct):** `connectCommunity`/`setDeploymentEnabled`
  in `src/lib/actions/moderator.ts` already count ACTIVE `moderator_deployments` rows for
  slot enforcement, never unique `VirtualModerator` rows — so reusing the same moderator
  persona across two communities already correctly consumes 2 Active Mod Slots (not 1),
  pausing a deployment already frees a slot, and reactivating one already re-checks
  current capacity. The entitlement *unit* was already right; only the table's numbers
  needed correcting. New tests in `plan.test.ts` pin the corrected per-tier values.

### Phase 4.O: Bot-to-Bot delivery correction + Telegram AI Moderator onboarding automation (NOTED, not built)

> **Live bot-ack delivery test (2026-08-08) failed** — a message sent directly through
> Kwan's bot token to the shared test community never reached Test's webhook (not in
> `community_messages`, no fresh delivery attempt in `getWebhookInfo`), despite both
> bots being confirmed admins in that chat. **Corrected diagnosis:** this is NOT a
> platform-level "bots can't see other bots' messages" block — Telegram officially
> supports **Bot-to-Bot Communication Mode**, a per-bot BotFather setting, independent
> of admin status and independent of Group Privacy Mode. The supported configuration
> for Innvil's bot-ack feature needs all three, set per participating bot: (1)
> Bot-to-Bot Communication Mode ON in @BotFather, (2) Group Privacy Mode OFF, (3) admin
> in the target chat. Changing Group Privacy Mode may require removing/re-adding the
> bot to the group for Telegram to apply it. **Do not modify bot-ack Coordinator/
> classification code until delivery is re-verified live with these Telegram-side
> settings actually configured** — the existing loop-prevention/classification
> architecture (`MAX_BOT_INTERACTION_DEPTH=1`, numeric-bot-ID classification, origin
> metadata) is believed correct; the blocker was Telegram-side configuration.
> **Full verbatim spec (source of truth):** `docs/moderator/telegram-bot-to-bot-onboarding-spec.md`.
>
> **Second, larger, NOTED-not-built piece in the same file:** automate the Telegram-side
> setup for deploying an AI Moderator, to the extent Telegram's official API actually
> allows — an official add-to-group deep link with suggested (least-privilege,
> feature-driven) admin rights the user confirms in Telegram itself; guided @BotFather
> steps for Bot-to-Bot Communication Mode + Group Privacy Mode when bot-ack is enabled
> (never faked/auto-configured — Telegram exposes no supported API for a manager bot to
> flip these on a managed bot, so this stays user-guided unless that changes); and
> **delivery-based verification** (`NOT_TESTED` → `READY_FOR_TEST` → `VERIFIED_BY_DELIVERY`
> / `FAILED` — never show "verified" just because the user clicked "done"). Bot-ack setup
> must never block the rest of a deployment (chatter/moderation/Q&A/auto-posting all work
> without it) and must never be forced on subscribers who don't want moderator-to-moderator
> interaction. `/start` (private + `startgroup` deep-link) is in scope as a setup/status
> touchpoint — never counted as chatter, never trusting Telegram username as identity,
> never disclosing tenant data to an unrelated user who sends `/start`.

### Phase 4.O.1: Virtual Moderator saved-moderator creation cap (v1.1.81)
- **Global ceiling on saved `VirtualModerator` records is now 5, tier-scaled below
  that** — `basic` 2, `standard`/`premium`/`pro` all 5 (was: only trial capped at 1,
  every paid tier was `Number.POSITIVE_INFINITY`/unlimited). Distinct from Active
  Mod Slots (Phase 4.N.1) — this caps how many personas can exist at all, not how
  many are simultaneously deployed. Enforcement (`createVirtualModerator` in
  `src/lib/actions/moderator.ts`) was already correct — counts `virtual_moderators`
  rows for the panel — only `moderatorMaxSavedModerators`'s per-tier table needed
  the real numbers. No-entitlement now correctly returns 0 (was silently unlimited).

### Phase 4.P: Bot-ack social behavior — Community Handoff + real Telegram Reactions (NOTED, not built)

> Refines the already-built, loop-fixed (v1.1.80) bot-ack feature. Two problems with
> today's hard "a BOT_ACK may never trigger anything else" rule: (1) it can cut a
> natural-feeling bot-to-bot exchange off abruptly instead of letting it resolve
> gracefully, and (2) `REACT` needs to mean an actual Telegram message reaction
> (`setMessageReaction`), never a standalone emoji text message.
> **Full verbatim spec:** `docs/moderator/bot-ack-social-behavior-spec.md`. Key points:
> - **New bounded action: `COMMUNITY_HANDOFF`** — depth 0 (root event) → depth 1
>   (optional `BOT_ACK`) → depth 2 (optional `COMMUNITY_HANDOFF`, community-facing
>   only, addressed to "anyone"/humans, never to the other bot by name) → hard STOP.
>   A `COMMUNITY_HANDOFF` must never itself trigger another bot's acknowledgement;
>   only a human reply restarts normal Coordinator logic. Silence is still a valid
>   outcome at every step — never force a handoff just because an exchange happened.
> - **`REACT` = real Telegram reaction, not a message.** Reactions are optional,
>   context-dependent (one moderator's answer may get 0 or 1 reaction from another
>   eligible moderator, never a stack of reactions from every deployed moderator),
>   must use only reactions Telegram's `available_reactions` actually allows for
>   that chat (never fall back to an emoji text message), target an explicit
>   message ID (never "the latest message"), and must never themselves start a new
>   bot-chain event. `SILENCE` is not a fallback state for "can't react" — it's
>   frequently the correct answer on its own (e.g. "ok"/"lol" from a human usually
>   gets nothing, bot or human).
> - **Separate quota** — bot-to-bot social usage (BOT_ACK + COMMUNITY_HANDOFF) and
>   reactions must not consume the Phase 4.M reactive (20/day) or proactive (2/day)
>   quotas; prefer a small dedicated bot-interaction allowance instead.
> - **3+ moderator clarification** (given informally, appended to the spec file): the
>   ack-then-redirect shape generalizes to N moderators — either several may take a
>   bounded turn before one redirects, or a later moderator may redirect directly
>   without first producing its own `BOT_ACK`. Don't hardcode new fixed-depth
>   arithmetic beyond what's in the spec; implement from the stated intent.
> - Only `INNVIL_MODERATOR`-classified senders (numeric bot ID + active deployment in
>   the same community) participate — `EXTERNAL_BOT` never gets this treatment.

### Phase 4.Q: `innvil_bot_manager` — Innvil's official product bot (NOTED, not built)

> **Explicit instruction: "Take note only, will implement this once the ai mods are
> fully intact."** A new Innvil-owned, platform-wide (not per-panel/tenant) Telegram
> bot with two separated modes: **proactive marketing** (approved-campaign broadcasts
> to stored, authorized destinations — never an unsupervised "cron asks LLM to invent
> a message and auto-sends") and **reactive Innvil product support** (answers human
> questions about Innvil/Moderator/plans/setup grounded in its OWN
> `INNVIL_PRODUCT_KNOWLEDGE` base, stays silent on everything else via a hard
> Coordinator-level scope classifier + confidence threshold — not just prompt text).
> **Full spec (source of truth):** `docs/moderator/innvil-bot-manager-spec.md`.
> **⚠️ Naming collision flagged in the spec:** this is a **different bot** from the
> existing control-plane-only Manager Bot (`TELEGRAM_MANAGER_BOT_TOKEN` in
> `src/lib/moderator/manager.ts`) — that one's whole-codebase invariant is that it
> NEVER posts customer/community-facing content. `innvil_bot_manager` must be its own
> separate credential; pick a non-colliding internal name (e.g. `INNVIL_OFFICIAL_BOT`)
> when implementing. Other key points: gets **priority over customer moderators** for
> Innvil-related questions in a shared group (they suppress/stay silent rather than
> all answering); its marketing broadcasts carry `origin = INNVIL_MARKETING`, which
> customer moderators must NOT `BOT_ACK` or `COMMUNITY_HANDOFF` on by default (avoids
> Mika/Kaleb/Alex piling reactions onto an official announcement); a human replying to
> a marketing post is a normal new HUMAN event the manager answers reactively.

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

# Protects the order-status sync cron (/api/cron/sync-orders) AND the blog-draft
# cron (/api/cron/generate-blog). Callers send `Authorization: Bearer <CRON_SECRET>`.
# If unset, the endpoints are open (fine for local testing).
CRON_SECRET=your_long_random_secret

# AI features (blog writer + customer AI support chat). Server-side only. The client
# is provider-agnostic (src/lib/ai/client.ts): it speaks Anthropic's Messages API by
# default, or an OpenAI-compatible one (OpenRouter, Vercel AI Gateway, …) so you can
# use a third-party Claude key. REQUIRED for any AI generation: a key.
#
# INVARIANT: every Innvil-authored AI automation (Natural Chatter, moderator
# replies, community moderation, bot-to-bot conversations, owner/customer
# assistant chat, and any future add-on) MUST run on Claude Sonnet 5, at
# effort "medium" by default — never silently substituted for Fable/Haiku/
# Opus/an older Sonnet/a "cheaper" model. If Sonnet 5 can't be used, the
# operation must fail explicitly (src/lib/ai/client.ts `getInnvilModelConfig()`
# / `assertInnvilModel()`), never silently downgrade. This does NOT gate the
# blog writer's own BLOG_AI_MODEL override below — that's a deliberate,
# human-set per-feature knob, not a silent fallback.
#
# Simplest (Anthropic direct):
ANTHROPIC_API_KEY=your_anthropic_api_key   # (AI_API_KEY also accepted)
#
# Third-party / gateway (OpenAI-compatible), e.g. OpenRouter:
#   AI_PROVIDER=openai
#   AI_API_KEY=sk-or-...                     # your OpenRouter/gateway key
#   AI_BASE_URL=https://openrouter.ai/api/v1 # (default when AI_PROVIDER=openai)
#   AI_MODEL=anthropic/claude-sonnet-5       # provider-specific model id!
#
# Model id (per-feature override exists). Anthropic direct → "claude-sonnet-5";
# OpenRouter/Vercel Gateway → "anthropic/claude-sonnet-5".
AI_MODEL=claude-sonnet-5
# Optional blog-writer-specific model override.
BLOG_AI_MODEL=claude-sonnet-5
#
# Chat streaming (token-by-token replies). OFF by default. Turn ON only with a
# provider that supports SSE streaming (Anthropic direct / OpenRouter) — the
# aiprimetech proxy does NOT stream, so leave this off there. NEXT_PUBLIC_* is
# inlined at build time, so a redeploy applies the change.
# NEXT_PUBLIC_AI_STREAMING=true
#
# --- To switch providers later: set AI_PROVIDER/AI_BASE_URL/AI_API_KEY/AI_MODEL to
#     the new provider, flip NEXT_PUBLIC_AI_STREAMING=true if it streams, redeploy. ---
#
# Fallback provider (optional). If the primary call fails or times out (12s
# per-request cap — see AI_REQUEST_TIMEOUT_MS in client.ts), aiComplete retries
# once against this provider before giving up. Same shape as the primary vars,
# with an AI_FALLBACK_ prefix; a bare model override falls back to the
# primary's model if unset. Current setup (2026-08-08): Anthropic direct is
# PRIMARY (ANTHROPIC_API_KEY, AI_PROVIDER/AI_BASE_URL unset), aiprimetech.io is
# the FALLBACK:
AI_FALLBACK_API_KEY=your_aiprimetech_key
AI_FALLBACK_BASE_URL=https://aiprimetech.io
# AI_FALLBACK_PROVIDER=anthropic   # default; aiprimetech speaks Anthropic-style /v1/messages
# AI_FALLBACK_MODEL=claude-sonnet-5
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
