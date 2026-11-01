import { extractLinks } from "./link-moderation";
import { exactResourceKey } from "./link-context";
import type { CommunityKnowledgeGrounding } from "./community-message-knowledge";

export function answerLinksAreGrounded(reply: string, question: string, grounding?: CommunityKnowledgeGrounding | null, projectTexts: string[] = []): boolean {
  const output = extractLinks(reply).filter(url => !url.startsWith("@"));
  if (!output.length) return true;
  const references = grounding?.facts.flatMap(f => f.sourceUrl ? [f.sourceUrl] : []) ?? [];
  const trading = grounding?.otherResources.filter(r => r.kind === "TRADING").map(r => r.url) ?? [];
  const isBuying = /\b(?:buy|buying|purchase|swap)\b/i.test(question);
  // A source announcement may accompany the live endpoint, never replace it
  // with a chart, old presale, or model-generated pool/mint parameter.
  const allowed = isBuying && grounding ? [...trading, ...references] : [
    ...(grounding?.otherResources.map(r => r.url) ?? []), ...references,
    ...(grounding?.whitepaperLink ? [grounding.whitepaperLink] : []),
    ...(grounding?.pinnedReference?.link ? [grounding.pinnedReference.link] : []),
    ...projectTexts.flatMap(t => extractLinks(t)),
    ...(grounding?.facts.flatMap(f => extractLinks(f.text)) ?? []),
  ];
  const resourceKey = (url: string) => exactResourceKey(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  const keys = new Set(allowed.map(resourceKey).filter(Boolean));
  // Do not discard invalid output URLs: malformed/credential-bearing links
  // must fail validation, not vanish from the set being checked.
  return output.every(url => { const key = resourceKey(url); return key !== null && keys.has(key); });
}
