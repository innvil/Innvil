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

   No AI calls anywhere in this file (spec §16) — v1 acknowledgement AND the
   community-handoff redirect (bot-ack-social-behavior-spec.md) are each
   either a reaction or a short canned/templated phrase, deterministic and
   free. A COMMUNITY_HANDOFF deliberately only ever "opens the floor"
   generically (spec §9 option A/D) rather than referencing specific recent
   topics or Project/Community Knowledge (spec §9 option B/C, §10, §16) —
   that KB doesn't exist yet (Phase 4.N, NOTED/not built); fabricating a
   grounded-sounding reference without real grounding would violate the
   spec's own "do not fabricate" rule, so this stays generic until that
   pipeline exists.

   Depth/origin model (bot-ack-social-behavior-spec.md §5/§6): depth 0
   (HUMAN/PROACTIVE origin) may produce a BOT_ACK (depth becomes 1); a
   depth-1 (BOT_ACK-origin) event may produce AT MOST a COMMUNITY_HANDOFF
   (depth becomes 2), never another acknowledgement; a depth-2
   (COMMUNITY_HANDOFF-origin) event always IGNOREs — hard dead end, no
   exceptions (§12). `botAckMode: "role_handoffs"` is what actually enables
   the handoff step; "acknowledgements" stops at a plain ack (matches its
   existing UI label "Role handoffs" vs "Acknowledgements" — no schema/UI
   change needed, this coordinator just now actually differentiates them). */

import { MAX_BOT_HANDOFF_DEPTH, type CommunityAction, type CommunityEvent } from "./event-types";
import { isConversationalOpener, isSimpleClosingAcknowledgement } from "./chatter-coordinator";

export type BotAckMode = "off" | "reactions_only" | "acknowledgements" | "role_handoffs";

/** Minimum gap between two acknowledgements FROM the same target deployment. */
const MIN_GAP_MS = 10 * 60_000;
/** Hard daily cap per target deployment, regardless of gap. */
const DAILY_CAP = 5;
/** "Occasional" — most eligible moments should still resolve to IGNORE. */
const ACK_PROBABILITY = 0.35;
/** Within an eligible acknowledgement, how often to prefer a plain reaction over a short phrase (spec §19). */
const REACT_PREFERENCE = 0.6;
/** A depth-1 (already-acknowledged) exchange is offered a handoff only
 *  sometimes -- spec §7/§8/TEST5: "do not always generate a handoff, silence
 *  is still allowed". Deliberately lower than ACK_PROBABILITY: escalating an
 *  already-completed exchange to a second bot message should be rarer than
 *  the initial ack, not equally common. */
const HANDOFF_PROBABILITY = 0.4;

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

/** Generic "open the floor to humans" phrasing only (spec §9 option A/D) --
 *  never references a specific recent topic or Project/Community Knowledge
 *  (option B/C), since that grounding pipeline doesn't exist yet (see file
 *  header). Addressed to the ROOM, never to the other moderator by name
 *  (spec §4 — "How about you, Mika?" is explicitly the wrong shape, since
 *  that invites another bot reply). */
function craftHandoffText(random: () => number): string {
  const templates = [
    "Anyone here got anything new today?",
    "What's everyone working on today?",
    "Anyone got updates from their side?",
    "What's the mood in here today?",
    "Anything interesting happening in here today?",
  ];
  return templates[Math.min(templates.length - 1, Math.floor(random() * templates.length))];
}

export function decideBotAcknowledgement(input: CoordinatorInput): CommunityAction {
  const { event, botAckMode, eligibleTargets, now } = input;
  const random = input.random ?? Math.random;

  // Hard, non-negotiable gates first (spec §8/§9, extended §5/§6/§12) —
  // order matters, these must never be reachable via probability/rate-limit
  // logic below.
  if (event.sender.senderType !== "INNVIL_MODERATOR") return { kind: "IGNORE" };
  // A COMMUNITY_HANDOFF is a hard dead end -- no bot may EVER respond to one,
  // regardless of mode/depth/anything else (§12: "Bot 1 must not answer").
  if (event.origin === "COMMUNITY_HANDOFF") return { kind: "IGNORE" };
  if (event.interactionDepth >= MAX_BOT_HANDOFF_DEPTH) return { kind: "IGNORE" };
  if (botAckMode === "off") return { kind: "IGNORE" };
  if (eligibleTargets.length === 0) return { kind: "IGNORE" };

  const available = eligibleTargets.filter((t) => !isRateLimited(t, now));
  if (available.length === 0) return { kind: "IGNORE" };

  // ---- depth 1 (this event IS itself a BOT_ACK reply): AT MOST a
  // COMMUNITY_HANDOFF, never another plain acknowledgement (§5/§6). ----
  if (event.origin === "BOT_ACK") {
    if (botAckMode !== "role_handoffs") return { kind: "IGNORE" }; // "acknowledgements"/"reactions_only" stop at depth 1
    // A bare closing acknowledgement ("nice one", "thanks") already feels
    // socially complete -- do not force a handoff onto it (TEST 4).
    if (isSimpleClosingAcknowledgement(event.text)) return { kind: "IGNORE" };
    // Not mandatory even when eligible -- silence remains valid (§7/§8/TEST5).
    if (random() > HANDOFF_PROBABILITY) return { kind: "IGNORE" };
    const target = available[Math.floor(random() * available.length) % available.length];
    return {
      kind: "COMMUNITY_HANDOFF",
      text: craftHandoffText(random),
      targetDeploymentId: target.deploymentId,
      replyToMessageId: event.messageId,
      interactionDepth: event.interactionDepth + 1,
      causationMessageId: event.messageId,
    };
  }

  // ---- depth 0 (HUMAN/PROACTIVE origin): the original plain-acknowledgement
  // decision, unchanged. ----

  // Deterministic opening-acknowledgement requirement: an eligible OPENING
  // statement ("gm", "hello", "hey everyone", ...) from one Innvil moderator
  // to another is ALWAYS acknowledged -- no probability roll. Reuses the
  // SAME semantic opener classifier Natural Chatter already applies to human
  // messages (chatter-coordinator.ts's isConversationalOpener), rather than
  // inventing a second, duplicate greeting detector. Every OTHER hard gate
  // above (sender type, interaction depth, mode, rate limits) still fully
  // applies -- this only removes the "occasional" probability roll for the
  // specific opener case; ordinary/non-opening bot-to-bot chatter below is
  // completely unchanged.
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

  // acknowledgements / role_handoffs -- both produce a plain ack at depth 0;
  // "role_handoffs" is what additionally allows the depth-1 branch above to
  // escalate to a COMMUNITY_HANDOFF.
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
