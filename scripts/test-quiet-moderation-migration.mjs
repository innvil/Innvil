// Isolated PostgreSQL tests. PGLITE_MODULE must name a test-only PGlite module.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const cid = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
try {
  await db.exec("create role anon; create role authenticated; create role service_role; create table public.communities(id uuid primary key);");
  for (let i=1;i<=10;i++) await db.query("insert into public.communities values ($1)",[cid(i)]);
  const migration = await readFile(new URL("../supabase/migrations/0132_quiet_moderation.sql",import.meta.url),"utf8");
  await db.exec(migration);
  await db.exec(migration); // Safe to rerun without resetting history.
  const claim = async (c,u,m,topic=1,family="promotion",legacy=0) => (await db.query("select public.claim_quiet_moderation($1,$2,$3,$4,$5,clock_timestamp(),$6) as result",[cid(c),u,m,topic,family,legacy])).rows[0].result;
  const finish = async (c,m,publicId=null) => db.query("select public.finish_quiet_moderation_notice($1,$2,$3)",[cid(c),m,publicId]);
  const receipt = async (c,m,mute,kick=false) => db.query("select public.record_quiet_moderation_restriction($1,$2,$3,$4)",[cid(c),m,mute,kick]);
  const advance = async c => db.query("update public.watch_quiet_moderation_state set last_incident_at=last_incident_at-interval '2 minutes' where community_id=$1",[cid(c)]);
  const valid = async (c,m) => (await db.query("select public.quiet_moderation_notice_valid($1,$2) as valid",[cid(c),m])).rows[0].valid;
  assert.equal((await claim(1,"u","invalid")).reason,"invalid_input");
  let plan = await claim(1,"u","1");
  assert.equal(plan.stage,1); assert.equal(plan.action,"delete"); assert.equal(plan.notice,"reminder");
  await finish(1,"1","101");
  assert.equal((await claim(1,"u","1")).reason,"duplicate_message");
  assert.equal((await claim(1,"u","2",2,"dm_spam")).reason,"same_incident");
  await advance(1);
  plan = await claim(1,"u","3");
  assert.equal(plan.stage,2); assert.equal(plan.notice,null); assert.equal(plan.muteMinutes,10);
  await receipt(1,"3",true); await finish(1,"3"); await advance(1);
  plan = await claim(1,"u","4");
  assert.equal(plan.priorPublicWarningCount,1); // quiet mute is not a second public warning
  assert.equal(plan.stage,3); assert.equal(plan.notice,"repeat"); assert.equal(plan.muteMinutes,30); assert.ok(plan.priorMuteAt);
  await receipt(1,"4",true); await finish(1,"4","104"); await advance(1);
  plan = await claim(1,"u","5");
  assert.equal(plan.stage,4); assert.equal(plan.notice,"final"); assert.equal(plan.muteMinutes,60);
  await receipt(1,"5",true); await finish(1,"5","105"); await advance(1);
  plan = await claim(1,"u","6");
  assert.equal(plan.stage,5); assert.equal(plan.action,"kick"); assert.equal(plan.notice,null);

  // Failed final delivery cannot authorize a kick; legacy counts are not proof.
  plan = await claim(2,"legacy","1",1,"promotion",4);
  assert.equal(plan.action,"mute"); assert.equal(plan.muteMinutes,60); assert.equal(plan.notice,"final"); assert.equal(plan.heldForFinalWarning,true);
  await receipt(2,"1",false); await finish(2,"1"); await advance(2);
  plan = await claim(2,"legacy","2");
  assert.equal(plan.action,"mute"); assert.equal(plan.priorMuteAt,null); assert.equal(plan.notice,"final");
  await receipt(2,"2",true); await finish(2,"2","202"); await advance(2);
  assert.equal((await claim(2,"legacy","3")).action,"kick");

  // All watchers/users share topic+confirmed-activity reminders, but not strikes.
  await claim(3,"a","1");
  plan = await claim(3,"b","2"); assert.equal(plan.stage,1); assert.equal(plan.notice,null); // reservation prevents concurrent duplicate
  await finish(3,"1","301"); await finish(3,"2");
  plan = await claim(3,"c","3"); assert.equal(plan.notice,null); assert.equal(plan.suppressionReason,"similar_spam_recently_addressed");
  await finish(3,"3");
  assert.equal((await claim(3,"d","4",2)).notice,"reminder"); await finish(3,"4","304");
  assert.equal((await claim(3,"e","5",1,"search_spam")).notice,"reminder"); await finish(3,"5","305");
  plan = await claim(3,"f","6",3,"dm_spam"); assert.equal(plan.notice,null); assert.equal(plan.suppressionReason,"community_public_limit");
  await db.query("update public.watch_quiet_moderation_events set public_sent_at=public_sent_at-interval '31 minutes' where community_id=$1",[cid(3)]);
  // Silently deleted rows did not extend the successful-reminder timestamp.
  assert.equal((await claim(3,"g","7")).notice,"reminder"); await finish(3,"7","307");
  await db.query("update public.communities set moderation_notice_cooldown_minutes=60 where id=$1",[cid(3)]);
  await db.query("update public.watch_quiet_moderation_events set public_sent_at=public_sent_at-interval '31 minutes' where community_id=$1",[cid(3)]);
  assert.equal((await claim(3,"h","8")).notice,null);

  // Delivery failure releases the reservation without starting a cooldown.
  await claim(4,"a","1"); await finish(4,"1");
  assert.equal((await claim(4,"b","2")).notice,"reminder");
  await db.query("update public.watch_quiet_moderation_events set notice_reserved_until=now()-interval '1 second' where community_id=$1",[cid(4)]);
  assert.equal(await valid(4,"2"),false);
  assert.equal((await claim(4,"c","3")).notice,null); // unknown send outcome stays conservative after lease expiry

  // Same-user concurrent claims cannot skip stages. Different users cannot exceed cap.
  const same = await Promise.all([claim(5,"a","1"),claim(5,"a","2"),claim(5,"a","3")]);
  assert.equal(same.filter(p=>p.claimed).length,1);
  const others = await Promise.all([claim(6,"a","1",1),claim(6,"b","2",2),claim(6,"c","3",3),claim(6,"d","4",4)]);
  assert.equal(others.filter(p=>p.notice).length,3);

  // A final warning blocked by the shared cap never permits automatic removal.
  await claim(7,"a","1",1); await claim(7,"b","2",2); await claim(7,"c","3",3);
  plan=await claim(7,"repeat","4",4,"promotion",3); assert.equal(plan.stage,4); assert.equal(plan.notice,null);
  await advance(7); plan=await claim(7,"repeat","5"); assert.equal(plan.action,"mute"); assert.equal(plan.heldForFinalWarning,true);

  // Inactivity reset and stale receipts cannot restore old punishments/history.
  await claim(8,"a","1",1,"promotion",3);
  await db.query("update public.watch_quiet_moderation_state set last_violation_at=now()-interval '31 days' where community_id=$1",[cid(8)]);
  plan=await claim(8,"a","2"); assert.equal(plan.stage,1); assert.equal(plan.priorMuteAt,null);
  await finish(8,"1","801");
  const reset=(await db.query("select final_warning_at from public.watch_quiet_moderation_state where community_id=$1",[cid(8)])).rows[0];
  assert.equal(reset.final_warning_at,null);
  for(const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(claim(9,"a","1"),/permission denied/);
    await assert.rejects(db.query("select * from public.watch_quiet_moderation_state"),/permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role"); assert.equal((await claim(9,"a","1")).claimed,true);
  console.log("0132 PostgreSQL fixture passed: ladder, receipts, quiet windows, 60-minute setting, shared cap, burst/duplicate races, final-warning protection, reset, service-only access and idempotent migration.");
} finally { await db.close(); }
