import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectSequenceTaskIntent, classifyTaskInstruction, pauseTask, resumeTask, cancelTask, resetSequenceTask,
  applyReorderInstruction, advanceSequenceTask, isTaskExpired, expectedParticipant, expectedNumericValue,
  TASK_TTL_MS, type SequenceTask, type TaskModeratorIdentity,
} from "./task-state";

/**
 * Temporary conversational task state -- normal group chat stays turn-free
 * (chatter-coordinator.ts); this is the separate, explicit mechanism for
 * when a human establishes a multi-step shared activity. Pure module, no
 * I/O -- these test the actual state transitions directly.
 */

const NOVA: TaskModeratorIdentity = { deploymentId: "dep-nova", name: "Nova" };
const ECHO: TaskModeratorIdentity = { deploymentId: "dep-echo", name: "Echo" };
const HUMAN_ID = "human-K";
const now = () => new Date("2026-08-11T12:00:00Z");

/* ---------------------------------------------------------------- detection ---- */

test("REQUIRED (exact live repro): \"let us all count. I'll start with 1. Test goes 2, Kwan 3, then I do 4 until 20\" creates a NUMERIC task with the right order/step/end", () => {
  const KWAN: TaskModeratorIdentity = { deploymentId: "dep-kwan", name: "Kwan" };
  const TEST_MOD: TaskModeratorIdentity = { deploymentId: "dep-test", name: "Test" };
  const task = detectSequenceTaskIntent(
    "let us all count. I'll start with 1. Test goes 2, Kwan 3, then I do 4 until 20",
    [TEST_MOD, KWAN],
    HUMAN_ID,
    now(),
    "msg-1"
  );
  assert.ok(task);
  assert.equal(task!.type, "SEQUENCE");
  assert.equal(task!.status, "ACTIVE");
  assert.deepEqual(
    task!.participants.map((p) => p.id),
    [HUMAN_ID, "dep-test", "dep-kwan"]
  );
  assert.deepEqual(task!.progression, { kind: "NUMERIC", start: 1, step: 1, end: 20 });
  assert.equal(task!.currentIndex, 0);
  assert.equal(task!.currentValue, 1);
});

test("REQUIRED (dynamic moderators, not Kwan/Test fixtures): the SAME detection works for entirely different fictional moderator names", () => {
  const task = detectSequenceTaskIntent("let's count, I'll start with 1. Nova goes 2, Echo 3, then I do 4 until 10", [NOVA, ECHO], HUMAN_ID, now(), "msg-1");
  assert.ok(task);
  assert.deepEqual(
    task!.participants.map((p) => p.id),
    [HUMAN_ID, "dep-nova", "dep-echo"]
  );
});

test("a plain \"tell me a joke\" does NOT create persistent task state", () => {
  const task = detectSequenceTaskIntent("tell me a joke", [NOVA, ECHO], HUMAN_ID, now(), "msg-1");
  assert.equal(task, null);
});

test("a counting mention with no end value does not create a task (nothing deterministic to enforce)", () => {
  const task = detectSequenceTaskIntent("let's count, I'll start with 1, Nova goes 2", [NOVA, ECHO], HUMAN_ID, now(), "msg-1");
  assert.equal(task, null);
});

test("a counting mention with only ONE participant assigned a number does not create a task -- turn-taking needs 2+", () => {
  const task = detectSequenceTaskIntent("I'll count to 20 by myself, 1", [NOVA, ECHO], HUMAN_ID, now(), "msg-1");
  assert.equal(task, null);
});

test("REQUIRED: ordinary messages that happen to contain numbers never accidentally arm a task (no counting cue at all)", () => {
  const examples = ["Nova, can you check order 20?", "I have 4 questions, then I'll ask 2 more", "meet me at 3, Echo will be there"];
  for (const text of examples) {
    assert.equal(detectSequenceTaskIntent(text, [NOVA, ECHO], HUMAN_ID, now(), "msg-1"), null, `should not create a task: "${text}"`);
  }
});

/* ------------------------------------------------------------- control instructions ---- */

test('REQUIRED (wait instruction): "wait for me to start, lol" classifies as PAUSE, not a turn contribution', () => {
  assert.equal(classifyTaskInstruction("wait for me to start, lol"), "PAUSE");
});

test('"hold on" / "don\'t start yet" / "pause" all classify as PAUSE -- generalizes, not one fixed phrase', () => {
  for (const text of ["hold on", "hold up", "don't start yet", "pause"]) {
    assert.equal(classifyTaskInstruction(text), "PAUSE", `expected PAUSE: "${text}"`);
  }
});

test('"start over" / "reset" / "restart" all classify as RESET', () => {
  for (const text of ["start over", "reset", "restart"]) {
    assert.equal(classifyTaskInstruction(text), "RESET", `expected RESET: "${text}"`);
  }
});

