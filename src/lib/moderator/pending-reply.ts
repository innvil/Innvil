/* =========================================================
   Pending Watcher replies — real, persisted "wait N seconds, give a human
   the first opportunity" scheduling. Pure logic only (types + the decision
   functions the runtime/cron layer calls) — no I/O, no Supabase, no
   Telegram. The DB-facing orchestration lives in community-runtime.ts
   (scheduling + cancel-on-arrival) and pending-reply-runtime.ts (the cron
   sweep that actually fires a due reply).

   WHY this exists: a chatter action of ANSWER/CASUAL_CHAT used to send
   immediately, in the same Telegram-webhook invocation, with no
   opportunity for a human admin/mod to answer first. Per explicit product
   decision (2026-09-02), a normal user's question/conversational opener now
   creates a PERSISTED pending reply, waits before sending, and is cancelled
   the moment an admin/mod TAKES OVER THAT SPECIFIC CONVERSATION during that
   window — never an in-memory timer (must survive a server restart / new
   invocation, since Telegram webhooks are one-shot and stateless).

   This applies uniformly to EVERY conversational engagement path,
   including a message that directly @mentions/replies-to/names the
   Watcher — an explicit mention is a signal for WHO should eventually
   answer, it is not itself a grant of permission to bypass a human's first
   opportunity to respond. The only thing that ever pre-empts this wait
   entirely is moderation/safety enforcement (link/media moderation,
   solicitation policy) — see community-runtime.ts's handleHumanMessage,
   where moderation runs first and short-circuits before this scheduler is
   ever reached, so a prohibited/unsolicited-promotion message is deleted
   and warned about IMMEDIATELY, never deferred through this wait.

   Applies uniformly to every plan/tier — this is not a paid-tier gate. */

/** Default wait before a normal user's question/opener may be answered by
 *  the Watcher, absent an admin/mod taking over first. Configurable PER
 *  COMMUNITY (communities.pending_reply_delay_seconds, migration 0121) —
 *  this constant is only the fallback used when a community has no value
 *  set, and the seed default every new community starts with. */
export const DEFAULT_PENDING_REPLY_DELAY_MS = 45_000;

/** Allowed configurable range for the per-community delay, in seconds. */
export const MIN_PENDING_REPLY_DELAY_SECONDS = 15;
export const MAX_PENDING_REPLY_DELAY_SECONDS = 120;

/** Clamps an owner-configured (or DB-read) delay into the allowed range,
 *  falling back to the default for anything missing/non-finite — never lets
 *  a corrupted/out-of-range stored value produce an absurd wait. */
export function clampPendingReplyDelaySeconds(seconds: number | null | undefined): number {
  const fallback = DEFAULT_PENDING_REPLY_DELAY_MS / 1000;
  if (seconds == null || !Number.isFinite(seconds)) return fallback;
  return Math.min(MAX_PENDING_REPLY_DELAY_SECONDS, Math.max(MIN_PENDING_REPLY_DELAY_SECONDS, Math.round(seconds)));
}

/** @deprecated kept only as the historical/default constant some older call
 *  sites' default parameters reference — real scheduling should always pass
 *  an explicit, per-community-resolved delay (see clampPendingReplyDelaySeconds). */
export const PENDING_REPLY_DELAY_MS = DEFAULT_PENDING_REPLY_DELAY_MS;

/** How long PAST its scheduled fire time a pending reply may still be sent
 *  once the sweep actually reaches it (e.g. after a period of downtime).
 *  Past this, it's marked EXPIRED rather than sent very late — mirrors the
 *  existing 15-minute TTL convention already used for
 *  moderator_conversation_tasks in this codebase. */
export const PENDING_REPLY_STALE_AFTER_MS = 15 * 60_000;

export type PendingReplyStatus = "pending" | "sending" | "sent" | "cancelled" | "expired" | "failed";

export type PendingReplyCancelReason =
  | "admin_replied"
  | "already_answered"
  | "user_left"
  | "expired"
  | "duplicate"
  /** The original triggering message can no longer be confirmed to exist
   *  (e.g. the asker deleted it during the wait). Best-effort only — the
   *  Telegram Bot API has no supported way to check whether an arbitrary
   *  user-authored message still exists without a side effect, so this
   *  reason is reachable only if a future signal (e.g. an update_id for a
   *  deleted-message event, should Telegram ever expose one for ordinary
   *  chats) becomes available. Kept in the enum now so the revalidation
   *  contract is honest about the concept even though nothing populates it
   *  today — see revalidatePendingReply's originalMessageStillExists. */
  | "message_deleted";

