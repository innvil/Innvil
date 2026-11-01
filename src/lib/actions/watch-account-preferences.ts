"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getAccountPreferences, setAccountPreferences, type AccountPreferences, type SetAccountPreferencesResult,
} from "@/src/lib/products/watch-account-preferences";

export async function getWatchAccountPreferences(): Promise<AccountPreferences> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { timezone: "UTC", timeFormat: "24h" };
  return getAccountPreferences(admin, user.id);
}

export async function setWatchAccountPreferences(timezone: string, timeFormat: "12h" | "24h"): Promise<SetAccountPreferencesResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return setAccountPreferences(admin, user.id, timezone, timeFormat);
}
