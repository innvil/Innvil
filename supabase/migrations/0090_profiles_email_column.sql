-- Real, kept-in-sync email column directly on `profiles` (the accounts
-- table), so a test account can be found and deleted in ONE place --
-- Supabase's Table Editor on `profiles` -- rather than needing a separate
-- lookup view plus a second delete step in Authentication > Users.
--
-- Supersedes `profiles_with_email` from migration 0089 (dropped below --
-- redundant now that `profiles` itself carries email).
-- `product_entitlements_with_email` is untouched and still useful (no
-- direct email column was added to that table).

drop view if exists profiles_with_email;

alter table profiles add column if not exists email text;
alter table profiles drop constraint if exists profiles_email_key;
alter table profiles add constraint profiles_email_key unique (email);
create index if not exists idx_profiles_email on profiles (email);

-- One-time backfill for every existing account.
update profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is distinct from u.email;

-- Keep it current going forward: (1) set it on every NEW signup, alongside
-- the existing display_name copy; (2) sync it whenever an email actually
-- changes later (account settings / customer email-change flows only ever
-- write auth.users -- never profiles.email directly).
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, new.raw_user_meta_data ->> 'display_name', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create or replace function sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;
do $$ begin
  execute 'drop trigger if exists trg_auth_user_email_changed on auth.users';
  execute 'create trigger trg_auth_user_email_changed after update of email on auth.users '
       || 'for each row execute function sync_profile_email()';
exception
  when insufficient_privilege then
    raise notice 'Skipped auth.users email-sync trigger (no ownership) -- same limitation as handle_new_user in 0001.';
  when others then
    raise notice 'Skipped auth.users email-sync trigger: %', sqlerrm;
end $$;

-- Deleting the account row itself now performs a REAL, complete account
-- removal -- deleting a `profiles` row (e.g. via the Table Editor) also
-- deletes the matching auth.users row, which is what actually lets the
-- email be reused for a future test signup (profiles.id -> auth.users.id
-- has no reverse cascade on its own; every OTHER app table already
-- cascades correctly off profiles.id via existing FKs, so this is the
-- one missing direction). Deleting FROM auth.users directly (Studio's
-- Authentication > Users, or the admin API) still works exactly as
-- before and is unaffected by this trigger.
create or replace function delete_auth_user_on_profile_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = old.id;
  return old;
end;
$$;
drop trigger if exists trg_profile_deleted on profiles;
create trigger trg_profile_deleted after delete on profiles
  for each row execute function delete_auth_user_on_profile_delete();
