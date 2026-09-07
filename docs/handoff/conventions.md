# Conventions & gotchas (read before editing)

These are project rules + specific traps already hit in this work stream. Ignoring them will
break the build or production.

## Server actions / `"use server"`
- **NEVER `export type { X }` (or re-export a type) from a `"use server"` file.** Next treats
  every export of a server-action module as an action; the erased type becomes an undefined
  runtime reference and crashes any client bundle that transitively imports it (real bug hit:
  `PlaceOrderInput is not defined` on the create-panel wizard, and the same in `binance-pay.ts`).
  → Put shared types in a plain server-only module and `import type` them. Example:
  `src/lib/orders/place.ts` (types + `placeOrderForAccount`) is imported by the `"use server"`
  `actions/orders.ts`.
- Server actions can be imported and called from other server code with non-serializable args
  (that restriction is only for client→server calls). But to avoid the type-export trap, keep
  pure/shared logic in `server-only` (not `"use server"`) modules.

## Cron jobs
- Scheduling is via **Supabase pg_cron**, NOT `vercel.json`. Each cron gets its own migration
  mirroring `0026`/`0027`/`0034`/`0036`: a `security definer` `trigger_*()` function that reads
  vault secrets `app_url` + `cron_secret` and `net.http_get`s the route, then
  `cron.schedule('innvil-...', '<expr>', 'select public.trigger_*();')` with an unschedule guard.
- Route handlers live at `app/api/cron/<name>/route.ts`, gated by `CRON_SECRET`
  (`Authorization: Bearer` or `?secret=`).
- **Do not write a cron expression like `*/5 * * * *` inside a JS `/* ... */` block comment** —
  the `*/` closes the comment early and the build fails with "Expression expected". Describe the
  schedule in prose or reference the migration.

## Money / orders
- The order money-path core is `placeOrderForAccount(admin, panel, acct, input)` in
  `src/lib/orders/place.ts` (session-less). `actions/orders.ts#placeOrder` is a thin auth wrapper;
  the watched-accounts cron reuses the core to order on behalf of a resolved customer.
- Balance changes go through the `apply_balance_change` RPC (`p_type` ∈ deposit|order|refund|
  manual_adjust). There is no "automator/binance" type — the customer automator sub is charged as
  `order` (100% owner revenue, no provider payout).
- Commission is settled per completed order off `panels.settings.innvil_balance` (see money.ts +
  `settle_order_commission`).

## Auth emails (custom OTP)
- Customer **signup** and **password reset** use our own panel-branded OTP via Resend, NOT
  Supabase's built-in emails. Mechanism: `admin.auth.admin.createUser({ email_confirm:false })`
  (no Supabase email) / `auth_user_id_by_email` for reset → 6-digit code hashed in
  `customer_signup_otps` (`purpose` = signup|reset|change) → verify → confirm/update via admin API.
- **Requires** `RESEND_API_KEY` (+ verified `RESEND_FROM` domain) and Supabase **"Confirm email"
  ON**. If Resend isn't configured, signup/reset break (no code delivered).
- `sendEmail` (`src/lib/email/resend.ts`) takes an optional `fromName` (panel display name; the
  domain stays the verified Resend one). Supabase Auth templates are project-wide → can't be
  per-panel branded, which is WHY we roll our own.

## Platform focus (single-platform panels)
- Stored at `panels.settings.platformFocus` (`"telegram"` | absent). Helpers in
  `src/lib/platform-focus.ts`.
- Landing marketing overlay: `applyPlatformContent(pkg, focus)` in
  `src/lib/design/platform-content.ts` overrides a design's landing COPY from the platform pack
  (`src/data/platform-content/<platform>.ts`) while keeping tokens/layout/animation. The renderer
  also reads `DesignRenderData.focusPlatform` for the single flying/orbiting icon.
- Hard catalog filter is in `getStorefrontServices` (storefront.ts) via `platformAllowedByFocus`.
- To add a platform: add it to `PLATFORM_FOCUS_OPTIONS`, create its content pack, register it in
  `platform-content.ts` `PACKS`. One platform at a time.

## Versioning + commit protocol (user preference)
- **Bump `package.json` version on every change** and add a dated entry to the top of CLAUDE.md
  "Recent Updates" (newest first). Current: `1.1.32`.
- Always provide the **`git add` + `git commit` + `git tag`** commands together in one block.
  **Do NOT push** unless the user asks.
- Commit message body ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Tags already used up to `v1.1.32`; a new change → next patch (e.g. v1.1.33). If `git tag` says
  "already exists", the previous version was committed — bump again.

## Design renderer
- One shared renderer (`src/components/design/DesignRenderer.tsx`) drives BOTH the marketplace
  live previews AND the real storefront landing. Presentation only — functional pieces (auth card,
  service list, payments) are injected as `slots`; the renderer never touches auth/order/payment
  logic. Keep it that way.
- CSS lives in the `DESIGN_CSS` string (dz-* classes / keyframes). Colours use `--d-*` tokens.
