// Isolated PostgreSQL fixture: runs only in PGlite and never connects to a
// deployed database. Verifies the exact migration's client/service-role ACLs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const userId = "00000000-0000-0000-0000-000000000001";

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid
      language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create type public.user_role as enum ('super_admin', 'panel_owner', 'staff', 'customer');
    create table public.profiles (
      id uuid primary key,
      role public.user_role not null default 'panel_owner',
      display_name text
    );
    insert into public.profiles(id, role, display_name)
      values ('${userId}', 'panel_owner', 'Before');
    alter table public.profiles enable row level security;
    create policy profiles_self_select on public.profiles for select
      using (id = auth.uid());
    create policy profiles_self_update on public.profiles for update
      using (id = auth.uid()) with check (id = auth.uid());
    grant usage on schema auth to authenticated;
    grant usage on schema public to authenticated, service_role;
    grant select, update on public.profiles to authenticated;
    grant select, update on public.profiles to service_role;
  `);

  await db.exec(await readFile(
    new URL("../supabase/migrations/0137_profiles_role_write_protection.sql", import.meta.url),
    "utf8",
  ));

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  const identity = (await db.query("select auth.uid() as id, current_user as role")).rows[0];
  assert.equal(identity.id, userId);
  assert.equal(identity.role, "authenticated");
  await db.query("update public.profiles set display_name = 'After' where id = $1", [userId]);
  await db.exec("reset request.jwt.claim.sub; reset role");

  const profile = (await db.query("select role, display_name from public.profiles where id = $1", [userId])).rows[0];
  assert.deepEqual(profile, { role: "panel_owner", display_name: "After" });

  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${userId}';`);
  await assert.rejects(
    db.query("update public.profiles set role = 'super_admin' where id = $1", [userId]),
    /permission denied|not authorized/i,
  );
  await db.exec("reset request.jwt.claim.sub; reset role");

  await db.exec(`set role service_role; update public.profiles set role = 'super_admin' where id = '${userId}'; reset role;`);
  const adminProfile = (await db.query("select role, display_name from public.profiles where id = $1", [userId])).rows[0];
  assert.deepEqual(adminProfile, { role: "super_admin", display_name: "After" });

  console.log("0137 profile role protection passed: client role escalation denied, display-name editing allowed, service-role role update preserved.");
} finally {
  await db.close();
}
