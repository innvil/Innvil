/* =========================================================
   Reactive Natural Chatter — contextual social-action selection (pure, no
   AI, no I/O).

   NOT modeled as "response probability." SILENCE is a first-class action
   that competes against engaging, based on conversation context — whether
   the message is directed at the bot, question-shaped, substantive vs
   trivial, and whether the bot itself just spoke — not a coin flip applied
   uniformly to every message regardless of content. Signals combine into a
   priority band, and randomness is confined to the ambiguous MEDIUM band
   only: it adds natural variation among already-plausible moments, it never
   decides whether an otherwise inappropriate response happens (a trivial
   ambient "lol" is hard-silenced; a substantive directed question is
   hard-engaged — neither one is a dice roll).

   Multi-moderator: when more than one chatter-eligible deployment exists in
   a community, the Coordinator scores each independently, then picks AT
   MOST ONE responder for the whole event and rolls the dice exactly once
   for that winner — it never runs a separate probability roll per
   deployment (that would let several moderators all "coincidentally" reply
   to the same message). A direct mention of one specific moderator makes
   that deployment's own score dominate the others via the DIRECTED weight,
   without hardcoding "only the mentioned bot may ever answer."

   The AI call itself (chatter-generate.ts) still gets the final say on
   anything that reaches it — this module's job is deciding whether it's
   even worth asking the model, and which deployment should ask, not writing
   the reply.
   ========================================================= */

export interface ChatterPacingState {
  lastSpokeAt: string | null;
  /** How many of the deployment's own messages in a row happened without an
   *  intervening human message — caps how much the bot can dominate a thread. */
  consecutiveMessages: number;
}

export type ChatterPriority = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

/** Minimum gap between the bot's own ambient messages — directed messages bypass this. */
const MIN_REPLY_GAP_MS = 20_000;
/** Cap on the bot replying to itself/back-to-back without an intervening human message — directed messages bypass this too. */
const MAX_CONSECUTIVE_BOT_MESSAGES = 2;

// Scoring weights. These combine into a priority band (see priorityBand
// below) — no single weight is meant to be decisive on its own.
const DIRECTED_WEIGHT = 5;
const QUESTION_WEIGHT = 3;
const SUBSTANTIVE_WEIGHT = 1;
const TRIVIAL_PENALTY = -3;
// A human continuing an active 1:1 exchange with THIS specific deployment
// (no @mention needed — it's the natural next line in a thread this
// candidate itself is part of) is a strong signal THIS candidate should
// answer, not whichever OTHER deployment has simply been quietest. Without
// this, the tie-break ("quietest longest") actively works against whoever's
// actually mid-conversation, producing a visible bug: a different moderator
// jumps in and answers as if IT were the one being addressed.
const CONTINUITY_WEIGHT = 4;
// A genuine room-directed social opener ("good evening everyone, how's
// everyone doing?") is a DIFFERENT kind of value than a factual/support
// question, not a lesser one — a human moderator naturally engages with it.
// It must not be lost to a probability roll just because it isn't a
// "substantive question" in the factual sense, and it must not be treated
// as trivial filler just because it's short ("gm guys").
const COMMUNITY_OPENER_WEIGHT = 5;
// "Recently answered" only means "the message right before this one, in this
// same thread, came from a moderator" — it does NOT mean "this new message is
// about the same thing," and it's especially NOT evidence that an ACTIVE,
// ongoing conversation has been resolved. A trivial follow-up right then
// ("ok", "lol", "thanks") really is redundant chatter and should stay
// hard-silenced. A genuinely new, substantive question right then competes
// on its own normal signals with NO penalty — a live back-and-forth
// ("what's up" -> "just here thinking about X, any update on your side?")
// is the single clearest case of a message actually meant for the room, not
// a moment to hesitate on.
const RECENTLY_ANSWERED_PENALTY_TRIVIAL = -3;

/** Only MEDIUM is a real coin flip. LOW never engages (score alone decided
 *  it); VERY_HIGH always engages; HIGH is near-certain — a small amount of
 *  variation, not a 50/50, so it never reads as mechanical either way. */
const ENGAGE_PROBABILITY_BY_PRIORITY: Record<ChatterPriority, number> = {
  VERY_HIGH: 1,
  HIGH: 0.85,
  MEDIUM: 0.35,
  LOW: 0,
};

function isLikelyQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.endsWith("?")) return true;
  return /^(who|what|when|where|why|how|does|do|is|are|can|could|should|would|will)\b/.test(t);
}

