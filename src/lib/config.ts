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
 * A link that opens a panel's live storefront. Uses the in-app path (`/p/<sub>`),
 * which works today in every environment; custom-domain host routing lands later.
 */
export function panelStorefrontPath(subdomain: string): string {
  return `/p/${subdomain}`;
}
