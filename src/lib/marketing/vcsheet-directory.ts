/**
 * Pure, no-I/O parsing for Innvil's VC (venture capital) lead-research
 * scraper (super-admin only -- see src/lib/actions/telegram-leads.ts).
 * Reads ALREADY-FETCHED HTML from vcsheet.com, a public VC-fund directory
 * (5,000+ investors, 1,000+ funds, organized into public "sheet" category
 * pages) -- real data the site already displays to any visitor, verified
 * live before writing this (fund pages carry a real schema.org/ProfilePage
 * JSON-LD block with the fund's name, description, real website, location,
 * and social links -- LinkedIn/X/Crunchbase -- confirmed directly against
 * https://www.vcsheet.com/fund/andreessen-horowitz).
 *
 * This module never touches Telegram or X/Twitter directly -- it only
 * extracts what vcsheet.com itself already exposes as one fund's own
 * publicly-listed social handles (including a real X/Twitter link when the
 * fund has one), never messages anyone, and never accesses anything
 * private. Two-step discovery, mirroring telegram-directory.ts's shape but
 * adapted to this site's structure: a "sheet" category page lists many
 * `/fund/<slug>` links; each fund's own detail page carries the real
 * structured data.
 */

export interface VcSheetFundEntry {
  slug: string;
  name: string;
  website: string | null;
  description: string | null;
  location: string | null;
  twitter: string | null;
  linkedin: string | null;
}

/** Curated, real "sheet" category slugs (verified live against
 *  vcsheet.com's own homepage nav) -- deliberately scoped to categories
 *  most relevant to Innvil's own customer base (crypto/web3, fintech, AI,
 *  gaming, general early-stage) rather than the site's full 80+ category
 *  list. */
export const VC_SHEET_CATEGORIES = [
  "web3-funds", "fintech-funds", "ai-funds", "gaming-funds", "consumer-funds",
  "enterprise-funds", "funds-that-lead-pre-seeds", "funds-that-lead-seeds",
  "funds-that-lead-series-a", "most-prolific-pre-seed-funds", "deeptech-funds",
] as const;
export type VcSheetCategory = (typeof VC_SHEET_CATEGORIES)[number];

export function isKnownVcSheetCategory(value: string): value is VcSheetCategory {
  return (VC_SHEET_CATEGORIES as readonly string[]).includes(value);
}

export function vcSheetCategoryUrl(category: string): string {
  return `https://www.vcsheet.com/sheet/${encodeURIComponent(category)}`;
}

export function vcSheetFundUrl(slug: string): string {
  return `https://www.vcsheet.com/fund/${encodeURIComponent(slug)}`;
}

/** Extracts every unique fund slug linked from a category ("sheet") page --
 *  e.g. `href="/fund/andreessen-horowitz"` -> `"andreessen-horowitz"`.
 *  Order-preserving, deduped. */
export function parseVcSheetFundSlugs(html: string): string[] {
  const seen = new Set<string>();
  const re = /href="\/fund\/([a-zA-Z0-9-]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    seen.add(match[1]);
  }
  return [...seen];
}

/** Extracts the real schema.org/ProfilePage JSON-LD block a fund's own
 *  detail page embeds server-side. Returns null (never a guessed/partial
 *  entry) if the block is missing or malformed -- a fund page that changed
 *  shape is skipped, not misreported. */
export function parseVcSheetFundProfile(html: string, slug: string): VcSheetFundEntry | null {
  const match = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  if (!match) return null;

  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const entity = (typeof root.mainEntity === "object" && root.mainEntity !== null ? root.mainEntity : root) as Record<string, unknown>;

  const name = typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : null;
  if (!name) return null;

  const website = typeof entity.url === "string" && /^https?:\/\//i.test(entity.url) ? entity.url : null;
  const rawDescription = typeof entity.description === "string" && entity.description.trim() ? entity.description : typeof root.description === "string" ? root.description : null;
  const description = rawDescription?.trim() || null;
  const address = typeof entity.address === "object" && entity.address !== null ? (entity.address as Record<string, unknown>) : null;
  const location = address && typeof address.addressLocality === "string" && address.addressLocality.trim() ? address.addressLocality.trim() : null;

  const sameAs = Array.isArray(entity.sameAs) ? (entity.sameAs as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const twitter = sameAs.find((u) => /(twitter\.com|x\.com)\//i.test(u)) ?? null;
  const linkedin = sameAs.find((u) => /linkedin\.com\//i.test(u)) ?? null;

  return { slug, name, website, description, location, twitter, linkedin };
}
