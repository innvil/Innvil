/**
 * Pure, client-safe (no `server-only`) date/time formatting for Watch's
 * account-level General preferences (migration 0076) -- extracted into its
 * own module, same pattern already established by `watch-status.ts`, so a
 * "use client" component (e.g. ConnectTelegramCard) can format a timestamp
 * per the account's preference without pulling `watch-account-preferences
 * .ts`'s `server-only` module graph (Supabase admin, etc.) into the client
 * bundle.
 */

export interface AccountPreferences {
  timezone: string;
  timeFormat: "12h" | "24h";
}

/** A curated, common set of IANA timezones for the General preferences
 *  dropdown -- not the full ~400-zone IANA database (which would be
 *  overkill for a single account-level display preference), but enough
 *  real coverage across every UTC offset that most users find their own
 *  city/region directly. `setAccountPreferences` still validates against
 *  the REAL IANA database (`Intl.DateTimeFormat`), so this list is a UX
 *  convenience only, never the source of truth for what's valid. */
export const COMMON_TIMEZONES: string[] = [
  "UTC",
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Chicago", "America/New_York", "America/Sao_Paulo", "Atlantic/Azores",
  "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
  "Europe/Athens", "Europe/Moscow", "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos",
  "Asia/Dubai", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Jakarta",
  "Asia/Singapore", "Asia/Manila", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Perth", "Australia/Sydney", "Pacific/Auckland",
];

/** The current clock time in `timezone`, rendered in the given format —
 *  e.g. "16:45" or "4:45 PM" — used as a LIVE example next to the time-
 *  format dropdown so it visibly reflects whichever timezone is currently
 *  selected, instead of a static "2:30 PM" that never changes. Falls back
 *  to UTC for an invalid timezone rather than throwing. */
export function currentTimeExample(timezone: string, format: "12h" | "24h"): string {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", hour12: format === "12h", timeZone: timezone };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date());
  }
}

/** Human-friendly dropdown label — "Asia/Manila (UTC+08:00)" — computed
 *  live via Intl so it's never a stale hardcoded offset (some zones'
 *  offsets shift with DST). Falls back to the bare zone name if, for any
 *  reason, the offset can't be resolved. */
export function timezoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    return offset ? `${tz.replace(/_/g, " ")} (${offset})` : tz.replace(/_/g, " ");
  } catch {
    return tz.replace(/_/g, " ");
  }
}

/** Formats an absolute ISO timestamp per the account's own timezone/time-
 *  format preference. Pure -- takes the preference as a parameter rather
 *  than fetching it, so callers control exactly which preference object is
 *  used and this stays trivially testable without a DB. Falls back to a
 *  safe UTC rendering if the stored timezone is somehow invalid (e.g.
 *  edited directly in the DB) rather than throwing on an ordinary page
 *  render. */
export function formatAccountDateTime(iso: string, prefs: AccountPreferences): string {
  const date = new Date(iso);
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    hour12: prefs.timeFormat === "12h",
    timeZone: prefs.timezone,
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}
