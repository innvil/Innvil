import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { STOREFRONT_COOKIE_NAME } from "./constants";

/**
 * Server Supabase client (anon key + user session from cookies).
 * Use in Server Components, Route Handlers, and Server Actions. RLS applies as
 * the signed-in user. In Next 16 `cookies()` is async.
 *
 * Pass `cookieName` to read/write a namespaced session — the customer storefront
 * uses its own so it never clobbers the owner session (see ./constants).
 */
export async function createClient(cookieName?: string) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(cookieName ? { cookieOptions: { name: cookieName } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookie writes are ignored here
            // and handled by middleware instead. Safe to swallow.
          }
        },
      },
    }
  );
}

/**
 * Server client scoped to the customer storefront session (separate cookie).
 * Use for all customer-facing auth + data reads on `/p/[subdomain]` routes.
 */
export function createStorefrontClient() {
  return createClient(STOREFRONT_COOKIE_NAME);
}
