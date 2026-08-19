import { test } from "node:test";
import assert from "node:assert/strict";
import { addOneMonthClamped, computeRenewedPeriod, periodHasExpired } from "./watch-billing-period";

/* ------------------------------------------------------- addOneMonthClamped ---- */

test("REQUIRED: addOneMonthClamped matches the spec's worked example -- Aug 19 -> Sep 19", () => {
  const result = addOneMonthClamped(new Date("2026-08-19T10:00:00.000Z"));
  assert.equal(result.toISOString().slice(0, 10), "2026-09-19");
});

test("addOneMonthClamped chains correctly -- Sep 19 -> Oct 19", () => {
  const result = addOneMonthClamped(new Date("2026-09-19T10:00:00.000Z"));
  assert.equal(result.toISOString().slice(0, 10), "2026-10-19");
});

test("REQUIRED: addOneMonthClamped clamps day-overflow like Postgres, never spills into a later month", () => {
  const result = addOneMonthClamped(new Date("2026-01-31T00:00:00.000Z"));
  assert.equal(result.toISOString().slice(0, 10), "2026-02-28"); // 2026 is not a leap year
});

test("addOneMonthClamped handles a leap-year February correctly", () => {
  const result = addOneMonthClamped(new Date("2028-01-31T00:00:00.000Z"));
  assert.equal(result.toISOString().slice(0, 10), "2028-02-29");
});

test("addOneMonthClamped preserves time-of-day", () => {
  const result = addOneMonthClamped(new Date("2026-08-19T14:33:07.000Z"));
  assert.equal(result.toISOString(), "2026-09-19T14:33:07.000Z");
});

/* ----------------------------------------------------- computeRenewedPeriod ---- */

test("REQUIRED: initial purchase (no existing period) starts a fresh period from now", () => {
  const now = new Date("2026-08-19T12:00:00.000Z");
  const period = computeRenewedPeriod(null, now);
  assert.equal(period.start, now.toISOString());
  assert.equal(period.end.slice(0, 10), "2026-09-19");
});

test("REQUIRED: early renewal extends from the EXISTING period end, not the payment date", () => {
  // Existing period ends Sep 19; customer pays early on Sep 15.
  const existingEnd = "2026-09-19T00:00:00.000Z";
  const paidAt = new Date("2026-09-15T00:00:00.000Z");
  const period = computeRenewedPeriod(existingEnd, paidAt);
  assert.equal(period.end.slice(0, 10), "2026-10-19", "must extend Sep19->Oct19, never Sep15->Oct15");
});

test("REQUIRED: late renewal (after expiry) starts a fresh period from the confirmed settlement time, never retroactively", () => {
  // Existing period expired Sep 19; customer pays Sep 23.
  const existingEnd = "2026-09-19T00:00:00.000Z";
  const paidAt = new Date("2026-09-23T00:00:00.000Z");
  const period = computeRenewedPeriod(existingEnd, paidAt);
  assert.equal(period.start, paidAt.toISOString());
  assert.equal(period.end.slice(0, 10), "2026-10-23", "must be Sep23->Oct23, never Sep19->Oct19");
});

test("renewal exactly AT the period boundary is treated as expired (start fresh from now), not still-active", () => {
  const existingEnd = "2026-09-19T00:00:00.000Z";
  const now = new Date("2026-09-19T00:00:00.000Z");
  const period = computeRenewedPeriod(existingEnd, now);
  assert.equal(period.start, now.toISOString());
});

/* -------------------------------------------------------- periodHasExpired ---- */

test("REQUIRED: a NULL period end is never treated as expired -- the legacy grandfather state", () => {
  assert.equal(periodHasExpired(null), false);
});

test("periodHasExpired is true once the end has passed", () => {
  assert.equal(periodHasExpired("2020-01-01T00:00:00.000Z"), true);
});

test("periodHasExpired is false for a future end", () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  assert.equal(periodHasExpired(future), false);
});
