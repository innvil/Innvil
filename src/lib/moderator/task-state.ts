/* =========================================================
   Temporary conversational task state for Virtual Moderators.

   Normal group chat is NOT turn-based (see chatter-coordinator.ts). This is
   the deliberately SEPARATE mechanism for the narrower case: a human
   explicitly establishes a multi-step SHARED activity ("let's all count,
   I'll start with 1. Test goes 2, Kwan 3...") that must be remembered and
   enforced across several messages/participants until it's completed,
   changed, cancelled, or expires -- then the room returns to ordinary,
   turn-free chatter.

   Pure module (no I/O, no AI) -- exactly the same architectural split as
   chatter-coordinator.ts: this decides WHETHER a task exists, WHOSE turn it
   is, and WHAT the deterministic next output is; community-runtime.ts owns
   persistence (Postgres -- Telegram webhooks are stateless/serverless, so a
   task spanning several messages/invocations cannot live in process memory)
   and actually sends/generates.

   v1 scope: ONE task type, "SEQUENCE" (turn-ordered participants each
   contributing one step, numeric or freeform), behind a `type` discriminant
   so future task kinds (ordered Q&A, wait-for-signal, ...) can be added
   without reworking this file's shape or the runtime wiring around it.
   ========================================================= */

export type TaskParticipantKind = "HUMAN" | "MODERATOR";

export interface TaskParticipant {
  kind: TaskParticipantKind;
  /** Telegram platform user id for HUMAN, deploymentId for MODERATOR. */
  id: string;
  displayName: string;
}

export type TaskStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CANCELLED" | "EXPIRED";

/** NUMERIC: a deterministic counting sequence (the concrete driving
 *  example) -- the runtime computes and sends the next value itself, never
 *  an LLM call. FREEFORM: a round-robin activity ("each of you name a
 *  country") with no deterministic content to check/generate -- advancing
 *  just requires SOME message from the expected participant; a moderator's
 *  freeform turn genuinely needs generation (persona-flavored, still never
 *  Sonnet for this — routed as CASUAL_CHAT, see community-runtime.ts). */
export type SequenceProgression = { kind: "NUMERIC"; start: number; step: number; end: number } | { kind: "FREEFORM" };

export interface SequenceTask {
  type: "SEQUENCE";
  status: TaskStatus;
  /** Turn order. Index 0 is the FIRST participant, not necessarily who
   *  established the task (the human normally puts themself first, but
   *  this isn't assumed). */
  participants: TaskParticipant[];
  /** Index into `participants` for whose turn is next. */
  currentIndex: number;
  progression: SequenceProgression;
  /** Only meaningful for NUMERIC -- the value the next contribution must
   *  equal exactly. Null for FREEFORM (any content from the right
   *  participant advances the step). */
  currentValue: number | null;
  createdFromMessageId: string;
  /** The human who set the task up -- kept for reference/attribution, NOT
   *  used to restrict who may pause/cancel/reorder it in v1 (a room-wide
   *  activity is treated as belonging to the room, not gated to one user). */
  initiatingPlatformId: string;
  createdAt: string;
  lastUpdatedAt: string;
}

/** Discriminated union -- the only member today is SequenceTask, but every
 *  consumer should switch on `.type` rather than assume SEQUENCE, so a
 *  future task kind slots in without a rewrite. */
export type ConversationTask = SequenceTask;

/** 15 minutes of inactivity (no advancing message) since the task's last
 *  update. Chosen to comfortably cover natural human typing/thinking pauses
 *  in a LIVE group activity (materially longer than
 *  RECENT_EXCHANGE_WINDOW_MS's 5-minute "is the room mid an ordinary
 *  exchange" window elsewhere, since a task is a longer-lived commitment a
 *  human explicitly opted into) without letting a stale, forgotten game
 *  govern the room indefinitely. Checked on read (no cron needed) — mirrors
 *  how reactive-quota/pacing recency is already handled in this codebase. */
export const TASK_TTL_MS = 15 * 60_000;

