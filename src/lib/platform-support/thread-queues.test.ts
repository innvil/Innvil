import test from "node:test";
import assert from "node:assert/strict";
import { innvilSupportQueue } from "./thread-queues";
import type { PlatformSupportThread } from "@/src/lib/actions/platform-support";

function thread(overrides: Partial<PlatformSupportThread> = {}): PlatformSupportThread {
  return {
    id: "thread-1",
    subject: "Support",
    status: "open",
    lastDirection: "outbound",
    originKind: "general",
    unread: false,
    lastMessageAt: "2026-10-31T00:00:00.000Z",
    ...overrides,
  };
}

test("automated welcomes stay out of the operational inbox until the owner responds", () => {
  assert.equal(innvilSupportQueue(thread({ originKind: "onboarding_draft_nudge" })), "automated");
});

test("an owner reply, including to an automated welcome, enters the responses inbox", () => {
  assert.equal(innvilSupportQueue(thread({ originKind: "onboarding_draft_nudge", lastDirection: "inbound" })), "responses");
});

test("regular outbound conversations stay in the open queue until addressed", () => {
  assert.equal(innvilSupportQueue(thread()), "open");
});

test("addressed conversations leave their active queue and return to the addressed inbox", () => {
  assert.equal(innvilSupportQueue(thread({ status: "resolved", lastDirection: "inbound" })), "addressed");
});
