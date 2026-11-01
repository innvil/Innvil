import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountPreferences } from "./watch-datetime";

/**
 * Real account-level General preferences (migration 0076) -- timezone +
 * 12h/24h time display, used to format ABSOLUTE timestamps wherever this
 * account views them. Genuinely separate from `communities.timezone`
 * (Auto-Posting's per-Community scheduling input, migration 0055) -- this
 * is a display preference, not a scheduling input, and never overrides a
 * Community's own timezone. The pure formatting function itself lives in
 * the client-safe `watch-datetime.ts` (no `server-only`), mirroring the
 * `watch-status.ts` extraction pattern already used elsewhere in this
 * codebase -- re-exported here so server callers only need one import.
 */

export type { AccountPreferences };

const DEFAULT_PREFERENCES: AccountPreferences = { timezone: "UTC", timeFormat: "24h" };

export async function getAccountPreferences(admin: SupabaseClient, accountId: string): Promise<AccountPreferences> {
  const { data } = await admin
    .from("watch_account_preferences")
    .select("timezone, time_format")
    .eq("account_id", accountId)
    .maybeSingle();
  if (data) return { timezone: data.timezone as string, timeFormat: data.time_format as "12h" | "24h" };

  await admin.from("watch_account_preferences").upsert(
    { account_id: accountId, timezone: DEFAULT_PREFERENCES.timezone, time_format: DEFAULT_PREFERENCES.timeFormat },
    { onConflict: "account_id" }
  );
  return DEFAULT_PREFERENCES;
}

export type SetAccountPreferencesResult = { ok: true } | { ok: false; error: string };

export async function setAccountPreferences(
  admin: SupabaseClient,
  accountId: string,
  timezone: string,
  timeFormat: "12h" | "24h"
): Promise<SetAccountPreferencesResult> {
  const trimmed = timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
  } catch {
    return { ok: false, error: "Invalid timezone (use an IANA name, e.g. Asia/Manila)." };
  }
  await admin.from("watch_account_preferences").upsert(
    { account_id: accountId, timezone: trimmed, time_format: timeFormat, updated_at: new Date().toISOString() },
    { onConflict: "account_id" }
  );
  return { ok: true };
}

export { formatAccountDateTime } from "./watch-datetime";
