import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAccountDateTime, COMMON_TIMEZONES, timezoneLabel, currentTimeExample } from "./watch-datetime";

const SAMPLE_ISO = "2026-08-18T14:30:00.000Z";

test("REQUIRED: formatAccountDateTime renders 24h format when requested", () => {
  const out = formatAccountDateTime(SAMPLE_ISO, { timezone: "UTC", timeFormat: "24h" });
  assert.match(out, /14:30/);
  assert.doesNotMatch(out, /PM|AM/);
});

test("REQUIRED: formatAccountDateTime renders 12h format with AM/PM when requested", () => {
  const out = formatAccountDateTime(SAMPLE_ISO, { timezone: "UTC", timeFormat: "12h" });
  assert.match(out, /PM/);
});

test("REQUIRED: the same instant renders a different clock time in a different timezone", () => {
  const utc = formatAccountDateTime(SAMPLE_ISO, { timezone: "UTC", timeFormat: "24h" });
  const manila = formatAccountDateTime(SAMPLE_ISO, { timezone: "Asia/Manila", timeFormat: "24h" });
  assert.notEqual(utc, manila);
  assert.match(manila, /22:30/); // UTC+8
});

test("formatAccountDateTime falls back to a safe rendering instead of throwing on an invalid stored timezone", () => {
  assert.doesNotThrow(() => formatAccountDateTime(SAMPLE_ISO, { timezone: "Not/AZone", timeFormat: "24h" }));
});

test("REQUIRED: every COMMON_TIMEZONES entry is a real, valid IANA timezone", () => {
  for (const tz of COMMON_TIMEZONES) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: tz }), `${tz} should be a real IANA zone`);
  }
});

test("timezoneLabel includes a real UTC offset, not a hardcoded/stale one", () => {
  const label = timezoneLabel("Asia/Manila");
  assert.match(label, /GMT\+8|UTC\+8/);
});

test("timezoneLabel never throws for an invalid zone -- falls back to the bare name", () => {
  assert.doesNotThrow(() => timezoneLabel("Not/AZone"));
});

test("REQUIRED: currentTimeExample changes when the timezone changes -- the dropdown example must adapt, not stay static", () => {
  const utc = currentTimeExample("UTC", "24h");
  const manila = currentTimeExample("Asia/Manila", "24h");
  assert.notEqual(utc, manila, "UTC and UTC+8 should show a different clock time (unless the coincidental edge-case minute crosses exactly at capture time)");
});

test("currentTimeExample respects the requested 12h/24h format for the SAME timezone", () => {
  const h24 = currentTimeExample("UTC", "24h");
  const h12 = currentTimeExample("UTC", "12h");
  assert.doesNotMatch(h24, /AM|PM/);
  assert.match(h12, /AM|PM/);
});

test("currentTimeExample never throws for an invalid timezone", () => {
  assert.doesNotThrow(() => currentTimeExample("Not/AZone", "24h"));
});
