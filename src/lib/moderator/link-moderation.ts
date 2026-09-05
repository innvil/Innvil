/* =========================================================
   Intelligent external-link moderation — pure logic, no I/O, no AI.

   Moderation asks a SEPARATE question from Natural Chatter: "does this
   message violate community policy?", not "should the moderator socially
   respond?" It runs independent of, and is never disabled by, the reactive
   chatter quota (Phase 4.M (B)) — a message can be ALLOW+SILENCE,
   ALLOW+CHATTER, DELETE+WARNING, or DELETE+BAN, and mention/no-mention has
   no bearing on whether moderation executes at all.

   External links are NOT automatically bad. Intent is classified by an AI
   call (link-classify.ts, kept separate — this file never touches the
   network) into a bounded taxonomy; THIS file is the deterministic policy
   layer combining that classification with sender role, repetition
   history, and confidence — "don't use LLM as sole ban authority" (spec
   §42): irreversible actions (bans) require role/history/confidence to
   agree, not classification alone.
   ========================================================= */

export type LinkCategory =
  | "SAFE_RELEVANT_LINK"
  | "APPROVED_PARTNER_LINK"
  | "COLLABORATION_REQUEST"
  | "AMA_REQUEST"
  | "PARTNERSHIP_REQUEST"
  | "UNSOLICITED_PROMOTION"
  /** Rallying THIS community's own members to promote/support a DIFFERENT,
   *  specifically named project/token (never this community's own subject)
   *  -- e.g. "let's go shill $OTHERCOIN over at @somegroup". Deliberately a
   *  SEPARATE category from ordinary UNSOLICITED_PROMOTION (a stranger's
   *  marketing-service pitch) per explicit product decision: promoting a
   *  competing project is a "global no-go" -- never exempted by the
   *  community's Allow Solicitation toggle, a Promotion-topic policy, or an
   *  admin/trusted role, and its warning must never redirect to the
   *  configured Promotion channel/topic (that destination is for promoting
   *  THIS community's own project, never a rival one). See
   *  decideLinkEnforcement's own dedicated branch. */
  | "COMPETING_PROJECT_PROMOTION"
  | "LINK_SPAM_OR_FLOOD"
  /** An instruction telling members to search/look up/google/download
   *  something with NO connection to this project or community at all
   *  (e.g. "Search miniairdrops") -- live-caught pattern: several
   *  DIFFERENT accounts posting the identical/near-identical off-topic
   *  instruction, often minutes apart, the classic multi-account
   *  engagement-farming/search-manipulation raid signature. Distinct from
   *  UNSOLICITED_PROMOTION (this doesn't advertise a project/service or
   *  solicit contact) and from LINK_SPAM_OR_FLOOD (no link is involved at
   *  all) -- it's spam by its own content, flagged the SAME way whether
   *  it's a lone occurrence from one sender or part of a coordinated
   *  back-to-back pattern across different senders (see
   *  isBackToBackSpamPattern below, which only changes the WARNING wording,
   *  never whether this is flagged at all). Never exempted by the
   *  community's Allow-Solicitation toggle or an admin/trusted role -- it's
   *  an abuse signal, not ordinary self-promotion, same category of
   *  never-exempt as COMPETING_PROJECT_PROMOTION above. */
  | "SEARCH_SPAM"
  /** An unfounded, mocking, or dismissive assertion that the project is a
   *  scam/rug/fraud/dead/worthless -- with NO genuine question and NO
   *  specific evidence behind it (e.g. "Scam Project 😂😂", "Definitely
   *  scam lol"). Explicit product decision: this is a conduct/community-
   *  health category, not a safety category -- a genuine question ("Is
   *  this a scam?") or a substantive, evidence-backed concern is NEVER
   *  this category, both are still handled normally (see
   *  link-classify.ts's own category definition for the exact carve-out).
   *  Role-exempt via decideLinkEnforcement's existing isAdminOrTrusted
   *  check (an admin/trusted member's own framing of their own community
   *  is their call, unlike the never-exempt abuse categories above) --
   *  reached only for an ordinary member. */
  | "NEGATIVE_STATEMENT"
  | "PHISHING_OR_SCAM"
  | "EXPLICIT_CONTENT"
  | "UNKNOWN_OR_AMBIGUOUS";

export type ClassificationConfidence = "low" | "medium" | "high";

/** Categories where a natural reply MAY mention the configured collab
 *  contact (spec §37) — never the ones that got deleted, never a safe
 *  link that doesn't need routing. */
export const COLLAB_ROUTABLE_CATEGORIES: ReadonlySet<LinkCategory> = new Set(["COLLABORATION_REQUEST", "AMA_REQUEST", "PARTNERSHIP_REQUEST"]);

/* ---------------------------------------------------------- link extraction ---- */

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;
const TELEGRAM_HANDLE_RE = /(?:^|[\s(])@([a-z0-9_]{5,32})\b/gi;

/** Scheme-less domains are a real, common evasion tactic (a scam link typed
 *  as "mysteryboxsol.live" instead of "https://mysteryboxsol.live" to dodge
 *  a naive `https?://` extractor) -- this candidate matcher catches that,
 *  bounded by a TLD allowlist to avoid flooding ordinary prose with false
 *  "links" (a bare `label.tld` shape is common in casual text — "ASP.NET",
 *  "e.g.", software version numbers — so an unbounded match would be too
 *  noisy). Extraction alone is never destructive: every candidate still has
 *  to pass classifyLinkIntent's AI classification AND decideLinkEnforcement's
 *  high-confidence gate before any action -- widening what counts as a link
 *  candidate only widens what gets a CHANCE to be classified, it never
 *  bypasses the classifier or confidence gate. */
const COMMON_TLDS = new Set([
  "com", "net", "org", "io", "co", "xyz", "live", "site", "online", "click", "top", "info", "app",
  "finance", "gg", "so", "fi", "cc", "biz", "me", "tv", "link", "page", "shop", "store", "vip", "win",
  "dev", "ai", "cloud", "tech", "world", "fun", "icu", "cyou", "buzz", "fyi", "pro", "cash", "money",
]);
const BARE_DOMAIN_CANDIDATE_RE = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,24}\b(?:\/[^\s]*)?/gi;

/** Extracts every URL, scheme-less domain candidate, and bare @handle
 *  (Telegram identity references count as "links" for moderation purposes
 *  — "join @othergroup" is functionally identical to a t.me URL).
 *  Order-preserving, deduped. */
export function extractLinks(text: string): string[] {
  const found: string[] = [];
  // Trailing sentence/list punctuation ("," "." "!" "?" ")" etc.) is never
  // part of the URL itself -- without stripping it, "https://a.com, also
  // https://b.com" would extract "https://a.com," (comma glued on) as a
  // distinct, never-matching "link".
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,!?;:)\]]+$/, "");
    if (!found.includes(url)) found.push(url);
  }
  for (const m of text.matchAll(BARE_DOMAIN_CANDIDATE_RE)) {
    const candidate = m[0].replace(/[.,!?;:)\]]+$/, "");
    // Already caught above as a full https://... URL -- don't double-count
    // the bare-domain tail of one we already extracted.
    if (found.some((f) => f.endsWith(candidate) || candidate.endsWith(f))) continue;
    const tld = candidate.split("/")[0].split(".").pop()?.toLowerCase() ?? "";
    if (!COMMON_TLDS.has(tld)) continue;
    if (!found.includes(candidate)) found.push(candidate);
  }
  for (const m of text.matchAll(TELEGRAM_HANDLE_RE)) {
    const handle = `@${m[1]}`;
    if (!found.includes(handle)) found.push(handle);
  }
  return found;
}

/** A cheap, deterministic GATE for link-LESS unsolicited-promotion pitches
 *  ("Hey Dev, looking for real investors & strong volume? I can promote
 *  your project... DM me if you're ready to grow.") -- a real, live-caught
 *  gap: a promotional pitch with NO url/handle at all (no scam link, no
 *  t.me reference) never matched extractLinks(), so it silently bypassed
 *  moderation entirely and fell through to ordinary chatter, which just
 *  socially replied ("this looks like promo spam") without ever deleting
 *  the message or recording a strike.
 *
 *  This function does NOT decide the violation -- it only decides whether
 *  it's worth spending a real classifyLinkIntent() call on a message that
 *  has no link at all (the overwhelming majority of ordinary messages,
 *  which must stay a zero-cost regex scan). The actual verdict is still
 *  made by the classifier + decideLinkEnforcement, exactly as for a
 *  link-bearing message -- a false-positive match here just means one
 *  extra classification call that resolves to ALLOW, never a fabricated
 *  deletion. Mirrors the same cheap-gate-then-real-classification shape
 *  already used for the ambient-greeting fallback
 *  (isAmbientOpenerFallbackCandidate + classifyAmbientGreeting).
 *
 *  Deliberately a bounded, non-exhaustive signal set (a real promotional
 *  pitch has endless phrasing) -- a missed phrasing here simply isn't
 *  flagged, same as today; it never causes a false enforcement action. */
