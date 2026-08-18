import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedWatchHost, WATCH_ROOT_DOMAIN } from "./config";

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
