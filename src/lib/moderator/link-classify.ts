import "server-only";

import { aiComplete, aiConfigured, getInnvilModelConfig } from "@/src/lib/ai/client";
import type { ModeratorPersona } from "./domain";
import {
  SPAM_WARNING_LIMIT,
  SOLICITATION_WARNING_LIMIT,
  isNearDuplicateWarning,
  maxWarningSimilarity,
  NEAR_DUPLICATE_WARNING_THRESHOLD,
  resolveWarningResponseMode,
  warningTextExceedsAuthorizedFacts,
  scamFirstOffenseWarningHtml,
  scamRepeatOffenseWarningHtml,
  type LinkCategory,
  type ClassificationConfidence,
  type WarningResponseMode,
} from "./link-moderation";
import { personaVoiceBlock } from "./chatter-generate";
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
  "SEARCH_SPAM",
  "NEGATIVE_STATEMENT",
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
- "Search miniairdrops" (posted by one member alone, or by several different members within minutes of each other) -> SEARCH_SPAM. This has zero connection to this project -- it's an off-topic engagement-farming instruction, not a promotion or a link, and should be flagged as SEARCH_SPAM even from a single sender.
- "Scam Project 😂😂" / "Definitely scam lol" -> NEGATIVE_STATEMENT. A bare mocking accusation, no question, no evidence. But "Is this a scam?" or "Why does everyone say this is a rug?" -> NOT NEGATIVE_STATEMENT, these are genuine questions and must be handled/answered normally like any other question.

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
- SEARCH_SPAM: a short instruction telling members to search, google, or look something up that has NO connection whatsoever to this project/community (e.g. "Search miniairdrops", "Google [some unrelated app name]"). This is a distinct off-topic engagement-farming/search-manipulation pattern -- flag it as SEARCH_SPAM even when it's a single, isolated message from one sender, with no link/handle/promotion wording of any kind. It's especially common (but NOT required) for several different, unrelated accounts to post the exact same instruction within minutes of each other -- treat every occurrence as SEARCH_SPAM regardless of whether you can see other similar messages nearby. Never UNSOLICITED_PROMOTION (it doesn't advertise a project/service or ask for contact) and never LINK_SPAM_OR_FLOOD (no link is involved).
- NEGATIVE_STATEMENT: an unfounded, mocking, or dismissive ASSERTION that this project is a scam/rug/fraud/dead/worthless, with NO genuine question and NO specific evidence or reasoning behind it (e.g. "Scam Project 😂😂", "Definitely scam", "This is a rugpull lol", "trash project, avoid this"). CRITICAL -- do NOT classify a genuine QUESTION this way, even one using the exact same words (e.g. "Is this a scam?", "Why do people keep calling this a rug?") -- a real question is asking for information and must be answered normally like any other question, never treated as this category. Also do NOT classify a SUBSTANTIVE, evidence-backed concern this way (e.g. "I checked the contract and there's a hidden mint function letting the team create unlimited tokens, here's the code: ...", "the team wallet just dumped 40% of supply, here's the transaction hash") -- a real, reasoned red-flag report with specific evidence is legitimate community information the room should be able to see, even though it's negative, and is NEVER this category. NEGATIVE_STATEMENT is specifically for baseless mockery/accusation with no real question and no real content behind it.
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
  /** Escalation stage (2026-09-04) -- "warning N of LIMIT" for THIS specific
   *  offender's own repeated-violation ladder (decideLinkEnforcement's
   *  warningNumber). A structured fact, not something the model infers from
   *  the mute duration alone -- lets tone genuinely firm up across repeat
   *  offenses (Case B: "the exact same sentence with only the mute number
   *  changed" is exactly the bug this fixes) without ever changing what
   *  actually happened. Always the real SOLICITATION_WARNING_LIMIT-based
   *  ladder position, since this function is never called for scam/phishing
   *  (that path stays fully deterministic, unchanged). */
  warningNumber: number;
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
  /** For a SEARCH_SPAM violation only (2026-09-03 live feedback: an
   *  off-topic "search X"/"google X" instruction, flagged as spam, never as
   *  a promotion). "isolated" = a standalone occurrence from one sender --
   *  warned and addressed at them like every other violation.
   *  "coordinated" = the message immediately preceding this one in the room
   *  (from ANY sender) was ALSO SEARCH_SPAM-shaped -- the classic multi-
   *  account raid signature -- so the warning reads as a general room-wide
   *  reminder instead, and must NOT name or single out this one sender.
   *  undefined for every other category. When set, the caller
   *  (community-runtime.ts) also passes promotionTopicName/contactHandle as
   *  null regardless of what's configured -- there's nothing to redirect a
   *  spam instruction to, this isn't a project pitch. */
  searchSpamPattern?: "isolated" | "coordinated";
}

/** Bounded to exactly one retry (2026-09-04 anti-repetition fix, see
 *  link-moderation.ts's isNearDuplicateWarning) -- never an unbounded loop.
 *  Only the last 3 of the caller-supplied recent texts are ever referenced
 *  in the prompt, kept short, so this never balloons the request. */
