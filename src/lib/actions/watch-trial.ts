"use server";

/**
 * Thin auth wrappers around the session-less core in
 * src/lib/products/watch-trial.ts — every export re-derives the account
 * from the authenticated session, never a client-supplied id (same
 * established pattern as watch-dashboard.ts).
 */

import { getAuthedAdmin } from "@/src/lib/auth";
import { getWatchTrialState, startWatchTrial } from "@/src/lib/products/watch-trial";
import type { WatchTrialState, StartWatchTrialResult } from "@/src/lib/products/watch-trial";

export async function getWatchTrialStateAction(): Promise<WatchTrialState> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { status: "telegram_required", startedAt: null, endsAt: null };
  return getWatchTrialState(admin, user.id);
}

export async function startWatchTrialAction(): Promise<StartWatchTrialResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return startWatchTrial(admin, user.id);
}
