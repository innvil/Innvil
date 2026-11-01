import "server-only";
import {
  parseTlgrmDirectoryHtml, parseTlgrmLastPage, tlgrmCategoryUrl,
  type TelegramDirectoryEntry,
} from "./telegram-directory";

/**
 * The I/O half of the Telegram lead-research scraper (see
 * telegram-directory.ts's own doc comment for the full scope/safety
 * statement -- public third-party directory only, no Telegram access, no
 * messaging). Deliberately bounded so a single run can never hammer the
 * third-party site or run away in a serverless function: a fixed request
 * timeout, a hard cap on pages fetched per category, and a small delay
 * between requests (a plain courtesy to a site we don't operate, not a
 * legal requirement).
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES_PER_CATEGORY = 5;
const REQUEST_DELAY_MS = 600;
const USER_AGENT = "Mozilla/5.0 (compatible; InnvilLeadResearch/1.0)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTlgrmPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface CategoryScrapeResult {
  category: string;
  entries: TelegramDirectoryEntry[];
  pagesFetched: number;
  error?: string;
}

/** Scrapes one category's public listing pages, up to
 *  min(realLastPage, maxPages ?? MAX_PAGES_PER_CATEGORY). A page that fails
 *  to fetch stops the walk for that category (never retried in a loop) --
 *  whatever was already collected is still returned, never discarded. */
export async function scrapeTlgrmCategory(category: string, maxPages: number = MAX_PAGES_PER_CATEGORY): Promise<CategoryScrapeResult> {
  const cappedMax = Math.min(Math.max(1, maxPages), MAX_PAGES_PER_CATEGORY);
  const firstHtml = await fetchTlgrmPage(tlgrmCategoryUrl(category, 1));
  if (!firstHtml) return { category, entries: [], pagesFetched: 0, error: "Couldn't fetch page 1 (site unreachable or blocked the request)." };

  const entries = parseTlgrmDirectoryHtml(firstHtml);
  const realLastPage = parseTlgrmLastPage(firstHtml);
  const lastPage = Math.min(realLastPage ?? 1, cappedMax);
  let pagesFetched = 1;

  for (let page = 2; page <= lastPage; page++) {
    await sleep(REQUEST_DELAY_MS);
    const html = await fetchTlgrmPage(tlgrmCategoryUrl(category, page));
    if (!html) break;
    entries.push(...parseTlgrmDirectoryHtml(html));
    pagesFetched++;
  }

  return { category, entries, pagesFetched };
}

/** Scrapes several categories in sequence (never in parallel -- keeps
 *  total concurrent load on the third-party site to one request at a
 *  time). Categories are the caller's own already-validated list (see
 *  isKnownTlgrmCategory in telegram-directory.ts, and the hard "adult" is
 *  never offered anywhere upstream of this call). */
export async function scrapeTlgrmCategories(categories: string[], maxPagesPerCategory?: number): Promise<CategoryScrapeResult[]> {
  const results: CategoryScrapeResult[] = [];
  for (const category of categories) {
    if (results.length > 0) await sleep(REQUEST_DELAY_MS);
    results.push(await scrapeTlgrmCategory(category, maxPagesPerCategory));
  }
  return results;
}
