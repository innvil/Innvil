// Isolated PostgreSQL fixture: PGLITE_MODULE points at an external test-only
// @electric-sql/pglite/dist/index.js. Does not connect to any deployed database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), email_confirmed_at timestamptz);
    create table public.profiles(id uuid primary key, display_name text, role text);
    create table public.products(id uuid primary key, slug text);
    create table public.product_entitlements(account_id uuid, product_id uuid, status text, subscription_ref text, current_period_end timestamptz, created_at timestamptz default now());
    create table public.panels(id uuid primary key, owner_id uuid);
    create table public.virtual_moderators(id uuid primary key, account_id uuid, panel_id uuid, created_at timestamptz default now());
    create table public.watch_trial_claims(account_id uuid, started_at timestamptz, ends_at timestamptz);
    create table public.watch_telegram_links(account_id uuid, created_at timestamptz default now());
    create table public.watch_account_preferences(account_id uuid, created_at timestamptz default now());
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/0130_superadmin_watch_users.sql", import.meta.url), "utf8"));
  const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  for (let n = 1; n <= 32; n++) {
    await db.query("insert into auth.users(id,email,raw_user_meta_data,created_at) values ($1,$2,$3, now() - interval '40 days')", [id(n), `user${n}@test.invalid`, n >= 7 ? { signup_product: "watch" } : {}]);
    await db.query("insert into profiles(id,display_name,role) values ($1,$2,$3)", [id(n), `Person ${n}`, n === 1 ? "super_admin" : "panel_owner"]);
  }
  await db.query("insert into products values ($1,'watch'),($2,'forge')", [id(90), id(91)]);
  await db.query("insert into product_entitlements(account_id,product_id,status,subscription_ref,current_period_end) values ($1,$2,'active','basic:devops:grant',now()+interval '30 days'),($3,$4,'active','forge',null),($5,$2,'active','standard:paid',now()-interval '1 day')", [id(2), id(90), id(6), id(91), id(5)]);
  await db.query("insert into watch_trial_claims values ($1,now()-interval '1 day',now()+interval '2 days')", [id(3)]);
  await db.query("insert into watch_telegram_links(account_id) values ($1)", [id(3)]);
  await db.query("insert into panels values ($1,$2)", [id(80), id(4)]);
  await db.query("insert into virtual_moderators values ($1,null,$2,now()-interval '8 days')", [id(81), id(80)]);
  await db.query("insert into watch_account_preferences(account_id) values ($1)", [id(4)]);
  const report = async (search = "", page = 1, days = 0) => (await db.query("select public.superadmin_watch_users($1,$2,$3,25,$4) as report", [id(1), search, page, days])).rows[0].report;
  const all = await report();
  assert.equal(all.total, 30); // 26 signup markers + 4 activity users; no admin/Forge-only inference
  assert.equal(all.users.length, 25);
  assert.deepEqual(all.summary, { total: 30, new7Days: 3, new30Days: 4, activeSubscriptions: 1, activeTrials: 1 });
  const second = await report("", 2);
  assert.equal(second.users.length, 5);
  assert.equal(new Set([...all.users, ...second.users].map(u => u.id)).size, 30);
  assert.equal(all.users.find(u => u.id === id(2)).manualGrant, true);
  assert.equal(all.users.find(u => u.id === id(3)).telegramVerified, true);
  assert.equal(all.users.find(u => u.id === id(4)).watcherCount, 1);
  assert.equal(all.users.find(u => u.id === id(5)).accessStatus, "expired");
  assert.equal((await report("user6@")).total, 0);
  assert.equal((await report("USER2@TEST.INVALID")).total, 1);
  assert.equal((await report("'; DROP TABLE profiles; --")).total, 0);
  assert.equal((await report("", 1, 7)).total, 3);
  assert.equal((await report("", 1, 30)).total, 4);
  await assert.rejects(db.query("select public.superadmin_watch_users($1)", [id(2)]), /Super admin only/);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select public.superadmin_watch_users($1)", [id(1)]), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  assert.equal((await report()).total, 30);
  console.log("0130 PostgreSQL fixture passed: real migration, role grants, activity provenance, old panel ownership, pagination, search, date filters and access counts.");
} finally { await db.close(); }
