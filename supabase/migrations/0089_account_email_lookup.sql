-- Account email lookup (2026-08-23) -- lets you identify which account/
-- entitlement row belongs to which real person when browsing Supabase
-- directly (e.g. to find and remove a test account), without duplicating
-- email onto every table.
--
-- Email lives ONLY in auth.users -- copying it onto profiles/
-- product_entitlements/etc. would create a second, driftable source of
-- truth (every email-change action in this codebase, e.g. customerUpdateEmail
-- / account settings, only ever updates auth.users). These are plain
-- read-only VIEWS instead: always accurate, zero duplication, dropped/
-- recreated safely by re-running this file.
--
-- Not exposed to the client API -- no grant to anon/authenticated, matching
-- the "service-role only" convention already used throughout this schema.
-- Query these from the Supabase SQL Editor (runs as postgres, bypasses RLS)
-- or the Table Editor's "Views" section.

drop view if exists profiles_with_email;
create view profiles_with_email as
select
  p.id,
  u.email,
  p.display_name,
  p.role,
  u.email_confirmed_at is not null as email_confirmed,
  p.created_at,
  u.last_sign_in_at
from profiles p
join auth.users u on u.id = p.id
order by p.created_at desc;

drop view if exists product_entitlements_with_email;
create view product_entitlements_with_email as
select
  e.id,
  u.email,
  pr.display_name,
  pd.slug as product_slug,
  e.status,
  e.subscription_ref,
  e.billing_interval,
  e.current_period_start,
  e.current_period_end,
  e.enterprise_slots,
  e.enterprise_community_capacity,
  e.activated_at,
  e.account_id
from product_entitlements e
join profiles pr on pr.id = e.account_id
join auth.users u on u.id = e.account_id
join products pd on pd.id = e.product_id
order by e.activated_at desc;
