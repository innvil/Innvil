import type { ModeratorPersona } from "./domain";
import type { CommunityKnowledgeItem } from "./community-message-knowledge";

export interface WelcomeMember {
  id: number;
  firstName?: string;
  username?: string;
}

export interface MemberWelcomeInput {
  members: WelcomeMember[];
  projectName: string | null;
  projectOverview: string | null;
  persona: ModeratorPersona;
  allowSolicitation: boolean;
  officialMemory: CommunityKnowledgeItem[];
}

const MAX_WELCOMEED_NAMES = 3;
const MAX_OFFICIAL_LINKS = 4;
const MAX_OVERVIEW_LENGTH = 220;

function displayName(member: WelcomeMember): string {
  const firstName = member.firstName?.replace(/\s+/g, " ").trim();
  if (firstName) return firstName.slice(0, 60);
  const username = member.username?.replace(/^@/, "").trim();
  return username ? username.slice(0, 60) : "there";
}

function joinedNames(members: WelcomeMember[]): string {
  const names = members.slice(0, MAX_WELCOMEED_NAMES).map(displayName);
  if (names.length === 0) return "there";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " and " + names[1];
  return names.slice(0, -1).join(", ") + ", and " + names[names.length - 1];
}

function safeOfficialUrls(items: CommunityKnowledgeItem[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    try {
      const parsed = new URL(item.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
      seen.add(item.url);
      urls.push(item.url);
      if (urls.length >= MAX_OFFICIAL_LINKS) break;
    } catch {
      // Older imports can contain malformed data. A welcome must not echo it.
    }
  }
  return urls;
}

function conciseOverview(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length <= MAX_OVERVIEW_LENGTH
    ? normalized
    : normalized.slice(0, MAX_OVERVIEW_LENGTH - 1).replace(/\s+\S*$/, "").trimEnd() + "…";
}

/** Deterministic, persona-shaped welcome copy. This is intentionally not an
 * AI generation: a join should be fast, inexpensive, and grounded only in
 * stored Project facts/current admin-confirmed resources. */
export function buildMemberWelcome(input: MemberWelcomeInput): string {
  const names = joinedNames(input.members);
  const projectName = input.projectName?.trim() || "the community";
  const formal = input.persona.formal === true || input.persona.formality >= 70;
  const slangy = !formal && input.persona.slang >= 65;
  const emoji = input.persona.emojiFrequency >= 65 ? " 👋" : "";
  const opening = formal
    ? "Welcome, " + names + ". Glad to have you with " + projectName + "."
    : slangy
      ? "hey " + names + ", welcome in — you are with " + projectName + " now."
      : "Hey " + names + ", welcome to " + projectName + "." + emoji;

  const parts = [opening];
  const overview = conciseOverview(input.projectOverview);
  if (overview) parts.push(overview);

  const links = safeOfficialUrls(input.officialMemory);
  if (links.length) parts.push("Official links from the team:\n" + links.join("\n"));

  const rules = input.allowSolicitation
    ? "Keep it respectful, do not flood the chat, never post scams or phishing links, and follow the admins’ lead."
    : "Keep it respectful, do not flood the chat, do not post scams or phishing links, no unsolicited promos, and follow the admins’ lead.";
  parts.push(formal ? "Community rules: " + rules : "Quick ground rules: " + rules);
  return parts.join("\n\n");
}