const MAX_RECENT_WARNINGS_IN_PROMPT = 3;
const MAX_RECENT_WARNING_SNIPPET_CHARS = 140;

function stripMentionForPrompt(text: string): string {
  return text.replace(/<a\b[^>]*>.*?<\/a>/gi, "[name]").replace(/@[a-z0-9_]+/gi, "[name]");
}

/** Mode-aware retry instruction (2026-09-04, second pass -- see
 *  resolveWarningResponseMode in link-moderation.ts). Both modes still ask
 *  for genuinely different phrasing (never a second attempt that reads as
 *  the same skeleton again); they differ only in what happens to LENGTH:
 *  ENFORCEMENT_NOTICE (a real mute is attached to THIS violation) must
 *  never be shortened away -- the mute fact still has to land clearly, so
 *  this near-duplicate is treated as an ordinary "say it differently"
 *  rewrite, not a nudge. SHORT_NUDGE (nothing beyond the deletion itself is
 *  happening) is explicitly told to go brief, since there's no real
 *  consequence that needs spelling out in full a second time. */
function buildAvoidRepeatingNote(recentOwnWarnings: string[], mode: WarningResponseMode): string {
  const sample = recentOwnWarnings
    .slice(-MAX_RECENT_WARNINGS_IN_PROMPT)
    .map((t) => `"${stripMentionForPrompt(t).slice(0, MAX_RECENT_WARNING_SNIPPET_CHARS)}"`)
    .join(" / ");
  const lengthInstruction =
    mode === "ENFORCEMENT_NOTICE"
      ? "A real consequence is attached to THIS violation, so still state every required fact clearly and in full -- just phrase it differently, don't shorten it away."
      : "Since this keeps coming up and nothing further happened this time beyond removing the message, keep this one especially short -- a brief correction, not a full explanation.";
  return `You've said something VERY similar to this recently in this same room: ${sample}. Say THIS one differently -- change the opener, the sentence structure, and the closing line so it doesn't read like a repeat. ${lengthInstruction}`;
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
 *  or less accurate warning than before, only a differently-phrased one.
 *
 *  2026-09-04: two further live-reported problems fixed in this same
 *  function, per explicit product requirement --
 *  (1) the persona voice now reuses the SAME persona-realization machinery
 *  (personaVoiceBlock, chatter-generate.ts) Natural Chatter's own
 *  conversational replies already use -- formality/slang/humor/teasing/
 *  emoji dials and customInstructions, not just the bare description
 *  sentence -- so two differently-configured Watchers genuinely SOUND
 *  different for the identical underlying violation, never a second,
 *  separate "moderation persona" system;
 *  (2) `recentOwnWarnings` (this SAME Watcher's own recent MODERATION
 *  WARNINGS in this SAME community -- caller-supplied and already scoped to
 *  exclude ordinary chatter, see community-runtime.ts's
 *  recentOwnModeratorMessages) lets this step notice when it's about to
 *  repeat itself and regenerate ONCE with an explicit "say it differently"
 *  instruction -- bounded to a single retry, never an unbounded loop, and it
 *  can only ever change WORDING, never the underlying facts (the
 *  requiredFacts list below is unaffected by this and is still injected
 *  verbatim into the retry).
 *
 *  2026-09-04, second pass -- two more completeness gaps closed in this
 *  same function:
 *  (3) the retry is now response-MODE aware (resolveWarningResponseMode,
 *  link-moderation.ts): a violation with a real mute attached is always an
 *  ENFORCEMENT_NOTICE and is never shortened/suppressed even when it reads
 *  as a near-duplicate -- only a violation with no consequence beyond the
 *  deletion itself may become a brief SHORT_NUDGE on retry, or (third pass,
 *  same day) resolve to genuine silence when it's not just similar but
 *  NEAR-IDENTICAL to something this Watcher just said (see the return type
 *  below and NO_PUBLIC_REPLY's own doc comment);
 *  (4) EVERY generated candidate (both the no-retry fast path and the
 *  retry) is now passed through warningTextExceedsAuthorizedFacts before
 *  ever being returned -- generated text is treated as untrusted
 *  presentation output, never an enforcement authority; a candidate that
 *  states an unsupported specific fact (a wrong/invented mute-minute count,
 *  a raw link, or a definite ban/kick/removal claim that never happened) is
 *  discarded in favor of the already-known-safe deterministic template,
 *  never "corrected" in place.
 *
 *  2026-09-04, third pass -- returns `string | null` now: `null` means
 *  NO_PUBLIC_REPLY (this violation has no real consequence attached AND the
 *  candidate reads as near-identical to something this Watcher just said in
 *  this same room -- nothing new to communicate). The CALLER is responsible
 *  for skipping the SEND_TEXT/insert entirely on `null` while still running
 *  every other enforcement step (delete/mute/state-persistence) exactly as
 *  before -- language realization never gates enforcement. `null` is NEVER
 *  returned as a result of generation FAILING (a failed attempt always
 *  falls to the deterministic template, a real string) -- silence here is
 *  strictly a "nothing new to say" decision, never a symptom of AI being
 *  down. */
export async function generatePersonaSolicitationWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  facts: SolicitationWarningFacts,
  aiRouting?: AccountAiRouting,
  recentOwnWarnings: string[] = []
): Promise<string | null> {
  // Live feedback (2026-09-02): "it should not send the promotion link, it
  // should say promotion" -- the redirect destination is now ALWAYS spoken
  // by name only. promotionTopicLink is never surfaced in generated text at
  // all anymore (kept on SolicitationWarningFacts only for a future
  // dashboard display, never for the Telegram message itself). The caller
  // (community-runtime.ts) is also responsible for only ever passing a
  // REAL, known name here -- never a generic placeholder like "this topic"
  // -- since a model handed a placeholder string has no way to tell it
  // isn't a real name and will nonsensically quote it as one.
  const deterministicFallback = () => {
    const mutePart = facts.muteMinutes ? ` This resulted in a ${facts.muteMinutes}-minute mute.` : "";
    if (facts.isCompetingProjectPromotion) {
      return `Promoting other projects or tokens is not allowed here, in any form.${mutePart} Repeated offenses escalate to a kick or ban.`;
    }
    if (facts.searchSpamPattern) {
      return facts.searchSpamPattern === "coordinated"
        ? `Please stop spamming that here.${mutePart} Repeated offenses escalate to a kick or ban.`
        : `No spamming that here, please.${mutePart} Repeated offenses escalate to a kick or ban.`;
    }
    const where = facts.promotionTopicName ? ` Post that in ${facts.promotionTopicName} instead.` : facts.contactHandle ? ` For that, contact ${facts.contactHandle}.` : "";
    return `No promos in ${facts.currentTopicName}, please.${where}${mutePart} Repeated offenses escalate to a kick or ban.`;
  };

  const requiredFacts: string[] = [
    facts.searchSpamPattern
      ? `State plainly that this kind of off-topic spam isn't allowed in "${facts.currentTopicName}" (this exact topic name) -- keep this part brief, don't over-explain it.`
      : `State plainly that promotions aren't allowed in "${facts.currentTopicName}" (this exact topic name) -- keep this part brief, don't over-explain it.`,
  ];
  if (facts.muteMinutes) requiredFacts.push(`State the real ${facts.muteMinutes}-minute mute in a short clause -- do not invent a different number.`);
  else requiredFacts.push(`No mute applies to this specific offense -- do not claim one happened.`);
  if (facts.isCompetingProjectPromotion) {
    // A "global no-go" -- never offer or hint at ANY alternative venue,
    // topic, or contact, even if one is genuinely configured for THIS
    // community's own promotion elsewhere.
    requiredFacts.push(`This was a rally to promote a DIFFERENT project/token, not this community's own -- state plainly that promoting other projects/tokens is never allowed here, in any form. Do NOT suggest any alternative place to post it, do NOT mention a Promotion channel/topic/contact of any kind.`);
  } else if (facts.searchSpamPattern === "coordinated") {
    // Live feedback (2026-09-03): "if 2 messages followed each other, the
    // warning should be only general please stop spamming" -- several
    // different accounts posted the same off-topic instruction back to
    // back, so this reads as a room-wide reminder, never naming one person.
    requiredFacts.push(`This is part of a coordinated pattern -- more than one account has posted this same kind of off-topic "search/look something up" spam back to back. Write this as a GENERAL reminder to the room -- do NOT name, mention, or single out this one specific person, just say something like "please stop spamming that here" addressed to whoever's doing it.`);
  } else if (facts.searchSpamPattern === "isolated") {
    requiredFacts.push(`State plainly that this off-topic "search/look something up" instruction is spam and has nothing to do with this project -- there is no Promotion destination or contact to mention here, this isn't a project pitch.`);
  } else if (facts.promotionTopicName) {
    requiredFacts.push(`Mention the real Promotion destination BY NAME ONLY, exactly as "${facts.promotionTopicName}" -- never a link/URL of any kind, and never any other destination or contact even if one is also configured.`);
  } else if (facts.contactHandle) {
    requiredFacts.push(`Mention the real configured contact: ${facts.contactHandle}.`);
  } else {
    requiredFacts.push(`No Promotion destination or contact is configured for this community -- do NOT invent one or tell them to go somewhere that doesn't exist.`);
  }
  requiredFacts.push(`Briefly note repeated offenses escalate (to a mute, then a kick/ban) -- a short closing clause, not a full sentence spelling out every step.`);

  const violationDescription = facts.isCompetingProjectPromotion
    ? "rallying members to promote a different, unrelated project/token (not this community's own)"
    : facts.searchSpamPattern
      ? "posting off-topic spam (an instruction to search/look something up that has nothing to do with this project)"
      : "posting unsolicited promotion (advertising a project/service with no relevance here, or soliciting private contact for a growth/marketing service)";

  // Escalation-stage fact (Case B: tone should genuinely firm up across
  // repeat offenses, never just swap the mute number into an otherwise
  // identical sentence). Purely a TONE instruction -- the actual mute/
  // destination/contact facts above are the only things that may ever be
  // STATED; this only affects how firm/patient the wording sounds.
  const escalationLine =
    facts.warningNumber <= 1
      ? `This is this person's FIRST offense of this kind -- keep the tone light/matter-of-fact, not harsh.`
      : `This is warning ${facts.warningNumber} of ${SOLICITATION_WARNING_LIMIT} for this SAME kind of violation from this SAME person -- you've already told them this before, so sound noticeably firmer/less patient than a first-time nudge, while still sounding like yourself. Do not write it as if this were their first offense.`;

  const buildSystem = (avoidRepeatingNote?: string): string =>
    [
      `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message for ${violationDescription}.`,
      // Live bug: a message asking "Dev I am your friend DM me" got a warning
      // that opened with "i'm not the dev and we don't do promo deals over
      // dms" -- this function is NEVER given the removed message's actual
      // wording (see SolicitationWarningFacts, which carries no raw-text
      // field at all), so any specific claim/denial about what it said --
      // an identity ("I'm not the dev"), a role, a relationship, or anything
      // else beyond violationDescription above -- is a pure invention with
      // no basis in fact. Enforcing the "no promos here" policy is correct
      // and required; reacting to invented specifics from a message the
      // model was never shown is not.
      `You were NOT shown the exact wording of the removed message -- you only know it was ${violationDescription}. Do NOT guess, invent, or react to specific words, names, or claims from it -- for example, never claim or deny being "the dev," an admin, or any other specific role/identity/relationship the message might have referenced. State only the required facts below, in your own voice, without responding to anything else the message may have said.`,
      `Write ONE short, natural, casual warning${facts.searchSpamPattern === "coordinated" ? " to the room" : " to the person"}, entirely in your own persona voice (see below).`,
      ...personaVoiceBlock(persona),
      escalationLine,
      `Facts you must include, stated accurately -- never invent, omit, or alter any of these -- but work them in NATURALLY and BRIEFLY, the way a real person would actually type a quick warning, not as a checklist:`,
      ...requiredFacts.map((f) => `- ${f}`),
      `Mention AT MOST ONE destination/contact (whichever fact above applies) -- never list a Promotion topic AND a contact handle together, that reads like a form letter, not a person.`,
      `Never output robotic/templated phrasing like "Violation N" and never enumerate facts as separate clauses joined with commas -- write like a real short chat message.`,
      `Always write the warning in English, regardless of what language the violating message itself was written in.`,
      avoidRepeatingNote,
      `Respond with ONLY the message you'd actually send -- no quotation marks, no explanation. Keep it SHORT: one sentence, occasionally two if it genuinely needs both a fact and the escalation note. Under 30 words.`,
    ]
      .filter((line): line is string => !!line)
      .join("\n");

  /** Returns the generated text, or null when generation genuinely could not
   *  happen (BYO required-but-unusable, no AI configured, or a failed
   *  call) -- null is the caller's signal to fall back to the deterministic
   *  template, exactly preserving the prior branch-by-branch behavior
   *  (including the "zero network calls when BYO is required but unusable"
   *  and "never reach Innvil's own key when BYO is required" invariants). */
  const attemptGeneration = async (system: string): Promise<string | null> => {
    if (aiRouting?.required) {
      const cred = aiRouting.credential;
      if (!cred?.model) return null;
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
        return text ? text.slice(0, 400) : null;
      } catch {
        return null;
      }
    }
    if (!aiConfigured()) return null;
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
      return text ? text.slice(0, 400) : null;
    } catch {
      return null;
    }
  };

  // Generated text is untrusted presentation output, never an enforcement
  // authority (2026-09-04, second pass) -- `authoritativeFacts` is the ONLY
  // thing any generated candidate is checked against, applied uniformly to
  // both the fast (no-retry) path and the bounded retry below. A candidate
  // that fails is discarded in favor of the already-known-safe deterministic
  // template -- never "fixed up" (that would itself be an untrusted rewrite).
  const authoritativeFacts = { muteMinutes: facts.muteMinutes ?? null };
  const sanitize = (candidate: string) => (warningTextExceedsAuthorizedFacts(candidate, authoritativeFacts) ? deterministicFallback() : candidate);

  const first = await attemptGeneration(buildSystem());
  if (first === null) return deterministicFallback();

  // Response-mode resolution (2026-09-04, third pass) -- a REAL mute
  // attached to this violation is always ENFORCEMENT_NOTICE, unconditionally,
  // regardless of similarity (see resolveWarningResponseMode's own doc
  // comment). Otherwise the mode is driven entirely by how similar this
  // candidate already is to something this Watcher just said.
  const similarity = recentOwnWarnings.length ? maxWarningSimilarity(first, recentOwnWarnings) : 0;
  const mode = resolveWarningResponseMode({ hasEnforcementConsequence: !!facts.muteMinutes, similarityToRecent: similarity });
  if (mode === "NO_PUBLIC_REPLY") return null;
  if (mode === "WARNING") return sanitize(first);
  // ENFORCEMENT_NOTICE is the mode whenever a real mute is attached,
  // REGARDLESS of similarity -- SHORT_NUDGE can only be reached with a
  // genuine similarity signal (empty/no-match history forces similarity to
  // 0, which never resolves to SHORT_NUDGE), but a mute-bearing notice with
  // nothing recently similar has no "sounds like a repeat" problem to
  // solve, so it's returned as-is rather than spending a wasted retry call.
  if (mode === "ENFORCEMENT_NOTICE" && similarity < NEAR_DUPLICATE_WARNING_THRESHOLD) return sanitize(first);

  // SHORT_NUDGE or a genuinely-near-duplicate ENFORCEMENT_NOTICE: bounded to
  // exactly ONE retry -- if the regenerated text is somehow still similar,
  // or the retry itself fails, it's used/fallen-back-from exactly the same
  // as any other generation outcome, never looped again. Mode-aware
  // (buildAvoidRepeatingNote's own doc comment): ENFORCEMENT_NOTICE must
  // still be stated in full on the retry, never shortened away.
  const retry = await attemptGeneration(buildSystem(buildAvoidRepeatingNote(recentOwnWarnings, mode)));
  return sanitize(retry ?? first);
}