export function isTaskExpired(task: ConversationTask, now: Date): boolean {
  if (task.status === "COMPLETED" || task.status === "CANCELLED" || task.status === "EXPIRED") return false;
  return now.getTime() - new Date(task.lastUpdatedAt).getTime() > TASK_TTL_MS;
}

export function expectedParticipant(task: SequenceTask): TaskParticipant {
  return task.participants[task.currentIndex % task.participants.length];
}

/** The exact string a NUMERIC turn's contribution must equal; null for
 *  FREEFORM (nothing to check/generate deterministically) or a task that
 *  isn't currently ACTIVE. */
export function expectedNumericValue(task: SequenceTask): number | null {
  if (task.status !== "ACTIVE") return null;
  if (task.progression.kind !== "NUMERIC") return null;
  return task.currentValue;
}

/* ---------------------------------------------------------- detection ---- */
// Structural parsing (bounded regex on grammatical shape + the caller's own
// real moderator names), the SAME philosophy as the rest of this feature
// (chatter-coordinator.ts's PLURAL_ADDRESS_RE / leadingNameListTargets) --
// never a giant fixed command vocabulary. A message this doesn't recognize
// simply does not create a task (the safe default -- "tell me a joke" must
// never accidentally arm persistent state).

const COUNTING_CUE_RE = /\bcount(?:ing)?\b/i;
const END_VALUE_RE = /\b(?:until|to)\s+(\d+)\b/i;
const SELF_REFERENCE_RE = /\b(i|me)\b/i;

export interface TaskModeratorIdentity {
  deploymentId: string;
  name: string;
}

/** Splits a task-setup message into rough clauses (period/comma/"then") and,
 *  within each clause carrying a number, records who it was assigned to (a
 *  known moderator name, or the human via a first-person self-reference) --
 *  in the order clauses appear in the message. This is what lets "I'll
 *  start with 1. Test goes 2, Kwan 3, then I do 4" resolve to the ordered
 *  turn list [human, Test, Kwan] with step 1, without hardcoding those
 *  names or that exact phrasing. */
