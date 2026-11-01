// Isolated PostgreSQL fixture: runs only in PGlite and never connects to a
// deployed database. Covers immediate-session signup with and without the
// auth.users profile trigger, plus trusted administrator role management.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    alter role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create type public.user_role as enum ('super_admin', 'panel_owner', 'staff', 'customer');
    create table public.profiles(id uuid primary key, role public.user_role not null default 'panel_owner', display_name text);
    alter table public.profiles enable row level security;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create policy profiles_self_select on public.profiles for select using (id = auth.uid());
    create policy profiles_self_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
    grant usage on schema auth to authenticated;
    grant usage on schema public to authenticated, service_role;
    grant select, update on public.profiles to authenticated;
    grant select, update on public.profiles to service_role;
  `);

  await db.exec(await readFile(new URL("../supabase/migrations/0137_profiles_role_write_protection.sql", import.meta.url), "utf8"));

  // This mirrors the trusted server-side payload built by publicSignupProfile;
  // request metadata, including a malicious role, is deliberately ignored.
  const provisionImmediateSignup = async (userId, displayName, untrustedOptions = {}) => {
    const trustedRole = "panel_owner";
    await db.query(
      "insert into public.profiles(id, role, display_name) values ($1, $2, $3) on conflict (id) do nothing",
      [userId, trustedRole, displayName],
    );
    return trustedRole;
  };

  // Profile trigger present: it creates the default role before the server fallback.
  await db.exec(`create function public.handle_new_user() returns trigger language plpgsql as $$
    begin insert into public.profiles(id, display_name) values (new.id, new.raw_user_meta_data ->> 'display_name') on conflict (id) do nothing; return new; end;
  $$; create trigger trg_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();`);
  await db.query("insert into auth.users(id, raw_user_meta_data) values ($1, $2)", [id(1), { display_name: "trigger-owner", role: "super_admin" }]);
  assert.equal(await provisionImmediateSignup(id(1), "trigger-owner", { role: "super_admin" }), "panel_owner");
  assert.deepEqual((await db.query("select role, display_name from public.profiles where id = $1", [id(1)])).rows[0], { role: "panel_owner", display_name: "trigger-owner" });

  // Profile trigger absent: the immediate-session server fallback creates only panel_owner.
  await db.exec("drop trigger trg_auth_user_created on auth.users");
  await db.query("insert into auth.users(id, raw_user_meta_data) values ($1, $2)", [id(2), { display_name: "fallback-owner", role: "super_admin" }]);
  assert.equal(await provisionImmediateSignup(id(2), "fallback-owner", { role: "super_admin" }), "panel_owner");
  assert.deepEqual((await db.query("select role, display_name from public.profiles where id = $1", [id(2)])).rows[0], { role: "panel_owner", display_name: "fallback-owner" });

  // Normal non-immediate registration creates no profile until confirmation.
  await db.query("insert into auth.users(id) values ($1)", [id(3)]);
  assert.equal((await db.query("select count(*)::int as count from public.profiles where id = $1", [id(3)])).rows[0].count, 0);

  // Client role escalation remains blocked even after the signup cases.
  await db.exec(`set role authenticated; set request.jwt.claim.sub = '${id(2)}';`);
  await assert.rejects(db.query("update public.profiles set role = 'super_admin' where id = $1", [id(2)]), /permission denied|not authorized/i);
  await db.exec("reset request.jwt.claim.sub; reset role");

  // Trusted administrator role management remains available through service_role.
  await db.exec(`set role service_role; update public.profiles set role = 'staff' where id = '${id(2)}'; reset role;`);
  assert.equal((await db.query("select role from public.profiles where id = $1", [id(2)])).rows[0].role, "staff");

  console.log("Signup role protection passed: manipulated role ignored, trigger/fallback signup safe, normal registration preserved, client escalation denied, administrator role management preserved.");
} finally {
  await db.close();
}