/* ==================== scam/phishing warnings, now ALSO persona-voiced ==== */
// 2026-09-04, third pass -- explicit product correction: scam/phishing
// DETECTION and the resulting ENFORCEMENT DECISION (whether this is a scam,
// whether to delete, mute, or kick, the exact mute duration, the warning/
// strike count) were NEVER at issue and remain 100% deterministic, entirely
// inside decideLinkEnforcement (link-moderation.ts) -- untouched by this.
// What was wrong was conflating that with "the VISIBLE WORDING must also be
// deterministic," which is a separate, non-required constraint. Proven from
// the actual code, not asserted: in community-runtime.ts, the mute
// (`RESTRICT_USER mode:"MUTE"`) executes in a code block gated ONLY on
// `enforcement.muteMinutes && token` -- it does not reference whether the
// warning text/SEND_TEXT above it succeeded at all -- and the kick for a
// repeat offense executes BEFORE any warning text is generated. Enforcement
// is therefore ALREADY fully independent of language realization for this
// category, exactly the same guarantee generatePersonaSolicitationWarning
// already relies on for promotion warnings. There is no reliability
// blocker, so there is no justification for exempting this one category.
//
// Safety is preserved by giving this function ONLY safe, structured facts
// -- never the violating message's text, never the malicious URL/domain/
// handle -- mirroring SolicitationWarningFacts' own "no raw content" shape
// exactly. The existing "never reproduce the malicious URL" invariant is
// now enforced TWICE: structurally (the URL is never part of ScamWarningFacts,
// so the model has nothing to reproduce even if it tried) and by the shared
// warningTextExceedsAuthorizedFacts guard's new URL_OR_LINK_RE check, which
// rejects a generated candidate outright if it contains anything link-shaped
// regardless of where it could have come from.

