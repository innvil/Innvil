"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getModerationDefaults, applyModerationDefaultPreset, clearModerationDefaultPreset,
  setModerationDefaultDescription, setModerationDefaultCustomInstructions,
} from "@/src/lib/products/watch-moderation-defaults";
import { DEFAULT_MODERATOR_PERSONA, type ModeratorPersona } from "@/src/lib/moderator/domain";

export async function getWatchModerationDefaults(): Promise<ModeratorPersona> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ...DEFAULT_MODERATOR_PERSONA };
  return getModerationDefaults(admin, user.id);
}

export async function applyWatchModerationDefaultPreset(presetId: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false as const, error: "Not signed in." };
  return applyModerationDefaultPreset(admin, user.id, presetId);
}

export async function clearWatchModerationDefaultPreset() {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false as const, error: "Not signed in." };
  return clearModerationDefaultPreset(admin, user.id);
}

export async function setWatchModerationDefaultDescription(description: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false as const, error: "Not signed in." };
  return setModerationDefaultDescription(admin, user.id, description);
}

export async function setWatchModerationDefaultCustomInstructions(customInstructions: string) {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false as const, error: "Not signed in." };
  return setModerationDefaultCustomInstructions(admin, user.id, customInstructions);
}
