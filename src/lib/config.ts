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
