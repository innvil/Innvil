import "server-only";

/* =========================================================
   Watched-account post detection via RSS/Atom feeds.
   Innvil can't reliably scrape X/Instagram/TikTok from a serverless backend, so
   watched accounts are FEED-based (bring-your-own, like providers): the customer
   supplies a feed URL (YouTube channels expose one natively; other platforms via an
   RSS bridge). We poll the feed and return the recent item links, newest-first.
   ========================================================= */

const MAX_ITEMS = 20;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/** Extract the item/entry links from an RSS or Atom feed body, in document order. */
export function parseFeedLinks(xml: string): string[] {
  const links: string[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) ?? [];
  for (const block of blocks) {
    let url: string | null = null;
    // Atom: <link href="..."> (prefer rel="alternate" or a bare link).
    const atomAlt = block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i);
    const atomAny = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
    // RSS: <link>...</link> or a permalink <guid isPermaLink="true">...</guid>.
    const rss = block.match(/<link>\s*([\s\S]*?)\s*<\/link>/i);
    const guid = block.match(/<guid\b[^>]*>\s*(https?:[\s\S]*?)\s*<\/guid>/i);
    url = (atomAlt?.[1] || atomAny?.[1] || rss?.[1] || guid?.[1] || "").trim();
    if (url) {
      const clean = decodeEntities(url);
      if (/^https?:\/\//i.test(clean) && !links.includes(clean)) links.push(clean);
    }
    if (links.length >= MAX_ITEMS) break;
  }
  return links;
}

/** Fetch a feed URL and return its recent item links (newest-first). Throws on failure. */
export async function fetchFeedLinks(feedUrl: string): Promise<string[]> {
  let u: URL;
  try { u = new URL(feedUrl); } catch { throw new Error("Enter a valid feed URL (http/https)."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Feed URL must be http or https.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let res: Response;
  try {
    res = await fetch(feedUrl, {
      method: "GET",
      headers: { "User-Agent": "InnvilBot/1.0 (+https://innvil.cloud)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}.`);
  const body = await res.text();
  if (!/<(item|entry)\b/i.test(body)) throw new Error("That URL doesn't look like an RSS/Atom feed.");
  return parseFeedLinks(body);
}