export interface ScamWarningFacts {
  /** False = first confirmed offense (message removed, user muted -- never
   *  banned/kicked on a first offense). True = REPEAT confirmed offense --
   *  the user has ALREADY been kicked from the community by the time this
   *  text is generated. The resulting message is a COMMUNITY-facing
   *  reminder, never addressed to the kicked person (see this function's
   *  own doc comment) -- the kick is a real, already-recorded enforcement
   *  fact, kept separate from what this public text says. */
  isRepeatOffense: boolean;
  /** Real, exact mute duration for a FIRST offense only -- undefined/ignored
   *  for a repeat offense (nothing is muted on a kick). Never invented by
   *  the model; when present it MUST be stated verbatim. */
  muteMinutes: number | undefined;
}

/** Persona-voiced scam/phishing warning -- supersedes scamFirstOffenseWarningHtml
 *  / scamRepeatOffenseWarningHtml as the NORMAL path (both functions are kept,
 *  unchanged for the first-offense case, and are exactly what this falls
 *  back to on any generation failure or when no AI provider is usable --
 *  there is no scenario where this produces a less safe or less accurate
 *  warning than before, only a differently-phrased one when generation
 *  succeeds). Always resolves to ENFORCEMENT_NOTICE mode (see
 *  resolveWarningResponseMode) -- a scam/phishing notice is ALWAYS either a
 *  real mute or an already-executed kick, never a bare no-consequence
 *  warning, so it can never legitimately go silent or shorten itself away;
 *  the anti-repetition retry, when it triggers, only ever varies PHRASING,
 *  never shortens or omits a required fact.
 *
 *  Kick/ban public-message AUDIENCE semantics (2026-09-05, explicit product
 *  correction): a successful kick/ban changes WHO the visible message is
 *  for. The removed person may no longer be present to read anything
 *  addressed to them ("you have been removed") -- that framing is simply
 *  the wrong audience, not merely undesirable phrasing. So for a REPEAT
 *  (kick) offense, this function generates a COMMUNITY-FACING moderation
 *  notice instead of a personal warning: no mention/handle is embedded at
 *  all (`mentionHtml` is only ever used for the FIRST-offense, still-user-
 *  facing mute case), and the model is explicitly instructed never to
 *  address/name/tag the removed person. It's fine, and expected, for this
 *  notice to remind the room of the rule and state -- in general,
 *  prospective policy terms -- that repeated/severe violations result in
 *  removal; it must never claim that a specific named person was just
 *  personally removed. The private Watcher Ops audit report (sent
 *  separately, community-runtime.ts) is untouched and still records exactly
 *  who was kicked, why, and when -- that internal enforcement fact is kept
 *  fully separate from this public community message. */