/** The kind of chatter action that was deferred — governs how the sweep
 *  regenerates the reply (ANSWER re-runs the knowledge-grounded Q&A path,
 *  CASUAL_CHAT the lighter social-reply path). Never a third kind — those
 *  are the only two actions this scheduler ever defers (see
 *  community-runtime.ts's scheduling call site: REACT/SHORT_ACK/SILENCE are
 *  never deferred, they're either immediate or genuinely nothing). */
export type DeferredActionKind = "ANSWER" | "CASUAL_CHAT";

export interface PendingReplyRow {
  id: string;
  communityId: string;
  deploymentId: string;
  messageThreadId: number | null;
  triggerPlatformMessageId: string;
  senderPlatformId: string;
  status: PendingReplyStatus;
  actionKind: DeferredActionKind;
  scheduledFor: string; // ISO
  createdAt: string; // ISO
}

/** True once `now` has reached (or passed) the row's scheduled fire time —
 *  the sweep's own "is this one due" gate. Pure so the boundary is directly
 *  testable without a real clock/DB. */
export function isPendingReplyDue(row: Pick<PendingReplyRow, "scheduledFor">, now: Date): boolean {
  return now.getTime() >= new Date(row.scheduledFor).getTime();
}

/** True once a due row has sat unfired long enough (PENDING_REPLY_STALE_AFTER_MS
 *  past its own scheduled time) that sending it now would be a confusingly
 *  late, out-of-context reply rather than a real 120-second fallback. */
export function isPendingReplyStale(row: Pick<PendingReplyRow, "scheduledFor">, now: Date): boolean {
  return now.getTime() - new Date(row.scheduledFor).getTime() > PENDING_REPLY_STALE_AFTER_MS;
}

export function pendingReplyScheduledFor(now: Date, delayMs: number = DEFAULT_PENDING_REPLY_DELAY_MS): string {
  return new Date(now.getTime() + delayMs).toISOString();
}

/** "Is a human message, posted at `candidateAt`, recent enough right now to
 *  count as 'someone is actively handling this topic'?" — the SAME window
 *  used both to decide "don't even bother scheduling, an admin just spoke"
 *  and, implicitly, to size the wait itself. `windowMs` should be the
 *  community's own configured delay (see clampPendingReplyDelaySeconds) —
 *  defaults to the platform default only for callers/tests that don't have
 *  a specific community's value handy. Pure/testable independent of real
 *  time. */
export function isWithinPendingReplyWindow(candidateAt: string | null | undefined, now: Date, windowMs: number = DEFAULT_PENDING_REPLY_DELAY_MS): boolean {
  if (!candidateAt) return false;
  return now.getTime() - new Date(candidateAt).getTime() < windowMs;
}

/** Conversation-ownership check (gap 2): whether a real admin/mod/owner
 *  message actually TAKES OVER the specific pending user's conversation —
 *  never "any admin message anywhere in this topic". A topic can hold
 *  several unrelated pending replies (two different users each asked
 *  something) at once; cancelling every one of them just because ANY
 *  admin posted ANYTHING in that topic is too broad and would silence the
 *  Watcher for users an admin never actually addressed.
 *
 *  Two independent, deterministic signals, either one sufficient:
 *   (a) a direct Telegram reply relationship — the admin's message replies
 *       to the pending reply's own trigger message, or to any other
 *       message the SAME asker sent in the recent window (an admin
 *       replying to a DIFFERENT message from that user is still clearly
 *       part of the same conversation with them);
 *   (b) conversational continuity — the admin's message is the very NEXT
 *       message in this topic after the trigger, with nothing else (from
 *       anyone) said in between. An admin chiming in immediately, uncontested,
 *       reads as responding to that exact exchange; any intervening message
 *       breaks that chain and correctly makes this signal NOT fire, so an
 *       admin posting something unrelated later in a busy topic never
 *       falsely cancels someone else's still-pending question.
 *
 *  Topic id alone is never sufficient on its own — both signals require the
 *  admin's message to genuinely relate to THIS asker's exchange. */
