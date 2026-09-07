import "server-only";
import { headers } from "next/headers";
import { PANEL_ROOT_DOMAIN } from "@/src/lib/config";

/**
 * Link prefix for a panel's own storefront pages, based on the host being served.
 *
 *  - APP host (innvil.cloud, localhost, *.vercel.app) → "/p/<subdomain>" (path routing)
 *  - PANEL host (sub.innvil.cloud, a custom domain, sub.localhost) → "" because the
 *    proxy already rewrites "/" to that panel; adding "/p/<sub>" there would route back
 *    through the proxy and land on Innvil instead of the panel.
 */
export async function storefrontBase(subdomain: string): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase().split(":")[0];
  const root = PANEL_ROOT_DOMAIN.toLowerCase();
  const isAppHost =
    host === root ||
    host === `www.${root}` ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".vercel.app");
  return isAppHost ? `/p/${subdomain}` : "";
}
