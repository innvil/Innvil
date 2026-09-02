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
  | "LINK_SPAM_OR_FLOOD"
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
}

export const EMPTY_WARNING_STATE: LinkWarningState = {
  warningCount: 0, warningAt: null, recentLinkHash: null, recentLinkAt: null, recentLinkCountInWindow: 0,
  scamStrikeCount: 0, scamStrikeAt: null, mediaWarningCount: 0,
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
  | { kind: "DELETE_WARN"; warningNumber: number; reason: "unsolicited_promotion" | "repeated_unsolicited_promotion" | "explicit_content_borderline" | "scam_or_phishing"; muteMinutes?: number }
  /** Removes (kicks) the user — NOT a permanent ban (structurally distinct
   *  from DELETE_BAN, so a caller can never confuse "temporary removal, can
   *  rejoin" with "permanent"). `purge: true` means the caller should also
   *  attempt to delete this user's other recent messages in the Community
   *  (see community-runtime.ts's purgeUserMessages) — always true for the
   *  categories that reach this kind today (repeated spam, repeated scam,
   *  explicit content), since a kick without cleanup leaves the offending
   *  history sitting in the room. */
  | { kind: "DELETE_KICK"; reason: "repeated_unsolicited_promotion" | "repeated_scam_or_phishing" | "explicit_content" | "repeated_explicit_content"; purge: boolean }
  /** Reserved for a possible future manual admin action — the automatic
   *  policy below (as of 2026-08-27) no longer PRODUCES this kind for any
   *  category; every automatic escalation that used to end in a permanent
   *  ban now ends in DELETE_KICK+purge instead (removable, with cleanup,
   *  matching the Watcher Ops spec's "kick and purge, not a silent
   *  permanent ban" model). Kept in the union so existing callers/tests
   *  referencing it don't need to be restructured for a type that's simply
   *  unreachable today. */
  | { kind: "DELETE_BAN"; reason: "explicit_content" | "flood" | "repeated_unsolicited_promotion" | "repeated_explicit_content" | "repeated_scam_or_phishing" };

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
  // signal, not ordinary self-promotion.
  if (input.isAdminOrTrusted && input.category !== "LINK_SPAM_OR_FLOOD" && !input.floodRepeat) return { kind: "ALLOW" };

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
 *  active strike window -- accompanies a DELETE_KICK (+ message purge). */
export function scamRepeatOffenseWarningHtml(mentionHtml: string): string {
  return `${mentionHtml}, another scam/phishing link was detected. You have been removed from this community.`;
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
