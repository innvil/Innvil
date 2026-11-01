// Runs migration 0131 only in isolated PostgreSQL, never production.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const community = "00000000-0000-0000-0000-000000000001";
const secondCommunity = "00000000-0000-0000-0000-000000000002";
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.communities(id uuid primary key);
    insert into public.communities values ('${community}'), ('${secondCommunity}');`);
  await db.exec(await readFile(new URL("../supabase/migrations/0131_watch_ambient_reactions.sql", import.meta.url), "utf8"));
  const claim = async (messageId, admin = false, communityId = community) => (await db.query("select public.claim_watch_ambient_reaction($1,$2,$3) as claimed", [communityId, messageId, admin])).rows[0].claimed;
  assert.equal(await claim("not-an-id"), false);
  assert.equal(await claim("42"), true);
  assert.equal(await claim("42", true), false);
  assert.equal(await claim("43"), false);
  assert.equal(await claim("43", true), false);
  await db.exec("update public.watch_ambient_reaction_claims set created_at = now() - interval '15 seconds'");
  assert.equal(await claim("43"), false);
  assert.equal(await claim("43", true), true); // admin's shorter pacing window
  assert.equal(await claim("42", true), false); // older message still deduplicated
  assert.equal(await claim("42", false, secondCommunity), true); // community isolation
  await db.exec("update public.watch_ambient_reaction_claims set created_at = now() - interval '30 seconds'");
  const concurrent = await Promise.all([claim("44"), claim("44"), claim("45")]);
  assert.equal(concurrent.filter(Boolean).length, 1);
  await db.query("insert into public.watch_ambient_reaction_claims select $1, (100+n)::text, now() - interval '5 minutes' from generate_series(1,60) n", [community]);
  await db.exec("update public.watch_ambient_reaction_claims set created_at = now() - interval '5 minutes'");
  assert.equal(await claim("999", true), false); // hourly ceiling even for admins
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(claim("1000"), /permission denied/);
    await assert.rejects(db.query("select * from public.watch_ambient_reaction_claims"), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("update public.watch_ambient_reaction_claims set created_at = now() - interval '3 days'");
  await db.exec("set role service_role");
  assert.equal(await claim("1001"), true);
  await db.exec("reset role");
  assert.equal((await db.query("select count(*)::int as count from public.watch_ambient_reaction_claims where community_id = $1", [community])).rows[0].count, 1);
  console.log("0131 PostgreSQL fixture passed: service-only execution, duplicate claims, competing calls, admin/member pacing, hourly ceiling, community isolation and bounded retention.");
} finally { await db.close(); }