export interface ConversationOwnershipInput {
  triggerPlatformMessageId: string;
  triggerCreatedAt: string;
  /** Every message id (in the recent window) known to have been sent by
   *  the original asker — lets (a) recognize a reply to an EARLIER message
   *  from the same person, not only the literal trigger. */
  askerMessageIds: string[];
  adminMessage: {
    replyToPlatformMessageId: string | null;
    createdAt: string;
  };
  /** True when at least one OTHER message (any sender) exists strictly
   *  between the trigger and the admin's message, in the same topic — the
   *  caller resolves this from real message history (see
   *  community-runtime.ts's hasInterveningMessage). */
  hasInterveningMessage: boolean;
}

export function isAdminMessageHandlingConversation(input: ConversationOwnershipInput): boolean {
  const { replyToPlatformMessageId } = input.adminMessage;
  if (replyToPlatformMessageId) {
    if (replyToPlatformMessageId === input.triggerPlatformMessageId) return true;
    if (input.askerMessageIds.includes(replyToPlatformMessageId)) return true;
  }
  const adminAfterTrigger = new Date(input.adminMessage.createdAt).getTime() > new Date(input.triggerCreatedAt).getTime();
  if (adminAfterTrigger && !input.hasInterveningMessage) return true;
  return false;
}

/** Revalidation the SWEEP runs right before actually sending a due reply —
 *  every reason a scheduled reply might no longer be useful, expressed as
 *  one deterministic function so the decision is directly testable rather
 *  than scattered across the cron route. The caller supplies each already-
 *  resolved fact (this function does no I/O) — see PendingReplyRevalidationInput
 *  for what each field means and how the sweep resolves it. */
export interface PendingReplyRevalidationInput {
  now: Date;
  row: Pick<PendingReplyRow, "scheduledFor">;
  /** A moderator (any deployment) has already sent a reply in this same
   *  topic/thread since the row was scheduled — the question reads as
   *  already answered, sending another would be redundant. */
  alreadyAnsweredByModerator: boolean;
  /** An admin/mod's own message landed in this topic since scheduling —
   *  belt-and-suspenders re-check; in practice this is normally already
   *  caught by the immediate cancel-on-arrival path (see
   *  community-runtime.ts), this only matters if that path was somehow
   *  missed (e.g. a race, or the cron was delayed past a since-cancelled
   *  row that hadn't been marked cancelled yet for some other reason). */
  adminRespondedSinceScheduling: boolean;
  /** The original asker is confirmed to have left/been removed from the
   *  community — answering someone no longer present is pointless. */
  senderStillPresent: boolean;
  /** Best-effort signal that the ORIGINAL triggering message has been
   *  positively confirmed deleted. Defaults to `true` (assumed to still
   *  exist) when omitted/undefined — same fail-safe philosophy as
   *  senderStillPresent: a real answer is never withheld on a mere absence
   *  of proof. The Telegram Bot API has no supported way for a bot to
   *  query whether an arbitrary user-sent message still exists without a
   *  side effect (no getMessage endpoint, and every workaround — e.g.
   *  forwardMessage/copyMessage — has a real, visible side effect on the
   *  chat) — this field exists so the CONTRACT is honest and testable, and
   *  so a future real signal (should one become available) can be wired in
   *  without changing this function's shape. Only ever set to `false` when
   *  a caller has a genuine, confirmed signal — never guessed. */
  originalMessageStillExists?: boolean;
}

export function revalidatePendingReply(input: PendingReplyRevalidationInput): { ok: true } | { ok: false; reason: PendingReplyCancelReason } {
  if (isPendingReplyStale(input.row, input.now)) return { ok: false, reason: "expired" };
  if (input.adminRespondedSinceScheduling) return { ok: false, reason: "admin_replied" };
  if (input.alreadyAnsweredByModerator) return { ok: false, reason: "already_answered" };
  if (!input.senderStillPresent) return { ok: false, reason: "user_left" };
  if (input.originalMessageStillExists === false) return { ok: false, reason: "message_deleted" };
  return { ok: true };
}
