-- Prevent client roles from changing the platform authorization role.
-- Profile editing remains available through the display_name column; trusted
-- server-side administrator workflows continue to use service_role.
revoke update on table public.profiles from anon, authenticated;
grant update (display_name) on table public.profiles to authenticated;
