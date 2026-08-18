import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeModeratorPersona, DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "@/src/lib/moderator/domain";
import { resolvePersonaPreset, applyPersonaPreset } from "@/src/lib/moderator/presets";

/**
 * Real account-level Moderation Defaults (migration 0077) -- the persona a
 * newly-created Watcher starts from, instead of always the same hardcoded
 * DEFAULT_MODERATOR_PERSONA. Mirrors watch-watcher-persona.ts's per-Watcher
 * editing functions exactly (same pure persona logic from
 * moderator/domain.ts / moderator/presets.ts), just persisted against
 * watch_moderation_defaults instead of a specific virtual_moderators row.
 */

export async function getModerationDefaults(admin: SupabaseClient, accountId: string): Promise<ModeratorPersona> {
  const { data } = await admin.from("watch_moderation_defaults").select("persona").eq("account_id", accountId).maybeSingle();
  if (!data) return { ...DEFAULT_MODERATOR_PERSONA };
  return normalizeModeratorPersona(data.persona);
}

async function writePersona(admin: SupabaseClient, accountId: string, persona: ModeratorPersona): Promise<void> {
  await admin.from("watch_moderation_defaults").upsert(
    { account_id: accountId, persona, updated_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
}

export type ModerationDefaultsResult = { ok: true } | { ok: false; error: string };

export async function applyModerationDefaultPreset(admin: SupabaseClient, accountId: string, presetId: string): Promise<ModerationDefaultsResult> {
  const preset = resolvePersonaPreset(presetId);
  if (!preset) return { ok: false, error: "Unknown persona preset." };
  const current = await getModerationDefaults(admin, accountId);
  await writePersona(admin, accountId, applyPersonaPreset(current, preset));
  return { ok: true };
}

export async function clearModerationDefaultPreset(admin: SupabaseClient, accountId: string): Promise<ModerationDefaultsResult> {
  const current = await getModerationDefaults(admin, accountId);
  await writePersona(admin, accountId, { ...current, presetId: null });
  return { ok: true };
}

export async function setModerationDefaultDescription(admin: SupabaseClient, accountId: string, description: string): Promise<ModerationDefaultsResult> {
  const current = await getModerationDefaults(admin, accountId);
  await writePersona(admin, accountId, { ...current, description: description.trim().slice(0, 300) });
  return { ok: true };
}

export async function setModerationDefaultCustomInstructions(admin: SupabaseClient, accountId: string, customInstructions: string): Promise<ModerationDefaultsResult> {
  const current = await getModerationDefaults(admin, accountId);
  await writePersona(admin, accountId, { ...current, customInstructions: customInstructions.slice(0, 2000) });
  return { ok: true };
}

/** Resets this account's Moderation Defaults back to the real canonical
 *  platform default (`DEFAULT_MODERATOR_PERSONA`, `moderator/domain.ts` —
 *  the exact same values a brand-new Watcher gets when no account default
 *  is configured at all), not a fabricated "factory reset" shape. */
export async function resetModerationDefaults(admin: SupabaseClient, accountId: string): Promise<ModerationDefaultsResult> {
  await writePersona(admin, accountId, { ...DEFAULT_MODERATOR_PERSONA });
  return { ok: true };
}
