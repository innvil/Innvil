import "server-only";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { extractReadableText, isPrivateOrReservedIpv4, validateIngestUrl } from "./knowledge-ingestion";
import type { LinkEvidence } from "./link-context";

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 4500;
type Page = { status: number; headers: IncomingHttpHeaders; body: string };
export interface InspectionTransport {
  resolve(host: string): Promise<string[]>;
  read(url: URL, address: string, signal: AbortSignal): Promise<Page>;
}

/** Deliberately IPv4-only for this first reader: IPv6-only hosts are unknown,
 * not unsafe. Reject non-global/documentation/benchmark ranges too. */
export function isPublicInspectionAddress(ip: string): boolean {
  if (isIP(ip) !== 4 || isPrivateOrReservedIpv4(ip)) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 192 && (b === 0 || b === 2 || (b === 88 && c === 99)))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    && !(a === 203 && b === 0 && c === 113);
}

/** Connect only to the checked address while retaining the original host
 * header and TLS hostname verification. No proxy, cookies or credentials.
 * The abort signal covers headers AND streaming body, not just connect. */
export function readPinnedPage(url: URL, address: string, signal: AbortSignal): Promise<Page> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(url, {
      agent: false, family: 4, signal, maxHeaderSize: 16 * 1024,
      lookup: (_host, _options, callback) => callback(null, address, 4),
      headers: { "user-agent": "InnvilWatcherLinkPreview/1.0", accept: "text/html,text/plain", "accept-encoding": "identity" },
    }, res => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        resolve({ status, headers: res.headers, body: "" });
        res.destroy();
        return;
      }
      const type = String(res.headers["content-type"] ?? "").split(";")[0].trim();
      if (status !== 200 || !["text/html", "text/plain", "application/xhtml+xml"].includes(type)
        || Number(res.headers["content-length"] ?? 0) > MAX_BYTES
        || !["", "identity"].includes(String(res.headers["content-encoding"] ?? ""))) {
        reject(new Error("Unreadable response"));
        res.destroy();
        return;
      }
      let bytes = 0;
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { res.destroy(new Error("Preview too large")); return; }
        chunks.push(chunk);
      });
      res.on("error", reject);
      res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const transport: InspectionTransport = {
  resolve: async host => (await dns.lookup(host, { all: true, family: 4 })).map(r => r.address),
  read: readPinnedPage,
};

export function extractPreviewText(html: string): string {
  const metadata: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1].toLowerCase(), m[3]]));
    const key = attributes.get("property") ?? attributes.get("name") ?? "";
    if (/^(?:og:title|og:description|twitter:title|twitter:description|description)$/i.test(key)) {
      metadata.push(attributes.get("content") ?? "");
    }
  }
  return [...metadata, extractReadableText(html)].join("\n").slice(0, 4000);
}

/** Testable redirect policy. A timeout also bounds DNS; after it fires no
 * late resolver result is permitted to open a socket. Every hop is checked. */
export async function inspectProjectLink(raw: string, io: InspectionTransport = transport, timeoutMs = TIMEOUT_MS): Promise<LinkEvidence> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<LinkEvidence>(resolve => {
    timeout = setTimeout(() => { controller.abort(); resolve({ url: raw, status: "unavailable" }); }, timeoutMs);
  });
  const work = async (): Promise<LinkEvidence> => {
    try {
      let current = new URL(raw);
      for (let hop = 0; hop <= 3; hop++) {
        if (!validateIngestUrl(current.href).ok || current.port || current.hostname.endsWith(".local") || current.hostname === "localhost"
          || isIP(current.hostname.replace(/^\[|\]$/g, "")) === 6) return { url: raw, status: "blocked" };
        const addresses = isIP(current.hostname) ? [current.hostname] : await io.resolve(current.hostname);
        if (controller.signal.aborted) return { url: raw, status: "unavailable" };
        if (!addresses.length || addresses.some(ip => !isPublicInspectionAddress(ip))) return { url: raw, status: "blocked" };
        const page = await io.read(current, addresses[0], controller.signal);
        if (page.status >= 300 && page.status < 400) {
          if (!page.headers.location) break;
          current = new URL(page.headers.location, current);
          continue;
        }
        if (page.status !== 200) break;
        const text = extractPreviewText(page.body);
        return text.trim() ? { url: raw, finalUrl: current.href, status: "readable", text }
          : { url: raw, finalUrl: current.href, status: "unavailable" };
      }
    } catch { /* no network/parse failure may become a moderation violation */ }
    return { url: raw, status: "unavailable" };
  };
  try { return await Promise.race([work(), expired]); }
  finally { clearTimeout(timeout!); controller.abort(); }
}

const cache = new Map<string, { expires: number; value: Promise<LinkEvidence> }>();
let active = 0;
export async function inspectMessageLinks(urls: string[]): Promise<LinkEvidence[]> {
  return Promise.all([...new Set(urls)].filter(u => /^https?:\/\//i.test(u)).slice(0, 3).map(url => {
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (active >= 6) return Promise.resolve<LinkEvidence>({ url, status: "unavailable" });
    active++;
    const entry = { expires: Date.now() + TIMEOUT_MS, value: Promise.resolve<LinkEvidence>({ url, status: "unavailable" }) };
    entry.value = inspectProjectLink(url).then(result => {
      entry.expires = Date.now() + (result.status === "readable" ? 300_000 : 30_000);
      return result;
    }).finally(() => { active--; });
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(url, entry);
    return entry.value;
  }));
}
