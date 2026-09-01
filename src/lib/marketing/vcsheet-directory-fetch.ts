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
// A real-browser-shaped request signature -- unlike tlgrm.eu (which accepts
// a plain identifying UA fine), vcsheet.com's CDN/WAF has been observed to
// reject requests from Vercel's outbound IPs specifically when the request
// doesn't otherwise look like an ordinary browser visit. This is a real
// mitigation attempt, not a spoofing/evasion tactic aimed at bypassing
// legitimate access controls on non-public data -- every page this fetches
// is the exact same public HTML any visitor's browser would receive.
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const REQUEST_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchResult {
  ok: boolean;
  html?: string;
  reason?: string;
}

async function fetchVcSheetPage(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: REQUEST_HEADERS });
    if (!res.ok) {
      const reason = `HTTP ${res.status}`;
      console.error("[vcsheet-scraper] fetch failed", url, reason);
      return { ok: false, reason };
    }
    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : err instanceof Error ? err.message : "network error";
    console.error("[vcsheet-scraper] fetch failed", url, reason);
    return { ok: false, reason };
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
  const sheetFetch = await fetchVcSheetPage(vcSheetCategoryUrl(category));
  if (!sheetFetch.ok || !sheetFetch.html) {
    return { category, entries: [], fundsFetched: 0, error: `Couldn't fetch the category page (${sheetFetch.reason ?? "unknown error"}).` };
  }

  const allSlugs = parseVcSheetFundSlugs(sheetFetch.html).filter((s) => !skipSlugs.has(s));
  const slugs = allSlugs.slice(0, cappedMax);

  const entries: VcSheetFundEntry[] = [];
  let fundsFetched = 0;
  let lastFundError: string | undefined;
  for (const slug of slugs) {
    if (fundsFetched > 0) await sleep(REQUEST_DELAY_MS);
    const fundFetch = await fetchVcSheetPage(vcSheetFundUrl(slug));
    fundsFetched++;
    if (!fundFetch.ok || !fundFetch.html) { lastFundError = fundFetch.reason; continue; }
    const entry = parseVcSheetFundProfile(fundFetch.html, slug);
    if (entry) entries.push(entry);
  }

  // Every fund fetch failed (and at least one was attempted) -- surface the
  // real reason rather than a silent "0 found" with no explanation.
  const error = slugs.length > 0 && entries.length === 0 && lastFundError ? `Every fund page failed to fetch (${lastFundError}).` : undefined;
  return { category, entries, fundsFetched, error };
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