/** Trivial = low-content chatter ("lol", "nice", "ok", "thanks") — it can
 *  still earn a reply given strong enough surrounding context (e.g. directed
 *  at the bot), but it never earns one purely on its own. */
function isTrivial(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= 2 && text.trim().replace(/[!?.]+$/, "").length <= 12;
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
 *  it also addresses the room ("gm guys", not just "gm") — a plain greeting
 *  with no room-address term stays ordinary trivial chatter. */
function isCommunityOpener(text: string): boolean {
  const t = text.trim();
  if (COMMUNITY_CHECK_IN_RE.test(t)) return true;
  return GREETING_RE.test(t) && COMMUNITY_ADDRESS_RE.test(t);
}

function priorityBand(score: number): ChatterPriority {
  if (score >= 8) return "VERY_HIGH";
  if (score >= 4) return "HIGH";
  if (score >= 1) return "MEDIUM";
  return "LOW";
}

interface CandidateScore {
  eligible: boolean;
  priority: ChatterPriority;
  /** Raw signal total, before banding — bands are coarse (e.g. both a
   *  directed message and a continuity-boosted one can land in VERY_HIGH),
   *  so this breaks ties WITHIN a band before falling back to "quietest
   *  longest," instead of discarding a real scoring difference. */
  score: number;
  hardBlockReason: "AVOID_DOMINATING_CONVERSATION" | "COOLDOWN" | null;
}

/** Scores ONE deployment's candidacy to respond. Pure, no RNG — the
 *  probability roll happens once, later, only for the overall winner. */
function scoreCandidate(input: {
  isDirectedAtBot: boolean;
  wasLastSpeaker: boolean;
  pacing: ChatterPacingState;
  now: Date;
  recentlyAnsweredByModerator?: boolean;
  likelyQuestion: boolean;
  trivial: boolean;
  communityOpener: boolean;
}): CandidateScore {
  const directed = input.isDirectedAtBot;

  let score = 0;
  if (directed) score += DIRECTED_WEIGHT;
  if (input.wasLastSpeaker) score += CONTINUITY_WEIGHT;
  if (input.likelyQuestion) score += QUESTION_WEIGHT;
  if (input.communityOpener) {
    // A room-directed social opener is never "filler" just because it's
    // short ("gm guys") — it gets the substantive weight regardless of the
    // trivial-length heuristic, plus its own opener weight on top.
    score += SUBSTANTIVE_WEIGHT + COMMUNITY_OPENER_WEIGHT;
  } else {
    score += input.trivial ? TRIVIAL_PENALTY : SUBSTANTIVE_WEIGHT;
  }
  if (input.recentlyAnsweredByModerator && input.trivial && !input.communityOpener) {
    score += RECENTLY_ANSWERED_PENALTY_TRIVIAL;
  }
  const priority = priorityBand(score);

  const overParticipating = input.pacing.consecutiveMessages >= MAX_CONSECUTIVE_BOT_MESSAGES;
  const cooldownActive = !!input.pacing.lastSpokeAt && input.now.getTime() - new Date(input.pacing.lastSpokeAt).getTime() < MIN_REPLY_GAP_MS;

  // Pacing safety valves exist to stop the bot from flooding the room with
  // low-value ambient chatter — they don't apply to a directed message (still
  // responsive when addressed directly), nor to a genuinely HIGH/VERY_HIGH
  // ambient one (a real question, something substantive): a present,
  // attentive human moderator still answers a real question even seconds
  // after they last spoke, they just don't keep chiming in on filler.
  const bypassPacing = directed || priority === "HIGH" || priority === "VERY_HIGH";
  if (overParticipating && !bypassPacing) return { eligible: false, priority: "LOW", score, hardBlockReason: "AVOID_DOMINATING_CONVERSATION" };
  if (cooldownActive && !bypassPacing) return { eligible: false, priority: "LOW", score, hardBlockReason: "COOLDOWN" };

  return { eligible: priority !== "LOW", priority, score, hardBlockReason: null };
}

export interface ChatterCandidate {
  deploymentId: string;
  /** True if this message replies to THIS deployment's own previous message, or @mentions it. */
  isDirectedAtBot: boolean;
  /** True if the message immediately before this one, in the community's
   *  recent context, was sent by THIS deployment specifically — i.e. this
   *  candidate is mid an active 1:1 exchange with the human. Without this,
   *  ties break toward whoever's been quietest, which actively favors a
   *  DIFFERENT moderator jumping into a conversation it wasn't part of. */
  wasLastSpeaker: boolean;
  pacing: ChatterPacingState;
}

export interface ChatterSelectionInput {
  text: string;
  candidates: ChatterCandidate[];
  now: Date;
  /** True when the message immediately before this one in the community's
   *  recent context was itself sent by an Innvil moderator (any of them) —
   *  signals the exchange may already be handled. */
  recentlyAnsweredByModerator?: boolean;
  /** Injectable RNG (0 <= x < 1) so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
}

export type ChatterSelectionResult =
  | { proceed: true; deploymentId: string; reasonCode: "DIRECTED" | "AMBIENT_OPPORTUNITY"; priority: ChatterPriority }
  | {
      proceed: false;
      /** The deployment that would have responded, if the final roll hadn't
       *  failed (PROBABILITY_GATE) — null when no candidate was even in the
       *  running (EMPTY_MESSAGE/TOO_SHORT/NO_ELIGIBLE_CANDIDATE). */
      deploymentId: string | null;
      reasonCode: "EMPTY_MESSAGE" | "TOO_SHORT" | "NO_ELIGIBLE_CANDIDATE" | "PROBABILITY_GATE";
      priority: ChatterPriority;
    };

/** Selects AT MOST ONE deployment to respond to a human message, out of
 *  however many chatter-eligible deployments are active in the community.
 *  Scoring is independent per candidate; selection and the (single)
 *  probability roll are not — see file header. */
export function selectChatterResponder(input: ChatterSelectionInput): ChatterSelectionResult {
  const random = input.random ?? Math.random;
  const trimmed = input.text.trim();

  if (!trimmed) return { proceed: false, deploymentId: null, reasonCode: "EMPTY_MESSAGE", priority: "LOW" };
  if (trimmed.length < 2) return { proceed: false, deploymentId: null, reasonCode: "TOO_SHORT", priority: "LOW" };

  const likelyQuestion = isLikelyQuestion(trimmed);
  const trivial = isTrivial(trimmed);
  const communityOpener = isCommunityOpener(trimmed);

  const scored = input.candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate({
        isDirectedAtBot: candidate.isDirectedAtBot,
        wasLastSpeaker: candidate.wasLastSpeaker,
        pacing: candidate.pacing,
        now: input.now,
        recentlyAnsweredByModerator: input.recentlyAnsweredByModerator,
        likelyQuestion,
        trivial,
        communityOpener,
      }),
    }))
    .filter((c) => c.score.eligible);

  if (scored.length === 0) return { proceed: false, deploymentId: null, reasonCode: "NO_ELIGIBLE_CANDIDATE", priority: "LOW" };

  // Highest priority band wins first. A direct mention of one specific
  // moderator dominates via its score (+5), not a hardcoded "only the
  // mentioned bot may answer" rule — an ambient VERY_HIGH-scoring candidate
  // could still theoretically outrank a barely-directed one, which is the
  // intended "signal, not requirement" behavior. Bands are coarse though
  // (e.g. both a directed message and a continuity-boosted one can land in
  // VERY_HIGH) — within the same band, the higher RAW score wins next, so a
  // real scoring difference isn't discarded just because both cleared the
  // same threshold. Only a genuine tie in both band and raw score falls back
  // to whoever has been quietest longest, so engagement naturally spreads
  // across moderators instead of always landing on the same one.
  const priorityRank: Record<ChatterPriority, number> = { VERY_HIGH: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
  scored.sort((a, b) => {
    const byPriority = priorityRank[b.score.priority] - priorityRank[a.score.priority];
    if (byPriority !== 0) return byPriority;
    const byScore = b.score.score - a.score.score;
    if (byScore !== 0) return byScore;
    const aSpoke = a.candidate.pacing.lastSpokeAt ? new Date(a.candidate.pacing.lastSpokeAt).getTime() : 0;
    const bSpoke = b.candidate.pacing.lastSpokeAt ? new Date(b.candidate.pacing.lastSpokeAt).getTime() : 0;
    return aSpoke - bSpoke;
  });

  const winner = scored[0];
  const probability = ENGAGE_PROBABILITY_BY_PRIORITY[winner.score.priority];
  if (probability < 1 && random() > probability) {
    return { proceed: false, deploymentId: winner.candidate.deploymentId, reasonCode: "PROBABILITY_GATE", priority: winner.score.priority };
  }

  return {
    proceed: true,
    deploymentId: winner.candidate.deploymentId,
    reasonCode: winner.candidate.isDirectedAtBot ? "DIRECTED" : "AMBIENT_OPPORTUNITY",
    priority: winner.score.priority,
  };
}