const SOLICIT_CONTACT_RE = /\b(dm|pm|message|contact|reach out to|hit (me|us) up)\b.{0,20}\b(me|us)\b|\blet('|s)?s connect\b/i;
const PROMOTION_SERVICE_RE = /\b(i can|we can|we help|let('| a)?s|let us)\b.{0,30}\b(promote|market|shill|pump|grow|boost|push)\b/i;
// A stranger phrasing an offer/question AROUND promoting the RECIPIENT's own
// channel/project ("do you [want to] promote your channel in big crypto
// community...") is the same service-offer signal as PROMOTION_SERVICE_RE,
// just without one of that pattern's required lead-in phrases ("I can"/"we
// can"/"let's") -- live-caught gap: this exact unusual phrasing tripped
// neither PROMOTION_SERVICE_RE nor BOOST_TARGET_RE (which requires
// grow/boost/push, not "promote") and so was never even sent to the real
// classifier.
const PROMOTE_YOUR_X_RE = /\bpromote\b.{0,15}\b(your|the)\b.{0,15}\b(channel|project|community|token|coin)\b/i;
const GROWTH_PITCH_RE =
  /\b(real investors|genuine investors?|serious buyers|strong volume|strong,? active|active (crypto )?communit(y|ies)|guaranteed (growth|holders|volume)|organic growth|trading volume|market cap|investor exposure|buying interest|get investors|investors for (your|the))\b/i;
const BOOST_TARGET_RE = /\b(grow|boost|push)\b.{0,25}\b(your|the)\b.{0,25}\b(project|community|channel|token|coin|followers|holders|views|members|volume|exposure|market cap)\b/i;
// A very specific, low-false-positive marketing-service marker on its own
// (mentioning KOL/influencer marketing, or the bare word "promo(s)" as a
// noun someone is offering/asking about, virtually never comes up in
// ordinary conversation) -- see looksLikeUnsolicitedPitch's own
// single-strong-signal branch below.
const KOL_MARKETING_RE = /\b(kols?|influencers?)\b.{0,25}\b(marketing|exposure|network|connect)\b|\b(kol|influencer)\s+(manager|marketing)\b/i;
const PROMO_OFFER_RE = /\byou need (some )?promos?\b|\bneed (some )?promos?\??$|\boffer(ing)? promos?\b/i;
// A claimed large-audience "investor channel" pitch ("we have a channel of
// 2 million investor members") is a distinctive crypto-spam marker on its
// own -- an ordinary community member essentially never states an exact
// large follower/member/investor count as a sales pitch like this.
const LARGE_AUDIENCE_PITCH_RE = /\b\d[\d,.]*\s*(million|k|thousand)?\s*(investor|holder)s?\b.{0,20}\b(members?|channel)\b|\bchannel\b.{0,20}\bof\b.{0,20}\b\d[\d,.]*\s*(million|k|thousand)?\s*(investor|holder)s?\b/i;

export function looksLikeUnsolicitedPitch(text: string): boolean {
  const contactAsk = SOLICIT_CONTACT_RE.test(text);
  const serviceOffer = PROMOTION_SERVICE_RE.test(text) || BOOST_TARGET_RE.test(text) || PROMOTE_YOUR_X_RE.test(text);
  const growthLanguage = GROWTH_PITCH_RE.test(text);
  // A sufficiently distinctive standalone marketing-service signal (KOL/
  // influencer marketing pitches, or a bare "you need promos?" offer) is
  // strong enough on its own -- these phrasings essentially never occur in
  // ordinary conversation, unlike a bare "DM me" or a bare "grow", so
  // requiring a SECOND independent signal alongside them would just let
  // real spam through unflagged (a live-caught gap: several real
  // unsolicited-promotion pitches only ever tripped ONE of the three
  // original categories and were never even sent to the real classifier).
  if (KOL_MARKETING_RE.test(text) || PROMO_OFFER_RE.test(text) || LARGE_AUDIENCE_PITCH_RE.test(text)) return true;
  // Otherwise require at least two independent signals -- a bare "DM me"
  // alone (a completely ordinary thing to say in conversation) must never
  // alone trigger a classification call; a real promotional pitch reliably
  // combines a contact/service call-to-action with marketing language.
  return [contactAsk, serviceOffer, growthLanguage].filter(Boolean).length >= 2;
}

/* --------------------------------------------------- link-less search-spam gate ---- */
// Live-caught pattern (2026-09-03): "Search miniairdrops" posted by two
// different accounts within minutes of each other -- no link, no @handle, no
// contact ask, nothing looksLikeUnsolicitedPitch's signals would ever catch.
// This is its own gate/category (SEARCH_SPAM above), never folded into
// looksLikeUnsolicitedPitch, since it isn't a promotion/service pitch at
// all -- it's a bare off-topic instruction.

/** A short imperative "search/google/look up <something>" instruction at
 *  the START of the message. Deliberately a BROAD gate, not a narrow one --
 *  unlike an enforcement decision, a false-positive match here only costs
 *  one extra classifyLinkIntent() call that resolves to ALLOW/UNKNOWN
 *  (the real project-relevance judgment happens there, with full
 *  conversation context); it never causes a fabricated deletion on its own.
 *  A genuinely on-topic "search the pinned FAQ" would still just resolve
 *  ALLOW at the classifier. Known, disclosed limitation: only the literal
 *  search/google/look-up wording is gated here -- a coordinated instruction
 *  phrased as "download X"/"vote for X" isn't caught by this specific
 *  pre-filter (same "a missed phrasing here simply isn't flagged" trade-off
 *  already accepted by looksLikeUnsolicitedPitch above). */
const SEARCH_INSTRUCTION_RE = /^\s*(please\s+)?(search|google|look\s?up)\b/i;

export function looksLikeSearchInstructionSpam(text: string): boolean {
  return SEARCH_INSTRUCTION_RE.test(text);
}

/** True when the message immediately preceding this one in the room
 *  (chronologically right before it, from ANY sender -- the caller already
 *  excludes the current message itself) also looks like the same off-topic
 *  search/instruction spam pattern, within the same FLOOD_WINDOW_MS used
 *  for rapid-repost detection elsewhere in this file. This is the
 *  multi-account raid signature: different accounts posting the identical
 *  or near-identical off-topic instruction back to back. Only ever changes
 *  the WARNING's wording (generic room-wide reminder vs. naming the
 *  specific offender) -- it never affects whether SEARCH_SPAM is flagged,
 *  deleted, or counted toward this sender's own warning ladder, all of
 *  which happen identically for an isolated OR a coordinated occurrence. */
export function isBackToBackSpamPattern(precedingMessage: { text: string; createdAt?: string | null } | null | undefined, now: Date): boolean {
  if (!precedingMessage || !precedingMessage.createdAt) return false;
  if (now.getTime() - new Date(precedingMessage.createdAt).getTime() >= FLOOD_WINDOW_MS) return false;
  return looksLikeSearchInstructionSpam(precedingMessage.text);
}

/* ------------------------------------------- admin-solicited backstop (gap 3) ---- */
// The AI classifier (link-classify.ts) already carries a system-prompt
// instruction about admin-requested content, but per explicit product
// decision this is NEVER trusted as the sole safeguard for a content-safe
// exemption -- a real, deterministic, code-level check runs alongside it
// (decideLinkEnforcement is still the ONE place enforcement is actually
// decided; this only supplies one more input to it, exactly like the
// existing solicitationAllowed/isAdminOrTrusted flags). Deliberately
// bounded on every axis so this can never become a standing/permanent
// exemption: scoped to the SPECIFIC admin/mod request, the SPECIFIC
// responding user (when the request itself named one via a Telegram reply
// relationship), the SAME community/topic, and a short, fixed recent
// window -- once the request scrolls out of that window it simply stops
// applying, by construction, without needing a "consumed" flag anywhere.

/** How long an admin/mod's information request stays "live" -- long enough
 *  for a human to reasonably type/find a link, short enough that this can
 *  never plausibly become a permanent solicitation exemption. */
export const ADMIN_REQUEST_EXEMPTION_WINDOW_MS = 10 * 60_000;

const ADMIN_INFO_REQUEST_RE =
  /\b(send|share|drop|post|give|dm|message|paste)\s+(me\s+)?(your|the)\s+(project\s+)?(link|website|url|ca\b|contract(\s+address)?|token(\s+address)?|username|handle|telegram|@|whitepaper)\b|\bwhat('?s|\s+is)\s+your\s+(username|handle|telegram|@)\b|\bwhat('?s|\s+is)\s+the\s+(ca|contract(\s+address)?|token(\s+address)?)\b/i;

/** Does this admin/mod message read as a real request for the responding
 *  user's own information (a link, handle, CA/token address, etc.)? A
 *  narrow, explicit pattern set -- never a broad "any mention of a link
 *  word" match, since that would swallow ordinary admin chatter unrelated
 *  to actually soliciting a response. */
export function looksLikeAdminInformationRequest(text: string): boolean {
  return ADMIN_INFO_REQUEST_RE.test(text);
}

export interface AdminRequestCandidateMessage {
  senderType: "HUMAN" | "INNVIL_MODERATOR" | "EXTERNAL_BOT";
  text: string;
  createdAt: string | null | undefined;
  senderPlatformId: string | null | undefined;
  platformMessageId?: string | null;
  replyToPlatformMessageId?: string | null;
}

export interface RecentAdminInformationRequest {
  requesterPlatformId: string;
  /** The specific user this request targets, when the admin's own message
   *  was itself a reply to a specific person -- null means an OPEN request
   *  ("someone drop the link"), which any responder within the window may
   *  fulfill. Never guessed beyond what the reply relationship actually
   *  shows. */
  targetPlatformUserId: string | null;
}

/** Scans recent HUMAN messages for the most recent one that (a) reads as
 *  an information request (looksLikeAdminInformationRequest) and (b) is
 *  still within the exemption window relative to `now`. Does NOT itself
 *  verify the sender is actually an admin -- that requires a live Telegram
 *  lookup, which the caller (community-runtime.ts) performs only for this
 *  ONE candidate (never for every message in the window), keeping the
 *  extra cost bounded to the rare case a plausible request shape is even
 *  found. Returns null when nothing recent matches. */
export function findRecentAdminInformationRequest(
  context: AdminRequestCandidateMessage[], now: Date
): { candidate: AdminRequestCandidateMessage; targetPlatformUserId: string | null } | null {
  for (let i = context.length - 1; i >= 0; i--) {
    const m = context[i];
    if (m.senderType !== "HUMAN" || !m.senderPlatformId || !m.createdAt) continue;
    if (now.getTime() - new Date(m.createdAt).getTime() > ADMIN_REQUEST_EXEMPTION_WINDOW_MS) break; // context is chronological -- nothing earlier can be in-window either
    if (!looksLikeAdminInformationRequest(m.text)) continue;
    // If this request itself replies to a specific person's message,
    // resolve THAT person as the sole intended target (scoping per gap 3's
    // explicit "the intended/responding user" requirement); otherwise it's
    // an open request any responder in the window may fulfill.
    let targetPlatformUserId: string | null = null;
    if (m.replyToPlatformMessageId) {
      const target = context.find((c) => c.platformMessageId === m.replyToPlatformMessageId);
      targetPlatformUserId = target?.senderPlatformId ?? null;
    }
    return { candidate: m, targetPlatformUserId };
  }
  return null;
}

/* --------------------------------------------------- self-mention exemption ---- */

/** Canonical Telegram username normalization -- case-insensitive, optional
 *  leading `@`, trimmed. Telegram usernames are already restricted to
 *  `[a-zA-Z0-9_]`, so no further sanitization is needed. */
export function normalizeTelegramUsername(username: string): string {
  return username.trim().replace(/^@/, "").toLowerCase();
}

/** True when `candidate` (an extractLinks() output, e.g. "@mrpreswan_bot")
 *  is a bare mention of one of `botUsernames` -- the REAL, currently-
 *  deployed Watcher bot usernames for the community this message was posted
 *  in (never a hardcoded name, never a manually-maintained whitelist; the
 *  caller sources these from `telegram_bot_integrations.username` via each
 *  community's own ChatterDeployment list). A self-mention is addressing,
 *  not a link/promotion candidate -- this is the ONLY exemption: it makes
 *  the bare mention itself non-suspicious, it does not exempt the rest of
 *  the message from moderation (see filterOutOwnBotMentions below, which
 *  only ever removes the matching handle, never any other link/URL present
 *  in the same message). */
export function isOwnBotMention(candidate: string, botUsernames: Array<string | null>): boolean {
  if (!candidate.startsWith("@")) return false;
  const normalizedCandidate = normalizeTelegramUsername(candidate);
  return botUsernames.some((u) => u && normalizeTelegramUsername(u) === normalizedCandidate);
}

/** Removes bare mentions of the community's own deployed Watcher bots from
 *  a link-candidate list, leaving every OTHER link/handle untouched -- a
 *  real phishing URL or an unrelated external @handle in the SAME message
 *  is still passed through for classification/enforcement. Order-
 *  preserving. */
export function filterOutOwnBotMentions(links: string[], botUsernames: Array<string | null>): string[] {
  if (!botUsernames.some(Boolean)) return links;
  return links.filter((l) => !isOwnBotMention(l, botUsernames));
}

/** Enough normalization for sensible spam/history comparison (spec §44) --
 *  lowercases the hostname, strips a trailing slash and common tracking
 *  params, WITHOUT changing destination identity (path/query beyond
 *  tracking params is preserved, since /a and /b on the same host are
 *  different destinations). Bare @handles normalize to lowercase as-is. */
const TRACKING_PARAMS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"]);

export function normalizeLink(link: string): string {
  if (link.startsWith("@")) return link.toLowerCase();
  try {
    const url = new URL(link);
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    let normalized = `${url.hostname}${url.pathname.replace(/\/$/, "")}`;
    const query = url.searchParams.toString();
    if (query) normalized += `?${query}`;
    return normalized.toLowerCase();
  } catch {
    return link.trim().toLowerCase();
  }
}

/** Cheap, stable identity for a normalized link — used only to compare
 *  "is this the SAME link as last time", never for anything security-
 *  sensitive, so a simple deterministic hash (not a cryptographic one) is
 *  fine and keeps this file free of a crypto dependency. */
export function linkHash(link: string): string {
  const normalized = normalizeLink(link);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) hash = (Math.imul(hash, 31) + normalized.charCodeAt(i)) | 0;
  return hash.toString(36);
}

/* ------------------------------------------------------------- flood window ---- */
// 30 minutes only changes the RAPID-FLOOD interpretation (spec §30-31) — it
// is NEVER a history reset. Kept as an entirely separate signal from
// warning_count (long-term violation history) for exactly that reason.

export const FLOOD_WINDOW_MS = 30 * 60_000;
/** Repeating the SAME link 3+ times inside the flood window reads as an
 *  automated/obvious burst (spec §28) even without three separate
 *  human-paced warnings — deliberately small since a genuine flood is
 *  rapid by definition (seconds to a couple of minutes apart, spec's own
 *  examples), not a threshold a real conversational repost would hit by
 *  accident. */
export const FLOOD_REPEAT_THRESHOLD = 3;

/* ------------------------------------------------------ negative statements ---- */
// Live product decision (2026-09-05): an unfounded, mocking scam/rug/fraud
// accusation with no link/handle at all ("Scam Project 😂😂") needs the same
// link-less pre-filter treatment SEARCH_SPAM/looksLikeUnsolicitedPitch already
// get -- otherwise it never reaches the real classifier at all. Deliberately
// generous (never the verdict itself, same "never the sole ban authority"
// principle as every other pre-filter here) -- a false positive here only
// costs one extra classifyLinkIntent call, which correctly resolves to
// something else (SAFE_RELEVANT_LINK/UNKNOWN_OR_AMBIGUOUS) rather than a
// fabricated deletion. Any message containing a "?" ANYWHERE is excluded
// unconditionally -- a genuine question ("Is this a scam?") must always be
// handled normally, never even offered to this category.
const NEGATIVE_STATEMENT_RE =
  /\b(scam(?:mer|med)?|rug\s?pull(?:ed)?|is\s+a\s+rug|ponzi|fraud(?:ulent)?|fake\s+project|dead\s+(?:project|coin|token)|trash\s+project|garbage\s+project|exit\s+scam|going\s+to\s+zero|worthless\s+(?:project|token|coin)|stay\s+away(?:\s+from)?|avoid\s+this\s+(?:project|coin|token)|do\s?n['’]?t\s+(?:trust|buy|invest\s+in)\s+(?:this|it)|shit\s?coin)\b/i;

export function looksLikeNegativeStatement(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("?")) return false;
  return NEGATIVE_STATEMENT_RE.test(trimmed);
}

/* -------------------------------------------------- enforcement-notice dedup ---- */
// Live bug: loadLinkWarningState/persistLinkWarningState is a plain
// SELECT-then-later-UPSERT with no atomicity between the two -- a rapid
// burst of messages from the SAME sender (a classic scam-bot flooding
// pattern) races this, so several concurrent webhook invocations each read
// the SAME stale prior strike count and each independently send their own
// copy of the same escalation notice (observed live: three separate
// "you have been removed" messages for one person within about a minute).
// This window only needs to be long enough to cover a realistic
// webhook/classification/DB processing race for a fast burst -- 2 minutes
// is generous for that while staying far short of a window where a
// genuinely NEW re-offense (e.g. the person rejoins and reoffends later)
// would be incorrectly suppressed. See community-runtime.ts's
// claimLinkEnforcementNotice, which wraps the atomic
// claim_link_enforcement_notice() SQL function (migration 0126) -- this
// never gates the underlying Telegram mute/kick action itself (always
// executed, since a duplicated moderation call is silently idempotent and
// invisible), only the VISIBLE aftermath (generated warning text, the
// SEND_TEXT, the message purge, and the internal Watcher Ops report).
export const LINK_ENFORCEMENT_NOTICE_DEDUP_WINDOW_SECONDS = 120;

export interface LinkWarningState {
  /** Solicitation/unsolicited-promotion's OWN 3(4)-strike counter --
   *  EXCLUSIVELY solicitation's, since the 2026-09-02 media/solicitation
   *  counter split (see mediaWarningCount below). Never incremented by a
   *  media-moderation violation, and never reset by one either. */
  warningCount: number;
  /** Timestamp of the most recent SOLICITATION warning (gap 9, explicit
   *  product decision, 2026-09-02): this counter now expires after 30 days
   *  of inactivity, mirroring scamStrikeAt/SCAM_STRIKE_WINDOW_MS exactly —
   *  chosen for consistency with the only other precedent in this file,
   *  rather than persisting indefinitely as it silently did before this
   *  decision (a real behavior CHANGE, made deliberately, not left
   *  accidental). See effectiveWarningCount. */
  warningAt: string | null;
  recentLinkHash: string | null;
  recentLinkAt: string | null;
  recentLinkCountInWindow: number;
  /** Scam/phishing-specific strike count — structurally SEPARATE from
   *  warningCount (which is unsolicited-promotion's own 3-strike counter).
   *  A scam strike is a distinct, stronger signal and must never be
   *  conflated with an ordinary promotion warning. */
  scamStrikeCount: number;
  /** Timestamp of the most recent scam strike — the basis for the 30-day
   *  expiry window (effectiveScamStrikeCount below), not a permanent
   *  lifetime counter. */
  scamStrikeAt: string | null;
  /** Media moderation's OWN warning counter (media-moderation.ts's
   *  decideMediaEnforcement), structurally SEPARATE from `warningCount`
   *  since the 2026-09-02 split -- a photo/video violation never advances
   *  the solicitation ladder, and a solicitation violation never advances
   *  this one. Both are still stored on the SAME per-(community, user) row
   *  (moderator_link_warning_state) since they share every other field
   *  (flood window, scam strike) -- only the warning-count semantics were
   *  ever actually conflated, so only that needed its own column. */
  mediaWarningCount: number;
  /** Timestamp of the most recent media-moderation warning/kick. Explicit
   *  product decision (2026-09-05): media's own strike counter renews
   *  together with the account's TIERED PLAN billing period, NOT a fixed
   *  rolling window like every other counter on this row -- "however many
   *  [strikes] they had, even if 1 or the max, it resets" once the plan
   *  renews, mirroring the exact same full-reset-no-carryover behavior the
   *  Media Moderation Unit ALLOWANCE already has (getWatchMediaModerationUsage
   *  is keyed by period_start, so a new period always starts usage at 0,
   *  regardless of how much of the prior period's allowance was consumed).
   *  See effectiveMediaWarningCount below -- resolved against the account's
   *  real current billing-period start, never a fixed duration. */
  mediaWarningAt: string | null;
  /** NEGATIVE_STATEMENT's OWN 3-strike ladder counter -- structurally
   *  SEPARATE from every other counter on this row (an unfounded scam/rug
   *  accusation is never conflated with an ordinary promotion warning or a
   *  real scam-LINK strike). See effectiveNegativeStatementCount below. */
  negativeStatementCount: number;
  negativeStatementAt: string | null;
}

export const EMPTY_WARNING_STATE: LinkWarningState = {
  warningCount: 0, warningAt: null, recentLinkHash: null, recentLinkAt: null, recentLinkCountInWindow: 0,
  scamStrikeCount: 0, scamStrikeAt: null, mediaWarningCount: 0, mediaWarningAt: null,
  negativeStatementCount: 0, negativeStatementAt: null,
};

/** Same 30-day expiry pattern as effectiveScamStrikeCount below -- a
 *  solicitation offense more than SOLICITATION_WARNING_WINDOW_MS old no
 *  longer counts toward the ladder; the caller reads 0 (a fresh first
 *  offense) rather than the stale stored count. */
export const SOLICITATION_WARNING_WINDOW_MS = 30 * 24 * 60 * 60_000;

export function effectiveWarningCount(storedCount: number, storedAt: string | null, now: Date): number {
  if (!storedAt) return 0;
  if (now.getTime() - new Date(storedAt).getTime() >= SOLICITATION_WARNING_WINDOW_MS) return 0;
  return storedCount;
}

/** Finite strike window, not a permanent lifetime punishment (spec: "no
 *  further scam within 30 days -> strike expires/resets"). */
export const SCAM_STRIKE_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** The scam strike count actually in effect RIGHT NOW — expired strikes
 *  read as 0 (a scam offense outside the window is treated as a fresh
 *  first offense, never accumulated). Pure/testable independent of the
 *  stored state's age. */
export function effectiveScamStrikeCount(storedCount: number, storedAt: string | null, now: Date): number {
  if (!storedAt) return 0;
  if (now.getTime() - new Date(storedAt).getTime() >= SCAM_STRIKE_WINDOW_MS) return 0;
  return storedCount;
}

/** Same 30-day-inactivity expiry pattern as effectiveScamStrikeCount --
 *  chosen for consistency with the only two precedents in this file, rather
 *  than inventing a third window length. A negative-statement strike more
 *  than this old reads as a fresh first offense, never a permanent record. */
export const NEGATIVE_STATEMENT_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** Deterministic mute for the 2nd negative-statement offense, and a
 *  deterministic (time-bound, never permanent) ban for the 3rd+ -- explicit
 *  product decision: "should only be mute/ban, no kick." */
export const NEGATIVE_STATEMENT_MUTE_MINUTES = 30;
export const NEGATIVE_STATEMENT_BAN_MINUTES = 24 * 60;

export function effectiveNegativeStatementCount(storedCount: number, storedAt: string | null, now: Date): number {
  if (!storedAt) return 0;
  if (now.getTime() - new Date(storedAt).getTime() >= NEGATIVE_STATEMENT_WINDOW_MS) return 0;
  return storedCount;
}

/** Media moderation's OWN strike counter renews together with the account's
 *  TIERED PLAN billing period -- explicit product decision, deliberately a
 *  DIFFERENT reset mechanism from every other counter above (which all use a
 *  fixed rolling duration since the last offense). "However many strikes
 *  they had, even if 1 or the max, it resets" once the plan renews: a stored
 *  warning from BEFORE the current billing period started reads as 0 (a
 *  full reset, never a partial carryover), regardless of how high it had
 *  climbed -- mirroring the Media Moderation Unit ALLOWANCE's own existing
 *  full-reset-no-carryover behavior exactly.
 *
 *  `periodStart` is the account's real current billing-period start (already
 *  resolved by the caller via resolveAccountBillingPeriod/
 *  trialMediaModerationPeriod -- this function never resolves a period
 *  itself, staying pure/no-I/O like every other counter here). `null` means
 *  no real period could be resolved (a genuinely unrepresentable account,
 *  e.g. a legacy Panel-distributed deployment with no billing period at
 *  all) -- in that case the stored count is returned AS-IS, never fabricating
 *  a reset boundary that doesn't exist. */
export function effectiveMediaWarningCount(storedCount: number, storedAt: string | null, periodStart: string | null): number {
  if (!storedAt) return 0;
  if (!periodStart) return storedCount;
  if (new Date(storedAt).getTime() < new Date(periodStart).getTime()) return 0;
  return storedCount;
}

function withinFloodWindow(recentLinkAt: string | null, now: Date): boolean {
  if (!recentLinkAt) return false;
  return now.getTime() - new Date(recentLinkAt).getTime() < FLOOD_WINDOW_MS;
}

/** Pure state transition for observing a new link post — computed BEFORE
 *  the enforcement decision, since flood detection needs "how many times
 *  in this window so far, including this one" as an input, not an output. */
export function recordLinkObservation(state: LinkWarningState, hash: string, now: Date): LinkWarningState {
  const sameLinkRecently = state.recentLinkHash === hash && withinFloodWindow(state.recentLinkAt, now);
  return {
    ...state,
    recentLinkHash: hash,
    recentLinkAt: now.toISOString(),
    recentLinkCountInWindow: sameLinkRecently ? state.recentLinkCountInWindow + 1 : 1,
  };
}

export function isFloodRepeat(observedState: LinkWarningState): boolean {
  return observedState.recentLinkCountInWindow >= FLOOD_REPEAT_THRESHOLD;
}

/* ------------------------------------------------------------------ policy ---- */

export type ModerationEnforcement =
  | { kind: "ALLOW" }
  /** `muteMinutes`, when set, means this warning is ALSO accompanied by a
   *  temporary mute of that duration (Watcher Ops moderation-reporting
   *  expansion, 2026-08-27) — a real Telegram restrictChatMember action,
   *  executed alongside the delete+warn, never inferred by the caller from
   *  warningNumber alone. Undefined means no mute (e.g. media's borderline
   *  path, which was never specified to include one). */
  | {
      kind: "DELETE_WARN";
      warningNumber: number;
      reason:
        | "unsolicited_promotion"
        | "repeated_unsolicited_promotion"
        | "competing_project_promotion"
        | "repeated_competing_project_promotion"
        | "search_spam"
        | "repeated_search_spam"
        | "explicit_content_borderline"
        | "scam_or_phishing"
        | "negative_statement"
        | "repeated_negative_statement";
      muteMinutes?: number;
      /** True ONLY for a negative-statement's very FIRST offense -- the
       *  caller must delete the message but send NO public warning text at
       *  all (explicit product decision: "should be deleted without
       *  warning, just deleted"). Undefined/false for every other reason,
       *  every other category, unchanged from before this field existed --
       *  this is additive and never alters existing behavior. */
      silent?: boolean;
    }
  /** Removes (kicks) the user — NOT a permanent ban (structurally distinct
   *  from DELETE_BAN, so a caller can never confuse "temporary removal, can
   *  rejoin" with "permanent"). `purge: true` means the caller should also
   *  attempt to delete this user's other recent messages in the Community
   *  (see community-runtime.ts's purgeUserMessages) — always true for the
   *  categories that reach this kind today (repeated spam, repeated scam,
   *  explicit content), since a kick without cleanup leaves the offending
   *  history sitting in the room. */
  | { kind: "DELETE_KICK"; reason: "repeated_unsolicited_promotion" | "repeated_competing_project_promotion" | "repeated_search_spam" | "repeated_scam_or_phishing" | "explicit_content" | "repeated_explicit_content"; purge: boolean }
  /** Reserved for a possible future manual admin action — the automatic
   *  policy below (as of 2026-08-27) no longer PRODUCES this kind for any
   *  category; every automatic escalation that used to end in a permanent
   *  ban now ends in DELETE_KICK+purge instead (removable, with cleanup,
   *  matching the Watcher Ops spec's "kick and purge, not a silent
   *  permanent ban" model). Kept in the union so existing callers/tests
   *  referencing it don't need to be restructured for a type that's simply
   *  unreachable today. */
  | {
      kind: "DELETE_BAN";
      reason: "explicit_content" | "flood" | "repeated_unsolicited_promotion" | "repeated_explicit_content" | "repeated_scam_or_phishing" | "escalated_negative_statement";
      /** Time-bound ban duration in minutes -- undefined means permanent
       *  (unused by any automatic policy today, per the doc comment above,
       *  EXCEPT "escalated_negative_statement", which always sets this to
       *  NEGATIVE_STATEMENT_BAN_MINUTES: explicit product decision, "banned
       *  for 24 hours," never a silent permanent ban). */
      banMinutes?: number;
    };

/** Maximum number of WARNINGS (with escalating mutes) before the next
 *  violation removes the user — 2 warnings, then the 3rd violation kicks.
 *  Media's own borderline-explicit progression (media-moderation.ts /
 *  media-warning.ts) still uses this exact number. Ordinary unsolicited
 *  promotion ("solicitation") has its OWN, more lenient ladder now — see
 *  SOLICITATION_WARNING_LIMIT below — deliberately decoupled so a change
 *  to one can never silently change the other. */
export const SPAM_WARNING_LIMIT = 2;

/** Deterministic mute durations for media's own borderline progression --
 *  first warning mutes for 10 minutes, second for 30. Scam/phishing
 *  (stricter, see below) mutes 30 minutes on its single warning before
 *  removal. Ordinary unsolicited promotion no longer uses this table --
 *  see SOLICITATION_MUTE_MINUTES_BY_WARNING below. */
export const SPAM_MUTE_MINUTES_BY_WARNING: Record<number, number> = { 1: 10, 2: 30 };
export const SCAM_FIRST_WARNING_MUTE_MINUTES = 30;

/** Ordinary unsolicited promotion ("solicitation") gets a real leeway,
 *  explicit product decision (2026-09-02): the FIRST warning carries no
 *  mute at all -- just a deletion + a warning message, nothing else. Only
 *  the 5th violation removes the user. Deliberately its own constants,
 *  separate from SPAM_WARNING_LIMIT/SPAM_MUTE_MINUTES_BY_WARNING (which
 *  still govern media's own, unrelated, stricter progression) -- a bare
 *  automated flood burst (LINK_SPAM_OR_FLOOD / floodRepeat) still skips
 *  straight past this whole ladder to the terminal kick, since it's an
 *  abuse signal, not ordinary solicitation. */
export const SOLICITATION_WARNING_LIMIT = 4;
export const SOLICITATION_MUTE_MINUTES_BY_WARNING: Record<number, number> = { 2: 10, 3: 30, 4: 60 };

/** The deterministic policy layer (spec §42) — classification informs this,
 *  it never decides alone. Admin/trusted-role exemption applies ONLY to
 *  ordinary advertising (spec §43); severity-based enforcement
 *  (explicit/phishing) is never role-exempt, since that's a safety
 *  question, not a "who's allowed to self-promote" one.
 *
 *  Enforcement model (2026-08-27, Watcher Ops moderation-reporting
 *  expansion; solicitation ladder revised 2026-09-02): ordinary unsolicited
 *  promotion ("solicitation") gets a real leeway -- warning 1 is just a
 *  deletion + warning (no mute at all), warning 2 mutes 10 minutes, warning
 *  3 mutes 30 minutes, warning 4 mutes 60 minutes, and only the 5th
 *  violation kicks the user AND purges their recent messages. An obvious
 *  automated flood burst (LINK_SPAM_OR_FLOOD / a rapid same-link repost)
 *  still skips straight past this whole ladder to the terminal kick --
 *  that's an abuse signal, not ordinary solicitation. Scam/phishing is
 *  stricter — a single warning (30-minute mute), then the 2nd confirmed
 *  offense kicks+purges. Explicit content (text link or media) is
 *  zero-tolerance — no warning, immediate kick+purge. None of these produce
 *  a permanent DELETE_BAN anymore. */
export function decideLinkEnforcement(input: {
  category: LinkCategory;
  confidence: ClassificationConfidence;
  isAdminOrTrusted: boolean;
  floodRepeat: boolean;
  priorWarningCount: number;
  /** Already expiry-resolved via effectiveScamStrikeCount — this function
   *  stays pure and never reasons about time itself. */
  priorScamStrikeCount: number;
  /** Already expiry-resolved via effectiveNegativeStatementCount -- same
   *  contract as priorScamStrikeCount above. */
  priorNegativeStatementCount: number;
  /** The Community's own "Allow Solicitation / Allow Promotion" override
   *  (communities.allow_solicitation, default false). When true, ORDINARY
   *  unsolicited promotion (UNSOLICITED_PROMOTION, and only that category)
   *  is never deleted or warned for merely being promotional — the message
   *  stays up, no strike is recorded. Every other moderation check remains
   *  fully independent and unaffected: a flood-repeat burst (floodRepeat),
   *  scam/phishing, and explicit content all still enforce exactly as
   *  before regardless of this setting — a rapid repost burst is an abuse
   *  signal, not "solicitation," so it is deliberately excluded from this
   *  exemption the same way an admin's own exemption already excludes it
   *  a few lines below. Applies consistently every time the category comes
   *  back UNSOLICITED_PROMOTION, not just on a sender's first message. */
  solicitationAllowed: boolean;
  /** Gap 3 backstop (2026-09-02): true when this exact message was very
   *  recently, and specifically, SOLICITED by a real admin/mod's own
   *  information request (see findRecentAdminInformationRequest) — e.g.
   *  "send me your project link" followed by the target user's own link.
   *  Deterministic, code-level, and independent of the AI classifier's own
   *  judgment (which may already correctly classify such a reply as
   *  SAFE_RELEVANT_LINK on its own -- this flag is a backstop for when it
   *  doesn't). Scoped to UNSOLICITED_PROMOTION only, same as
   *  solicitationAllowed above -- never exempts LINK_SPAM_OR_FLOOD, a
   *  flood-repeat burst, or anything scam/explicit. Never a standing/
   *  permanent exemption -- the caller only ever sets this true for the
   *  narrow recent window a real request stays "live" in. */
  adminSolicitedExemption: boolean;
}): ModerationEnforcement {
  if (input.category === "EXPLICIT_CONTENT" && input.confidence === "high") return { kind: "DELETE_KICK", reason: "explicit_content", purge: true };

  // Scam/phishing gets a GRADUATED response, never an instant permanent
  // outcome on a single offense — a first confirmed high-confidence offense
  // is DELETE+WARN+MUTE(30min); the second within the active strike window
  // removes the user (kick+purge). Never role-exempt (a safety question,
  // same principle as EXPLICIT_CONTENT above) and never escalated by
  // borderline/uncertain confidence (spec: "only sufficiently high-
  // confidence scam/phishing/malicious-wallet-link detections should
  // contribute to this stronger escalation behavior").
  if (input.category === "PHISHING_OR_SCAM" && input.confidence === "high") {
    const nextScamCount = input.priorScamStrikeCount + 1;
    if (nextScamCount === 1) return { kind: "DELETE_WARN", warningNumber: nextScamCount, reason: "scam_or_phishing", muteMinutes: SCAM_FIRST_WARNING_MUTE_MINUTES };
    return { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing", purge: true };
  }

  if (
    input.category === "SAFE_RELEVANT_LINK" ||
    input.category === "APPROVED_PARTNER_LINK" ||
    input.category === "COLLABORATION_REQUEST" ||
    input.category === "AMA_REQUEST" ||
    input.category === "PARTNERSHIP_REQUEST"
  ) {
    return { kind: "ALLOW" };
  }

  // Weak/ambiguous evidence never bans (spec §41) — irreversible enforcement
  // requires stronger confidence/history than "we're not sure."
  if (input.category === "UNKNOWN_OR_AMBIGUOUS") return { kind: "ALLOW" };

  // COMPETING_PROJECT_PROMOTION -- a "global no-go" per explicit product
  // decision, checked and returned BEFORE every exemption below (community
  // Allow-Solicitation toggle, the admin-solicited backstop, and the
  // admin/trusted-role exemption all only ever check `=== "UNSOLICITED_
  // PROMOTION"`, but this early return makes the exclusion unconditional
  // and unmissable regardless of how those checks evolve later). Promoting
  // a rival project/token is never allowed in ANY form here, for anyone --
  // reuses the SAME warning-count ladder as ordinary UNSOLICITED_PROMOTION
  // (a deliberate simplification, not a separate persisted counter) but
  // with its OWN distinct reason codes, so the caller (community-runtime.ts)
  // can tell the two apart and NEVER redirect this warning to the
  // configured Promotion channel/topic -- that destination exists to
  // promote THIS community's own project, never a competitor's.
  if (input.category === "COMPETING_PROJECT_PROMOTION") {
    const isFlood = input.floodRepeat;
    const nextCount = isFlood ? Math.max(input.priorWarningCount + 1, SOLICITATION_WARNING_LIMIT + 1) : input.priorWarningCount + 1;
    if (nextCount > SOLICITATION_WARNING_LIMIT) return { kind: "DELETE_KICK", reason: "repeated_competing_project_promotion", purge: true };
    return {
      kind: "DELETE_WARN",
      warningNumber: nextCount,
      reason: nextCount === 1 ? "competing_project_promotion" : "repeated_competing_project_promotion",
      muteMinutes: SOLICITATION_MUTE_MINUTES_BY_WARNING[nextCount],
    };
  }

  // SEARCH_SPAM (2026-09-03 live feedback: an off-topic "search X" spam
  // instruction, flagged even from a single sender, with NO link/promotion
  // involved) -- same never-exempt treatment as COMPETING_PROJECT_PROMOTION
  // above and for the same reason: this isn't ordinary self-promotion a
  // community-wide Allow-Solicitation toggle or a trusted role should ever
  // excuse, it's an abuse/spam signal. Reuses the SAME warning-count ladder
  // (deliberate simplification, matching COMPETING_PROJECT_PROMOTION's own
  // precedent) with its own distinct reason codes so the caller can render
  // a genuinely different ("stop spamming", never a Promotion redirect)
  // warning and label it correctly in the Watcher Ops audit trail.
  if (input.category === "SEARCH_SPAM") {
    const isFlood = input.floodRepeat;
    const nextCount = isFlood ? Math.max(input.priorWarningCount + 1, SOLICITATION_WARNING_LIMIT + 1) : input.priorWarningCount + 1;
    if (nextCount > SOLICITATION_WARNING_LIMIT) return { kind: "DELETE_KICK", reason: "repeated_search_spam", purge: true };
    return {
      kind: "DELETE_WARN",
      warningNumber: nextCount,
      reason: nextCount === 1 ? "search_spam" : "repeated_search_spam",
      muteMinutes: SOLICITATION_MUTE_MINUTES_BY_WARNING[nextCount],
    };
  }

  // Community-level "Allow Solicitation" override — exempted from ORDINARY
  // ad enforcement ONLY (never LINK_SPAM_OR_FLOOD, never a flood-repeat
  // burst, never scam/phishing/explicit content, all handled above/below
  // this check completely independent of this setting). A community that
  // allows solicitation simply never treats plain unsolicited promotion as
  // a violation at all — checked before the admin-exemption below since it
  // makes that check moot for this category, but the outcome is identical
  // either way (both resolve to ALLOW).
  if (input.category === "UNSOLICITED_PROMOTION" && input.solicitationAllowed && !input.floodRepeat) return { kind: "ALLOW" };

  // Gap 3 deterministic backstop: content directly solicited by a real,
  // recent admin/mod request never counts as unsolicited promotion,
  // regardless of the community's solicitation toggle. Same
  // never-exempt-a-flood-burst carve-out as every other exemption above.
  if (input.category === "UNSOLICITED_PROMOTION" && input.adminSolicitedExemption && !input.floodRepeat) return { kind: "ALLOW" };

  // Admins/trusted roles may legitimately post partner/AMA/campaign links
  // (spec §43) — exempted from ORDINARY ad enforcement only, checked after
  // the severe branches above (never exempt from those). A flood burst is
  // still folded into the unified spam progression below, never exempted
  // for a trusted role either — an obvious automated burst is a safety
  // signal, not ordinary self-promotion. COMPETING_PROJECT_PROMOTION and
  // SEARCH_SPAM both already returned unconditionally above and structurally
  // can never reach this line -- confirmed by TypeScript's own control-flow
  // narrowing (the category type here is provably already down to
  // UNSOLICITED_PROMOTION | LINK_SPAM_OR_FLOOD | PHISHING_OR_SCAM |
  // EXPLICIT_CONTENT), not just by convention.
  if (input.isAdminOrTrusted && input.category !== "LINK_SPAM_OR_FLOOD" && !input.floodRepeat) return { kind: "ALLOW" };

  // NEGATIVE_STATEMENT -- reached here ONLY for an ordinary, non-admin/
  // trusted sender (the check above already exempted an admin/trusted
  // member's own message, deliberately -- their own framing of their own
  // community is their call, unlike the never-exempt abuse categories
  // above). Its own dedicated 3-strike ladder, deliberately separate from
  // every other counter/ladder in this file (explicit product decision,
  // 2026-09-05): 1st offense deletes SILENTLY, no public warning of any
  // kind ("should be deleted without warning, just deleted"); 2nd offense
  // deletes + warns + mutes for NEGATIVE_STATEMENT_MUTE_MINUTES; the 3rd
  // (and every subsequent) offense bans for a fixed, TIME-BOUND
  // NEGATIVE_STATEMENT_BAN_MINUTES -- NEVER a kick ("things like negative
  // comment should only be mute/ban, no kick") and never permanent.
  if (input.category === "NEGATIVE_STATEMENT") {
    const nextCount = input.priorNegativeStatementCount + 1;
    if (nextCount === 1) return { kind: "DELETE_WARN", warningNumber: nextCount, reason: "negative_statement", silent: true };
    if (nextCount === 2) {
      return { kind: "DELETE_WARN", warningNumber: nextCount, reason: "repeated_negative_statement", muteMinutes: NEGATIVE_STATEMENT_MUTE_MINUTES };
    }
    return { kind: "DELETE_BAN", reason: "escalated_negative_statement", banMinutes: NEGATIVE_STATEMENT_BAN_MINUTES };
  }

  // Solicitation progression: UNSOLICITED_PROMOTION and an obvious
  // automated flood burst share ONE escalation counter/response shape. A
  // detected flood burst (spec §28's "obvious automated/rapid repetition")
  // skips straight past the whole leeway ladder rather than needing the
  // full count -- it forces the count to at least SOLICITATION_WARNING_LIMIT
  // + 1, so it always resolves to the kick+purge tier below, never a fresh
  // warning. An ordinary first offense gets warningNumber=1 with NO mute
  // (SOLICITATION_MUTE_MINUTES_BY_WARNING has no entry for 1, so
  // muteMinutes is correctly undefined) -- "first warning should be fine".
  const isFlood = input.category === "LINK_SPAM_OR_FLOOD" || input.floodRepeat;
  const nextCount = isFlood ? Math.max(input.priorWarningCount + 1, SOLICITATION_WARNING_LIMIT + 1) : input.priorWarningCount + 1;
  if (nextCount > SOLICITATION_WARNING_LIMIT) return { kind: "DELETE_KICK", reason: "repeated_unsolicited_promotion", purge: true };
  return {
    kind: "DELETE_WARN",
    warningNumber: nextCount,
    reason: nextCount === 1 ? "unsolicited_promotion" : "repeated_unsolicited_promotion",
    muteMinutes: SOLICITATION_MUTE_MINUTES_BY_WARNING[nextCount],
  };
}

/* ---------------------------------------------------- identity/mention rendering ---- */
// Context-aware identity rendering (three distinct behaviors, never
// conflated into one generic "displayName" string):
//
//  1. Fellow-moderator reference & ordinary human conversational naming are
//     ALREADY correctly handled by classifySender's existing displayName
//     resolution (community-runtime.ts) -- a HUMAN's displayName is their
//     Telegram given name (first_name), an INNVIL_MODERATOR's displayName is
//     its OWN configured name, never its Telegram bot username. Both flow
//     straight into generation as `senderName` (chatter-generate.ts) and
//     need no separate wrapper here -- there's nothing this file could add.
//  2. A MODERATION WARNING is different: it must explicitly, verifiably
//     target the offending human (a real clickable Telegram mention), which
//     plain conversational naming was never designed for. That's
//     renderHumanModerationMention below -- the ONLY new mention mechanism
//     this file introduces, deliberately never applied to a fellow
//     moderator (moderation only ever runs against HUMAN senders in the
//     first place -- runLinkModeration is only reached from
//     handleHumanMessage, itself gated on senderType === "HUMAN").

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The ONLY mention mechanism used for moderation warnings/enforcement
 *  notices. Prefers a real `@username` mention (plain text, genuinely
 *  clickable, no escaping needed -- Telegram usernames are restricted to
 *  `[a-z0-9_]`) when the offender has one; falls back to a stable
 *  `tg://user?id=...` mention (their given/display name as the visible
 *  label, HTML-escaped) when they don't, since not every Telegram user has
 *  a username and a warning must never silently go unaddressed just
 *  because one is missing. Requires `parse_mode: "HTML"` on the outgoing
 *  sendMessage call in EITHER case (a bare `@username` is valid, unescaped
 *  text under HTML parse mode too). */
export function renderHumanModerationMention(platformUserId: string, username: string | null, displayName: string | null): string {
  if (username && username.trim()) return `@${username.trim()}`;
  const safeName = escapeTelegramHtml((displayName ?? "").trim() || "there");
  return `<a href="tg://user?id=${platformUserId}">${safeName}</a>`;
}

/* ------------------------------------------------------- scam warning text ---- */
// Deterministic/template-based ONLY -- a scam/phishing warning must never
// depend on a model call (never Claude/DeepSeek), and must never reproduce
// the malicious URL itself.

/** First confirmed high-confidence scam/phishing offense -- warn AND mute,
 *  never ban. The malicious URL is deliberately never included. States the
 *  real mute duration explicitly (deterministic, never AI-paraphrased --
 *  the exact number matters and must never be hallucinated). */
export function scamFirstOffenseWarningHtml(mentionHtml: string): string {
  return `${mentionHtml}, your message was removed because it contained a suspected scam/phishing link. You've been muted for ${SCAM_FIRST_WARNING_MUTE_MINUTES} minutes. Another confirmed violation will result in removal from this community.`;
}

/** Second confirmed high-confidence scam/phishing offense within the
 *  active strike window -- accompanies a DELETE_KICK (+ message purge).
 *  Deliberately takes NO mention (2026-09-05 audience-semantics correction):
 *  a kick changes the audience of the visible message -- the removed person
 *  may no longer be present to read anything addressed to them, so this is
 *  a plain COMMUNITY-FACING reminder, never a personal "you have been
 *  removed" notice. The private Watcher Ops audit report (community-
 *  runtime.ts) still records exactly who was kicked and why -- that
 *  internal enforcement fact is kept separate from this public message. */
export function scamRepeatOffenseWarningHtml(): string {
  return "Posting scam or phishing links isn't tolerated here -- repeated or severe violations result in removal from the community.";
}

/** Deterministic sentence appended to the AI-phrased unsolicited-promotion
 *  warning when it also comes with a mute -- the exact duration must never
 *  be left to the model to state (a hallucinated number would be a real,
 *  visible correctness bug), so it's always this fixed, separately-composed
 *  sentence, never part of the generated text itself. */
export function spamWarningMuteSentence(muteMinutes: number): string {
  return `You've been muted for ${muteMinutes} minutes.`;
}

/** Appended to an ordinary (non-scam) promotion warning, directing the
 *  offender to the Project's own configured Partnerships contact --
 *  deterministic, never model-generated, so a real handle/email can never
 *  be garbled or invented. Empty string (never a fabricated placeholder)
 *  when no contact is configured for this Project. */
export function promotionContactSentence(contact: string | null): string {
  return contact ? ` For promotion inquiries, please contact ${contact}.` : "";
}

/* ------------------------------------------------ moderation-warning anti-repetition ---- */
// Live feedback (2026-09-04): a Watcher was posting near-identical warnings
// ("No promo in this topic, friend -- that's a 10-min mute. Take that energy
// to Promotion instead..." / "...that's a 10 min mute. Take it to Promotion
// instead, or next time it escalates further.") across different offenders --
// each generation call had zero awareness of what the SAME Watcher had just
// said. This is a cheap, deterministic, bounded similarity check (never a
// vector/embedding comparison, never unbounded retries) the language-
// realization step (link-classify.ts's generatePersonaSolicitationWarning)
// uses to decide whether to regenerate ONCE with an explicit "say this
// differently" instruction. It never affects WHETHER a violation is flagged/
// deleted/counted -- only how the resulting text is worded.

/** Normalizes a warning's text into a bag of words for similarity purposes --
 *  strips @mentions and `tg://user` HTML mentions (a different offender's
 *  name/handle every time would otherwise make two structurally-identical
 *  warnings look LESS similar, exactly backwards), strips punctuation/casing,
 *  and collapses any run of digits to a single placeholder so "10-minute
 *  mute" and "30-minute mute" still register as the same underlying SHAPE
 *  (the live-caught bug: only the mute number differed, everything else was
 *  the same skeleton). */
function normalizeWarningWords(text: string): Set<string> {
  const stripped = text
    .toLowerCase()
    .replace(/<a\b[^>]*>.*?<\/a>/gi, " ")
    .replace(/@[a-z0-9_]+/gi, " ")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\b\d+\b/g, "#");
  return new Set(stripped.split(/\s+/).filter(Boolean));
}

/** Bag-of-words Jaccard similarity (intersection / union) between two
 *  warning texts, 0 (nothing in common) to 1 (identical word sets). Cheap,
 *  deterministic, in-memory -- no external library, no embeddings. */
export function warningTextSimilarity(a: string, b: string): number {
  const sa = normalizeWarningWords(a);
  const sb = normalizeWarningWords(b);
  if (!sa.size || !sb.size) return 0;
  let intersection = 0;
  for (const word of sa) if (sb.has(word)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Chosen empirically against the exact live-reported near-duplicate pairs
 *  (see link-classify.test.ts) -- high enough that two genuinely different
 *  warnings (different topic, different fact, different structure) never
 *  cross it by accident, low enough to reliably catch "same skeleton, only
 *  the mute number/username changed." */
export const NEAR_DUPLICATE_WARNING_THRESHOLD = 0.45;

/** Highest similarity score between `candidate` and ANY of `recentTexts` (a
 *  small, bounded set -- the caller passes at most a handful of this SAME
 *  Watcher's own recent messages in this SAME community, never an unbounded
 *  history). 0 when `recentTexts` is empty. This is the raw signal
 *  `resolveWarningResponseMode` needs a CONTINUOUS score for (distinguishing
 *  "recognizably similar" from "near-identical, nothing new to say") -- see
 *  its own doc comment. */
export function maxWarningSimilarity(candidate: string, recentTexts: string[]): number {
  return recentTexts.reduce((max, t) => Math.max(max, warningTextSimilarity(candidate, t)), 0);
}

/** True when `candidate` reads as a near-duplicate of ANY of `recentTexts`.
 *  Used to decide whether to regenerate once, never to block/alter the
 *  underlying moderation decision itself. */
export function isNearDuplicateWarning(candidate: string, recentTexts: string[]): boolean {
  return maxWarningSimilarity(candidate, recentTexts) >= NEAR_DUPLICATE_WARNING_THRESHOLD;
}

/* -------------------------------------------- moderation-warning response mode ---- */
// 2026-09-04, second pass (corrected the SAME day -- see the "no
// NO_PUBLIC_REPLY" note below, which was itself an invented product rule,
// not a technical or existing-policy constraint): a Watcher should not
// narrate every minor deletion with a full paragraph, and should not keep
// restating a correction the room has already just seen. This is a
// DETERMINISTIC, zero-cost decision -- computed entirely from state the
// caller already has (whether a real consequence is attached to THIS
// specific violation, and HOW similar the just-generated candidate already
// reads to something this Watcher recently said) -- never an extra model
// call whose only purpose is deciding whether to speak.

export type WarningResponseMode = "NO_PUBLIC_REPLY" | "WARNING" | "SHORT_NUDGE" | "ENFORCEMENT_NOTICE";

/** A candidate this similar to something JUST said reads as the exact same
 *  correction restated -- the community has already seen it, and saying it
 *  again adds no information. Meaningfully higher than
 *  NEAR_DUPLICATE_WARNING_THRESHOLD (0.45) specifically so a real SHORT_NUDGE
 *  band (0.45-0.7 -- recognizably similar but still distinguishable) exists
 *  between "ordinary" and "say nothing." */
export const NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD = 0.7;

/** Resolves how much a DELETE_WARN-tier moderation notice should say.
 *
 *   - ENFORCEMENT_NOTICE: a REAL consequence is attached to this specific
 *     violation (a mute is being applied; for scam/phishing, EVERY notice is
 *     an ENFORCEMENT_NOTICE, since it's always either a mute or an already-
 *     executed kick, never a bare warning; for media, which has no mute
 *     concept, this is the final warning immediately before a kick).
 *     Always communicated in full, every stated fact intact, and NEVER
 *     downgraded or suppressed by similarity to a recent message -- the
 *     product needs the person/community to actually understand what just
 *     happened. This is the one mode that can NEVER resolve to
 *     NO_PUBLIC_REPLY or SHORT_NUDGE, checked first, unconditionally.
 *   - NO_PUBLIC_REPLY: no real consequence beyond the deletion itself, AND
 *     the candidate reads as NEAR-IDENTICAL (>= NO_PUBLIC_REPLY_SIMILARITY_
 *     THRESHOLD) to something this Watcher said VERY recently in this same
 *     Community -- the room has already just seen this exact correction
 *     stated; restating it again adds no new information, so the deletion
 *     itself is the only signal needed. Existing precedent for genuine
 *     silence on a low-value repeat already exists elsewhere in this
 *     runtime (a repeated non-scam spam/promotion KICK has no companion
 *     public message at all today) -- this generalizes the same "not every
 *     enforcement action needs its own sentence" principle to the WARN tier
 *     specifically for the no-new-information case.
 *   - SHORT_NUDGE: no real consequence, and the candidate is recognizably
 *     similar to something recent (>= NEAR_DUPLICATE_WARNING_THRESHOLD but
 *     below the NO_PUBLIC_REPLY bar) -- similar enough to vary the wording
 *     for, not so identical that saying anything at all is redundant. A
 *     brief, still persona-voiced acknowledgment instead of a second full
 *     explanation.
 *   - WARNING: the ordinary case -- no real consequence attached, and
 *     nothing recently similar. A normal, concise, persona-based correction
 *     (today's existing, unchanged shape for a genuine first-time notice).
 *
 *  Silence is NEVER a symptom of generation failure -- a failed generation
 *  attempt always falls back to the known-safe deterministic template
 *  (never null/skipped), and this function is only ever consulted once a
 *  candidate has ALREADY been successfully produced. Silence here is
 *  strictly a "nothing new to communicate" decision, never a "couldn't
 *  produce text" one -- so it can never suppress required enforcement
 *  clarity for a reason unrelated to redundancy. */
export function resolveWarningResponseMode(input: { hasEnforcementConsequence: boolean; similarityToRecent: number }): WarningResponseMode {
  if (input.hasEnforcementConsequence) return "ENFORCEMENT_NOTICE";
  if (input.similarityToRecent >= NO_PUBLIC_REPLY_SIMILARITY_THRESHOLD) return "NO_PUBLIC_REPLY";
  if (input.similarityToRecent >= NEAR_DUPLICATE_WARNING_THRESHOLD) return "SHORT_NUDGE";
  return "WARNING";
}

/* --------------------------------------- generated-text authoritative-fact guard ---- */
// Generated moderation prose is untrusted presentation output, never an
// enforcement authority -- the real decision (what happened, whether a mute
// applies, what number it is, whether removal already occurred) was already
// made deterministically before this text exists. This is a small,
// deliberately narrow, deterministic guard against the model stating
// something that contradicts (or invents beyond) that already-decided
// authoritative state -- not a semantic/NLP validator.

const MUTE_MENTION_RE = /\b(\d+)\s*[-\s]?\s*(?:min|mins|minute|minutes)\b/gi;

// A raw link/URL must never appear in ANY generated moderation warning --
// the existing "never speak a link" rule (previously prompt-instruction-only
// for the solicitation-warning path) is now also code-enforced, universally.
// This is what makes it structurally safe to realize a SCAM warning in
// persona at all: the model is never given the malicious URL in the first
// place (it's not part of any warning's facts, for any category), and even
// if it somehow produced a link-shaped string anyway, this guard rejects it
// before it can ever reach Telegram.
const URL_OR_LINK_RE = /https?:\/\/|(?:^|\s)t\.me\/[a-z0-9_]/i;

// A DEFINITE, already-happened-sounding, SECOND-PERSON ban/kick/removal
// claim ("you have been removed", "you're banned now"). REJECTED
// UNCONDITIONALLY, for every caller (2026-09-05 audience-semantics
// correction) -- a kick/ban changes WHO the visible message is for, and the
// removed person may no longer be present to read anything addressed
// directly to them, so this specific claim shape is now always the wrong
// framing, regardless of whether removal genuinely happened. (Before this
// correction, an explicit `removalHappened: true` escape hatch permitted
// this claim for a scam-repeat/negative-statement-escalated offense --
// removed; those two categories now generate a COMMUNITY-facing reminder
// instead, which structurally never needs to make this kind of claim at
// all.) Deliberately does NOT match a hedged, conditional mention of a
// possible FUTURE consequence, nor a general community-facing policy
// statement ("repeated violations result in removal", "repeated offenses
// escalate to a kick or ban") -- both are explicitly instructed/permitted
// (see link-classify.ts's requiredFacts) and are exactly the forward-
// looking/general rule language this function must never reject.
const DEFINITE_REMOVAL_CLAIM_RE =
  /\byou(?:'ve| have)?\s+(?:been|got)\s+(?:banned|kicked|removed)\b|\byou\s+(?:are|were)\s+(?:now\s+)?(?:banned|kicked|removed)\b|\bbanned\s+(?:now|already|permanently)\b|\bkicked\s+(?:now|already)\b|\bremoved\s+(?:now|already)\s+from\b/i;

/** True when generated moderation-warning `text` states something the
 *  authoritative, already-decided facts don't support. Two concrete,
 *  cheaply-checkable classes are caught:
 *
 *   1. A specific minute-count that doesn't match the REAL mute duration
 *      actually applied to this violation -- including stating any minute-
 *      count at all when no mute applies (`authoritative.muteMinutes` is
 *      null/undefined). This is the exact class of error a hallucinated or
 *      garbled number produces (the live-reported concern: "next time
 *      you're banned" stated with no basis, generalized here to any
 *      invented specific fact).
 *   2. A raw link/URL of any kind -- see URL_OR_LINK_RE above. Applies
 *      unconditionally to every caller.
 *   3. A DEFINITE, completed-tense, second-person ban/kick/removal claim --
 *      unconditionally rejected for every caller, see DEFINITE_REMOVAL_CLAIM_RE's
 *      own doc comment above.
 *
 *  What this deliberately does NOT (and, without a disproportionate NLP/
 *  semantic-parsing investment, cannot) guarantee: it cannot distinguish an
 *  overly-confident HEDGE about a possible future consequence from an
 *  appropriately cautious one -- only categorically definite/completed-tense
 *  claims are caught, the smallest coherent guard available here rather than
 *  a full semantic validator. The real enforcement action was already
 *  decided and executed before this text was generated, so an over-
 *  confident hedge never itself causes an incorrect ACTION, only a
 *  mismatched narrative -- this guard's job is to catch the concrete,
 *  checkable cases, and fall back to the known-safe deterministic template
 *  on a match. */
export function warningTextExceedsAuthorizedFacts(
  text: string,
  authoritative: { muteMinutes?: number | null }
): boolean {
  const authoritativeMute = authoritative.muteMinutes ?? null;
  for (const match of text.matchAll(MUTE_MENTION_RE)) {
    const stated = Number(match[1]);
    if (authoritativeMute === null || stated !== authoritativeMute) return true;
  }
  if (URL_OR_LINK_RE.test(text)) return true;
  if (DEFINITE_REMOVAL_CLAIM_RE.test(text)) return true;
  return false;
}
