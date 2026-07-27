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

### 2026-07-25 — Landing: automation-first positioning + full feature coverage (v1.0.1)
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
