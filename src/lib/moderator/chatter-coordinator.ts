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
const RECENTLY_ANSWERED_PENALTY = -4;

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

function priorityBand(score: number): ChatterPriority {
  if (score >= 8) return "VERY_HIGH";
  if (score >= 4) return "HIGH";
  if (score >= 1) return "MEDIUM";
  return "LOW";
}

interface CandidateScore {
  eligible: boolean;
  priority: ChatterPriority;
  hardBlockReason: "AVOID_DOMINATING_CONVERSATION" | "COOLDOWN" | null;
}

/** Scores ONE deployment's candidacy to respond. Pure, no RNG — the
 *  probability roll happens once, later, only for the overall winner. */
function scoreCandidate(input: {
  isDirectedAtBot: boolean;
  pacing: ChatterPacingState;
  now: Date;
  recentlyAnsweredByModerator?: boolean;
  likelyQuestion: boolean;
  trivial: boolean;
}): CandidateScore {
  const directed = input.isDirectedAtBot;
  const overParticipating = input.pacing.consecutiveMessages >= MAX_CONSECUTIVE_BOT_MESSAGES;
  const cooldownActive = !!input.pacing.lastSpokeAt && input.now.getTime() - new Date(input.pacing.lastSpokeAt).getTime() < MIN_REPLY_GAP_MS;

  // Pacing safety valves — a directed question still deserves an answer, so
  // these only hard-block AMBIENT chatter, matching how a present, attentive
  // human moderator behaves: still responsive when addressed directly, but
  // not flooding the room with unprompted messages.
  if (overParticipating && !directed) return { eligible: false, priority: "LOW", hardBlockReason: "AVOID_DOMINATING_CONVERSATION" };
  if (cooldownActive && !directed) return { eligible: false, priority: "LOW", hardBlockReason: "COOLDOWN" };

  let score = 0;
  if (directed) score += DIRECTED_WEIGHT;
  if (input.likelyQuestion) score += QUESTION_WEIGHT;
  score += input.trivial ? TRIVIAL_PENALTY : SUBSTANTIVE_WEIGHT;
  if (input.recentlyAnsweredByModerator) score += RECENTLY_ANSWERED_PENALTY;

  const priority = priorityBand(score);
  return { eligible: priority !== "LOW", priority, hardBlockReason: null };
}

export interface ChatterCandidate {
  deploymentId: string;
  /** True if this message replies to THIS deployment's own previous message, or @mentions it. */
  isDirectedAtBot: boolean;
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

  const scored = input.candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate({
        isDirectedAtBot: candidate.isDirectedAtBot,
        pacing: candidate.pacing,
        now: input.now,
        recentlyAnsweredByModerator: input.recentlyAnsweredByModerator,
        likelyQuestion,
        trivial,
      }),
    }))
    .filter((c) => c.score.eligible);

  if (scored.length === 0) return { proceed: false, deploymentId: null, reasonCode: "NO_ELIGIBLE_CANDIDATE", priority: "LOW" };

  // Highest priority band wins. A direct mention of one specific moderator
  // dominates via its score (+5), not a hardcoded "only the mentioned bot
  // may answer" rule — an ambient VERY_HIGH-scoring candidate could still
  // theoretically outrank a barely-directed one, which is the intended
  // "signal, not requirement" behavior. Ties broken by whoever has been
  // quietest longest, so engagement naturally spreads across moderators
  // instead of always landing on the same one.
  const priorityRank: Record<ChatterPriority, number> = { VERY_HIGH: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
  scored.sort((a, b) => {
    const byPriority = priorityRank[b.score.priority] - priorityRank[a.score.priority];
    if (byPriority !== 0) return byPriority;
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
