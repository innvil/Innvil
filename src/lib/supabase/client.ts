import { createBrowserClient } from "@supabase/ssr";
import { STOREFRONT_COOKIE_NAME } from "./constants";

/**
 * Browser Supabase client (anon key). Safe to use in Client Components.
 * RLS applies — this client can only see what the signed-in user is allowed to.
 *
 * Pass `cookieName` to bind to a namespaced session (the storefront uses its own).
 */
export function createClient(cookieName?: string) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    cookieName ? { cookieOptions: { name: cookieName } } : undefined
  );
}

/** Browser client bound to the customer storefront session (separate cookie). */
export function createStorefrontClient() {
  return createClient(STOREFRONT_COOKIE_NAME);
}