test('"never mind" / "cancel" / "stop" / "forget it" all classify as CANCEL', () => {
  for (const text of ["never mind", "nevermind", "cancel", "stop", "forget it"]) {
    assert.equal(classifyTaskInstruction(text), "CANCEL", `expected CANCEL: "${text}"`);
  }
});

test("an ordinary turn contribution (\"1\") is not misclassified as any control instruction", () => {
  assert.equal(classifyTaskInstruction("1"), null);
});

test("CANCEL/RESET take precedence over the broader PAUSE cue when both could plausibly apply", () => {
  assert.equal(classifyTaskInstruction("stop, let's start over"), "CANCEL");
});

/* -------------------------------------------------------------------- lifecycle ---- */

function baseTask(over: Partial<SequenceTask> = {}): SequenceTask {
  return {
    type: "SEQUENCE",
    status: "ACTIVE",
    participants: [
      { kind: "HUMAN", id: HUMAN_ID, displayName: "You" },
      { kind: "MODERATOR", id: "dep-nova", displayName: "Nova" },
      { kind: "MODERATOR", id: "dep-echo", displayName: "Echo" },
    ],
    currentIndex: 0,
    progression: { kind: "NUMERIC", start: 1, step: 1, end: 20 },
    currentValue: 1,
    createdFromMessageId: "msg-1",
    initiatingPlatformId: HUMAN_ID,
    createdAt: now().toISOString(),
    lastUpdatedAt: now().toISOString(),
    ...over,
  };
}

test("REQUIRED (wrong old behavior regression): before the user starts, a moderator's turn is never reached -- currentIndex is the human's (0)", () => {
  const task = baseTask();
  const expected = expectedParticipant(task);
  assert.equal(expected.kind, "HUMAN");
});

test("REQUIRED (wait instruction does not advance): \"wait for me to start, lol\" from the human does not match the expected value and does not advance", () => {
  const task = baseTask();
  const result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "wait for me to start, lol", now());
  assert.equal(result.outcome, "NO_MATCH");
  assert.equal(result.task.currentIndex, 0);
  assert.equal(result.task.currentValue, 1);
});

test("REQUIRED (exact sequence): user \"1\" -> Test/Nova becomes next expected, value 2; Nova \"2\" -> Echo next, value 3; Echo \"3\" -> human next, value 4", () => {
  let task = baseTask();
  let result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "1", now());
  assert.equal(result.outcome, "ADVANCED");
  task = result.task;
  assert.equal(expectedParticipant(task).id, "dep-nova");
  assert.equal(expectedNumericValue(task), 2);

  result = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-nova" }, "2", now());
  assert.equal(result.outcome, "ADVANCED");
  task = result.task;
  assert.equal(expectedParticipant(task).id, "dep-echo");
  assert.equal(expectedNumericValue(task), 3);

  result = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-echo" }, "3", now());
  assert.equal(result.outcome, "ADVANCED");
  task = result.task;
  assert.equal(expectedParticipant(task).kind, "HUMAN");
  assert.equal(expectedNumericValue(task), 4);
});

test("REQUIRED (task-local override): while Echo is expected, Nova is NOT eligible to act even though Nova could plausibly be picked by ordinary quietest-longest/continuity logic", () => {
  const task = baseTask({ currentIndex: 2 }); // Echo's turn
  assert.equal(expectedParticipant(task).id, "dep-echo");
  const novaAttempt = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-nova" }, "3", now());
  assert.equal(novaAttempt.outcome, "NO_MATCH");
  assert.equal(novaAttempt.task.currentIndex, 2); // unchanged -- Echo is still expected
});

test("REQUIRED (human turn = wait, no generation): when the next expected participant is HUMAN, there is nothing for a moderator to send -- expectedNumericValue is only ever consulted for a MODERATOR's own turn by the caller", () => {
  const task = baseTask({ currentIndex: 0 }); // human's turn
  assert.equal(expectedParticipant(task).kind, "HUMAN");
  // A moderator attempting to act on the human's turn does not advance:
  const modAttempt = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-nova" }, "1", now());
  assert.equal(modAttempt.outcome, "NO_MATCH");
});

test("REQUIRED (invalid progression / mismatch): the expected participant sending the WRONG value does not silently advance -- logged as MISMATCH, state unchanged", () => {
  const task = baseTask({ currentIndex: 1, currentValue: 2 }); // Nova expected, value 2
  const result = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-nova" }, "3", now());
  assert.equal(result.outcome, "MISMATCH");
  assert.equal(result.task.currentIndex, 1);
  assert.equal(result.task.currentValue, 2);
});

