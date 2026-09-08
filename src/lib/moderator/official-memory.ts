import { COMMUNITY_RESOURCE_KINDS, type CommunityResourceKind, type CommunityKnowledgeItem } from "./community-message-knowledge";

export interface OfficialMemoryResource {
  url: string | null;
  kind: CommunityResourceKind;
  status: "confirmed" | "retracted";
  /** Verbatim source evidence, never a generated factual claim. */
  quote: string;
}

export function parseOfficialMemory(raw: string, text: string, urls: string[]): OfficialMemoryResource[] | null {
  try {
    const parsed: unknown = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    if (!Array.isArray(parsed) || parsed.length > 12) return null;
    const allowed = new Set(urls);
    const result: OfficialMemoryResource[] = [];
    for (const r of parsed) {
      if (!r || typeof r !== "object" || !COMMUNITY_RESOURCE_KINDS.includes(r.kind)
        || !["confirmed", "retracted"].includes(r.status) || typeof r.quote !== "string" || !r.quote.trim()
        || !text.includes(r.quote) || !(r.url === null || (typeof r.url === "string" && allowed.has(r.url)))) return null;
      // Links for consequential actions need an actual observed destination.
      if (["TRADING", "PRESALE", "CHART", "LISTING"].includes(r.kind) && !r.url) return null;
      result.push({ url: r.url, kind: r.kind, status: r.status, quote: r.quote });
    }
    return result;
  } catch { return null; }
}

export interface OfficialMemorySource {
  platform_message_id: string;
  message_thread_id: number | null;
  revision: number;
  source_url: string | null;
  is_pinned: boolean;
  is_announcement: boolean;
  resources: OfficialMemoryResource[];
  status?: "pending" | "ready" | "failed";
  content_hash?: string;
}

/** Latest explicit endorsement/retraction of an exact URL wins. For
 * purpose-specific resources the latest source supersedes older ones;
 * same-time competing destinations are withheld rather than guessed. */
export function currentOfficialMemoryItems(sources: OfficialMemorySource[]): CommunityKnowledgeItem[] {
  const byMessage = new Map<string, OfficialMemorySource[]>();
  for (const source of sources) byMessage.set(source.platform_message_id, [...(byMessage.get(source.platform_message_id) ?? []), source]);
  const currentSources: OfficialMemorySource[] = [];
  for (const revisions of byMessage.values()) {
    const revision = Math.max(...revisions.map(s => s.revision));
    const latest = revisions.filter(s => s.revision === revision);
    const usable = latest.length === 1 && (latest[0].status ?? "ready") === "ready";
    const resources = usable ? [...latest[0].resources] : [];
    // Missing or unresolved replacement invalidates the previous purpose as
    // well as its URL: never resurrect an even older buying destination.
    for (const prior of revisions.flatMap(s => s.resources)) {
      if (!resources.some(r => r.url === prior.url && r.kind === prior.kind)) resources.push({ ...prior, status: "retracted" });
    }
    currentSources.push({ ...latest[0], resources });
  }
  const allResources = currentSources.flatMap(source => source.resources.map(resource => ({ source, resource })));
  // A warning may retract an exact URL without restating its previous kind.
  for (const entry of allResources) {
    if (entry.resource.status === "retracted" && entry.resource.kind === "OTHER" && entry.resource.url) {
      const prior = allResources.find(r => r.resource.url === entry.resource.url && r.resource.kind !== "OTHER");
      if (prior) entry.resource = { ...entry.resource, kind: prior.resource.kind };
    }
  }
  const byUrl = new Map<string, Array<{ source: OfficialMemorySource; resource: OfficialMemoryResource }>>();
  for (const { source, resource } of allResources) {
      const key = resource.url ?? `fact:${resource.kind}:${resource.quote}`;
      const existing = byUrl.get(key) ?? [];
      const latest = existing[0]?.source.revision ?? -1;
      if (source.revision > latest) byUrl.set(key, [{ source, resource }]);
      else if (source.revision === latest) byUrl.set(key, [...existing, { source, resource }]);
  }
  const candidates = [...byUrl.values()].flatMap(versions => {
    if (versions.some(v => v.resource.status === "retracted")) return [];
    return [versions[0]];
  });
  const singleKinds = new Set<CommunityResourceKind>(["WEBSITE", "WHITEPAPER", "DOCUMENTATION", "ROADMAP", "PRESALE", "TRADING", "TOKEN_INFORMATION", "PROJECT_STATUS"]);
  return candidates.filter(c => {
    if (!singleKinds.has(c.resource.kind)) return true;
    const same = allResources.filter(r => r.resource.kind === c.resource.kind);
    const newest = Math.max(...same.map(r => r.source.revision));
    const current = candidates.filter(r => r.resource.kind === c.resource.kind && r.source.revision === newest);
    return c.source.revision === newest && new Set(current.map(r => r.resource.url ?? r.resource.quote)).size === 1;
  }).map(({ source, resource }) => ({
    id: `${source.platform_message_id}:${resource.kind}:${resource.url ?? "text"}`,
    platformMessageId: source.platform_message_id, messageThreadId: source.message_thread_id,
    // A past pin event is provenance, not proof the post is STILL pinned.
    isAdminAuthor: true, isPinned: false, isAnnouncementTopic: source.is_announcement,
    kind: resource.kind, url: resource.url, text: resource.quote,
    createdAt: new Date(source.revision * 1000).toISOString(), sourceUrl: source.source_url,
  }));
}
