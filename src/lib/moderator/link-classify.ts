import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import { PROMOTION_WARNING_LIMIT, type LinkCategory, type ClassificationConfidence } from "./link-moderation";

/**
 * The AI-touching half of link moderation, kept separate from
 * link-moderation.ts (pure policy/no I/O) — mirrors the existing chatter-
 * coordinator.ts / chatter-generate.ts split. Link-intent classification and
 * the natural warning line are both genuinely new automations, not part of
 * the existing CASUAL_CHAT/ANSWER carve-out, so both stay on the hard
 * INNVIL_REQUIRED_MODEL default (Sonnet 5, medium effort) via
 * getInnvilModelConfig() rather than DeepSeek — moderation decisions can
 * delete content and ban people, which is exactly the class of consequence
 * the model-routing invariant exists to protect.
 */

const CATEGORIES: LinkCategory[] = [
  "SAFE_RELEVANT_LINK",
  "APPROVED_PARTNER_LINK",
  "COLLABORATION_REQUEST",
  "AMA_REQUEST",
  "PARTNERSHIP_REQUEST",
  "UNSOLICITED_PROMOTION",
  "LINK_SPAM_OR_FLOOD",
  "PHISHING_OR_SCAM",
  "EXPLICIT_CONTENT",
  "UNKNOWN_OR_AMBIGUOUS",
];

export interface LinkClassificationResult {
  category: LinkCategory;
  confidence: ClassificationConfidence;
}

const CLASSIFY_SYSTEM_PROMPT = `You classify a single Telegram community message that contains an external link or another group/channel reference, for moderation purposes.

Context matters more than the link itself — the SAME url can be legitimate outreach or an advertisement depending on how it's framed. Examples:
- "We're doing an AMA with these guys tomorrow: https://t.me/projectxyz" -> COLLABORATION_REQUEST or AMA_REQUEST (legitimate)
- "Everyone leave this group and join: https://t.me/projectxyz" -> UNSOLICITED_PROMOTION (advertisement)

A bare @username mention by itself, with no accompanying suspicious content (no urgent call to action, no promise of rewards/free money, no request for credentials/private keys/funds, no impersonation of a known project or official account), is NOT sufficient on its own to classify as PHISHING_OR_SCAM or UNSOLICITED_PROMOTION — someone addressing another person or bot by @username is ordinary conversation, not a link/promotion signal. Only classify a message as suspicious when the actual evidence (a scam-shaped URL, an urgent/impersonation pattern, a promotional call-to-action, etc.) is present.

Categories (choose exactly one):
- SAFE_RELEVANT_LINK: a link genuinely relevant to the ongoing discussion (docs, news, GitHub, support resources, official project links).
- APPROVED_PARTNER_LINK: a link to an already-established partner/official resource.
- COLLABORATION_REQUEST: genuine outreach proposing to work together (not asking to join another group instead).
- AMA_REQUEST: proposing or referencing an AMA (Ask Me Anything) session.
- PARTNERSHIP_REQUEST: asking who handles partnerships, or proposing a partnership.
- UNSOLICITED_PROMOTION: advertising another project/group/channel with no legitimate relevance to this community, especially urging people to leave/join elsewhere.
- LINK_SPAM_OR_FLOOD: looks like an automated or repetitive advertising burst.
- PHISHING_OR_SCAM: a link designed to steal credentials/funds (fake exchange, fake support, wallet drainer, impersonation of a known project's official domain).
- EXPLICIT_CONTENT: pornographic/explicit content.
- UNKNOWN_OR_AMBIGUOUS: genuinely unclear — an unfamiliar resource with no strong signal either way.

Respond with EXACTLY two lines, nothing else:
CATEGORY: <one of the categories above, exact spelling>
CONFIDENCE: <low|medium|high>`;

/**
 * Classification only (never the sole ban authority — see
 * decideLinkEnforcement in link-moderation.ts, which combines this with
 * sender role/repetition history/severity before anything irreversible
 * happens). Any failure (unconfigured/errored) degrades to
 * UNKNOWN_OR_AMBIGUOUS/low confidence, which the policy layer always
 * resolves to ALLOW — an AI hiccup must never itself cause a deletion/ban.
 */
export async function classifyLinkIntent(messageText: string, recentContextSummary: string): Promise<LinkClassificationResult> {
  const fallback: LinkClassificationResult = { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" };
  if (!aiConfigured()) return fallback;
  try {
    const { model, effort } = getInnvilModelConfig();
    const raw = await aiComplete({
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Recent conversation (for context only):\n${recentContextSummary || "(none)"}\n\nMessage to classify:\n${messageText}` }],
      model,
      effort,
      maxTokens: 64,
      automation: "LINK_MODERATION_CLASSIFY",
    });
    const categoryMatch = raw.match(/CATEGORY:\s*([A-Z_]+)/i);
    const confidenceMatch = raw.match(/CONFIDENCE:\s*(low|medium|high)/i);
    const category = categoryMatch?.[1]?.toUpperCase() as LinkCategory | undefined;
    const confidence = confidenceMatch?.[1]?.toLowerCase() as ClassificationConfidence | undefined;
    if (!category || !CATEGORIES.includes(category) || !confidence) return fallback;
    return { category, confidence };
  } catch {
    return fallback;
  }
}

const WARNING_FALLBACK_TEMPLATES = [
  "Hey, please don't drop unrelated promo links in here. I'll remove this one for now — repeated advertising can get you removed.",
  "Please keep outside promotions relevant to the discussion. I've removed that link for now. If it keeps happening, I'll have to remove you.",
  "That looks like unsolicited promotion, so I'm taking the link down. Please don't advertise other groups here unless it's relevant or approved.",
];

/** Persona-voiced warning line (spec §24: "do not repeatedly output robotic
 *  wording"). Falls back to a small VARIED template pool (never one fixed
 *  sentence) if generation fails, so enforcement always produces a natural-
 *  enough notice even when the model call itself has an issue — the
 *  DELETE/BAN action itself never depends on this succeeding. */
export async function generateModerationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  warningNumber: number,
  isFinalWarning: boolean
): Promise<string> {
  if (aiConfigured()) {
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system: [
          `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message for posting unsolicited promotion (advertising another project/group with no relevance here).`,
          `Write ONE short, natural warning to the person, in your own voice (persona description: ${persona.description || "no specific persona configured — keep it plain and neutral"}).`,
          `This is warning #${warningNumber} of ${PROMOTION_WARNING_LIMIT}.`,
          isFinalWarning ? `This is their FINAL warning — make clear that the next violation results in removal from the community.` : `Keep it firm but not harsh — a normal warning, not a threat.`,
          `Never output "Violation ${warningNumber}/${PROMOTION_WARNING_LIMIT}" or similar robotic/templated wording — write like a real person would.`,
          `Respond with ONLY the message you'd actually send — no quotation marks, no explanation, under 30 words.`,
        ].join("\n"),
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 200,
        automation: "LINK_MODERATION_WARNING",
      });
      const text = raw.trim();
      if (text) return text.slice(0, 300);
    } catch {
      // fall through to the deterministic pool below
    }
  }
  return WARNING_FALLBACK_TEMPLATES[Math.min(warningNumber, WARNING_FALLBACK_TEMPLATES.length) - 1] ?? WARNING_FALLBACK_TEMPLATES[0];
}
