/**
 * Pure, no-I/O parsing for Innvil's Telegram lead-research tool
 * (super-admin only -- see src/lib/actions/telegram-leads.ts). Reads
 * ALREADY-FETCHED HTML from a public, third-party Telegram directory site
 * (tlgrm.eu's own public category listing pages) and extracts the channel/
 * group name, @username, subscriber count, and description that site
 * already displays publicly to any visitor.
 *
 * This module NEVER touches Telegram itself, never accesses private or
 * joined-group data, and has no send/messaging capability of any kind --
 * it is lead RESEARCH only, for a human on Innvil's team to manually reach
 * out to. It exists to help populate a lead list; what happens after that
 * (if anything) is a manual, human decision, subject to each platform's
 * own terms.
 *
 * Regex-based extraction (same lightweight approach already used for
 * extractSameOriginLinks in knowledge-ingestion.ts) -- no DOM/HTML-parser
 * dependency needed for this fixed, known markup shape. Verified against
 * the site's REAL current markup before writing this (see the 2026-08-26
 * changelog entry), not guessed.
 */

export interface TelegramDirectoryEntry {
  name: string;
  username: string;
  subscriberCount: number | null;
  description: string | null;
}

/** Categories tlgrm.eu itself publishes, EXCLUDING "adult" -- that category
 *  is never offered as a scrape target anywhere in this feature, by design,
 *  regardless of what the site itself lists. */
export const TLGRM_CATEGORIES = [
  "crypto", "business", "tech", "gaming", "education", "news", "blogs", "other",
  "politics", "entertainment", "food", "art", "sales", "language", "music", "video", "books",
] as const;
export type TlgrmCategory = (typeof TLGRM_CATEGORIES)[number];

export function isKnownTlgrmCategory(value: string): value is TlgrmCategory {
  return (TLGRM_CATEGORIES as readonly string[]).includes(value);
}

const CARD_MARKER = '<div class="channel-card">';
const PROMO_RE = /channel-card__promo-label/;
const TITLE_RE = /<h3 class="channel-card__title">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/;
const USERNAME_RE = /class="channel-card__username"[^>]*>\s*&commat;([a-zA-Z0-9_]{3,64})\s*<\/a>/;
const SUBSCRIBERS_RE = /<span class="channel-card__subscribers">([\d,]+)<\/span>/;
const DESCRIPTION_RE = /<div class="channel-card__description">\s*([\s\S]*?)\s*<\/div>/;

/** Minimal, targeted HTML-entity decode for the handful of entities that
 *  actually appear in this site's channel titles/descriptions -- never a
 *  general-purpose HTML decoder (not needed for this fixed use case). */
function decodeEntities(s: string): string {
  return s
    .replace(/&commat;/g, "@")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'") // &#39; and its zero-padded form &#039;
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&") // decoded last -- never re-corrupts an already-decoded entity above
    .trim();
}

/** Extracts every real (non-promo/sponsored) channel-card entry from one
 *  fetched tlgrm.eu category page. A promo/sponsored slot (Telegram's own
 *  paid placement on the directory site, unrelated to organic ranking) is
 *  deliberately skipped -- it isn't a genuine, naturally-ranked community
 *  and may not even match the category being browsed. An entry missing a
 *  parseable username is skipped (nothing to link/dedupe on). */
export function parseTlgrmDirectoryHtml(html: string): TelegramDirectoryEntry[] {
  const cards = html.split(CARD_MARKER).slice(1);
  const entries: TelegramDirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (PROMO_RE.test(card)) continue;
    const titleMatch = TITLE_RE.exec(card);
    const usernameMatch = USERNAME_RE.exec(card);
    if (!titleMatch || !usernameMatch) continue;
    const username = usernameMatch[1];
    if (seen.has(username.toLowerCase())) continue; // a page can't realistically repeat, but guard anyway
    seen.add(username.toLowerCase());
    const subsMatch = SUBSCRIBERS_RE.exec(card);
    const descMatch = DESCRIPTION_RE.exec(card);
    entries.push({
      name: decodeEntities(titleMatch[1]),
      username,
      subscriberCount: subsMatch ? Number(subsMatch[1].replace(/,/g, "")) : null,
      description: descMatch ? decodeEntities(descMatch[1]) || null : null,
    });
  }
  return entries;
}

/** Reads the real last-page number from the page's own pagination widget
 *  (`data-last-page="N"`) -- null when absent/unparseable, never assumed
 *  to be 1 (a genuinely single-page category vs. a page whose markup
 *  changed are different things; the caller treats null as "unknown, stop
 *  after this page" either way, which is the safe behavior for both). */
export function parseTlgrmLastPage(html: string): number | null {
  const match = /data-last-page="(\d+)"/.exec(html);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function tlgrmCategoryUrl(category: string, page: number): string {
  const base = `https://tlgrm.eu/channels/${encodeURIComponent(category)}`;
  return page > 1 ? `${base}?page=${page}` : base;
}
