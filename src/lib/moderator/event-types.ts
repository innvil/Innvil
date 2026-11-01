/* =========================================================
   Platform-agnostic community event/action types (spec §20). Telegram is the
   only adapter today, but nothing here is Telegram-shaped — the adapter
   (telegram.ts) normalizes a raw Telegram Update into a CommunityEvent
   before anything else touches it.
   ========================================================= */

export type SenderType = "HUMAN" | "INNVIL_MODERATOR" | "EXTERNAL_BOT";

/** Why this event exists — critical for loop prevention (spec §8/§9, extended
 *  by bot-ack-social-behavior-spec.md §5/§6). A BOT_ACK-origin event may
 *  produce AT MOST a COMMUNITY_HANDOFF (never another acknowledgement); a
 *  COMMUNITY_HANDOFF-origin event must never itself produce any bot action
 *  at all (§12 — only a human reply restarts normal Coordinator logic).
 *  INNVIL_MARKETING (innvil-bot-manager-spec.md §7) — a proactive broadcast
 *  from Innvil's own official product bot, never a customer moderator's own
 *  message: customer moderators must NOT BOT_ACK or COMMUNITY_HANDOFF on it
 *  (an official announcement is not another moderator's casual chatter to
 *  react to), same hard-stop treatment as COMMUNITY_HANDOFF. */
export type EventOrigin = "HUMAN" | "PROACTIVE" | "BOT_ACK" | "COMMUNITY_HANDOFF" | "INNVIL_MARKETING";

export interface CommunitySender {
  /** Resolved from Telegram for this event, never inferred from message text. */
  verifiedRole?: "admin" | "member" | "unknown";
  platformUserId: string;
  isBot: boolean;
  senderType: SenderType;
  /** Friendly/conversational identity — for a HUMAN this is their Telegram
   *  given name (first_name, falling back to username only if no first_name
   *  is set); for an INNVIL_MODERATOR this is the moderator's OWN configured
   *  name, never its Telegram bot username. Used for ordinary conversational
   *  reference ("Hi Jon", "Thanks, Kwan") — never for a moderation-warning
   *  mention, which needs the raw username/platformUserId below instead. */
  displayName: string | null;
  /** The sender's raw Telegram @username (no leading @), when Telegram
   *  reports one — distinct from displayName. Only meaningful for a HUMAN
   *  sender; a moderation warning explicitly targeting this person should
   *  use this (real, clickable @mention) when set, falling back to a
   *  platformUserId-based mention otherwise. Never used for ordinary
   *  conversational naming (that's what displayName is for). */
  username?: string | null;
  /** Set only when senderType === INNVIL_MODERATOR. */
  innvilModeratorId?: string;
  /** The sender's OWN active deployment in this community, when known. */
  deploymentId?: string;
}

export interface CommunityEvent {
  panelId: string | null; // legacy Panel-distribution attribution only -- never canonical tenant identity (see communityId/the account chain resolved via project ownership)
  communityId: string;
  integrationId: string; // which subscriber bot's webhook delivered this
  messageId: string;
  sender: CommunitySender;
  timestamp: string;
  text: string;
  /** Includes hidden hyperlink destinations from the platform adapter. */
  links?: string[];
  replyToMessageId: string | null;
  /** Telegram Forum topic id this message was posted in (see
   *  TelegramMessage.message_thread_id) -- null for an ordinary chat or the
   *  forum's default topic. Used to let a community allow-list specific
   *  topics (e.g. a "Promotion" topic) as always-solicitation-allowed,
   *  regardless of the community-wide allow_solicitation toggle. */
  messageThreadId: number | null;
  origin: EventOrigin;
  /** 0 for a human-originated or proactive root event. Incremented by exactly
   *  one for a bot-ack reacting to another bot. Never allowed past MAX_BOT_INTERACTION_DEPTH. */
  interactionDepth: number;
  /** The message id this event is causally responding to, if any (the
   *  message a bot-ack is acknowledging). Distinct from replyToMessageId,
   *  which is Telegram's own reply-chain pointer. */
  causationMessageId: string | null;
}

