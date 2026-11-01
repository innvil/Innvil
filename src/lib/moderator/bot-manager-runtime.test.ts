import { test } from "node:test";
import assert from "node:assert/strict";
import { isBareStartInPrivateChat } from "./bot-manager-runtime";
import type { TelegramMessage } from "./community-runtime";

/**
 * REQUIRED (2026-08-23 fix): a guest who taps Telegram's own "Start" button
 * on innvil_bot_manager (a bare `/start`, no deep-link token) previously got
 * silence -- it fell through to the reactive-support classifier, which
 * correctly never treats "/start" as a confident product question. This is
 * the deterministic detector that now short-circuits BEFORE that classifier,
 * so a bare Start always gets a real welcome. `handleAccountVerificationStart`
 * (checked earlier in the dispatch chain, not re-tested here) already fully
 * owns the WITH-token case -- this function must never fire for that shape.
 */

function msg(overrides: Partial<TelegramMessage> & { chatType?: string }): TelegramMessage {
  const { chatType, ...rest } = overrides;
  return {
    message_id: 1,
    chat: { id: 123, type: chatType ?? "private" },
    text: "/start",
    ...rest,
  };
}

test("REQUIRED: a bare /start in a private chat is detected", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start" })), true);
});

test("a bare /start with trailing whitespace is still detected", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start   " })), true);
});

test("/start@botusername (no token) is still detected as bare", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start@innvil_official_bot" })), true);
});

test("REQUIRED: /start WITH a token is never treated as bare -- handleAccountVerificationStart owns that case", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start abc123token" })), false);
});

test("REQUIRED: a bare /start in a GROUP chat is never treated as this welcome -- Telegram's Start button is private-chat only", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start", chatType: "group" })), false);
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start", chatType: "supergroup" })), false);
  assert.equal(isBareStartInPrivateChat(msg({ text: "/start", chatType: "channel" })), false);
});

test("an ordinary message (not /start at all) is never detected", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: "what does innvil watch cost?" })), false);
});

test("a message with no text at all is never detected", () => {
  assert.equal(isBareStartInPrivateChat(msg({ text: undefined })), false);
});
