/**
 * Platform focus — a panel can be scoped to ONE social platform (e.g. Telegram-only)
 * or left as all-platforms (default). A focused panel gets platform-specific landing
 * marketing (via the content pack) AND a hard catalog filter (storefront shows only
 * that platform's services). Stored on panels.settings.platformFocus. Pure/serializable.
 *
 * We add platforms one at a time — only the ones listed here are selectable.
 */

export type PlatformFocus = "telegram";

export interface PlatformFocusOption {
  key: PlatformFocus;
  label: string;
  /** Service `platform` keys that count as this focus (usually just the key). */
  platforms: string[];
}

/** Selectable focuses (grows one platform at a time). null/absent = all platforms. */
export const PLATFORM_FOCUS_OPTIONS: PlatformFocusOption[] = [
  { key: "telegram", label: "Telegram", platforms: ["telegram"] },
];

export function platformFocusOption(key: string | null): PlatformFocusOption | null {
  return PLATFORM_FOCUS_OPTIONS.find((o) => o.key === key) ?? null;
}

export function readPlatformFocus(settings: unknown): PlatformFocus | null {
  if (settings && typeof settings === "object") {
    const f = (settings as Record<string, unknown>).platformFocus;
    if (typeof f === "string" && PLATFORM_FOCUS_OPTIONS.some((o) => o.key === f)) return f as PlatformFocus;
  }
  return null;
}

export function normalizePlatformFocus(v: unknown): PlatformFocus | null {
  return typeof v === "string" && PLATFORM_FOCUS_OPTIONS.some((o) => o.key === v) ? (v as PlatformFocus) : null;
}

/** The service `platform` keys a focus permits (empty = no restriction / all). */
export function focusPlatforms(focus: PlatformFocus | null): string[] {
  return platformFocusOption(focus)?.platforms ?? [];
}

/** Whether a service platform key is allowed under this focus (true when unfocused). */
export function platformAllowedByFocus(focus: PlatformFocus | null, platform: string | null | undefined): boolean {
  const allow = focusPlatforms(focus);
  if (allow.length === 0) return true;
  return !!platform && allow.includes(platform.toLowerCase());
}
