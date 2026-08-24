import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/src/lib/supabase/admin";
import { telegramApiCall } from "./telegram-client";
import { chatTypesForAudience, type CampaignTargetAudience } from "./bot-manager-campaign-audience";

/* =========================================================
   innvil_bot_manager — proactive marketing-campaign SEND path (Phase 4.Q,
   the second half of innvil-bot-manager-spec.md, deliberately deferred at
   v1.20.0 alongside the reactive-support half). Approved-campaign-only
   (spec "9. Campaign controls, not unrestricted auto-posting") -- AI may
   help write the copy elsewhere, but nothing sends until a superadmin sets
   `approved = true`. Every send uses innvil_bot_manager's own credential
   (INNVIL_OFFICIAL_BOT_TOKEN) -- never TELEGRAM_MANAGER_BOT_TOKEN (the
   control-plane-only Manager Bot, which never posts customer/community-
   facing content, per every other pass that's touched it).

   Idempotent + bounded, mirroring autopost-runtime.ts's/presence-runtime.ts's
   established shape: a campaign transitions scheduled -> sending via a
   conditional UPDATE (so two concurrent sweeps can't both claim it), then
   each sweep tick sends to a BOUNDED batch of not-yet-sent target chats
   (never the whole audience at once -- a large campaign spreads across
   several 5-minute ticks rather than risking a function timeout). The
   per-(campaign,chat) unique constraint on bot_manager_campaign_sends is
   the real duplicate-send guard -- a retried/overlapping sweep can never
   double-send to the same chat for the same campaign. A campaign moves to
   'sent' only once every currently-known eligible chat has a real send
   record (success or failure) for it.
   ========================================================= */

const MAX_SENDS_PER_SWEEP = 25;

function botManagerToken(): string {
  const token = process.env.INNVIL_OFFICIAL_BOT_TOKEN?.trim();
  if (!token) throw new Error("INNVIL_OFFICIAL_BOT_TOKEN is not set");
  return token;
}

interface CampaignRow {
  id: string;
  message: string;
  target_audience: CampaignTargetAudience;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  approved: boolean;
  scheduled_at: string | null;
}

async function claimCampaignStatus(admin: SupabaseClient, id: string, from: string, to: string, patch: Record<string, unknown> = {}): Promise<boolean> {
  const { data, error } = await admin.from("bot_manager_campaigns").update({ status: to, ...patch }).eq("id", id).eq("status", from).select("id");
  if (error) { console.error(`[bot-manager-campaigns] claim ${from}->${to} failed`, error); return false; }
  return (data?.length ?? 0) > 0;
}

/** Approved, scheduled, and DUE campaigns move to 'sending' -- a due
 *  campaign has either no scheduled_at (send as soon as approved) or one
 *  that's already passed. Never claims a campaign that isn't both approved
 *  AND still in 'scheduled' status (draft/sending/sent/cancelled are all
 *  correctly untouched here). */
async function claimDueCampaigns(admin: SupabaseClient, now: Date): Promise<void> {
  const { data: due } = await admin
    .from("bot_manager_campaigns")
    .select("id, scheduled_at")
    .eq("status", "scheduled")
    .eq("approved", true);
  for (const c of (due ?? []) as Array<{ id: string; scheduled_at: string | null }>) {
    if (c.scheduled_at && new Date(c.scheduled_at).getTime() > now.getTime()) continue; // not due yet
    await claimCampaignStatus(admin, c.id, "scheduled", "sending");
  }
}

/** Sends a bounded batch of not-yet-sent target chats for every campaign
 *  currently `sending`. A campaign with zero remaining eligible,
 *  not-yet-sent chats is marked 'sent' -- real completion, not a timeout
 *  guess. Bounded globally (across all concurrently-sending campaigns) by
 *  MAX_SENDS_PER_SWEEP, so one large campaign can never starve another's
 *  progress within a single sweep tick. */
async function sendDueBatch(admin: SupabaseClient, now: Date): Promise<void> {
  const { data: sending } = await admin
    .from("bot_manager_campaigns")
    .select("id, message, target_audience, status, approved, scheduled_at")
    .eq("status", "sending");
  if (!sending || sending.length === 0) return;

  let budget = MAX_SENDS_PER_SWEEP;
  const token = botManagerToken();

  for (const campaign of sending as CampaignRow[]) {
    if (budget <= 0) break;

    const chatTypes = chatTypesForAudience(campaign.target_audience);
    let chatQuery = admin.from("bot_manager_chats").select("chat_id").eq("marketing_enabled", true);
    if (chatTypes) chatQuery = chatQuery.in("chat_type", chatTypes);
    const { data: eligibleChats } = await chatQuery;
    const eligibleIds = (eligibleChats ?? []).map((r: { chat_id: string }) => r.chat_id);

    if (eligibleIds.length === 0) {
      // Nothing eligible at all (e.g. zero opted-in chats for this
      // audience) -- a real, honest completion, not stuck forever.
      await claimCampaignStatus(admin, campaign.id, "sending", "sent", { sent_at: now.toISOString() });
      continue;
    }

    const { data: alreadySent } = await admin.from("bot_manager_campaign_sends").select("chat_id").eq("campaign_id", campaign.id).in("chat_id", eligibleIds);
    const sentIds = new Set((alreadySent ?? []).map((r: { chat_id: string }) => r.chat_id));
    const remaining = eligibleIds.filter((id: string) => !sentIds.has(id));

    if (remaining.length === 0) {
      await claimCampaignStatus(admin, campaign.id, "sending", "sent", { sent_at: now.toISOString() });
      continue;
    }

    const batch = remaining.slice(0, budget);
    for (const chatId of batch) {
      const sent = await telegramApiCall<{ message_id: number }>(token, "sendMessage", { chat_id: chatId, text: campaign.message });
      const { error } = await admin.from("bot_manager_campaign_sends").insert({
        campaign_id: campaign.id, chat_id: chatId,
        telegram_message_id: sent.ok ? String(sent.result.message_id) : null,
        error: sent.ok ? null : sent.error,
      });
      // 23505 (unique-violation) means a concurrent/retried sweep already
      // recorded this exact (campaign, chat) send -- a harmless race loss,
      // never a real failure. Any OTHER insert error is logged but never
      // blocks the rest of the batch (one bad chat shouldn't stall a
      // whole campaign).
      if (error && error.code !== "23505") console.error("[bot-manager-campaigns] failed to record send", campaign.id, chatId, error);
      if (sent.ok) {
        await admin.from("bot_manager_chats").update({ last_marketing_message_at: now.toISOString() }).eq("chat_id", chatId);
      } else {
        console.error("[bot-manager-campaigns] send failed", campaign.id, chatId, sent.error);
      }
      budget -= 1;
      if (budget <= 0) break;
    }
  }
}

export async function sweepBotManagerCampaigns(admin: SupabaseClient = createAdminClient(), now: Date = new Date()): Promise<{ ok: true }> {
  await claimDueCampaigns(admin, now);
  await sendDueBatch(admin, now);
  return { ok: true };
}