export async function generatePersonaScamWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  mentionHtml: string,
  facts: ScamWarningFacts,
  aiRouting?: AccountAiRouting,
  recentOwnWarnings: string[] = []
): Promise<string> {
  // scamFirstOffenseWarningHtml always states SCAM_FIRST_WARNING_MUTE_MINUTES
  // internally -- decideLinkEnforcement (link-moderation.ts) never produces
  // any OTHER mute value for a first scam offense, so facts.muteMinutes is
  // guaranteed to already equal that same constant; no separate parameter
  // is needed for the fallback to stay accurate. scamRepeatOffenseWarningHtml
  // takes no mention -- it's a community-facing reminder, not addressed to
  // the removed person.
  const deterministicFallback = () => (facts.isRepeatOffense ? scamRepeatOffenseWarningHtml() : scamFirstOffenseWarningHtml(mentionHtml));

  const requiredFacts: string[] = facts.isRepeatOffense
    ? [
        "Do NOT address, name, mention, tag, or otherwise refer to any specific person -- this message is for the community as a whole, not the person who was removed (they may no longer be present to read it).",
        "Remind the community, in your own words, that posting scam/phishing links is not tolerated here.",
        "State, in general policy terms, that repeated or severe violations of this result in removal from the community -- a plain rule/consequence statement, never a claim describing what specifically just happened to one named individual.",
      ]
    : [
        "This is their FIRST confirmed scam/phishing offense.",
        `You also muted them for exactly ${facts.muteMinutes} minutes as a result -- state this real number verbatim, never a different one.`,
        "Make clear that another confirmed scam/phishing violation will result in removal (a kick) from this community.",
      ];

  const buildSystem = (avoidRepeatingNote?: string): string =>
    [
      `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message because it contained a suspected scam/phishing link${facts.isRepeatOffense ? ", and this was a repeat offense from that same person, so they have also just been removed from the community" : ""}.`,
      `You were NOT shown the link/message content itself and do not know what it said -- you must NEVER mention, describe, guess, or invent any specific URL, domain, wallet address, project name, or account handle from it. Only refer to it generically as "a scam/phishing link" or "that link."`,
      facts.isRepeatOffense
        ? `Write ONE short, natural COMMUNITY-FACING moderation reminder, entirely in your own persona voice (see below) -- addressed to the room in general, never to the specific person who was just removed.`
        : `Write ONE short, natural warning directly to the person, entirely in your own persona voice (see below).`,
      ...personaVoiceBlock(persona),
      `Facts you must include, stated accurately -- never invent, omit, or alter any of these -- but work them in NATURALLY, the way a real person would actually type it, not as a checklist:`,
      ...requiredFacts.map((f) => `- ${f}`),
      `Never output robotic/templated phrasing -- write like a real short chat message, not a form letter.`,
      `Never include a link, URL, or @handle of any kind in your response.`,
      `Always write the warning in English.`,
      avoidRepeatingNote,
      facts.isRepeatOffense
        ? `Respond with ONLY the message you'd actually post to the community -- no quotation marks, no explanation, no mention/handle of any kind. Keep it SHORT: one or two sentences, under 30 words.`
        : `Respond with ONLY the message you'd actually send to this person -- no quotation marks, no explanation, no greeting/mention (that's added separately). Keep it SHORT: one or two sentences, under 30 words.`,
    ]
      .filter((line): line is string => !!line)
      .join("\n");

  const attemptGeneration = async (system: string): Promise<string | null> => {
    if (aiRouting?.required) {
      const cred = aiRouting.credential;
      if (!cred?.model) return null;
      try {
        const raw = await aiComplete({
          system,
          messages: [{ role: "user", content: "Write the warning now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 200,
          automation: "SCAM_MODERATION_WARNING_BYO",
        });
        const text = raw.trim();
        return text ? text.slice(0, 300) : null;
      } catch {
        return null;
      }
    }
    if (!aiConfigured()) return null;
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system,
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 200,
        automation: "SCAM_MODERATION_WARNING",
      });
      const text = raw.trim();
      return text ? text.slice(0, 300) : null;
    } catch {
      return null;
    }
  };

  // No `removalHappened` escape hatch anymore (2026-09-05 correction) -- a
  // definite, completed-tense "you have been removed"-style claim is now
  // ALWAYS the wrong audience semantics, regardless of whether removal
  // genuinely happened, so it's unconditionally rejected here too. General,
  // prospective community-facing rule language ("repeated violations result
  // in removal") is a structurally different statement shape and was never
  // matched by this check to begin with -- see DEFINITE_REMOVAL_CLAIM_RE's
  // own doc comment (link-moderation.ts).
  const authoritativeFacts = { muteMinutes: facts.isRepeatOffense ? null : facts.muteMinutes ?? null };
  const sanitize = (body: string) =>
    warningTextExceedsAuthorizedFacts(body, authoritativeFacts) ? deterministicFallback() : facts.isRepeatOffense ? body : `${mentionHtml}, ${body}`;

  const first = await attemptGeneration(buildSystem());
  if (first === null) return deterministicFallback();

  if (!recentOwnWarnings.length || !isNearDuplicateWarning(first, recentOwnWarnings)) return sanitize(first);

  // Bounded to exactly ONE retry -- ENFORCEMENT_NOTICE only (scam is never
  // eligible for SHORT_NUDGE/NO_PUBLIC_REPLY, see this function's own doc
  // comment), so the retry always asks for full-but-differently-phrased
  // wording, never brevity/suppression.
  const retry = await attemptGeneration(buildSystem(buildAvoidRepeatingNote(recentOwnWarnings, "ENFORCEMENT_NOTICE")));
  return sanitize(retry ?? first);
}

