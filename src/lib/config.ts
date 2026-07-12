/**
 * App-wide configuration constants.
 *
 * PANEL_ROOT_DOMAIN is the apex domain every panel's included subdomain lives
 * under (e.g. `novaboost.innvil.cloud`). Overridable via env for staging.
 */
export const PANEL_ROOT_DOMAIN =
  process.env.NEXT_PUBLIC_PANEL_ROOT_DOMAIN?.trim() || "innvil.cloud";

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
