-- ----------------------------------------------------------------------------
-- 0037 — Custom customer signup OTP (panel-branded email verification).
-- Replaces Supabase Auth's project-wide confirmation email: we create the user
-- unconfirmed via the admin API, email a 6-digit code (Resend, branded per panel),
-- verify it here, then confirm the user. One pending code per email.
-- ----------------------------------------------------------------------------
create table if not exists customer_signup_otps (
  email       text primary key,
  user_id     uuid,
  panel_id    uuid references panels (id) on delete set null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Service-role only (the storefront never reads this directly).
alter table customer_signup_otps enable row level security;
