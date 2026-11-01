"use server";

import { getAuthedAdmin } from "@/src/lib/auth";
import {
  getNotificationPreferences, setNotificationCategory, sendTestNotificationEmail,
  type NotificationPreferences, type SendTestNotificationResult,
} from "@/src/lib/products/watch-notifications";

export async function getWatchNotificationPreferences(): Promise<NotificationPreferences> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { noActiveWatcherEnabled: true, capacityWarningEnabled: true, watcherStatusEnabled: true };
  return getNotificationPreferences(admin, user.id);
}

export async function setWatchNotificationCategory(
  category: "noActiveWatcher" | "capacityWarning" | "watcherStatus",
  enabled: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  await setNotificationCategory(admin, user.id, category, enabled);
  return { ok: true };
}

export async function sendWatchTestNotification(): Promise<SendTestNotificationResult> {
  const { user, admin } = await getAuthedAdmin();
  if (!user) return { ok: false, error: "Not signed in." };
  return sendTestNotificationEmail(admin, user.id);
}