/* ================= negative-statement (unfounded scam/rug accusation) warnings ==== */
// 2026-09-05, explicit product decision: an unfounded, mocking scam/rug/fraud
// ACCUSATION (never a genuine question, never a substantive evidence-backed
// report -- see link-classify's own NEGATIVE_STATEMENT category definition
// and decideLinkEnforcement's dedicated ladder in link-moderation.ts) gets a
// deliberately QUIET 1st offense (deleted with no public text at all -- this
// function is never even called for that case, see community-runtime.ts),
// then a real warning+mute on the 2nd, then a real time-bound ban on the
// 3rd+. This function ONLY ever handles the 2nd/escalated cases -- mirrors
// generatePersonaScamWarning's exact safety shape: given ONLY safe,
// structured facts, NEVER the violating message's own text (same "you were
// not shown the message" invariant that fixed a real live bug where a
// generator invented a specific identity denial from a message it was never
// shown -- extended here from day one rather than needing a later fix).

export interface NegativeStatementWarningFacts {
  /** False = 2nd offense (message removed, user muted for muteMinutes).
   *  True = ESCALATED (3rd+) offense -- the user has ALREADY been banned for
   *  banHours by the time this text is generated. The resulting message is
   *  a COMMUNITY-facing reminder, never addressed to the banned person (see
   *  this function's own doc comment) -- the ban is a real, already-recorded
   *  enforcement fact, kept separate from what this public text says. */
  isEscalatedOffense: boolean;
  /** Real, exact mute duration for the 2nd-offense case only -- never
   *  invented; NEGATIVE_STATEMENT_MUTE_MINUTES today, but the caller always
   *  supplies the real value rather than this function assuming a constant. */
  muteMinutes: number | undefined;
  /** Real, exact ban duration in HOURS for the escalated case only -- always
   *  a genuine, time-bound removal, never implying it's permanent. */
  banHours: number | undefined;
}

