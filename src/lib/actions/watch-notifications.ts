"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import { getNotificationPreferences, setNotificationPreferences } from "@/src/lib/products/watch-notifications";

export async function getWatchNotificationPreferences(): Promise<{ attentionAlertsEnabled: boolean }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { attentionAlertsEnabled: true };
  return getNotificationPreferences(admin, user.id);
}

export async function setWatchNotificationPreferences(attentionAlertsEnabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  await setNotificationPreferences(admin, user.id, attentionAlertsEnabled);
  return { ok: true };
}
