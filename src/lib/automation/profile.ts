/**
 * Customer automation profile (v2). Each CUSTOMER configures, per platform, a set of
 * "slots" — each slot = a panel service + quantity + optional keywords. When a campaign
 * link's platform matches, the engine fires the slots whose keywords appear in the link
 * (substring match), falling back to keyword-less slots when none match. Replaces the
 * owner-preset / regular-priority model. Pure/serialisable.
 *
 * Stored per (panel_id, customer_id) in automation_profiles.config.
 */

export interface AutomationSlot {
  /** Local id (UI + dedupe). */
  id: string;
  /** The panel service to order (uuid). */
  serviceId: string;
  quantity: number;
  /** Lower-cased keywords; a link matches if it contains ANY. Empty = default slot. */
  keywords: string[];
}

export interface AutomationProfile {
  /** platform key → ordered slots. */
  platforms: Record<string, AutomationSlot[]>;
}

export function emptyProfile(): AutomationProfile {
  return { platforms: {} };
}

let SEQ = 0;
export function makeSlot(serviceId = "", quantity = 0): AutomationSlot {
  return { id: `slot_${Date.now().toString(36)}_${SEQ++}`, serviceId, quantity, keywords: [] };
}

function cleanKeywords(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
}

/** Parse/repair a stored profile config. */
export function readAutomationProfile(config: unknown): AutomationProfile {
  const out: AutomationProfile = { platforms: {} };
  if (!config || typeof config !== "object") return out;
  const platforms = (config as Record<string, unknown>).platforms;
  if (!platforms || typeof platforms !== "object") return out;
  for (const [platform, rawSlots] of Object.entries(platforms as Record<string, unknown>)) {
    if (!Array.isArray(rawSlots)) continue;
    const slots: AutomationSlot[] = [];
    for (const r of rawSlots) {
      if (!r || typeof r !== "object") continue;
      const o = r as Record<string, unknown>;
      const serviceId = typeof o.serviceId === "string" ? o.serviceId : "";
      const quantity = Number(o.quantity);
      if (!serviceId || !Number.isFinite(quantity) || quantity <= 0) continue;
      slots.push({
        id: typeof o.id === "string" && o.id ? o.id : makeSlot().id,
        serviceId,
        quantity: Math.round(quantity),
        keywords: cleanKeywords(o.keywords),
      });
    }
    if (slots.length) out.platforms[platform] = slots;
  }
  return out;
}

/** Sanitise a profile before saving (drop invalid slots, only allowed platforms). */
export function normalizeAutomationProfile(
  profile: AutomationProfile,
  allowedPlatforms: string[] | null,
  validServiceIds: Set<string>,
): AutomationProfile {
  const out: AutomationProfile = { platforms: {} };
  for (const [platform, slots] of Object.entries(profile.platforms ?? {})) {
    if (allowedPlatforms !== null && !allowedPlatforms.includes(platform)) continue;
    const kept = (slots ?? []).filter(
      (s) => s.serviceId && validServiceIds.has(s.serviceId) && Number.isFinite(s.quantity) && s.quantity > 0,
    ).map((s) => ({ id: s.id || makeSlot().id, serviceId: s.serviceId, quantity: Math.round(s.quantity), keywords: cleanKeywords(s.keywords) }));
    if (kept.length) out.platforms[platform] = kept;
  }
  return out;
}

/** Whether the profile has at least one slot configured. */
export function profileIsConfigured(p: AutomationProfile): boolean {
  return Object.values(p.platforms).some((slots) => slots.length > 0);
}

/** Substring keyword match (mirrors the reference matchesAnyKeyword). */
export function matchesAnyKeyword(link: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true; // keyword-less = matches anything (fallback handled by caller)
  const l = link.toLowerCase();
  return keywords.some((k) => l.includes(k));
}

/** Pick the slots to fire for a link on a platform: keyword-matched slots if any match,
 *  else the keyword-less (default) slots. Deduped by service. */
export function slotsForLink(profile: AutomationProfile, platform: string, link: string): AutomationSlot[] {
  const slots = profile.platforms[platform] ?? [];
  if (slots.length === 0) return [];
  const withKw = slots.filter((s) => s.keywords.length > 0);
  const noKw = slots.filter((s) => s.keywords.length === 0);
  const matched = withKw.filter((s) => matchesAnyKeyword(link, s.keywords));
  const chosen = matched.length > 0 ? matched : noKw;
  const seen = new Set<string>();
  const out: AutomationSlot[] = [];
  for (const s of chosen) {
    if (seen.has(s.serviceId)) continue;
    seen.add(s.serviceId);
    out.push(s);
  }
  return out;
}
