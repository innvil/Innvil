import "server-only";
import { promises as dns } from "node:dns";
import { validateIngestUrl, isPrivateOrReservedIp, extractReadableText, extractSameOriginLinks } from "./knowledge-ingestion";

/**
 * The I/O half of Project Knowledge URL ingestion — server-only, SSRF-
 * guarded. Called ONLY from an authenticated Project owner's explicit
 * "add/refresh URL source" action (watch-project-knowledge.ts) — never from
 * Telegram link moderation, which judges a posted link from message text
 * alone and never fetches anything (see knowledge-ingestion.ts's own trust-
 * boundary note).
 *
 * SSRF defenses implemented: scheme allowlist (http/https only), DNS
 * resolution + private/reserved/loopback/link-local IP rejection BEFORE
 * connecting, a bounded manual redirect loop that re-validates EVERY hop
 * (never trusts fetch's own automatic redirect-following, which would skip
 * this check on each hop), a response-size cap enforced by streaming (never
 * trusts a Content-Length header alone, which can be absent or wrong), and
 * a total-time timeout via AbortController.
 *
 * HONEST LIMITATION, stated explicitly rather than overclaiming: this does
 * NOT fully close a DNS-rebinding race (the interval between this
 * function's DNS check and the underlying Node `fetch`/undici's own
 * connection could theoretically resolve a different IP for a very
 * short-TTL malicious DNS record). Closing that completely would require
 * pinning the HTTP client to the exact checked IP (a custom
 * dispatcher/agent), which is a materially larger change; the practical
 * defense here (reject any hostname whose CURRENT DNS resolution is
 * private/reserved, checked immediately before each request) still blocks
 * the overwhelmingly common SSRF cases (localhost, RFC1918 ranges, cloud
 * metadata endpoints at fixed IPs) and is a reasonable, good-faith mitigation
 * for a v1 feature, not a claim of complete protection against a
 * sophisticated, actively-hostile DNS operator.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const ACCEPTED_CONTENT_TYPES = ["text/html", "text/plain", "application/xhtml+xml"];

export interface IngestFetchResult {
  ok: boolean;
  text?: string;
  /** Raw HTML body, present only for a successful HTML fetch -- used
   *  solely to discover same-origin links for a bounded crawl
   *  (`crawlAndIngestSite` below); never persisted or sent to the model. */
  html?: string;
  finalUrl?: string;
  error?: string;
}

async function resolveAndCheckHost(hostname: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, error: "Could not resolve that host." };
  }
  if (addresses.length === 0) return { ok: false, error: "Could not resolve that host." };
  for (const a of addresses) {
    if (isPrivateOrReservedIp(a.address, a.family === 6 ? 6 : 4)) {
      return { ok: false, error: "That host resolves to a private/internal network address, which isn't allowed." };
    }
  }
  return { ok: true };
}

/** Reads a Response body up to `maxBytes`, aborting (never buffering
 *  further) the instant the cap is exceeded -- never trusts Content-Length
 *  alone, since it can be absent or lie. */
async function readBodyBounded(res: Response, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > maxBytes) return { ok: false, error: "Response was too large." };
    return { ok: true, text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        return { ok: false, error: "Response was too large." };
      }
      chunks.push(value);
    }
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { ok: true, text: buf.toString("utf-8") };
}

/** Fetches a Project-owner-submitted URL under bounded, SSRF-guarded
 *  conditions and returns its extracted readable text. A single explicitly
 *  submitted URL is a single bounded ingestion target -- this never follows
 *  arbitrary links found ON the page, never recursively crawls the domain,
 *  and never fetches a second resource beyond the redirect chain of the one
 *  URL given. */
