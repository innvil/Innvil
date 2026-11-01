-- Make Auth-trigger profile creation honor only the server-written customer
-- provisioning marker. All other registrations retain the panel_owner default.
-- raw_user_meta_data is intentionally ignored because it is client-editable.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  provisioned_role user_role := 'panel_owner';
begin
  if new.raw_app_meta_data ->> 'profile_role_intent' = 'customer' then
    provisioned_role := 'customer';
  end if;

  insert into public.profiles (id, role, display_name, email)
  values (new.id, provisioned_role, new.raw_user_meta_data ->> 'display_name', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
