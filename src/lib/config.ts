/**
 * App-wide configuration constants.
 *
 * PANEL_ROOT_DOMAIN is the apex domain every panel's included subdomain lives
 * under (e.g. `novaboost.innvil.cloud`). Overridable via env for staging.
 */
export const PANEL_ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_PANEL_ROOT_DOMAIN?.trim() || "innvil.cloud";

/** Innvil Watch's standalone product domain (proxy.ts already reserves the
 *  "watch" subdomain so it's never mistaken for a panel — see
 *  src/lib/products/watch.ts). Presentation-only: this never grants Watch
 *  access by itself, entitlement is always resolved server-side. */
export const WATCH_ROOT_DOMAIN = `watch.${PANEL_ROOT_DOMAIN}`;

/**
 * The ONE stable Vercel Preview branch alias manually treated as Watch, for
 * this branch's QA only — `innvil-git-<branch>-<team>.vercel.app` never
 * changes across redeploys of this branch (unlike the raw per-deployment
 * hash URL, which does), so it's safe to name explicitly rather than derive
 * from Vercel's slugification rules (lowercasing/dot-stripping/team suffix),
 * which aren't worth reverse-engineering for a one-off QA convenience.
 * Deliberately NOT a `*.vercel.app` wildcard match — every other preview
 * deployment (this branch's own raw hash URLs, and any other branch's
 * alias) must keep rendering the normal main-Innvil experience.
 */
const WATCH_PREVIEW_ALIAS_HOST = "innvil-git-rebrand-innvil-v020-ako-me.vercel.app";

/**
 * True when `host` should be classified as Innvil Watch's domain — the
 * production rule (`WATCH_ROOT_DOMAIN`, exact match, always active) plus a
 * single named Preview-only exception (`WATCH_PREVIEW_ALIAS_HOST`, gated on
 * `VERCEL_ENV === "preview"` so it can never fire in Production or in a
 * plain local/CI build where that env var is unset). Pure and directly
 * testable — `isWatchHost()` in watch-host.ts is the only real caller,
 * reading the actual request's host header and delegating here.
 */
export function isWatchHostname(host: string, vercelEnv: string | undefined = process.env.VERCEL_ENV): boolean {
  const h = host.trim().toLowerCase();
  if (h === WATCH_ROOT_DOMAIN.toLowerCase()) return true;
  if (vercelEnv === "preview" && h === WATCH_PREVIEW_ALIAS_HOST) return true;
  return false;
}

/**
 * CLIENT-side link prefix for a panel's own storefront pages, based on the host the
 * browser is actually on:
 *   - app host (innvil.cloud, localhost, *.vercel.app) → "/p/<subdomain>"
 *   - panel host (subdomain, custom domain, sub.localhost) → "" (the proxy already
 *     scopes "/" to this panel; adding the prefix would bounce back to Innvil)
 * Server components should use `storefrontBase()` in src/lib/storefront-host.ts.
 */
export function storefrontBaseFromLocation(subdomain: string): string {
  if (typeof window === "undefined") return `/p/${subdomain}`;
  const host = window.location.hostname.toLowerCase();
  const root = PANEL_ROOT_DOMAIN.toLowerCase();
  const isAppHost =
    host === root ||
    host === `www.${root}` ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".vercel.app");
  return isAppHost ? `/p/${subdomain}` : "";
}

/**
 * True when `host` is exactly Innvil Watch's own product domain. Pure and
 * testable on its own -- the small explicit allowlist behind
 * auth.ts's server-side redirect-origin resolution for password-reset
 * emails (never trusts an arbitrary client-supplied host/URL, only this one
 * alternate first-party domain).
 */
export function isTrustedWatchHost(host: string): boolean {
  return host.trim().toLowerCase() === WATCH_ROOT_DOMAIN.toLowerCase();
}

/** The hostname shown for a panel (its custom domain if set, else its subdomain). */
export function panelDisplayDomain(subdomain: string, customDomain?: string | null): string {
  return customDomain || `${subdomain}.${PANEL_ROOT_DOMAIN}`;
}

/**
 * Absolute live storefront URL for a panel (custom domain if set, else subdomain).
 */
export function panelStorefrontPath(subdomain: string, customDomain?: string | null): string {
  return `https://${panelDisplayDomain(subdomain, customDomain)}`;
}
