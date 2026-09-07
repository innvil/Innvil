import "server-only";
import {
  parseWikipediaVcFirmCandidates, parseWikipediaVcFirmProfile, wikipediaArticleUrl, WIKIPEDIA_VC_LIST_PAGE,
  type WikipediaVcFirmEntry,
} from "./wikipedia-vc-directory";

/**
 * The I/O half of the Wikipedia-sourced VC lead-research scraper (see
 * wikipedia-vc-directory.ts's own doc comment for the full source/scope/
 * safety statement). Two real network round trips per firm (the list page
 * once, then each firm's own article), bounded on every axis so a single
 * run can never hammer Wikipedia's servers or run away in a serverless
 * function -- a fixed request timeout, a hard cap on firms fetched per run,
 * and a courtesy delay between requests. A plain, honestly-identifying User
 * Agent is used throughout (Wikipedia's own API etiquette explicitly asks
 * for one) -- unlike the retired vcsheet.com scraper, there is no need to
 * mimic a browser here, since Wikipedia's REST API has no bot-blocking WAF.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_FIRMS_PER_RUN = 40;
const REQUEST_DELAY_MS = 300;
const USER_AGENT = "InnvilLeadResearch/1.0 (+https://innvil.cloud; internal lead research tool, not a bulk crawler)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchResult {
  ok: boolean;
  html?: string;
  reason?: string;
}

async function fetchWikipediaPage(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT, Accept: "text/html" } });
    if (!res.ok) {
      const reason = `HTTP ${res.status}`;
      console.error("[wikipedia-vc-scraper] fetch failed", url, reason);
      return { ok: false, reason };
    }
    const html = await res.text();
    return { ok: true, html };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : err instanceof Error ? err.message : "network error";
    console.error("[wikipedia-vc-scraper] fetch failed", url, reason);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

export interface WikipediaVcScrapeResult {
  entries: WikipediaVcFirmEntry[];
  candidatesFound: number;
  firmsFetched: number;
  rejected: number;
  error?: string;
}

/** Scrapes the Wikipedia "List of venture capital firms" page for candidate
 *  firm slugs, then fetches up to min(available, maxFirms ?? MAX_FIRMS_PER_RUN)
 *  of those firms' own articles for real structured data. A firm whose
 *  article fails to fetch, has no genuine company infobox, or whose
 *  Industry field doesn't say "venture capital" is silently skipped
 *  (counted in `rejected`, never retried) -- whatever real firms were
 *  successfully parsed are still returned. Already-known slugs (from a
 *  prior scrape/exclusion) can be passed in `skipSlugs` to avoid a wasted
 *  fetch for a firm already in the lead list or permanently excluded. */
export async function scrapeWikipediaVcFirms(maxFirms: number = MAX_FIRMS_PER_RUN, skipSlugs: Set<string> = new Set()): Promise<WikipediaVcScrapeResult> {
  const cappedMax = Math.min(Math.max(1, maxFirms), MAX_FIRMS_PER_RUN);
  const listFetch = await fetchWikipediaPage(wikipediaArticleUrl(WIKIPEDIA_VC_LIST_PAGE));
  if (!listFetch.ok || !listFetch.html) {
    return { entries: [], candidatesFound: 0, firmsFetched: 0, rejected: 0, error: `Couldn't fetch the list page (${listFetch.reason ?? "unknown error"}).` };
  }

  const allCandidates = parseWikipediaVcFirmCandidates(listFetch.html).filter((c) => !skipSlugs.has(c.slug.toLowerCase()));
  const candidates = allCandidates.slice(0, cappedMax);

  const entries: WikipediaVcFirmEntry[] = [];
  let firmsFetched = 0;
  let rejected = 0;
  let lastFirmError: string | undefined;
  for (const candidate of candidates) {
    if (firmsFetched > 0) await sleep(REQUEST_DELAY_MS);
    const firmFetch = await fetchWikipediaPage(wikipediaArticleUrl(candidate.slug));
    firmsFetched++;
    if (!firmFetch.ok || !firmFetch.html) { lastFirmError = firmFetch.reason; rejected++; continue; }
    const entry = parseWikipediaVcFirmProfile(firmFetch.html, candidate);
    if (entry) entries.push(entry); else rejected++;
  }

  const error = candidates.length > 0 && entries.length === 0 && lastFirmError ? `Every firm article failed to fetch (${lastFirmError}).` : undefined;
  return { entries, candidatesFound: allCandidates.length, firmsFetched, rejected, error };
}
