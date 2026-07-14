import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { STOREFRONT_COOKIE_NAME, isStorefrontPath } from "./constants";

const OWNER_COOKIE_RE = /^sb-[a-z0-9_-]+-auth-token(?:\.\d+)?$/i;

function hasAuthCookie(request: NextRequest, storefront: boolean): boolean {
  const all = request.cookies.getAll();
  if (storefront) {
    return all.some(
      (c) => c.name === STOREFRONT_COOKIE_NAME || c.name.startsWith(`${STOREFRONT_COOKIE_NAME}.`)
    );
  }
  return all.some((c) => OWNER_COOKIE_RE.test(c.name));
}

/**
 * Refreshes the Supabase auth session on each request and keeps the auth cookies
 * in sync between the browser and Server Components. Called from the root
 * middleware. Does not itself gate routes — protected-route redirects are added
 * with the auth increment.
 *
 * Storefront routes (`/p/*`) refresh the separate customer session cookie; every
 * other route refreshes the owner/platform session. This keeps the two logins
 * independent in a single browser (see ./constants).
 */
export async function updateSession(
  request: NextRequest,
  opts?: {
    /** Internally rewrite to this URL (host-based storefront routing) while still
     *  refreshing the session cookies on the response. */
    rewriteTo?: URL;
    /** Force the storefront session cookie (subdomain/custom-domain hosts serve the
     *  storefront even though the incoming pathname isn't `/p/...` yet). */
    storefront?: boolean;
  }
) {
  const build = () =>
    opts?.rewriteTo ? NextResponse.rewrite(opts.rewriteTo, { request }) : NextResponse.next({ request });

  let response = build();

  const storefront = opts?.storefront ?? isStorefrontPath(request.nextUrl.pathname);

  // Anonymous requests don't need a claims/user check. Let public pages stream.
  if (!hasAuthCookie(request, storefront)) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(storefront ? { cookieOptions: { name: STOREFRONT_COOKIE_NAME } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = build();
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Claims verification is cheaper than a full auth-server user fetch for normal routing.
  // Fall back to getUser only if claims are unavailable in this environment.
  try {
    await supabase.auth.getClaims();
  } catch {
    await supabase.auth.getUser();
  }

  return response;
}
