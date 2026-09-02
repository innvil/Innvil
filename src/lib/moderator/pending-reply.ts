/* =========================================================
   Pending Watcher replies — real, persisted "wait 120 seconds, give a human
   the first opportunity" scheduling. Pure logic only (types + the decision
   functions the runtime/cron layer calls) — no I/O, no Supabase, no
   Telegram. The DB-facing orchestration lives in community-runtime.ts
   (scheduling + cancel-on-arrival) and pending-reply-runtime.ts (the cron
   sweep that actually fires a due reply).

   WHY this exists: a chatter action of ANSWER/CASUAL_CHAT used to send
   immediately, in the same Telegram-webhook invocation, with no
   opportunity for a human admin/mod to answer first. Per explicit product
   decision (2026-09-02), a normal user's question/conversational opener now
   creates a PERSISTED pending reply, waits 120 seconds, and is cancelled the
   moment an admin/mod engages the same topic during that window — never an
   in-memory timer (must survive a server restart / new invocation, since
   Telegram webhooks are one-shot and stateless).

   Applies uniformly to every plan/tier — this is not a paid-tier gate. */

/** How long a normal user's question/opener waits for a human to answer
 *  first, before the Watcher may respond. Also reused as the "how recent
 *  counts as an admin/mod actively handling this topic right now" window —
 *  the two concepts are the same duration by design (an admin who spoke in
 *  the last 120s is exactly as "active" as the window we'd otherwise make a
 *  fresh question wait through). */
export const PENDING_REPLY_DELAY_MS = 120_000;

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
  | "duplicate";

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

export function pendingReplyScheduledFor(now: Date): string {
  return new Date(now.getTime() + PENDING_REPLY_DELAY_MS).toISOString();
}

/** "Is a human message, posted at `candidateAt`, recent enough right now to
 *  count as 'someone is actively handling this topic'?" — the SAME window
 *  used both to decide "don't even bother scheduling, an admin just spoke"
 *  and, implicitly, to size the wait itself. Pure/testable independent of
 *  real time. */
export function isWithinPendingReplyWindow(candidateAt: string | null | undefined, now: Date): boolean {
  if (!candidateAt) return false;
  return now.getTime() - new Date(candidateAt).getTime() < PENDING_REPLY_DELAY_MS;
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
}

export function revalidatePendingReply(input: PendingReplyRevalidationInput): { ok: true } | { ok: false; reason: PendingReplyCancelReason } {
  if (isPendingReplyStale(input.row, input.now)) return { ok: false, reason: "expired" };
  if (input.adminRespondedSinceScheduling) return { ok: false, reason: "admin_replied" };
  if (input.alreadyAnsweredByModerator) return { ok: false, reason: "already_answered" };
  if (!input.senderStillPresent) return { ok: false, reason: "user_left" };
  return { ok: true };
}
