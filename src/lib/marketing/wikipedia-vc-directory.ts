/**
 * Pure parsing layer for a Wikipedia-sourced VC-firm lead-research scraper.
 * Replaces the earlier vcsheet.com-based scraper (removed) -- vcsheet.com's
 * own robots.txt explicitly disallows AI-agent crawlers (User-agent:
 * ClaudeBot / GPTBot / etc. -> Disallow: /), confirmed live, and it also
 * returned HTTP 403 for every real production request regardless. Wikipedia
 * carries NO such AI-crawler exclusion (checked directly against
 * https://en.wikipedia.org/robots.txt before writing this file) and
 * publishes an official, sanctioned REST content API
 * (https://en.wikipedia.org/api/rest_v1/page/html/<Title>) intended for
 * exactly this kind of programmatic reuse -- this is not a workaround, it's
 * the documented, supported way to consume Wikipedia content.
 *
 * Source: https://en.wikipedia.org/wiki/List_of_venture_capital_firms --
 * three ranked `wikitable` tables (Firm | Headquarters | ...), each firm
 * name linking to that firm's own Wikipedia article. Each article's
 * "Infobox company" (class `infobox ib-company`) carries real structured
 * fields (Industry, Headquarters, Founded, Website) -- verified directly
 * against the live, rendered HTML for the Andreessen Horowitz article
 * before writing this parser, not guessed.
 *
 * Same scope/safety statement as the retired vcsheet.com scraper: this is
 * lead RESEARCH only, into Innvil's own internal `telegram_leads` table --
 * nothing here sends a message anywhere, to Telegram, X, email, or
 * otherwise. Firm names/websites/locations are all already-public
 * information the firm itself publishes; nothing paywalled or private is
 * ever touched.
 *
 * Quality gate: the list page's own ranking tables occasionally mix in a
 * link to something that isn't actually a firm (a bare location, an
 * unrelated organization mentioned in the same row) -- rather than trying
 * to filter that out heuristically at the list-parsing stage, the REAL
 * filter is the per-firm infobox parser itself: a genuine VC firm's
 * article has a company infobox whose Industry field says "Venture
 * capital"; anything else (a city's own Wikipedia infobox, a government
 * agency's, or no infobox at all) is rejected outright, never guessed at.
 */

export interface WikipediaVcFirmCandidate {
  /** The Wikipedia article slug (e.g. "Andreessen_Horowitz"), used both as
   *  the article-fetch key and as this lead's stable `username`/identity. */
  slug: string;
  /** The display name derived from the slug (underscores -> spaces). */
  name: string;
}

export interface WikipediaVcFirmEntry {
  slug: string;
  name: string;
  website: string | null;
  headquarters: string | null;
  founded: string | null;
}

/** Extracts every `<a rel="mw:WikiLink" href="./<Slug>" title="...">` firm
 *  candidate from the list page's ranked `wikitable`s. Only the FIRST
 *  wikilink in each table row is taken (the firm's own name cell) -- the
 *  flag-icon anchor beside it never carries `rel="mw:WikiLink"`, and a
 *  second wikilink later in the same row (e.g. its headquarters city) is
 *  deliberately ignored here. Deduplicated by slug, since the same firm
 *  can legitimately appear in more than one ranking table. */
export function parseWikipediaVcFirmCandidates(html: string): WikipediaVcFirmCandidate[] {
  const tableRe = /<table[^>]*class="wikitable[^"]*"[^>]*>[\s\S]*?<\/table>/g;
  const tables = html.match(tableRe) ?? [];
  const seen = new Set<string>();
  const out: WikipediaVcFirmCandidate[] = [];
  for (const table of tables) {
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(table))) {
      const linkMatch = /<a rel="mw:WikiLink" href="\.\/([^"]+)" title="[^"]*"[^>]*>/.exec(rowMatch[1]);
      if (!linkMatch) continue;
      const slug = decodeURIComponent(linkMatch[1]);
      if (seen.has(slug)) continue;
      seen.add(slug);
      // Strip a Wikipedia disambiguation suffix (e.g. "Accel_(company)")
      // from the DISPLAY name only -- the slug itself (used for the real
      // article fetch) is left completely untouched.
      const name = slug.replace(/_/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim();
      out.push({ slug, name });
    }
  }
  return out;
}

function stripTags(fragment: string): string | null {
  const text = fragment.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
}

function extractInfoboxRow(infobox: string, label: string): string | null {
  const re = new RegExp(`<th scope="row" class="infobox-label"[^>]*>(?:<[^>]+>)*${label}(?:<\\/[^>]+>)*<\\/th>\\s*<td class="infobox-data[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, "i");
  const match = re.exec(infobox);
  return match ? stripTags(match[1]) : null;
}

/** Parses a single firm's own Wikipedia article for its real infobox
 *  fields. Returns null when there's no genuine company infobox, or when
 *  its Industry field doesn't actually say "venture capital" -- the hard
 *  quality gate described in this file's own doc comment above. Never
 *  fabricates a field it can't find (a missing Website/Founded is left
 *  `null`, never guessed). */
export function parseWikipediaVcFirmProfile(html: string, candidate: WikipediaVcFirmCandidate): WikipediaVcFirmEntry | null {
  const infoboxStart = html.indexOf('class="infobox ib-company');
  if (infoboxStart < 0) return null;
  // A generous, bounded window past the infobox's opening tag -- comfortably
  // covers every real "Infobox company" field (logo/type/industry/founded/
  // founders/headquarters/website all appear within the first few rows) without
  // needing to solve "find this table's true closing tag" against a page that
  // may contain other, unrelated tables further down.
  const infobox = html.slice(infoboxStart, infoboxStart + 12_000);

  const industry = extractInfoboxRow(infobox, "Industry");
  if (!industry || !/venture capital/i.test(industry)) return null;

  const websiteMatch = /class="official-website">\s*<span class="url">\s*<a[^>]*href="([^"]+)"/.exec(infobox);
  const website = websiteMatch && /^https?:\/\//i.test(websiteMatch[1]) ? websiteMatch[1] : null;

  return {
    slug: candidate.slug,
    name: candidate.name,
    website,
    headquarters: extractInfoboxRow(infobox, "Headquarters"),
    founded: extractInfoboxRow(infobox, "Founded"),
  };
}

export const WIKIPEDIA_VC_LIST_PAGE = "List_of_venture_capital_firms";

export function wikipediaArticleUrl(slug: string): string {
  return `https://en.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(slug)}`;
}
