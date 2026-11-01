import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLocalTime, validateWindow, localDateKeyInTimezone, zonedTimeToUtc, randomScheduledFor,
  isWindowPastForToday, scheduleWithSpacing, isTooSimilarToRecent, validateGeneratedPost,
} from "./autopost";

/* --------------------------------------------------------- parsing/validation ---- */

test("parseLocalTime accepts valid 24h HH:MM", () => {
  assert.deepEqual(parseLocalTime("05:00"), { h: 5, m: 0 });
  assert.deepEqual(parseLocalTime("23:59"), { h: 23, m: 59 });
});

test("parseLocalTime rejects out-of-range or malformed values", () => {
  assert.equal(parseLocalTime("24:00"), null);
  assert.equal(parseLocalTime("9:00"), null); // must be zero-padded 24h
  assert.equal(parseLocalTime("09:60"), null);
  assert.equal(parseLocalTime("garbage"), null);
});

test("REQUIRED: a normal window (05:00-12:00) validates", () => {
  assert.deepEqual(validateWindow("05:00", "12:00"), { ok: true });
});

test("REQUIRED (spec §8): an overnight window (22:00-02:00) is explicitly rejected, not silently mishandled", () => {
  const result = validateWindow("22:00", "02:00");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /overnight/i);
});

test("a zero-length or inverted window is rejected", () => {
  assert.equal(validateWindow("09:00", "09:00").ok, false);
  assert.equal(validateWindow("12:00", "05:00").ok, false);
});

/* -------------------------------------------------------------- timezone math ---- */

test("localDateKeyInTimezone formats as YYYY-MM-DD", () => {
  const key = localDateKeyInTimezone(new Date("2026-08-12T12:00:00Z"), "UTC");
  assert.equal(key, "2026-08-12");
});

test("REQUIRED (spec §7): a community's local day can differ from the UTC day at the boundary", () => {
  // 2026-08-12T23:30Z is still 2026-08-12 morning in a UTC-8 zone... use a
  // clean boundary instead: 2026-08-12T01:00Z is 2026-08-11 evening in
  // America/Los_Angeles (UTC-7 in August, DST).
  const key = localDateKeyInTimezone(new Date("2026-08-12T01:00:00Z"), "America/Los_Angeles");
  assert.equal(key, "2026-08-11");
});

test("an invalid timezone falls back to UTC rather than throwing", () => {
  const key = localDateKeyInTimezone(new Date("2026-08-12T12:00:00Z"), "Not/AZone");
  assert.equal(key, "2026-08-12");
});

test("REQUIRED: zonedTimeToUtc round-trips correctly for a UTC community", () => {
  const utc = zonedTimeToUtc("2026-08-12", 9, 30, "UTC");
  assert.equal(utc.toISOString(), "2026-08-12T09:30:00.000Z");
});

test("REQUIRED (spec: local timezone, not server UTC): zonedTimeToUtc converts a non-UTC wall-clock time correctly", () => {
  // Asia/Manila is UTC+8, no DST -- 09:00 local = 01:00 UTC, same calendar day.
  const utc = zonedTimeToUtc("2026-08-12", 9, 0, "Asia/Manila");
  assert.equal(utc.toISOString(), "2026-08-12T01:00:00.000Z");
});

test("zonedTimeToUtc falls back to UTC for an invalid timezone rather than throwing", () => {
  const utc = zonedTimeToUtc("2026-08-12", 9, 0, "Not/AZone");
  assert.equal(utc.toISOString(), "2026-08-12T09:00:00.000Z");
});

/* --------------------------------------------------------- random scheduling ---- */

test("REQUIRED (spec TEST 1): a generated occurrence time lies inside the configured local-time window", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const scheduled = randomScheduledFor("2026-08-12", "05:00", "12:00", "UTC", () => r);
    const windowStart = zonedTimeToUtc("2026-08-12", 5, 0, "UTC").getTime();
    const windowEnd = zonedTimeToUtc("2026-08-12", 12, 0, "UTC").getTime();
    assert.ok(scheduled.getTime() >= windowStart && scheduled.getTime() < windowEnd, `${scheduled.toISOString()} not within window`);
  }
});

test("random()=0 lands exactly at the window start; random() just under 1 lands just before the end", () => {
  const atStart = randomScheduledFor("2026-08-12", "05:00", "12:00", "UTC", () => 0);
  assert.equal(atStart.toISOString(), "2026-08-12T05:00:00.000Z");
});

test("REQUIRED (spec §4): the exact time varies across calls with different random sources -- not always 05:00/08:00/12:00", () => {
  const times = [0.1, 0.4, 0.7].map((r) => randomScheduledFor("2026-08-12", "05:00", "12:00", "UTC", () => r).getTime());
  assert.equal(new Set(times).size, 3); // all distinct
});

