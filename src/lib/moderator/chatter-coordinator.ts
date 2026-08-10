/* =========================================================
   Reactive Natural Chatter — contextual SOCIAL ACTION SELECTION (pure, no
   AI, no I/O).

   This is NOT a response-probability system. There is no priority band that
   maps to a fixed engagement percentage anywhere in this file — no
   Math.random() decides whether an otherwise-appropriate message gets
   ignored. The Coordinator instead classifies the message and the room
   state, then picks ONE of a fixed set of social actions:

       SILENCE      — always a first-class, valid outcome
       REACT        — a real Telegram reaction, no text, no LLM call
       SHORT_ACK    — a lightweight canned text acknowledgement, no LLM call
       CASUAL_CHAT  — a real conversational reply (Sonnet 5)
       ANSWER       — a real informational reply (Sonnet 5)

   (COMMUNITY_HANDOFF also exists as an action type for architectural
   completeness, but its actual selection logic lives in coordinator.ts's
   bot-to-bot acknowledgement flow — it is fundamentally a bot-to-bot
   concept, not something a HUMAN message routes to here.)

   SILENCE always needs a reason ("trivial_low_value", "already_handled",
   "no_eligible_moderator", ...) — never "the roll failed," because there is
   no roll. Where a choice is genuinely ambiguous between two candidates
   (which moderator, not whether to act), selection is DETERMINISTIC
   (whoever's been quietest longest) rather than randomized — that fully
   satisfies "vary who, never whether" without needing actual randomness.

   Multi-moderator: candidates are scored/classified independently and pure
   (no I/O), but the Coordinator picks AT MOST ONE responder for the whole
   event — it never runs a separate decision per deployment (that would let
   several moderators all "coincidentally" reply to the same message). A
   direct mention of one specific moderator strongly biases selection toward
   it without hardcoding "only the mentioned bot may ever answer."

   The AI call itself (chatter-generate.ts) still gets the final say on
   CASUAL_CHAT/ANSWER — this module's job is deciding WHETHER something
   should happen, WHO should do it, and WHICH action, not writing the reply.
   ========================================================= */

export interface ChatterPacingState {
  lastSpokeAt: string | null;
  /** How many of the deployment's own messages in a row happened without an
   *  intervening human message — caps how much the bot can dominate a thread. */
  consecutiveMessages: number;
}

/** Minimum gap between the bot's own ambient messages — bypassed for a directed
 *  message, an active continuation, a community opener, or a real question. */
const MIN_REPLY_GAP_MS = 20_000;
/** Cap on the bot replying to itself/back-to-back without an intervening human message — same bypasses as above. */
const MAX_CONSECUTIVE_BOT_MESSAGES = 2;

function isLikelyQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  return /^(who|what|when|where|why|how|does|do|is|are|can|could|should|would|will)\b/.test(t);
}

/** Trivial = low-content chatter ("lol", "nice", "ok", "thanks") — it can
 *  still earn a REACT or SHORT_ACK given the right context (e.g. directed at
 *  the bot), but it never earns CASUAL_CHAT/ANSWER purely on its own. Bounded
 *  by word count AND a generous character cap so a short message using long
 *  words ("understood, appreciated") still counts, while a longer sentence
 *  that happens to use short words doesn't. This cap is intentionally NOT
 *  relied on for positive-closing detection below — see isPositiveClosing,
 *  which caused a live bug ("okay, perfect!" missed at 12 chars) precisely
 *  because a raw character cap is a fragile signal for that case. */
function isTrivial(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= 2 && text.trim().replace(/[!?.]+$/, "").length <= 16;
}

const COMMUNITY_ADDRESS_RE = /\b(everyone|anyone|guys|all|folks)\b/i;
// Deliberately requires an explicit room-address term ("everyone"/
// "everything") after "how's/how is" — a bare "how's it going" with no
// room-address word is a normal ambient question, not a room-wide opener.
const COMMUNITY_CHECK_IN_RE =
  /\bhow(?:'s|s|\s+is)\s+(?:everyone|everything)\b|\bwhat(?:'s|s|\s+is)\s+everyone\s+(?:up\s+to|doing)\b|\banyone\s+(?:doing\s+anything|around|here)\b|\bquiet\s+(?:in\s+here|today)\b/i;
