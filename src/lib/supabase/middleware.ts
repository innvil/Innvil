import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { STOREFRONT_COOKIE_NAME, isStorefrontPath } from "./constants";

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
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const storefront = isStorefrontPath(request.nextUrl.pathname);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(storefront ? { cookieOptions: { name: STOREFRONT_COOKIE_NAME } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Touch the user to trigger a token refresh when needed.
  await supabase.auth.getUser();

  return response;
}