/** Persona-voiced negative-statement warning -- falls back to a fixed
 *  deterministic template (unchanged shape regardless of generation success)
 *  on any failure or when no AI provider is usable, so a public notice
 *  always exists and is always accurate even when generation itself has an
 *  issue.
 *
 *  Kick/ban public-message AUDIENCE semantics (2026-09-05, explicit product
 *  correction, same as generatePersonaScamWarning above): the ESCALATED
 *  (ban) case is a COMMUNITY-facing moderation reminder, not a personal
 *  message -- the banned person may no longer be present to read anything
 *  addressed to them. `mentionHtml` is only ever used for the non-escalated
 *  (2nd-offense, still-a-mute) case, which stays user-facing. The private
 *  Watcher Ops audit report (community-runtime.ts) still records exactly
 *  who was banned, why, and when -- kept fully separate from this message. */
export async function generatePersonaNegativeStatementWarning(
  moderatorName: string,
  persona: ModeratorPersona,
  mentionHtml: string,
  facts: NegativeStatementWarningFacts,
  aiRouting?: AccountAiRouting,
  recentOwnWarnings: string[] = []
): Promise<string> {
  const deterministicFallback = () =>
    facts.isEscalatedOffense
      ? "Spreading unfounded negative claims or accusations about the project isn't allowed here -- repeated violations can result in a mute, and then a ban, from the community."
      : `${mentionHtml}, please stop spreading unverified negative claims about this project here -- that's a ${facts.muteMinutes}-minute mute. Repeated offenses escalate to a ban.`;

  const requiredFacts: string[] = facts.isEscalatedOffense
    ? [
        "Do NOT address, name, mention, tag, or otherwise refer to any specific person -- this message is for the community as a whole, not the person who was banned (they may no longer be present to read it).",
        "Remind the community, in your own words, that spreading unfounded negative claims, mockery, or accusations about the project (with no real question or evidence behind them) isn't allowed here.",
        "State, in general policy terms, that repeated violations of this can result in a mute and, if it continues, a ban from the community -- a plain rule/consequence statement, never a claim describing what specifically just happened to one named individual.",
      ]
    : [
        "This is their FIRST offense of this specific kind (an unfounded, mocking scam/rug/fraud accusation with no real question or evidence behind it).",
        `You also muted them for exactly ${facts.muteMinutes} minutes as a result -- state this real number verbatim, never a different one.`,
        "Make clear that doing this again will result in a ban from this community.",
      ];

  const buildSystem = (avoidRepeatingNote?: string): string =>
    [
      `You are ${moderatorName}, a moderator in a Telegram community. You just removed a message because it spread an unfounded, mocking negative claim/accusation about this project (e.g. calling it a scam/rug with no real question or evidence behind it) -- a genuine question about whether something is a scam is completely fine and is never what this is about.${facts.isEscalatedOffense ? " This was a repeat offense from that same person, so they have also just been banned from the community for 24 hours." : ""}`,
      `You were NOT shown the exact wording of the removed message -- you only know what kind of violation it was, described above. Do NOT guess, invent, or react to specific words, names, or claims from it.`,
      facts.isEscalatedOffense
        ? `Write ONE short, natural COMMUNITY-FACING moderation reminder, entirely in your own persona voice (see below) -- addressed to the room in general, never to the specific person who was just banned.`
        : `Write ONE short, natural warning directly to the person, entirely in your own persona voice (see below).`,
      ...personaVoiceBlock(persona),
      `Facts you must include, stated accurately -- never invent, omit, or alter any of these -- but work them in NATURALLY, the way a real person would actually type it, not as a checklist:`,
      ...requiredFacts.map((f) => `- ${f}`),
      `Never output robotic/templated phrasing -- write like a real short chat message, not a form letter.`,
      `Always write the warning in English.`,
      avoidRepeatingNote,
      facts.isEscalatedOffense
        ? `Respond with ONLY the message you'd actually post to the community -- no quotation marks, no explanation, no mention/handle of any kind. Keep it SHORT: one or two sentences, under 30 words.`
        : `Respond with ONLY the message you'd actually send to this person -- no quotation marks, no explanation, no greeting/mention (that's added separately). Keep it SHORT: one or two sentences, under 30 words.`,
    ]
      .filter((line): line is string => !!line)
      .join("\n");

  const attemptGeneration = async (system: string): Promise<string | null> => {
    if (aiRouting?.required) {
      const cred = aiRouting.credential;
      if (!cred?.model) return null;
      try {
        const raw = await aiComplete({
          system,
          messages: [{ role: "user", content: "Write the warning now." }],
          model: cred.model,
          providerOverride: byoProviderOverride(cred),
          maxTokens: 200,
          automation: "NEGATIVE_STATEMENT_WARNING_BYO",
        });
        const text = raw.trim();
        return text ? text.slice(0, 300) : null;
      } catch {
        return null;
      }
    }
    if (!aiConfigured()) return null;
    try {
      const { model, effort } = getInnvilModelConfig();
      const raw = await aiComplete({
        system,
        messages: [{ role: "user", content: "Write the warning now." }],
        model,
        effort,
        maxTokens: 200,
        automation: "NEGATIVE_STATEMENT_WARNING",
      });
      const text = raw.trim();
      return text ? text.slice(0, 300) : null;
    } catch {
      return null;
    }
  };

  // No `removalHappened` escape hatch anymore -- see generatePersonaScamWarning's
  // matching comment above; a definite "you have been banned"-style claim is
  // now always the wrong audience semantics and is rejected unconditionally.
  const authoritativeFacts = { muteMinutes: facts.isEscalatedOffense ? null : facts.muteMinutes ?? null };
  const sanitize = (body: string) =>
    warningTextExceedsAuthorizedFacts(body, authoritativeFacts) ? deterministicFallback() : facts.isEscalatedOffense ? body : `${mentionHtml}, ${body}`;

  const first = await attemptGeneration(buildSystem());
  if (first === null) return deterministicFallback();

  if (!recentOwnWarnings.length || !isNearDuplicateWarning(first, recentOwnWarnings)) return sanitize(first);

  const retry = await attemptGeneration(buildSystem(buildAvoidRepeatingNote(recentOwnWarnings, "ENFORCEMENT_NOTICE")));
  return sanitize(retry ?? first);
}