const GREETING_RE = /\b(gm|good\s*morning|good\s*evening|good\s*afternoon|morning|evening|hey|hi|hello)\b/i;

/** A COMMUNITY_OPENER addresses the room generally and invites anyone to
 *  respond — "good evening everyone, how's everyone doing?", "gm guys",
 *  "what's everyone up to?" — a distinct social category from both trivial
 *  filler ("lol") and a factual/support question ("does anyone know why
 *  orders are delayed?"). Explicit check-in phrasing ("how's everyone
 *  doing") is always an opener on its own; a bare greeting only counts when
 *  it also addresses the room ("gm guys", not just "gm"). */
function isCommunityOpener(text: string): boolean {
  const t = text.trim();
  if (COMMUNITY_CHECK_IN_RE.test(t)) return true;
  return GREETING_RE.test(t) && COMMUNITY_ADDRESS_RE.test(t);
}

const RESOLVED_ACK_RE = /\b(fixed|solved|working now|got it working|nvm|figured it out)\b/i;
const LAUGH_RE = /\b(lol|lmao|haha+|lel|rofl)\b/i;
const THANKS_RE = /\b(thanks|thank\s*you|thx|ty)\b/i;
// A short, upbeat closing ("okay, perfect!", "great, thanks!", "awesome!")
// warrants a REACT, not a text reply — a human moderator smiles/reacts to
// "perfect!", they don't write a whole new sentence back. Distinct from a
// neutral closing (CLOSING_ACK_RE alone, e.g. "I see, okay.") which stays
// SILENCE — this one specifically carries positive sentiment worth
// acknowledging with an emoji.
const POSITIVE_WORD_RE = /\b(perfect|awesome|amazing|excellent|fantastic|sweet|love\s*it|nice\s*one|great)\b/i;
const LOVE_RE = /\blove(?:d|s)?\b/i;
// Bounded by WORD COUNT only, not character length -- isTrivial's char cap
// is exactly the fragile heuristic that missed "okay, perfect!" originally,
// and would still miss slightly longer variants like "that's fantastic!"
// (17 chars, still just 2 words) if reused here. A short closing that
// carries a positive word is flagged regardless of how long those words
// are; a genuinely longer sentence that happens to mention "great" mid-
// paragraph (5+ words) is not a closing and stays SUBSTANTIVE.
function isPositiveClosing(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= 4 && POSITIVE_WORD_RE.test(text);
}
// A closing acknowledgement ("I see, okay.", "got it", "alright", "fair
// enough") ends an exchange -- it deserves the same treatment as trivial
// filler regardless of word count. Without this, "I see, okay." (3 words)
// falls outside the <=2-word trivial heuristic and gets treated as a real
// message worth continuing, producing exactly the support-chat habit of
// tacking on "anything else on your mind?" after the human has already
// signaled the conversation is done.
const CLOSING_ACK_RE = /^(i\s+see,?\s*)?(ok(ay)?|alright|got\s*it|makes\s*sense|fair\s*enough|understood|noted|cool|sounds\s*good)[.!]*$/i;

/** A human explicitly asking whether a DIFFERENT moderator is around
 *  ("any other moderator who can respond here?", "anyone else?", "other
 *  mod?") is a strong routing signal, not an ordinary question the
 *  currently-active moderator should keep answering itself. Distinct from
 *  an explicit @mention of a SPECIFIC other bot (handled by isDirectedAtBot
 *  already) — this covers the generic "is anyone else here" case. */
const OTHER_MODERATOR_RE = /\bother\s*mod(?:erator)?s?\b|\banother\s*mod(?:erator)?\b|\bany\s*(?:one|body)?\s*else\b|\bsomeone\s*else\b/i;
function invitesOtherModerator(text: string): boolean {
  return OTHER_MODERATOR_RE.test(text);
}

/** Deterministic reaction pick for a trivial acknowledgement — no LLM. */
function reactionFor(text: string): string {
  if (LAUGH_RE.test(text)) return "😂";
  if (THANKS_RE.test(text)) return "🙏";
  return "👍";
}