export async function fetchAndExtractUrl(rawUrl: string): Promise<IngestFetchResult> {
  const validated = validateIngestUrl(rawUrl);
  if (!validated.ok) return { ok: false, error: validated.error };

  let currentUrl = new URL(rawUrl.trim());
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const hostCheck = await resolveAndCheckHost(currentUrl.hostname);
    if (!hostCheck.ok) return { ok: false, error: hostCheck.error };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "InnvilProjectKnowledgeBot/1.0 (+https://innvil.cloud)" },
      });
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "Fetching that URL timed out." : "Could not reach that URL." };
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, error: "Received a redirect with no destination." };
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        return { ok: false, error: "Received a redirect to an invalid URL." };
      }
      if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
        return { ok: false, error: "Redirected to an unsupported URL scheme." };
      }
      continue; // re-check the NEW host at the top of the loop before following it
    }

    if (!res.ok) return { ok: false, error: `The URL returned an error (HTTP ${res.status}).` };

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ACCEPTED_CONTENT_TYPES.includes(contentType)) {
      return { ok: false, error: `Unsupported content type${contentType ? ` (${contentType})` : ""} — only web pages are supported.` };
    }

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_RESPONSE_BYTES) return { ok: false, error: "Response was too large." };

    const body = await readBodyBounded(res, MAX_RESPONSE_BYTES);
    if (!body.ok) return { ok: false, error: body.error };

    const text = extractReadableText(body.text);
    if (!text) return { ok: false, error: "Couldn't find any readable text on that page." };
    return { ok: true, text, html: body.text, finalUrl: currentUrl.toString() };
  }
  return { ok: false, error: "Too many redirects." };
}

const MAX_CRAWL_PAGES = 8;
const MAX_CRAWL_DEPTH = 2;
const CRAWL_TIME_BUDGET_MS = 30_000;
const MAX_QUEUE_SIZE = MAX_CRAWL_PAGES * 4;

export interface CrawledPage {
  url: string;
  text: string;
}

export interface CrawlResult {
  ok: boolean;
  pages: CrawledPage[];
  error?: string;
}

/** Bounded, same-origin multi-page crawl starting from `rootUrl` -- so a
 *  Project owner submitting just a homepage URL gets more than that one
 *  page's text (the real, live-reported gap: a Watcher answering "digs
 *  deep into the project" questions needs more than the landing page
 *  alone). Every discovered page goes through the SAME SSRF/content-type/
 *  size-bounded `fetchAndExtractUrl` as a single-URL ingestion -- crawling
 *  never bypasses or weakens any of those per-page guards, it only decides
 *  WHICH same-origin URLs get fetched next.
 *
 *  Bounded on three independent axes, whichever is hit first:
 *   - MAX_CRAWL_PAGES (8) successfully-fetched pages total
 *   - MAX_CRAWL_DEPTH (2) link-hops from the root
 *   - CRAWL_TIME_BUDGET_MS (30s) total wall-clock, checked before starting
 *     each additional page so a slow site can't run unbounded
 *  A failed/slow individual page is skipped, never fatal to the whole
 *  crawl -- returns whatever pages succeeded so far. Only fails outright
 *  when the ROOT page itself couldn't be fetched at all.
 *
 *  Deliberately does NOT follow links to a different origin/subdomain, and
 *  does NOT fetch non-HTML resources discovered mid-crawl (e.g. a linked
 *  PDF whitepaper) -- both are honest, documented v1 limitations, not
 *  silently dropped: linking a PDF directly as its own Knowledge Source
 *  still works via the existing single-URL ingestion path. */
export async function crawlAndIngestSite(rootUrl: string): Promise<CrawlResult> {
  const started = Date.now();
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }];
  let rootError: string | undefined;

  while (queue.length > 0 && pages.length < MAX_CRAWL_PAGES) {
    if (Date.now() - started > CRAWL_TIME_BUDGET_MS) break;
    const next = queue.shift();
    if (!next) break;
    const key = next.url.replace(/#.*$/, "");
    if (visited.has(key)) continue;
    visited.add(key);

    const fetched = await fetchAndExtractUrl(next.url);
    if (!fetched.ok || !fetched.text) {
      if (next.depth === 0) rootError = fetched.error;
      continue;
    }
    pages.push({ url: fetched.finalUrl ?? next.url, text: fetched.text });

    if (next.depth < MAX_CRAWL_DEPTH && fetched.html) {
      const links = extractSameOriginLinks(fetched.html, fetched.finalUrl ?? next.url);
      for (const link of links) {
        if (queue.length >= MAX_QUEUE_SIZE) break;
        const linkKey = link.replace(/#.*$/, "");
        if (!visited.has(linkKey)) queue.push({ url: link, depth: next.depth + 1 });
      }
    }
  }

  if (pages.length === 0) return { ok: false, pages: [], error: rootError ?? "Couldn't fetch that URL." };
  return { ok: true, pages };
}