function extractOrderedAssignments(
  text: string,
  moderators: TaskModeratorIdentity[]
): Array<{ who: "HUMAN" | string; value: number }> {
  const clauses = text
    .split(/[.,]|\bthen\b/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const assignments: Array<{ who: "HUMAN" | string; value: number }> = [];
  for (const clause of clauses) {
    const numMatch = clause.match(/\b(\d+)\b/);
    if (!numMatch) continue;
    const value = parseInt(numMatch[1], 10);
    const lower = clause.toLowerCase();
    const mod = moderators.find((m) => new RegExp(`\\b${m.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower));
    if (mod) {
      assignments.push({ who: mod.deploymentId, value });
    } else if (SELF_REFERENCE_RE.test(lower)) {
      assignments.push({ who: "HUMAN", value });
    }
  }
  return assignments;
}

/** Detects a NUMERIC counting task ("let's all count, I'll start with 1...
 *  until 20") from a single setup message. Requires: a counting cue, an
 *  explicit end value ("until N"/"to N"), and at least 2 distinct
 *  participants named/self-referenced with numbers in the message -- a
 *  turn-taking task needs more than one turn-taker. Returns null (no task)
 *  on anything short of that; never guesses a partial/ambiguous setup into
 *  existence. */
export function detectSequenceTaskIntent(
  text: string,
  moderators: TaskModeratorIdentity[],
  humanPlatformId: string,
  now: Date,
  sourceMessageId: string
): SequenceTask | null {
  if (!COUNTING_CUE_RE.test(text)) return null;
  const endMatch = text.match(END_VALUE_RE);
  if (!endMatch) return null;
  const end = parseInt(endMatch[1], 10);

  const assignments = extractOrderedAssignments(text, moderators);
  if (assignments.length < 2) return null;

  const order: ("HUMAN" | string)[] = [];
  for (const a of assignments) if (!order.includes(a.who)) order.push(a.who);
  if (order.length < 2) return null;

  const start = assignments[0].value;
  const step = assignments[1].value - assignments[0].value;
  if (!Number.isFinite(step) || step === 0) return null; // a degenerate/contradictory setup -- don't arm a broken task

  const participants: TaskParticipant[] = order.map((who) =>
    who === "HUMAN"
      ? { kind: "HUMAN" as const, id: humanPlatformId, displayName: "You" }
      : { kind: "MODERATOR" as const, id: who, displayName: moderators.find((m) => m.deploymentId === who)?.name ?? "Moderator" }
  );

  const nowIso = now.toISOString();
  return {
    type: "SEQUENCE",
    status: "ACTIVE",
    participants,
    currentIndex: 0,
    progression: { kind: "NUMERIC", start, step, end },
    currentValue: start,
    createdFromMessageId: sourceMessageId,
    initiatingPlatformId: humanPlatformId,
    createdAt: nowIso,
    lastUpdatedAt: nowIso,
  };
}

/* ---------------------------------------------------- control instructions ---- */
// A human can modify or end the active task at any point. Each is its own
// small, structural signal -- never one giant regex trying to do everything,
// and never a rigid phrase list pretending to be exhaustive NLU.

export type TaskControlInstruction = "PAUSE" | "RESUME" | "RESET" | "CANCEL" | null;

const PAUSE_RE = /\b(wait|hold\s*on|hold\s*up|don'?t\s+start\s+yet|pause)\b/i;
const RESUME_RE = /^\s*(go|okay\s*go|start|resume|ready)\s*[.!]*\s*$/i;
const RESET_RE = /\b(start\s+over|reset|restart)\b/i;
const CANCEL_RE = /\b(never\s*mind|nevermind|cancel|forget\s+it|stop)\b/i;

/** Classifies an incoming message as a task CONTROL instruction, if any --
 *  checked before advancement is ever attempted, so a control message never
 *  ALSO gets evaluated as a (mismatching) turn contribution. Order matters:
 *  CANCEL/RESET checked before the broader PAUSE cue since "stop"/"start
 *  over" are more specific/decisive than a bare "wait". */
export function classifyTaskInstruction(text: string): TaskControlInstruction {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (CANCEL_RE.test(trimmed)) return "CANCEL";
  if (RESET_RE.test(trimmed)) return "RESET";
  if (PAUSE_RE.test(trimmed)) return "PAUSE";
  if (RESUME_RE.test(trimmed)) return "RESUME";
  return null;
}

export function pauseTask(task: SequenceTask, now: Date): SequenceTask {
  return { ...task, status: "PAUSED", lastUpdatedAt: now.toISOString() };
}

export function resumeTask(task: SequenceTask, now: Date): SequenceTask {
  if (task.status !== "PAUSED") return task;
  return { ...task, status: "ACTIVE", lastUpdatedAt: now.toISOString() };
}

export function cancelTask(task: SequenceTask, now: Date): SequenceTask {
  return { ...task, status: "CANCELLED", lastUpdatedAt: now.toISOString() };
}

/** Resets PROGRESS back to the start -- participants/order/progression rule
 *  are preserved (a "start over" mid-game keeps the same rules, just
 *  restarts the count), never silently re-derived from scratch. */
export function resetSequenceTask(task: SequenceTask, now: Date): SequenceTask {
  return {
    ...task,
    status: "ACTIVE",
    currentIndex: 0,
    currentValue: task.progression.kind === "NUMERIC" ? task.progression.start : null,
    lastUpdatedAt: now.toISOString(),
  };
}

/** Narrow, structural reorder parser -- "no, Test goes after Kwan" / "Test
 *  should go before Kwan" -- moves the first-named participant to
 *  immediately after/before the second-named one. Returns the task
 *  unchanged (not null -- callers already know a reorder was intended by
 *  the time they call this; an unrecognized shape just means no visible
 *  change) when the message doesn't match this specific structural
 *  pattern or either name isn't an actual task participant. Deliberately
 *  bounded rather than attempting general reorder NLU. */
const REORDER_RE = /\b(\w+)\s+(?:goes|should\s+go|comes)\s+(after|before)\s+(\w+)\b/i;

export function applyReorderInstruction(task: SequenceTask, text: string): SequenceTask {
  const match = text.match(REORDER_RE);
  if (!match) return task;
  const [, movedName, relation, anchorName] = match;
  const findByName = (name: string) => task.participants.find((p) => p.displayName.toLowerCase() === name.toLowerCase());
  const moved = findByName(movedName);
  const anchor = findByName(anchorName);
  if (!moved || !anchor || moved === anchor) return task;

  const without = task.participants.filter((p) => p !== moved);
  const anchorIndex = without.indexOf(anchor);
  const insertAt = relation.toLowerCase() === "after" ? anchorIndex + 1 : anchorIndex;
  const reordered = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];

  // Whoever's turn it currently WAS (by identity, not index) stays next --
  // reordering the list must not silently skip or repeat a turn.
  const currentParticipant = task.participants[task.currentIndex % task.participants.length];
  const newIndex = reordered.findIndex((p) => p === currentParticipant);

  return { ...task, participants: reordered, currentIndex: newIndex >= 0 ? newIndex : 0 };
}

/* ------------------------------------------------------------ advancement ---- */

export type AdvanceOutcome = "ADVANCED" | "COMPLETED" | "MISMATCH" | "NO_MATCH";

export interface AdvanceResult {
  task: SequenceTask;
  outcome: AdvanceOutcome;
}

/** Evaluates whether `text`, from `sender`, is the expected next
 *  contribution and advances the task if so. Never mutates task state on a
 *  mismatch or a message from the wrong participant -- MISMATCH/NO_MATCH
 *  both return the task UNCHANGED (aside from status), so a wrong guess or
 *  an unrelated remark can never silently corrupt progress. Only ACTIVE
 *  tasks can advance -- a PAUSED task always returns NO_MATCH regardless of
 *  content, which is what makes pausing actually freeze progression rather
 *  than merely being a status label. */
export function advanceSequenceTask(task: SequenceTask, sender: { kind: TaskParticipantKind; id: string }, text: string, now: Date): AdvanceResult {
  if (task.status !== "ACTIVE") return { task, outcome: "NO_MATCH" };

  const expected = expectedParticipant(task);
  if (expected.kind !== sender.kind || expected.id !== sender.id) return { task, outcome: "NO_MATCH" };

  if (task.progression.kind === "NUMERIC") {
    const trimmed = text.trim();
    if (trimmed !== String(task.currentValue)) {
      // A wrong deterministic value from the expected participant IS a real
      // mismatch (as opposed to an unrelated remark from someone else,
      // which is NO_MATCH above) -- logged by the caller, task stays
      // exactly as-is so the same participant simply gets another chance.
      return { task, outcome: trimmed.length > 0 && /^\d+$/.test(trimmed) ? "MISMATCH" : "NO_MATCH" };
    }
  }
  // FREEFORM: any non-empty content from the expected participant advances
  // -- there is no deterministic value to check.
  else if (!text.trim()) {
    return { task, outcome: "NO_MATCH" };
  }

  const nextIndex = (task.currentIndex + 1) % task.participants.length;
  const nextValue = task.progression.kind === "NUMERIC" ? task.progression.step + (task.currentValue ?? task.progression.start) : null;

  if (task.progression.kind === "NUMERIC" && nextValue !== null) {
    const pastEnd = task.progression.step > 0 ? nextValue > task.progression.end : nextValue < task.progression.end;
    if (pastEnd) {
      return { task: { ...task, status: "COMPLETED", lastUpdatedAt: now.toISOString() }, outcome: "COMPLETED" };
    }
  }

  return {
    task: { ...task, currentIndex: nextIndex, currentValue: nextValue, lastUpdatedAt: now.toISOString() },
    outcome: "ADVANCED",
  };
}