/** Depth at which a plain acknowledgement (BOT_ACK) may still fire — a
 *  depth-0 (HUMAN/PROACTIVE) event may produce one. */
export const MAX_BOT_INTERACTION_DEPTH = 1;
/** Hard ceiling on the whole bot-generated social chain
 *  (bot-ack-social-behavior-spec.md §6): depth 0 = original event, depth 1 =
 *  optional BOT_ACK, depth 2 = optional COMMUNITY_HANDOFF, then STOP — no
 *  further bot-generated social action may ever follow, regardless of mode
 *  or rate limits. */
export const MAX_BOT_HANDOFF_DEPTH = 2;

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
      /** Set only for deterministic, pre-escaped template text (e.g. scam-
       *  strike warnings using a Telegram-native tg://user mention) — every
       *  other caller omits this and gets plain-text sendMessage, unchanged. */
      parseMode?: "HTML";
      messageThreadId?: number | null;
    }
  /** bot-ack-social-behavior-spec.md — closes a bot-to-bot exchange by
   *  redirecting attention to the human community rather than continuing the
   *  bot-to-bot back-and-forth (never addressed at the other moderator by
   *  name). Only ever produced from a depth-1 (origin BOT_ACK) event; its own
   *  resulting message is recorded with origin COMMUNITY_HANDOFF, which is a
   *  hard dead end — no bot may ever respond to it (§12). Distinct from
   *  SEND_TEXT so the runtime never confuses "this is itself an
   *  acknowledgement another bot might ack" with "this closes the chain". */
  | {
      kind: "COMMUNITY_HANDOFF";
      text: string;
      targetDeploymentId: string;
      replyToMessageId: string | null;
      interactionDepth: number;
      causationMessageId: string | null;
    }
  /** Link-moderation enforcement (Phase 4.M (C)-(E)) — removes the offending
   *  message. Acts as whichever deployment is doing the moderating (the
   *  bot needs delete rights in that community). */
  | { kind: "DELETE_MESSAGE"; targetDeploymentId: string; targetMessageId: string }
  /** Removes the violating user from the community. `mode: "BAN"` with no
   *  `banMinutes` is permanent (Telegram banChatMember, no until_date) --
   *  kept for a possible future manual admin action, no automatic
   *  enforcement path produced a PERMANENT ban as of the Watcher Ops
   *  moderation-reporting expansion (2026-08-27). `banMinutes`, when set
   *  (2026-09-05, negative-statement moderation), makes this a real
   *  TIME-BOUND ban via Telegram's own until_date parameter on
   *  banChatMember -- the user is automatically unbanned/can rejoin after
   *  that duration, never left permanently removed. `mode: "KICK"` is
   *  REMOVABLE, not permanent -- implemented as banChatMember immediately
   *  followed by unbanChatMember (Telegram's own documented kick idiom;
   *  there is no separate "kick" API method). `mode: "MUTE"` temporarily
   *  restricts the user's ability to send messages via Telegram
   *  restrictChatMember, for `muteMinutes` minutes from execution time --
   *  used for the first one/two graduated spam/scam warnings, always
   *  alongside (never instead of) a DELETE_WARN. */
  | { kind: "RESTRICT_USER"; targetDeploymentId: string; targetPlatformUserId: string; mode: "BAN"; banMinutes?: number }
  | { kind: "RESTRICT_USER"; targetDeploymentId: string; targetPlatformUserId: string; mode: "KICK" }
  | { kind: "RESTRICT_USER"; targetDeploymentId: string; targetPlatformUserId: string; mode: "MUTE"; muteMinutes: number };

/* --------------------------------------------------- sender classification ---- */
// Pure decision given already-resolved facts (spec §2/§3) — the DB lookups
// that PRODUCE these facts live in community-runtime.ts, not here.

export interface KnownBotFacts {
  /** A telegram_bot_integrations row exists for this numeric bot id -- panelId is optional legacy attribution, never part of the identity check below. */
  integration: { panelId: string | null; virtualModeratorId: string } | null;
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
