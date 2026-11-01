import { test } from "node:test";
import assert from "node:assert/strict";
import { quietSpamFamily, quietNoticeNeedsMention, invalidQuietWarning, quietWarningFallback, validQuietClaim, type QuietModerationClaim } from "./quiet-moderation";
import { runQuietModeration } from "./quiet-moderation-runtime";
import type { CommunityAction, CommunityEvent } from "./event-types";
import { DEFAULT_MODERATOR_PERSONA } from "./domain";

const base: QuietModerationClaim = { claimed: true, stage: 1, violationCount: 1, action: "delete", muteMinutes: null, notice: "reminder",
  suppressionReason: null, priorMuteAt: null, priorPublicWarningAt: null, priorPublicWarningCount: 0, heldForFinalWarning: false };
function fixture(claim: unknown, opts: { restrictionFails?: boolean; sendFails?: boolean; valid?: boolean; historyFails?: boolean; targetIsClear?: boolean } = {}) {
  const actions: CommunityAction[] = [];
  const receipts: Array<{ name: string; args: Record<string, unknown> }> = [];
  const writes: Array<Record<string, unknown>> = [];
  let purges = 0;
  const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: [], error: null }), insert: async (v: Record<string, unknown>) => { writes.push(v); return { error: null }; } };
  const admin = { from: () => query, rpc: async (name: string, args: Record<string, unknown>) => {
    receipts.push({ name, args });
    return { data: name === "claim_quiet_moderation" ? claim : name === "quiet_moderation_notice_valid" ? opts.valid !== false : !opts.historyFails, error: null };
  } };
  const event: CommunityEvent = { panelId: null, communityId: "c", integrationId: "i", messageId: "42", text: "DM me for marketing services", timestamp: new Date().toISOString(),
    sender: { platformUserId: "7", username: "member", displayName: "Member", isBot: false, senderType: "HUMAN" }, replyToMessageId: null, messageThreadId: 31, origin: "HUMAN", interactionDepth: 0, causationMessageId: null };
  return { actions, receipts, writes, get purges() { return purges; }, run: () => runQuietModeration({ admin: admin as never, panelId: null, communityId: "c", projectId: null,
    event, family: "promotion", legacyCount: 0, currentTopicName: "General", promotionTopicName: "Promotion", targetIsClear: opts.targetIsClear ?? false,
    deployment: { deploymentId: "d", moderatorId: "m", moderatorName: "Patricia", persona: DEFAULT_MODERATOR_PERSONA },
    aiRouting: { required: true, credential: null }, // deterministic fallback, absolutely no live provider
    execute: async action => { actions.push(action); return { ok: action.kind === "SEND_TEXT" ? !opts.sendFails : !opts.restrictionFails, sentMessageId: action.kind === "SEND_TEXT" && !opts.sendFails ? "99" : null }; },
    purge: async () => { purges++; return { attempted: 2, purged: 2, failed: false }; } }) };
}

