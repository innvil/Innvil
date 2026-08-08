/* =========================================================
   Reactive Natural Chatter — deterministic pre-filter (pure, no AI, no I/O).
   "Silence must be a first-class action. Most ordinary messages should NOT
   necessarily produce a bot reply." This gate decides whether a HUMAN message
   is even WORTH considering for an AI-generated reply — most messages should
   fail this gate and never reach an AI call at all (cost control + avoiding
   annoying-chatbot behavior are the same mechanism here).

   The AI call itself (chatter-generate.ts) gets the final say too — even a
   message that passes this gate can still resolve to no reply, e.g. because
   two humans are clearly already talking to each other. This gate's job is
   just to keep the common case (ordinary chatter) from ever reaching AI.
   ========================================================= */

export interface ChatterPacingState {
  lastSpokeAt: string | null;
  /** How many of the deployment's own messages in a row happened without an
   *  intervening human message — caps how much the bot can dominate a thread. */
  consecutiveMessages: number;
}

export interface ChatterGateInput {
  text: string;
  /** True if this message replies to the bot's own previous message, or @mentions it. */
  isDirectedAtBot: boolean;
  pacing: ChatterPacingState;
  now: Date;
  /** Injectable RNG (0 <= x < 1) so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
}

export type ChatterGateResult =
  | { proceed: true; reasonCode: "DIRECTED" | "AMBIENT_OPPORTUNITY" }
  | { proceed: false; reasonCode: "EMPTY_MESSAGE" | "TOO_SHORT" | "AVOID_DOMINATING_CONVERSATION" | "COOLDOWN" | "PROBABILITY_GATE" };

/** Minimum gap between the bot's own messages in the same deployment, for ambient (non-directed) chatter. */
const MIN_REPLY_GAP_MS = 20_000;
/** Cap on the bot replying to itself/back-to-back without an intervening human message. */
const MAX_CONSECUTIVE_BOT_MESSAGES = 2;
/** Most ordinary ambient messages should be ignored — this is deliberately low. */
const AMBIENT_ENGAGE_PROBABILITY = 0.15;
/** A direct reply/mention is very likely worth engaging with, but still not automatic. */
const DIRECTED_ENGAGE_PROBABILITY = 0.85;

export function evaluateChatterGate(input: ChatterGateInput): ChatterGateResult {
  const random = input.random ?? Math.random;
  const trimmed = input.text.trim();

  if (!trimmed) return { proceed: false, reasonCode: "EMPTY_MESSAGE" };
  if (trimmed.length < 2) return { proceed: false, reasonCode: "TOO_SHORT" };

  if (!input.isDirectedAtBot && input.pacing.consecutiveMessages >= MAX_CONSECUTIVE_BOT_MESSAGES) {
    return { proceed: false, reasonCode: "AVOID_DOMINATING_CONVERSATION" };
  }

  if (!input.isDirectedAtBot && input.pacing.lastSpokeAt) {
    const gap = input.now.getTime() - new Date(input.pacing.lastSpokeAt).getTime();
    if (gap < MIN_REPLY_GAP_MS) return { proceed: false, reasonCode: "COOLDOWN" };
  }

  const probability = input.isDirectedAtBot ? DIRECTED_ENGAGE_PROBABILITY : AMBIENT_ENGAGE_PROBABILITY;
  if (random() > probability) return { proceed: false, reasonCode: "PROBABILITY_GATE" };

  return { proceed: true, reasonCode: input.isDirectedAtBot ? "DIRECTED" : "AMBIENT_OPPORTUNITY" };
}
