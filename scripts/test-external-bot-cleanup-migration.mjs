import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
// Isolated PostgreSQL only; no connection to production.
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
try {
  await db.exec("create table public.communities(id integer primary key); insert into public.communities values (1);");
  const migration = await readFile(new URL("../supabase/migrations/0133_external_bot_cleanup.sql", import.meta.url), "utf8");
  await db.exec(migration);
  assert.equal((await db.query("select remove_external_bot_messages from public.communities where id=1")).rows[0].remove_external_bot_messages, false);
  await db.exec("update public.communities set remove_external_bot_messages=true where id=1;");
  await db.exec(migration);
  assert.equal((await db.query("select remove_external_bot_messages from public.communities where id=1")).rows[0].remove_external_bot_messages, true);
  await db.exec("insert into public.communities(id) values(2);");
  assert.equal((await db.query("select remove_external_bot_messages from public.communities where id=2")).rows[0].remove_external_bot_messages, false);
  await assert.rejects(db.exec("update public.communities set remove_external_bot_messages=null where id=2;"));
  console.log("0133 isolated PostgreSQL: existing/new rows default off, rerun preserves choices, null rejected.");
} finally { await db.close(); }
