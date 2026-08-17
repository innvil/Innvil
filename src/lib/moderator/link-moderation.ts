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

/** Extracts every URL and bare @handle (Telegram identity references count
 *  as "links" for moderation purposes — "join @othergroup" is functionally
 *  identical to a t.me URL). Order-preserving, deduped. */
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
  for (const m of text.matchAll(TELEGRAM_HANDLE_RE)) {
    const handle = `@${m[1]}`;
    if (!found.includes(handle)) found.push(handle);
  }
  return found;
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
  warningCount: number;
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
}

export const EMPTY_WARNING_STATE: LinkWarningState = {
  warningCount: 0, recentLinkHash: null, recentLinkAt: null, recentLinkCountInWindow: 0,
  scamStrikeCount: 0, scamStrikeAt: null,
};

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
  | { kind: "DELETE_WARN"; warningNumber: number; reason: "unsolicited_promotion" | "repeated_unsolicited_promotion" | "explicit_content_borderline" | "scam_or_phishing" }
  /** Second confirmed high-confidence scam/phishing offense within the
   *  active strike window — removes (kicks) the user, but is NOT a
   *  permanent ban. Structurally distinct from DELETE_BAN so a caller can
   *  never confuse "temporary removal, can rejoin" with "permanent". */
  | { kind: "DELETE_KICK"; reason: "repeated_scam_or_phishing" }
  | { kind: "DELETE_BAN"; reason: "explicit_content" | "flood" | "repeated_unsolicited_promotion" | "repeated_explicit_content" | "repeated_scam_or_phishing" };

/** 3 confirmed unsolicited-promotion violations get a warning each; the
 *  NEXT one after that (the 4th) escalates to removal (spec §25/§57). */
export const PROMOTION_WARNING_LIMIT = 3;

/** The deterministic policy layer (spec §42) — classification informs this,
 *  it never decides alone. Admin/trusted-role exemption applies ONLY to
 *  ordinary advertising (spec §43); severity-based enforcement
 *  (explicit/phishing) is never role-exempt, since that's a safety
 *  question, not a "who's allowed to self-promote" one. */
export function decideLinkEnforcement(input: {
  category: LinkCategory;
  confidence: ClassificationConfidence;
  isAdminOrTrusted: boolean;
  floodRepeat: boolean;
  priorWarningCount: number;
  /** Already expiry-resolved via effectiveScamStrikeCount — this function
   *  stays pure and never reasons about time itself. */
  priorScamStrikeCount: number;
}): ModerationEnforcement {
  if (input.category === "EXPLICIT_CONTENT" && input.confidence === "high") return { kind: "DELETE_BAN", reason: "explicit_content" };

  // Scam/phishing gets a GRADUATED response, never an instant permanent ban
  // on a single offense — first confirmed high-confidence offense is
  // DELETE+WARN, the second within the active strike window is DELETE+KICK
  // (removable, not permanent), and only a third+ offense falls back to the
  // existing stronger DELETE_BAN path. Never role-exempt (a safety
  // question, same principle as EXPLICIT_CONTENT above) and never
  // escalated by borderline/uncertain confidence (spec: "only sufficiently
  // high-confidence scam/phishing/malicious-wallet-link detections should
  // contribute to this stronger escalation behavior").
  if (input.category === "PHISHING_OR_SCAM" && input.confidence === "high") {
    const nextScamCount = input.priorScamStrikeCount + 1;
    if (nextScamCount === 1) return { kind: "DELETE_WARN", warningNumber: nextScamCount, reason: "scam_or_phishing" };
    if (nextScamCount === 2) return { kind: "DELETE_KICK", reason: "repeated_scam_or_phishing" };
    return { kind: "DELETE_BAN", reason: "repeated_scam_or_phishing" };
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

  // Obvious automated/rapid repetition (spec §28) justifies stronger
  // enforcement without needing the full 3-warning grace period -- checked
  // BEFORE the admin/trusted exemption below, since a rapid flood burst
  // reads as a compromised-account/safety signal, not ordinary self-
  // promotion; spec §43 explicitly warns against exempting trusted
  // accounts from ALL safety/security logic, only from ordinary ad
  // enforcement.
  if (input.category === "LINK_SPAM_OR_FLOOD" || input.floodRepeat) return { kind: "DELETE_BAN", reason: "flood" };

  // Admins/trusted roles may legitimately post partner/AMA/campaign links
  // (spec §43) — exempted from ORDINARY ad enforcement only, checked after
  // the severe/safe/unknown/flood branches above (never exempt from those).
  if (input.isAdminOrTrusted) return { kind: "ALLOW" };

  // UNSOLICITED_PROMOTION from here on -- 3-strike escalation (spec §25).
  const nextCount = input.priorWarningCount + 1;
  if (nextCount > PROMOTION_WARNING_LIMIT) return { kind: "DELETE_BAN", reason: "repeated_unsolicited_promotion" };
  return { kind: "DELETE_WARN", warningNumber: nextCount, reason: nextCount === 1 ? "unsolicited_promotion" : "repeated_unsolicited_promotion" };
}

/* ------------------------------------------------------- scam warning text ---- */
// Deterministic/template-based ONLY -- a scam/phishing warning must never
// depend on a model call (never Claude/DeepSeek), and must never reproduce
// the malicious URL itself.

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A stable Telegram-native mention via user id (`tg://user?id=...`),
 *  never `@username` — usernames can change or be absent entirely, but a
 *  numeric platform user id is permanent. Requires `parse_mode: "HTML"` on
 *  the outgoing sendMessage call. */
export function telegramMentionHtml(platformUserId: string, displayName: string | null): string {
  const safeName = escapeTelegramHtml((displayName ?? "").trim() || "there");
  return `<a href="tg://user?id=${platformUserId}">${safeName}</a>`;
}

/** First confirmed high-confidence scam/phishing offense -- warn only,
 *  never ban. The malicious URL is deliberately never included. */
export function scamFirstOffenseWarningHtml(mentionHtml: string): string {
  return `${mentionHtml}, your message was removed because it contained a suspected scam/phishing link. Do not post scam, wallet-drainer, or fake reward links. Repeated violations may result in removal from this community.`;
}

/** Second confirmed high-confidence scam/phishing offense within the
 *  active strike window -- accompanies a DELETE_KICK. */
export function scamRepeatOffenseWarningHtml(mentionHtml: string): string {
  return `${mentionHtml}, another scam/phishing link was detected. You have been removed from this community.`;
}
