# Innvil — Handoff / resume guide

This folder is a self-contained handoff so another agent (or a fresh session) can continue
the current work. Read all three files:

- **README.md** (this) — current state, how to run, migrations + env to apply first.
- **pending-items.md** — the outstanding work, in priority order, with concrete build steps.
- **conventions.md** — hard-won gotchas that WILL bite you if ignored (server-action type
  exports, pg_cron, OTP/Resend requirements, versioning/commit protocol, etc.).

The authoritative product doc is the repo root **`CLAUDE.md`** (architecture + a dated
changelog of every change). Skim its "Recent Updates" — the most recent ~20 entries are this
work stream (v1.1.14 → v1.1.32).

---

## Current state (as of v1.1.32)

Branch: `rebrand-innvil-v0.2.0`. A large amount of work is done and (mostly) committed by the
user commit-by-commit. Recently shipped in this stream:

- Automator v2 (owner tiers, customer sub, keyword config, mass order as its own tab,
  file-upload import, watched-accounts/full-auto via feeds + cron).
- Binance Pay (per-panel, personal-account reconciliation): connect, deposit, verify by
  **Binance Order ID** (2-step, TXID-based UX), unique payable-amount anti-theft, 10-min
  expiry, tiered top-up bonus, background sync cron.
- Automated welcome message (owner-editable) + manual send to existing customers.
- Custom **panel-branded OTP** for customer **signup** and **password reset** (replaces
  Supabase's project-wide confirmation/reset emails — fixes the localhost + "Innvil" branding).
- Customer login by **username OR email**.
- **Platform-specific panels** (Telegram first): `settings.platformFocus`, hard catalog filter,
  TG marketing overlay onto any design (`applyPlatformContent`), TG default-landing hero + SEO,
  and a single Telegram icon **revolving** the Orbit hero with a lights-out pulse.

---

## ⚠️ Before it works: apply migrations + env

### Run these Supabase migrations (in order), if not already applied
`supabase/migrations/`:
- `0031_welcome_tickets.sql` — welcome ticket kind + one-time bonus flag
- `0032_binance_pay.sql` — binance tx cache + `payments.binance_tx_id`
- `0033_binance_payable.sql` — `payments.binance_payable`
- `0034_supabase_binance_sync_cron.sql` — schedules `innvil-binance-sync` (pg_cron)
- `0035_watched_accounts.sql` — watched feeds
- `0036_supabase_watch_accounts_cron.sql` — schedules `innvil-watch-accounts` (pg_cron)
- `0037_signup_otps.sql` — `customer_signup_otps` (signup OTP)
- `0038_email_otps.sql` — `purpose` column + `auth_user_id_by_email()` (password-reset OTP)

### pg_cron jobs (project convention — NOT vercel.json)
Each cron is scheduled by its own migration using vault secrets `app_url` + `cron_secret`.
Confirm these jobs exist in `cron.job`: `innvil-order-sync-every-10-min`, `innvil-generate-blog`,
`innvil-bill-addons`, `innvil-binance-sync`, `innvil-watch-accounts`. Re-run the relevant
migration (idempotent) if any are missing.

### Env / Supabase Auth settings (REQUIRED for the new auth emails)
- `RESEND_API_KEY` set, plus a **verified `RESEND_FROM` domain** (e.g. innvil.cloud). Without
  it the signup/reset OTP codes can't be delivered and those flows break.
- Supabase **Auth → "Confirm email" = ON** (so a customer created unconfirmed via the admin API
  can't sign in until the OTP confirms them).
- Supabase **Auth → Site URL** = prod origin, and add panel hosts to **Redirect URLs** — still
  matters for OWNER auth + any remaining Supabase-sent emails.
- Standard: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `PROVIDER_KEY_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`,
  `ANTHROPIC_API_KEY` (AI features). See CLAUDE.md "Environment Variables".

---

## Build / run

```bash
npm install
npm run dev          # local
npm run build        # verify a production build BEFORE committing/tagging
```

> IMPORTANT: In this work stream the sandbox could not run `tsc`/`build`, so **some edits were
> not type-checked**. The FIRST thing a resuming agent should do is `npm run build` and fix any
> errors before adding features. See conventions.md for the class of errors already hit.
