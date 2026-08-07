/* =========================================================
   Platform-agnostic community event/action types (spec §20). Telegram is the
   only adapter today, but nothing here is Telegram-shaped — the adapter
   (telegram.ts) normalizes a raw Telegram Update into a CommunityEvent
   before anything else touches it.
   ========================================================= */

export type SenderType = "HUMAN" | "INNVIL_MODERATOR" | "EXTERNAL_BOT";

/** Why this event exists — critical for loop prevention (spec §8/§9). A
 *  BOT_ACK-origin event must never itself produce another acknowledgement. */
export type EventOrigin = "HUMAN" | "PROACTIVE" | "BOT_ACK";

export interface CommunitySender {
  platformUserId: string;
  isBot: boolean;
  senderType: SenderType;
  displayName: string | null;
  /** Set only when senderType === INNVIL_MODERATOR. */
  innvilModeratorId?: string;
  /** The sender's OWN active deployment in this community, when known. */
  deploymentId?: string;
}

export interface CommunityEvent {
  panelId: string; // tenant
  communityId: string;
  integrationId: string; // which subscriber bot's webhook delivered this
  messageId: string;
  sender: CommunitySender;
  timestamp: string;
  text: string;
  replyToMessageId: string | null;
  origin: EventOrigin;
  /** 0 for a human-originated or proactive root event. Incremented by exactly
   *  one for a bot-ack reacting to another bot. Never allowed past MAX_BOT_INTERACTION_DEPTH. */
  interactionDepth: number;
  /** The message id this event is causally responding to, if any (the
   *  message a bot-ack is acknowledging). Distinct from replyToMessageId,
   *  which is Telegram's own reply-chain pointer. */
  causationMessageId: string | null;
}

export const MAX_BOT_INTERACTION_DEPTH = 1;

/* ------------------------------------------------------------- actions ---- */

export type CommunityAction =
  | { kind: "IGNORE" }
  | { kind: "REACT"; emoji: string; targetDeploymentId: string; targetMessageId: string }
  | {
      kind: "SEND_TEXT";
      text: string;
      targetDeploymentId: string;
      replyToMessageId: string | null;
      origin: EventOrigin;
      interactionDepth: number;
      causationMessageId: string | null;
    };

/* --------------------------------------------------- sender classification ---- */
// Pure decision given already-resolved facts (spec §2/§3) — the DB lookups
// that PRODUCE these facts live in community-runtime.ts, not here.

export interface KnownBotFacts {
  /** A telegram_bot_integrations row exists for this numeric bot id, scoped to a specific panel. */
  integration: { panelId: string; virtualModeratorId: string } | null;
  /** That moderator has an ENABLED deployment in the community the event is happening in. */
  activeDeploymentInThisCommunity: { deploymentId: string } | null;
}

export function classifySender(isBot: boolean, knownBot: KnownBotFacts | null): SenderType {
  if (!isBot) return "HUMAN";
  // Known to Innvil at all, but not deployed HERE -> never trusted as a
  // local teammate in this community (spec §4/§5 — tenant isolation over
  // convenience, same principle used for provisioning correlation).
  if (!knownBot?.integration || !knownBot.activeDeploymentInThisCommunity) return "EXTERNAL_BOT";
  return "INNVIL_MODERATOR";
}