test("REQUIRED (reset): mid-task, RESET returns to the start with the SAME participants/order/progression, not a fresh re-derivation", () => {
  let task = baseTask();
  task = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "1", now()).task;
  task = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-nova" }, "2", now()).task;
  const reset = resetSequenceTask(task, now());
  assert.equal(reset.status, "ACTIVE");
  assert.equal(reset.currentIndex, 0);
  assert.equal(reset.currentValue, 1);
  assert.deepEqual(reset.participants, task.participants);
});

test("REQUIRED (cancel): \"never mind\" cancels the task -- CANCELLED is terminal", () => {
  const task = baseTask();
  const cancelled = cancelTask(task, now());
  assert.equal(cancelled.status, "CANCELLED");
});

test("pause freezes progression regardless of content -- even a matching value does not advance a PAUSED task", () => {
  const task = pauseTask(baseTask(), now());
  assert.equal(task.status, "PAUSED");
  const result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "1", now());
  assert.equal(result.outcome, "NO_MATCH");
});

test("resume returns a PAUSED task to ACTIVE without touching progress", () => {
  const paused = pauseTask(baseTask({ currentIndex: 1, currentValue: 2 }), now());
  const resumed = resumeTask(paused, now());
  assert.equal(resumed.status, "ACTIVE");
  assert.equal(resumed.currentIndex, 1);
  assert.equal(resumed.currentValue, 2);
});

test("resume on a non-PAUSED task is a no-op", () => {
  const task = baseTask();
  assert.deepEqual(resumeTask(task, now()), task);
});

test("REQUIRED (changed order): \"no, Test goes after Kwan\" reorders participants, and the CURRENTLY expected participant's turn is preserved by identity, not skipped/repeated", () => {
  const task: SequenceTask = {
    ...baseTask({ currentIndex: 1 }), // Nova's turn
    participants: [
      { kind: "HUMAN", id: HUMAN_ID, displayName: "You" },
      { kind: "MODERATOR", id: "dep-nova", displayName: "Nova" },
      { kind: "MODERATOR", id: "dep-echo", displayName: "Echo" },
    ],
  };
  const reordered = applyReorderInstruction(task, "no, Nova goes after Echo");
  assert.deepEqual(
    reordered.participants.map((p) => p.displayName),
    ["You", "Echo", "Nova"]
  );
  // Nova was expected before the reorder and must still be expected after it.
  assert.equal(expectedParticipant(reordered).id, "dep-nova");
});

test("an unrecognized reorder shape leaves the task unchanged rather than guessing", () => {
  const task = baseTask();
  const result = applyReorderInstruction(task, "everyone should be nicer to each other");
  assert.deepEqual(result, task);
});

test("REQUIRED (completion): reaching the end value marks the task COMPLETED, not ADVANCED", () => {
  const task = baseTask({ currentIndex: 2, currentValue: 20 }); // Echo's turn, last value
  const result = advanceSequenceTask(task, { kind: "MODERATOR", id: "dep-echo" }, "20", now());
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.task.status, "COMPLETED");
});

test("REQUIRED: a COMPLETED task never advances further even if someone sends the next number anyway", () => {
  const task = baseTask({ status: "COMPLETED" });
  const result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "1", now());
  assert.equal(result.outcome, "NO_MATCH");
});

/* -------------------------------------------------------------------------- TTL ---- */

test("REQUIRED: a task untouched for longer than TASK_TTL_MS is expired", () => {
  const staleTask = baseTask({ lastUpdatedAt: new Date(now().getTime() - TASK_TTL_MS - 1000).toISOString() });
  assert.equal(isTaskExpired(staleTask, now()), true);
});

test("a task updated within the TTL window is not expired", () => {
  const freshTask = baseTask({ lastUpdatedAt: new Date(now().getTime() - 60_000).toISOString() });
  assert.equal(isTaskExpired(freshTask, now()), false);
});

test("a COMPLETED/CANCELLED task is never considered expired -- it's already terminal", () => {
  assert.equal(isTaskExpired(baseTask({ status: "COMPLETED", lastUpdatedAt: new Date(0).toISOString() }), now()), false);
  assert.equal(isTaskExpired(baseTask({ status: "CANCELLED", lastUpdatedAt: new Date(0).toISOString() }), now()), false);
});

/* ------------------------------------------------------------ freeform sequences ---- */

test("FREEFORM progression advances on any non-empty content from the expected participant, with no deterministic value to check", () => {
  const task = baseTask({ progression: { kind: "FREEFORM" }, currentValue: null });
  const result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "France", now());
  assert.equal(result.outcome, "ADVANCED");
  assert.equal(expectedNumericValue(result.task), null);
});

test("FREEFORM progression does not advance on an empty message", () => {
  const task = baseTask({ progression: { kind: "FREEFORM" }, currentValue: null });
  const result = advanceSequenceTask(task, { kind: "HUMAN", id: HUMAN_ID }, "   ", now());
  assert.equal(result.outcome, "NO_MATCH");
});
