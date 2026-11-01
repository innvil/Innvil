import test from "node:test";
import assert from "node:assert/strict";
import { supportEmailAlert, unreadStateForDirection } from "./thread-state";

test("incoming owner message is unread only for Innvil", () => {
  assert.deepEqual(unreadStateForDirection("inbound"), { ownerUnread: false, innvilUnread: true });
});

test("outgoing Innvil reply is unread only for its panel owner", () => {
  assert.deepEqual(unreadStateForDirection("outbound"), { ownerUnread: true, innvilUnread: false });
});

test("support email is an alert-only prompt, not a copy of the conversation", () => {
  assert.equal(supportEmailAlert("innvil"), "A panel owner sent a message. Open Innvil to read and reply in the conversation.");
  assert.equal(supportEmailAlert("owner"), "Innvil replied to your support conversation. Sign in to read and reply there.");
});
