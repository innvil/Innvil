import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/src/lib/supabase/middleware";
import { PANEL_ROOT_DOMAIN } from "@/src/lib/config";

/* =========================================================
   Host-based routing (Next 16 proxy).
   A panel lives on `<subdomain>.innvil.cloud`. We rewrite those hosts to the
   internal `/p/<subdomain>` storefront route (the app + landing stay on the apex
   `innvil.cloud`). Custom domains land in a later pass. Everything still flows
   through updateSession so auth cookies stay fresh.
   ========================================================= */

// Subdomains that are NOT panels (reserved for the platform itself).
const RESERVED = new Set(["www", "app", "api", "admin", "superadmin", "staging", "dev", "mail", "cdn", "assets"]);

/** If `host` is `<sub>.<ROOT>` (and not reserved), return `<sub>`, else null. */
function panelSubdomain(host: string): string | null {
  const root = PANEL_ROOT_DOMAIN.toLowerCase();
  const h = host.split(":")[0].toLowerCase(); // strip port
  if (h === root || !h.endsWith(`.${root}`)) return null;
  const sub = h.slice(0, h.length - root.length - 1);
  if (!sub || sub.includes(".") || RESERVED.has(sub)) return null;
  return sub;
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
  const sub = panelSubdomain(host);
  const { pathname } = request.nextUrl;

  if (sub && !isPassthroughPath(pathname)) {
    const rewriteTo = request.nextUrl.clone();
    rewriteTo.pathname = `/p/${sub}${pathname === "/" ? "" : pathname}`;
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
