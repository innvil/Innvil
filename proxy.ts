import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/middleware";
import { PANEL_ROOT_DOMAIN } from "@/src/lib/config";

/* =========================================================
   Host-based routing (Next 16 proxy).
   A panel is served on either `<subdomain>.innvil.cloud` OR a connected custom
   domain (e.g. `mypanel.com`). Both are rewritten to the internal `/p/<identifier>`
   storefront route; getPublicPanel() resolves the identifier by subdomain OR
   custom_domain. The app + landing stay on the apex `innvil.cloud`. Everything
   still flows through updateSession so auth cookies stay fresh.
   ========================================================= */

// Subdomains that are NOT panels (reserved for the platform itself).
const RESERVED = new Set(["www", "app", "api", "admin", "superadmin", "staging", "dev", "mail", "cdn", "assets"]);

/** Hosts that serve the OWNER app / landing (never a storefront). */
function isAppHost(h: string): boolean {
  const root = PANEL_ROOT_DOMAIN.toLowerCase();
  return (
    h === root ||
    h === `www.${root}` ||
    h === "localhost" ||
    h === "127.0.0.1" ||
    h.endsWith(".localhost") ||
    h.endsWith(".vercel.app") // Vercel preview deployments
  );
}

/**
 * Resolve the storefront identifier for a host, or null if the host serves the app.
 * - `<sub>.innvil.cloud` (not reserved) → the subdomain label
 * - any other non-app host → the full hostname (a custom domain, resolved by
 *   custom_domain in getPublicPanel)
 */
function storefrontIdentifier(host: string): string | null {
  const root = PANEL_ROOT_DOMAIN.toLowerCase();
  const h = host.split(":")[0].toLowerCase(); // strip port
  if (!h || isAppHost(h)) return null;
  if (h.endsWith(`.${root}`)) {
    const sub = h.slice(0, h.length - root.length - 1);
    if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
    return sub;
  }
  return h; // custom domain
}

// Paths that must never be rewritten to the storefront (framework + API + assets).
function isPassthroughPath(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/p/") ||
    pathname === "/favicon.ico" ||
    /\.[a-z0-9]+$/i.test(pathname) // has a file extension
  );
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const identifier = storefrontIdentifier(host);
  const { pathname } = request.nextUrl;

  if (identifier && !isPassthroughPath(pathname)) {
    const rewriteTo = request.nextUrl.clone();
    rewriteTo.pathname = `/p/${identifier}${pathname === "/" ? "" : pathname}`;
    return updateSession(request, { rewriteTo, storefront: true });
  }

  return updateSession(request);
}

export const config = {
  // Run on all routes except static assets and image optimization files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
