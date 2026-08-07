import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProvisioningAttempt, verifyManagedBotIdentity } from "./correlation";

/* ---------------------------------------------- resolveProvisioningAttempt ---- */

test("resolveProvisioningAttempt: suggested username equals actual -> matches (regression case, spec §20)", () => {
  const result = resolveProvisioningAttempt([{ id: "attempt-1", suggestedUsername: "kaleb_bot" }], "kaleb_bot");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.attempt.id, "attempt-1");
});

test("resolveProvisioningAttempt: suggested username differs from actual (user changed it in Telegram) -> still matches (the core fix, spec §3/§20)", () => {
  const result = resolveProvisioningAttempt([{ id: "attempt-1", suggestedUsername: "kaleb_bot" }], "kaleb_mod_bot");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.attempt.id, "attempt-1");
});

test("resolveProvisioningAttempt: no pending candidates -> safe 'none', not a guess", () => {
  const result = resolveProvisioningAttempt([], "kaleb_mod_bot");
  assert.deepEqual(result, { ok: false, reason: "none" });
});

test("resolveProvisioningAttempt: multiple pending candidates, none match by username -> ambiguous, must not attach (tenant isolation, spec §8)", () => {
  const result = resolveProvisioningAttempt(
    [
      { id: "attempt-1", suggestedUsername: "mika_bot" },
      { id: "attempt-2", suggestedUsername: "kai_bot" },
    ],
    "kaleb_mod_bot"
  );
  assert.deepEqual(result, { ok: false, reason: "ambiguous" });
});

test("resolveProvisioningAttempt: multiple pending candidates, more than one match by username -> still ambiguous, must not guess", () => {
  const result = resolveProvisioningAttempt(
    [
      { id: "attempt-1", suggestedUsername: "kaleb_bot" },
      { id: "attempt-2", suggestedUsername: "kaleb_bot" },
    ],
    "kaleb_bot"
  );
  assert.deepEqual(result, { ok: false, reason: "ambiguous" });
});

test("resolveProvisioningAttempt: multiple pending candidates, exactly one matches by username -> username used as a tie-break hint (spec §8)", () => {
  const result = resolveProvisioningAttempt(
    [
      { id: "attempt-1", suggestedUsername: "mika_bot" },
      { id: "attempt-2", suggestedUsername: "kaleb_bot" },
    ],
    "kaleb_bot"
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.attempt.id, "attempt-2");
});

test("resolveProvisioningAttempt: username matching is case-insensitive", () => {
  const result = resolveProvisioningAttempt(
    [
      { id: "attempt-1", suggestedUsername: "mika_bot" },
      { id: "attempt-2", suggestedUsername: "Kaleb_Bot" },
    ],
    "kaleb_bot"
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.attempt.id, "attempt-2");
});

/* ------------------------------------------------- verifyManagedBotIdentity ---- */

test("verifyManagedBotIdentity: getMe id matches managed_bot.bot.id -> ok, returns canonical username", () => {
  const result = verifyManagedBotIdentity({ id: 123456789, username: "kaleb_mod_bot" }, 123456789);
  assert.deepEqual(result, { ok: true, username: "kaleb_mod_bot" });
});

test("verifyManagedBotIdentity: getMe id does NOT match managed_bot.bot.id -> fails safely (spec §6, test §21.4)", () => {
  const result = verifyManagedBotIdentity({ id: 999, username: "someone_else_bot" }, 123456789);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /does not match/);
});

test("verifyManagedBotIdentity: getMe returned nothing -> fails safely", () => {
  const result = verifyManagedBotIdentity(null, 123456789);
  assert.equal(result.ok, false);
});

test("verifyManagedBotIdentity: getMe has no username -> ok with null username, not a crash", () => {
  const result = verifyManagedBotIdentity({ id: 123456789, username: undefined }, 123456789);
  assert.deepEqual(result, { ok: true, username: null });
});
