/**
 * Cookie namespace for the customer storefront session.
 *
 * The owner/platform app and the per-panel customer storefront both use Supabase
 * Auth. On a single origin (localhost during dev) they'd otherwise share ONE
 * session cookie, so logging into the storefront would silently log you out of
 * the owner dashboard (and vice-versa). Giving the storefront its own cookie name
 * lets both sessions coexist in the same browser.
 *
 * In production this is moot — the storefront lives on a separate domain
 * (panel subdomain / custom domain), so cookies are already scoped per-domain —
 * but the separation keeps local testing sane.
 */
export const STOREFRONT_COOKIE_NAME = "ll-store-auth";

/** True for customer storefront routes (which use the storefront session). */
export function isStorefrontPath(pathname: string): boolean {
  return pathname.startsWith("/p/");
}
