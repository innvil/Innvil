"use server";

/**
 * Account-scoped Watcher persona editing — mirrors `actions/moderator.ts`'s
 * `applyModeratorPersonaPreset`/`clearModeratorPersonaPreset`/
 * `setModeratorCustomInstructions`/`setModeratorPersonaDescription` exactly
 * (same pure persona logic from `moderator/presets.ts`/`moderator/domain.ts`),
 * with the ownership check scoped to `virtual_moderators.account_id` instead
 * of `panels.owner_id` — the owner-side file's `virtual_moderators` table has
 * no account-scoped path, so a standalone Watch account could read a
 * Watcher's persona (`watch-runtime.ts` already selects it) but never edit
 * it. Deliberately a local, duplicated ownership check (matching this
 * codebase's own convention — `moderator.ts`, `customer-moderator.ts`, and
 * `watch-moderator.ts` each keep their own local variant rather than sharing
 * one across "use server" files).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { normalizeModeratorPersona } from "@/src/lib/moderator/domain";
import { resolvePersonaPreset, applyPersonaPreset } from "@/src/lib/moderator/presets";

type Result<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function ownedWatcher(moderatorId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return null;
  const { data: moderator } = await admin.from("virtual_moderators").select("id, account_id, persona").eq("id", moderatorId).maybeSingle();
  if (!moderator || moderator.account_id !== user.id) return null;
  return { admin, moderator };
}

export async function applyAccountWatcherPersonaPreset(moderatorId: string, presetId: string): Promise<Result> {
  const ctx = await ownedWatcher(moderatorId);
  if (!ctx) return { ok: false, error: "Watcher not found." };
  const preset = resolvePersonaPreset(presetId);
  if (!preset) return { ok: false, error: "Unknown persona preset." };
  const persona = applyPersonaPreset(normalizeModeratorPersona(ctx.moderator.persona), preset);
  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function clearAccountWatcherPersonaPreset(moderatorId: string): Promise<Result> {
  const ctx = await ownedWatcher(moderatorId);
  if (!ctx) return { ok: false, error: "Watcher not found." };
  const persona = normalizeModeratorPersona(ctx.moderator.persona);
  persona.presetId = null;
  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function setAccountWatcherCustomInstructions(moderatorId: string, customInstructions: string): Promise<Result> {
  const ctx = await ownedWatcher(moderatorId);
  if (!ctx) return { ok: false, error: "Watcher not found." };
  const persona = normalizeModeratorPersona(ctx.moderator.persona);
  persona.customInstructions = customInstructions.slice(0, 2000);
  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function setAccountWatcherPersonaDescription(moderatorId: string, description: string): Promise<Result> {
  const ctx = await ownedWatcher(moderatorId);
  if (!ctx) return { ok: false, error: "Watcher not found." };
  const persona = normalizeModeratorPersona(ctx.moderator.persona);
  persona.description = description.trim().slice(0, 300);
  const { error } = await ctx.admin.from("virtual_moderators").update({ persona }).eq("id", moderatorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}
