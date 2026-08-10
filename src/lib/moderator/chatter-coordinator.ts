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

// Question/request intent, including HEADLESS questions with no trailing
// "?" ("who else", "why though", "what happened", "anyone else") -- these
// must be recognized on their own semantic terms, never inferred merely from
// the absence of a "?". Checked BEFORE any trivial/closing classification
// (see classifyMessageKind) so a short question can never be swallowed as
// filler just because it's short -- intent outranks length structurally,
// not via a per-case exception.
function isLikelyQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  // A "?" ANYWHERE in the message signals question intent, not only when
  // it's the very last character -- a misplaced "?" (leading, via a
  // fat-fingered/mobile-keyboard typo, e.g. "?just testing things, what's
  // up") is still the human typing a question mark; requiring it exactly at
  // the end silently dropped the message to a lower-priority classification
  // (live bug: fell through to a bare conversational-opener match instead
  // of QUESTION, then got suppressed as "already handled").
  if (t.includes("?")) return true;
  return /^(who|what|when|where|why|how|which|does|do|is|are|can|could|should|would|will|anyone|anybody|someone)\b/.test(t);
}

// ---- signals feeding isConversationalOpener ----

// A presence-check ("anyone here?", "how's everyone doing?", "quiet in here
// today") -- reused directly by classifyMessageKind below to give opener
// detection precedence over the generic "ends with ?" question heuristic,
// without isConversationalOpener itself needing to know anything about
// questions.
const COMMUNITY_CHECK_IN_RE =
  /\bhow(?:'s|s|\s+is)\s+(?:everyone|everything)\b|\bwhat(?:'s|s|\s+is)\s+everyone\s+(?:up\s+to|doing)\b|\banyone\s+(?:doing\s+anything|around|here)\b|\bquiet\s+(?:in\s+here|today)\b/i;
