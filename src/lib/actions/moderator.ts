"use server";

/**
 * Virtual Moderator — owner-facing server actions.
 *
 * Phase 1 checkpoint: minimal CRUD against the new domain tables (list/create
 * VirtualModerator, read the panel's Moderator add-on/capacity). Provisioning
 * (Telegram Managed Bot creation, BotFather fallback, deployments, runtime)
 * lands in the next phases — the old collapsed-record actions (draft/commercial/
 * spam saved onto panels.settings.moderator) are gone; nothing else in the repo
 * still calls them.
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { DEFAULT_MODERATOR_PERSONA, DEFAULT_PROVISIONING_DRAFT } from "@/src/lib/moderator/domain";
import { hasVirtualModerator, moderatorCapacity, readModeratorAddon } from "@/src/lib/moderator/plan";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ownedPanel(panelId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: panel } = await admin.from("panels").select("id, owner_id, settings").eq("id", panelId).maybeSingle();
  if (!panel || panel.owner_id !== user.id) return null;
  return { user, admin, panel };
}

export interface VirtualModeratorRow {
  id: string;
  name: string;
  status: string;
  provisioningStatus: string;
  telegramUsername: string | null;
}

export async function listVirtualModerators(panelId: string): Promise<VirtualModeratorRow[]> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return [];
  const { data } = await ctx.admin
    .from("virtual_moderators")
    .select("id, name, status, provisioning_status, telegram_bot_integrations(username)")
    .eq("panel_id", panelId)
    .order("created_at", { ascending: true });
  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => {
    const integration = row.telegram_bot_integrations as { username?: string | null } | Array<{ username?: string | null }> | null;
    const username = Array.isArray(integration) ? integration[0]?.username ?? null : integration?.username ?? null;
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      provisioningStatus: String(row.provisioning_status),
      telegramUsername: username ?? null,
    };
  });
}

export interface ModeratorPlanInfo {
  offered: boolean;
  tier: ReturnType<typeof readModeratorAddon>["tier"];
  commercialMode: ReturnType<typeof readModeratorAddon>["commercialMode"];
  maxCommunities: number;
  maxActiveSlots: number;
}

export async function getModeratorPlanInfo(panelId: string): Promise<ModeratorPlanInfo | null> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return null;
  const addon = readModeratorAddon(ctx.panel.settings);
  const capacity = moderatorCapacity(ctx.panel.settings);
  return {
    offered: hasVirtualModerator(ctx.panel.settings),
    tier: addon.tier,
    commercialMode: addon.commercialMode,
    maxCommunities: capacity.maxCommunities,
    maxActiveSlots: capacity.maxActiveSlots,
  };
}

export async function createVirtualModerator(panelId: string, name: string): Promise<Result<VirtualModeratorRow>> {
  const ctx = await ownedPanel(panelId);
  if (!ctx) return { ok: false, error: "Panel not found." };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "Name is required." };
  if (trimmed.length > 60) return { ok: false, error: "Name is too long." };

  const { data, error } = await ctx.admin
    .from("virtual_moderators")
    .insert({
      panel_id: panelId,
      name: trimmed,
      persona: DEFAULT_MODERATOR_PERSONA,
      provisioning_draft: DEFAULT_PROVISIONING_DRAFT,
    })
    .select("id, name, status, provisioning_status")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create moderator." };

  return {
    ok: true,
    data: {
      id: data.id,
      name: data.name,
      status: data.status,
      provisioningStatus: data.provisioning_status,
      telegramUsername: null,
    },
  };
}
