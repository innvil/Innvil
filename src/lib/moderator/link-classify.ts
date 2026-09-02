import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import { SPAM_WARNING_LIMIT, type LinkCategory, type ClassificationConfidence } from "./link-moderation";
import { byoProviderOverride, type AccountAiRouting } from "@/src/lib/products/watch-runtime";

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
  "COMPETING_PROJECT_PROMOTION",
  "LINK_SPAM_OR_FLOOD",
  "PHISHING_OR_SCAM",
  "EXPLICIT_CONTENT",
  "UNKNOWN_OR_AMBIGUOUS",
];

export interface LinkClassificationResult {
  category: LinkCategory;
  confidence: ClassificationConfidence;
}

const CLASSIFY_SYSTEM_PROMPT = `You classify a single Telegram community message for moderation purposes. Most messages you're asked to classify contain an external link or another group/channel reference, but some do NOT — a message can be unsolicited advertising/self-promotion purely through its wording, with no url or @handle present at all (e.g. offering to "promote your project", "bring buyers/investors", or "grow your community/volume", and asking the reader to DM/message/contact the sender). Classify those exactly the same way you would a link-bearing advertisement.

Context matters more than the link itself — the SAME url can be legitimate outreach or an advertisement depending on how it's framed. Examples:
- "We're doing an AMA with these guys tomorrow: https://t.me/projectxyz" -> COLLABORATION_REQUEST or AMA_REQUEST (legitimate)
- "Everyone leave this group and join: https://t.me/projectxyz" -> UNSOLICITED_PROMOTION (advertisement -- it asks people to ABANDON this community)
- "Looking for real investors & strong volume? I can promote your project across active crypto communities. DM me if you're ready to grow." (no link at all) -> UNSOLICITED_PROMOTION (a self-promotion service pitch soliciting private contact, still an advertisement even with no url)
- "LETS GO, SHILL RAID IN @othercrypto_chat and spread the word" -> SAFE_RELEVANT_LINK, NOT UNSOLICITED_PROMOTION or COMPETING_PROJECT_PROMOTION. This is a "shill raid" -- rallying THIS community's own members to go INTO another Telegram group/venue and promote/mention THIS community's OWN project there (a completely standard, allowed crypto-community growth tactic). The mentioned @handle/link here is only the VENUE the raid targets -- it is never itself the thing being promoted or advertised, and mentioning it is not advertising that other group to this community. "Spread the word" with nothing else named means spread the word about THIS project, the one this community is already about.
- "Let's rally and go shill $OTHERCOIN over at @somegroup" / "everyone go support @unrelatedproject, they're a great token" -> COMPETING_PROJECT_PROMOTION, a SEPARATE category from UNSOLICITED_PROMOTION (see its own definition below). Here the thing being promoted is a DIFFERENT, specifically named project/token that is NOT this community's own subject -- this community's own members are effectively being organized to advertise someone else's unrelated (often competing) project, regardless of whether it's framed as a "raid."
The decisive question for a raid/rally message is always WHAT is being promoted, never WHERE: rallying members to promote THIS community's own project (wherever the venue is, even an external group) is allowed (SAFE_RELEVANT_LINK); rallying members to promote a different, specifically named project is COMPETING_PROJECT_PROMOTION.

A bare @username mention by itself, with no accompanying suspicious content (no urgent call to action, no promise of rewards/free money, no request for credentials/private keys/funds, no impersonation of a known project or official account), is NOT sufficient on its own to classify as PHISHING_OR_SCAM or UNSOLICITED_PROMOTION — someone addressing another person or bot by @username is ordinary conversation, not a link/promotion signal. Only classify a message as suspicious when the actual evidence (a scam-shaped URL, an urgent/impersonation pattern, a promotional call-to-action, etc.) is present.

SOLICITED content is not "unsolicited": check the recent conversation for a community admin/moderator explicitly asking for exactly this — a link, a username/handle, a project name, or similar information ("drop your link here", "send me your @username", "share the project link", "what's your handle?", etc.). If this message is a direct response providing what was asked for, classify it as SAFE_RELEVANT_LINK (or the specific matching category, e.g. COLLABORATION_REQUEST/PARTNERSHIP_REQUEST if that's what was being discussed) — never UNSOLICITED_PROMOTION. The exact same link/username posted with no such request in the conversation would be a completely different case; being asked by an admin is precisely what makes it solicited rather than unsolicited. If the recent conversation is empty/unavailable or shows no such request, do not assume one was made.

Categories (choose exactly one):
- SAFE_RELEVANT_LINK: a link genuinely relevant to the ongoing discussion (docs, news, GitHub, support resources, official project links).
- APPROVED_PARTNER_LINK: a link to an already-established partner/official resource.
- COLLABORATION_REQUEST: genuine outreach proposing to work together (not asking to join another group instead).
- AMA_REQUEST: proposing or referencing an AMA (Ask Me Anything) session.
- PARTNERSHIP_REQUEST: asking who handles partnerships, or proposing a partnership.
- UNSOLICITED_PROMOTION: advertising another project/group/channel, or a generic marketing/growth/exposure SERVICE pitch, with no legitimate relevance to this community -- especially urging people to leave/abandon THIS community and join elsewhere. Does NOT include a "shill raid" that sends members to an external VENUE to promote THIS community's own project (see the worked examples above) -- the venue targeted is never itself the thing being judged. Does NOT include rallying members to promote a DIFFERENT specifically-named project/token either -- see COMPETING_PROJECT_PROMOTION below, a separate category with its own separate enforcement.
- COMPETING_PROJECT_PROMOTION: rallying or otherwise encouraging THIS community's own members to promote/support/shill a DIFFERENT, specifically named project or token that is NOT this community's own subject (e.g. "let's go shill $OTHERCOIN", "everyone support @unrelatedproject too"). Distinct from ordinary UNSOLICITED_PROMOTION -- promoting a rival/unrelated project inside a project-specific community is treated as a strict, unconditional violation, never exempted the way ordinary self-promotion pitches sometimes are.

IMPORTANT — a common spam evasion tactic dresses up an unsolicited marketing-service pitch in "partnership"/"collaboration" wording specifically to be misread as COLLABORATION_REQUEST or PARTNERSHIP_REQUEST. A message is still UNSOLICITED_PROMOTION, not a genuine collaboration/partnership request, when it:
- is a cold, unprompted pitch offering a GENERIC growth/marketing/exposure SERVICE (e.g. "I can bring you investors/buyers/volume/exposure", "we help projects grow through KOL marketing", "boost your trading volume/market cap") rather than proposing a SPECIFIC, concrete joint activity between two named parties;
- reads as templated copy that could be sent unchanged to any project in any community (no reference to anything specific about THIS community/project);
- ends by directing the reader to DM/message/contact the SENDER to "get started"/"grow"/"boost", i.e. the real goal is to move the conversation to a private sales pitch, not to actually discuss terms in the open;
- comes from someone with no established relationship to this community and no context showing they were asked.
A GENUINE COLLABORATION_REQUEST or PARTNERSHIP_REQUEST instead proposes a specific joint action ("we'd like to co-host an AMA with you next week", "our team wants to explore an integration — who should I talk to?") or is itself the SOLICITED response to an admin's own request (see the SOLICITED-content rule above). When genuinely unsure which of the two this is, weigh the presence of a generic "DM me to grow/boost/promote" call-to-action heavily toward UNSOLICITED_PROMOTION.
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
 *
 * BYO Enterprise (Phase 2, 2026-08-24): `aiRouting?.required` is checked
 * FIRST — when true, classification routes through the account's own
 * stored credential; getInnvilModelConfig()/Innvil's own key are never
 * reached in that branch. A missing/unusable BYO credential degrades to
 * the SAME safe fallback as any other failure — never Innvil's key.
 */
export async function classifyLinkIntent(messageText: string, recentContextSummary: string, aiRouting?: AccountAiRouting): Promise<LinkClassificationResult> {
  const fallback: LinkClassificationResult = { category: "UNKNOWN_OR_AMBIGUOUS", confidence: "low" };
  const userContent = `Recent conversation (for context only):\n${recentContextSummary || "(none)"}\n\nMessage to classify:\n${messageText}`;

  if (aiRouting?.required) {
    const cred = aiRouting.credential;
    if (!cred || !cred.model) return fallback;
    try {
      const raw = await aiComplete({
        system: CLASSIFY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
        model: cred.model,
        providerOverride: byoProviderOverride(cred),
        maxTokens: 64,
        automation: "LINK_MODERATION_CLASSIFY_BYO",
      });
      return parseClassification(raw, fallback);
    } catch {
      return fallback;
    }
  }

  if (!aiConfigured()) return fallback;
  try {
    const { model, effort } = getInnvilModelConfig();
    const raw = await aiComplete({
      system: CLASSIFY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      model,
      effort,
      maxTokens: 64,
      automation: "LINK_MODERATION_CLASSIFY",
    });
    return parseClassification(raw, fallback);
  } catch {
    return fallback;
  }
}

function parseClassification(raw: string, fallback: LinkClassificationResult): LinkClassificationResult {
  const categoryMatch = raw.match(/CATEGORY:\s*([A-Z_]+)/i);
  const confidenceMatch = raw.match(/CONFIDENCE:\s*(low|medium|high)/i);
  const category = categoryMatch?.[1]?.toUpperCase() as LinkCategory | undefined;
  const confidence = confidenceMatch?.[1]?.toLowerCase() as ClassificationConfidence | undefined;
  if (!category || !CATEGORIES.includes(category) || !confidence) return fallback;
  return { category, confidence };
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
 *  DELETE/BAN action itself never depends on this succeeding.
 *
 *  BYO Enterprise (Phase 2, 2026-08-24): `aiRouting?.required` is checked
 *  FIRST — when true, generation routes through the account's own stored
 *  credential; `aiConfigured()`/Innvil's own key are never reached in that
 *  branch. Any BYO failure falls straight to the same template pool. */
export async function generateModerationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  warningNumber: number,
  isFinalWarning: boolean,
  aiRouting?: AccountAiRouting
): Promise<string> {
  const system = [
    `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message for posting unsolicited promotion (advertising another project/group with no relevance here).`,
    `Write ONE short, natural warning to the person, in your own voice (persona description: ${persona.description || "no specific persona configured — keep it plain and neutral"}).`,
    `This is warning #${warningNumber} of ${SPAM_WARNING_LIMIT}.`,
    isFinalWarning ? `This is their FINAL warning — make clear that the next violation results in removal from the community.` : `Keep it firm but not harsh — a normal warning, not a threat.`,
    `Never output "Violation ${warningNumber}/${SPAM_WARNING_LIMIT}" or similar robotic/templated wording — write like a real person would.`,
    `Respond with ONLY the message you'd actually send — no quotation marks, no explanation, under 30 words.`,
  ].join("\n");

  if (aiRouting?.required) {
    const cred = aiRouting.credential;
    if (cred?.model) {
      try {
        const raw = await aiComplete({
          system,
          messages: [{ role: "user", content: "Write the warning now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 200,
          automation: "LINK_MODERATION_WARNING_BYO",
        });
        const text = raw.trim();
        if (text) return text.slice(0, 300);
      } catch {
        // fall through to the deterministic pool below
      }
    }
    return WARNING_FALLBACK_TEMPLATES[Math.min(warningNumber, WARNING_FALLBACK_TEMPLATES.length) - 1] ?? WARNING_FALLBACK_TEMPLATES[0];
  }

  if (aiConfigured()) {
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system,
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

export interface SolicitationWarningFacts {
  /** Display name of the topic the violation happened in (e.g. "General"). */
  currentTopicName: string;
  /** Exact mute duration this violation triggered, if any — undefined means
   *  no mute (e.g. a first offense). Never invented by the model; when
   *  present it MUST be stated verbatim. */
  muteMinutes: number | undefined;
  /** The real configured redirect destination's display NAME (either a real
   *  Telegram Forum "Promotion" topic, or the plain-community fallback name
   *  set on Community Settings) + an optional real link, when one is known
   *  — both null when nothing is configured at all, in which case the model
   *  must never invent a destination. The name is always what gets SPOKEN
   *  ("post that in our Promotion channel") — the link, when present, is
   *  only ever appended as an additional clickable reference, never read
   *  out as if it were itself the name. */
  promotionTopicName: string | null;
  promotionTopicLink: string | null;
  /** The Project's configured partnerships/promotion contact handle, when
   *  one exists — null means none is configured, never fabricated. */
  contactHandle: string | null;
  /** True for a COMPETING_PROJECT_PROMOTION violation (rallying members to
   *  promote a different, specifically named project/token) -- a "global
   *  no-go" per explicit product decision, distinct from ordinary
   *  UNSOLICITED_PROMOTION. When true, the caller (community-runtime.ts)
   *  MUST also pass promotionTopicName/promotionTopicLink/contactHandle as
   *  null regardless of what's actually configured for this community --
   *  promoting a rival project is never redirected anywhere, even if a real
   *  Promotion destination or contact exists for THIS community's own
   *  promotion. Defaults to false/undefined for every existing caller. */
  isCompetingProjectPromotion?: boolean;
}

/** Persona-voiced solicitation/promotion warning — supersedes the flat
 *  deterministic `topicSolicitationWarningText` template's WORDING (per
 *  explicit live product feedback: "the way it says a warning is too
 *  generic... it should be persona based, not generic bot warning"), while
 *  keeping every stated FACT exactly as deterministic and accurate as
 *  before — the model is required to include each given fact verbatim
 *  (the current topic's real name, the exact mute duration when one
 *  applies, the real configured Promotion topic name/link, the real
 *  configured contact handle), never inventing or omitting one. Falls back
 *  to the EXACT existing deterministic template (byte-for-byte the same
 *  output this function replaces) on any generation failure or when no AI
 *  provider is usable — there is no scenario where this produces a worse
 *  or less accurate warning than before, only a differently-phrased one. */
export async function generatePersonaSolicitationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  facts: SolicitationWarningFacts,
  aiRouting?: AccountAiRouting
): Promise<string> {
  const deterministicFallback = () => {
    // Mirrors community-topics.ts's topicSolicitationWarningText +
    // community-runtime.ts's promotionContactSentence exactly, inlined here
    // so this function's fallback never depends on a circular import.
    const mutePart = facts.muteMinutes ? ` This resulted in a ${facts.muteMinutes}-minute mute.` : "";
    if (facts.isCompetingProjectPromotion) {
      return `Promoting other projects or tokens is not allowed here, in any form.${mutePart} Repeatedly doing this may result in a mute, and a 5th offense may result in a kick or ban.`;
    }
    const contactPart = facts.contactHandle ? ` For promotion inquiries, please contact ${facts.contactHandle}.` : "";
    if (!facts.promotionTopicName) {
      return `Please do not send promotions in ${facts.currentTopicName}. Repeatedly sending promotional content here may result in a mute, and a 5th offense may result in a kick or ban.${mutePart}${contactPart}`;
    }
    const where = facts.promotionTopicLink ? `${facts.promotionTopicName} (${facts.promotionTopicLink})` : facts.promotionTopicName;
    return `Please do not send promotions in ${facts.currentTopicName}. If you want to promote a project, please use the ${where} topic instead. Repeatedly sending promotional content in ${facts.currentTopicName} may result in a mute, and a 5th offense may result in a kick or ban.${mutePart}${contactPart}`;
  };

  const requiredFacts: string[] = [
    `The current topic is named "${facts.currentTopicName}" — you must state that promotions aren't allowed HERE, by this exact name.`,
  ];
  if (facts.muteMinutes) requiredFacts.push(`This violation results in a real ${facts.muteMinutes}-minute mute — state this exact number, do not invent a different one.`);
  else requiredFacts.push(`No mute applies to this specific offense — do not claim one happened.`);
  if (facts.isCompetingProjectPromotion) {
    // A "global no-go" -- never offer or hint at ANY alternative venue,
    // topic, or contact, even if one is genuinely configured for THIS
    // community's own promotion elsewhere. This is the one case where the
    // ordinary Promotion-destination/contact facts below are deliberately
    // never surfaced, regardless of what's actually configured.
    requiredFacts.push(`This was a request/rally to promote a DIFFERENT project or token, not this community's own. State plainly that promoting other projects/tokens is never allowed here, in any form -- do NOT suggest any alternative place to post it, do NOT mention a Promotion channel/topic/contact of any kind, even if one exists for this community's own promotion.`);
  } else if (facts.promotionTopicName) {
    requiredFacts.push(
      `Redirect them to the real configured Promotion destination, referring to it BY NAME exactly as "${facts.promotionTopicName}" — never read out a raw link/URL as if it were the name.${facts.promotionTopicLink ? ` A real link is also available (${facts.promotionTopicLink}) — you may include it alongside the name, but the name must still be stated.` : " No link is available, just name it."}`
    );
  } else {
    requiredFacts.push(`No Promotion destination is configured for this community — do NOT invent one or tell them to go somewhere that doesn't exist.`);
  }
  if (!facts.isCompetingProjectPromotion && facts.contactHandle) requiredFacts.push(`Mention the real configured promotion contact: ${facts.contactHandle}.`);
  requiredFacts.push(`Always also state: repeated offenses escalate to a mute, and a 5th offense may result in a kick or ban.`);

  const system = [
    `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message for ${facts.isCompetingProjectPromotion ? "rallying members to promote a different, unrelated project/token (not this community's own)" : "posting unsolicited promotion (advertising a project/service with no relevance here, or soliciting private contact for a growth/marketing service)"}.`,
    `Write ONE short, natural warning to the person, entirely in your own persona voice (persona description: ${persona.description || "no specific persona configured — keep it plain and neutral"}).`,
    `Required facts you MUST include, stated accurately -- never invent, omit, or alter any of these:`,
    ...requiredFacts.map((f) => `- ${f}`),
    `Never output robotic/templated phrasing like "Violation N" -- write like a real person in-character would, while still stating every required fact above.`,
    `Always write the warning in English, regardless of what language the violating message itself was written in.`,
    `Respond with ONLY the message you'd actually send -- no quotation marks, no explanation, under 60 words.`,
  ].join("\n");

  if (aiRouting?.required) {
    const cred = aiRouting.credential;
    if (cred?.model) {
      try {
        const raw = await aiComplete({
          system,
          messages: [{ role: "user", content: "Write the warning now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 220,
          automation: "LINK_MODERATION_WARNING_BYO",
        });
        const text = raw.trim();
        if (text) return text.slice(0, 400);
      } catch {
        // fall through to the deterministic template below
      }
    }
    return deterministicFallback();
  }

  if (aiConfigured()) {
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system,
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 220,
        automation: "LINK_MODERATION_WARNING",
      });
      const text = raw.trim();
      if (text) return text.slice(0, 400);
    } catch {
      // fall through to the deterministic template below
    }
  }
  return deterministicFallback();
}
