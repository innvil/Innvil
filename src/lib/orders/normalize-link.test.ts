import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderLink } from "./normalize-link";

/* --------------------------------------------------- normalizeOrderLink ---- */
// Must stay byte-for-byte equivalent to the Postgres normalize_order_link()
// function the DB duplicate-guard indexes are built on (see file header).

test("normalizeOrderLink: strips scheme, www, query, fragment, trailing slash", () => {
  assert.equal(normalizeOrderLink("https://www.example.com/post/123/?ref=abc#frag"), "example.com/post/123");
});

test("normalizeOrderLink: lowercases the ENTIRE string including the path (Case E — must match the DB function)", () => {
  assert.equal(normalizeOrderLink("https://Example.com/Post/123"), "example.com/post/123");
  assert.equal(normalizeOrderLink("HTTPS://EXAMPLE.COM/POST/123"), "example.com/post/123");
});

test("normalizeOrderLink: two forms of the same destination normalize identically (Case E)", () => {
  const a = normalizeOrderLink("https://www.example.com/post/123/");
  const b = normalizeOrderLink("http://Example.com/Post/123");
  assert.equal(a, b);
});

test("normalizeOrderLink: no scheme/www present still normalizes", () => {
  assert.equal(normalizeOrderLink("example.com/post/123"), "example.com/post/123");
});

test("normalizeOrderLink: empty/undefined input is safe", () => {
  assert.equal(normalizeOrderLink(""), "");
});

/* ---------------------------------------- duplicate-identity decision (pure) ---- */
// Mirrors the exact matching rule used by both place.ts (findDuplicate) and
// sync.ts (reconcileDuplicateOrders): normalized link + service_id ONLY.
// category is never part of duplicate identity (the bug this migration fixes).

interface OrderLike {
  serviceId: string;
  link: string;
  status: "pending" | "processing" | "in_progress" | "completed" | "canceled";
}

const ACTIVE = new Set(["pending", "processing", "in_progress"]);

function isDuplicate(existing: OrderLike, incoming: { serviceId: string; link: string }): boolean {
  if (!ACTIVE.has(existing.status)) return false;
  if (existing.serviceId !== incoming.serviceId) return false;
  return normalizeOrderLink(existing.link) === normalizeOrderLink(incoming.link);
}

test("Case A: same link + same category + same service_id + active existing order -> BLOCK", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://example.com/post/123", status: "pending" };
  const incoming = { serviceId: "svc-1001", link: "https://example.com/post/123" };
  assert.equal(isDuplicate(existing, incoming), true);
});

test("Case B (the reported bug): same link + same category + DIFFERENT service_id -> ALLOW", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://example.com/post/123", status: "pending" };
  const incoming = { serviceId: "svc-2007", link: "https://example.com/post/123" };
  assert.equal(isDuplicate(existing, incoming), false);
});

test("Case D: different link + same service_id -> ALLOW", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://example.com/post/123", status: "pending" };
  const incoming = { serviceId: "svc-1001", link: "https://example.com/post/999" };
  assert.equal(isDuplicate(existing, incoming), false);
});

test("Case E: same destination in two different textual forms + same service_id -> BLOCK", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://www.example.com/post/123/", status: "processing" };
  const incoming = { serviceId: "svc-1001", link: "http://Example.com/Post/123" };
  assert.equal(isDuplicate(existing, incoming), true);
});

test("Case F: same link + same service_id, but existing order is completed (no longer active) -> ALLOW (existing product policy, unchanged)", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://example.com/post/123", status: "completed" };
  const incoming = { serviceId: "svc-1001", link: "https://example.com/post/123" };
  assert.equal(isDuplicate(existing, incoming), false);
});

test("Case F: same link + same service_id, existing order canceled -> ALLOW", () => {
  const existing: OrderLike = { serviceId: "svc-1001", link: "https://example.com/post/123", status: "canceled" };
  const incoming = { serviceId: "svc-1001", link: "https://example.com/post/123" };
  assert.equal(isDuplicate(existing, incoming), false);
});
