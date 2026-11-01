-- ----------------------------------------------------------------------------
-- 0038 — Extend the custom OTP flow to password reset + email change.
-- Reuses customer_signup_otps (0037): a `purpose` column distinguishes signup /
-- reset / change, and a helper resolves a user id by email (for password reset,
-- where we don't have the session). All still service-role only.
-- ----------------------------------------------------------------------------
alter table customer_signup_otps add column if not exists purpose text not null default 'signup';

-- Look up an auth user id by email (case-insensitive). Security-definer so the
-- service-role client can resolve a customer for a branded password-reset OTP.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;
