/* =========================================================
   Community Coordinator — Innvil Moderator Acknowledgement decision (spec
   §6/§7/§8/§9/§16/§17/§19). Pure function: given a normalized CommunityEvent
   and the pacing state of eligible target deployments, decide whether (and
   how) another Innvil moderator in the SAME community may acknowledge it.

   Scope is intentionally narrow (spec §28): this coordinator ONLY ever acts
   on events whose sender is already classified INNVIL_MODERATOR (done
   upstream in community-runtime.ts). It does not implement Natural Chatter,
   moderation, or proactive mode — those are separate, not-yet-built decision
   paths that would consult this same CommunityEvent shape later.

   No AI calls anywhere in this file (spec §16) — v1 acknowledgement is
   either a reaction or a short canned/templated phrase, deterministic and
   free. Real AI-personalized handoff answers are a future increment once the
   Natural Chatter/business-knowledge pipeline exists; ROLE_HANDOFF is
   represented in the type system (event-types.ts) but this coordinator does
   not yet select it, since handoff *detection* needs that same pipeline.
   ========================================================= */

import { MAX_BOT_INTERACTION_DEPTH, type CommunityAction, type CommunityEvent } from "./event-types";
import { isConversationalOpener } from "./chatter-coordinator";

export type BotAckMode = "off" | "reactions_only" | "acknowledgements" | "role_handoffs";

/** Minimum gap between two acknowledgements FROM the same target deployment. */
const MIN_GAP_MS = 10 * 60_000;
/** Hard daily cap per target deployment, regardless of gap. */
const DAILY_CAP = 5;
/** "Occasional" — most eligible moments should still resolve to IGNORE. */
const ACK_PROBABILITY = 0.35;
/** Within an eligible acknowledgement, how often to prefer a plain reaction over a short phrase (spec §19). */
const REACT_PREFERENCE = 0.6;

export interface EligibleTarget {
  deploymentId: string;
  displayName: string;
  lastBotAckAt: string | null; // ISO
  botAcksToday: number;
  botAcksDay: string | null; // YYYY-MM-DD, the day botAcksToday was counted for
}

export interface CoordinatorInput {
  event: CommunityEvent;
  botAckMode: BotAckMode;
  /** OTHER active deployments in the SAME community — must already exclude the sender's own deployment. */
  eligibleTargets: EligibleTarget[];
  now: Date;
  /** Injectable RNG (0 <= x < 1) so tests are deterministic. Defaults to Math.random. */
  random?: () => number;
}

/** Telegram only accepts reactions from ITS OWN fixed, platform-wide emoji
 *  list for setMessageReaction -- this is NOT the same as a chat's "allow
 *  all reactions" admin setting (which just means "allow any reaction from
 *  Telegram's own list", still excluding emoji outside it). Live-verified:
 *  "👋" (waving hand) and "🙌" (raised hands) both come back
 *  `400 REACTION_INVALID` even in a chat with reactions fully open -- neither is
 *  in Telegram's supported reaction set. Every entry here has been confirmed
 *  against Telegram's actual reaction list. */
const REACT_EMOJIS = ["👍", "🎉", "👏"];

function todayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isRateLimited(target: EligibleTarget, now: Date): boolean {
  const acksToday = target.botAcksDay === todayKey(now) ? target.botAcksToday : 0;
  if (acksToday >= DAILY_CAP) return true;
  if (target.lastBotAckAt && now.getTime() - new Date(target.lastBotAckAt).getTime() < MIN_GAP_MS) return true;
  return false;
}

/** `senderName` must already be the moderator's configured human-facing name
 *  (e.g. "Kwan") — NEVER a Telegram bot username. That resolution happens
 *  upstream in community-runtime.ts's classifySender(); this function only
 *  ever templates whatever string it's given, so if a safe name genuinely
 *  isn't available, the caller must pass null (falls back to the
 *  name-free pool below) rather than a raw @handle. */
function craftAckText(senderName: string | null, random: () => number): string {
  const templates: string[] = senderName
    ? [`Got it 👍`, `Yep.`, `Morning ${senderName} 👋`, `Thanks ${senderName}.`, `GM ${senderName}`, `Hey ${senderName} 👋`]
    : [`Got it 👍`, `Yep.`, `On it.`, `Hey 👋`];
  return templates[Math.min(templates.length - 1, Math.floor(random() * templates.length))];
}

export function decideBotAcknowledgement(input: CoordinatorInput): CommunityAction {
  const { event, botAckMode, eligibleTargets, now } = input;
  const random = input.random ?? Math.random;

  // Hard, non-negotiable gates first (spec §8/§9) — order matters, these
  // must never be reachable via probability/rate-limit logic below.
  if (event.sender.senderType !== "INNVIL_MODERATOR") return { kind: "IGNORE" };
  if (event.origin === "BOT_ACK") return { kind: "IGNORE" };
  if (event.interactionDepth >= MAX_BOT_INTERACTION_DEPTH) return { kind: "IGNORE" };
  if (botAckMode === "off") return { kind: "IGNORE" };
  if (eligibleTargets.length === 0) return { kind: "IGNORE" };

  const available = eligibleTargets.filter((t) => !isRateLimited(t, now));
  if (available.length === 0) return { kind: "IGNORE" };

  // Deterministic opening-acknowledgement requirement: an eligible OPENING
  // statement ("gm", "hello", "hey everyone", ...) from one Innvil moderator
  // to another is ALWAYS acknowledged -- no probability roll. Reuses the
  // SAME semantic opener classifier Natural Chatter already applies to human
  // messages (chatter-coordinator.ts's isConversationalOpener), rather than
  // inventing a second, duplicate greeting detector. Every OTHER hard gate
  // above (sender type, BOT_ACK origin, interaction depth, mode, rate
  // limits) still fully applies -- this only removes the "occasional"
  // probability roll for the specific opener case; ordinary/non-opening
  // bot-to-bot chatter below is completely unchanged.
  const isOpeningStatement = isConversationalOpener(event.text);

  // "Occasional" — most eligible NON-opening moments still resolve to
  // IGNORE (spec §17). Openers skip this roll entirely (see above).
  if (!isOpeningStatement && random() > ACK_PROBABILITY) return { kind: "IGNORE" };

  const target = available[Math.floor(random() * available.length) % available.length];
  const nextDepth = event.interactionDepth + 1;

  if (botAckMode === "reactions_only") {
    return {
      kind: "REACT",
      emoji: REACT_EMOJIS[Math.floor(random() * REACT_EMOJIS.length) % REACT_EMOJIS.length],
      targetDeploymentId: target.deploymentId,
      targetMessageId: event.messageId,
    };
  }

  // acknowledgements / role_handoffs (v1 treats both the same — see file header)
  if (random() < REACT_PREFERENCE) {
    return {
      kind: "REACT",
      emoji: REACT_EMOJIS[Math.floor(random() * REACT_EMOJIS.length) % REACT_EMOJIS.length],
      targetDeploymentId: target.deploymentId,
      targetMessageId: event.messageId,
    };
  }

  return {
    kind: "SEND_TEXT",
    text: craftAckText(event.sender.displayName, random),
    targetDeploymentId: target.deploymentId,
    replyToMessageId: event.messageId,
    origin: "BOT_ACK",
    interactionDepth: nextDepth,
    causationMessageId: event.messageId,
  };
}
