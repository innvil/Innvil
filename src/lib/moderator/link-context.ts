import { extractLinks } from "./link-moderation";

export interface LinkEvidence {
  url: string;
  finalUrl?: string;
  status: "readable" | "unavailable" | "blocked";
  text?: string;
}

export interface LinkProjectContext {
  project: { name: string; overview: string } | null;
  resources: Array<{ url: string; kind: string; text: string }>;
  topic: { name: string | null; solicitationAllowed: boolean };
  senderRole: "admin" | "member" | "unknown";
  links?: LinkEvidence[];
}

/** Preserve identity-bearing queries and path casing. Never whitelist a host
 * such as x.com/raydium.io just because one URL on it is official. */
export function exactResourceKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/** Machine-owned context is separate from untrusted chat/page quotations. */
export function serializeLinkProjectContext(context?: LinkProjectContext): string {
  if (!context) return "Project identity and official resources unavailable. Do not infer unrelatedness from missing evidence.";
  return JSON.stringify({
    project: context.project ? { name: context.project.name, overview: context.project.overview.slice(0, 5000) } : null,
    topic: context.topic,
    senderRole: context.senderRole,
    officialResourceEvidence: context.resources.slice(0, 30).map(r => ({ url: r.url, kind: r.kind, text: r.text.slice(0, 600) })),
    untrustedPageEvidence: (context.links ?? []).slice(0, 3).map(r => ({ ...r, text: r.text?.slice(0, 4000) })),
  });
}

export interface TelegramTextEntity { type: string; offset: number; length: number; url?: string }

/** Telegram offsets use UTF-16 code units, as does JS slice. Include hidden
 * text_link destinations as well as ordinary links, without changing text. */
export function extractMessageLinks(text: string, entities: TelegramTextEntity[] = []): string[] {
  const links = extractLinks(text);
  for (const entity of entities) {
    const url = entity.type === "text_link" ? entity.url
      : entity.type === "url" ? text.slice(entity.offset, entity.offset + entity.length) : null;
    if (url && exactResourceKey(url)) links.push(url);
  }
  return [...new Set(links)];
}

/** Bare observed domains get only a deterministic HTTPS scheme; no path,
 * pool, token or other destination component is ever invented. */
export function httpMessageLinks(links: string[]): string[] {
  return [...new Set(links.filter(l => !l.startsWith("@")).map(l => exactResourceKey(/^https?:\/\//i.test(l) ? l : `https://${l}`)).filter((l): l is string => l !== null))];
}
