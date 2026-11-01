"use server";

/**
 * Superadmin-only CRUD for innvil_bot_manager's proactive marketing
 * campaigns (Phase 4.Q, second half — see bot-manager-campaign-runtime.ts
 * for the actual send sweep this data feeds). Nothing here ever sends a
 * Telegram message directly — creating/editing/approving/scheduling a
 * campaign only ever writes campaign STATE; only the cron sweep
 * (sweepBotManagerCampaigns) reads that state and actually sends, on its
 * own next tick. This mirrors the same "editing config never itself
 * triggers a send" discipline already established for Auto-Posting and
 * Presence Scheduling's owner-facing actions.
 *
 * Same requireSuperAdmin() role-check pattern as every other superadmin
 * action file in this codebase (superadmin.ts / superadmin-watch-devops.ts)
 * -- never a UI-only gate; every export independently re-verifies the role
 * server-side.
 */

import { createAdminClient } from "@/src/lib/supabase/admin";
import { getAuthedAdmin } from "@/src/lib/auth";

// NOTE: bot-manager-campaign-audience.ts's chatTypesForAudience is a plain,
// synchronous, pure function -- it is deliberately NEVER re-exported from
// this file. Every export of a "use server" module must be an async
// function (Next's own Server Actions rule, not caught by tsc) --
// re-exporting a non-async value here would silently break this entire
// actions bundle at module-evaluation time, the exact incident already
// documented in this codebase's history (v1.23.4). Consumers import
// chatTypesForAudience directly from bot-manager-campaign-audience.ts.

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function requireSuperAdmin(): Promise<{ ok: true } | { ok: false }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false };
  const { data } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (data?.role !== "super_admin") return { ok: false };
  return { ok: true };
}

export type CampaignType = "marketing_broadcast" | "product_announcement" | "release_update" | "service_notice" | "educational_tip";
export type TargetAudience = "all" | "private_users" | "groups" | "channels";
export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export interface BotManagerCampaignRow {
  id: string;
  campaignType: CampaignType;
  message: string;
  targetAudience: TargetAudience;
  status: CampaignStatus;
  approved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdBy: string | null;
  createdAt: string;
  sendCount: number;
  errorCount: number;
}

export interface KnownChatSummary {
  total: number;
  marketingEnabled: number;
  byType: Record<string, number>;
}

const CAMPAIGN_TYPES: CampaignType[] = ["marketing_broadcast", "product_announcement", "release_update", "service_notice", "educational_tip"];
const TARGET_AUDIENCES: TargetAudience[] = ["all", "private_users", "groups", "channels"];

function mapRow(r: Record<string, unknown>, sendCount: number, errorCount: number): BotManagerCampaignRow {
  return {
    id: r.id as string,
    campaignType: r.campaign_type as CampaignType,
    message: r.message as string,
    targetAudience: r.target_audience as TargetAudience,
    status: r.status as CampaignStatus,
    approved: Boolean(r.approved),
    approvedBy: (r.approved_by as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    scheduledAt: (r.scheduled_at as string | null) ?? null,
    sentAt: (r.sent_at as string | null) ?? null,
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string,
    sendCount,
    errorCount,
  };
}

export async function listCampaigns(): Promise<Result<BotManagerCampaignRow[]>> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const admin = createAdminClient();
  const { data, error } = await admin.from("bot_manager_campaigns").select("*").order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  const rows = data ?? [];
  const ids = rows.map((r: { id: string }) => r.id);
  const { data: sends } = ids.length ? await admin.from("bot_manager_campaign_sends").select("campaign_id, error").in("campaign_id", ids) : { data: [] };
  const counts = new Map<string, { send: number; err: number }>();
  for (const s of (sends ?? []) as Array<{ campaign_id: string; error: string | null }>) {
    const c = counts.get(s.campaign_id) ?? { send: 0, err: 0 };
    c.send += 1;
    if (s.error) c.err += 1;
    counts.set(s.campaign_id, c);
  }
  return { ok: true, data: rows.map((r: Record<string, unknown>) => { const c = counts.get(r.id as string) ?? { send: 0, err: 0 }; return mapRow(r, c.send, c.err); }) };
}

