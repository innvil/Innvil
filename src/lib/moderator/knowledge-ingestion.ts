/**
 * Real Project Knowledge ingestion — the pure/no-I/O half. URL fetching
 * (DNS resolution, the actual HTTP request) lives in `knowledge-fetch.ts`
 * (server-only); this file is directly unit-testable.
 *
 * TRUST BOUNDARY, stated explicitly (per the product decision this pass
 * implements): a URL a human posts in Telegram chat is judged by link
 * moderation's EXISTING architecture (link-moderation.ts/link-classify.ts)
 * from message TEXT/context alone — it is never fetched, and this module
 * has nothing to do with that path. A URL the authenticated Project OWNER
 * explicitly submits here as trusted Project Knowledge is a deliberate
 * ingestion action, fetched server-side, extracted, and made retrievable.
 * These are different trust boundaries; this module governs ONLY the
 * second one.
 */

import sanitizeHtml from "sanitize-html";

export interface UrlValidationResult {
  ok: boolean;
  error?: string;
}

/** A "Website"/"Documentation" field is normally typed WITHOUT a scheme
 *  ("innvil.cloud", not "https://innvil.cloud") -- unlike the explicit
 *  "Add URL" Knowledge Source flow, where a full URL is expected. Prepends
 *  https:// when no scheme is present so a plain domain is still a valid,
 *  fetchable ingestion target rather than failing validation outright. */
export function normalizeProfileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Scheme/shape validation only — no DNS resolution here (that happens at
 *  fetch time in knowledge-fetch.ts, since only there do we have the actual
 *  resolved IP to check against the private/reserved blocklist). Rejects
 *  anything that isn't a plain http(s) URL with a real hostname. */
export function validateIngestUrl(raw: string): UrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Enter a URL." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "That's not a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// URLs are supported." };
  }
  if (!url.hostname) return { ok: false, error: "That URL has no hostname." };
  if (url.username || url.password) return { ok: false, error: "URLs with embedded credentials aren't supported." };
  return { ok: true };
}

/** IPv4 private/reserved/loopback/link-local ranges — RFC 1918 (10/8,
 *  172.16/12, 192.168/16), loopback (127/8), link-local (169.254/16),
 *  "this network" (0/8), CGNAT (100.64/10), and multicast/reserved
 *  (224/4, 240/4) — every one of these must never be an ingestion target. */
export function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true; // malformed -> fail closed
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/** IPv6 private/reserved/loopback/link-local — ::1 (loopback), fc00::/7
 *  (unique local), fe80::/10 (link-local), ::ffff:0:0/96 (IPv4-mapped,
 *  checked against the SAME IPv4 rules above so a mapped private v4 address
 *  can't slip through), and the unspecified address ::. */
export function isPrivateOrReservedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIpv4(mapped[1]);
  return false;
}

export function isPrivateOrReservedIp(ip: string, family: 4 | 6): boolean {
  return family === 4 ? isPrivateOrReservedIpv4(ip) : isPrivateOrReservedIpv6(ip);
}

/** Strips HTML tags/entities down to plain, readable text — script/style/
 *  nav/header/footer content is dropped entirely (never treated as body
 *  content), everything else collapses to plain text with normalized
 *  whitespace. Uses `sanitize-html`'s own text-extraction mode (allowing no
 *  tags at all) rather than a hand-rolled regex tag-stripper, since that
 *  dependency already exists in this codebase. */
export function extractReadableText(html: string): string {
  const stripped = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    // nonTextTags -- unlike allowedTags:[] alone (which only unwraps a tag
    // but keeps its TEXT content), this drops the tag AND its inner text
    // entirely -- required so nav/header/footer/script/style boilerplate
    // never leaks into the extracted "readable" text.
    nonTextTags: ["script", "style", "noscript", "nav", "header", "footer", "svg", "textarea", "option"],
  });
  return normalizeWhitespace(decodeBasicEntities(stripped));
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface TextChunk {
  index: number;
  content: string;
}

const DEFAULT_MAX_CHUNK_CHARS = 1500;
const DEFAULT_MAX_CHUNKS = 40;

/** Splits extracted text into bounded, paragraph-aware chunks for
 *  retrieval — spec §5/§31: "do not resend the entire whitepaper/webpage
 *  for each generation... chunk... retrieve relevant sections." Never
 *  splits mid-word; prefers paragraph boundaries, falling back to sentence
 *  boundaries, falling back to a hard character cut only when a single
 *  paragraph itself exceeds the chunk size. Bounded to `maxChunks` (a very
 *  long document is truncated, not endlessly chunked — matches the
 *  "bounded ingestion target" requirement) — returns fewer, not more. */
export function chunkText(text: string, maxChunkChars = DEFAULT_MAX_CHUNK_CHARS, maxChunks = DEFAULT_MAX_CHUNKS): TextChunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= maxChunkChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (para.length <= maxChunkChars) {
      current = para;
    } else {
      // A single paragraph longer than the cap: split on sentence
      // boundaries, then hard-cut only as a last resort.
      const sentences = para.split(/(?<=[.!?])\s+/);
      let piece = "";
      for (const s of sentences) {
        const next = piece ? `${piece} ${s}` : s;
        if (next.length <= maxChunkChars) { piece = next; continue; }
        if (piece) chunks.push(piece);
        piece = s.length <= maxChunkChars ? s : s.slice(0, maxChunkChars);
        while (piece.length > maxChunkChars) {
          chunks.push(piece.slice(0, maxChunkChars));
          piece = piece.slice(maxChunkChars);
        }
      }
      current = piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, maxChunks).map((content, index) => ({ index, content }));
}
