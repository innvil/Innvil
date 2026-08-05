# Pending items — priority order + how to build

User's stated priority: **email change → Binance admin review → collage mockup**, then the rest.
Each item lists the goal, the files, the approach, and gotchas.

---

## 1. Email change → panel-branded OTP (finish "the email")

**Goal:** the logged-in customer email-change confirmation still uses Supabase's project-wide
email (localhost/Innvil). Convert it to the same branded OTP as signup + password reset.

**Backend** — `src/lib/actions/customer-auth.ts` (the OTP machinery is already here):
- Add `customerRequestEmailChange(panelId, newEmail, currentPassword)`:
  - get the signed-in user via `createStorefrontClient().auth.getUser()`.
  - re-auth: `signInWithPassword({ email: user.email, password: currentPassword })`.
  - validate `newEmail` (EMAIL_RE) and not already taken (`admin.rpc("auth_user_id_by_email", { p_email: newEmail })` → must be null).
  - `genOtp()` + upsert into `customer_signup_otps` with `purpose: "change"`, `email: newEmail`,
    `user_id: user.id`, `panel_id`. Email it: `sendOtpEmail(admin, panelId, newEmail, code, "change")`.
  - return `{ ok: true, needsOtp: true }`.
- Add `customerConfirmEmailChange(panelId, newEmail, code)`:
  - verify the OTP row (email=newEmail, purpose="change", TTL, attempts, hash) — same pattern as
    `customerResetPassword`.
  - `admin.auth.admin.updateUserById(row.user_id, { email: newEmail, email_confirm: true })`.
  - delete the OTP row. Return `{ ok: true }`.
- Replace/deprecate the old `customerUpdateEmail` (currently `updateUser({email})` → returns
  `needsConfirmation`).

**UI** — `src/components/customer/CustomerDashboard.tsx` profile section:
- The profile currently calls `onUpdateEmail(newEmail, currentPassword)` (threaded from
  `app/p/[subdomain]/Storefront.tsx`). Make it a 2-step: request → show a 6-digit code field →
  confirm. Mirror the `SignUpClient` OTP stage (it's a good reference for the input + resend).
- Thread two handlers from `Storefront.tsx` (like `onBinanceCreate`/`onBinanceClaim` were):
  `onRequestEmailChange` and `onConfirmEmailChange`.

**Gotcha:** keyed by email PK in `customer_signup_otps`; the change OTP uses the NEW email as the
key. Fine, but a pending signup for that same new email would be overwritten (acceptable edge).

No migration needed (0038 already added `purpose`).

---

## 2. Binance Pay — admin review + alerts

**Goal:** an owner surface to see/resolve Binance deposits that didn't auto-credit (amount
mismatch, wrong currency/recipient, stuck pending), plus a "sync hasn't run" alert. Today
mismatches just stay `pending` and the owner has only the generic pending-payment tools.

**Backend** — new `src/lib/actions/binance-admin.ts` (owner-auth via `getAuthedAdmin` + ownership):
- `listBinanceDeposits(panelId, {status?})` → the panel's `payments` where `gateway='binance_pay'`
  (join customer email/username like `listPanelDeposits` in `actions/payments.ts`). Include
  `binance_payable`, `binance_tx_id`, status, created_at.
- `listBinancePayTransactions(panelId, {unmatchedOnly?})` → rows from `binance_pay_transactions`
  for the panel (raw Pay history) so the owner can see received-but-unclaimed payments. Flag
  which have no matching completed payment.
- Reuse existing `commitPendingPayment` / `cancelPendingPayment` (actions/payments.ts) for manual
  credit/cancel — they already work on any pending payment.
- Optional: `binanceSyncHealth(panelId)` → last `binance_pay_transactions.updated_at`; older than
  ~5 min while deposits are pending ⇒ warn.

**UI** — add a card/section to the **Payments** tab (`AdminTabs.tsx` `PaymentsTab`) shown only
when `binance_pay` is connected: a list of Binance deposits with status + a "review" expander
(received amount vs expected, tx id, payer name from `binance_pay_transactions.raw_payload`),
with Commit / Cancel buttons. Keep it consistent with the existing gateway row styling (note the
mobile-stacking pattern already used there).

**Gotchas:** never expose provider cost/secrets. The `binance_pay_transactions` table is
service-role only (RLS on, no policies) — read it via the admin client in the owner action.

---

## 3. Collage mockup — single-platform treatment (Agency design)

**Goal:** on a platform-focused panel, the Agency design's `mockup:"collage"` shows a row of
platform icons from the catalog; make it read single-platform (e.g. one big Telegram tile) like
the orbit hero does.

**File** — `src/components/design/DesignRenderer.tsx`, the `s.mockup === "collage"` block
(the "Platform icons row" card maps `data.services` platforms). Branch on `data.focusPlatform`
(already plumbed into `DesignRenderData` and threaded from the storefront + Design Studio preview):
when set, render ONE focused-platform tile/badge instead of the multi-icon row. Reuse the
`PlatformGlyph` component. Keep tokens/animation.

No new plumbing needed — `focusPlatform` is already available in `data`.

---

## 4. Default (non-design) landing — deeper TG sections

**Goal:** a Telegram panel WITHOUT a purchased design gets the TG hero + TG-only catalog + TG SEO,
but the default landing's deeper sections (benefits / how-it-works / FAQ) in
`app/p/[subdomain]/Storefront.tsx` still show generic all-platform copy.

**Approach:** pass the platform content pack into `Storefront` and use it in those sections when
present. The pack + accessor already exist: `getPlatformContentPack(focus)` in
`src/lib/design/platform-content.ts`, backed by `src/data/platform-content/telegram.ts` (has
`features`, `steps`, `faq`, `testimonials`, `cta`). In `app/p/[subdomain]/page.tsx` compute
`focusPack` (already done for the hero override) and pass it down; in `Storefront.tsx` render the
pack's `features`/`steps`/`faq` instead of the hardcoded generic ones when `focusPack` is set.

---

## 5. Telegram AI auto-post add-on (FUTURE — deferred by user)

Full spec is in the assistant memory note `innvil-telegram-autopost-addon` (a paid add-on: bot
token + OpenAI + pg_cron, human-approve-first, per-customer approved-facts). Build only after the
above. Reuse `src/lib/ai/client.ts`, encrypted secret storage (set/get key RPCs), pg_cron, and the
AI-blog human-approve pattern.

---

## 6. Broader roadmap (see CLAUDE.md "Pending Features")

More gateways (PayPal/PayU/Cashfree), per-panel currency, Statistics dashboard (§9), next Design
Shop design (backlog in memory `innvil-design-directions`), Analytics add-on, ANVIL token — all
post-MVP.