export async function createCampaign(input: { campaignType: CampaignType; message: string; targetAudience: TargetAudience }): Promise<Result<{ id: string }>> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  if (!CAMPAIGN_TYPES.includes(input.campaignType)) return { ok: false, error: "Invalid campaign type" };
  if (!TARGET_AUDIENCES.includes(input.targetAudience)) return { ok: false, error: "Invalid target audience" };
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Message is required" };
  if (message.length > 4000) return { ok: false, error: "Message is too long" };
  const { user, admin } = await getAuthedAdmin();
  const { data, error } = await admin.from("bot_manager_campaigns").insert({
    campaign_type: input.campaignType, message, target_audience: input.targetAudience,
    status: "draft", approved: false, created_by: user?.id ?? null,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { id: data.id } };
}

export async function updateCampaignMessage(id: string, message: string): Promise<Result> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "Message is required" };
  const admin = createAdminClient();
  // A campaign's copy is only editable while it hasn't started sending --
  // once real sends exist for it, mutating the message would make already-
  // delivered copies disagree with what a fresh send produces.
  const { data: existing } = await admin.from("bot_manager_campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "Campaign not found" };
  if (existing.status !== "draft" && existing.status !== "scheduled") return { ok: false, error: "Cannot edit a campaign that has already started sending" };
  const { error } = await admin.from("bot_manager_campaigns").update({ message: trimmed }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Approval is the hard gate -- nothing sends until this is set true, per
 *  the spec's own "9. Campaign controls, not unrestricted auto-posting."
 *  Never itself schedules or sends -- schedules/sends only happen via
 *  scheduleCampaign + the cron sweep. */
export async function approveCampaign(id: string, approved: boolean): Promise<Result> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const { user, admin } = await getAuthedAdmin();
  const { error } = await admin.from("bot_manager_campaigns").update({
    approved, approved_by: approved ? (user?.id ?? null) : null, approved_at: approved ? new Date().toISOString() : null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Moves a draft campaign into 'scheduled' -- the cron sweep only ever
 *  claims a campaign that is BOTH approved and 'scheduled', so this alone
 *  does not send anything (approval is the separate, required gate). A
 *  null scheduledAt means "send as soon as approved and picked up by the
 *  next sweep tick," not "send immediately from this action." */
export async function scheduleCampaign(id: string, scheduledAt: string | null): Promise<Result> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const admin = createAdminClient();
  const { data: existing } = await admin.from("bot_manager_campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "Campaign not found" };
  if (existing.status !== "draft" && existing.status !== "scheduled") return { ok: false, error: "Campaign is not schedulable from its current status" };
  const { error } = await admin.from("bot_manager_campaigns").update({ status: "scheduled", scheduled_at: scheduledAt }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function cancelCampaign(id: string): Promise<Result> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const admin = createAdminClient();
  const { data: existing } = await admin.from("bot_manager_campaigns").select("status").eq("id", id).maybeSingle();
  if (!existing) return { ok: false, error: "Campaign not found" };
  if (existing.status === "sent") return { ok: false, error: "Campaign has already fully sent" };
  const { error } = await admin.from("bot_manager_campaigns").update({ status: "cancelled" }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

/** Real visibility into how many chats a campaign could actually reach,
 *  broken down by the same audience categories the sweep itself resolves
 *  via chatTypesForAudience -- so a superadmin can see "0 eligible chats"
 *  before approving/scheduling a campaign that would otherwise silently
 *  complete with zero real sends. */
export async function getKnownChatsSummary(): Promise<Result<KnownChatSummary>> {
  const gate = await requireSuperAdmin();
  if (!gate.ok) return { ok: false, error: "Not authorized" };
  const admin = createAdminClient();
  const { data, error } = await admin.from("bot_manager_chats").select("chat_type, marketing_enabled");
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{ chat_type: string; marketing_enabled: boolean }>;
  const byType: Record<string, number> = {};
  let marketingEnabled = 0;
  for (const r of rows) {
    if (r.marketing_enabled) {
      marketingEnabled += 1;
      byType[r.chat_type] = (byType[r.chat_type] ?? 0) + 1;
    }
  }
  return { ok: true, data: { total: rows.length, marketingEnabled, byType } };
}
