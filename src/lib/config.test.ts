import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedWatchHost, isWatchHostname, WATCH_ROOT_DOMAIN } from "./config";

const PREVIEW_ALIAS = "innvil-git-rebrand-innvil-v020-ako-me.vercel.app";

/**
 * The allowlist behind the password-reset redirect-origin resolution in
 * src/lib/actions/auth.ts (resolveAuthRedirectOrigin) -- an open-redirect
 * safety boundary: only Innvil Watch's exact own domain is ever trusted as
 * an alternate reset-link origin, never an arbitrary client-controlled host.
 */

test("REQUIRED: the exact Watch root domain is trusted", () => {
  assert.equal(isTrustedWatchHost(WATCH_ROOT_DOMAIN), true);
});

test("REQUIRED: host comparison is case-insensitive", () => {
  assert.equal(isTrustedWatchHost(WATCH_ROOT_DOMAIN.toUpperCase()), true);
});

test("REQUIRED: an attacker-controlled lookalike host is never trusted", () => {
  assert.equal(isTrustedWatchHost(`evil-${WATCH_ROOT_DOMAIN}`), false);
  assert.equal(isTrustedWatchHost(`${WATCH_ROOT_DOMAIN}.evil.com`), false);
  assert.equal(isTrustedWatchHost(`notwatch.innvil.cloud`), false);
});

test("REQUIRED: the plain apex/app host is not trusted by this allowlist (falls through to NEXT_PUBLIC_APP_URL)", () => {
  assert.equal(isTrustedWatchHost("innvil.cloud"), false);
  assert.equal(isTrustedWatchHost("www.innvil.cloud"), false);
});

test("an empty or malformed host is never trusted", () => {
  assert.equal(isTrustedWatchHost(""), false);
  assert.equal(isTrustedWatchHost("   "), false);
});

/**
 * isWatchHostname -- the classification `isWatchHost()` (watch-host.ts)
 * delegates to for deciding which product experience to render. Production
 * rule is unconditional (`WATCH_ROOT_DOMAIN`, any env); the one stable
 * Vercel Preview branch alias is a NAMED, Preview-only exception -- never a
 * `*.vercel.app` wildcard.
 */

test("REQUIRED: watch.innvil.cloud is classified as Watch in any environment", () => {
  assert.equal(isWatchHostname(WATCH_ROOT_DOMAIN, undefined), true);
  assert.equal(isWatchHostname(WATCH_ROOT_DOMAIN, "production"), true);
  assert.equal(isWatchHostname(WATCH_ROOT_DOMAIN, "preview"), true);
});

test("REQUIRED: the plain apex innvil.cloud is never classified as Watch", () => {
  assert.equal(isWatchHostname("innvil.cloud", undefined), false);
  assert.equal(isWatchHostname("innvil.cloud", "production"), false);
  assert.equal(isWatchHostname("innvil.cloud", "preview"), false);
});

test("REQUIRED: the stable Preview branch alias is classified as Watch ONLY when VERCEL_ENV=preview", () => {
  assert.equal(isWatchHostname(PREVIEW_ALIAS, "preview"), true);
});

test("REQUIRED: an unrelated Vercel preview hostname is never classified as Watch, even in Preview -- no wildcard match", () => {
  assert.equal(isWatchHostname("innvil-abc123xyz-ako-me.vercel.app", "preview"), false);
  assert.equal(isWatchHostname("some-other-branch-ako-me.vercel.app", "preview"), false);
  assert.equal(isWatchHostname("innvil-git-some-other-branch-ako-me.vercel.app", "preview"), false);
});

test("REQUIRED: the same Preview alias hostname is NOT treated as Watch outside Preview (unset/production/development)", () => {
  assert.equal(isWatchHostname(PREVIEW_ALIAS, undefined), false);
  assert.equal(isWatchHostname(PREVIEW_ALIAS, "production"), false);
  assert.equal(isWatchHostname(PREVIEW_ALIAS, "development"), false);
});

test("comparison is case-insensitive for both the production and preview rules", () => {
  assert.equal(isWatchHostname(WATCH_ROOT_DOMAIN.toUpperCase(), "production"), true);
  assert.equal(isWatchHostname(PREVIEW_ALIAS.toUpperCase(), "preview"), true);
});