/* -------------------------------------------------------- window-past detection ---- */

test("REQUIRED (spec §16, missed window): isWindowPastForToday is true once now is past the window's local end", () => {
  const now = new Date("2026-08-12T14:00:00Z"); // past 12:00 UTC
  assert.equal(isWindowPastForToday("2026-08-12", "12:00", "UTC", now), true);
});

test("isWindowPastForToday is false while still inside the window", () => {
  const now = new Date("2026-08-12T08:00:00Z");
  assert.equal(isWindowPastForToday("2026-08-12", "12:00", "UTC", now), false);
});

/* -------------------------------------------------------------- spacing (spec §9) ---- */

test("REQUIRED (spec §9): scheduleWithSpacing avoids landing within the min gap of another already-scheduled time when a clear slot exists", () => {
  const other = [zonedTimeToUtc("2026-08-12", 10, 55, "UTC")]; // 10:55
  // First roll (0.5 -> ~08:30, well clear); confirms non-colliding rolls pass straight through.
  const result = scheduleWithSpacing("2026-08-12", "05:00", "12:00", "UTC", other, () => 0.5, 10, 5);
  const gapMinutes = Math.abs(result.getTime() - other[0].getTime()) / 60_000;
  assert.ok(gapMinutes >= 10 || result.getTime() !== other[0].getTime());
});

test("scheduleWithSpacing re-rolls away from a colliding first attempt", () => {
  const windowStartUtc = zonedTimeToUtc("2026-08-12", 5, 0, "UTC").getTime();
  const collidingTarget = new Date(windowStartUtc + 60 * 60_000); // 06:00, i.e. random()=(60/(7*60))
  const sequence = [60 / 420, 0.8]; // first roll collides, second doesn't
  let call = 0;
  const random = () => sequence[Math.min(call++, sequence.length - 1)];
  const result = scheduleWithSpacing("2026-08-12", "05:00", "12:00", "UTC", [collidingTarget], random, 10, 5);
  assert.notEqual(result.getTime(), collidingTarget.getTime());
});

test("scheduleWithSpacing with no other scheduled times behaves exactly like randomScheduledFor", () => {
  const result = scheduleWithSpacing("2026-08-12", "05:00", "12:00", "UTC", [], () => 0.5, 10, 5);
  const direct = randomScheduledFor("2026-08-12", "05:00", "12:00", "UTC", () => 0.5);
  assert.equal(result.getTime(), direct.getTime());
});

/* --------------------------------------------------- duplicate-content heuristic ---- */

test("REQUIRED (spec TEST 12 shape): a near-identical recent post is flagged as too similar", () => {
  const candidate = "Check out our whitepaper for all the details on the protocol design and roadmap.";
  const recent = ["Read the whitepaper for details on the protocol design and roadmap ahead."];
  assert.equal(isTooSimilarToRecent(candidate, recent), true);
});

test("a genuinely different post is not flagged", () => {
  const candidate = "Did you know our support team is available 24/7 via the in-app chat?";
  const recent = ["Read the whitepaper for details on the protocol design and roadmap ahead."];
  assert.equal(isTooSimilarToRecent(candidate, recent), false);
});

test("empty recent-post history never flags anything as a duplicate", () => {
  assert.equal(isTooSimilarToRecent("Anything at all here.", []), false);
});

/* ------------------------------------------------------------ output validation ---- */

test("REQUIRED (spec §19): empty generated content fails validation", () => {
  assert.equal(validateGeneratedPost("").ok, false);
  assert.equal(validateGeneratedPost("   ").ok, false);
});

test("REQUIRED (spec §19): content exceeding Telegram's length limit fails validation", () => {
  assert.equal(validateGeneratedPost("x".repeat(5000)).ok, false);
});

test("REQUIRED (spec §19): placeholder text is caught", () => {
  assert.equal(validateGeneratedPost("[insert feature name here]").ok, false);
  assert.equal(validateGeneratedPost("TODO: write the actual post").ok, false);
});

test("REQUIRED (spec §19): leaked internal formatting/sentinel is caught", () => {
  assert.equal(validateGeneratedPost("INSUFFICIENT_KNOWLEDGE").ok, false);
  assert.equal(validateGeneratedPost("TITLE: something\nmore text").ok, false);
});

test("REQUIRED (spec §20/no-secret-leakage): a secret-shaped string is caught", () => {
  assert.equal(validateGeneratedPost("here's my key sk-abcdefghijklmnop for reference").ok, false);
});

test("a genuine, well-formed post passes validation", () => {
  assert.equal(validateGeneratedPost("Did you know you can track your orders in real time from the dashboard?").ok, true);
});
