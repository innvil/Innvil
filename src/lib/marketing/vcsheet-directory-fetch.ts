import "server-only";
import {
  parseVcSheetFundSlugs, parseVcSheetFundProfile, vcSheetCategoryUrl, vcSheetFundUrl,
  type VcSheetFundEntry,
} from "./vcsheet-directory";

/**
 * The I/O half of the VC lead-research scraper (see vcsheet-directory.ts's
 * own doc comment for the full scope/safety statement -- public directory
 * only, no messaging). Two real network round trips per fund (the category
 * page once, then each fund's own detail page) -- bounded on every axis so
 * a single run can never hammer the third-party site or run away in a
 * serverless function: a fixed request timeout, a hard cap on funds fetched
 * per category, and a courtesy delay between requests.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FUNDS_PER_CATEGORY = 15;
const REQUEST_DELAY_MS = 500;
const USER_AGENT = "Mozilla/5.0 (compatible; InnvilLeadResearch/1.0)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchVcSheetPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface VcSheetCategoryResult {
  category: string;
  entries: VcSheetFundEntry[];
  fundsFetched: number;
  error?: string;
}

/** Scrapes one category ("sheet") page for its fund slugs, then fetches up
 *  to min(available, maxFunds ?? MAX_FUNDS_PER_CATEGORY) of those funds'
 *  own detail pages for real structured data. A fund whose detail page
 *  fails to fetch/parse is skipped (never retried in a loop) -- whatever
 *  was already collected is still returned. Already-known slugs (from a
 *  prior scrape/exclusion) can be passed in `skipSlugs` to avoid a wasted
 *  fetch for a fund already in the lead list or permanently excluded. */
export async function scrapeVcSheetCategory(category: string, maxFunds: number = MAX_FUNDS_PER_CATEGORY, skipSlugs: Set<string> = new Set()): Promise<VcSheetCategoryResult> {
  const cappedMax = Math.min(Math.max(1, maxFunds), MAX_FUNDS_PER_CATEGORY);
  const sheetHtml = await fetchVcSheetPage(vcSheetCategoryUrl(category));
  if (!sheetHtml) return { category, entries: [], fundsFetched: 0, error: "Couldn't fetch the category page (site unreachable or blocked the request)." };

  const allSlugs = parseVcSheetFundSlugs(sheetHtml).filter((s) => !skipSlugs.has(s));
  const slugs = allSlugs.slice(0, cappedMax);

  const entries: VcSheetFundEntry[] = [];
  let fundsFetched = 0;
  for (const slug of slugs) {
    if (fundsFetched > 0) await sleep(REQUEST_DELAY_MS);
    const fundHtml = await fetchVcSheetPage(vcSheetFundUrl(slug));
    fundsFetched++;
    if (!fundHtml) continue;
    const entry = parseVcSheetFundProfile(fundHtml, slug);
    if (entry) entries.push(entry);
  }

  return { category, entries, fundsFetched };
}

/** Scrapes several categories in sequence (never in parallel -- keeps total
 *  concurrent load on the third-party site to one request at a time). */
export async function scrapeVcSheetCategories(categories: string[], maxFundsPerCategory?: number, skipSlugs?: Set<string>): Promise<VcSheetCategoryResult[]> {
  const results: VcSheetCategoryResult[] = [];
  for (const category of categories) {
    if (results.length > 0) await sleep(REQUEST_DELAY_MS);
    results.push(await scrapeVcSheetCategory(category, maxFundsPerCategory, skipSlugs));
  }
  return results;
}
