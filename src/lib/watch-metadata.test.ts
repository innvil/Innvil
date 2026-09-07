import { test } from "node:test";
import assert from "node:assert/strict";
import { watchPageMetadata, WATCH_TITLE, WATCH_DESCRIPTION, WATCH_SITE_NAME, WATCH_BASE_URL, WATCH_KEYWORDS } from "./watch-metadata";

const BAD_SMM_TITLE = "Innvil — SMM Panel Making & Managing, Made Easy";

test("REQUIRED: Watch title never matches the generic SMM Panel title", () => {
  assert.notEqual(WATCH_TITLE, BAD_SMM_TITLE);
  assert.ok(!WATCH_TITLE.toLowerCase().includes("smm panel"));
});

test("REQUIRED: Watch description communicates Watchers / AI moderation / community operations, never SMM Panel copy", () => {
  const lower = WATCH_DESCRIPTION.toLowerCase();
  assert.ok(lower.includes("watcher"));
  assert.ok(lower.includes("moderat"));
  assert.ok(!lower.includes("smm panel"));
});

test("REQUIRED: watchPageMetadata sets a Watch-specific openGraph title/description/siteName", () => {
  const meta = watchPageMetadata("/login");
  assert.equal(meta.openGraph.title, WATCH_TITLE);
  assert.equal(meta.openGraph.description, WATCH_DESCRIPTION);
  assert.equal(meta.openGraph.siteName, WATCH_SITE_NAME);
  assert.equal(meta.openGraph.url, `${WATCH_BASE_URL}/login`);
});

test("REQUIRED: watchPageMetadata's og:url and canonical are REAL ABSOLUTE watch.innvil.cloud URLs -- never a relative path that could resolve against the main Innvil site's metadataBase", () => {
  const meta = watchPageMetadata("/");
  assert.equal(WATCH_BASE_URL, "https://watch.innvil.cloud");
  assert.equal(meta.openGraph.url, "https://watch.innvil.cloud/");
  assert.equal(meta.alternates.canonical, "https://watch.innvil.cloud/");
  assert.doesNotMatch(meta.alternates.canonical, /^\/(?!\/)/, "must never be a bare relative path");
});

test("REQUIRED: watchPageMetadata sets real, Watch/Telegram-specific keywords -- overriding the root layout's own SMM-panel keywords, never inheriting them", () => {
  const meta = watchPageMetadata("/");
  assert.deepEqual(meta.keywords, WATCH_KEYWORDS);
  const joined = meta.keywords.join(" ").toLowerCase();
  assert.ok(!joined.includes("smm panel"), "must never carry the main site's unrelated SMM-panel keywords");
  assert.ok(joined.includes("telegram"), "must be Telegram-specific");
});

test("REQUIRED: watchPageMetadata sets Twitter card metadata too -- not just Open Graph", () => {
  const meta = watchPageMetadata("/");
  assert.equal(meta.twitter.title, WATCH_TITLE);
  assert.equal(meta.twitter.description, WATCH_DESCRIPTION);
  assert.equal(meta.twitter.card, "summary");
});

test("watchPageMetadata never leaks generic SMM Panel copy into any field", () => {
  const meta = watchPageMetadata("/signup");
  const serialized = JSON.stringify(meta).toLowerCase();
  assert.ok(!serialized.includes("smm panel"));
});

test("watchPageMetadata's url reflects the given path, so every route gets a distinct canonical og:url", () => {
  assert.equal(watchPageMetadata("/plans").openGraph.url, `${WATCH_BASE_URL}/plans`);
  assert.equal(watchPageMetadata("/billing").openGraph.url, `${WATCH_BASE_URL}/billing`);
});