test("quiet policy only handles confirmed ordinary families; flood, scam and explicit enforcement remain independent", () => {
  for (const reason of ["unsolicited_promotion", "repeated_unsolicited_promotion", "repeated_dm_spam", "search_spam", "token_contract_mismatch", "competing_project_promotion"]) assert.ok(quietSpamFamily(reason, false));
  for (const reason of ["scam_or_phishing", "repeated_scam_or_phishing", "explicit_content", "negative_statement"]) assert.equal(quietSpamFamily(reason, false), null);
  assert.equal(quietSpamFamily("repeated_unsolicited_promotion", true), null);
});
test("mention policy: room reminder has none; third depends on audience clarity; final always targets offender", () => {
  assert.equal(quietNoticeNeedsMention(1,false),false);
  assert.equal(quietNoticeNeedsMention(3,true),false);
  assert.equal(quietNoticeNeedsMention(3,false),true);
  assert.equal(quietNoticeNeedsMention(4,true),true);
});
test("untrusted warning guards reject invented history, insults, counts and vague final warnings", () => {
  for (const text of ["you were already muted", "you were muted before", "back after that timeout", "you are stupid", "@user, stop", "Warning 3 of 4"]) assert.equal(invalidQuietWarning(text,3,false),true,text);
  assert.equal(invalidQuietWarning("you were already muted",3,true),false);
  assert.equal(invalidQuietWarning("stop spamming please",4,true),true);
  assert.equal(invalidQuietWarning(quietWarningFallback(4,"promotion",null,false),4,false),false);
});
test("malformed claim cannot authorize restriction or invented notice", () => {
  assert.equal(validQuietClaim(base),true);
  for (const v of [null,true,{...base,action:"ban"},{...base,stage:2},{...base,stage:5,action:"kick",notice:"final"},{...base,priorPublicWarningCount:undefined}]) assert.equal(validQuietClaim(v),false);
});
test("first public reminder sends without mention, saves delivery receipt and stays in source topic", async () => {
  const f=fixture(base); await f.run();
  assert.equal(f.actions.length,1);
  const action=f.actions[0]; assert.equal(action.kind,"SEND_TEXT");
  if(action.kind==="SEND_TEXT") { assert.doesNotMatch(action.text,/@member|tg:\/\/user|\[user\]/); assert.equal(action.messageThreadId,31); }
  assert.equal(f.receipts.find(r=>r.name==="finish_quiet_moderation_notice")?.args.p_public_message_id,"99");
});
test("similar first offense and duplicate burst cause no public response or text generation", async () => {
  for(const claim of [{...base,notice:null,suppressionReason:"similar_spam_recently_addressed"},{claimed:false,reason:"same_incident"},{claimed:false,reason:"duplicate_message"}]) {
    const f=fixture(claim); await f.run(); assert.deepEqual(f.actions,[]); assert.equal(f.writes.some(w=>w.origin==="MODERATION_WARNING"),false);
  }
});
test("second offense mutes silently and records only a real successful mute", async () => {
  for(const fail of [false,true]) {
    const f=fixture({...base,stage:2,violationCount:2,action:"mute",muteMinutes:10,notice:null},{restrictionFails:fail}); await f.run();
    assert.deepEqual(f.actions,[{kind:"RESTRICT_USER",targetDeploymentId:"d",targetPlatformUserId:"7",mode:"MUTE",muteMinutes:10}]);
    assert.equal(f.receipts.find(r=>r.name==="record_quiet_moderation_restriction")?.args.p_mute_ok,!fail);
    assert.equal(f.receipts.find(r=>r.name==="finish_quiet_moderation_notice")?.args.p_public_message_id,null);
  }
});
test("third offense restricts before speaking and never invents past successful mutes", async () => {
  for(const priorMuteAt of [null,"2026-09-01T00:00:00Z"]) {
    const f=fixture({...base,stage:3,violationCount:3,action:"mute",muteMinutes:30,notice:"repeat",priorMuteAt},{targetIsClear:true}); await f.run();
    assert.equal(f.actions[0].kind,"RESTRICT_USER"); const last=f.actions.at(-1)!; assert.equal(last.kind,"SEND_TEXT");
    if(last.kind==="SEND_TEXT") { assert.equal(last.text.includes("timeout"),!!priorMuteAt); assert.doesNotMatch(last.text,/@member/); }
  }
});
test("fourth-stage final warning targets member and only successful delivery authorizes the receipt", async () => {
  for(const sendFails of [false,true]) {
    const f=fixture({...base,stage:4,violationCount:4,action:"mute",muteMinutes:60,notice:"final"},{sendFails}); await f.run();
    const action=f.actions.at(-1)!; assert.equal(action.kind,"SEND_TEXT");
    if(action.kind==="SEND_TEXT") { assert.match(action.text,/@member/); assert.match(action.text,/last warning/i); assert.match(action.text,/again.*removed/i); }
    assert.equal(f.receipts.find(r=>r.name==="finish_quiet_moderation_notice")?.args.p_public_message_id,sendFails?null:"99");
  }
});
test("fifth kicks silently only with authorized final history; missing final means extended mute", async () => {
  const kick=fixture({...base,stage:5,violationCount:5,action:"kick",notice:null}); await kick.run();
  assert.equal(kick.actions.length,1); assert.equal(kick.purges,1);
  const held=fixture({...base,stage:5,violationCount:5,action:"mute",muteMinutes:60,notice:null,heldForFinalWarning:true}); await held.run();
  assert.equal(held.purges,0); assert.ok(held.actions.every(a=>a.kind==="RESTRICT_USER" && a.mode==="MUTE"));
});
test("expired reservation and missing ledger fail closed without public text or false success", async () => {
  const stale=fixture(base,{valid:false}); await stale.run(); assert.deepEqual(stale.actions,[]);
  assert.equal(stale.receipts.find(r=>r.name==="finish_quiet_moderation_notice")?.args.p_public_message_id,null);
  const missing=fixture(null); await missing.run(); assert.deepEqual(missing.actions,[]); assert.ok(missing.writes.some(w=>w.decision==="QUIET_POLICY_UNAVAILABLE"));
});
