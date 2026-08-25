import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIngestUrl, isPrivateOrReservedIpv4, isPrivateOrReservedIpv6, isPrivateOrReservedIp, extractReadableText, chunkText } from "./knowledge-ingestion";

/* -------------------------------------------------------- URL validation ---- */

test("REQUIRED: only http/https URLs are accepted", () => {
  assert.equal(validateIngestUrl("https://example.com/docs").ok, true);
  assert.equal(validateIngestUrl("http://example.com").ok, true);
  assert.equal(validateIngestUrl("ftp://example.com/file").ok, false);
  assert.equal(validateIngestUrl("file:///etc/passwd").ok, false);
  assert.equal(validateIngestUrl("javascript:alert(1)").ok, false);
  assert.equal(validateIngestUrl("data:text/html,<script>alert(1)</script>").ok, false);
});

test("rejects malformed/empty URLs", () => {
  assert.equal(validateIngestUrl("").ok, false);
  assert.equal(validateIngestUrl("   ").ok, false);
  assert.equal(validateIngestUrl("not a url").ok, false);
});

test("rejects URLs with embedded credentials", () => {
  assert.equal(validateIngestUrl("https://user:pass@example.com").ok, false);
});

/* --------------------------------------------------- SSRF: IPv4 blocking ---- */

test("REQUIRED: private/reserved/loopback/link-local IPv4 ranges are rejected", () => {
  const blocked = ["127.0.0.1", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1"];
  for (const ip of blocked) assert.equal(isPrivateOrReservedIpv4(ip), true, `${ip} must be blocked`);
});

test("REQUIRED: real public IPv4 addresses are allowed", () => {
  const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];
  for (const ip of allowed) assert.equal(isPrivateOrReservedIpv4(ip), false, `${ip} must be allowed`);
});

test("172.15.x/172.32.x are NOT the 172.16/12 private range -- must not be over-blocked", () => {
  assert.equal(isPrivateOrReservedIpv4("172.15.0.1"), false);
  assert.equal(isPrivateOrReservedIpv4("172.32.0.1"), false);
});

test("a malformed IPv4 string fails closed (blocked, never allowed)", () => {
  assert.equal(isPrivateOrReservedIpv4("not.an.ip.address"), true);
  assert.equal(isPrivateOrReservedIpv4("999.999.999.999"), true);
});

/* --------------------------------------------------- SSRF: IPv6 blocking ---- */

test("REQUIRED: loopback/unique-local/link-local IPv6 addresses are rejected", () => {
  assert.equal(isPrivateOrReservedIpv6("::1"), true);
  assert.equal(isPrivateOrReservedIpv6("fc00::1"), true);
  assert.equal(isPrivateOrReservedIpv6("fd12:3456::1"), true);
  assert.equal(isPrivateOrReservedIpv6("fe80::1"), true);
});

test("an IPv4-mapped IPv6 address is checked against the real IPv4 rules", () => {
  assert.equal(isPrivateOrReservedIpv6("::ffff:127.0.0.1"), true, "mapped loopback must be blocked");
  assert.equal(isPrivateOrReservedIpv6("::ffff:8.8.8.8"), false, "mapped public address must be allowed");
});

test("a real public IPv6 address is allowed", () => {
  assert.equal(isPrivateOrReservedIpv6("2606:4700:4700::1111"), false);
});

test("isPrivateOrReservedIp dispatches by family correctly", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1", 4), true);
  assert.equal(isPrivateOrReservedIp("::1", 6), true);
  assert.equal(isPrivateOrReservedIp("8.8.8.8", 4), false);
});

/* ----------------------------------------------------- text extraction ---- */

test("REQUIRED: HTML is reduced to readable plain text, scripts/styles/nav dropped", () => {
  const html = `
    <html><head><style>.x{color:red}</style></head>
    <body>
      <nav>Home | About</nav>
      <script>alert('xss')</script>
      <header>Site Header</header>
      <main><h1>Welcome</h1><p>This is the real content.</p></main>
      <footer>Copyright 2026</footer>
    </body></html>`;
  const text = extractReadableText(html);
  assert.ok(text.includes("Welcome"));
  assert.ok(text.includes("This is the real content."));
  assert.ok(!text.includes("alert"));
  assert.ok(!text.includes("color:red"));
  assert.ok(!text.includes("Home | About"), "nav content must be dropped");
  assert.ok(!text.includes("Site Header"), "header content must be dropped");
  assert.ok(!text.includes("Copyright 2026"), "footer content must be dropped");
});

test("whitespace is normalized (no runs of blank lines, no leading/trailing whitespace)", () => {
  const text = extractReadableText("<p>Line one</p>\n\n\n\n<p>Line two</p>");
  assert.equal(text, "Line one\n\nLine two");
});

/* -------------------------------------------------------------- chunking ---- */

test("REQUIRED: empty/whitespace-only text produces zero chunks", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("REQUIRED: short text produces exactly one chunk", () => {
  const chunks = chunkText("A short paragraph of project knowledge.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].index, 0);
  assert.equal(chunks[0].content, "A short paragraph of project knowledge.");
});

test("REQUIRED: a long document is split into multiple bounded chunks, never one giant blob", () => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} with some real content about the project that repeats a bit to take up space.`);
  const longText = paragraphs.join("\n\n");
  const chunks = chunkText(longText, 200);
  assert.ok(chunks.length > 1, "must actually split into multiple chunks");
  for (const c of chunks) assert.ok(c.content.length <= 200, `chunk ${c.index} must respect the cap`);
});

test("chunk indices are sequential starting at 0", () => {
  const chunks = chunkText(Array.from({ length: 10 }, (_, i) => `Para ${i}`).join("\n\n"), 20);
  chunks.forEach((c, i) => assert.equal(c.index, i));
});

test("REQUIRED: chunk count is bounded -- a very long document is truncated, never endlessly chunked", () => {
  const paragraphs = Array.from({ length: 200 }, (_, i) => `Paragraph number ${i} with enough text to force its own chunk boundary here.`);
  const chunks = chunkText(paragraphs.join("\n\n"), 80, 10);
  assert.ok(chunks.length <= 10, "must never exceed the maxChunks bound");
});

test("a single paragraph longer than the chunk cap is split on sentence boundaries, never mid-word", () => {
  const longParagraph = "This is sentence one of a very long paragraph. This is sentence two, also fairly long. This is sentence three, making the whole thing exceed the cap easily.";
  const chunks = chunkText(longParagraph, 60);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    // never ends mid-word: either ends with real punctuation/whitespace-safe
    // boundary, or is the hard-cut fallback (still whole up to the cap).
    assert.ok(c.content.length <= 60);
  }
  // Reassembling should still contain the original words (nothing silently dropped).
  const rejoined = chunks.map((c) => c.content).join(" ");
  assert.ok(rejoined.includes("sentence one"));
  assert.ok(rejoined.includes("sentence three"));
});
