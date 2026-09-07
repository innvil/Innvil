/**
 * Campaign Automation — smart link detection + per-link platform auto-detect.
 *
 * Ported from the SMM-automator project (`lib/order-links.ts`,
 * `app/api/orders/route.ts` detectPlatformFromLink, `lib/place-order.ts`
 * isInstagramReel), with the "concatenated blob" enhancement: links are extracted
 * even when pasted with no separators (…/1https://…/2). Pure/serialisable — safe on
 * client and server.
 */

export const CAMPAIGN_PLATFORMS = [
  "instagram", "tiktok", "youtube", "x", "facebook", "linkedin", "telegram", "spotify", "threads",
] as const;
export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];

/** hostname (without leading www.) → platform. Checked in order. */
const HOST_MATCHERS: Array<{ test: (host: string) => boolean; platform: CampaignPlatform }> = [
  { platform: "x", test: (h) => h === "x.com" || h === "twitter.com" || h.endsWith(".x.com") || h.endsWith(".twitter.com") },
  { platform: "instagram", test: (h) => h === "instagram.com" || h.endsWith(".instagram.com") || h === "instagr.am" },
  { platform: "threads", test: (h) => h === "threads.net" || h.endsWith(".threads.net") },
  { platform: "tiktok", test: (h) => h === "tiktok.com" || h === "vt.tiktok.com" || h === "vm.tiktok.com" || h.endsWith(".tiktok.com") },
  { platform: "linkedin", test: (h) => h === "linkedin.com" || h.endsWith(".linkedin.com") || h === "lnkd.in" },
  { platform: "youtube", test: (h) => h === "youtube.com" || h === "youtu.be" || h === "m.youtube.com" || h.endsWith(".youtube.com") },
  { platform: "facebook", test: (h) => h === "facebook.com" || h === "fb.com" || h === "fb.watch" || h.endsWith(".facebook.com") },
  { platform: "telegram", test: (h) => h === "t.me" || h === "telegram.me" || h.endsWith(".t.me") },
  { platform: "spotify", test: (h) => h === "open.spotify.com" || h === "spotify.com" || h.endsWith(".spotify.com") },
];

/** Best-effort platform from a single link's hostname. null = unknown. */
export function detectPlatform(link: string): CampaignPlatform | null {
  const clean = link.trim().toLowerCase();
  try {
    const host = new URL(clean).hostname.replace(/^www\./, "");
    for (const m of HOST_MATCHERS) if (m.test(host)) return m.platform;
    return null;
  } catch {
    // Not a parseable URL — fall back to substring checks.
    for (const m of HOST_MATCHERS) {
      // Reconstruct common host tokens from the matcher's own platform.
      if (clean.includes(`${m.platform}.com/`)) return m.platform;
    }
    if (clean.includes("twitter.com/")) return "x";
    if (clean.includes("youtu.be/")) return "youtube";
    if (clean.includes("t.me/")) return "telegram";
    return null;
  }
}

/** Instagram Reel links get views only (SMM-automator rule) — exposed for the fan-out. */
export function isInstagramReel(link: string): boolean {
  try {
    const url = new URL(link);
    return url.hostname.includes("instagram.com") && url.pathname.includes("/reel/");
  } catch {
    return link.toLowerCase().includes("instagram.com/reel/");
  }
}

/* Extract each URL lazily up to the next URL / whitespace / comma — so links pasted
   with newlines, commas, spaces, OR concatenated (…/1https://…/2) all separate. */
const URL_EXTRACT = /https?:\/\/.*?(?=https?:\/\/|[\s,]|$)/gi;

/** Parse a blob of pasted text into a de-duplicated list of link URLs. */
export function parseCampaignLinks(input: string): string[] {
  if (!input) return [];
  const matches = input.match(URL_EXTRACT) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of matches) {
    const url = raw.trim().replace(/[.,);\]]+$/, "");
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

export interface AnalyzedLink {
  link: string;
  platform: CampaignPlatform | null;
  isReel: boolean;
}

/** Parse + detect in one pass, for a live preview of what a campaign will order. */
export function analyzeCampaign(input: string): {
  links: AnalyzedLink[];
  total: number;
  detected: number;
  byPlatform: Partial<Record<CampaignPlatform, number>>;
  unknown: number;
} {
  const links = parseCampaignLinks(input).map((link) => ({
    link,
    platform: detectPlatform(link),
    isReel: isInstagramReel(link),
  }));
  const byPlatform: Partial<Record<CampaignPlatform, number>> = {};
  let detected = 0;
  let unknown = 0;
  for (const l of links) {
    if (l.platform) { detected++; byPlatform[l.platform] = (byPlatform[l.platform] ?? 0) + 1; }
    else unknown++;
  }
  return { links, total: links.length, detected, byPlatform, unknown };
}
