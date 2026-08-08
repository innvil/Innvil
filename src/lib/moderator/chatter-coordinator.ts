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

   The AI call itself (chatter-generate.ts) still gets the final say on
   anything that reaches it — this module's job is deciding whether it's
   even worth asking the model, not writing the reply.
   ========================================================= */

export interface ChatterPacingState {
  lastSpokeAt: string | null;
  /** How many of the deployment's own messages in a row happened without an
   *  intervening human message — caps how much the bot can dominate a thread. */
  consecutiveMessages: number;
}

export type ChatterPriority = "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";

export interface ChatterGateInput {
  text: string;
  /** True if this message replies to the bot's own previous message, or @mentions it. */
  isDirectedAtBot: boolean;
  pacing: ChatterPacingState;
  now: Date;
  /** True when the message immediately before this one in the community's
   *  recent context was itself sent by an Innvil moderator — signals the
   *  exchange may already be handled, independent of directed/cooldown status. */
  recentlyAnsweredByModerator?: boolean;
  /** Injectable RNG (0 <= x < 1) so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
}

export type ChatterGateResult =
  | { proceed: true; reasonCode: "DIRECTED" | "AMBIENT_OPPORTUNITY"; priority: ChatterPriority }
  | {
      proceed: false;
      reasonCode: "EMPTY_MESSAGE" | "TOO_SHORT" | "AVOID_DOMINATING_CONVERSATION" | "COOLDOWN" | "LOW_PRIORITY" | "PROBABILITY_GATE";
      priority: ChatterPriority;
    };

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

export function evaluateChatterGate(input: ChatterGateInput): ChatterGateResult {
  const random = input.random ?? Math.random;
  const trimmed = input.text.trim();
  const directed = input.isDirectedAtBot;

  if (!trimmed) return { proceed: false, reasonCode: "EMPTY_MESSAGE", priority: "LOW" };
  if (trimmed.length < 2) return { proceed: false, reasonCode: "TOO_SHORT", priority: "LOW" };

  const overParticipating = input.pacing.consecutiveMessages >= MAX_CONSECUTIVE_BOT_MESSAGES;
  const cooldownActive = !!input.pacing.lastSpokeAt && input.now.getTime() - new Date(input.pacing.lastSpokeAt).getTime() < MIN_REPLY_GAP_MS;

  // Pacing safety valves — a directed question still deserves an answer, so
  // these only hard-block AMBIENT chatter, matching how a present, attentive
  // human moderator behaves: still responsive when addressed directly, but
  // not flooding the room with unprompted messages.
  if (overParticipating && !directed) return { proceed: false, reasonCode: "AVOID_DOMINATING_CONVERSATION", priority: "LOW" };
  if (cooldownActive && !directed) return { proceed: false, reasonCode: "COOLDOWN", priority: "LOW" };

  let score = 0;
  if (directed) score += DIRECTED_WEIGHT;
  if (isLikelyQuestion(trimmed)) score += QUESTION_WEIGHT;
  score += isTrivial(trimmed) ? TRIVIAL_PENALTY : SUBSTANTIVE_WEIGHT;
  if (input.recentlyAnsweredByModerator) score += RECENTLY_ANSWERED_PENALTY;

  const priority = priorityBand(score);
  const probability = ENGAGE_PROBABILITY_BY_PRIORITY[priority];

  if (probability <= 0) return { proceed: false, reasonCode: "LOW_PRIORITY", priority };
  if (probability < 1 && random() > probability) return { proceed: false, reasonCode: "PROBABILITY_GATE", priority };

  return { proceed: true, reasonCode: directed ? "DIRECTED" : "AMBIENT_OPPORTUNITY", priority };
}