/** Deterministic reaction pick for an upbeat closing — no LLM. */
function positiveReactionFor(text: string): string {
  if (LOVE_RE.test(text)) return "❤️";
  return "😄"; // grin/smile
}

/* -------------------------------------------------- directed-address resolution ---- */

export interface ModeratorIdentity {
  deploymentId: string;
  /** The moderator's own configured display name (e.g. "Kwan"). */
  name: string;
  botUsername: string | null;
}

export interface DirectedMatch {
  deploymentId: string;
  /** True when matched by a close-but-not-exact spelling of the configured
   *  name ("knaw"/"kwna" for "Kwan") rather than an exact word or @mention —
   *  lets generation optionally acknowledge the typo without forcing it. */
  isTypo: boolean;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function sortedChars(s: string): string {
  return s.split("").sort().join("");
}

/** A word/token counts as a typo of `name` only via a SAFE signal: same
 *  length + an exact letter-for-letter anagram (a transposition typo like
 *  "kwan"->"knaw"/"kwna") — an unrelated real word being an exact anagram of
 *  a specific configured name is vanishingly unlikely, regardless of raw
 *  edit distance. Raw Levenshtein distance alone is NOT safe for short
 *  names: "Test" is distance-1 from the ordinary English words "rest",
 *  "best", and "west", which would otherwise falsely trigger on completely
 *  unrelated messages. Longer names (5+ chars) get a little more room
 *  (distance <= 1) since real-word collisions get rarer as names get longer. */
function isFuzzyNameToken(token: string, name: string): boolean {
  if (name.length < 3 || token.length < 3 || token === name) return false;
  if (token.length === name.length && sortedChars(token) === sortedChars(name)) return true;
  if (name.length >= 5) return levenshtein(token, name) <= 1;
  return false;
}

/** Resolves which (if any) deployment a message explicitly addresses — by
 *  @username, by its own configured display name, or by a typo-tolerant
 *  near-spelling of that name. Word-boundary-safe (tokenized, never
 *  substring) so a moderator named "Ann" is never triggered by
 *  "announcement", and case-insensitive. Ambiguous matches (2+ moderators
 *  plausibly addressed at the same confidence level) resolve to NO match
 *  rather than guessing which one was meant. Works for any configured name —
 *  nothing here is specific to any particular moderator. */
export function resolveDirectedModerator(text: string, moderators: ModeratorIdentity[]): DirectedMatch | null {
  const lower = text.toLowerCase();

  // @username is unambiguous by construction — Telegram usernames are unique.
  const usernameHit = moderators.find((m) => m.botUsername && lower.includes(`@${m.botUsername.toLowerCase()}`));
  if (usernameHit) return { deploymentId: usernameHit.deploymentId, isTypo: false };

  const tokens = tokenize(text);
  if (!tokens.length) return null;

  const exact = moderators.filter((m) => tokenize(m.name).some((nt) => tokens.includes(nt)));
  if (exact.length === 1) return { deploymentId: exact[0].deploymentId, isTypo: false };
  if (exact.length > 1) return null; // ambiguous -- don't guess

  const fuzzy = moderators.filter((m) => tokenize(m.name).some((nt) => tokens.some((t) => isFuzzyNameToken(t, nt))));
  if (fuzzy.length === 1) return { deploymentId: fuzzy[0].deploymentId, isTypo: true };
  return null; // no match, or an ambiguous fuzzy match across multiple moderators
}

type MessageKind = "EMPTY" | "TOO_SHORT" | "COMMUNITY_OPENER" | "TRIVIAL" | "QUESTION" | "SUBSTANTIVE";

function classifyMessageKind(trimmed: string): MessageKind {
  if (!trimmed) return "EMPTY";
  if (trimmed.length < 2) return "TOO_SHORT";
  if (isCommunityOpener(trimmed)) return "COMMUNITY_OPENER";
  if (isTrivial(trimmed) || CLOSING_ACK_RE.test(trimmed) || isPositiveClosing(trimmed)) return "TRIVIAL";
  if (isLikelyQuestion(trimmed)) return "QUESTION";
  return "SUBSTANTIVE";
}

export interface ChatterCandidate {
  deploymentId: string;
  /** True if this message replies to THIS deployment's own previous message, or @mentions it. */
  isDirectedAtBot: boolean;
  /** True if the message immediately before this one, in the community's
   *  recent context, was sent by THIS deployment specifically — i.e. this
   *  candidate is mid an active 1:1 exchange with the human. Without this,
   *  the quietest-longest tie-break actively favors a DIFFERENT moderator
   *  jumping into a conversation it wasn't part of. */
  wasLastSpeaker: boolean;
  pacing: ChatterPacingState;
}

export interface ChatterActionInput {
  text: string;
  candidates: ChatterCandidate[];
  now: Date;
  /** True when the message immediately before this one in the community's
   *  recent context was itself sent by an Innvil moderator (any of them) —
   *  used to suppress a redundant trivial follow-up right after a reply. */
  recentlyAnsweredByModerator?: boolean;
  /** True when the message immediately before this one was sent by a HUMAN
   *  (not this trigger message's own sender necessarily) — used to suppress
   *  piling another CASUAL_CHAT opener onto a room that already engaged
   *  with it themselves. */
  recentlyRespondedByHuman?: boolean;
}

export type ChatterAction =
  | { type: "SILENCE"; reasons: string[] }
  | { type: "REACT"; deploymentId: string; emoji: string; reasons: string[] }
  | { type: "SHORT_ACK"; deploymentId: string; reasons: string[] }
  | { type: "CASUAL_CHAT"; deploymentId: string; reasons: string[] }
  | { type: "ANSWER"; deploymentId: string; reasons: string[] };

/** Pacing hard-blocks (cooldown, dominating-conversation cap) exist to stop
 *  the bot from flooding the room with unprompted LOW-value chatter. A
 *  directed message, an active continuation, a community opener, or a real
 *  question all still deserve to go through even moments after the bot last
 *  spoke — same as an attentive, present human moderator: still responsive
 *  when addressed or asked something real, never a wall of unprompted noise. */
function bypassesPacing(kind: MessageKind, directed: boolean, wasLastSpeaker: boolean): boolean {
  return directed || wasLastSpeaker || kind === "COMMUNITY_OPENER" || kind === "QUESTION";
}

function candidateEligible(pacing: ChatterPacingState, now: Date, bypass: boolean): boolean {
  const overParticipating = pacing.consecutiveMessages >= MAX_CONSECUTIVE_BOT_MESSAGES;
  const cooldownActive = !!pacing.lastSpokeAt && now.getTime() - new Date(pacing.lastSpokeAt).getTime() < MIN_REPLY_GAP_MS;
  if (overParticipating && !bypass) return false;
  if (cooldownActive && !bypass) return false;
  return true;
}

/** Picks ONE candidate among several equally-actionable ones. Deterministic,
 *  not randomized: an explicit @mention of one specific moderator wins
 *  first (a deliberate signal from the human), then whoever's actually mid
 *  an active exchange, then whoever's been quietest longest — so engagement
 *  naturally spreads across moderators instead of always landing on the
 *  same one, without needing real randomness to do it. */
function pickCandidate(eligible: ChatterCandidate[]): ChatterCandidate | null {
  if (!eligible.length) return null;
  const directed = eligible.find((c) => c.isDirectedAtBot);
  if (directed) return directed;
  const continuity = eligible.find((c) => c.wasLastSpeaker);
  if (continuity) return continuity;
  return [...eligible].sort((a, b) => {
    const aSpoke = a.pacing.lastSpokeAt ? new Date(a.pacing.lastSpokeAt).getTime() : 0;
    const bSpoke = b.pacing.lastSpokeAt ? new Date(b.pacing.lastSpokeAt).getTime() : 0;
    return aSpoke - bSpoke;
  })[0];
}

/** Selects the socially appropriate ACTION for one human message, and which
 *  deployment (if any) performs it. Pure, deterministic, no RNG anywhere —
 *  see file header. */
export function selectChatterAction(input: ChatterActionInput): ChatterAction {
  const trimmed = input.text.trim();
  const kind = classifyMessageKind(trimmed);

  if (kind === "EMPTY") return { type: "SILENCE", reasons: ["empty_message"] };
  if (kind === "TOO_SHORT") return { type: "SILENCE", reasons: ["too_short"] };

  const eligible = input.candidates.filter((c) =>
    candidateEligible(c.pacing, input.now, bypassesPacing(kind, c.isDirectedAtBot, c.wasLastSpeaker))
  );

  // A human explicitly asking whether a DIFFERENT moderator is around takes
  // priority over every other classification, including an active
  // continuity thread — that's the exact opposite of what continuity should
  // mean here. Excludes whoever's been carrying the conversation so far
  // from the candidate pool (not merely deprioritizes them), so the
  // currently-active moderator can't keep answering on a rival's behalf.
  // Falls back to the full eligible pool only when no one else exists (a
  // single-moderator community truthfully has no one else to hand off to).
  if (invitesOtherModerator(trimmed) && input.candidates.length > 1) {
    const others = eligible.filter((c) => !c.wasLastSpeaker);
    const pool = others.length ? others : eligible;
    const picked = pickCandidate(pool);
    if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
    return { type: "CASUAL_CHAT", deploymentId: picked.deploymentId, reasons: ["moderator_handoff_request"] };
  }

  if (kind === "TRIVIAL") {
    if (RESOLVED_ACK_RE.test(trimmed)) {
      const picked = pickCandidate(eligible);
      if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
      return { type: "REACT", deploymentId: picked.deploymentId, emoji: "👍", reasons: ["resolution_acknowledged"] };
    }
    // An upbeat short closing ("okay, perfect!", "great, thanks!") gets a
    // reaction regardless of whether it's directed — a human moderator
    // smiles/reacts to "perfect!", they don't write a new sentence back.
    // Checked before the directed/ambient split below on purpose.
    if (POSITIVE_WORD_RE.test(trimmed)) {
      const picked = pickCandidate(eligible);
      if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
      return { type: "REACT", deploymentId: picked.deploymentId, emoji: positiveReactionFor(trimmed), reasons: ["positive_closing_acknowledged"] };
    }
    const directed = eligible.find((c) => c.isDirectedAtBot);
    if (!directed) {
      if (!eligible.length) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
      return { type: "SILENCE", reasons: input.recentlyAnsweredByModerator ? ["already_handled_recent_reply"] : ["trivial_low_value"] };
    }
    if (LAUGH_RE.test(trimmed) || THANKS_RE.test(trimmed)) {
      return { type: "REACT", deploymentId: directed.deploymentId, emoji: reactionFor(trimmed), reasons: ["directed_trivial_acknowledgement"] };
    }
    return { type: "SHORT_ACK", deploymentId: directed.deploymentId, reasons: ["directed_trivial_ack"] };
  }

  if (kind === "COMMUNITY_OPENER") {
    if (input.recentlyAnsweredByModerator || input.recentlyRespondedByHuman) {
      return { type: "SILENCE", reasons: ["already_handled"] };
    }
    const picked = pickCandidate(eligible);
    if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
    return { type: "CASUAL_CHAT", deploymentId: picked.deploymentId, reasons: ["community_opener", "unanswered", "moderator_available"] };
  }

  if (kind === "QUESTION") {
    // Directed (an explicit @mention of THIS candidate) wins over mere
    // continuity — a deliberate signal from the human beats "who was
    // already talking." pickCandidate already orders directed > continuity
    // > quietest-longest.
    const picked = pickCandidate(eligible);
    if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
    return { type: "ANSWER", deploymentId: picked.deploymentId, reasons: ["substantive_question", "requires_information"] };
  }

  // SUBSTANTIVE — a non-question, non-trivial, non-opener statement. Only
  // engage when it's directed at a specific candidate or continues an
  // active exchange with one — a plain ambient statement with neither
  // signal is weak on its own and stays silent, same as before. When a
  // signal DOES exist, pickCandidate's directed > continuity ordering
  // decides who: an explicit mention of a specific other moderator must
  // win over whoever merely spoke last.
  if (!eligible.some((c) => c.isDirectedAtBot || c.wasLastSpeaker)) {
    return { type: "SILENCE", reasons: ["low_social_priority"] };
  }
  const picked = pickCandidate(eligible);
  if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
  return {
    type: "CASUAL_CHAT",
    deploymentId: picked.deploymentId,
    reasons: [picked.isDirectedAtBot ? "directed_casual" : "active_conversation_continuity"],
  };
}
