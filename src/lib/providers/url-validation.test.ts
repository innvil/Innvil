import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProviderApiBaseUrl,
  PROVIDER_BASE_URL_QUERY_ERROR,
} from "./url-validation";

test("accepts provider base URL: https://tgref.xyz/api/v2", () => {
  const res = validateProviderApiBaseUrl("https://tgref.xyz/api/v2", { requireHttps: true });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value, "https://tgref.xyz/api/v2");
});

test("rejects full request URL with query params and key", () => {
  const res = validateProviderApiBaseUrl("https://tgref.xyz/api/v2?action=services&key=test", { requireHttps: true });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.error, PROVIDER_BASE_URL_QUERY_ERROR);
});

test("rejects bare trailing question mark", () => {
  const res = validateProviderApiBaseUrl("https://tgref.xyz/api/v2?", { requireHttps: true });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "query_not_allowed");
});

test("rejects fragments", () => {
  const res = validateProviderApiBaseUrl("https://tgref.xyz/api/v2#foo", { requireHttps: true });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "fragment_not_allowed");
});

test("rejects embedded credentials", () => {
  const res = validateProviderApiBaseUrl("https://user:pass@tgref.xyz/api/v2", { requireHttps: true });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "credentials_not_allowed");
});

test("accepts provider base URL: /api/v1", () => {
  const res = validateProviderApiBaseUrl("https://provider.example.com/api/v1", { requireHttps: true });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value, "https://provider.example.com/api/v1");
});

test("accepts provider base URL: /api/v3", () => {
  const res = validateProviderApiBaseUrl("https://provider.example.com/api/v3", { requireHttps: true });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value, "https://provider.example.com/api/v3");
});

test("rejects malformed URL with generic invalid URL error", () => {
  const res = validateProviderApiBaseUrl("not a url", { requireHttps: true });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.code, "invalid_url");
  assert.equal(res.error, "Invalid URL");
});

test("preserves trailing slash consistently", () => {
  const res = validateProviderApiBaseUrl("https://tgref.xyz/api/v2/", { requireHttps: true });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value, "https://tgref.xyz/api/v2/");
});