// Greeting/salutation + informal attention-getters -- one signal among
// several combined in isConversationalOpener below.
const GREETING_RE = /\b(gm|good\s*morning|good\s*evening|good\s*afternoon|morning|evening|hey|hi|hello|yo|sup|what'?s\s*up)\b/i;
// Re-entry framing doesn't require a greeting word at all ("I'm back",
// "back again", bare "again" on its own).
const RE_ENTRY_RE = /\b(?:i'?m\s+back|back\s+again|back\s+here|back\s+in(?:\s+here)?|good\s+to\s+be\s+back)\b|\bagain\b/i;

/** Does this text carry a conversational-opener SIGNAL -- a greeting,
 *  re-entry phrase, or presence check -- the kind of language a normal
 *  participant would read as a bid to start/restart/re-enter interaction?
 *  Deliberately narrow and purely POSITIVE: this function does not decide
 *  final classification and does not know about questions, requests,
 *  problem reports, or acknowledgements -- a message can (and often does)
 *  carry an opener signal AND something stronger ("hey, why is my order
 *  stuck?" plainly opens with a greeting). Precedence between opener and
 *  those other classifications is classifyMessageKind's job, reusing the
 *  SAME canonical classifiers (isLikelyQuestion, hasProblemWord, the
 *  existing trivial/acknowledgement checks) via ordering -- not duplicated
 *  here. Never depends on room activity/quietness/who-spoke-last (that's a
 *  response-selection concern, handled downstream in selectChatterAction's
 *  COMMUNITY_OPENER branch), and never on message length. */
export function isConversationalOpener(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return COMMUNITY_CHECK_IN_RE.test(t) || RE_ENTRY_RE.test(t) || GREETING_RE.test(t);
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
// Bounded by WORD COUNT only, not character length -- a raw character cap
// was the fragile heuristic that missed "okay, perfect!" originally, and
// would still miss slightly longer variants like "that's fantastic!" (17
// chars, still just 2 words) if used here. A short closing that carries a
// positive word is flagged regardless of how long those words are; a
// genuinely longer sentence that happens to mention "great" mid-paragraph
// (5+ words) is not a closing and stays SUBSTANTIVE. Never reached at all
// for anything ending in "?" -- see classifyMessageKind, which checks
// question intent first.
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

// ---------------------------------------------------------------------
// Broader closing/acknowledgement detection. LENGTH IS NOT A VALID SIGNAL
// for "does this introduce a new conversational obligation" -- a live bug
// ("prettyaccurate too. lol", 3 words / 23 chars, following a moderator's
// joke) proved no fixed word-count or character cap can ever separate a
// legitimately long acknowledgement ("yeah lol that's actually pretty
// accurate") from a genuinely substantive statement of similar length
// ("yeah but production is still returning 500s after the deploy"). This
// asks instead whether the message is semantically just agreement/approval/
// laughter/thanks/closing sentiment with no new question, request, problem
// report, or claim -- checked via explicit vocabulary (contrast/request/
// problem-word markers), NOT by counting how much text is "left over" after
// stripping filler. A single leftover word is not assumed safe by default --
// see PROBLEM_WORD_RE / isKnownConcatenation below for why.
// ---------------------------------------------------------------------

/** Agreement, approval, laughter, thanks, or closing-sentiment words --
 *  carry no NEW information on their own. */
const ACK_TOKENS = new Set([
  "yeah", "yep", "yup", "yes", "nah", "nope", "right", "true", "same", "exactly",
  "agreed", "totally", "definitely", "absolutely", "indeed", "relatable",
  "accurate", "correct", "valid", "fair", "hilarious", "funny", "nice", "sweet",
  "great", "perfect", "awesome", "amazing", "excellent", "fantastic", "glad",
  "good", "fine", "cool", "noted", "understood", "understand", "ok", "okay",
  "alright", "makes", "sense", "sounds", "enough", "appreciate", "appreciated",
  "thanks", "thank", "thankyou", "thx", "ty", "cheers", "lol", "lmao", "lel",
  "rofl", "get", "got",
]);
/** Discourse filler / stopwords -- neutral either way, stripped before
 *  checking what's actually left. Deliberately does NOT include verbs like
 *  "have"/"is"/"need" that commonly introduce genuinely new content. */
const NEUTRAL_TOKENS = new Set([
  "too", "now", "then", "so", "well", "honestly", "basically", "pretty",
  "really", "super", "very", "actually", "just", "a", "an", "the", "i", "you",
  "we", "they", "it", "he", "she", "s", "to", "me", "for", "what", "how",
  "why", "that", "this",
]);
const LAUGH_TOKEN_RE = /^h?a?(?:ha)+h?$/;

function isAckOrNeutralToken(token: string): boolean {
  return ACK_TOKENS.has(token) || NEUTRAL_TOKENS.has(token) || LAUGH_TOKEN_RE.test(token);
}

// A contrast/continuation marker anywhere in the message is treated as an
// unconditional signal that the human is adding something beyond a closing
// acknowledgement. Deliberately NOT scoped to "only when followed by
// substantive content" -- under-detecting a closing is a harmless miss (the
// bot just replies normally instead of reacting), while over-detecting one
// and silencing genuinely new content is exactly the failure mode this fix
// exists to eliminate.
const CONTINUATION_MARKER_RE = /\b(but|however|though|although|except|still|also)\b/i;
// An explicit request/action ask is never a pure acknowledgement, even
// without a trailing "?".
const REQUEST_MARKER_RE = /\b(can|could|would)\s+(you|we)\b|\bplease\b/i;
// Negative-state / problem vocabulary is ALWAYS treated as substantive,
// regardless of how few residual tokens are left over. A single word like
// "broken"/"error"/"down" is exactly the kind of one-token residue that
// must never be waved through just because there's "only one leftover
// token" -- this explicit vocabulary is the actual decisive check for that
// case; residual token COUNT (below) is only a weak fallback signal for
// leftover words that aren't a known problem term, never the deciding
// factor on its own. Matched by STEM/PREFIX (token.startsWith(stem)), not a
// word-boundary-anchored regex -- an exact-form regex like
// /\bfail(?:s|ed|ing)?\b/ silently misses "failure" (no word boundary right
// after "fail" inside it), which would otherwise fall back to the residual-
// count tolerance and get waved through. A stem match is deliberately
// over-inclusive (e.g. "downtown" also starts with "down") -- that's the
// SAFE direction: worst case an unrelated word makes the bot reply for real
// instead of reacting, never the reverse (silencing real new content).
const PROBLEM_STEMS = [
  "broken", "broke", "breaking", "fail", "down", "error", "bug", "crash",
  "issue", "problem", "stuck", "glitch", "outage", "wrong", "incorrect",
];
function hasProblemWord(tokens: string[]): boolean {
  return tokens.some((t) => PROBLEM_STEMS.some((stem) => t.startsWith(stem)));
}
const NOT_WORKING_RE = /\b(not|isn'?t|doesn'?t|won'?t|can'?t)\s+work(?:ing)?\b/i;

/** True when `token` is fully composed of a sequence of ACK_TOKENS/
 *  NEUTRAL_TOKENS words back-to-back with no leftover characters -- catches
 *  a casually glued-together closing like "prettyaccurate" ("pretty" +
 *  "accurate", a live-observed typo with no space) as recognized content,
 *  WITHOUT resorting to a blanket "tolerate any 1 unknown token" rule that
 *  would also wave through a genuine one-word problem report like "broken"
 *  (which has no such decomposition). Each matched piece must be 2+
 *  characters so single-letter neutral tokens ("a", "i", "s") can't trivially
 *  "decompose" an arbitrary word. */
function isKnownConcatenation(token: string): boolean {
  if (token.length < 4) return false;
  const reachable = new Array(token.length + 1).fill(false);
  reachable[0] = true;
  for (let end = 1; end <= token.length; end++) {
    for (let start = 0; start < end; start++) {
      if (!reachable[start]) continue;
      const piece = token.slice(start, end);
      if (piece.length >= 2 && isAckOrNeutralToken(piece)) {
        reachable[end] = true;
        break;
      }
    }
  }
  return reachable[token.length];
}

/** True when a message is PURELY acknowledgement/agreement/laughter/thanks/
 *  closing sentiment -- no new question, request, problem report, or claim
 *  -- no matter how many words it took to say so. The decisive checks are
 *  semantic (contrast/request/problem vocabulary, checked first and
 *  unconditionally); residual token count is only consulted afterward, as a
 *  weak fallback for otherwise-unclassifiable leftover words ("thanks for
 *  explaining", "that's what I meant") -- it never overrides an explicit
 *  problem/contrast/request/question signal, and a single leftover token is
 *  NOT automatically assumed safe (see isKnownConcatenation / hasProblemWord). */
function isAcknowledgementOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return false; // let QUESTION classification handle it
  if (CONTINUATION_MARKER_RE.test(trimmed)) return false;
  if (REQUEST_MARKER_RE.test(trimmed)) return false;
  if (NOT_WORKING_RE.test(trimmed)) return false;
  const tokens = tokenize(trimmed);
  if (!tokens.length) return false;
  if (hasProblemWord(tokens)) return false;
  // RESOLVED_ACK_RE ("fixed", "solved", "nvm", "figured it out", ...) is its
  // own acknowledgement vocabulary, reused here rather than duplicated into
  // ACK_TOKENS -- these words (esp. "fixed"/"working") are common enough in
  // ordinary substantive sentences that adding them to the general-purpose
  // token set would risk misclassifying unrelated content; matching the
  // same precise phrase list selectChatterAction's REACT branch already
  // uses keeps the two in lockstep.
  const hasSignal = tokens.some((t) => ACK_TOKENS.has(t) || LAUGH_TOKEN_RE.test(t)) || RESOLVED_ACK_RE.test(trimmed);
  if (!hasSignal) return false;
  const residual = tokens.filter((t) => !isAckOrNeutralToken(t) && !isKnownConcatenation(t));
  // Weak fallback only -- real substantive content is already excluded
  // above by explicit vocabulary, not by counting leftover words. This just
  // tolerates a couple of otherwise-unclassifiable filler words without
  // opening the door to a long genuinely new statement that merely happens
  // to start with "yeah"/"lol".
  return residual.length <= 2;
}

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

// A name mention immediately preceded by one of these reads as REFERENCE
// ("why did Test answer for Kwan?", "I think Kwan already answered", "does
// Kwan know about this?") -- the person is being discussed, not addressed.
// This always wins, even when the name sits at a message's edge ("...for
// Kwan?") -- "for X"/"about X" is never a real vocative regardless of
// position. Live bug: "why are you responding for kwan though?" resolved to
// Kwan (name mentioned) when the actual addressee -- signaled by "you"
// immediately after the prior speaker, Test -- was Test.
const REFERENTIAL_PRECEDING_TOKENS = new Set([
  "for", "about", "to", "from", "on", "behalf",
  "did", "does", "is", "was", "has", "have", "will", "would", "could", "should",
  "answer", "answered", "answering", "respond", "responded", "responding",
  "reply", "replied", "replying", "speaking", "speak",
  "think", "thinks", "thought", "know", "knows", "knew", "said", "says", "saying",
]);
// A name mention immediately preceded by one of these reads as a genuine
// direct ADDRESS ("hey Kwan", "are you Kwan?") -- second-person framing.
const VOCATIVE_PRECEDING_TOKENS = new Set(["hey", "hi", "yo", "hello", "you"]);

/** True when the name-token at `tokens[idx]` reads as a direct address to
 *  that person rather than a third-person mention of them. Mentioning a
 *  name does not by itself make that person the addressee — distinguishes
 *  "kwan, what do you think?" / "what persona are you kwan?" (address) from
 *  "why are you responding for kwan though?" / "I think Kwan already
 *  answered" (reference). A referential preceding word always wins, even at
 *  an edge position, since "for X" is never a real vocative. */
function isVocativeOccurrence(tokens: string[], idx: number): boolean {
  const prev = idx > 0 ? tokens[idx - 1] : null;
  if (prev && REFERENTIAL_PRECEDING_TOKENS.has(prev)) return false;
  if (tokens.length === 1) return true; // the whole message is just the name
  if (idx === 0) return true; // "kwan, ..." / "kwan what do you think?"
  if (prev && VOCATIVE_PRECEDING_TOKENS.has(prev)) return true; // "hey kwan" / "are you kwan"
  return false;
}

/** A comma directly before a name ("tell me, kwan", "okay, test, waddup?",
 *  "well, kwan, why is this happening") is an unambiguous vocative tag in
 *  natural written English regardless of what precedes the comma OR what
 *  follows the name — this is a positional/structural signal, not a
 *  phrase-list one, so it generalizes to any informal wording around it
 *  without needing to recognize the surrounding words at all. Live bug:
 *  "okay, test, waddup?" (name flanked by commas in the MIDDLE of the
 *  message) wasn't recognized as addressing Test at all -- the prior fix
 *  only covered a comma-preceded name at the very END of the message.
 *  Punctuation is stripped by tokenize(), so this needs the ORIGINAL text,
 *  not the token array. Escapes `name` since it's interpolated into a RegExp. */
function commaPrecededVocative(lowerText: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`,\\s*${escaped}\\b`, "i").test(lowerText);
}

/** Resolves which (if any) deployment a message explicitly ADDRESSES — by
 *  @username, by its own configured display name used vocatively, or by a
 *  typo-tolerant near-spelling of that name used vocatively. A referential
 *  mention of the name (discussing that person, not speaking to them) does
 *  NOT count — see isVocativeOccurrence. Word-boundary-safe (tokenized,
 *  never substring) so a moderator named "Ann" is never triggered by
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

  const exact = moderators.filter((m) =>
    tokenize(m.name).some(
      (nt) => tokens.some((t, idx) => t === nt && isVocativeOccurrence(tokens, idx)) || commaPrecededVocative(lower, nt)
    )
  );
  if (exact.length === 1) return { deploymentId: exact[0].deploymentId, isTypo: false };
  if (exact.length > 1) return null; // ambiguous -- don't guess

  const fuzzy = moderators.filter((m) =>
    tokenize(m.name).some((nt) => tokens.some((t, idx) => isFuzzyNameToken(t, nt) && isVocativeOccurrence(tokens, idx)))
  );
  if (fuzzy.length === 1) return { deploymentId: fuzzy[0].deploymentId, isTypo: true };
  return null; // no match, or an ambiguous fuzzy match across multiple moderators
}

type MessageKind = "EMPTY" | "TOO_SHORT" | "COMMUNITY_OPENER" | "TRIVIAL" | "QUESTION" | "SUBSTANTIVE";

/** Classification order is the actual architecture here, not an
 *  implementation detail: QUESTION/request intent is decided BEFORE any
 *  trivial/closing check gets a turn, so a real question can never be
 *  swallowed as filler just because it's short. There is no independent
 *  length-based "isTrivial" fallback anymore -- TRIVIAL is decided purely
 *  semantically (isAcknowledgementOnly / CLOSING_ACK_RE / isPositiveClosing),
 *  each of which already excludes anything carrying a question, request,
 *  contrast, or problem signal. Length is never the decisive reason a
 *  message is treated as trivial; at most it's a soft bound inside those
 *  semantic checks (e.g. isAcknowledgementOnly's residual-token tolerance).
 *
 *  isConversationalOpener() is a purely POSITIVE signal (see its own doc
 *  comment) -- it does not know about questions/requests/problems/
 *  acknowledgements, so a message that's ALSO one of those (e.g. "hey, why
 *  is my order stuck?") needs precedence decided HERE, by ordering, reusing
 *  the SAME canonical classifiers rather than duplicating their logic:
 *    1. A presence-check ("anyone here?") is opener territory even though
 *       it's ALSO question-shaped -- COMMUNITY_CHECK_IN_RE is a more
 *       specific signal than the generic isLikelyQuestion heuristic, so
 *       it's checked first.
 *    2. A real question, then a problem report, then an acknowledgement/
 *       closure, each outrank a bare greeting/re-entry word that happens to
 *       also be present ("it broke again" stays SUBSTANTIVE, not opener;
 *       "hey thanks, that fixed it" stays TRIVIAL, not opener).
 *    3. Only once none of those claim the message does a real opener
 *       signal (greeting/re-entry, or a presence-check already handled in
 *       step 1) resolve to COMMUNITY_OPENER. */
function classifyMessageKind(trimmed: string): MessageKind {
  if (!trimmed) return "EMPTY";
  if (trimmed.length < 2) return "TOO_SHORT";
  if (COMMUNITY_CHECK_IN_RE.test(trimmed)) return "COMMUNITY_OPENER";
  if (isLikelyQuestion(trimmed)) return "QUESTION";
  if (hasProblemWord(tokenize(trimmed)) || NOT_WORKING_RE.test(trimmed)) return "SUBSTANTIVE";
  if (CLOSING_ACK_RE.test(trimmed) || isPositiveClosing(trimmed) || isAcknowledgementOnly(trimmed)) return "TRIVIAL";
  if (isConversationalOpener(trimmed)) return "COMMUNITY_OPENER";
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

/* ================================== ambient-greeting model fallback ==========
   Deterministic classification (isConversationalOpener + everything above)
   cannot recognize a message like "waddup guys" as a greeting -- it's a
   phonetic respelling of "what's up" with no punctuation/positional signal
   connecting the two spellings, unlike the "?" anywhere / comma-flanked-name
   signals that already make other cases orthography-agnostic. Building a
   hand-tuned pattern for this one phonetic family would just be the same
   brittle lexical patch in regex form. Per explicit product decision, this
   narrow gap is covered by an OPTIONAL, cheap model-assisted classification
   call (DeepSeek Flash, yes/no only, see chatter-generate.ts
   classifyAmbientGreeting) -- gated as tightly as possible so it only ever
   fires on the exact residual bucket nothing deterministic could resolve.
   selectChatterAction() itself stays pure/synchronous/AI-free; this fallback
   lives entirely in community-runtime.ts's already-async dispatch, calling
   the two pure helpers below before/after the model call. ================ */

/** Narrow gate for even ATTEMPTING the fallback classifier call -- only the
 *  exact "low_social_priority" SILENCE (ambient, non-directed, no
 *  continuity, nothing deterministic matched) on a SHORT message. A long
 *  ambient statement landing in this bucket is very unlikely to be a
 *  misspelled greeting, so length keeps the fallback rare and cheap rather
 *  than firing on every silence. */
export function isAmbientOpenerFallbackCandidate(action: ChatterAction, text: string): boolean {
  if (action.type !== "SILENCE") return false;
  if (!action.reasons.includes("low_social_priority")) return false;
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 8;
}

/** Called ONLY after the model fallback has confirmed a message that failed
 *  every deterministic signal genuinely functions as a greeting/social bid.
 *  Mirrors selectChatterAction's COMMUNITY_OPENER branch exactly (same
 *  already_handled suppression, same candidate selection) -- this is not a
 *  new action category, just a second-pass entry into the same handling,
 *  reached via model confirmation instead of a regex match. */
export function resolveAmbientOpenerFallback(input: ChatterActionInput): ChatterAction {
  const eligible = input.candidates.filter((c) =>
    candidateEligible(c.pacing, input.now, bypassesPacing("COMMUNITY_OPENER", c.isDirectedAtBot, c.wasLastSpeaker))
  );
  if (input.recentlyAnsweredByModerator || input.recentlyRespondedByHuman) {
    return { type: "SILENCE", reasons: ["already_handled"] };
  }
  const picked = pickCandidate(eligible);
  if (!picked) return { type: "SILENCE", reasons: ["no_eligible_moderator"] };
  return { type: "CASUAL_CHAT", deploymentId: picked.deploymentId, reasons: ["ambient_greeting_model_confirmed", "unanswered", "moderator_available"] };
}
